//go:build linux

package main

// The Landlock tier's syscall shims — hand-rolled UAPI on purpose: the core
// module carries zero dependencies, and the surface is three syscalls plus
// prctl. Syscall numbers are the asm-generic unistd values (444/445/446),
// stable on every architecture we ship (amd64 today, arm64 with REQ-I26).
//
// Semantics follow the kernel docs: restrictions are per-thread, inherited by
// threads created afterwards and by fork/exec children. maybeJail applies
// them at the very top of the serve path, before any worker goroutine exists;
// the Go runtime's own helper threads (sysmon, GC) never open files or exec.

import (
	"fmt"
	"syscall"
	"unsafe"
)

const (
	sysLandlockCreateRuleset = 444
	sysLandlockAddRule       = 445
	sysLandlockRestrictSelf  = 446
	sysPrctl                 = 157

	landlockCreateRulesetVersion = 1 << 0
	prSetNoNewPrivs              = 38
	// O_PATH is absent from the stdlib syscall package; the asm-generic
	// value is 0o100000000 = 0x200000. O_CLOEXEC (0x80000) IS in stdlib.
	linuxOPath = 0x200000

	// Access-right bits, one per supported Landlock ABI step (kernel ≥5.13).
	landlockExecute    = 1 << 0
	landlockWriteFile  = 1 << 1
	landlockReadFile   = 1 << 2
	landlockReadDir    = 1 << 3
	landlockRemoveDir  = 1 << 4
	landlockRemoveFile = 1 << 5
	landlockMakeChar   = 1 << 6
	landlockMakeDir    = 1 << 7
	landlockMakeReg    = 1 << 8
	landlockMakeSock   = 1 << 9
	landlockMakeFifo   = 1 << 10
	landlockMakeBlock  = 1 << 11
	landlockMakeSym    = 1 << 12
	landlockRefer      = 1 << 13 // ABI 2
	landlockTruncate   = 1 << 14 // ABI 3
)

// The bits the read-only rule grants on `/`: everything a confined reader or
// executor needs, nothing that mutates. Deny-by-default covers the rest.
const landlockReadOnlyBits = landlockExecute | landlockReadFile | landlockReadDir

// The bits the workspace rule adds on the workspace root in
// workspace-write: the full mutation vocabulary, masked to the kernel's ABI.
const landlockWriteBits = landlockWriteFile |
	landlockRemoveDir | landlockRemoveFile |
	landlockMakeChar | landlockMakeDir | landlockMakeReg | landlockMakeSock |
	landlockMakeFifo | landlockMakeBlock | landlockMakeSym |
	landlockRefer | landlockTruncate

// The handled set for one ABI: restricting a right the kernel cannot express
// would fail the whole ruleset, so unsupported high bits are dropped — and
// the tier notes must say so (partial enforcement, honestly reported).
func landlockHandledBits(abi int) uint64 {
	bits := uint64(landlockExecute | landlockWriteFile | landlockReadFile | landlockReadDir |
		landlockRemoveDir | landlockRemoveFile |
		landlockMakeChar | landlockMakeDir | landlockMakeReg | landlockMakeSock |
		landlockMakeFifo | landlockMakeBlock | landlockMakeSym)
	if abi >= 2 {
		bits |= landlockRefer
	}
	if abi >= 3 {
		bits |= landlockTruncate
	}
	return bits
}

type landlockRulesetAttr struct {
	handledAccessFs uint64
}

// The kernel struct is __attribute__((packed)): u64 + s32 = 12 bytes with no
// tail padding. Go's natural layout puts parentFd at offset 8, and the kernel
// copies only 12 bytes, so the natural struct is byte-compatible.
type landlockPathBeneathAttr struct {
	allowedAccess uint64
	parentFd      int32
}

// The kernel's Landlock ABI version; 0 when the kernel predates Landlock
// (ENOSYS), has it compiled out, or the LSM is disabled at boot.
func landlockAbiOf() int {
	abi, _, errno := syscall.Syscall(sysLandlockCreateRuleset, 0, 0, landlockCreateRulesetVersion)
	if errno != 0 {
		return 0
	}
	return int(abi)
}

func errnoWrap(op string, errno syscall.Errno) error {
	return fmt.Errorf("landlock %s: %w", op, errno)
}

// Apply the Landlock restrictions for one mode. Fail-closed: any step that
// errors aborts confinement and the caller must refuse to serve confined.
func restrictLandlock(sandbox, workspace string) error {
	if sandbox != "read-only" && sandbox != "workspace-write" {
		return fmt.Errorf("landlock tier: unknown sandbox mode %q", sandbox)
	}
	if sandbox == "workspace-write" && (workspace == "" || workspace[0] != '/' || workspace == "/") {
		return fmt.Errorf("landlock tier: workspace-write needs a non-root absolute workspace path")
	}
	abi := landlockAbiOf()
	if abi < 1 {
		return fmt.Errorf("landlock tier: kernel reports no Landlock ABI")
	}
	handled := landlockHandledBits(abi)

	attr := landlockRulesetAttr{handledAccessFs: handled}
	rulesetFd, _, errno := syscall.Syscall(sysLandlockCreateRuleset,
		uintptr(unsafe.Pointer(&attr)), unsafe.Sizeof(attr), 0)
	if errno != 0 {
		return errnoWrap("create_ruleset", errno)
	}
	defer syscall.Close(int(rulesetFd))

	addRule := func(path string, allowed uint64) error {
		fd, err := syscall.Open(path, linuxOPath|syscall.O_CLOEXEC, 0)
		if err != nil {
			return fmt.Errorf("landlock rule on %s: %w", path, err)
		}
		defer syscall.Close(fd)
		rule := landlockPathBeneathAttr{allowedAccess: allowed, parentFd: int32(fd)}
		// LANDLOCK_RULE_PATH_BENEATH == 1.
		if _, _, errno := syscall.Syscall6(sysLandlockAddRule, rulesetFd, 1,
			uintptr(unsafe.Pointer(&rule)), 0, 0, 0); errno != 0 {
			return errnoWrap("add_rule", errno)
		}
		return nil
	}

	// Read-only everywhere; the workspace rule stacks the write vocabulary on
	// top for workspace-write. Bits beyond the kernel's ABI are dropped —
	// decideFenceTier already reported that as partial enforcement.
	if err := addRule("/", landlockReadOnlyBits&handled); err != nil {
		return err
	}
	if sandbox == "workspace-write" {
		if err := addRule(workspace, (landlockReadOnlyBits|landlockWriteBits)&handled); err != nil {
			return err
		}
	}

	// PR_SET_NO_NEW_PRIVS is required before restrict_self and is itself
	// inherited — a worthwhile belt under the Landlock suspenders.
	if _, _, errno := syscall.Syscall6(sysPrctl, prSetNoNewPrivs, 1, 0, 0, 0, 0); errno != 0 {
		return errnoWrap("prctl(NO_NEW_PRIVS)", errno)
	}
	if _, _, errno := syscall.Syscall(sysLandlockRestrictSelf, rulesetFd, 0, 0); errno != 0 {
		return errnoWrap("restrict_self", errno)
	}
	return nil
}

// probeLandlockUsable reports whether a real restriction holds in this
// process — the fenceinfo face of restrictLandlock for diagnostics.
func probeLandlockUsable() error {
	return restrictLandlock("read-only", "")
}
