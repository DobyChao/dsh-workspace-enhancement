# ADR-0025: 远端权限对齐会话 `/permission` 与官方提权

- 状态: accepted
- 日期: 2026-09-14
- 范围: 远程 `ctx.fs` / spawn / browse 的运输与权限拆分；取消远程会话
  `danger-full-access` 钉档；核心 `--sandbox` 跟本次 `SandboxExecutionPolicy`
- 关联: 承接 **REQ-I13**；运输与寿命仍认 **ADR-0024**；废止 **ADR-0022 D9**
  「`/permission` 只影响本地、`remoteSandbox` 是权限轴」；提示词改写触及
  **ADR-0020 D6** 的 `remoteNoSandbox` 句（语义被本 ADR 取代，不是删审批门）

## 0. 结论

远端与本地同一套权限：会话 `/permission` + 官方工具的 `sandbox_permissions`
单次提权。有可用 Linux 核心时，fs / spawn / browse **都走核心 RPC**；核心按本次
policy 选 `--sandbox read-only|workspace-write|off`（`off` = 本地
`danger-full-access`，不进 bwrap）。无核心且本次仍是围栏档 → **写面与 spawn fail-closed**，读面**可见降级**到 SFTP
（REQ-I15）。无核心且本次是 danger → 今天的 SFTP + 裸 SSH。

机器字段 `remoteSandbox` **不再当权限或切流开关**（可读可忽略，不必强制迁移）。

## 1. 为什么要改

本地 workspace-write 越界会 `FS_SANDBOX_DENIED` + 提权 hint，模型带
`sandbox_permissions` 重试，人审 `allowed-once` 只放宽**这一次**。

远端把这条链掐死了：

1. `forceRemoteSandboxMode` 把远程会话钉成 `danger-full-access`，工具层不再出提权卡
   （当初是为了不让本机 `bash-sandbox` 把 bwrap 塞进远端 argv）。
2. 混合 fs 丢掉远程 `sandboxPolicy`；切流只看机器 `remoteSandbox`。核心装了但档位
   `off` 仍走 SFTP。

操作者拍板（2026-09-14）：**不要机器上限**，只认会话档 + 官方提权卡。

## 2. 决定

1. **运输 vs 权限**
   - 运输：核心探针通过 → 走 RPC。失败且本次围栏档 → 写 / spawn
     `SANDBOX_UNAVAILABLE`；**读面**（`resolve` / `stat` / `lstat` / `read*` /
     `listDir`）降到 SFTP，让宿主静默项目根探测和官方 Read 仍能工作（REQ-I15，
     2026-09-19）。失败且本次 danger → SFTP/SSH。
   - 权限：`ctx.sandboxPolicy.resolve()` 与写接口上盖上的 `sandboxPolicy`。
     `danger-full-access` → `dsh-core serve --sandbox off`。
2. **取消钉档**。远程会话不再写 `sandbox/mode=danger-full-access`。部署默认
   `{workspace-write, ask}` 对远程会话也成立（composer 不再因 `{danger, ask}` 显示
   Custom；ADR-0015 / UX-1 的根因消失）。
3. **远程感知的 `confine` 短路**。发起会话 cwd 是远程路由时，`ctx.sandbox.confine`
   返回原 argv（enforcement `full`），这样拿掉钉档后本机 runner 仍不会进入远端命令行。
   本地会话仍走原来的 provider。官方提权发生在 confine **之前**，短路不跳过弹卡。
4. **Windows / 非 amd64 / 未部署**：无核心。围栏档的远程写与 spawn 拒绝；danger
   保持 SFTP+SSH。不在本轮做 Windows 核心。
5. **设置页** `remoteSandbox` 下拉不再作为权限控件（文案改为遗留/忽略）。部署核心按钮保留。
6. **`remoteApproval` 仍可选、默认 `off`**。本地 workspace-write 只在提权时弹卡；
   要对齐就不要默认开 `human`。两门同时开会弹两张卡。
7. **交互终端**在会话围栏档仍拒绝。danger 是否放开未围栏 PTY 本轮不做。
8. **拒写**映射为 `FS_SANDBOX_DENIED`，文案含上游 `sandboxDenialMarker`，以便官方
   fs 工具走同一条提权重试。
9. **核心缺失时，只读的静默探测走 SFTP（REQ-I15，取代本条原选项 A）**。
   宿主首次上下文装配会跑上游的项目根探测（`dsh-agent-instructions` /
   `dsh-skill-filesystem` 的 `findProjectRoot` → `fs.resolve` + `fs.stat`，**不带 cwd**）。
   2026-09-17 的选项 A 把这次探测也 fail-closed，结果是**连纯聊天都进不去**。
   REQ-I15 改为：读面降 SFTP（项目根能找到、官方 Read 能用）；写 / bash 仍
   `SANDBOX_UNAVAILABLE`，拒绝文案继续点名缺失物（`fenceMissingHint`）。
   模型提示 `remoteNoSandbox` 写明这条拆分，避免「看起来已围栏其实读面未围」。

## 3. 不做

- 不随连接自动安装核心。
- 不把 `/permission` 与机器围栏做成双重上限。
- 不改 3080 / 产品 profile。

## 4. 验收

见 `docs/uat/R27-req-i13-remote-session-sandbox.md`（与 REQ-I5 **合验**；原 R26 脚本已作废）。关键：工作区外官方 write 失败且
带提权标记；提权允许后成功；无核心 + workspace-write **写 / bash 不走 SFTP**；无核心时官方 Read 与聊天仍可用（REQ-I15，`docs/uat/R35-req-i15-i16.md`）。
