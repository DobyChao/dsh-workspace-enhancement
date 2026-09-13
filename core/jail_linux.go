//go:build linux

package main

import "syscall"

func execSelf(argv0 string, argv []string, env []string) error {
	return syscall.Exec(argv0, argv, env)
}
