# ADR-0016: 对话/轨迹区可扩展面板 Tab 的客户端槽位契约（REQ-I1 前置侦察）

- 状态: proposed
- 日期: 2026-09-08
- 范围: **只侦察、只写本 ADR**；本轮不落任何产品代码（REQ-I1 实现另开一轮）
- 侦察方式: 磁盘权威源逐行核对（**未调用** `cordis_inspect_list` / `cordis_inspect_query`，见 `AGENTS.md` §5.7）
- 结论: **可行**（零上游改动，零新增依赖，纯客户端注册）

## 0. 结论速览

| 问题 | 结论 |
|---|---|
| 对话区是否已有可插面板 Tab 的官方接缝？ | **有**：`conversation.view`（`kind: list` / `scope: session`），Chat 与 Trajectory 两个 tab 就是它的两个 entry |
| 需要上游改动吗？ | **不需要**。声明方是 `dsh-client-ui-conversation`（宿主已装），第三方插件用 `ctx.slots.inject('conversation.view', …)` 直接追加 |
| 需要新增依赖吗？ | **不需要**。`dsh.client.inject` 已含 `@deepseek-ai/dsh-client-ui-conversation`（`package.json:54-61`）；UI 包不进 `dependencies`，运行期零 import |
| 应当对接 better-sidebar 还是自建？ | **自建**（注册 `conversation.view` entry）。better-sidebar 的 `ctx.betterSidebar.registerTab` 是**另一个面**（右侧面板 Tab，非对话区 Tab），可作为**后续可选**增强，不作前置 |
| 已知硬约束 | ① tab 条只在 `tabs.length > 1` 时渲染；② 同一时刻**只挂载一个** view（切换即卸载）；③ blank 会话不渲染该槽；④ `id` 唯一且进入 localStorage 偏好键 |

---

## 1. 目标槽位：`conversation.view`

### 1.1 契约（声明方）

| 项 | 值 | 权威来源（文件:行） |
|---|---|---|
| slot key | `conversation.view` | `@deepseek-ai/dsh-client-ui-conversation/lib/types/client/contract/slots.d.ts:111`（注释 :110）；**上游生成的槽位目录** `@deepseek-ai/dsh-cordis-client-runner/lib/client.js:3218-3268` |
| kind | `list` | 同上 `:112` |
| scope | `session` | 同上 `:113` |
| owner props | `ConvViewOwnerProps` | 同上 `:114` → 定义 `:237-244` |
| 组件基础 props | `PropsRuntime<'conversation.view'>` = owner + Session 标准包 + Global 标准包 | `dsh-client-ui-slots/lib/types/index.d.ts:191`；`ConvViewProps` 别名在 `.../contract/slots.d.ts:246` |
| 声明者（declaredBy） | `dsh-client-ui-conversation` 的 `ConversationSession` entry（`children` 表） | 部署包 `dsh-client-ui-conversation/lib/client.js:16115-16130`（子槽声明在 `:16117-16120`）；类型侧 `.../contract/slots.d.ts:83-86` + `:340` |
| 渲染点（唯一） | `renderSlot('conversation.view', { viewRequest, openView, completeViewRequest }, { only: active.id })` | `dsh-client-ui-conversation/lib/client.js:14638-14642` |
| 入口位置 | 会话滚动区（`.wSkVaW_viewArea`，`flex:1; min-height:0`，滚动由外层 `.wSkVaW_scrollBody` 承担） | `.../lib/client.js:14185`（CSS）与 `:14636-14637`（宿主 div） |
| **上游 `replaceRisk`** | **`none`** ——"a fresh id is added beside the shipped entries, while reusing a shipped id puts you in THAT cell and replaces it" | `dsh-cordis-client-runner/lib/client.js:3224-3243`（`registerOptions.id` 的 doc）、`:3265`（`replaceRisk: "none"`）、`:3264`（occupants: `chat` / `trajectory`） |
| 上游给的注册示例 | `ctx.slots.inject('conversation.view', () => ctx.slots.register({ name, id: 'my-entry', order: 100, label: 'My entry' }, () => React.createElement('div', null, 'hello')))` | 同上 `:3266` |

