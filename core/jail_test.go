package main

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// exeSuffix mirrors Go's own executable naming so the PATH lookup case works on
// every platform the Go lane runs on.
func exeSuffix() string {
	if runtime.GOOS == "windows" {
		return ".exe"
	}
	return ""
}

func writeFile(t *testing.T, path string) {
	t.Helper()
	if err := os.WriteFile(path, []byte("#!/bin/sh\n"), 0o755); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}

func TestBwrapBinaryPrefersExplicitOverride(t *testing.T) {
	dir := t.TempDir()
	override := filepath.Join(dir, "my-bwrap"+exeSuffix())
	writeFile(t, override)
	// A `bin/bwrap` beside the exe must lose to the explicit override.
	exeDir := filepath.Join(dir, "core")
	if err := os.MkdirAll(filepath.Join(exeDir, "bin"), 0o755); err != nil {
		t.Fatal(err)
	}
	writeFile(t, filepath.Join(exeDir, "bin", "bwrap"+exeSuffix()))
	t.Setenv("DSH_CORE_BWRAP", override)

	got, err := bwrapBinary(filepath.Join(exeDir, "dsh-core"+exeSuffix()))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != override {
		t.Fatalf("want %s, got %s", override, got)
	}
}

func TestBwrapBinaryFallsBackToDeployedCopy(t *testing.T) {
	dir := t.TempDir()
	exeDir := filepath.Join(dir, "core")
	if err := os.MkdirAll(filepath.Join(exeDir, "bin"), 0o755); err != nil {
		t.Fatal(err)
	}
	// The deployed copy is a Linux binary named exactly `bwrap` (the core that
	// reads it only ever runs on linux), so the literal name is what to create.
	deployed := filepath.Join(exeDir, "bin", "bwrap")
	writeFile(t, deployed)
	t.Setenv("DSH_CORE_BWRAP", "")
	t.Setenv("PATH", dir) // no bwrap there, so the side-by-side copy must win

	got, err := bwrapBinary(filepath.Join(exeDir, "dsh-core"+exeSuffix()))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != deployed {
		t.Fatalf("want %s, got %s", deployed, got)
	}
}

func TestBwrapBinaryFallsBackToPath(t *testing.T) {
	dir := t.TempDir()
	onPath := filepath.Join(dir, "bwrap"+exeSuffix())
	writeFile(t, onPath)
	t.Setenv("DSH_CORE_BWRAP", "")
	t.Setenv("PATH", dir)
	// exe lives in a directory with no bin/bwrap, so only PATH can satisfy it.
	exeDir := t.TempDir()

	got, err := bwrapBinary(filepath.Join(exeDir, "dsh-core"+exeSuffix()))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != onPath {
		t.Fatalf("want %s, got %s", onPath, got)
	}
}

func TestBwrapBinaryMissingIsActionable(t *testing.T) {
	t.Setenv("DSH_CORE_BWRAP", "")
	t.Setenv("PATH", t.TempDir())
	exeDir := t.TempDir()

	_, err := bwrapBinary(filepath.Join(exeDir, "dsh-core"+exeSuffix()))
	if err == nil {
		t.Fatal("want an error when no bwrap exists")
	}
	text := err.Error()
	if !strings.Contains(text, errSandbox) {
		t.Fatalf("error must carry the %s token, got: %s", errSandbox, text)
	}
	for _, want := range []string{"bubblewrap", "apt-get install", "sandbox mode off"} {
		if !strings.Contains(text, want) {
			t.Fatalf("error must mention %q, got: %s", want, text)
		}
	}
}

func TestBwrapBinaryRejectsUnusableOverride(t *testing.T) {
	t.Setenv("DSH_CORE_BWRAP", filepath.Join(t.TempDir(), "nope"))

	_, err := bwrapBinary(filepath.Join(t.TempDir(), "dsh-core"+exeSuffix()))
	if err == nil {
		t.Fatal("want an error for a missing DSH_CORE_BWRAP target")
	}
	if !strings.Contains(err.Error(), errSandbox) {
		t.Fatalf("error must carry the %s token, got: %s", errSandbox, err.Error())
	}
}
