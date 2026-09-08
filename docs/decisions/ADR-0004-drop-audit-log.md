# ADR-0004: 审计日志砍掉（会话轨迹替代）
- 状态: accepted
- 日期: 2026-08（`drafts/CONTEXT.md` §5.9 决策；具体日来源未明确）

## 背景

`dsh-remote` 有独立审计设施：把 exec / write / mkdir / remove / connect 追加到
`remote-workspaces/audit.log`（`auditLog` 开关），并在设置页展示最近 30 条
（`drafts/features-breakdown.md` §2.9、§2.8.3）。合并草案的「附加能力」一行曾把审计列为**保留**
（`drafts/CONTEXT.md` §3.3）。

## 决定

**砍掉审计日志**——用户判断会话轨迹已经能说明在干什么（工具调用都在对话历史上）
（`drafts/CONTEXT.md` §5.9；`CHANGELOG.md` 0.1.0「已知边界」）。

## 后果

- 不产生独立审计文件，也没有审计 UI；审计诉求由会话轨迹/对话历史承担。
- 状态目录因此只有 `machines.json`、`known_hosts.json`、`.secrets/` 与
  `dsw-session-workspaces.json`，没有 `audit.log`（`src/registry.ts`、`src/hostkey.ts`、
  `src/session-workspaces.ts`）。
- 合并映射表里「审计 ➕ 覆盖 exec/文件写/连接」一行作废（`drafts/features-breakdown.md` §4）。

## 被否方案

- **移植 `audit.log`**（草案保留项）：会话轨迹已覆盖同样的信息，收益不值额外文件与 UI。
- 同轮一并裁掉的相邻可选项：**更新检查**（轮询 npm registry，噪音与风险不值）与**编码**
  （`iconv-lite` 未移植，引擎以 UTF-8 为主）（`drafts/CONTEXT.md` §5.6、
  `drafts/features-breakdown.md` §4「更新检查 / 编码」行）。
