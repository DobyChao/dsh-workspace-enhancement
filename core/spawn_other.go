//go:build !unix

package main

import "os/exec"

// setProcessGroup is a no-op where process groups are not POSIX (BUG-9 keeps
// the fallback kill(pid) behavior there; the shipped core is linux-x64).
func setProcessGroup(*exec.Cmd) {}

// killProcessGroup reports failure so terminate falls back to kill(pid).
func killProcessGroup(int) bool { return false }
