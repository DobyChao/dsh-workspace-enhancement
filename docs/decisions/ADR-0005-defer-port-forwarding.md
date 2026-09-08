# ADR-0005: 端口转发延后
- 状态: accepted
- 日期: 2026-08（`drafts/CONTEXT.md` §5.10 决策；具体日来源未明确）

## 背景

`dsh-remote` 带 `ForwardManager`：local / reverse 隧道增删 + `autoStart` + 状态展示，并有
`rw_forward` 工具与 `/dsh-remote/forwards` 路由（`drafts/features-breakdown.md` §2.9、§2.8.2、§2.5）。
合并映射表曾把它列为 ➕ 移植项（`drafts/features-breakdown.md` §4「端口转发」行）。

## 决定

**延后**——独立价值但非工作区核心，本次未移植（`drafts/CONTEXT.md` §5.10）。

## 后果

- v1 没有 `sw_forward` 工具、没有转发管理 UI、没有 `forwards.json`（`drafts/CONTEXT.md` §5.10；
  R0.6「全砍」清单见 §6.1-1c）。
- 端口转发作为 **A4** 里程碑排在 R6 I1 之后（`drafts/CONTEXT.md` §0「未做」、§6.2 A4 行、
  `docs/ROADMAP.md`「下一步」）。
- 将来落地时按 dsh-remote 的 local/reverse + `autoStart` 语义移植（`docs/ROADMAP.md` A4 备注）。

## 被否方案

- **随 R0.6 一并移植**：判断为「非工作区核心」，会让最小合并包变重（`drafts/CONTEXT.md` §5.10）。
- **永久放弃**：未否决——它是明确排期的后续里程碑（A4），不是砍掉的功能。
