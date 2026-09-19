# R32 — BUG-9 修复：远端任务真的停得下来

> 本文是**轮次档案**，不是现状。待办与验收在 [`backlog.md`](../backlog.md) 的 `BUG-9` 行；
> 调查根因见 [`R31`](./R31-bug9-remote-task-stop.md)（三路实锤）。

## 目标

按 R31 §结论 方向落地：核心腿组杀、直连腿独立 channel 杀、启动窗中止不丢、前台等待有界。
需求 ID：**BUG-9**（P1）。

## 改动

### 核心腿（Go，`core/spawn*.go`）

- `spawn.go`：`cmd.Start()` 前 `setProcessGroup(cmd)`；`terminate()` 先
  `killProcessGroup(pid)`（SIGKILL 整组），失败才退化 `Process.Kill()`。
- 新增 `spawn_unix.go`（`//go:build unix`：`SysProcAttr{Setpgid: true}` + `syscall.Kill(-pid)`）
  与 `spawn_other.go`（no-op / 恒 false，Windows CI 的 `go test` 仍可编译运行）。
  与官方 `dsh-subprocess-local` 的 `detached + kill(-pid)` 同构（ADR-0026 §5 补充的「底线形态」）。
- 围栏自证：核心自 jail 进 bwrap 的 PID namespace（`--unshare-pid`，profile.json），
  组杀发生在 namespace 内，pids 即核心视角，无跨 namespace 歧义。

### 核心腿（JS，`src/core-process.ts`）

- **pending-abort**：`terminate()` 在 job id 就绪前只记 `terminatePending`；
  `trySendTerminate()` 在三个 job 赋值点（`spawn.start` 回包、事件流学到 job）触发补发——
  冷起核心 / 审批门 / 连接建立期间的中止不再丢失。
- **不静默**：peek 落空与 RPC 失败记入 `lastTerminateFailure`（getter 供观测/测试），
  RPC 失败不锁存，下一事件重试。
- 顺手修同族隐患：`stdin: {data}` 载荷原来用 `queueMicrotask` 自旋等 job（spawn.start 慢
  会**饿死整个事件循环**），改为停泊 + job 到位补发（`flushPendingStdin`）。

### 直连腿（`src/process.ts`）

- 命令前缀 `echo $$ &&`（在 `cd` 之后、`exec env -i` 之前）：shell 先打印自己的 pid 再
  exec——pid 既存活进 argv[0]，又给了我们不依赖 signal request 的杀入口。
- stdout 首**行**剥离（`takeStdoutChunk`）：数字行 → 捕获 pid；非数字行 → bypass 原样放行；
  无换行先缓冲（超 32B 判 bypass）；channel 提前 close 时 flush 缓冲，零字节丢失。
  `handle.pid` 从恒 `-1` 变为「pid 行到达后有值」。
- **停止链**（`beginTermination`）：第一跳仍是 `channel.signal('TERM')`（新服务器零开销），
  同时**独立 exec channel** 发 `kill -TERM -- -PID; kill -TERM PID`（组优先、单 pid 兜底；
  pid 是剥离校验过的纯数字，注入面为零）；`graceMs` 后升级 KILL 两跳齐发；
  再过 2s（`KILL_CLOSE_FALLBACK_MS`）channel 仍未关则本地 `channel.close()` 强制收口
  ——OpenSSH < 7.9 / Dropbear 吞掉 signal 与 kill 时，工具调用也不会永挂。
- **启动窗**：abort 落在命令尚未发出时直接终止启动（远端零残留），不再「先启动再追杀」；
  pid 行晚于 terminate 到达时自动补发 kill（`onRemotePid` → `dispatchRemoteKill`）。

### 工具层（`src/exec-tools.ts`）

- `awaitOutcomeOrStop(done, signal, window=STOP_SETTLE_WINDOW_MS)`：`swExecCore` 与
  win32 bash 前台不再裸 `await handle.done`——abort 后给 `grace + 5s` 停定窗，超窗抛
  `UnsettledStopError`（调用方中止 → `toolAbortError`；超时 → 新词典键
  `tool.error.stopFailed`，zh/en 双语）。R31 点名的「aborted 检查排在 await 之后」随之消解。

### 测试

- `test/bug9-stop.test.ts`（13 例）：pid 剥离（含分片/bypass/flush）、升级链（signal/kill/
  close 兜底）、晚到 pid、启动窗零启动、核心腿 pending-abort / peek-miss / RPC 失败重试、
  `awaitOutcomeOrStop` 三态。
- `core/spawn_unix_test.go`（unix only）：`sh -c 'sleep 30 & sleep 30'` 实测——Setpgid 落位
  （`Getpgid == pid`）+ terminate 后扫 `/proc` 断言**组内零存活**（旧代码必留两个孤儿 sleep）。
- 既有 wiring 测试的命令串断言随 `echo $$` 前缀更新。

## 验证

- 沙箱内：`check:static` / `typecheck` / `test:agent`（2 例沙箱受限已归类）/ `npm run build` /
  `boot-smoke --no-channel`（SMOKE PASS；进程不退出是既有 INFRA-12）/ `go vet ./...`。
- WSL：`scripts/verify-linux.sh`（含 Linux `go test`——组杀用例在真 Linux 上跑——与
  linux/amd64 构建）。结果见 PR CI。
- 本机 Go 安装缺交叉编译 std（std 内部包报错），linux 构建只在 WSL/CI 验。

## 遗留 / UAT

- 直连腿初版 `echo $$` / 宿主持有远端 pid 已否：现码是远端 steward（stdin EOF →
  `kill -TERM 0`）+ signal + close，`handle.pid` 恒 `-1`。仍是 **BUG-9**，不另开轮次。
- 2026-09-19 squash [#26](https://github.com/DobyChao/dsh-workspace-enhancement/pull/26) 进
  `master`。lab UAT [`uat/R32-bug9-stop-uat.md`](../uat/R32-bug9-stop-uat.md) A/B 通过、C N/A。
- systemd scope + 进程树跟踪（官方第二保险）未跟进，维持 R31 结论：第一期不做。
- `SshTerminalHandle`（PTY 路径）未动——PTY 的信号经 line discipline 必达，不在 BUG-9 范围。

来源：2026-09-18 会话；`src/process.ts` / `src/core-process.ts` / `src/exec-tools.ts` /
`core/spawn*.go`；对照 `.tmp/upstream-ssh/`（本地素材）。
