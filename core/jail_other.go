//go:build !linux

package main

import "fmt"

func execSelf(string, []string, []string) error {
	return fmt.Errorf("exec jail is linux-only")
}
