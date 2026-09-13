package main

import (
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"strings"
	"sync"
)

type server struct {
	w        io.Writer
	mu       sync.Mutex
	sandbox  string
	workspace string
	spawn    *spawnHub
}

func serve(r io.Reader, w io.Writer, sandbox, workspace string) error {
	s := &server{w: w, sandbox: sandbox, workspace: workspace}
	s.spawn = newSpawnHub(exeBinDir(), func(_ string, method string, payload any) {
		_ = s.writeEvent(method, payload)
	})
	buf := make([]byte, 0, 64*1024)
	tmp := make([]byte, 32*1024)
	for {
		n, err := r.Read(tmp)
		if n > 0 {
			buf = append(buf, tmp[:n]...)
			for {
				msg, rest, ok, ferr := takeFrame(buf)
				if ferr != nil {
					return ferr
				}
				if !ok {
					break
				}
				buf = rest
				s.handle(msg)
			}
		}
		if err != nil {
			if err == io.EOF {
				return nil
			}
			return err
		}
	}
}

func takeFrame(buf []byte) (envelope, []byte, bool, error) {
	if len(buf) < 4 {
		return envelope{}, buf, false, nil
	}
	size := binary.BigEndian.Uint32(buf[:4])
	if size > maxFrame {
		return envelope{}, buf, false, fmt.Errorf("frame too large: %d", size)
	}
	if len(buf) < int(4+size) {
		return envelope{}, buf, false, nil
	}
	var msg envelope
	if err := json.Unmarshal(buf[4:4+size], &msg); err != nil {
		return envelope{}, buf[4+size:], true, nil
	}
	return msg, buf[4+size:], true, nil
}

func (s *server) handle(msg envelope) {
	if msg.M == "" {
		s.writeErr(msg.ID, errUnimplemented, "missing method")
		return
	}
	ok, code, err := s.dispatch(msg.M, msg.P)
	if err != nil {
		if code == "" {
			code = errIO
		}
		s.writeErr(msg.ID, code, err.Error())
		return
	}
	s.writeOK(msg.ID, ok)
}

func (s *server) dispatch(method string, raw json.RawMessage) (any, string, error) {
	switch method {
	case "hello":
		return map[string]any{
			"proto":   coreProto,
			"version": coreArtifactVersion,
			"arch":    goArch(),
			"caps":    []string{"fs", "spawn", "rg"},
			"sandbox": s.sandbox,
		}, "", nil
	case "fs.realpath":
		path, err := strField(raw, "path")
		if err != nil {
			return nil, errBadRequest, err
		}
		real, err := fsRealpath(nativePath(path))
		if err != nil {
			c, m := mapFSError(err)
			return nil, c, fmt.Errorf("%s", m)
		}
		return map[string]any{"path": slashPath(real)}, "", nil
	case "fs.stat", "fs.lstat":
		path, err := strField(raw, "path")
		if err != nil {
			return nil, errBadRequest, err
		}
		st, err := fsStat(nativePath(path), method == "fs.lstat")
		if err != nil {
			c, m := mapFSError(err)
			return nil, c, fmt.Errorf("%s", m)
		}
		return st, "", nil
	case "fs.read":
		path, err := strField(raw, "path")
		if err != nil {
			return nil, errBadRequest, err
		}
		data, err := fsRead(nativePath(path), 0, -1)
		if err != nil {
			c, m := mapFSError(err)
			return nil, c, fmt.Errorf("%s", m)
		}
		return map[string]any{"b64": base64.StdEncoding.EncodeToString(data)}, "", nil
	case "fs.readRange":
		path, err := strField(raw, "path")
		if err != nil {
			return nil, errBadRequest, err
		}
		offset := intField(raw, "offset")
		length := intField(raw, "length")
		if length == 0 {
			return map[string]any{"b64": ""}, "", nil
		}
		data, err := fsRead(nativePath(path), offset, length)
		if err != nil {
			c, m := mapFSError(err)
			return nil, c, fmt.Errorf("%s", m)
		}
		return map[string]any{"b64": base64.StdEncoding.EncodeToString(data)}, "", nil
	case "fs.listDir":
		path, err := strField(raw, "path")
		if err != nil {
			return nil, errBadRequest, err
		}
		entries, err := fsListDir(nativePath(path))
		if err != nil {
			c, m := mapFSError(err)
			return nil, c, fmt.Errorf("%s", m)
		}
		return map[string]any{"entries": entries}, "", nil
	case "fs.write":
		path, err := strField(raw, "path")
		if err != nil {
			return nil, errBadRequest, err
		}
		if !s.canWrite(path) {
			return nil, errReadOnly, fmt.Errorf("read-only file system")
		}
		b64, _ := strField(raw, "b64")
		data, err := base64.StdEncoding.DecodeString(b64)
		if err != nil {
			return nil, errBadRequest, err
		}
		createIfAbsent := boolField(raw, "createIfAbsent")
		st, err := fsWrite(nativePath(path), data, createIfAbsent)
		if err != nil {
			c, m := mapFSError(err)
			return nil, c, fmt.Errorf("%s", m)
		}
		return st, "", nil
	case "fs.mkdir":
		path, err := strField(raw, "path")
		if err != nil {
			return nil, errBadRequest, err
		}
		if !s.canWrite(path) {
			return nil, errReadOnly, fmt.Errorf("read-only file system")
		}
		if err := fsMkdir(nativePath(path)); err != nil {
			c, m := mapFSError(err)
			return nil, c, fmt.Errorf("%s", m)
		}
		return map[string]any{"path": path}, "", nil
	case "spawn.start":
		argv := stringSliceField(raw, "argv")
		cwd, _ := strField(raw, "cwd")
		job, err := s.spawn.start(argv, nativePath(cwd), stringMapField(raw, "env"))
		if err != nil {
			return nil, errIO, err
		}
		return map[string]any{"job": job}, "", nil
	case "spawn.stdin":
		job, _ := strField(raw, "job")
		b64, _ := strField(raw, "b64")
		data, err := base64.StdEncoding.DecodeString(b64)
		if err != nil {
			return nil, errBadRequest, err
		}
		s.spawn.stdin(job, data)
		return map[string]any{}, "", nil
	case "spawn.terminate":
		job, _ := strField(raw, "job")
		s.spawn.terminate(job)
		return map[string]any{}, "", nil
	default:
		return nil, errUnimplemented, fmt.Errorf("unimplemented %s", method)
	}
}