### 1.2 组件实收 props（逐项）

`PropsRuntime<'conversation.view'>` 展开后：

| 来源 | 成员 | 来源（文件:行） |
|---|---|---|
| owner（渲染点传入） | `viewRequest: ConversationViewRequest \| null`、`openView(view, focus)`、`completeViewRequest()` | `dsh-client-ui-conversation/lib/types/client/contract/slots.d.ts:237-244` |
| session 标准包（`dsh-client-ui-session` 的 `SessionStandardProps`） | `sessionId: SessionId`、`useSession`（selector hook）、`useProjection` | `dsh-client-ui-session/lib/types/client/index.d.ts:41-48` |
| conversation 的 session 标准包增补 | `useConversation`、`useInput`、`inputActions` | `dsh-client-ui-conversation/lib/types/client/contract/slots.d.ts:195-202` |
| global 标准包 | `useSessions`、`useSessionPendingInteraction`（`dsh-client-ui-session`）；`useWorkspaces`（`dsh-client-ui-workspace`） | `dsh-client-ui-session/lib/types/client/index.d.ts:35-40`；`dsh-client-ui-workspace/lib/types/client/index.d.ts:19-22` |
| 注册方 `inject` 返回面 | 自定（`InjectFace<I>`：`hooks` 隔舱转 `use<Name>` hook，其余原样透传） | `dsh-client-ui-slots/lib/types/index.d.ts:362-368` |
| 声明 `locale:` 时的 `t` | `TranslateNS<'dsw'>` | 同上 `:67-70`、`:441-447` |

**标准包是"全员相加"的**：上游槽位目录对 `conversation.view` 列出的实际 `standardProps` 是
`useWorkspaces / useSessions / useSessionPendingInteraction / useChat / useConversation / useInput /
inputActions / useSession / sessionId / useProjection / useTrajectory`（`dsh-cordis-client-runner/lib/client.js:3246-3259`）——
即**所有已加载插件通过 `ctx.uiSession.provide()` 注册的标准面都会出现在本槽组件上**（`useChat` 来自 ui-chat、`useTrajectory` 来自 ui-trajectory）。因此本插件将来若 `ctx.uiSession.provide({ hooks: ['dswWorkspace'] })`，自己的面板会拿到 `useDswWorkspace`，**其它 view 也会拿到**；不要靠命名冲突假设独占。

`sessionId` 是**该槽所在 scope 的会话 id**，不是"当前选中会话"（`dsh-client-ui-session/lib/client.js:61-70` 的 `BUILTIN_SOURCE.resolve` 取 `binding.sessionId`），因此面板天然按会话取数。

### 1.3 `inject` 工厂签名

`scope: 'session'` 且未声明 `store` → `inject: (sessionId) => I`；声明 `store` 时追加 `actions`（`dsh-client-ui-slots/lib/types/index.d.ts:386`）。本轮不需要 store。

---

## 2. 相邻候选槽位清单（同一批权威源，供实现选型）

### 2.1 对话区（`dsh-client-ui-conversation`）

| 槽位 | kind / scope | 用途 | 来源 |
|---|---|---|---|
| `conversation.view` | list / session | **对话区 Tab 环（本需求目标）** | `contract/slots.d.ts:111-115` |
| `conversation.session` | single / session | 会话体（被 ui-conversation 占用） | `:83-86`；`lib/client.js:16115-16130` |
| `conversation.session.header` | single / session | 标题 + tab 导航条 | `:88-91`；`lib/client.js:16131-16159` |
| `conversation.session.header.actions` | list / session | 标题旁动作（**本插件已用**） | `:99-103`；`src/client/index.ts:195-203` |
| `conversation.session.header.utilities` | list / session | 右侧工具位 | `:105-109` |
| `conversation.session.header.lineage` | single / session | 面包屑标题替换 | `:93-97` |
| `conversation.input.dock` / `.overlay` / `.left` / `.right` / `.model` / `.plan` / `.attachments` | list/single / session(-maybe) | 输入区各缝 | `:141-189` |
| `conversation.composer` / `.bar` / `.composer.dock` | chain/single/list | 输入卡片本体/接管 | `:117-121`、`:167-171`、`:152-155` |
| `conversation.hero.workspace` / `.brand.mark` / `.agentPreset` | single / root | 空白会话 Hero | `:123-139` |

