//go:build unix

package main

import (
	"os/exec"
	"syscall"
)

// setProcessGroup makes the child its own process-group leader (BUG-9), the
// same shape as the official dsh-subprocess-local `detached: true`.
func setProcessGroup(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}

// killProcessGroup SIGKILLs the whole group led by pid. Mirrors the official
// fallback ladder: group first, single pid afterwards (caller).
func killProcessGroup(pid int) bool {
	return syscall.Kill(-pid, syscall.SIGKILL) == nil
}
