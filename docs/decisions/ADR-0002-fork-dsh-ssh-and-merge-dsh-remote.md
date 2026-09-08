# ADR-0002: 以 dsh-ssh 为 base 二次开发、合并 dsh-remote
- 状态: accepted
- 日期: 2026-08（R0.5/R0.6 完成于 2026-08；具体日来源未明确）

## 背景

两个社区插件功能重叠但模型不同：`dsh-ssh`（UynajGI，v0.3.0-pre，TS）是**接缝引擎**——实现
`ctx.subprocess` / `ctx.fs` 的远程 provider，让官方 bash/文件/终端/LSP 工具零改动跑在远端；
`dsh-remote`（flymysql，v0.8.7，纯 ESM JS）是**平行工具集**——不碰接缝，维护 21 个 `rw_*` 工具 +
本地镜像 + 同步。二者在同一 UI 槽位、同一状态目录上冲突（`drafts/CONTEXT.md` §3.3、
`drafts/features-breakdown.md` §3/§4）。

## 决定

- **以 `dsh-ssh` 为 base 二次开发**，保留其接缝引擎；从 `dsh-remote` 移植机器层（machines 注册表）、
  TOFU 主机指纹、OS 钥匙串等（`drafts/CONTEXT.md` §5「二开路线」、`drafts/features-breakdown.md` §4）。
- **工程形态 TS + `tsc` + `tsdown`**（dsh-ssh 式）：宿主编到 `lib/`，客户端 `src/client/` 由 tsdown 打包为
  `lib/client.js`（`AGENTS.md` §2、`src/plugin.ts` 文件头、`tsdown.config.ts`）。
- 迁移方式为**按文件摘录 + 自行重构**，不整库照搬上游。

## 后果

- R0.5（dsh-ssh 精简版独立落地）：删死代码（`filesystem.ts` / `filesystem-routed.ts` / `invariant.ts`）、
  提取 `src/ssh-core.ts`（runtime 532→263、connection 365→176）与 `src/listing.ts` 共享 `listRemoteLevel`、
  统一 `hostVerifierFor`（`drafts/CONTEXT.md` §6.1-1a、`drafts/features-breakdown.md` §5）。
- R0.6（dsh-remote 最小合并）：并入 TOFU、keychain、machines 注册表、设置页、3 个 `sw_*` 工具；
  同时全砍镜像/同步、审计、端口转发（延后）、其余 15 个 `rw_*`、内嵌侧边栏、更新检查、双 tab 选择器、
  23 个 HTTP 路由（统一 RPC 通道）（`drafts/CONTEXT.md` §6.1-1c）。
- 模型心智只有一套：远程文件/命令走官方工具，`rw_*` 不再平行存在（`drafts/features-breakdown.md` §4 工具集行）。
- 上游快照存在风险：dsh-ssh main（0.3.0-pre）曾有不能过 typecheck 的文件，故不整库照搬
  （`drafts/features-breakdown.md` §5 末尾）。

## 被否方案

- **以 dsh-remote 为 base**：其「平行 `rw_*` + 本地镜像」与「引擎走 DSH 能力接缝」的核心原则冲突
  （`drafts/CONTEXT.md` §1、§3.3）。
- **两插件相加/并存**：同一 `directoryFlow` 槽位不能并存，且各有一套连接管理与状态目录
  （`drafts/features-breakdown.md` §3）。
- **整库照搬上游代码**：上游处于重构中间态，无法通过 typecheck（`drafts/features-breakdown.md` §5 末尾）。