### 2.2 布局与右侧栏（`dsh-client-ui-layout`）

| 槽位 | kind / scope | 关键事实 | 来源 |
|---|---|---|---|
| `conversation` | single / session-maybe | **被 ui-conversation 的 ConversationRoot 占用**；注册即替换整个对话面 | `dsh-client-ui-layout/lib/types/client/index.d.ts:48-52` |
| `details` | single / session | **被 ui-conversation 的 DetailsPanel 占用**；注册即替换整列 | 同上 `:62-66` |
| `sidebar` | single / root | 被 ui-sidebar 占用 | 同上 `:31-35` |
| `shell.overlay` | list / root | 全框浮动层（附加、可点透） | 同上 `:77-80` |
| `root` | single / root | **明确禁止注册**（会遮蔽整个框架） | `dsh-client-ui-renderer/lib/types/client/registry.d.ts:18-36` |

### 2.3 Chat 视图内部（`dsh-client-ui-chat`）

| 槽位 | kind / scope | 用途 | 来源 |
|---|---|---|---|
| `conversation.chat.node` | keyed / session | 聊天流节点 | `contract/slots.d.ts:144-…` |
| `conversation.chat.turnTail` | **chain** / session | 回合尾部接管（better-sidebar 已用） | `:181-…` |
| `conversation.chat.commandview` | keyed / session | 命令行 | `:171-…` |
| `conversation.chat.assistant-actions` | list / session | 助手消息动作 | `:191-…` |
| `conversation.details.tool` | single / session | 右侧详情面板正文（被 ui-chat 占用） | `:201-…` |

> 这些是"聊天流内"扩展点，**不产生可切换面板 Tab**，与 REQ-I1 不是同一件事。

### 2.4 Trajectory（`dsh-client-ui-trajectory`）

`conversation.view` 的第二个 entry（`id: 'trajectory'`, `order: 10`），注册点 `lib/client.js:8194-8221`；自身还声明子槽 `conversation.trajectory.images`（`lib/types/client/trajectory-contract.d.ts:80`）。

---

## 3. 注册 / 卸载契约

### 3.1 注册

```js
ctx.slots.inject('conversation.view', () => ctx.slots.register({
  name: 'conversation.view',
  id: 'dsw-workspace-panel',        // list 槽强制：缺失即抛
  order: 20,                        // list 排序键（见 3.3）
  label: () => t('panel.tab'),      // SlotLabel：字符串或 thunk（thunk 随语言实时求值）
  locale: 'dsw',                    // 注入 t 座位；需本插件已 ctx.locale.register('dsw', …)
  registrant: 'dsh-workspace-enhancement',
  inject: (sessionId) => ({ /* 业务面 */ }),
}, PanelComponent))
```

| 规则 | 事实 | 来源 |
|---|---|---|
| 槽未声明时 `register` 直接抛 | `slot "…" is not declared (a parent entry's children table must declare it)` | `dsh-client-ui-slots/lib/index.js:74` |
| list 槽缺 `id` 抛 | `list slot "…" requires options.id` | 同上 `:91` |
| 同 `id` + 同 `priority` 二次注册抛 | `already has an entry with id "…" at priority 0 …` | 同上 `:92-93`（提示文案 `:77`） |
| `id` + 不同 `priority` 可"遮蔽"共存 | 同 cell 不同 priority 共存，低 priority 渲染 | 同上 `:92-93`（校验）+ `entriesOfSlot` `:187-200`（每 cell 取首个存活 entry） |
| 未声明 `id` 的 entry 被 tab 投影跳过 | `if (entry.options.id === void 0) continue` | `dsh-client-ui-conversation/lib/client.js:15992-16000` |

### 3.2 卸载与重装（**不会抛 "already registered"**）

`ctx.slots.inject(key, callback)` 的运行时契约（`dsh-client-ui-renderer/lib/types/client/registry.d.ts:85-100`，实现 `lib/client.js:1015-1074`）：

