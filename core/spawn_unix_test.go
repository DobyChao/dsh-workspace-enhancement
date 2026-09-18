//go:build unix

package main

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"
)

// countLiveGroupMembers scans /proc for non-zombie processes whose process
// group is pgid. Linux-only by construction (the test skips elsewhere).
func countLiveGroupMembers(pgid int) int {
	entries, err := os.ReadDir("/proc")
	if err != nil {
		return -1
	}
	members := 0
	for _, entry := range entries {
		raw, err := os.ReadFile(filepath.Join("/proc", entry.Name(), "stat"))
		if err != nil {
			continue // raced with exit
		}
		text := string(raw)
		// stat fields sit after ") "; field 5 (1-based) is pgrp.
		rest := text[strings.LastIndexByte(text, ')')+1:]
		fields := strings.Fields(rest)
		if len(fields) < 4 {
			continue
		}
		state := fields[0]
		pgrp, err := strconv.Atoi(fields[2])
		if err != nil || pgrp != pgid {
			continue
		}
		if state != "Z" {
			members++
		}
	}
	return members
}

func groupMembersReach(target int, want int, timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if countLiveGroupMembers(target) >= want {
			return true
		}
		time.Sleep(20 * time.Millisecond)
	}
	return false
}

// TestSpawnTerminateKillsWholeGroup is the BUG-9 regression: the spawned
// shell's children must die with it. Without Setpgid + kill(-pgid) the two
// sleeps survive terminate() as orphans in the hub's own group.
func TestSpawnTerminateKillsWholeGroup(t *testing.T) {
	if _, err := os.Stat("/proc/self/stat"); err != nil {
		t.Skip("no /proc — process-group semantics verified on linux only")
	}
	var mu sync.Mutex
	exited := map[string]bool{}
	h := newSpawnHub("", func(job, method string, payload any) {
		if method == "spawn.exit" {
			mu.Lock()
			exited[job] = true
			mu.Unlock()
		}
	})
	job, err := h.start([]string{"sh", "-c", "sleep 30 & sleep 30"}, "", nil)
	if err != nil {
		t.Fatalf("start: %v", err)
	}
	h.mu.Lock()
	proc := h.procs[job]
	h.mu.Unlock()
	if proc == nil || proc.cmd.Process == nil {
		t.Fatal("no spawned process")
	}
	pgid := proc.cmd.Process.Pid // Setpgid ⇒ leader pid == pgid
	// Wait until the shell AND both sleeps are in the group, so the assertion
	// below cannot pass merely because the children had not started yet.
	if !groupMembersReach(pgid, 3, 5*time.Second) {
		t.Fatalf("group never reached 3 members (pgid %d, live=%d)", pgid, countLiveGroupMembers(pgid))
	}
	h.terminate(job)
	// The shell is gone (spawn.exit fired and the hub forgot the job)…
	if !waitFor(func() bool {
		h.mu.Lock()
		_, still := h.procs[job]
		h.mu.Unlock()
		return !still
	}, 5*time.Second) {
		t.Fatal("spawned shell did not exit after terminate")
	}
	// …and the whole group is empty: no orphaned sleep left on the host.
	if !waitFor(func() bool { return countLiveGroupMembers(pgid) == 0 }, 5*time.Second) {
		t.Fatalf("group residue after terminate: %d live member(s) in pgid %d", countLiveGroupMembers(pgid), pgid)
	}
	mu.Lock()
	sawExit := exited[job]
	mu.Unlock()
	if !sawExit {
		t.Fatal("spawn.exit event missing")
	}
}

func waitFor(cond func() bool, timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if cond() {
			return true
		}
		time.Sleep(20 * time.Millisecond)
	}
	return cond()
}

// TestSpawnStartSetsProcessGroup pins the Setpgid half of BUG-9 on any unix
// build, including ones without a readable /proc layout.
func TestSpawnStartSetsProcessGroup(t *testing.T) {
	h := newSpawnHub("", func(string, string, any) {})
	job, err := h.start([]string{"sh", "-c", "exit 0"}, "", nil)
	if err != nil {
		t.Fatalf("start: %v", err)
	}
	h.mu.Lock()
	proc := h.procs[job]
	h.mu.Unlock()
	if proc == nil || proc.cmd.Process == nil {
		t.Fatal("no spawned process")
	}
	pgid, err := syscall.Getpgid(proc.cmd.Process.Pid)
	if err != nil {
		t.Fatalf("getpgid: %v", err)
	}
	if pgid != proc.cmd.Process.Pid {
		t.Fatalf("child is not a group leader: pid %d pgid %d", proc.cmd.Process.Pid, pgid)
	}
	h.terminate(job)
}
