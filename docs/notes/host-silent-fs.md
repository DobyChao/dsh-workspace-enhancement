# 宿主静默 `ctx.fs`：项目根探测

> 专题附录，不是入口、也不是待办。代码侧 **`BUG-4` 已修**。工作区键认 [`ADR-0024`](../decisions/ADR-0024-remote-core-protocol.md) §6.2–§6.3。
> 入口：[`architecture.md`](../architecture.md) §5.9。

对话轨迹里看不到 Git / Bash，不等于宿主没碰文件系统。远程会话一开（组第一条上下文、扫 skills），上游会**自己**沿目录往上问「这里是不是项目根」。默认标记是目录里有没有名为 `.git` 的条目。这不是模型工具，用户点不着、卡片上也不出现。

## 1. 谁在走

lab 当前家族（`@deepseek-ai/dsh` `^0.1.5-rc.1`）里至少两处：

| 包 | 做什么 | 轨迹里看不看得见 |
|---|---|---|
| `@deepseek-ai/dsh-agent-instructions` | 决定 `AGENTS.md` / `CLAUDE.md` 从哪读。`DEFAULT_PROJECT_ROOT_MARKERS = ['.git']`，`findProjectRoot` 从 `session.header.cwd` 往上 `existsAsMarker(join(dir, '.git'))` | 看不见。进会话 / 发第一条之前就会跑 |
| `@deepseek-ai/dsh-skill-filesystem` | 同样的 `findProjectRoot`，给 `.dsh/skills` / `.agents/skills` 定项目根 | 看不见 |

探测走可选服务 `ctx.fs`（本插件的混合门面）。`existsAsMarker` / `pathExistsInFileSystem` 调用：

```text
fs.resolve(path)     // 通常只有 signal，没有会话 cwd
fs.stat(target)
```

没有 git 仓库时会一路问到文件系统根（或占位树根）。这是上游设计：没找到标记就退回 cwd，但**每一层都要 resolve 一次**。

官方 Write / Read 也会 `ctx.fs.resolve`，但那是用户看得见的工具。本文件只记录**看不见的那一串**。

## 2. 远程会话上长什么样

Windows 宿主上会话 cwd 常是占位树：

`%DSH_HOME%\dsw-routes\<id>\home\uuz\ssh-test-lab`

`remoteRouteFromCwd` 把它译成 `ssh://<id>/home/uuz/ssh-test-lab`。于是静默探测变成远端：

| 宿主在问 | 远端路径 |
|---|---|
| `…/ssh-test-lab/.git` | `/home/uuz/ssh-test-lab/.git` |
| `…/uuz/.git` | `/home/uuz/.git` |
| `…/home/.git` | `/home/.git` |
| 再上一层（占位树里的机器目录 / `/`） | `/.git` 一类 |

`ps` 里每个 workspace-write jail 是 **3 个 PID**（外层 `bwrap`、`--unshare-pid` 的内层 `bwrap`、`dsh-core serve`）。这是**一条 serve 的常驻树**，不是一次 Read/Write/Bash 起三份：冷启动 `exec` 一次 bwrap，之后同根请求复用这条 RPC。同一秒出现**四个 `--workspace`**，才是四个 jail，不是四个互不相关的用户操作。

三个 PID 从哪来（bubblewrap 在 `--unshare-pid` 下的固定形态，与本地 `dsh-sandbox-local` 同一套 token）：

| 宿主 `ps` 里看到的 | 干什么 |
|---|---|
| 外层 `bwrap`（PPID = `sshd`） | 建 mount/user ns，`--die-with-parent` 盯着 SSH |
| 内层 `bwrap` | 新 PID ns 里的 **PID 1**（收尸；没有它 `--unshare-pid` 不成立） |
| `dsh-core serve --already-jailed` | 真正接 fs/spawn RPC |

`--unshare-pid` + `--proc /proc` 让 jail 里的 `/proc` 只看见自己人，spawn 出的 bash 也进这个 PID ns。去掉能少一个 `bwrap`，但 `/proc` 会漏宿主进程，且与本地围栏向量分叉——**不值得为省一个 PID 拿掉**。Read/Write 不再 `fork`；Bash 才会在这棵树下多一个命令进程。