- 槽**已声明**：回调**同步**执行（本插件当前 `settings.section` / `header.actions` 的路径）；
- 槽**未声明**：回调**挂起**，等声明方 `register()` 提交后执行；声明**坍塌**时自动 dispose；**再次声明会重新执行**；
- 控制器挂在**调用方 fiber**（`ctx.effect`，`lib/client.js:1017`、`:1070`），插件卸载/HMR 自动回收；
- 回调返回 disposer 或 disposer 可迭代（事务式安装、逆序卸载，`registry.d.ts:43-44`、`:90-93`）；
- 注册本身经 `ctx.effect` 路由到调用方 fiber（`registry.d.ts:68-83`），所以**重复挂载 = 旧 entry 先随 fiber 卸载，再挂新的**，不撞同 `id`/同 priority 的冲突。

> 与 `AGENTS.md` §6「重装后再挂一次不得抛 already registered」一致；本插件现有三处槽位注册已是这个模式（`src/client/index.ts:173-203`）。

### 3.3 排序与"何时可见"

| 事实 | 来源 |
|---|---|
| list entry 按 `priority` 升序、再按 `order` 升序排序（`next.sort(...)`） | `dsh-client-ui-slots/lib/index.js:129-131` |
| tab 列表由 `slots.entries('conversation.view')` 顺序投影（即上面的排序），`label` 经 `resolveSlotLabel` 求值，缺省回退 `id` | `dsh-client-ui-conversation/lib/client.js:15990-16001` |
| **tab 条只在 `tabs.length > 1` 时渲染** | 同上 `:14599` |
| 槽位增删触发 `slots.subscribe('conversation.view', refreshViews)` 重投影 | 同上 `:16013-16038` |
| **同一时刻只挂载一个 view**：`renderSlot(..., { only: active.id })` → 渲染器 `list.filter(item => item.id === opts.only)` | 同上 `:14638-14642`；渲染器 `dsh-client-ui-renderer/lib/client.js:866-869` |
| 选中规则：localStorage 持久化偏好 → 否则 `chat` → 否则不渲染 | `dsh-client-ui-conversation/lib/client.js:14501`（`DEFAULT_VIEW_ID='chat'`）、`:14508-14510`、`:1789-1800`（偏好键 `dsh.conversation.store.<sessionId>`） |
| blank 会话不渲染 `conversation.view` | 同上 `:14635`（`if (session.blank && …) return null`）；README.md:43 |
| 初始两个 entry：`chat`（order 0，`dsh-client-ui-chat/lib/client.js:8082-8088`）、`trajectory`（order 10，`dsh-client-ui-trajectory/lib/client.js:8194-8199`） | — |
| `viewRequest` 是**一次性**焦点请求，目标 view 消费后调 `completeViewRequest()`；面板可忽略 | 类型 `contract/views.d.ts:10-16`；参考实现 `dsh-client-ui-trajectory/lib/client.js:7842`、`:8143` |

---

## 4. 与已装 `dsh-better-sidebar@0.18` 的关系

### 4.1 事实

| 事实 | 来源 |
|---|---|
| better-sidebar 对外发布 `ctx.betterSidebar` 服务（外部插件注册 tab / 文件预览器） | 部署包 `dsh-better-sidebar/src/client/index.tsx:134-139`（`ctx.provide('betterSidebar', service)`） |
| 服务面：`registerTab(TabDescriptor)` / `registerFileViewer` / `openTab(seed, scope?)` / `isTabEnabled` / `updateTab` / `getSnapshot` / `features` 等 | `dsh-better-sidebar/lib/types/client/service.d.ts:317-403`；`TabDescriptor` `:141-225`；`SIDEBAR_SERVICE_VERSION = '0.18.0'` `:421` |
| 它的 tab 渲染在**右侧面板**（`TabBar`/`split-pane`/`FreeWindow` 等自有组件），并有自己的 `sidebar.workspaces.directoryFlow` 之外的一整套内部结构 | `dsh-better-sidebar/lib/types/client/TabBar.d.ts`、`Sidebar.d.ts`、`split-pane.d.ts`、`FreeWindow.d.ts` |
| 它对宿主槽位的占用只有两处：`settings.section`、`conversation.chat.turnTail` | `src/client/index.tsx:430-436`；`src/client/intercept.tsx:131-150` |
| 它**不注册** `conversation.view` | 全仓 grep：`conversation.view` 仅出现在 `dsh-client-ui-chat` / `dsh-client-ui-trajectory` |
| 本产品 profile 已装：`dsh-better-sidebar: ^0.18.0` 且列入 bundles | `$DSH_HOME/profiles/web/package.json` |

