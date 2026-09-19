package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"testing"
)

func TestVersionOfMatchesJSTuple(t *testing.T) {
	got := versionOf("/home/u/proj/a.txt", 12, 1_725_000_000_123)
	payload, err := json.Marshal([]any{"/home/u/proj/a.txt", int64(12), int64(1_725_000_000_000)})
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(payload)
	want := hex.EncodeToString(sum[:])
	if got != want {
		t.Fatalf("versionOf = %s, want %s (payload %s)", got, want, payload)
	}
}
