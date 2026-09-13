package main

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
)

//go:embed profile.json
var profileJSON []byte

type bwrapProfile struct {
	ReadOnly             []string `json:"readOnly"`
	WorkspaceWriteExtra  []string `json:"workspaceWriteExtra"`
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
	bwrap := filepath.Join(filepath.Dir(exe), "bin", "bwrap")
	if _, err := os.Stat(bwrap); err != nil {
		return fmt.Errorf("%s: bundled bwrap missing (%w)", errSandbox, err)
	}
	var profile bwrapProfile
	if err := json.Unmarshal(profileJSON, &profile); err != nil {
		return err
	}
	argv := []string{bwrap}
	argv = append(argv, profile.ReadOnly...)
	if sandbox == "workspace-write" {
		if workspace == "" || workspace[0] != '/' {
			return fmt.Errorf("workspace-write needs an absolute --workspace")
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
