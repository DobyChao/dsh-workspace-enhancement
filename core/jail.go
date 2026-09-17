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
	ReadOnly             []string `json:"readOnly"`
	WorkspaceWriteExtra  []string `json:"workspaceWriteExtra"`
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

func maybeJail(sandbox, workspace string, noJail bool) error {
	if noJail || sandbox == "off" {
		return nil
	}
	if os.Getenv("DSH_CORE_JAILED") == "1" {
		return nil
	}
	if runtime.GOOS != "linux" {
		return fmt.Errorf("v1 jail requires linux (got %s)", runtime.GOOS)
	}
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	exe, err = filepath.EvalSymlinks(exe)
	if err != nil {
		return err
	}
	bwrap, err := bwrapBinary(exe)
	if err != nil {
		return err
	}
	var profile bwrapProfile
	if err := json.Unmarshal(profileJSON, &profile); err != nil {
		return err
	}
	argv := []string{bwrap}
	argv = append(argv, profile.ReadOnly...)
	if sandbox == "workspace-write" {
		if workspace == "" || workspace[0] != '/' || workspace == "/" {
			return fmt.Errorf("workspace-write needs a non-root absolute --workspace")
		}
		argv = append(argv, profile.WorkspaceWriteExtra...)
		argv = append(argv, "--bind", workspace, workspace)
	}
	argv = append(argv, "--", exe, "serve", "--sandbox", sandbox, "--already-jailed")
	if workspace != "" {
		argv = append(argv, "--workspace", workspace)
	}
	env := append(os.Environ(), "DSH_CORE_JAILED=1")
	return execSelf(bwrap, argv, env)
}
