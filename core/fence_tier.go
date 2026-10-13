package main

// REQ-I29 (folding the former REQ-I30 direction): the fence TIER decision —
// one honest answer to "how can this host confine a confined mode?".
//
// Order mirrors the host's own dsh-sandbox-local linux chain
// (linux: ["bwrap", "landlock"]): bubblewrap first because its mount profile
// expresses the mode vocabulary faithfully; Landlock second because it needs
// no privileges and no user namespaces — exactly the environments where a
// present bwrap still cannot run (containers refusing unprivileged userns).
// Neither → tier "none", with a refusal that names every way out.
//
// This file is the pure half: it decides from injected probe results, so the
// table is testable on any platform. The syscall shims live in landlock_*.go,
// the bwrap resolution in jail.go, and the enforcement in maybeJail.

import (
	"fmt"
	"os"
	"strings"
)

// The fence tiers, in preference order. Wire-visible strings — the TS side
// parses the same spellings from `dsh-core fenceinfo`.
type fenceTier string

const (
	tierBwrap    fenceTier = "bwrap"
	tierLandlock fenceTier = "landlock"
	tierNone     fenceTier = "none"
)

// What one assessment found. JSON-tagged for the `fenceinfo` subcommand and
// the deploy-time probe; every field is advisory except Tier.
type fenceInfo struct {
	Tier          fenceTier `json:"tier"`
	BwrapPath     string    `json:"bwrapPath,omitempty"`
	BwrapProbeErr string    `json:"bwrapProbeErr,omitempty"`
	BwrapMissing  bool      `json:"bwrapMissing"`
	LandlockABI   int       `json:"landlockAbi"`
	LandlockErr   string    `json:"landlockErr,omitempty"`
	Notes         []string  `json:"notes,omitempty"`
	// DSH_CORE_FENCE_TIER=none was honored — the refusal must say THAT,
	// not claim the host lacks tiers it demonstrably has.
	DisabledByRequest bool `json:"disabledByRequest,omitempty"`
}

// The injectable probes. Production wires the real shims; tests inject fakes.
type fenceProbes struct {
	// Resolve the bubblewrap binary (DSH_CORE_BWRAP, deployed bin/, PATH).
	bwrapPath func() (string, error)
	// Functionally probe one resolved binary: run the real read-only profile
	// around `true` — presence on PATH proves nothing in a userns-less
	// container, the probe does (BUG family the host calls defaultProbeBwrap).
	bwrapUsable func(path string) error
	// The kernel's Landlock ABI version; 0 = unsupported/disabled/ENOSYS.
	landlockABI func() int
	// Tests/dev override (DSH_CORE_FENCE_TIER): assume the tier viable.
	forcedTier string
}

// The refusal when Tier == none: every way out, mirroring the host's
// SANDBOX_UNAVAILABLE copy shape.
func (i fenceInfo) refusal(mode string) string {
	if i.DisabledByRequest {
		return fmt.Sprintf("%s: sandbox mode %q cannot be confined — DSH_CORE_FENCE_TIER=none disabled the fence on this host; unset it to let the tier decision run", errSandbox, mode)
	}
	cause := "no confinement tier is usable on this host"
	switch {
	case i.BwrapMissing:
		cause = "bubblewrap is not installed"
	case i.BwrapProbeErr != "":
		cause = fmt.Sprintf("bubblewrap is installed but unusable (%s)", i.BwrapProbeErr)
	}
	landlock := "the kernel does not expose Landlock (need linux ≥5.13 with the Landlock LSM enabled)"
	if i.LandlockErr != "" {
		landlock = fmt.Sprintf("landlock is unavailable (%s)", i.LandlockErr)
	}
	return fmt.Sprintf("%s: sandbox mode %q cannot be confined — %s; and %s. Install bubblewrap (Debian/Ubuntu `apt-get install bubblewrap`, Fedora/RHEL `dnf install bubblewrap`, Arch `pacman -S bubblewrap`, openSUSE `zypper install bubblewrap`) or run on a Landlock-enabling kernel, or run this work with sandbox mode off",
		errSandbox, mode, cause, landlock)
}

