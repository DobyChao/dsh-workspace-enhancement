package main

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// fsRealpath matches local dsh-fs-local: EvalSymlinks the path when it exists,
// otherwise realpath the nearest existing ancestor and append the missing suffix
// so official Write can create a new file (GNU realpath -m).
func fsRealpath(path string) (string, error) {
	if path == "" {
		return "", os.ErrNotExist
	}
	real, err := filepath.EvalSymlinks(path)
	if err == nil {
		return slashAbs(real)
	}
	if !errors.Is(err, os.ErrNotExist) {
		return "", err
	}
	missing := []string{filepath.Base(path)}
	ancestor := filepath.Dir(path)
	for {
		realAnc, err := filepath.EvalSymlinks(ancestor)
		if err == nil {
			info, statErr := os.Stat(realAnc)
			if statErr != nil {
				return "", statErr
			}
			if !info.IsDir() {
				return "", fmt.Errorf("not a directory")
			}
			return slashAbs(filepath.Join(append([]string{realAnc}, missing...)...))
		}
		if !errors.Is(err, os.ErrNotExist) {
			return "", err
		}
		parent := filepath.Dir(ancestor)
		if parent == ancestor {
			return slashAbs(path)
		}
		missing = append([]string{filepath.Base(ancestor)}, missing...)
		ancestor = parent
	}
}

func slashAbs(path string) (string, error) {
	if !filepath.IsAbs(path) {
		abs, err := filepath.Abs(path)
		if err != nil {
			return "", err
		}
		path = abs
	}
	return filepath.ToSlash(path), nil
}

type statOK struct {
	Type    string `json:"type"`
	Size    *int64 `json:"size,omitempty"`
	Mode    uint32 `json:"mode"`
	MtimeMs int64  `json:"mtimeMs"`
	Version string `json:"version"`
}

func fsStat(path string, lstat bool) (*statOK, error) {
	var info os.FileInfo
	var err error
	if lstat {
		info, err = os.Lstat(path)
	} else {
		info, err = os.Stat(path)
	}
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, nil
		}
		return nil, err
	}
	return statFromInfo(path, info), nil
}

func statFromInfo(path string, info os.FileInfo) *statOK {
	kind := "other"
	if info.Mode()&os.ModeSymlink != 0 {
		kind = "symlink"
	} else if info.IsDir() {
		kind = "directory"
	} else if info.Mode().IsRegular() {
		kind = "file"
	}
	ok := &statOK{
		Type:    kind,
		Mode:    uint32(info.Mode().Perm()),
		MtimeMs: info.ModTime().UnixMilli(),
		Version: versionOf(path, info.Size(), info.ModTime().UnixMilli()),
	}
	if info.Mode().IsRegular() {
		size := info.Size()
		ok.Size = &size
	}
	return ok
}

func versionOf(path string, size int64, mtimeMs int64) string {
	posix := filepath.ToSlash(path)
	quantized := (mtimeMs / 1000) * 1000
	payload, err := json.Marshal([]any{posix, size, quantized})
	if err != nil {
		return ""
	}
	sum := sha256.Sum256(payload)
	return hex.EncodeToString(sum[:])
}

func fsRead(path string, offset, length int64) ([]byte, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	if length < 0 {
		return io.ReadAll(f)
	}
	if offset > 0 {
		if _, err := f.Seek(offset, io.SeekStart); err != nil {
			return nil, err
		}
	}
	buf := make([]byte, length)
	n, err := io.ReadFull(f, buf)
	if err != nil && !errors.Is(err, io.ErrUnexpectedEOF) && !errors.Is(err, io.EOF) {
		return nil, err
	}
	return buf[:n], nil
}

type listEntry struct {
	Name    string `json:"name"`
	Type    string `json:"type"`
	Size    *int64 `json:"size,omitempty"`
	Version string `json:"version"`
}

func fsListDir(path string) ([]listEntry, error) {
	entries, err := os.ReadDir(path)
	if err != nil {
		return nil, err
	}
	out := make([]listEntry, 0, len(entries))
	for _, entry := range entries {
		info, err := entry.Info()
		if err != nil {
			continue
		}
		st := statFromInfo(filepath.Join(path, entry.Name()), info)
		item := listEntry{Name: entry.Name(), Type: st.Type, Version: st.Version, Size: st.Size}
		out = append(out, item)
	}
	return out, nil
}

func fsWrite(path string, data []byte, createIfAbsent bool) (*statOK, error) {
	if createIfAbsent {
		_, err := os.Lstat(path)
		if err == nil {
			return nil, errExistsSentinel
		}
		if !errors.Is(err, os.ErrNotExist) {
			return nil, err
		}
	}
	dir := filepath.Dir(path)
	tmp := filepath.Join(dir, ".dsh-core-"+nonce())
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return nil, err
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return nil, err
	}
	info, err := os.Stat(path)
	if err != nil {
		return nil, err
	}
	return statFromInfo(path, info), nil
}

func fsMkdir(path string) error {
	err := os.Mkdir(path, 0o755)
	if err != nil {
		return err
	}
	return nil
}

var errExistsSentinel = errors.New("exists")

func nonce() string {
	var b [8]byte
	_, _ = rand.Read(b[:])
	return hex.EncodeToString(b[:])
}

func mapFSError(err error) (code, message string) {
	if err == nil {
		return errIO, "unknown"
	}
	if errors.Is(err, errExistsSentinel) {
		return errExists, err.Error()
	}
	if errors.Is(err, os.ErrNotExist) {
		return errNotFound, err.Error()
	}
	if errors.Is(err, os.ErrPermission) {
		return errPermission, err.Error()
	}
	if isROFS(err) {
		return errReadOnly, err.Error()
	}
	if isNotDir(err) {
		return errNotDir, err.Error()
	}
	return errIO, err.Error()
}

func isROFS(err error) bool {
	text := strings.ToLower(err.Error())
	return strings.Contains(text, "read-only file system") || strings.Contains(text, "erofs")
}

func isNotDir(err error) bool {
	text := strings.ToLower(err.Error())
	return strings.Contains(text, "not a directory") || strings.Contains(text, "enotdir")
}
