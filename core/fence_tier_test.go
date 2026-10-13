package main

// REQ-I29 tier-decision table: every probe combination resolves to the tier
// the operator guidance will claim, and the honesty notes never overstate
// what a Landlock tier provides.

import (
	"errors"
	"strings"
	"testing"
)

func fakeProbes(pathErr error, probeErr error, abi int, forced string) fenceProbes {
	return fenceProbes{
		bwrapPath:   func() (string, error) { return "/usr/bin/bwrap", pathErr },
		bwrapUsable: func(string) error { return probeErr },
		landlockABI: func() int { return abi },
		forcedTier:  forced,
	}
}

func TestDecideFenceTierBwrapHappyPath(t *testing.T) {
	info := decideFenceTier(fakeProbes(nil, nil, 5, ""), "read-only")
	if info.Tier != tierBwrap {
		t.Fatalf("tier = %q, want bwrap", info.Tier)
	}
	if info.BwrapPath != "/usr/bin/bwrap" || info.BwrapMissing || info.BwrapProbeErr != "" {
		t.Fatalf("unexpected bwrap fields: %+v", info)
	}
	if len(info.Notes) != 0 {
		t.Fatalf("usable bwrap needs no notes, got %v", info.Notes)
	}
}

func TestDecideFenceTierUnusableBwrapFallsToLandlock(t *testing.T) {
	// The Docker signature: present, resolves, cannot create a namespace.
	info := decideFenceTier(fakeProbes(nil, errors.New("exit 1 under the read-only profile"), 3, ""), "read-only")
	if info.Tier != tierLandlock {
		t.Fatalf("tier = %q, want landlock", info.Tier)
	}
	if info.BwrapProbeErr == "" || info.BwrapMissing {
		t.Fatalf("probe failure must be recorded, not masked: %+v", info)
	}
	joined := strings.Join(info.Notes, "\n")
	for _, want := range []string{
		"no mount isolation",          // the honest capability gap
		"fell back from bwrap (exit",   // why the preferred tier was dropped
	} {
		if !strings.Contains(joined, want) {
			t.Fatalf("notes missing %q: %v", want, info.Notes)
		}
	}
}

func TestDecideFenceTierMissingBwrapFallsToLandlock(t *testing.T) {
	info := decideFenceTier(fakeProbes(errors.New("no bubblewrap on this host"), nil, 1, ""), "workspace-write")
	if info.Tier != tierLandlock {
		t.Fatalf("tier = %q, want landlock", info.Tier)
	}
	if !info.BwrapMissing {
		t.Fatalf("missing must be flagged: %+v", info)
	}
	joined := strings.Join(info.Notes, "\n")
	if !strings.Contains(joined, "/tmp is writable but SHARED") {
		t.Fatalf("workspace-write must disclose the shared-/tmp difference: %v", info.Notes)
	}
	if !strings.Contains(joined, "ABI <3") || !strings.Contains(joined, "ABI 1") {
		t.Fatalf("abi 1 partial enforcement must be disclosed: %v", info.Notes)
	}
}

func TestDecideFenceTierNoneNamesEveryWayOut(t *testing.T) {
	info := decideFenceTier(fakeProbes(errors.New("no bubblewrap on this host"), nil, 0, ""), "read-only")
	if info.Tier != tierNone {
		t.Fatalf("tier = %q, want none", info.Tier)
	}
	refusal := info.refusal("read-only")
	for _, want := range []string{
		"bubblewrap is not installed",
		"apt-get install bubblewrap",
		"Landlock",
		"sandbox mode off",
	} {
		if !strings.Contains(refusal, want) {
			t.Fatalf("refusal missing %q: %s", want, refusal)
		}
	}
}

func TestDecideFenceTierNoneAfterProbeFailureNamesTheCause(t *testing.T) {
	info := decideFenceTier(fakeProbes(nil, errors.New("bwrap: Setting up uid map failed: Operation not permitted"), 0, ""), "read-only")
	refusal := info.refusal("read-only")
	if !strings.Contains(refusal, "installed but unusable") {
		t.Fatalf("probe failure must be the named cause: %s", refusal)
	}
	if !strings.Contains(refusal, "Operation not permitted") {
		t.Fatalf("the raw cause must survive into the refusal: %s", refusal)
	}
}

func TestDecideFenceTierForcedLandlockOverridesViableBwrap(t *testing.T) {
	info := decideFenceTier(fakeProbes(nil, nil, 5, "landlock"), "read-only")
	if info.Tier != tierLandlock {
		t.Fatalf("tier = %q, want landlock (forced)", info.Tier)
	}
	if info.LandlockABI != 5 {
		t.Fatalf("ABI must be reported even on the bwrap-happy path: %+v", info)
	}
	joined := strings.Join(info.Notes, "\n")
	if !strings.Contains(joined, "operator's explicit demand") {
		t.Fatalf("forced-over-bwrap note missing: %v", info.Notes)
	}
}

func TestDecideFenceTierForcedNone(t *testing.T) {
	info := decideFenceTier(fakeProbes(nil, nil, 5, "none"), "read-only")
	if info.Tier != tierNone {
		t.Fatalf("tier = %q, want none (forced)", info.Tier)
	}
	if !strings.Contains(strings.Join(info.Notes, "\n"), "explicit request") {
		t.Fatalf("forced-none note missing: %v", info.Notes)
	}
	// The refusal must blame the override, not lie about a kernel that
	// demonstrably has both tiers.
	refusal := info.refusal("read-only")
	if !strings.Contains(refusal, "DSH_CORE_FENCE_TIER=none disabled the fence") {
		t.Fatalf("forced-none refusal must name the override: %s", refusal)
	}
	if strings.Contains(refusal, "kernel does not expose Landlock") {
		t.Fatalf("forced-none refusal must not claim the kernel lacks Landlock (abi 5 present): %s", refusal)
	}
}

func TestDecideFenceTierForcedBwrapOverridesFailedProbe(t *testing.T) {
	info := decideFenceTier(fakeProbes(nil, errors.New("exit 1 under the read-only profile"), 3, "bwrap"), "read-only")
	if info.Tier != tierBwrap {
		t.Fatalf("tier = %q, want bwrap (forced despite probe)", info.Tier)
	}
	joined := strings.Join(info.Notes, "\n")
	if !strings.Contains(joined, "overrides a failed usability probe") {
		t.Fatalf("forced-despite-probe note missing: %v", info.Notes)
	}
}

func TestDecideFenceTierForcedNotViableRefuses(t *testing.T) {
	// A forced tier that the host cannot honor must NEVER be assumed — the
	// decision says none and the note says why.
	info := decideFenceTier(fakeProbes(errors.New("missing"), nil, 0, "landlock"), "read-only")
	if info.Tier != tierNone {
		t.Fatalf("tier = %q, want none (forced but not viable)", info.Tier)
	}
	if !strings.Contains(strings.Join(info.Notes, "\n"), "refusing rather than assuming") {
		t.Fatalf("forced-not-viable note missing: %v", info.Notes)
	}
}

func TestLandlockTierNotesHonesty(t *testing.T) {
	if got := landlockTierNotes(3, "read-only"); len(got) != 1 {
		t.Fatalf("abi 3 read-only should carry only the mount-isolation note, got %v", got)
	}
	joined := strings.Join(landlockTierNotes(2, "workspace-write"), "\n")
	if strings.Contains(joined, "ABI 1") {
		t.Fatalf("abi 2 must not claim abi-1 refer gap: %s", joined)
	}
	if !strings.Contains(joined, "ABI <3") {
		t.Fatalf("abi 2 must disclose the truncate gap: %s", joined)
	}
}
