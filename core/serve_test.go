package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestGoldenHelloRequestJSON(t *testing.T) {
	frame := mustFrame(envelope{Proto: 1, ID: 1, M: "hello", P: json.RawMessage(`{}`)})
	got := string(frame[4:])
	want := `{"proto":1,"id":1,"m":"hello","p":{}}`
	if got != want {
		t.Fatalf("golden hello JSON: got %s want %s", got, want)
	}
}

func TestResolveSpawnFilePrefersBundledBin(t *testing.T) {
	dir := t.TempDir()
	bin := filepath.Join(dir, "bin")
	if err := os.Mkdir(bin, 0o755); err != nil {
		t.Fatal(err)
	}
	rg := filepath.Join(bin, "rg")
	if err := os.WriteFile(rg, []byte("x"), 0o755); err != nil {
		t.Fatal(err)
	}
	got := resolveSpawnFile(bin, "rg")
	if got != rg {
		t.Fatalf("got %q want %q", got, rg)
	}
	if resolveSpawnFile(bin, "/usr/bin/rg") != "/usr/bin/rg" {
		t.Fatal("absolute path must pass through")
	}
}

func TestProfileJSONMatchesExpectedTokens(t *testing.T) {
	var profile bwrapProfile
	if err := json.Unmarshal(profileJSON, &profile); err != nil {
		t.Fatal(err)
	}
	wantRO := []string{"--ro-bind", "/", "/", "--dev", "/dev", "--unshare-pid", "--proc", "/proc", "--die-with-parent"}
	if len(profile.ReadOnly) != len(wantRO) {
		t.Fatalf("readOnly len %d want %d", len(profile.ReadOnly), len(wantRO))
	}
	for i := range wantRO {
		if profile.ReadOnly[i] != wantRO[i] {
			t.Fatalf("readOnly[%d]=%q want %q", i, profile.ReadOnly[i], wantRO[i])
		}
	}
	if len(profile.WorkspaceWriteExtra) != 2 || profile.WorkspaceWriteExtra[0] != "--tmpfs" {
		t.Fatalf("workspace extra: %#v", profile.WorkspaceWriteExtra)
	}
}

func TestFsWriteAndRead(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "a.txt")
	st, err := fsWrite(path, []byte("hello"), true)
	if err != nil {
		t.Fatal(err)
	}
	if st == nil || st.Type != "file" {
		t.Fatalf("stat %+v", st)
	}
	got, err := fsRead(path, 0, -1)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "hello" {
		t.Fatalf("got %q", got)
	}
}

func TestFsRealpathMissingLeaf(t *testing.T) {
	dir := t.TempDir()
	realDir, err := filepath.EvalSymlinks(dir)
	if err != nil {
		t.Fatal(err)
	}
	missing := filepath.Join(dir, "new.txt")
	got, err := fsRealpath(missing)
	if err != nil {
		t.Fatal(err)
	}
	want, err := slashAbs(filepath.Join(realDir, "new.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Fatalf("got %q want %q", got, want)
	}
}

func TestFsCreateIfAbsent(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "a.txt")
	if _, err := fsWrite(path, []byte("a"), true); err != nil {
		t.Fatal(err)
	}
	if _, err := fsWrite(path, []byte("b"), true); err == nil {
		t.Fatal("expected exists")
	}
}

func TestServeHello(t *testing.T) {
	r, wIn, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	rOut, wOut, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { done <- serve(r, wOut, "read-only", "") }()
	frame := mustFrame(envelope{Proto: 1, ID: 1, M: "hello", P: json.RawMessage(`{}`)})
	if _, err := wIn.Write(frame); err != nil {
		t.Fatal(err)
	}
	_ = wIn.Close()
	msg, err := readOne(rOut)
	if err != nil {
		t.Fatal(err)
	}
	if msg.Err != nil {
		t.Fatalf("err %+v", msg.Err)
	}
	raw, _ := json.Marshal(msg.OK)
	var hello struct {
		Proto   int      `json:"proto"`
		Version string   `json:"version"`
		Caps    []string `json:"caps"`
	}
	if err := json.Unmarshal(raw, &hello); err != nil {
		t.Fatal(err)
	}
	if hello.Proto != 1 || hello.Version != coreArtifactVersion {
		t.Fatalf("hello %+v", hello)
	}
	_ = wOut.Close()
	<-done
}

