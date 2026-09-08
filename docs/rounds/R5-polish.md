# R5 打磨 — 三轮抛光（UI 主题化 / 浏览方案一 / README 品类化）

## 目标

R5 上线后的三轮打磨（2026-08-26）：① **副工作区面板 UI 抛光**——主题 token 化 + 复用「添加工作区」
flow 的目录选择器；② **浏览交互方案一**——picker 定位到所选机器、**只回填**，挂载成为唯一提交入口；
③ **README（EN/ZH）品类化 + 人性化**。
需求 ID：CONTEXT §7「R5 副工作区面板 UI」三问 / ROADMAP「打磨」行。

## 拆解

### ① `r5-polish-team`（角色：engineer / hostfixer / reviewer / e2e / writer）

| 任务 | 角色 | 依赖 | 内容 |
|---|---|---|---|
| t1 | engineer | — | 面板主题化 + 复用 flow 目录选择 |
| t2 | hostfixer | — | 宿主：`session.ws.add` 接受占位拼写并规范化 |
| t3 | reviewer | t1 + t2 | 评审 UI 抛光代码 |
| t4 | e2e | t3 | lab E2E：主题双模式 + 新选择器回归 |
| t5 | writer | t3 + t4 | 文档同步 + 提交推送 |
| t6 | engineer | — | flow 加 `suppressSessionRoute` opt-out + 面板分类 + 文案 |
| t7 | reviewer | t6 | 复验 t6 `suppressSessionRoute` |

### ② `r5-browse-fix-team`（角色：engineer / reviewer / e2e / writer）

| 任务 | 角色 | 依赖 | 内容 |
|---|---|---|---|
| t1 | engineer | — | flow 定位机器 + `pickOnly`；面板回填化 |
| t2 | reviewer | t1 | 评审方案一实现 |
| t3 | e2e | t2 | lab E2E：picker 定位 / 回填 / 挂载三段式 |
| t4 | writer | t2 + t3 | 方案一文档 + 提交推送 |

### ③ README 品类化 / 人性化

无 AgentTeams 归档 —— **来源不足**（仅 ROADMAP 与 CONTEXT 的结果性记录：README EN/ZH 品类化 +
humanizer-zh 人性化，含在 2026-08-26 的打磨批内）。

## 验证

- **① UI 抛光**：单测 175/175（172 基线 + 3 条 `remoteSideRootKey` 用例）；typecheck 0 错误；
  t3 **APPROVE**（1 个待确认设计观察 + 2 个不影响合并的 nit）；t4 E2E 38 断言 36 PASS / 2 FAIL
  （均为浅色对比度次要问题）→ 扩展轮 **43/43 全 PASS**（对比度实测 4.91 / 9.15 / 4.91）；
  t7 复验 **APPROVE**（`suppressSessionRoute` 默认 `false` 时与现状逐字等价；`true` 时跳过占位树
  mkdir 与机器工作区写回）。
- **② 方案一**：t2 **needs-fix**（阻断项 F1：`path.slice(7)` 差一错误——`ssh://` 只有 6 字符，
  会吞掉机器 id 首字符；+ 1 副项）→ 修复后复验 approve；t3 E2E 28 步 **27 PASS**
  （唯一 F7 为首轮脚本半成品遗留的旧会话账户，非 UI 缺陷）；提交前 typecheck 0 错误、
  单测 175/175。
- **端到端一致性**：`machines.json` 的 `workspace` / `recentWorkspaces` / `cwd` 前后逐项一致
  （方案一不写回机器工作区）；占位树文件清单前后一致。

## 结果

- 交付：`side-workspaces.module.css`（与 `flow.module.css` 同构的 token 化样式，读宿主自定义属性 +
  `color-mix` 派生 + `@media light` 覆盖）、面板整机复用 `SshWorkspaceFlow`（`suppressSessionRoute`
  opt-out）、`flow.tsx` 新增 `initialConnectionId`（打开即定位所选机器）与 `pickOnly`
  （页脚「选择此目录」+ 直接 `onPicked('ssh://<id><path>')`）、面板 `handlePicked` 改纯回填。
- 提交：`9b38349`（fix: R5 side-workspace panel follows theme and reuses the add-workspace directory
  picker，6 文件 +614/−178）、`8fad1fa`（fix: side-workspace picker now locates the selected machine
  and only refills the path field，+107/−42）；均已 push `main` 并部署。
- 心智模型确立：「**浏览 = 辅助填写 → 挂载 = 提交**」。

## 遗留

- 面板「浏览」输入框去留待评估（方案二，等用户用几天）——CONTEXT §0/§7。
- 会话栏副工作区徽标仍延后。
- README 打磨轮无归档，任务拆分与角色不可考（来源不足）。
- 后续轮引用：A3（发布 v0.1.0）、R6 I18N（面板/徽标文案键化）。

来源：`.agent-teams/archive/r5-polish-team/team.json`、`.agent-teams/archive/r5-browse-fix-team/team.json` + 各自 `inbox/captain.jsonl`；`drafts/CONTEXT.md` §0/§7；`docs/ROADMAP.md`