func (s *server) canWrite(posixPath string) bool {
	if s.sandbox == "off" {
		return true
	}
	if s.sandbox == "read-only" {
		return false
	}
	return posixInside(s.workspace, posixPath)
}

// posixInside reports whether target is the workspace root or a descendant.
// Slash-separated on purpose (the wire paths are POSIX); filepath.Rel on
// Windows would treat ".." prefixes incorrectly for this check, which is how
// `/tmp/x` leaked through a workspace at `/home/uuz/ws` during WSL UAT.
func posixInside(workspace, target string) bool {
	ws := path.Clean(workspace)
	if ws == "" || ws == "." {
		return false
	}
	got := path.Clean(target)
	if got == ws {
		return true
	}
	prefix := ws
	if !strings.HasSuffix(prefix, "/") {
		prefix += "/"
	}
	return strings.HasPrefix(got, prefix)
}

func (s *server) writeOK(id int, ok any) {
	s.write(envelope{Proto: coreProto, ID: id, OK: ok})
}

func (s *server) writeErr(id int, code, message string) {
	s.write(envelope{Proto: coreProto, ID: id, Err: &errBody{Code: code, Message: message}})
}

func (s *server) writeEvent(method string, payload any) error {
	raw, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	return s.write(envelope{Proto: coreProto, ID: 0, M: method, P: raw})
}

func (s *server) write(msg envelope) error {
	body, err := json.Marshal(msg)
	if err != nil {
		return err
	}
	if len(body) > maxFrame {
		return fmt.Errorf("frame too large")
	}
	hdr := make([]byte, 4)
	binary.BigEndian.PutUint32(hdr, uint32(len(body)))
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, err := s.w.Write(hdr); err != nil {
		return err
	}
	_, err = s.w.Write(body)
	return err
}

func strField(raw json.RawMessage, key string) (string, error) {
	var obj map[string]any
	if err := json.Unmarshal(raw, &obj); err != nil {
		return "", err
	}
	v, ok := obj[key].(string)
	if !ok || v == "" {
		return "", fmt.Errorf("missing %s", key)
	}
	return v, nil
}

func intField(raw json.RawMessage, key string) int64 {
	var obj map[string]any
	if err := json.Unmarshal(raw, &obj); err != nil {
		return 0
	}
	switch n := obj[key].(type) {
	case float64:
		return int64(n)
	default:
		return 0
	}
}

func boolField(raw json.RawMessage, key string) bool {
	var obj map[string]any
	if err := json.Unmarshal(raw, &obj); err != nil {
		return false
	}
	b, _ := obj[key].(bool)
	return b
}

func stringMapField(raw json.RawMessage, key string) map[string]string {
	var obj map[string]any
	if err := json.Unmarshal(raw, &obj); err != nil {
		return nil
	}
	rawMap, ok := obj[key].(map[string]any)
	if !ok {
		return nil
	}
	out := make(map[string]string, len(rawMap))
	for k, v := range rawMap {
		s, ok := v.(string)
		if ok {
			out[k] = s
		}
	}
	return out
}

func stringSliceField(raw json.RawMessage, key string) []string {
	var obj map[string]any
	if err := json.Unmarshal(raw, &obj); err != nil {
		return nil
	}
	arr, ok := obj[key].([]any)
	if !ok {
		return nil
	}
	out := make([]string, 0, len(arr))
	for _, v := range arr {
		s, ok := v.(string)
		if ok {
			out = append(out, s)
		}
	}
	return out
}

func nativePath(posix string) string {
	if posix == "" {
		return posix
	}
	return filepath.FromSlash(posix)
}

func slashPath(native string) string {
	s := filepath.ToSlash(native)
	if os.PathSeparator == '\\' && len(s) >= 2 && s[1] == ':' {
		return s
	}
	if s != "" && s[0] != '/' {
		return "/" + s
	}
	return s
}
