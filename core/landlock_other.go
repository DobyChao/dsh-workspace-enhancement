//go:build !linux

package main

import (
	"fmt"
	"runtime"
)

// Non-linux builds cannot offer the Landlock tier; the decision collapses to
// bwrap-or-none exactly as before REQ-I29.

func landlockAbiOf() int { return 0 }

func restrictLandlock(sandbox, workspace string) error {
	return fmt.Errorf("landlock tier requires linux (got %s)", runtime.GOOS)
}

func probeLandlockUsable() error {
	return fmt.Errorf("landlock tier requires linux (got %s)", runtime.GOOS)
}
