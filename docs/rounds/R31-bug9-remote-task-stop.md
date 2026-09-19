# R31 — BUG-9 调查档案：远端任务停止不了（三路实锤）

> 本文是**调查档案**，不是现状。待办与验收在 [`backlog.md`](../backlog.md) 的 `BUG-9` 行；
> 行号若无特别标注，属 2026-09-18 的 master 快照，不是契约（引用纪律见
> [`compatibility.md`](../compatibility.md) §5.3）。上游引用一律「包 + 版本 + 文件」。

## 目标

用户 2026-09-18 实测：**bash 任务前台、后台都停止不了**。查明三条执行路径各自的停止链断点，
给修复拍板供料。需求 ID：**BUG-9**（P1）。

## 调查

三条腿分别核了 JS 侧（本仓库 `src/`）、Go 侧（本仓库 `core/`）与官方对照（npm 解包产物，
本地素材 `.tmp/upstream-ssh/`，不入库）。

### ① 直连腿（`SshSubprocessHandle`，围栏 off / 核心缺失时的 fallback）

- 停止链：前台 = 模型/UI 中止 → `exec.signal` → `makeSwExecDeadline`（`src/exec-tools.ts:519`）
  合流进 spawn 的 `spec.signal`；后台 = job `cancel()` → `handle.terminate()`（`src/exec-tools.ts:1173`）。
- 两条最终都进 `SshSubprocessHandle.terminate()`（`src/process.ts:126`）→
  `channel.signal('TERM')`，`graceMs` 后升级 `'KILL'`（`src/process.ts:150-163`）。**仅此一跳，无兜底。**
- 单点故障：`client.exec` 是 `pty: false`（`src/process.ts:190`），而 OpenSSH 服务端
  **≥ 7.9（2018）才支持无 PTY 的 signal channel request**；更老的服务器（CentOS 7 的 7.4 等）
  与 Dropbear 直接拒绝，ssh2 客户端对拒绝**静默处理**——`signal()` 不报错、远端收不到。
- 后果：后台 `cancel()` 本地立即返回「已取消」，远端照跑；前台中止后工具仍
  `await handle.done`（`src/exec-tools.ts:1199`），`channel.on('close')` 永不触发 ⇒ **调用永挂**，
  连中止错误都抛不出（`exec.signal.aborted` 检查在 `src/exec-tools.ts:1208`，排在 await 之后）。

### ② 核心腿（`CoreSubprocessHandle` + Go 核心）——「有 core 也停不掉」的原因

- Go 侧 `spawnHub.start()`（`core/spawn.go:31`）**没有设置任何进程组**（无 `SysProcAttr.Setpgid`）；
  `terminate()` 只 `p.cmd.Process.Kill()` 打**直接子进程**（`core/spawn.go:112-119`）。
- bash 工具 / `sw_exec` 的 argv 都是 `['bash','-c',command]` ⇒ SIGKILL 杀掉的是 bash 本身，
  **用户命令拉起的真实任务（server / sleep / 编译）原地存活**。
- 更迷惑的观测面：bash 一死 `spawn.exit` 即回 ⇒ 工具调用「正常结束」——前台**看似停了**，
  远端还在跑；后台 job 同理。这正是「前台和后台好像都停止不了」的体感来源。
- JS 侧两个放大项（`src/core-process.ts:100-108`）：
  1. `job === undefined` 时 terminate **静默 return**——`spawn.start` RPC 返回前的中止全部丢失
     （冷起核心、审批门、连接建立期间恰是最想停的时候），job 到手后也无补发机制；
  2. `hub.peek(...)?.call(...)` 是 fire-and-forget，peek 落空与 RPC 失败均无人知晓。
- 围栏（bwrap）包裹下的组行为**未核实**——kill 落在 wrap 进程上时子孙是否连带死取决于
  wrap 方式，修复时一并验。

### ③ 官方对照（`@deepseek-ai/dsh-subprocess-local@0.1.6-alpha.2` 解包）

官方 SSH 家族（`dsh-ssh`/`dsh-subprocess-ssh`，见 [`ADR-0026`](../decisions/ADR-0026-upstream-ssh-runtime.md)）
把进程归属整个交给远端 helper；helper 的 terminate 又转调远端 `dsh-subprocess-local`，其杀法是双保险：

1. **组杀**：普通进程以 `detached: true` 启动（子进程自成组长），terminate 先
   `process.kill(-child.pid, signal)` 杀**整组**，失败才退化打单个 pid（`lib/index.js:436-443`）；
2. **systemd 瞬态 scope + 树跟踪**（Linux）：`systemd-run` 把任务包进 `dsh-subprocess-*.scope`
   （`lib/index.js:478` 起），配合 process-inspector 的 `tree(pid)` / `trackedDescendants` 找逃出组
   的后代；终端清理失败有 `surviving pid` 硬断言（`lib/index.js:1002`）。

⇒ **组杀是官方与我们两条路线公认的底线形态**；我们核心缺的正是它。

### PTY 方案已否

- PTY 能让信号经 line discipline 必达（任何服务器），但：stderr 并入 stdout（契约级回退，
  官方 bash 工具 schema 分流）、CRLF/回显/ANSI 污染 collect 流、程序 tty 行为漂移、
  后台子进程碰 tty 收 `SIGTTIN/SIGTTOU` 被冻结。
- 官方 subprocess 路径同样不靠 PTY（PTY 只属 terminal 路径：`terminalType`/`resize`）。
- 结论：**PTY 不进 exec 通道**；同一 channel 也无法「平时 pty:false、杀时补 pty」。

## 结论（修法方向，**待拍板**）

| 腿 | 方向 |
|---|---|
| 核心腿（主战场） | Go `SysProcAttr{Setpgid: true}` + terminate `kill(-pgid, SIGKILL)` 杀整组（核心限 linux x86_64，纯 POSIX 可行；与官方 local 层同构）；JS 侧 pending-abort（job 未就绪时记住中止、job 到手立即补发）+ peek/错误不静默 |
| 直连腿 | 命令包装拿远端 pid（如 `sh -c 'echo $$; exec …'`）→ 取消时独立 channel 发 `kill`（不依赖 signal request，服务器覆盖面最广）；保留现 `signal()` 当第一跳；`channel.close()` 兜底 |
| 一并核实 | bwrap 包裹下的进程组行为；前台 abort 检查顺序（`await handle.done` 之后才查 aborted） |

## 遗留

- 修法未拍板，未动代码；验收标准见 `backlog.md` `BUG-9` 行。
- 官方 systemd scope + 树跟踪是第二保险，暂不列入第一期（可在拍板时决定是否跟进）。
- 定位层面（换不换官方 helper）见 `ADR-0026` §5 的 2026-09-18 补充：与 BUG-9 解耦。

来源：2026-09-18 会话调查；代码 `src/process.ts` / `src/exec-tools.ts` / `src/core-process.ts` /
`core/spawn.go`；解包产物 `.tmp/upstream-ssh/`（本地素材）