// The note lines that make a Landlock tier honest about what it is NOT.
func landlockTierNotes(abi int, mode string) []string {
	notes := []string{
		"landlock tier: no mount isolation — no private tmpfs /tmp, no PID namespace; the process sees the real filesystem tree",
	}
	if mode == "workspace-write" {
		notes = append(notes, "landlock tier: /tmp stays read-only in workspace-write — stricter than the bwrap profile's tmpfs /tmp")
	}
	if abi < 2 {
		notes = append(notes, "partial enforcement (Landlock ABI 1): rename/reparent (REFER) is not restrictable on this kernel")
	}
	if abi < 3 {
		notes = append(notes, "partial enforcement (Landlock ABI <3): truncate is not restrictable on this kernel")
	}
	return notes
}

// Decide the tier from the probes. Pure: no I/O of its own.
//
// The Landlock ABI is queried UNCONDITIONALLY: fenceinfo must report what
// the kernel can do, not what the happy path bothered to ask (a zero there
// means "unsupported", never "not checked").
func decideFenceTier(p fenceProbes, mode string) fenceInfo {
	info := fenceInfo{Tier: tierNone, LandlockABI: p.landlockABI()}
	forced := fenceTier(strings.ToLower(strings.TrimSpace(p.forcedTier)))

	path, pathErr := p.bwrapPath()
	bwrapResolved := pathErr == nil
	if bwrapResolved {
		info.BwrapPath = path
		if probeErr := p.bwrapUsable(path); probeErr != nil {
			info.BwrapProbeErr = probeErr.Error()
		}
	} else {
		info.BwrapMissing = true
	}

	// A forced tier overrides preference, never viability: honoring
	// "landlock" on a kernel without it would be an assumed fence.
	if forced == tierNone {
		info.DisabledByRequest = true
		info.Notes = append(info.Notes, "DSH_CORE_FENCE_TIER=none: confinement disabled by explicit request")
		return info
	}
	if forced == tierBwrap && bwrapResolved {
		if info.BwrapProbeErr != "" {
			info.Notes = append(info.Notes, "DSH_CORE_FENCE_TIER=bwrap overrides a failed usability probe — operator's explicit demand")
		}
		info.Tier = tierBwrap
		return info
	}
	if forced == tierLandlock && info.LandlockABI >= 1 {
		info.Tier = tierLandlock
		info.Notes = append(info.Notes, landlockTierNotes(info.LandlockABI, mode)...)
		info.Notes = append(info.Notes, "DSH_CORE_FENCE_TIER=landlock selected over a viable bwrap — operator's explicit demand")
		return info
	}

	if bwrapResolved && info.BwrapProbeErr == "" {
		info.Tier = tierBwrap
		return info
	}
	if info.LandlockABI >= 1 {
		info.Tier = tierLandlock
		info.Notes = append(info.Notes, landlockTierNotes(info.LandlockABI, mode)...)
		if info.BwrapProbeErr != "" {
			info.Notes = append(info.Notes, fmt.Sprintf("fell back from bwrap (%s)", info.BwrapProbeErr))
		} else if info.BwrapMissing {
			info.Notes = append(info.Notes, "fell back from bwrap (not installed)")
		}
		return info
	}
	if forced == tierBwrap || forced == tierLandlock {
		info.Notes = append(info.Notes, fmt.Sprintf("DSH_CORE_FENCE_TIER=%s requested but not viable on this host; refusing rather than assuming", forced))
	}
	return info
}

// The production probes: the real bwrap resolution, the real functional
// probe, the real ABI query, the real env override.
func realFenceProbes() fenceProbes {
	return fenceProbes{
		bwrapPath:   func() (string, error) { return bwrapBinary(coreExecutable()) },
		bwrapUsable: probeBwrapUsable,
		landlockABI: landlockAbiOf,
		forcedTier:  os.Getenv("DSH_CORE_FENCE_TIER"),
	}
}