### 4.2 判定：**自建（`conversation.view`）**，理由按权重

1. **面不同**：需求原话是"对话/轨迹这个 tab 区还能加面板 tab"。`conversation.view` 正是那个 tab 环；better-sidebar 的 tab 在右侧面板，是另一个面（用户看到的"better-sidecar 式"是它的**交互形态**，不是它的接缝）。
2. **依赖方向**：`conversation.view` 由宿主 `dsh-web-app` 依赖的 `dsh-client-ui-conversation` 声明（`dsh-web-app/package.json` deps 含 `@deepseek-ai/dsh-client-ui-conversation ^0.1.2-rc.1`），**任何支持窗口内的宿主都有**；better-sidebar 是**可选第三方插件**，把它变成面板的前提等于让本插件多一个硬依赖。
3. **生命周期与 i18n 一致性**：`conversation.view` 走宿主 slots 生命周期（fiber 可逆）+ 本插件已注册的 `dsw` locale 命名空间；better-sidebar 的 tab 描述符走它自己的注册表与 prefs（`tabsEnabled` 开关），多一套语义。
4. **零新代码面**：`dsh.client.inject` 已声明对 `dsh-client-ui-conversation` 的加载顺序依赖（`package.json:54-61`），不需要新增 peer/dev 依赖。
5. **可逆代价**：better-sidebar 的 `registerTab` 同样是 `ctx.effect` 可逆的，但它要求我们**适配它的 `TabComponentProps`**（`service.d.ts:123-139`）并接受它的 prefs/`+` 菜单语义。

### 4.3 保留项（本轮不做，另开需求）

`ctx.betterSidebar.registerTab` 可以低成本把「远程机器状态 / 连接日志」做成**右侧面板 Tab**（`openTab(seed, { sessionId })` 支持定向打开，`service.d.ts:346-362`）。这与 REQ-I1 是**两条独立的体验线**，建议单独记一条待办（例如"REQ-I2b 右侧面板 Tab 对接 better-sidebar"），由用户拍板；不阻塞 REQ-I1。

---

## 5. 最小实现骨架（伪码，**不入 src**）

```tsx
// src/client/panel.tsx（示意，不在本 ADR 落地）
// 1) 复用现有数据面：/dsw session.ws.list | machines.list | conn.status | session.route（src/web.ts:295-510）
// 2) 组件只用标准 props 里的 sessionId + 自己的 inject 面
function WorkspacePanel({ sessionId, useSession, rpc }: PanelProps) {
  const session = useSession(s => s)               // 标准包提供
  const rows = useAsync(() => rpc('session.ws.list', { sessionId }), [sessionId])
  if (session.blank) return null                   // 与宿主同口径：blank 不渲染
  return <div className={css.panel} role="tabpanel">…</div>
}

// 3) 注册（与现有三处同一模式）
ctx.slots.inject('conversation.view', () => ctx.slots.register({
  name: 'conversation.view',
  id: 'dsw-workspace-panel',        // 稳定且唯一；改 id 会丢用户偏好恢复
  order: 20,                        // chat(0) → trajectory(10) → 本面板(20)
  label: () => t('panel.tab'),      // 随语言实时求值
  locale: 'dsw',
  registrant: 'dsh-workspace-enhancement',
  inject: (sessionId) => ({ rpc: (endpoint, payload) => rpcCall(ctx, endpoint, { sessionId, ...payload }) }),
}, WorkspacePanel))
```

实现注意（来自上文的契约事实）：

