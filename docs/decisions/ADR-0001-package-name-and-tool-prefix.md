# ADR-0001: 包名 `dsh-workspace-enhancement` 与工具前缀 `sw_`
- 状态: accepted
- 日期: 2026-08（用户会话拍板；具体日来源未明确）

## 背景

合并后的插件需要一个 npm 包名与一套模型可见的工具命名。历史合并草案里工具名一度写作
`ws_status` / `ws_connect` / `ws_pick_workspace` / `ws_sync` / `ws_push` / `ws_forward`，并明确标注
「命名待定」（`drafts/CONTEXT.md` §4.3）。包名需要先在 npm 上确认可用性，否则要退「前端加后缀」方案
（`drafts/CONTEXT.md` §5 注）。

## 决定

- 包名 **`dsh-workspace-enhancement`**（沿用工作区文件夹名，即「工作区增强」）。
- 模型工具前缀 **`sw_`**，例如 `sw_status`、`sw_connect`、`sw_pick_workspace`（`drafts/CONTEXT.md` §5「已由用户确认」）。

## 后果

- npm 上可用并已发布：`dsh-workspace-enhancement@0.1.0`（2026-08-26）、`0.1.1`、`0.1.2`（`CHANGELOG.md`）。
- 同一品牌前缀贯穿全仓：RPC 通道 `/dsw`、占位目录根 `dsw-routes`、错误前缀 `dsw:`、DOM 标记 `data-dsw-*`、
  国际化命名空间 `dsw`（`drafts/CONTEXT.md` §0、§5.12；`src/client/index.ts`、`src/transport.ts`）。
- 工具集最终形态：`sw_status` / `sw_connect` / `sw_pick_workspace`（`src/tools.ts`）+ `sw_exec`
  （`src/exec-tools.ts`，S1 于 2026-08-27 加入）。
- 若与未来官方工具命名冲突，`sw_` 前缀本身就是隔离手段（`drafts/sw-exec-requirement.md` §6.4）。

## 被否方案

- **`ws_*` 前缀**：只出现在合并历史草案里（标注「命名待定」），被 §5 的 `sw_` 取代，未采用。
- **包名加后缀（如 `dsh-workspace-enhancement-x`）**：仅作为 npm 不可用时的退路预先记录；实际 npm 可用，
  该退路未触发（`drafts/CONTEXT.md` §5 注、`CHANGELOG.md` 0.1.0 发布记录）。
