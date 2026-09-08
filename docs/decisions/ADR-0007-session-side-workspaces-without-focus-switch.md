# ADR-0007: 会话关联副工作区——不做焦点切换、主 cwd 不变、副目录语义
- 状态: accepted
- 日期: 2026-08-25

## 背景

原始想法是「一个 session 添加多个工作区，并有**焦点工作区**（可以是远程的）」（`drafts/ideas.md` I3）。
侦察得到的硬约束（磁盘权威源）：

- `dsh-session` 的 `SessionHeader.cwd` 是**不可变**字段（创建时写入）；
- `dsh-workspace` 的注册表归属 = `canonical(session.header.cwd) === workspace.path`，即
  「1 session → 1 canonical cwd → 1 workspace」，多工作区 per session 无法用 core 表达；
- `dsh-permission-presets` 的 `sandbox/mode` 是**每会话一个** knob，不能复用为逐工作区权限。

结论：走**插件自持状态 + 混合门面**（R4 已使本插件成为 `ctx.subprocess` / `ctx.fs` 的唯一实现）
（`drafts/r5-design.md` §2）。

## 决定

2026-08-25 用户拍板（`drafts/ideas.md` I3「拍板修正」、`drafts/r5-design.md` §1）：

- **不做焦点切换**（用户原话：「暂时不用切换」）；
- **主工作区保持单一**，`session.header.cwd` 语义与 core 完全不动；
- 其他工作区作为**副工作区（副目录）**：本地绝对目录或远程目录（机器 + POSIX 路径），
  作用是「告诉模型可以把手伸到这里操作」的附加根；
- 本地与远程工作区都参与；状态由插件自持（`<dsh home>/dsw-session-workspaces.json`，
  `roots` 全局唯一 + `sessions` 账户），路由用最长前缀匹配（`sideWorkspaceOf`）。

## 后果

- 不动 core / 上游；实体、权限与路由索引全在插件侧（`src/session-workspaces.ts`、`src/mixed.ts`）。
- `roots` 全局唯一 ⇒ **一个目录只有一份权限记录**：两个会话挂同一目录会共享其 `fs` / `exec` 档位
  （`src/session-workspaces.ts` 文件头）。
- UI 只有标题栏「工作区」按钮 + 面板（`conversation.session.header.actions` 槽位）；
  会话栏副工作区徽标**延后**（需按 sessionId 反查附件状态），也不做焦点指示（`drafts/r5-design.md` §7）。
- 提示注入扩展为「主工作区行 + 副工作区清单」；无副工作区时零注入
  （`drafts/r5-design.md` §6、`src/tools.ts`）。

## 被否方案

- **改 `session.header` 形状以表达多工作区**：需要动 core，越权（`drafts/r5-design.md` §2）。
- **复用 `sandbox/mode` 做逐工作区权限**：它是每会话一个 knob（同上）。
- **焦点切换**：用户明确不做（`drafts/ideas.md` I3 拍板记录）。
