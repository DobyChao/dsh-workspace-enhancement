# R45 — REQ-I14 + REQ-I17：核心版本门 + 部署无感化（+INFRA-22 折入）

> 一轮 = 一条指令（完成 REQ-I14+REQ-I17）= 一个 PR（#54，squash `49f8755`）；同会话折入
> INFRA-22（backlog 表格断行闸门）。日期：2026-09-29/30。开工 preflight 全绿（50599 被占 =
> lab 在跑，非缺失）。

## 1. 交付（PR #54）

- **REQ-I17 版本门（fail-closed）**：`core-hub` 的 open 在 proto/caps 之后校验 `hello.version`，
  不符即 `SANDBOX_UNAVAILABLE`（`REMOTE_SANDBOX_MESSAGES.coreVersionMismatch`，带实测/期望版本
  + 部署指引）；拒绝进 `blocked` 缓存（close/deploy 清）；**活会话复用读缓存 hello 比对**
  （零 RPC），过期 serve 丢弃重 exec；danger/off 经 `CoreMissingError` 落 SFTP，绝不跑旧核。
- **REQ-I14 三件**（`src/core-provision.ts`）：
  - 探测翻链：`coreInstallScript` 在 `ln -sfn current` 前先探 `<version>/dsh-core version`
    （退出 0 才翻）——坏工件搁浅不了机器；
  - 连接预热：围栏机器连进会话（sw_connect / session.conn.*）触发后台 status→deploy
    （fire-and-forget、按机去重、失败仅告警）——**此形态次日即被 REQ-I21 重塑**（见 R46）；
  - 首用审批：confined open 撞上磁盘工件确证缺失/过期时经平台 approval 问一次
    （`[dsw-core-deploy]` 标记，刻意非 AI 应答器 gate 标记），allowed-once 才部署并重试一次。
- **INFRA-22**：`auditBacklog` 加表格连续块 + 连续空行两条规则（HEAD 里 ba56c88 带入的 §2 断行
  对旧解析器不可见），修掉断行与双空行 +3 用例。
- ADR-0024 §3/§6.1 修订（部署无感化条目 + 自动安装行）；CHANGELOG Unreleased。

## 2. 验证

- check:static / typecheck / test:agent（610 例）/ build / WSL verify-linux / 真 boot 哨兵
  （0.2.0-rc.2 全局 CLI）SMOKE PASS；CI 四档绿（首红：asker 测试在 CI 无 core/dist 时跑真
  deployCore——改注入式 deploy 封闭）。
- lab：0.2.0-rc.2 宿主装 pack tarball（pnpm 167 包无 peer 拒）+ 通道 `core.status` 真机应答。

## 3. 教训

- **doc 表格编辑后必须 diff 复查**：给 compatibility.md 加行时误把历史行替换掉，diff 复查救回
  （R41–R43 doc-edit 教训的手工面）。
- 会话转录是排障金矿：zstd 多帧逐帧解出后，`approval/asked` 审计对的**缺失**直接证明了
  `request()` 未被调用（这条方法论 R46 靠它定位双根因）。
