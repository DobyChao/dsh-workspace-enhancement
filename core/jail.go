package main

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

//go:embed profile.json
var profileJSON []byte

type bwrapProfile struct {
	ReadOnly            []string `json:"readOnly"`
	WorkspaceWriteExtra []string `json:"workspaceWriteExtra"`
}

// coreExecutable resolves this binary's real path (symlinks included) — the
// bwrap re-exec target and the deployed bin/ probe both start here.
func coreExecutable() string {
	exe, err := os.Executable()
	if err != nil {
		return os.Args[0]
	}
	if resolved, err := filepath.EvalSymlinks(exe); err == nil {
		return resolved
	}
	return exe
}

// bwrapBinary resolves the bubblewrap executable the self-jail re-execs into.
//
// Order (ADR-0024, INFRA-15): an explicit DSH_CORE_BWRAP override, then a
// `bin/bwrap` deployed beside the core, then the remote host's own `bwrap` on
// PATH. This repository never redistributes bubblewrap — upstream publishes a
// source tarball only — so a host without the package is refused with install
// hints instead of being handed a binary.
func bwrapBinary(exe string) (string, error) {
	if override := strings.TrimSpace(os.Getenv("DSH_CORE_BWRAP")); override != "" {
		if _, err := os.Stat(override); err != nil {
			return "", fmt.Errorf("%s: DSH_CORE_BWRAP is not usable (%w)", errSandbox, err)
		}
		return override, nil
	}
	beside := filepath.Join(filepath.Dir(exe), "bin", "bwrap")
	if _, err := os.Stat(beside); err == nil {
		return beside, nil
	}
	if found, err := exec.LookPath("bwrap"); err == nil {
		return found, nil
	}
	return "", fmt.Errorf("%s: no bubblewrap on this host (checked DSH_CORE_BWRAP, %s, and PATH); install the package there — Debian/Ubuntu `apt-get install bubblewrap`, Fedora/RHEL `dnf install bubblewrap`, Arch `pacman -S bubblewrap`, openSUSE `zypper install bubblewrap` — or run the work with sandbox mode off", errSandbox, beside)
}

// probeBwrapUsable is the REQ-I29 functional probe: run the REAL read-only
// profile around `true`. Presence on PATH proves nothing — a container that
// refuses unprivileged user namespaces has bwrap installed and still cannot
// create a single mount namespace, and that must surface as "unusable", not
// as a mid-serve death after exec(2) replaces this process.
func probeBwrapUsable(path string) error {
	var profile bwrapProfile
	if err := json.Unmarshal(profileJSON, &profile); err != nil {
		return err
	}
	argv := append([]string{path}, profile.ReadOnly...)
	argv = append(argv, "--", "true")
	cmd := exec.Command(argv[0], argv[1:]...)
	cmd.Stdout = nil
	cmd.Stderr = nil
	if err := cmd.Run(); err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			return fmt.Errorf("exit %d under the read-only profile", exitErr.ExitCode())
		}
		return err
	}
	return nil
}

// bwrapJailArgv assembles the self re-exec line for the bwrap tier.
func bwrapJailArgv(bwrap, exe, sandbox, workspace string) ([]string, error) {
	var profile bwrapProfile
	if err := json.Unmarshal(profileJSON, &profile); err != nil {
		return nil, err
	}
	argv := []string{bwrap}
	argv = append(argv, profile.ReadOnly...)
	if sandbox == "workspace-write" {
		if workspace == "" || workspace[0] != '/' || workspace == "/" {
			return nil, fmt.Errorf("workspace-write needs a non-root absolute --workspace")
		}
		argv = append(argv, profile.WorkspaceWriteExtra...)
		argv = append(argv, "--bind", workspace, workspace)
	}
	argv = append(argv, "--", exe, "serve", "--sandbox", sandbox, "--already-jailed")
	if workspace != "" {
		argv = append(argv, "--workspace", workspace)
	}
	return argv, nil
}

// maybeJail enforces the confined modes before serve starts. REQ-I29: the
// tier decision drives it — bwrap (functionally probed, not assumed) re-execs
// as before; the Landlock tier restricts in-process, honestly degraded; and
// "neither" refuses fail-closed with every way out named, BEFORE exec(2)
// could replace this process with a bwrap that dies mid-flight.
func maybeJail(sandbox, workspace string, noJail bool) error {
	if noJail || sandbox == "off" {
		return nil
	}
	if os.Getenv("DSH_CORE_JAILED") == "1" {
		return nil
	}
	if runtime.GOOS != "linux" {
		return fmt.Errorf("fence requires linux (got %s)", runtime.GOOS)
	}
	if sandbox == "workspace-write" && (workspace == "" || workspace[0] != '/' || workspace == "/") {
		return fmt.Errorf("workspace-write needs a non-root absolute --workspace")
	}
	exe := coreExecutable()
	probes := realFenceProbes()
	info := decideFenceTier(probes, sandbox)
	switch info.Tier {
	case tierBwrap:
		argv, err := bwrapJailArgv(info.BwrapPath, exe, sandbox, workspace)
		if err != nil {
			return err
		}
		env := append(os.Environ(), "DSH_CORE_JAILED=1")
		return execSelf(argv[0], argv, env)
	case tierLandlock:
		if err := restrictLandlock(sandbox, workspace); err != nil {
			return fmt.Errorf("%s: %w", errSandbox, err)
		}
		_ = os.Setenv("DSH_CORE_JAILED", "1")
		// The tier line rides stderr into the host's serve-capture, so a
		// degraded fence is visible at the operator surface, never silent.
		fmt.Fprintf(os.Stderr, "dsh-core: fence tier: landlock (abi %d%s)\n",
			info.LandlockABI, noteSuffix(info.Notes))
		return nil
	default:
		return fmt.Errorf("%s", info.refusal(sandbox))
	}
}

// noteSuffix renders the honest-degradation notes as one " — a; b; c" tail.
// The "landlock tier: " self-labels are dropped here: the line already names
// the tier, and JSON readers keep the full self-describing spellings.
func noteSuffix(notes []string) string {
	if len(notes) == 0 {
		return ""
	}
	stripped := make([]string, len(notes))
	for i, note := range notes {
		stripped[i] = strings.TrimPrefix(note, "landlock tier: ")
	}
	return " — " + strings.Join(stripped, "; ")
}
