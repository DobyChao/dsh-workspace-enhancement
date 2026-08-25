# Roadmap — dsh-workspace-enhancement

> 公开路线图：当前状态、已完成轮次、剩余排期。简练概览见 [README](../README.md)。
> 内部研究/设计草稿（仓库本地，不入库）在 `drafts/`；本文件只陈述结果性进度。

## 当前状态（2026-08-25）

- **已完成 R0.5–R4 六轮，全部上线本地运行实例（profile web），并逐轮验证**：
  引擎（`ctx.subprocess` / `ctx.fs` 混合 provider，按工作目录路由本地/远程）、
  machines 注册表 + 路由（`ssh://<id>/<path>`）、TOFU 主机指纹（默认 accept-new）、
  OS 钥匙串（DPAPI / security / secret-tool）、共享机器表单、会话栏远程标识与三态徽标、
  3 个 `sw_*` 模型工具、每个会话的远程认知提示、远程执行适配
  （命令 / 文件读写 / 覆盖编辑在远程全程可测）。
- **质量**：单测 134/134，typecheck 0 错误；每轮 AgentTeams 评审 + E2E 验证 + 真实实例运行态验证。
- **已知环境要求**：远端需装 pwsh（模型 PowerShell 工具）与 ripgrep（glob）；终端（bash）开箱即用。

## 下一步

| 序 | 里程碑 | 目标 | 前置/备注 |
|---|---|---|---|
| 1 | **R5**（Idea I3） | 一个 session 支持**多工作区** + **焦点工作区**（可远程）+ **逐工作区权限** | 需先做 DSH core 模型侦察（当前 core 是 1 session → 1 workspace：扩展还是改上游），拆侦察/设计/实现 |
| 2 | **R6**（Idea I1） | 对话/轨迹区**可扩展面板 Tab**（better-sidecar 式，可插多个面板） | 需前端槽位侦察（以官方 slot 对接，不侵入第三方插件） |
| 3 | A3 | 发布 npm（`dsh-workspace-enhancement`） | 先查名是否可用；补 v0.1.0 tag + CHANGELOG |
| 4 | A4 | 端口转发（local/reverse + autoStart） | 移植 dsh-remote forwards 语义 |
| 5 | A5 | 顺手清理（旧路由占位树的人工清理说明、本地数据归档盘点） | 极小 |

## 已关闭 / 撤销

- **A2**：向 deepseek-harness 上游提 PR —— **撤销**（上游当前不接受 PR；行级徽标改由本插件的 DOM 增辉层承担，草案存档于本地草稿）。
- **镜像/同步、审计日志**：已明确**不做**（决策记录：镜像放弃；审计由会话轨迹替代）。
- **I5**（远期愿景）：vscode-server 式「把部分 DSH 能力部署到远端」——仅愿景备忘，未排期。

## 已完成轮次（简表）

| 轮 | 内容 | 状态 |
|---|---|---|
| R0.5 | dsh-ssh 精简引擎独立落地（provider 重构、死代码清除） | ✅ 上线 |
| R0.6 | dsh-remote 最小合并（TOFU、钥匙串、机器注册表、设置页、`sw_*` 工具） | ✅ 上线 |
| R1 | 更名抛光（`/dsw` 渠道、`dsw:` 前缀、dsw-routes 新根 + 旧树兼容、边界清理） | ✅ 上线 |
| R2 | UI 统一（共享机器表单 + 会话栏远程标识/三态/重连） | ✅ 上线 |
| R3 | A1 抛光轮（表单交互守卫/缓存一致性/同名误标等） | ✅ 上线 |
| R4 | I2+I4 并轨（远程认知提示 + 混合 provider 真实远程执行 + 执行适配 + 覆盖/编辑修复） | ✅ 上线 |

> 每轮的完整事实记录（部署验证、已知边界、决策背景）在仓库本地草稿 `drafts/CONTEXT.md`
> （不入库）；想法与拍板在 `drafts/ideas.md`。