1. `id` 一旦发布即成为 localStorage 偏好键值（`dsh.conversation.store.<sessionId>` 的 `view` 字段）——**不要改名**。
2. 切换 tab 会**卸载**本面板：需要跨切换保留的状态放模块级 store 或 localStorage，不要指望 `useState` 存活。
3. 面板是滚动区内的普通块：不要自己造滚动容器盖住外层 `overflow-y:auto`；表格/列表超出高度时用宿主滚动。
4. 主题与样式沿用现有 CSS Modules + `--dsw-*` 变量（`src/client/side-workspaces.module.css` 是现成范例），禁止内联硬编码颜色（R5 已踩过）。
5. `inject` 里拿到的 `sessionId` 是**该槽所在会话**；若要做到"点击某台机器跳到对应会话"，用 `ctx.sessions.open(id)` 而不是改本面板的 scope。
6. `viewRequest` 可忽略；但若将来要支持"从 header 动作跳到面板并聚焦某项"，消费后必须调 `completeViewRequest()`。
7. 文案进 `src/locale/`（`dsw` 命名空间），与现有 i18n 纪律一致（`AGENTS.md` §6）。

---

## 6. 风险清单

| # | 风险 | 影响 | 处置 |
|---|---|---|---|
| R1 | tab 条仅在 `tabs.length > 1` 渲染（`client.js:14599`） | 若宿主哪天只剩一个 tab，本面板不可达 | 不依赖"tab 条存在"做功能前提；入口另有 header 动作（已存在） |
| R2 | 同一时刻只挂载一个 view（`only` 过滤） | 切换即卸载，`useState` 丢失 | 状态外置（见 §5.2） |
| R3 | blank 会话不渲染该槽 | 新会话里看不到面板 | 与宿主 Chat/Trajectory 同口径，不做特判；面板内空态文案照常 |
| R4 | `id` 进入 localStorage 偏好键 | 改名 → 用户上次选中的 tab 回退到 Chat | `id` 视为对外契约，写入 ADR/代码注释 |
| R5 | 上游契约漂移（`conversation.view` 的 owner props / kind） | 编译期类型失配或运行期不渲染 | 支持窗口内（`0.1.2-rc.1` 家族，`docs/compatibility.md` §1）；用 `ctx.slots.inject` 等待声明——槽不存在时**静默 no-op**，面板不出现但不炸 |
| R6 | `ctx.slots.inject` 的等待语义依赖"声明方先注册" | 加载顺序问题 | 已由 `package.json:54-61` 的 `dsh.client.inject` 显式声明依赖，且 `inject` 自带等待 |
| R7 | 面板在滚动区内，与 chat 的滚动/宽度变量（`--dsh-chat-content-width`）混用 | 布局错位 | 面板自带容器类，只用主题 token；E2E 断言不溢出 |
| R8 | 复用 `side-workspaces.tsx`（现为 dialog 形态） | 直接塞进 tab 会嵌套 dialog | 抽出列表子组件（纯 `.ts`/`.tsx` 视图拆分，符合 `docs/testing.md` 的可测性要求） |
| R9 | 多插件抢同一个 `id` | 注册抛错（同 id 同 priority） | 用带前缀的稳定 id；需要遮蔽时用 `priority` 而非改名 |

## 7. 被否方案（"不做"的理由）

| 方案 | 否决理由 |
|---|---|
| 注册 `conversation`（single/root）承载面板 | 它是**整个对话面**，注册即替换掉宿主 Chat/Hero/Composer（`dsh-client-ui-layout/.../index.d.ts:36-52`） |
| 注册 `details`（single/session） | 已被 ui-conversation 的 DetailsPanel 占用，注册即替换右侧整列并带走 `conversation.details.tool`（同上 `:53-66`） |
| 注册 `root` | 官方注释明确禁止：会遮蔽整个框架，所有 seat 消失（`dsh-client-ui-renderer/.../registry.d.ts:18-36`） |
| DOM 注入（像 `row-badges.ts`）往 tab 条塞按钮 | 可行但脆弱：tab 条是 React 渲染、语言切换即重绘，DOM 层需要重复扫描/闩锁（ADR-0011 的代价），且拿不到 `sessionId` 之外的槽位语义 |
| 走 `conversation.chat.turnTail`（chain） | 它是**聊天流内的回合尾接管**，不是可切换面板；且与 better-sidebar 已有 claim 竞争 |
| 上游 PR 新增槽位 | 与 ADR-0011 一致：上游不接受 PR；且**本轮侦察证明不需要** |
| 把面板做成 better-sidebar 的 tab | 见 §4.2：面不同、引入可选插件硬依赖；保留为独立需求 |

