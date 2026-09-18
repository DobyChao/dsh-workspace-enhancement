package main

import (
	"encoding/base64"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
)

type spawnProc struct {
	cmd   *exec.Cmd
	stdin io.WriteCloser
}

type spawnHub struct {
	mu      sync.Mutex
	next    atomic.Int64
	procs   map[string]*spawnProc
	binDir  string
	writeEv func(job, method string, payload any)
}

func newSpawnHub(binDir string, writeEv func(job, method string, payload any)) *spawnHub {
	return &spawnHub{procs: map[string]*spawnProc{}, binDir: binDir, writeEv: writeEv}
}

func (h *spawnHub) start(argv []string, cwd string, env map[string]string) (string, error) {
	if len(argv) == 0 {
		return "", errBadArgv
	}
	job := itoa(h.next.Add(1))
	file := resolveSpawnFile(h.binDir, argv[0])
	cmd := exec.Command(file, argv[1:]...)
	if cwd != "" {
		cmd.Dir = cwd
	}
	cmd.Env = os.Environ()
	if h.binDir != "" {
		replaced := false
		for i, e := range cmd.Env {
			if strings.HasPrefix(e, "PATH=") {
				cmd.Env[i] = "PATH=" + h.binDir + string(os.PathListSeparator) + strings.TrimPrefix(e, "PATH=")
				replaced = true
				break
			}
		}
		if !replaced {
			cmd.Env = append(cmd.Env, "PATH="+h.binDir)
		}
	}
	for k, v := range env {
		cmd.Env = append(cmd.Env, k+"="+v)
	}
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return "", err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return "", err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return "", err
	}
	// BUG-9: the child becomes its own process-group leader, so terminate can
	// kill the WHOLE group. Without this, kill(pid) only removes the direct
	// child (the shell) and the user's actual task survives server-side.
	setProcessGroup(cmd)
	if err := cmd.Start(); err != nil {
		return "", err
	}
	h.mu.Lock()
	h.procs[job] = &spawnProc{cmd: cmd, stdin: stdin}
	h.mu.Unlock()
	go h.pump(job, "spawn.stdout", stdout)
	go h.pump(job, "spawn.stderr", stderr)
	go func() {
		waitErr := cmd.Wait()
		exit := 0
		if waitErr != nil {
			if ee, ok := waitErr.(*exec.ExitError); ok {
				exit = ee.ExitCode()
			} else {
				exit = 1
			}
		}
		h.mu.Lock()
		delete(h.procs, job)
		h.mu.Unlock()
		h.writeEv(job, "spawn.exit", map[string]any{"job": job, "exitCode": exit, "signal": nil})
	}()
	return job, nil
}

func (h *spawnHub) pump(job, method string, r io.Reader) {
	buf := make([]byte, 32*1024)
	for {
		n, err := r.Read(buf)
		if n > 0 {
			h.writeEv(job, method, map[string]any{
				"job": job,
				"b64": base64.StdEncoding.EncodeToString(buf[:n]),
			})
		}
		if err != nil {
			return
		}
	}
}

func (h *spawnHub) terminate(job string) {
	h.mu.Lock()
	p := h.procs[job]
	h.mu.Unlock()
	if p == nil || p.cmd == nil || p.cmd.Process == nil {
		return
	}
	// BUG-9: kill the process GROUP first (argv is usually a shell — its
	// children are the real task); fall back to the direct child only when a
	// group kill is impossible (non-unix build) or fails.
	if !killProcessGroup(p.cmd.Process.Pid) {
		_ = p.cmd.Process.Kill()
	}
}

func (h *spawnHub) stdin(job string, data []byte) {
	h.mu.Lock()
	p := h.procs[job]
	h.mu.Unlock()
	if p != nil && p.stdin != nil && len(data) > 0 {
		_, _ = p.stdin.Write(data)
	}
}

func exeBinDir() string {
	exe, err := os.Executable()
	if err != nil {
		return ""
	}
	return filepath.Join(filepath.Dir(exe), "bin")
}

// resolveSpawnFile prefers a same-named file in the bundled bin/ directory.
// exec.Command's LookPath uses the parent process PATH, not cmd.Env, so PATH
// prepend alone would miss bundled rg/bwrap.
func resolveSpawnFile(binDir, file string) string {
	if binDir == "" || strings.ContainsAny(file, `/\`) {
		return file
	}
	candidate := filepath.Join(binDir, file)
	if _, err := os.Stat(candidate); err == nil {
		return candidate
	}
	return file
}

func itoa(n int64) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var b [20]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		b[i] = '-'
	}
	return string(b[i:])
}
