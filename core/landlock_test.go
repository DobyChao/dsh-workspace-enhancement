//go:build linux

package main

// REQ-I29 Landlock enforcement tests. Landlock restrictions are IRREVERSIBLE
// per process, so every case runs in a re-exec'd child of the test binary
// (the canonical Go self-exec pattern): the child reports its outcome through
// a file (the test binary's own stdout carries framework noise), and the
// parent asserts on it. CI's ubuntu runners run kernels with Landlock
// enabled; hosts without it skip honestly.

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

const helperEnv = "DSW_TEST_LANDLOCK_HELPER"

// The helper applies one restriction then reports whether the kernel really
// held a write attempt. Outcome lines: WRITE_DENIED… / WRITE_ALLOWED /
// RESTRICTED_OK / RESTRICT_ERROR…
//
// The outcome file's descriptor is opened BEFORE the restriction: Landlock
// mediates path-based opens, not writes to already-open descriptors —
// otherwise a correctly-restricted read-only helper could never report.
func landlockHelper() {
	outPath := os.Getenv(helperEnv + "_OUT")
	out, outErr := os.OpenFile(outPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
	report := func(text string) {
		if outErr != nil {
			return
		}
		_, _ = fmt.Fprintln(out, text)
		_ = out.Close()
	}
	if outErr != nil {
		return
	}
	mode := os.Getenv(helperEnv + "_MODE")
	workspace := os.Getenv(helperEnv + "_WS")
	if err := restrictLandlock(mode, workspace); err != nil {
		report("RESTRICT_ERROR: " + err.Error())
		return
	}
	target := os.Getenv(helperEnv + "_TARGET")
	if target == "" {
		report("RESTRICTED_OK")
		return
	}
	// os.WriteFile OPENS the target after the restriction — this is the
	// enforcement under test, not a side effect.
	if err := os.WriteFile(target, []byte("x"), 0o644); err != nil {
		report("WRITE_DENIED: " + err.Error())
		return
	}
	report("WRITE_ALLOWED")
}

func runLandlockHelper(t *testing.T, mode, workspace, target string) string {
	t.Helper()
	if os.Getenv(helperEnv) != "" {
		landlockHelper()
		os.Exit(0)
	}
	if landlockAbiOf() < 1 {
		t.Skip("kernel exposes no Landlock ABI")
	}
	outPath := filepath.Join(t.TempDir(), "outcome")
	cmd := exec.Command(os.Args[0], "-test.run=TestLandlockEnforcement")
	cmd.Env = append(os.Environ(),
		helperEnv+"=1",
		helperEnv+"_MODE="+mode,
		helperEnv+"_WS="+workspace,
		helperEnv+"_TARGET="+target,
		helperEnv+"_OUT="+outPath,
	)
	if err := cmd.Run(); err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok && exitErr.ExitCode() != 0 {
			t.Fatalf("helper failed (%v): %s", exitErr.ExitCode(), exitErr.Stderr)
		}
	}
	out, err := os.ReadFile(outPath)
	if err != nil {
		t.Fatalf("helper wrote no outcome file: %v", err)
	}
	return strings.TrimSpace(string(out))
}

func TestLandlockEnforcement(t *testing.T) {
	outsideDir := t.TempDir()
	outside := filepath.Join(outsideDir, "outside.txt")

	t.Run("read-only denies writes anywhere", func(t *testing.T) {
		out := runLandlockHelper(t, "read-only", "", outside)
		if !strings.HasPrefix(out, "WRITE_DENIED") {
			t.Fatalf("read-only must deny writes, got: %s", out)
		}
	})

	t.Run("workspace-write allows inside, denies outside", func(t *testing.T) {
		ws := t.TempDir()
		inside := filepath.Join(ws, "inside.txt")
		if out := runLandlockHelper(t, "workspace-write", ws, inside); out != "WRITE_ALLOWED" {
			t.Fatalf("workspace-write must allow the workspace root, got: %s", out)
		}
		if out := runLandlockHelper(t, "workspace-write", ws, outside); !strings.HasPrefix(out, "WRITE_DENIED") {
			t.Fatalf("workspace-write must deny outside the root, got: %s", out)
		}
	})

	t.Run("restriction itself applies cleanly", func(t *testing.T) {
		if out := runLandlockHelper(t, "read-only", "", ""); !strings.HasPrefix(out, "RESTRICTED_OK") {
			t.Fatalf("clean restriction expected, got: %s", out)
		}
	})

	t.Run("workspace-write rejects a non-absolute workspace", func(t *testing.T) {
		out := runLandlockHelper(t, "workspace-write", "relative", "")
		if !strings.HasPrefix(out, "RESTRICT_ERROR") {
			t.Fatalf("relative workspace must be refused, got: %s", out)
		}
	})
}