func TestServeUnknownMethod(t *testing.T) {
	r, wIn, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	rOut, wOut, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { done <- serve(r, wOut, "off", "") }()
	frame := mustFrame(envelope{Proto: 1, ID: 7, M: "pty.start", P: json.RawMessage(`{}`)})
	if _, err := wIn.Write(frame); err != nil {
		t.Fatal(err)
	}
	_ = wIn.Close()
	msg, err := readOne(rOut)
	if err != nil {
		t.Fatal(err)
	}
	if msg.Err == nil || msg.Err.Code != errUnimplemented {
		t.Fatalf("want UNIMPLEMENTED got %+v", msg.Err)
	}
	_ = wOut.Close()
	<-done
}

func TestCanWriteWorkspaceBounds(t *testing.T) {
	s := &server{sandbox: "workspace-write", workspace: "/home/uuz/dsh-i5-ws"}
	allow := []string{
		"/home/uuz/dsh-i5-ws",
		"/home/uuz/dsh-i5-ws/",
		"/home/uuz/dsh-i5-ws/inside.txt",
		"/home/uuz/dsh-i5-ws/sub/a.txt",
	}
	deny := []string{
		"/tmp/dsh-i5-ww.txt",
		"/tmp/dsh-i5-out",
		"/home/uuz/other.txt",
		"/home/uuz/dsh-i5-ws-evil/x",
		"/etc/passwd",
		"/",
		"",
	}
	for _, p := range allow {
		if !s.canWrite(p) {
			t.Fatalf("want allow %q", p)
		}
	}
	for _, p := range deny {
		if s.canWrite(p) {
			t.Fatalf("want deny %q", p)
		}
	}
	ro := &server{sandbox: "read-only", workspace: "/home/uuz/dsh-i5-ws"}
	if ro.canWrite("/home/uuz/dsh-i5-ws/inside.txt") {
		t.Fatal("read-only must deny the workspace too")
	}
}

func TestServeReadOnlyWrite(t *testing.T) {
	r, wIn, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	rOut, wOut, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { done <- serve(r, wOut, "read-only", "") }()
	frame := mustFrame(envelope{Proto: 1, ID: 3, M: "fs.write", P: json.RawMessage(`{"path":"/tmp/x","b64":"YQ=="}`)})
	if _, err := wIn.Write(frame); err != nil {
		t.Fatal(err)
	}
	_ = wIn.Close()
	msg, err := readOne(rOut)
	if err != nil {
		t.Fatal(err)
	}
	if msg.Err == nil || msg.Err.Code != errReadOnly {
		t.Fatalf("want EROFS got %+v", msg.Err)
	}
	_ = wOut.Close()
	<-done
}

func mustFrame(msg envelope) []byte {
	body, err := json.Marshal(msg)
	if err != nil {
		panic(err)
	}
	hdr := []byte{0, 0, 0, 0}
	hdr[0] = byte(len(body) >> 24)
	hdr[1] = byte(len(body) >> 16)
	hdr[2] = byte(len(body) >> 8)
	hdr[3] = byte(len(body))
	return append(hdr, body...)
}

func readOne(r ioLike) (envelope, error) {
	hdr := make([]byte, 4)
	if _, err := ioReadFull(r, hdr); err != nil {
		return envelope{}, err
	}
	size := int(hdr[0])<<24 | int(hdr[1])<<16 | int(hdr[2])<<8 | int(hdr[3])
	body := make([]byte, size)
	if _, err := ioReadFull(r, body); err != nil {
		return envelope{}, err
	}
	var msg envelope
	if err := json.Unmarshal(body, &msg); err != nil {
		return envelope{}, err
	}
	return msg, nil
}

type ioLike interface {
	Read([]byte) (int, error)
}

func ioReadFull(r ioLike, buf []byte) (int, error) {
	n := 0
	for n < len(buf) {
		got, err := r.Read(buf[n:])
		n += got
		if err != nil {
			return n, err
		}
	}
	return n, nil
}
