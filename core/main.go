package main

import (
	"flag"
	"fmt"
	"os"
	"strings"
)

func main() {
	if len(os.Args) < 2 {
		usage()
	}
	switch os.Args[1] {
	case "version":
		printVersion()
	case "serve":
		fs := flag.NewFlagSet("serve", flag.ExitOnError)
		sandbox := fs.String("sandbox", "off", "read-only | workspace-write | off")
		workspace := fs.String("workspace", "", "absolute POSIX workspace root for workspace-write")
		noJail := fs.Bool("no-jail", false, "skip bwrap re-exec (tests)")
		already := fs.Bool("already-jailed", false, "internal: after bwrap re-exec")
		_ = fs.Parse(os.Args[2:])
		if *already {
			_ = os.Setenv("DSH_CORE_JAILED", "1")
		}
		mode := strings.TrimSpace(*sandbox)
		if mode != "off" && mode != "read-only" && mode != "workspace-write" {
			mode = "off"
		}
		if err := maybeJail(mode, strings.TrimSpace(*workspace), *noJail); err != nil {
			fmt.Fprintf(os.Stderr, "dsh-core: jail: %v\n", err)
			os.Exit(1)
		}
		if err := serve(os.Stdin, os.Stdout, mode, strings.TrimSpace(*workspace)); err != nil {
			fmt.Fprintf(os.Stderr, "dsh-core: %v\n", err)
			os.Exit(1)
		}
	default:
		usage()
	}
}
