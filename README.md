# dsh-workspace-enhancement

English | [中文](README.zh.md)

<p align="center">
  <img src="https://img.shields.io/npm/v/dsh-workspace-enhancement" alt="npm version">
  <img src="https://img.shields.io/npm/l/dsh-workspace-enhancement" alt="license">
  <img src="https://img.shields.io/badge/node-%3E%3D22-339933" alt="node version">
  <img src="https://img.shields.io/github/actions/workflow/status/UynajGI/dsh-workspace-enhancement/ci.yml?label=CI" alt="CI status">
  <img src="https://img.shields.io/github/stars/UynajGI/dsh-workspace-enhancement" alt="GitHub stars">
  <img src="https://img.shields.io/badge/dsh-plugin-2ea44f" alt="dsh-plugin">
</p>

**SSH remote-development plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).** One package that answers "where does the workspace come from, where is it, and how is it operated": the remote **execution engine** (Bash, file tools, PTY terminals, LSP over one SSH connection with multi-hop ProxyJump chains), the **multi-machine registry** (machines table, TOFU host keys, OS keychain passwords, `~/.ssh/config` awareness), and the **web UI** (add-workspace side bar + directory browser, machine settings page) — with 3 `sw_*` model tools for orientation and connection. Built on [ssh2](https://github.com/mscdex/ssh2).

> Merged and streamlined from the dsh-plugin ecosystem's two SSH plugins (`dsh-ssh` engine + `dsh-remote` workspace assistant) — the API channels now use the unified `/dsw` naming. Verified end-to-end against a real two-hop jump environment with key auth.

## What's inside

| Layer | Delivers |
|---|---|
| Engine | `ctx.subprocess` + `ctx.fs` remote providers over one shared SSH chain; ProxyJump, SFTP atomic writes, PTY, env scrub |
| Registry | `<DSH_HOME>/remote-workspaces/machines.json` machine table (`{list, currentId}`), `ssh://<id>/<path>` routing, `~/.ssh/config` alias discovery |
| Security | TOFU host keys (`remote-workspaces/known_hosts.json`, `accept-new`/`verify`/`off`), optional OS-keychain passwords (Windows DPAPI / macOS `security` / Linux secret-tool), credential redaction in error messages |
| Web UI | Add-workspace flow (connection sidebar + remote directory browser), machine settings page (CRUD / test / set current / forget key), `~/.ssh/config` import |
| Tools | `sw_status` (orient + ping), `sw_connect` (connect/temporary), `sw_pick_workspace` (set remote workspace root) |

## Architecture: local brain, remote hands

```
Your machine (deepseek-harness)                      Remote host
┌────────────────────────────────────┐    SSH    ┌──────────────────────┐
│ agent loop (orchestration, memory) │◄──────────►│ bash / command exec  │
│ LLM API calls (direct, no egress)  │   exec    │ filesystem (SFTP)    │
│ credentials / config / sessions    │   pty     │ PTY terminals        │
│ ctx.subprocess → dsh-workspace-enhancement           │   sftp    │ LSP / git / builds   │
│ ctx.fs → dsh-workspace-enhancement                   │           │                      │
└────────────────────────────────────┘           └──────────────────────┘
```

**The harness does not need to be installed remotely.** dsh-workspace-enhancement implements remote providers for two of the harness's capability seams — `ctx.subprocess` (remote processes) and `ctx.fs` (remote files). Every tool built on those seams (bash, file tools, terminals, LSP, subagent processes) switches to the remote host with zero changes: the model thinks locally, commands run remotely, results stream back into the local model context.

## Install

```sh
# From a local checkout (current development flow — the plugin is not on npm yet):
dsh plugin --profile web add <this-repo-path>

# Future (after the npm release):
# dsh plugin --profile web add dsh-workspace-enhancement
```

The host loads the compiled payload from `lib/`; build it first with `npm run build` when installing from source.

## Quick start (cordis.yml)

**One row mounts everything** — the shared connection owner plus both remote providers:

```yaml
- id: ssh-remote
  name: dsh-workspace-enhancement
  config:
    host: server.example.com  # target host (required; a ~/.ssh/config alias like prod works too)
    port: 22
    username: root            # required
    privateKey: ~/.ssh/id_ed25519   # identity-file path, or PEM content
    # password: 'xxx'               # password auth (mutually usable with privateKey)
    # agent: 'pageant'              # Windows Pageant; Unix: SSH_AUTH_SOCK path
    cwd: /root/workspace           # remote working directory (required, absolute POSIX path)
    # --- ProxyJump chain (optional; first hop from local, last hop to target) ---
    jump:
      - host: bastion.example.com
        # port: 22             # defaults to the target's
        # username: ubuntu     # defaults to the target's
        privateKey: ~/.ssh/id_ed25519
      # - host: second-hop ...
    # --- Connection & security ---
    readyTimeout: 45000        # ~ ConnectTimeout (ms, default 45s; relayed links handshake slowly)
    keepaliveInterval: 0       # ~ ServerAliveInterval (0 disables)
    keepaliveCountMax: 3       # ~ ServerAliveCountMax
    strictHostKeyChecking: false   # verify the host key when true
    knownHosts:                    # required when strictHostKeyChecking: true
      - 'SHA256:xxxxxxxx...'
```

The aggregate row is equivalent to three subpath rows — mount them separately only when a deployment composes providers individually:

```yaml
- id: ssh
  name: dsh-workspace-enhancement/ssh            # ctx.ssh connection owner (config above)
- id: subprocess-ssh
  name: dsh-workspace-enhancement/subprocess     # ctx.subprocess remote provider
- id: fs-ssh
  name: dsh-workspace-enhancement/fs             # ctx.fs remote provider (SFTP)
```

## Machine registry (multi-host)

The web channel (`dsh-workspace-enhancement/web`) mounts the registry and the `/dsw` RPC channel; the Web bundle's machine management lives in the settings page (设置 → 远程工作区) and the add-workspace sidebar.

- **Persistence**: `<DSH_HOME>/remote-workspaces/machines.json` — `{ list: [...], currentId }`; machine ids are `c1, c2, …` (never reused once allocated); each machine may set `workspace` (default remote dir) and `recentWorkspaces` (last 8 picked).
- **TOFU host keys**: by default the first connection records the host key into `remote-workspaces/known_hosts.json` and every later connection **rejects a changed key** (`accept-new`); `verify` rejects unknown keys outright; `off` disables verification (not recommended). Forget a key in the settings page or via the `hostkey.forget` endpoint.
- **Keychain passwords**: per machine「加密保存密码」stores the password in the OS store — Windows DPAPI (`remote-workspaces/.secrets/*.bin`), macOS `security`, Linux `secret-tool`; plaintext is kept in machines.json otherwise. Best effort: if the OS backend fails, the password falls back to plaintext **with an honest ⚠ marker** in the UI instead of silent degradation. Testing a keychain machine resolves the stored secret the same way a real connect does.
- **`~/.ssh/config`**: the sidebar lists exact Host aliases (wildcards hidden), inserted from the config with resolved user/port/identity/jump; the form is alias-first too (blur/paste auto-resolves).
- **Model tools**: `sw_status` (current machine, workspace, connectivity ping, host-key state, password backend), `sw_connect` (connect and optionally save, `save:false` = temporary), `sw_pick_workspace` (verify + persist the remote workspace root).
- **`/dsw` RPC endpoints**: `connections.*` (legacy flat connection list), `machines.*` (list / add / remove / test / setCurrent), `config.hosts`, `hostkey.forget`, `status`, `browse.home` / `browse.list` / `browse.mkdir`, `session.route`, `local.pickNative`.

### Per-machine fields (machines.add)

`id` (upsert), `label`/`name`, `host` (required), `port`, `username`, `password`, `privateKeyPath`, `passphrase`, `agent`, `jump[]`, `cwd`/`workspace`, `hostKeyMode`, `credentialBackend: plain|keychain|windows|secret`, `encryptPassword`, plus legacy `strictHostKeyChecking`/`knownHosts`.

## Add-workspace over SSH (Web GUI)

The Web surface's **Add workspace** flow (the conversation hero picker and the
sidebar workspace browser) is taken over by the dsh-workspace-enhancement client UI, laid out as a
**connection sidebar beside a directory browser** (VS Code Remote Explorer
style): the sidebar lists `~/.ssh/config` hosts, saved connections, and the
local entry; the right pane browses whichever side is active. Local listing
rides the `ctx.directoryPicker` `browse` capability; connection management and
remote listing ride dsh-workspace-enhancement's own `/dsw` RPC channel. While browsing the
local side, the toolbar also offers a **system chooser** button (the
`local.pickNative` endpoint, reusing the host's OS-native folder dialog) — the
directory picked in the popup becomes the workspace directly, no
level-by-level walking required.

### `~/.ssh/config` hosts in the sidebar (`config.hosts`)

The「SSH 配置主机」sidebar section is driven by the `config.hosts` endpoint:
every opening **re-reads** the host machine's `~/.ssh/config` and lists its
**exact Host aliases** (wildcard patterns such as `*.example.com` stay hidden),
each with the resolved `user@host:port`, IdentityFile presence, and ProxyJump
presence:

- Clicking an alias resolves its full config (username, port, identity, jump
  chain), **registers it silently, and drops you straight into that host's
  directory browser** — no form (VS Code Remote-SSH style). Registered aliases
  get an「已添加」badge and simply switch on click.
- An alias without a `User` skips registration and opens a **prefilled form**
  (port / identity / jumps already filled); only the username is missing.
- An alias without an `IdentityFile` can be registered, but the connection
  fails at auth — the right pane translates `All configured authentication
  methods failed` into a readable hint with a「补全认证」button that opens the
  prefilled form.

The「新建连接」form is alias-first as well: type a `~/.ssh/config` alias and
blur or paste auto-resolves and prefills (the manual「识别 ssh 配置」button
remains the loud fallback); a successful resolve shows a one-line summary
(alias → user@host:port, identity path, jump chain) inside the form.

A patch layer's `name` is a match guard rather than a replacement, so the Web
bundle's `@deepseek-ai/dsh-host-directory-picker-auto` row must be **disabled
by id** (its dynamically mounted in-app picker disappears with it) and the SSH
backend inserted under its own id. In the Web profile
(`$DSH_HOME/profiles/web/cordis.patch.yml`):

```yaml
# Disable the boot-resolved picker (its dynamic entries go with it).
- id: directory-picker
  name: '@deepseek-ai/dsh-host-directory-picker-auto'
  disabled: true

- insert:
    - id: ssh-remote
      name: dsh-workspace-enhancement
      config: { ...same config as the quick start... }

    # The local-directory browse backend for the client directoryFlow slots.
    - id: directory-picker-ssh
      name: dsh-workspace-enhancement/picker
      config:
        maxEntries: 1000

    # The connection registry + /dsw RPC (persistence, ~/.ssh/config
    # awareness, remote directory browsing).
    - id: ssh-web-channel
      name: dsh-workspace-enhancement/web
      config:
        maxEntries: 1000
```

Picking a remote directory first asks `/dsw` `session.route` for a LOCAL
placeholder directory (`<DSH_HOME>/dsw-routes/<connectionId>/<remotePath>`,
created host-side) and creates the session with it:

```ts
const { cwd } = await rpc('session.route', { id: connectionId, path: remotePath })
ctx.sessions.create({ cwd })
```

The detour exists because the host's session service `mkdir`s the project
directory through `node:fs` — an `ssh://…` cwd cannot pass that check, while
`mkdir` succeeds silently for an existing directory. `ctx.subprocess` and
`ctx.fs` recognize both the `ssh://<id>/<path>` spelling and the local
placeholder prefix, routing that session's bash / file / terminal operations
onto the registered connection's directory. Remote sessions do not enter the
DSH local workspace registry (see「Known limitations」); deleting a connection
also removes its placeholder tree.

> Placeholder layout note: pre-rename sessions carry placeholders under
> `<DSH_HOME>/dsh-ssh-routes/…`. The new root is `dsw-routes/`; the old tree
> **keeps routing** (compat) so existing session cwds never break. Cleanup of
> the old tree is a manual, operator-owned step once no live session references
> it.

### Picker configuration (`dsh-workspace-enhancement/picker`)

| Field | Type | Default | Description |
|---|---|---|---|
| `maxEntries` | number | 1000 | Complete-result bound for one listed level (hidden rows count; `truncated` flags a cut) |
| `remoteLabel` | string | — | Retained field: the client flow no longer uses a pinned entry; remote entries live in the left connection sidebar |

`dsh-workspace-enhancement/picker` now serves only the `ctx.directoryPicker` `browse` backend
(local directories keep working on Windows hosts; POSIX absolute paths go to
the aggregate SSH connection). The client UI's remote connection list and
remote directory browsing ride the `dsh-workspace-enhancement/web` RPC channel instead.

## Configuration reference (`dsh-workspace-enhancement/ssh`)

| Field | Type | Default | Description |
|---|---|---|---|
| `host` | string | — | Target hostname or address (required) |
| `port` | number | 22 | Target SSH port |
| `username` | string | — | Remote login user (required) |
| `password` | string | — | Password auth |
| `privateKey` | string | — | PEM key content or local identity-file path |
| `passphrase` | string | — | Passphrase for an encrypted key |
| `agent` | string | — | ssh-agent socket path or `pageant` |
| `jump` | JumpConfig[] | `[]` | ProxyJump chain; per-hop port/user/auth overrides |
| `cwd` | string | — | Remote working directory (required, absolute POSIX path) |
| `readyTimeout` | number | 45000 | Connection timeout (ms) |
| `keepaliveInterval` | number | 0 | SSH keepalive interval (ms) |
| `keepaliveCountMax` | number | 3 | Keepalive failure threshold |
| `strictHostKeyChecking` | boolean | false | Verify the host key against `knownHosts` |
| `knownHosts` | string[] | `[]` | Trusted fingerprints (`SHA256:…`) or raw base64 public keys |

### OpenSSH `~/.ssh/config` mapping

| OpenSSH directive | dsh-workspace-enhancement field |
|---|---|
| `HostName` / `Port` / `User` | `host` / `port` / `username` |
| `IdentityFile` / `IdentitiesOnly` | `privateKey` (path or PEM) |
| `PasswordAuthentication` | `password` |
| `ForwardAgent` | `agent` |
| `ProxyJump` (comma-separated hops) | `jump` array (per-hop) |
| `ConnectTimeout` | `readyTimeout` |
| `ServerAliveInterval` / `ServerAliveCountMax` | `keepaliveInterval` / `keepaliveCountMax` |
| `StrictHostKeyChecking` + `UserKnownHostsFile` | `strictHostKeyChecking` + `knownHosts` |
| `RemoteCommand` / `RequestTTY` | see `spawnTerminal` (PTY is consumer-requested) |

## Capabilities

| Capability | Implementation |
|---|---|
| ProxyJump chains | `jump` array, multi-hop (direct-tcpip, equivalent to OpenSSH `ProxyJump`), independent auth per hop |
| Auth | password, private key (PEM or path), passphrase, ssh-agent / Pageant; with none configured, falls back to the `~/.ssh` default identities (id_ed25519 / id_ecdsa / id_rsa, mirroring OpenSSH) |
| Multi-machine registry | machines table (`machines.json`), `ssh://<id>/<path>` routing, per-machine workspace + recentWorkspaces, `~/.ssh/config` alias discovery |
| Host verification | TOFU default (`accept-new` / `verify` / `off`, `known_hosts.json`, changed key rejects), legacy `strictHostKeyChecking` + `knownHosts` as the manual mode |
| Password storage | OS keychain per machine (Windows DPAPI / macOS `security` / Linux secret-tool), best-effort with an honest plaintext-fallback marker; error messages redact credential values |
| Upload (local → remote) | SFTP atomic write (same-dir temp file + rename, mode preserved) |
| Download (remote → local) | full fs provider: read / streamText (streaming decode) / readBytes (bounded) / listDir / stat / lstat |
| Remote commands | subprocess provider: collect (bounded tail + local spill file), pipe, inherit, batch stdin |
| Interactive terminals | PTY (`spawnTerminal`), I/O plus TERM→KILL cleanup |
| Add-workspace GUI | `dsh-workspace-enhancement/picker`: the directory-picker seam's `browse` backend; the client UI is a connection sidebar (`~/.ssh/config` one-click hosts + saved connections + local) beside the directory browser |
| Machine management UI | settings page (设置 → 远程工作区): CRUD, set current, test connection, forget host key, `~/.ssh/config` import |
| Model tools | `sw_status`, `sw_connect`, `sw_pick_workspace` (orient / connect / pick workspace) |
| Environment isolation | remote login env scrubbed (`DSH_*` and credential-shaped names removed) + explicit overrides, launched via `env -i` |
| Concurrency safety | fs writes serialized per target key (no interleaved writes) |

## Migration & legacy data

The plugin deliberately reuses the dsh-remote-era state paths and archives the dsh-ssh-era ones:

- **Upgrading from the old plugins** — uninstall the legacy rows first: `dsh plugin --profile web remove dsh-ssh` and/or `dsh plugin --profile web remove dsh-remote` (the old SSH plugins must not stay mounted beside this one; the harness profile manager only re-manages rows it registered, so a manual `dsh plugin add`/`remove` of this repo replaces them cleanly). State does not need manual migration — see below.
- **`$DSH_HOME/remote-workspaces/`** is unchanged (dsh-remote path): `machines.json` (machine table), `known_hosts.json` (TOFU trust records), `.secrets/` (DPAPI-encrypted passwords — keep!). Abandoned **mirror directories** (`$DSH_HOME/remote-workspaces/<host>-<user>-<port>/…`, containing only `.dsh-remote-meta.json`) are leftovers of the removed sync feature and can be deleted.
- **`<DSH_HOME>/dsh-ssh-connections.json`** — on first run, when machines.json is absent or empty, the legacy dsh-ssh connection file is imported verbatim (ids preserved, `ssh://c1/…` keeps working) and the file is renamed to `dsh-ssh-connections.json.bak`. The `.bak` is the only remaining archive of the old password-bearing file.
- **`<DSH_HOME>/dsh-ssh-routes/`** — legacy session placeholders, **kept** (they carry the cwd of running remote sessions; deleting them would break session resume). They still route via the compat layer; the layout note above applies. Once no session references it, the tree can be removed manually.
- **RPC channel** — `/dsh-ssh` → `/dsw`; error/`log` prefixes `dsh-ssh:` → `dsw:`. Old endpoint names are unchanged, so existing client wiring only needs the channel string.

## Performance

- **Connection reuse** — all three providers share one SSH connection (jump chain included); the SFTP channel opens lazily, is reused, and rebuilds itself after disconnects.
- **Environment cache** — the remote login environment is read once per connection (`env -0`), not per spawn.
- **Local spill** — collect-mode output keeps an in-memory tail plus a local spill file, same semantics as the official local provider.
- **No polling** — one exec channel per command (`cd && exec env -i -- …`); no polling or intermediate state files.

## Reliability

- **Exit facts are authoritative** — exit code / signal come from the SSH channel close event.
- **UTF-8 safe** — exec output is buffered and decoded once; SSH chunking cannot corrupt multi-byte characters.
- **Fail loud** — connection, auth, jump, and SFTP failures surface with readable messages; `browse.home` reports connection failures instead of a fake home.
- **Teardown** — plugin disposal terminates active processes/terminals and closes the connection; staging dirs and spill files are cleaned on failure.

## Troubleshooting

| Symptom | Cause & fix |
|---|---|
| `All configured authentication methods failed` | Wrong auth config: check username / privateKey path / passphrase; key permissions too open (`chmod 600`) |
| `Cannot read private key` | `privateKey` is neither PEM content nor an existing file |
| Jump connection timeout | Check hop reachability and `readyTimeout`; verify the hop's user/auth independently |
| `Host key verification failed` | TOFU `verify` mode or `strictHostKeyChecking: true` without a matching trust entry; collect the fingerprint with `ssh-keyscan` / forget the recorded key |
| exec exits 127 | Remote command not found; check the remote PATH (the scrubbed env keeps it) |
| Write fails with `FS_NOT_OBSERVED` | File exists and `createIfAbsent` was used (overwrite protection, not a bug) |
| Keychain machine fails to test/connect with an empty-password hint | The OS store lookup failed (best-effort): re-enter the password via the settings form (keychain or plaintext) |

## Known limitations

- **Remote pid invisible** — SSH channels do not expose the remote pid; `SubprocessHandle.pid` is always `-1`.
- **Termination is not tree-scoped** — `terminate` signals the remote direct process (SIGTERM → grace → SIGKILL); descendants are not guaranteed to die (inherent to the SSH protocol, unlike the local provider's process groups).
- **No foreground process group** — `inspectForeground` returns `undefined` and `signalForeground` throws (the SSH channel cannot resolve a remote foreground group).
- **No reconnection** — a dropped connection requires a plugin restart; a failed connect is cached for the connection's lifetime (a retry needs the connection recreated).
- **Remote shell & rg prerequisites (⑧⑨)** — terminal/command tools run `bash` (POSIX) or `pwsh` on the remote per what is installed: on Windows hosts `tool-bash` is disabled by the official preset's `process.platform == 'win32'` condition (a host/preset-layer fact this bundle does not override), so a remote session should provide bash or pwsh; `sw_status` probes remote `bash`/`pwsh`/`rg` presence and lists the missing ones in one line. glob/search tools require ripgrep (`rg`) installed remotely — when absent the tools fail loudly with 127 and a hint; this bundle deliberately does not emulate find/grep (glob semantics stay the official tool's).
- **Remote directories land as sessions** — picking a remote directory opens a session through a `session.route` local placeholder (`<DSH_HOME>/dsw-routes/<id>/<path>`; the session list shows that cwd; the pre-rename `dsh-ssh-routes/<id>/<path>` still routes); no record is created in the DSH local workspace registry (`dsh-workspace` still only accepts local `fs.realpath` directories).
- **Picker is remote-only on POSIX hosts** — every absolute path is a remote path there, so the local filesystem cannot share the picker's vocabulary (Windows hosts keep both worlds via drive/UNC routing).
- **Text-only streaming** — `streamText` rejects binary files with `FS_NOT_TEXT` (same as the official provider).

## Development

```sh
npm i
npm run typecheck
npm run build       # emits lib/ — the compiled payload the harness loader imports
npm test            # node --test regression suite
```

- **Git hooks** (husky): `pre-commit` typechecks; `commit-msg` enforces [Conventional Commits](https://www.conventionalcommits.org/); `pre-push` rejects a version tag that does not match `package.json`.
- **CI** (GitHub Actions): typecheck + publishable-payload check on every push/PR.
- **Release** (GitHub Actions): push a version tag to publish to npm and draft a GitHub Release:

```sh
npm version patch -m "chore(release): v%s"   # bumps package.json + commits + tags
git push origin main && git push origin --tags
```

The tag must match the `version` field in `package.json` (both hooks and the release workflow enforce it). Publishing uses the `NPM_TOKEN` repository secret (an npm **Automation token** — it bypasses 2FA for CI).

## License

MIT
