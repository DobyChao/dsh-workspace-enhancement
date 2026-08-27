# dsh-workspace-enhancement

English | [中文](README.zh.md)

![npm version](https://img.shields.io/npm/v/dsh-workspace-enhancement) ![license](https://img.shields.io/npm/l/dsh-workspace-enhancement) ![node version](https://img.shields.io/badge/node-%3E%3D22-339933) ![dsh-plugin](https://img.shields.io/badge/dsh-plugin-2ea44f)

**A DeepSeek Harness workspace-enhancement plugin** — local and remote (SSH) workspaces managed in one place. A session can hold **multiple workspaces** (a main cwd plus side directories), each with its own permissions; machines, TOFU host keys and keychain passwords all live in your local `~/.dsh`. Built on [ssh2](https://github.com/mscdex/ssh2).

## Features

| Feature | Description |
|---|---|
| Remote workspaces | `ctx.subprocess` + `ctx.fs` transparent remote providers: one SSH chain (multi-hop) runs bash / files / PTY / directory browsing with no code changes on the tools |
| Multi-workspace sessions | The「⊕ 工作区」button in the session header: attach one or more **side workspaces** (local dirs or remote machine dirs) to a session, each with its own permission (`fs: read-only / read-write` + `exec: on / off`); the model is told about them and can operate them directly |
| Add-workspace flow | Connection sidebar (saved machines, `~/.ssh/config` aliases, local) + directory browser (breadcrumbs, native chooser, new folder); remote "Connect & open" creates the session straight on the server |
| Machine settings page | Machine CRUD / test / set-current / forget host key; OS-keychain passwords; TOFU host keys (`accept-new` default) |
| Session awareness | Remote marker + online tri-state + reconnect in the sidebar; per-session prompt injection states the remote / side-workspace context and its permission marks |
| Cross-server execution | `sw_exec(server, command)` runs a command on a **named server** (a registry id like `c1`, or the temporary id of `sw_connect save:false`; defaults to the session's machine) — the target OS is probed once per connection and reported (`bash -c` on POSIX, `pwsh -Command` on win32); on Windows hosts a `bash` tool is registered for remote-Linux workspaces |
| Model tools | `sw_status`, `sw_connect` (`save:false` = temporary), `sw_pick_workspace`, `sw_exec` (cross-server execution) |

## How it works

```mermaid
flowchart LR
    subgraph local["Your machine"]
        agent["agent loop<br/>orchestration · memory · LLM calls"] --> seam["this plugin<br/>ctx.subprocess · ctx.fs"]
    end
    subgraph remote["Remote host"]
        run["bash · files · PTY (terminal)"]
    end
    seam -- "one SSH connection (multi-hop jumps)" --> run
```

No DSH install on the remote: the model orchestrates locally, commands run remotely, results come back into context.

**Design notes** (implementation facts, not user features):

- **Registry & routing**: `remote-workspaces/machines.json` is the single source of truth; `ssh://<id>/<path>` (and the local `dsw-routes` placeholder tree) route every operation to the right machine; `~/.ssh/config` aliases are recognized.
- **Security**: TOFU host keys (`accept-new` / `verify` / `off`), per-machine OS keychain (DPAPI / security / secret-tool), credentials redacted in error messages.
- **Workspace permissions** are enforced at the engine seams (`ctx.subprocess` / `ctx.fs` are this plugin's single implementation): a read-only side workspace rejects writes, `exec: off` rejects launching a process inside that side workspace; command text is not inspected (documented boundary).
- **`sw_exec` semantics**: the command always runs on a **named server** — `server` takes a registry id or the temporary `sw_connect save:false` id and defaults to the session's machine (a local session without a server errors). The target OS is probed once per connection (`uname -s` → `cmd /c ver` → `unknown`) and reported in the first output line; POSIX/unknown runs `bash -c`, win32 runs `pwsh -Command`. The spawn goes through the same mixed provider, so the side-workspace `exec: off` gate and machine routing apply unchanged. `run_in_background` mirrors the official bash tool (job id returned immediately, no timeout; requires `ctx.jobs` and errors honestly when absent); `sandbox_permissions`/escalation is intentionally unsupported (deployment policy only).
- **win32 `bash` seam**: on a Windows host the plugin registers the `bash` tool itself (the official bash executor is not composed there, so the name is free) — a remote-Linux session runs `bash -c` on the server, a local Windows session gets a clear error instead of silently degrading; POSIX hosts never register it (the official `bash` tool owns the name).

## Install

```sh
# from npm (v0.1.0+)
dsh plugin --profile web add dsh-workspace-enhancement
# from source: npm run build first (host loads lib/)
dsh plugin --profile web add <this-repo-path>
```

> **First install with DSH's supply-chain pnpm**: native build scripts are blocked by default —
> allow them once per profile in `pnpm-workspace.yaml` (unstrict `allowBuilds`):
> `ssh2`, `cpu-features`, `koffi`, `node-pty`, `dsh-subprocess-local` — then run
> `dsh plugin --profile web install`. Without it the first `add` exits non-zero
> (`ERR_PNPM_IGNORED_BUILDS`) and the bundle is not appended.

## Roadmap

Current status and remaining milestones: [docs/ROADMAP.md](./docs/ROADMAP.md).

## References

- [dsh-ssh](https://github.com/UynajGI/dsh-ssh): remote execution engine — `ctx.subprocess` / `ctx.fs` providers, jump chains, PTY, directory-picker seam, `session.route` placeholder.
- [dsh-remote](https://github.com/flymysql/dsh-remote): workspace helper — machines registry, TOFU, OS keychain, web UI and settings page.

## License

MIT
