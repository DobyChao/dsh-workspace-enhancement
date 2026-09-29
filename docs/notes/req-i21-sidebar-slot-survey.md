# 侧栏工作区行插槽调查（2026-09-29，子代理调查归档）

> 问题：左侧栏「工作区」分组里每个远程工作区行上的连接状态控件位置，最新版（0.2.0-rc.1）有没有
> 官方客户端 slot？证据：0.2.0-rc.1 全局安装树 runner/ui-workspace bundle、0.1.7-rc.2 对照
> （npm 拉取临时快照）、`scripts/slot-catalog.mjs --diff`、0.1.5-rc.2 真实 tarball 验证。
> 行号归属各处注明的 bundle，不可跨快照互换。

## 结论

1. **工作区分组行（截图位置）：无官方 slot**——`dsh-client-ui-workspace` 的 `ProjectRowItem`
   零 `renderSlot` 调用；行尾 "..." 菜单是硬编码数组（仅 rename/delete）。0.1.5 / 0.1.7 / 0.2.0
   三代都没有分组行级槽位。整区域槽 `sidebar.workspaces`（single，occupant=宿主
   `WorkspaceBrowser`，replaceRisk=shadows-shipped-ui）是"换掉整个浏览器"级别，非行级。
2. **截图控件是我们自己的**：`src/client/row-badges.ts` `buildBadge()`（globe + 圆点 + 「未检测」
   label + 「重新检测」按钮，文案 `dsw.ts:333-345`）。宿主 0.2.0 树 grep 这些字符串零命中。
3. **Session 行（分组内子会话行）0.1.7 起有 4 个官方槽**（0.2.0-rc.1 runner bundle `CLIENT_SLOT_API`）：
   - `sidebar.session.row.leading`（list，标题前 16px 前导格；仅 idle 行挂载，archived 留白）
   - `sidebar.session.row.hover`（list，悬停卡内相对时间与状态行之间）
   - `sidebar.workspaces.session.menu.item`（list，"..." 菜单行；宿主自带项 order 100–400）
   - `sidebar.workspaces.session.row.action`（list，行尾悬停按钮条；ownerProps `sessionId`+`displayTitle`）
4. **0.1.7-rc.2 → 0.2.0-rc.1 该区域零新增**（slot diff：89→89 键，ADDED/REMOVED=0）。sidebar 的
   真正扩张在 0.1.5→0.1.7（13→23 键，含上述 4 个 session 行槽）。
5. **稳定 DOM 锚**：0.1.7 起分组行带 `data-row-key="workspace:<workspaceId>"`、Session 行带
   `session:<sessionId>`（0.2.0 ui-workspace bundle `buildGroup(workspace.workspaceId, …)`）；
   0.1.5 无（有 treeitem 角色无 data-row-key）。

## 机会（待拍板）

- **A（低垂果实）**：row-badges 分组行匹配从标题匹配升级为 `data-row-key` 键匹配（0.1.7+/0.2.0），
  0.1.5 回退标题——消掉 C3 同名护栏类脆弱性；两代目标家族都已有锚。
- **B（部分迁官方槽）**：Session 行徽章迁 `sidebar.session.row.hover`（完整三态+重检）与
  `sidebar.workspaces.session.row.action`（重连小按钮）；`leading` 只放得下点/图标。分组行本身
  仍无槽（DOM 增辉保留）。注意：已发布 0.2.2（pin `^0.1.5-rc.1`）无这些槽——迁移只进联合双家族线。
- 顺手：row-badges.ts 头注释「no per-row slot」改为「分组行无槽；Session 行 0.1.7 起 4 槽」。
