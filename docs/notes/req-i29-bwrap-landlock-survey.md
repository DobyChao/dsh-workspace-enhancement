# REQ-I29 / REQ-I30 调查档案 — 宿主本尊的 bwrap→Landlock 链与远端兜底方向

> 2026-10-12 会话调查归档。检视对象：全局安装 `@deepseek-ai/dsh@0.2.0-rc.2`（`npm root -g` 快照）。
> **符号名是契约；行号属该快照，不可跨快照互换**（ADR-0017 §1.1 纪律）。实施轮开工前按 AGENTS §5 红线 7 重新核盘。

## 1. 问题

远端围栏（dsh-core）目前 bwrap 单档：部署探针只测存在性（`src/core-deploy.ts` `command -v bwrap`），
「装了但用不了」（Docker 禁非特权 userns、seccomp 拦 `clone`）要到围栏执行时才裸报错（REQ-I29 的主体）。

## 2. 宿主本尊怎么做（蓝本）

| 事实 | 出处（0.2.0-rc.2 快照） |
|---|---|
| 沙箱包族 | `dsh-sandbox`（roots 真相源 + fail-closed）、`dsh-sandbox-local`（runner 链）、`dsh-sandbox-policy`、`dsh-bash-sandbox`、`dsh-pwsh-sandbox`、`dsh-sandbox-windows-acl` |
| Linux 链 | `dsh-sandbox-local`：`linux: ["bwrap", "landlock"]`——按平台先选，链内多候选才探测（单候选平台不探测） |
| bwrap 优先理由 | 包内注释：mount profile 最贴近 mode 词表（bind mount 忠实表达 read-only / workspace-write） |
| 功能探测 | `defaultProbeBwrap`：`spawnSync("bwrap", [...bwrapProfileArgs({ mode: 'read-only', workspaceRoot: '/' }), '--', 'true']).status === 0`，结果有缓存；Seatbelt / WindowsAcl 探测同形 |
| bwrap 来源 | 裸命令名走 PATH——**系统依赖**，宿主不分发 |
| Landlock 来源 | `landlock-run` 启动器随 `@deepseek-ai/node-addon-system-<platform>-<arch>` 平台包分发（npm `os`/`cpu` 过滤，esbuild 式模型）；`LAUNCHER_FAILURE_EXIT = 125`；旧 ABI 报 `partial enforcement (older Landlock ABI)` |
| fail-closed | `dsh-sandbox` `SANDBOX_UNAVAILABLE`：拒绝无围栏运行 + 列全各平台出路（装 bubblewrap / Landlock 内核 / sandbox-exec / ACL runner / 切 danger-full-access） |

要点：**探测是「真跑一次最小 profile」而非存在性检查**；降档链 + 自带 Landlock 兜底 + fail-closed 文案
三层合起来才是完整容错。Landlock 是无特权 LSM（内核 ≥5.13，无需 userns / setuid / 特权）——恰好覆盖
bwrap 跑不了的那批 Docker 场景，这是把它选为远端兜底的技术根据。

## 3. 对 dsh-core 的落地方向（REQ-I30）

- Go 侧用 `go-landlock`（Landlock 官方生态维护）或直接 LSM UAPI；按内核 ABI 探测能力建规则集，降级如实报。
- 与 `src/remote-sandbox.ts` 现有 `bwrapProfileArgs` drift 对齐并存：bwrap 档不动，Landlock 是后备档。
- 表达力差要诚实：无挂载重建（tmpfs 盖 `/tmp`）、无 PID 隔离——对齐宿主「per-runner 差异如实记录」的纪律（sandbox RFC 落语）。

## 4. 对照：ZCode 远程开发（非蓝本）

ZCode 桌面版远端**无 OS 级沙箱**：工具级 `permissionMode` / `approvalPolicy` 门控 + 环境本身当边界；
运行时全套自带（`node-runtime` / `node-pty` / `glm` 按 platformArch 从 CDN 或本地 SFTP 进 `~/.zcode/server`，
远端只要求 POSIX shell）。取舍不同：他们放弃远端强制围栏，我们保留——因此 bwrap 可用性问题必须在我们这侧解决，
不是可以绕开的问题。