R27（2026-09-15，lab `c1` / WSL `uuz`，会话工作区 `/home/uuz/ssh-test-lab`）一次爆发：

- `/home/uuz/ssh-test-lab` — 会话目录（该有）
- `/home/uuz` — 祖先（不该有）
- `/home` — 祖先（不该有）
- `/home/uuz/dsh-i5-ws` — 机器登记 workspace；`cwd === '/'` 时禁止铸根，退回 `declared[0]`

chip 仍显示「工作区内修改」。官方 Write 只要打进会话那个 jail，工作区外 `/tmp` 拒绝仍然成立；旁边多出来的宽 jail 是另一份可写绑定。

## 3. 插件这边为什么会铸新 jail

`ADR-0024` §6.2：jail 根不是操作路径。browse 的「当前目录」只当 `path` 匹配已有根，**不得**变成 `--workspace`。

缺口（**BUG-4，2026-09-17 已修**）：混合门面把这次 `resolve`/`lstat` 的**被查路径**（或它的 `dirname`）塞进 hub 的 **`cwd`**。`resolveCoreWorkspace` 规定：**`cwd` 不在已声明根里就铸一个兄弟 workspace-write jail**；`path` 才不会铸。

静默探测没有会话 cwd，于是每一层祖先都变成新的 `--bind <祖先> <祖先>`。`gitWorkingTreeOf` 只是把 `…/.git` 剥成工作树字符串，**不会**在磁盘上找 git；名字像 git，实际是「cwd 字符串怎么变成 jail 根」。

**修法**：`CoreRoutingFileSystem.resolve` / `.lstat` 现在只把探测目标当 **`path`** 交给 hub
（cwd 由 `delegate` 回落到发起会话自己的 cwd）。路由不受影响——机器 id 来自
`resolveSshCwd`，与 workspace 选择无关；`fs.stat`/`readText` 等本来就只传 `path`。
回归：`test/core-routing.test.ts` 的「BUG-4」用例（拿掉修复即红）。

## 4. 怎么确认（不要看聊天）

在**远端**看进程，不要看对话卡片：

```bash
ps -eo pid,ppid,args | grep -E '[b]wrap|[d]sh-core serve'
```

同一 `sshd` 父进程下，多个 `--workspace` 且时间戳同一秒 → 静默探测爆发，不是用户连点了四次工具。

改名 `~/.dsh-core/current` **不会**杀掉已 exec 的 serve（argv0 已是解析后的 `0.2.0-dev/dsh-core`）。要停：重连该机、重启 lab 宿主、或杀那些 serve。空闲 10 分钟无 RPC 也会被 hub 关掉。

## 5. 修法（`BUG-4`，2026-09-17 已落地）

`resolve` / `lstat` 与 write/stat 一样：铸根只认会话 cwd / 已声明根；探测路径只当 `path`。祖先目录不得成为 workspace-write `--workspace`。验收：无 `.git` 的远程会话开一次，远端只该有会话根（外加机器登记工作区若有独立 `require`），不得出现 `/home`、`$HOME` 这种更宽的 bind。

已落地的是**宿主侧这一半**（探测不再铸根）；**远端实机那一半仍待验**：远程会话开一次，
`ps -eo pid,ppid,args | grep -E '[b]wrap|[d]sh-core serve'` 只该见会话根 + 机器登记 workspace。
lab 现有机器都带 `.git` 的会话根，需造一个无 `.git` 的目录来复现原症状。

**核心缺失时这条探测会拒绝整轮**（不是静默降级）：围栏档下 `fs.resolve`/`fs.stat` 同样走核心，
核心不在就 fail-closed，宿主在会话起步（首条上下文、还没有任何事件落盘）就会失败。这是
`ADR-0025` §2.9 的**拍板行为**（所有者 2026-09-17，选项 A：降级会让项目根识别静默失效），
拒绝文案由 `fenceMissingHint` 分诊到「去 `core.deploy`」，而不是「装 bubblewrap」。
