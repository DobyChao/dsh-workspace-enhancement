# 上游 PR 草案：ui-workspace 会话栏行级 meta 槽位（B3）

> 目标：给 DSH 官方 `packages/client/ui-workspace`（@deepseek-ai/dsh-client-ui-workspace）
> 的会话栏**行/组头**增加两个 `list/root` 子槽位，供插件（如 dsh-workspace-enhancement）
> 在会话列表行注入自定义徽标（远程标识、在线状态、重连按钮）——替换我们当前的
> DOM 增辉兼容层（`src/client/row-badges.ts`），从「按标题文本匹配行」升级为正式注入点。
> 本文档由 R2 侦察与实现归纳（证据：ui-workspace 0.1.1-rc.2 磁盘源码），供提交 PR 用。

## 动机

左侧会话栏（WorkspaceBrowser，`sidebar.workspaces` 槽）是 DSH 用户主要的
工作区/会话入口，但行级没有任何可注入点。第三方工作区类插件（远程、云、容器等）
需要在行上显示「该工作区是什么类型 / 是否在线」等标记，只能靠 DOM hack
（按标题文本匹配 + MutationObserver）——脆弱且与 React 行渲染耦合。

## 改动（预估 <80 行）

### 1) 声明两个子槽（`src/client/contract/slots.ts` 的 SlotMap declare 块）

```ts
'sidebar.workspaces.sessionRow.meta': {
  kind: 'list'; scope: 'root'
  owner: { sessionId: string; title: string; workspaceId?: string }
}
'sidebar.workspaces.workspaceHeader.meta': {
  kind: 'list'; scope: 'root'
  owner: { workspaceId?: string; cwd?: string; title: string }
}
```

### 2) `WorkspaceBrowser` 注册 children 表加两行

在 `ctx.slots.register({ name: 'sidebar.workspaces', children: { … } })` 里
现有 `sidebar.workspaces.directoryFlow` 旁并列：

```ts
'sidebar.workspaces.sessionRow.meta': { kind: 'list', scope: 'root' },
'sidebar.workspaces.workspaceHeader.meta': { kind: 'list', scope: 'root' },
```

### 3) 渲染点（行组件内、行操作菜单之前）

- `ProjectRowItem`（工作区组头行，bundle 行号 470-536）：行 div 内
  `renderWidgetMeta?.({ workspaceId, cwd, title })`。
- `SessionNodeItem`（会话行，bundle 717-784，SessionTree 1404-1451 与 FlatList
  1538-1582 两个调用点同时生效）：行 div 内 `renderMeta?.({ sessionId, title, workspaceId? })`。

### 4) Plumbing

`WorkspaceBrowser` 已有 `renderSlot`（供 directoryFlow）；加两个包装
`renderSessionRowMeta` / `renderWorkspaceHeaderMeta`，经 `SessionTree`/`FlatList`
props 下传；行组件 props 加**可选** `renderMeta?`（缺失即不渲染 → 完全向后兼容）。

### 5) 类型

`WorkspaceBrowserProps.PropsRenderSlots` 联合加两洞名；`Rows.d.ts` 行 props 加可选
`renderMeta`。

## 兼容性

- 空注册即无渲染（list 槽天然行为）；非 ui-workspace 三方插件无感；directoryFlow 不受影响。
- 消费方数据不需要上游改动：`SessionSummary.cwd` / `WorkspaceView.path` 已在 wire 上
  （dsh-host-apiproxy），插件自解析远程前缀。

## 消费示例（dsh-workspace-enhancement）

注册两个槽 → 行/组头渲染 🌐 + 三态徽标（未知/活跃/离线）+ 重连按钮；后端
`/dsw/conn.{status,probe,reconnect}` 已具备。上游合并后，插件删除
`row-badges.ts` DOM 增辉层，改为槽位注入（保留 C1/C2 自有面）。
