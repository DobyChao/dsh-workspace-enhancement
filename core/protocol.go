package main

import (
	"encoding/json"
	"fmt"
	"os"
	"runtime"
)

const (
	coreProto           = 1
	coreArtifactVersion = "0.2.1"
	maxFrame            = 16 * 1024 * 1024
	errUnimplemented    = "UNIMPLEMENTED"
	errSandbox          = "SANDBOX_UNAVAILABLE"
	errBadRequest       = "BAD_REQUEST"
	errIO               = "EIO"
	errNotFound         = "ENOENT"
	errPermission       = "EACCES"
	errReadOnly         = "EROFS"
	errExists           = "EEXIST"
	errNotDir           = "ENOTDIR"
	errIsDir            = "EISDIR"
)

var errBadArgv = fmt.Errorf("argv")

type envelope struct {
	Proto int             `json:"proto"`
	ID    int             `json:"id"`
	M     string          `json:"m,omitempty"`
	P     json.RawMessage `json:"p,omitempty"`
	OK    any             `json:"ok,omitempty"`
	Err   *errBody        `json:"err,omitempty"`
}

type errBody struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func printVersion() {
	info, _ := json.Marshal(map[string]any{
		"proto":   coreProto,
		"version": coreArtifactVersion,
		"arch":    goArch(),
		"caps":    []string{"fs", "spawn", "rg"},
	})
	fmt.Printf("%s\n", info)
}

func goArch() string {
	switch runtime.GOARCH {
	case "amd64":
		return "x86_64"
	case "arm64":
		return "aarch64"
	default:
		return runtime.GOARCH
	}
}

func usage() {
	fmt.Fprintf(os.Stderr, "usage: dsh-core serve [--sandbox MODE] [--workspace PATH] [--no-jail]\n       dsh-core version\n")
	os.Exit(2)
}
