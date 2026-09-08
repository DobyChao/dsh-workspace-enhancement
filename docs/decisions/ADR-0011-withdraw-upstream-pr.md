# ADR-0011: 上游 PR 撤销（行级徽标改由 DOM 增辉层承担）
- 状态: accepted
- 日期: 2026-08-23（需求确认结论）

## 背景

会话栏（`sidebar.workspaces` 槽）是主要的工作区/会话入口，但**行级没有任何可注入点**。
为了在行上显示「该工作区是远程 / 是否在线」，本插件 R2 先用 DOM 增辉兼容层实现
（`src/client/row-badges.ts`：MutationObserver 扫描 + 按标题文本匹配 + 三态徽标 + 重连按钮）。
同时起草了给官方 `dsh-client-ui-workspace` 增加两个行/组头 `list/root` 子槽位的 PR 草案
（`drafts/upstream-pr-b3.md`，预估 <80 行），目标是把 DOM hack 升级为正式注入点。

## 决定

**撤销上游 PR 计划**：上游（`deepseek-ai/deepseek-harness`）当前**不接受 PR** → B3 草案
（`drafts/upstream-pr-b3.md`）存档、暂不提交；**行级徽标继续由本插件的 DOM 增辉层承担**
（`drafts/ideas.md`「需求确认结论（2026-08-23 用户拍板）」A2 撤销；`CHANGELOG.md` 0.1.0
「已知边界」；`docs/ROADMAP.md`「已关闭 / 撤销」）。

## 后果

- `row-badges.ts` 成为长期组件，其降级契约全部保留：DOM 形状不符 → 扫描空转并闩锁；未知 id / RPC 失败 →
  徽标停在 `unknown`；单一状态标记幂等、不重复插行；自诱扫描过滤；**同名不误标**（标题同时属于本地工作区/会话
  即跳过——缺徽标是可接受代价，误标不是）；重建「先清后标」（`src/client/row-badges.ts` 文件头）。
- A1 抛光轮因此新增子项「C3 同名误标修复」（`drafts/ideas.md` A2 撤销条）。
- 草案仍可直接复用：上游若将来接受 PR，可删除 DOM 层改为槽位注入，后端
  `/dsw/conn.{status,probe,reconnect}` 已具备（`drafts/upstream-pr-b3.md`「消费示例」）。

## 被否方案

- **提交 PR 并等待上游**：用户拍板撤销（上游当前不接受 PR）。
- **不做行级徽标**：会话栏远程标识与三态徽标是 R2 已交付能力，放弃等于回退需求
  （`drafts/CONTEXT.md` §6.2 R2 行）。