## 8. 侦察方法学收获：被禁工具的**磁盘等价物**

`cordis_inspect_query`（Slots.listSubTree / 精确 root 契约）在本仓库被禁用（页面不应答会永久挂起，
`AGENTS.md` §5.7），但它的**数据源就在磁盘上**：

| 事实 | 来源 |
|---|---|
| `@deepseek-ai/dsh-cordis-client-runner@0.1.2-rc.1` 是 `@deepseek-ai/dsh` 的直接依赖 | `@deepseek-ai/dsh/package.json`（deps 含 `@deepseek-ai/dsh-cordis-client-runner ^0.1.2-rc.1`） |
| 其 `lib/client.js` 内含生成产物 `CLIENT_SLOT_API`——**宿主 web bundle 声明的每一个槽位**（key / kind / scope / summary / registerOptions / ownerProps / standardProps / declaredBy / occupants / **replaceRisk** / example / source） | `dsh-cordis-client-runner/lib/client.js:2133-4198`（`CLIENT_SLOT_API`，`const` 起于 `:2135`）、`:4199`（`SLOT_CATALOG = new Map(...)`） |
| 同一文件还有 Service Catalog（`:1105` 起）与 Event Catalog | `:1099-2132` |

**结论**：需要"槽位/服务/事件契约"时，直接读
`<npm root -g>/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-cordis-client-runner/lib/client.js`，
或部署包 `$DSH_HOME/profiles/web/node_modules/@deepseek-ai/dsh-cordis-client-runner/lib/client.js`（若存在）。
它是 `cordis_inspect_*` 的只读替代，且**带上游的 `replaceRisk` 判断**（比自行推断可靠）。
本 ADR 的 §1/§2 已用它与包内 `.d.ts` 双向核对。

> 注意：这是**生成产物**（文件头注明 `do not edit by hand`），只读引用即可；升级家族时需重新核对。

## 9. 验收证据（本轮可复核）

| 项 | 命令 / 方式 | 结果 |
|---|---|---|
| 槽位契约行号 | 逐行读取部署包 `.d.ts` / `.js`（见上文每格来源） | 已核 |
| 上游槽位目录（`replaceRisk: none`） | 读 `dsh-cordis-client-runner/lib/client.js:3218-3268` | 已核 |
| 注册校验语义 | 读 `node_modules/@deepseek-ai/dsh-client-ui-slots/lib/index.js:74-93`、`:129-131`、`:187-200` | 已核 |
| 标准面是"全员相加" | 读 `dsh-client-ui-chat/lib/client.js`、`dsh-client-ui-trajectory/lib/client.js` 的 `ctx.uiSession.provide({ hooks: ['chat' / 'trajectory'] })` + 目录 `:3246-3259` | 已核 |
| `inject` 等待语义 | 读 `dsh-client-ui-renderer/lib/client.js:1015-1074` + `registry.d.ts:85-100` | 已核 |
| 现有插件用法一致性 | 读 `src/client/index.ts:173-203`、`package.json:49-64` | 已核 |
| better-sidebar 服务面 | 读 `$DSH_HOME/profiles/web/node_modules/dsh-better-sidebar/{src/client/index.tsx,lib/types/client/service.d.ts,lib/types/context-types.d.ts}` | 已核 |
| 未调用被禁工具 | 本会话未调用 `cordis_inspect_*` | 遵守 |

> 本 ADR **不产生代码改动**；REQ-I1 的实现轮需在此契约上补 `e2e/scenarios.md` 新场景（建议 `E2E-08 对话区面板 Tab`：tab 条出现第三个 tab → 点击后面板可见且 `role=tabpanel` → 切回 Chat 后面板卸载 → 刷新后偏好恢复）与 `docs/uat/` 脚本。
