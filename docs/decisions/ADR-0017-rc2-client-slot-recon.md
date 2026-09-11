# ADR-0017: rc.2 新增客户端槽位侦察与 REQ-I1 实现路线

- 状态: proposed
- 日期: 2026-09-10
- 范围: **只侦察、只写本 ADR**；不落任何产品代码（`REQ-I1` 实现另开一轮；本轮 PR 的特性由 `t4` 另出）
- 侦察方式: 磁盘权威源逐行核对（**未调用** `cordis_inspect_list` / `cordis_inspect_query`，见 `AGENTS.md` §5.7）
- 对照版本: `0.1.5-rc.2`（新） vs `0.1.2-rc.1`（线上/3080 家族）
- 结论: **`REQ-I1` 仍走 `conversation.view`**（`ADR-0016` 的路线不变、成本不变）；rc.2 新增的右侧面板是**另一个面**，其官方接缝**已可用且零上游改动**，建议单列需求而不是替换 `REQ-I1`

## 0. 结论速览

| 问题 | 结论 | 关键证据 |
|---|---|---|
| 客户端槽位目录变了多少？ | **52 → 61**：新增 12、删除 3，**49 个共有槽无一字段反向变更** | `key` 名 + `slot-keys.mjs` 输出；快照 `CLIENT_SLOT_API` 段位置见 §1.3（`R2` vs `R1`） |
| 我们占的 4 个槽还在吗？ | **都在，契约零破坏**；唯一变化是 `standardProps` 全局追加 2 个 hook（纯加法） | 本文 §5 逐槽字段级 diff |
| rc.2 新增里与我们有关的是什么？ | ① 官方**右侧面板 Tab 体系**（`rightbar` → `rightbar.session` → `sidebar.right.pane.tab`，`ctx.sidebarRight` 服务）；② **活动栏 + 主面板**（`sidebar.panellist` + `main`，`ctx.layout.selectPanel`）；③ header 角落位 `conversation.session.header.corner`（**已被官方 ExpandButton 占用**） | §2 / §3 / §6 |
| `REQ-I1`（对话/轨迹区可扩展面板 Tab）该落在哪？ | **仍是 `conversation.view`**（rc.2 契约与 rc.1 完全一致，`replaceRisk: none`）。新右侧面板 Tab 是**另一条体验线**（`REQ-I2b` 候选），不改本需求落点 | §7 |
| 现有 DOM 行徽标层（`row-badges`）受影响吗？ | **静态层面无新增风险**（`main` 是新增 slot，未替换 `sidebar.workspaces`）；运行时是否存活由 `t3` lab 实测回答 | §4.2 / §9 R8 |
| 需要新增 peer/依赖吗？ | **不需要**。右侧面板由 `dsh-web-app` 依赖并默认挂载 | §6 |

---

## 1. 侦察方法学（可复现）

| 步骤 | 命令 / 方式 | 产物 |
|---|---|---|
| 取 rc.2 客户端 runner | `npm pack @deepseek-ai/dsh-cordis-client-runner@0.1.5-rc.2` 解包 | `.tmp/slot-recon/runner-rc2/lib/client.js`（5174 行） |
| 取线上家族对照 | 全局安装树 `C:\Users\Admin\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai\dsh-cordis-client-runner@0.1.2-rc.1\lib\client.js` | 同结构，52 槽 |
| 结构化抽取两个目录 | `.tmp/slot-recon/extract-slot-api.mjs`（括号配平 + `new Function` 求值，产物纯数据） | `slots-0.1.2-rc.1.json` / `slots-0.1.5-rc.2.json` / `services-0.1.5-rc.2.json` |
| 逐字段 diff | `.tmp/slot-recon/slot-field-diff.mjs`（对 `kind/scope/registerOptions/ownerProps/standardProps/declaredBy/occupants/replaceRisk/example/source` 全字段） | 本文 §5 / §8 |
| 槽位实现取真身 | `npm pack @deepseek-ai/dsh-client-ui-{sidebar-right,sidebar,layout,conversation,sidebar-documentpreview}@0.1.5-rc.2` | `.tmp/slot-recon/pkgs/*/lib/client.js` + `lib/types/**` |
| 服务契约 | `@deepseek-ai/cordis@4.0.2/lib/types/reflect.d.ts`（`ctx.reflect.provide` 的权威定义） | 见 §6 |

> 上游 `CLIENT_SLOT_API` 是**生成产物**（含每个槽的 `replaceRisk` / `occupants` / `example`），比自行推断可靠（`ADR-0016` §8 同法）。

### 1.1 引用规范（**必读**：行号不作为契约事实）

上游升级即漂，因此本文的引用遵循三条：

1. **契约事实用 `key` 名 + 字段名**，例如「槽位 `sidebar.right.pane.tab` 的 `kind` 是 `keyed`」——**不靠行号**。
2. **行号只作为「本次快照的定位锚」**，并且**必须与产生它的文件一起引用**。快照代号如下（全局 0.1.2-rc.1 与 rc.2 两套行号**绝不可混用**）：

   | 代号 | 文件（绝对路径） | 行数 |
   |---|---|---|
   | **`R2`** | `.tmp/slot-recon/runner-rc2/lib/client.js`（来自 `npm pack @deepseek-ai/dsh-cordis-client-runner@0.1.5-rc.2`） | 5174 |
   | **`R1`** | `C:\Users\Admin\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai\dsh-cordis-client-runner\lib\client.js`（0.1.2-rc.1） | — |

3. 全文的槽位行号**统一收在一处**（§1.3 「槽位定位表」），正文只引 `key` + 符号名；少数无法用 key 表达的定位（钩子/渲染点）写作 `文件 + 符号`，并标注快照代号。

**rc.2 包内引用一律写成 `包名/lib/...` 全路径**，包名即 `npm pack` 出来的 `<pkg>@0.1.5-rc.2`，落盘位置 **`.tmp/slot-recon/pkgs/deepseek-ai-<pkg>-0.1.5-rc.2/lib/...`**。这么写不是啰嗦，而是必要的溯源纪律：

- **rc.2 的契约证据只存在于 `.tmp/slot-recon/pkgs/`（`npm pack` 解包）**——因为 `dsh-client-ui-slots` 等包在全局安装树里**根本不存在**（它们只作 `devDependencies` 取类型）。把 rc.2 的 `lib/index.js` 写成裸文件名会让人去全局树找，那是**找不到的**。
- 反之，**rc.1 的对照只能用全局安装树**（`…\dsh\node_modules\@deepseek-ai\<pkg>\lib\…`），因为线上家族没有对应的 `.tmp` 解包快照。
- 两边的行号也一样**不可互相套用**（见上一条的快照代号）。

**类型面与运行时面不是同一棵树**（captain 2026-09-10 要求写明）——引证据前先问「这是类型还是运行时」，两者要从**不同的树**取：

| 要引什么 | 从哪棵树取 | rc.2 的实际落点举例 |
|---|---|---|
| **类型契约**（`SlotMap` / `KindOptions` / owner props 形状） | **devDependency 树**（本仓库 `node_modules/@deepseek-ai/*`，或解包产物的 `lib/types/**`） | `dsh-client-ui-slots/lib/types/index.d.ts` 的 `KindOptions` / `BaseOptions` |
| **运行时校验/抛错**（`throw new Error(…)`、注册时的合法性判定） | **解包产物**（`.tmp/slot-recon/pkgs/.../lib/*.js`）——**不在** devDependency 树，也**不在**全局安装树 | `dsh-client-ui-slots/lib/index.js` 的 `register()` 里 `list slot "…" requires options.id` |
| **线上家族的现有行为**（rc.1 声明/渲染） | **全局安装树**（`…\dsh\node_modules\@deepseek-ai\<pkg>\lib\…`） | `dsh-client-ui-conversation/lib/client.js` 的 `renderSlot("conversation.session.header.utilities", {})` |

> 反面教材（本条规则的来历）：2026-09-10 engineer-client 独立复核时报「全局树里没有 `dsh-client-ui-slots`，无法复核 §3.3 的 `id` 必填断言」。事实核对：**本文并未在任何地方把该断言指向全局树**（§3.3 的类型面引 `lib/types/index.d.ts`，运行时的 `id` 必填至此才补入 §3.3 并明确标为解包产物）；歧义来自口头转述而非本文。**为免同类误读，凡运行时校验一律写明「解包产物 `lib/index.js`」，禁止只写文件名。**

> 三个现成脚本可直接定位、与行号无关：`list-slots.mjs`（key/kind/scope/summary 全表）、`dump-slot.mjs <runner> <key…>`（按 key 打印完整目录项，输出自带 `(line N)`）、`slot-keys.mjs`（两版本 key 差异）。

### 1.2 复核脚本（与行号无关，按 `key` 定位）

> **资产化（t7）**：下面第 1–6 项的手写脚本已合并为**入库**的单文件 CLI
> **`scripts/slot-catalog.mjs`**（零依赖，`npm run slots -- …`），覆盖 `--list` / `--key` /
> `--diff`，并且**不依赖 `.tmp/` 的任何文件**。它已实跑复现本文全部数字
> （`52 -> 61 slots; added 12, removed 3, drifted 17`）。ADR 的结论从此**可被下一个 clone 复现**，
> 不必再重写解析器。`.tmp/` 下的同名脚本仅作历史留痕。

| 脚本 | 作用 |
|---|---|
| **`npm run slots -- --list <runner.js> [filter]`**（入库，推荐） | 打印 `key / kind / scope / summary (line N)`；同 bundle 的 `SERVICE_API` 一并分节列出 |
| **`npm run slots -- --key <key> <runner.js>`**（入库，推荐） | dump 该条目全部契约字段；服务条目另打印 `methods(n)` 签名表 |
| **`npm run slots -- --diff <old.js> <new.js> [--all-fields]`**（入库，推荐） | ADDED / REMOVED / DRIFTED 三段；默认只比 11 个**行为**字段，prose/source 漂移交给 `--all-fields` |
| `.tmp/slot-recon/list-slots.mjs <runner> [filter]` | （历史）前身脚本，已被上面的 `--list` 取代 |
| `.tmp/slot-recon/dump-slot.mjs <runner> <key…>` | （历史）前身脚本，已被上面的 `--key` 取代 |
| `.tmp/slot-recon/slot-keys.mjs <old> <new>` | （历史）前身脚本，已被上面的 `--diff` 取代 |
| `.tmp/slot-recon/extract-slot-api.mjs <bundle> <CONST> <out.json>` | 把目录抽成 JSON 快照（下面两个去重比较脚本的输入；不入库） |
| `.tmp/slot-recon/slot-contract-strict.mjs <old.json> <new.json> [--key K]` | 11 个行为字段逐字节比较（本次得到 clean 32 / drifted 17）；`--diff` 已内置同法 |
| `.tmp/slot-recon/slot-field-diff.mjs <old.json> <new.json> [--key K]` | 全字段（含 `standardProps`/`source`/`doc`）差异，用于看细节；等价于 `--diff --all-fields` |

### 1.3 槽位定位表（本文全部槽位行号的**唯一出处**）

`(line N)` = 该 key 在对应快照 `CLIENT_SLOT_API` 里的**起始行**（由 `extract-slot-api.mjs` 记录，可用 `dump-slot.mjs` 复现）。**契约事实请看 §2 及以后，本表只是定位锚。**

| 槽位 `key` | rc.2 `(R2)` | rc.1 `(R1)` | 备注 |
|---|---|---|---|
| `rightbar` | line 3435 | — | rc.2 新增 |
| `rightbar.session` | line 3461 | — | rc.2 新增 |
| `sidebar.right.pane.tab` | line 4161 | — | rc.2 新增 |
| `sidebar.right.pane.tab.title` | line 4204 | — | rc.2 新增 |
| `sidebar.right.tab.document` | line 4247 | — | rc.2 新增 |
| `sidebar.right.tab.guide` | line 4293 | — | rc.2 新增 |
| `sidebar.right.tab.menu.item` | line 4332 | — | rc.2 新增 |
| `sidebar.panellist` | line 4116 | — | rc.2 新增 |
| `main` | line 3372 | — | rc.2 新增 |
| `main.conversation` | line 3403 | — | rc.2 新增 |
| `conversation.session.header.corner` | line 3160 | — | rc.2 新增 |
| `conversation.session.header.utilities` | line 3228 | line 3132 | **两版都有**（rc.2 只多一个 occupant） |
| `conversation.session.header.actions` | line 3102 | line 3044 | 我方已占 |
| `conversation.view` | line 3319 | line 3219 | `REQ-I1` 落点；两版契约逐字节相同 |
| `sidebar.workspaces.directoryFlow` | line 4437 | line 3937 | 我方已占 |
| `conversation.hero.workspace.directoryFlow` | line 2646 | line 2618 | 我方已占 |
| `settings.section` | line 3872 | line 3659 | 我方已占 |
| `tool.call.images` | line 4463 | — | rc.2 新增 |
| `tool.call.toolview` | line 4558 | line 4199† | † R1 值为该段末项行，仅示意 |
| `CLIENT_SLOT_API` 段 | line 2201–4462 | line 2135–4014 | rc.2 `SLOT_CATALOG` @ 4745；rc.1 @ 4199 |

### 1.4 ⚠️ 溯源陷阱：**不要**用本机那份上游 checkout 核验 rc.2（2026-09-10 由 engineer-client 报告，已复核）

本机 `D:\ZCodeProject\deepseek-harness` 是**上一代**的上游源码树，拿它核验 rc.2 会得出**相反的错误结论**：

| 事实 | 值 | 复核方式 |
|---|---|---|
| 该 checkout 的 slot-catalog 包版本 | **`0.1.0-rc.5`** | `packages/extensions/cordis-client-runner/package.json` 的 `version` |
| HEAD | `47f943859b`（2026-08-13，`Merge pull request #2519 … feat/npm-public`） | `git -C D:\ZCodeProject\deepseek-harness log -1` |
| 它的槽位目录规模 | **42 个**（本 ADR §2 的 `52`/`61` 都不是它） | 该树 `packages/extensions/cordis-client-runner/src/client/slot-catalog.ts` |
| 它有没有右侧面板体系 | **没有**：`panellist` / `pane.tab` / `sidebar.right.pane.tab` 全仓 `*.ts` 零命中 | 同上（grep） |
| 本 ADR 是否引用了它 | **没有**（两份产物均 grep 无 `deepseek-harness` / `slot-catalog`） | `grep -n 'deepseek-harness\|slot-catalog' docs/decisions/ADR-0017*.md docs/rounds/R17-rc2-slot-recon.md` |

**规则**：rc.2 及以上的契约只能来自**已发布包的磁盘等价物**（`npm pack` 解包后的 `lib/*.js` / `lib/types/*.d.ts`，或全局安装树 `…\npm\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai\*`）。仓库内那份源码树属于**上一次快照**，只可用于考古，不可用于契约核验。

---

## 2. 槽位总表变化（52 → 61）

### 2.1 新增 12 个（rc.2 独有）

| 槽位 key | kind / scope | replaceRisk | occupants（rc.2 目录口径） | 定位 |
|---|---|---|---|---|
| `rightbar` | single / root | `shadows-shipped-ui` | `client-ui-sidebar-right RightbarRoot` | §1.3 |
| `rightbar.session` | single / session | `shadows-shipped-ui` | `client-ui-sidebar-right RightbarSeat` | §1.3 |
| `sidebar.right.pane.tab` | **keyed** / session | `none` | `…sidebar-documentpreview TextPreview` / `…sidebar-files FilesBody` / `…sidebar-right GuideBody` | §1.3 |
| `sidebar.right.pane.tab.title` | keyed / session | `none` | 同上三者 + `GuideTitle` | §1.3 |
| `sidebar.right.tab.document` | keyed / session | `none` | `…sidebar-documentpreview` 6 个 body | §1.3 |
| `sidebar.right.tab.guide` | **chain** / session | `none` | （空） | §1.3 |
| `sidebar.right.tab.menu.item` | list / session | `none` | （空） | §1.3 |
| `sidebar.panellist` | **list** / root | `none` | （空） | §1.3 |
| `main` | **keyed** / root | `shadows-shipped-ui` | `client-ui-conversation ConversationPanel key 'conversation'` | §1.3 |
| `main.conversation` | single / session-maybe | `shadows-shipped-ui` | `client-ui-conversation ConversationRoot` | §1.3 |
| `conversation.session.header.corner` | single / session | `shadows-shipped-ui` | **`client-ui-sidebar-right ExpandButton`** | §1.3 |
| `tool.call.images` | single / session | `shadows-shipped-ui` | `client-ui-attachment MessageImages` | §1.3 |

> **header 一族的关系**（避免误读）：rc.2 在 `conversation.session.header.*` 下**只有 `corner` 是新增槽**；`utilities` / `actions` / `lineage` 三槽在 0.1.2-rc.1 就已存在（见 §1.3 的 `R1` 列），rc.2 对 `utilities` 的改变只是**多了一个官方 occupant**（见 §2.3）。

### 2.2 删除 3 个（rc.1 有、rc.2 无）

| 槽位 key | rc.1 契约 | rc.2 现状 |
|---|---|---|
| `conversation` | single / session-maybe「The whole center column」 | **消失**，被 `main`(keyed) + `main.conversation`(single) 取代 |
| `details` | single / session「The right details column」 | **消失**，被 `rightbar` + `rightbar.session` 取代 |
| `conversation.details.tool` | single / session「Whole details-panel body for the selected Tool call」 | **消失**（右侧详情面板整套换血） |

**对第三方的影响（已核查现网）**：`$DSH_HOME/profiles/web` 已装的 5 个第三方包（`dsh-better-sidebar` / `dsh-context` / `dsh-mnemon` / `dsh-whale-widget` / `dshmarket`）全仓 grep **没有任何一个**注册或注入这三个被删槽（`dsh-better-sidebar` 命中的 `'details'` 是 HTML 标签白名单，见其 `markdown-html.ts:61`；`dshmarket` 命中的是 `<details>` 元素与 `conflictDetails` 文案）——**现网无插件因这次重排失去挂载点**。这是特例而非保证：任何 *其它* 占用这三个槽的插件在 rc.2 上会静默失去挂载点（槽未声明 → `ctx.slots.inject` 的回调永不执行，不报错）。

### 2.3 其余 17 处契约漂移（与"我们"无关，但属于同一次重排的事实）

49 个共有槽里，**32 个连 `ownerProps`/`occupants` 都逐字节相同**；另外 17 个除 `standardProps` 外还有内容变化（`source`/`doc`/`summary` 行号与文案漂移不计入）。逐项（rc.1 → rc.2，均为 `client.js` 目录内文）：

| 槽位 | 漂移字段 | rc.1 → rc.2 | 影响 |
|---|---|---|---|
| `conversation.composer` / `conversation.composer.bar` | `declaredBy` | `an entry in 'conversation'` → **`an entry in 'main.conversation'`** | 父槽改名，`inject` 等待语义不变 |
| `conversation.session` / `conversation.session.header` | `declaredBy` | 同上 | 同上 |
| `conversation.input.dock` / `conversation.hero.*`（3 个） | `declaredBy` | 同上 | 同上 |
| `conversation.chat.node` | `ownerProps` | `openFile: (path) => void` → **`openFile: (path, options?: OpenFileOptions) => void`**；新增会话授权图片相关成员 | 只影响**聊天节点渲染器**的第三方实现（我们不是） |
| `conversation.input.attachments` / `conversation.message.images` / `conversation.trajectory.images` | `ownerProps` | 文案从「images」扩为「attachments」（`ComposerAttachment[]`）；图片组新增 `align` 等成员 | 只影响附件呈现插件（我们不是） |
| `tool.call.toolview` | `ownerProps`+`occupants`+`keyDomain` | 新增 `client-ui-deliverables PresentRow key 'present'`、`ReadImageRow`；keyDomain 新增 `present`/`read_image`（对应新槽 `tool.call.images`） | 工具视图扩展点；我们未占用 |
| `conversation.chat.turnTail` | `occupants` | `client-ui-deliverables ProducedFiles` → **`Deliverables`** | `dsh-better-sidebar` 占用该链槽，但组件名变化在官方侧 |
| `conversation.composer.dock` | `occupants` | `client-ui-chat StatsLine` → **`StatsPills`** | 官方内部组件改名 |
| `conversation.session.header.utilities` | `occupants` | 新增 **`client-ui-open-in-app OpenInAppAction id 'open-in-app'`**（rc.2 新增 `@deepseek-ai/dsh-client-ui-open-in-app`） | **与我们的 header 动作同排**：`↗ 在应用中打开` 会成为我们的邻居，不冲突（`replaceRisk: none`，不同 `id`） |

> 要点：这 17 处**全部落在 `conversation` 主面板内部**——正是被 `main`/`rightbar` 重排的那块区域。我们占的 5 个槽（4 个现有 + `conversation.view`）**一个都不在这 17 个里**（另有 §5 的机械证明）。

---

## 3. 官方「右侧面板 Tab 体系」逐项契约（问题 1 / 2）

### 3.1 两阶段注册模型（**这是本次侦察最重要的结构发现**）

一个 tab 类型要能被 `openTab(kind)` 打开并有内容，必须注册**两件事**：

| 阶段 | 注册面 | 内容 | 权威来源（**`key`/符号名，不靠行号**） |
|---|---|---|---|
| ① 类型（静态） | `ctx.sidebarRightTabs.register(definition)` | `{ id, kind, patterns?, priority?, canOpen?, title, guide? }` | 类型 `dsh-client-ui-sidebar-right/lib/types/client/tab-registry.d.ts` 的 `SidebarRightTabDefinition` / `.register()` |
| ② 体/标题（运行期） | `ctx.slots.register({ name: 'sidebar.right.pane.tab', key: <definition.id> })` 与 `…pane.tab.title` | 同一个 `key` | 类型 `dsh-client-ui-sidebar-right/lib/types/client/contract/slots.d.ts` 的 `SlotMap`；实现 `dsh-client-ui-sidebar-right/lib/client.js` 的 `apply`（官方 guide 就是这么做的） |

派发规则（**key 由谁派发**的答案）：

- `sidebar.right.pane.tab` 的 **key = 该 kind 在当前生效的 `definition.id`**；查不到定义时**回退成 `tab.kind`**。
  实现：`dsh-client-ui-sidebar-right/lib/client.js` 的 `TabSlot` 组件（`entryKey: definition?.id ?? tab.kind`）。（R2: line 736-740）
- 含义：**服务与槽位是配套的两半**。只注册槽位不注册类型 → 没人能 `openTab` 到它；只注册类型不注册槽位 → 打开后渲染官方的「nothing can view this」提示（同文件的 `bodiesFor` fallback，`t('tab.unavailable')`）。（R2: line 749-760）
- `definition.id` 是**全局唯一**的（`SidebarRightTabRegistry.register` 抛 `tab type id "…" is already registered`，R2: line 3358）；`kind` 允许 **builtin ⇄ extension 两个 band 共存**，判定式是同文件的 `coexists(slot, band)`（`band !== 'fallback' && slot.inForce.band !== 'fallback' && slot.inForce.band !== band && slot.shadowed === void 0`，R2: line 3293-3296）。
  → **同一 band 二次注册同 kind 必抛**，所以第三方必须用**自己的 kind**（如 `dsw-remote`），不要复用 `guide`/`files`/`text`。
- 有没有认出地址的能力决定它是**资源类型**还是**页面类型**：带 `patterns`（可选 `canOpen` 否决）的是资源类型，只能经 `ctx.sidebarRight.openResource('dsh-resource://…')` 打开（示例：文档预览的 `textDefinition()` 用 `patterns: ["dsh-resource://file/**"]` + `priority: "fallback"` + `canOpen`，见 `dsh-client-ui-sidebar-documentpreview/lib/client.js`）；省略 `patterns` 的是页面类型，由 `openTab(kind)` 打开（示例：官方 `guideDefinition(t)` 没有 `patterns`，见 `dsh-client-ui-sidebar-right/lib/client.js`）。

### 3.2 「新开一个自己的 tab」的完整调用链（问题 1）

| 步骤 | API | 签名 / 事实 | 来源 |
|---|---|---|---|
| 1 | `ctx.sidebarRightTabs` | `SidebarRightTabRegistry` 实例；`.register(def): () => void`（**幂等 disposer，调用方自己挂 `ctx.effect`**） | 类型 `ui-sidebar-right`：`client/index.d.ts` 的 `declare module '@deepseek-ai/cordis'`（服务声明）+ `client/tab-registry.d.ts` 的 `SidebarRightTabRegistry.register` |
| 2 | 注册体/标题 | `ctx.slots.register({ name: 'sidebar.right.pane.tab', key: def.id }, Component)` | 类型 `dsh-client-ui-sidebar-right/lib/types/client/contract/slots.d.ts` 的 `SlotMap['sidebar.right.pane.tab']`；官方范例 `dsh-client-ui-sidebar-right/lib/client.js` 的 `apply` |
| 3 | 打开 | `ctx.sidebarRight.openTab(kind, options?)` → `options` = `{ paneId?, replaceTab?: TabId, revealIfOpened?, params? }` | 类型 `dsh-client-ui-sidebar-right/lib/types/client/service.d.ts` 的 `ISidebarRight.openTab` / `SidebarRightOpenTabOptions` |
| 4 | 其他动作 | `close(tabId)` / `active()` / `isExpanded()` / `toggleExpanded()` / `focus(tabId)` / `split(paneId?)` / `float(tabId, rect?)` / `dock(paneId)` | 同 `ISidebarRight` |
| 5 | 资源（非页面） | `openResource(address: 'dsh-resource://<type>/…', options?)` | 同 `ISidebarRight.openResource` |
| — | 与面板展示的耦合 | 打开**会在同一步展开右列**（「content the user cannot see is not opened」） | 同 `ISidebarRight.openResource` 的 doc |
| — | 无座位时 | `openTab` 在**没有 mounted seat** 时**抛错**（`sidebarRight: no session surface is mounted`，R2: line 1415）；`active()` 返回 `undefined` | 同 `ISidebarRight.active` 的 doc |

**`tab.kind` 有哪些取值？** 契约上是**开放字符串集合**，不是编译期枚举：`SidebarRightTabDefinition.kind: string`（`dsh-client-ui-sidebar-right/lib/types/client/tab-registry.d.ts`，注释"Type discriminator: what the tabs of this type are, and what `openTab` names"）；rc.2 目录也把它写成 `keyDomain: "open: any string the owner dispatches (no compile-time key set), none are taken yet"`（槽位 `sidebar.right.pane.tab` 的 `keyDomain`，见 §1.3 定位）。

**rc.2 出厂只有 3 个 kind 字面量**（每个都在实现里可读）：

| 定义者 | kind 字面量 | id（= 槽位 key） | 来源 |
|---|---|---|---|
| 官方 guide | `"guide"` | `@deepseek-ai/dsh-client-ui-sidebar-right/guide` | `dsh-client-ui-sidebar-right/lib/client.js` 的 `GUIDE_KIND` / `GUIDE_ID` / `guideDefinition()` |
| 文件树 | `"files"` | `@deepseek-ai/dsh-client-ui-sidebar-files` | `dsh-client-ui-sidebar-files/lib/client.js` 的 `FILES_KIND` / `FILES_ID` / 其 definition 工厂 |
| 文档预览（**资源类型，非页面**） | `"text"` | `@deepseek-ai/dsh-client-ui-sidebar-documentpreview` | `dsh-client-ui-sidebar-documentpreview/lib/client.js` 的 `TEXTPREVIEW_KIND` / `TEXTPREVIEW_ID` / `textDefinition()` |

文档预览这个样本尤其有说明力：它是**从另一个包**用**完全相同的两阶段公开路径**接进来的（`ctx.sidebarRightTabs.register(textDefinition())` + `sidebar.right.pane.tab` / `.title` 两处 `slots.register`，见 `dsh-client-ui-sidebar-documentpreview/lib/client.js` 的 `apply`）——官方文档原话「the guide registers through those stages unmodified, exactly as a type shipped from another package does — `ui-sidebar-documentpreview` is the live proof」（`dsh-client-ui-sidebar-right/lib/types/client/index.d.ts` 模块头注释）。**→ 第三方自建 kind 是官方预期用法，不是 hack。**

### 3.3 `sidebar.right.tab.*` 与 `.menu.item` 的注册契约（问题 2）

| 槽位 | kind | registerOptions | ownerProps | standardProps 增补 | declaredBy | occupants | replaceRisk |
|---|---|---|---|---|---|---|---|
| `sidebar.right.pane.tab.title` | keyed | `key: string`(required) | `[]` | `hookContext: TabHookContext` + `inject: SidebarRightTabInjected` | `rightbar.session`（`client-ui-sidebar-right`） | 三个 type 的 Title | `none` |
| `sidebar.right.tab.document` | keyed | `key: string`(required) | `DocumentContent`（`{kind:'text'…}` / `{kind:'bytes'…}`） | 同 `useResource` 等 + `hookContext: UseSidebarRightTabInfo` | **`sidebar.right.pane.tab`**（`client-ui-sidebar-documentpreview`）→ 二级子槽 | 该包 6 个 body | `none` |
| `sidebar.right.tab.guide` | **chain** | `select: (owner) => unknown \| null`(required) | `[]` | `hookContext: UseSidebarRightTabInfo` | `sidebar.right.pane.tab`（`client-ui-sidebar-right`） | （空，可被完全替换） | `none` |
| `sidebar.right.tab.menu.item` | list | `id`(req) / `order?` / `label?` | `{ tab: TabRecord, dismiss: () => void }` | 全量 session 标准包 | `rightbar.session` | （空） | `none` |
| `sidebar.right.pane.tab` | keyed | `key: string`(required) | `[]` | `hookContext: TabHookContext` + `inject: SidebarRightTabInjected` | `rightbar.session` | 三个 type 的 body | `none` |

来源：四个槽位的原始目录项（`sidebar.right.pane.tab` / `.title` / `sidebar.right.tab.document` / `.guide` / `.menu.item`，定位见 §1.3）、类型 `dsh-client-ui-sidebar-right/lib/types/client/contract/slots.d.ts` 的 `SlotMap`、子槽声明见 `dsh-client-ui-sidebar-right/lib/client.js` 的 `apply`（`rightbar.session` 的 `children` 表）。

**`registerOptions` 不只类型面有，运行时也会校验**（**解包产物**，见 §1.1 的「类型面与运行时面不是同一棵树」）——`dsh-client-ui-slots/lib/index.js` 的 `register()` 里，`list` 槽缺 `id` 直接抛错：

```
if (options.id === void 0) throw new Error(`list slot "${options.name}" requires options.id`)
```

（同一段随后还用 `options.id` + `options.priority` 做**同 cell 冲突**判定：同 `id` 同 `priority` 二次注册即抛。类型面的声明见 `dsh-client-ui-slots/lib/types/index.d.ts` 的 `KindOptions` —— `list` 分支把 `id` 标为必填、`keyed` 分支用 `key`。）

运行时能拿到什么：官方把 **`TabHookContext`（框架侧派发上下文）**喂给注册方声明的 `hooks.tabInfo` 工厂，由**工厂**把它展开成
`{ sidebar: { expanded, fullscreen }, panel: { id }, tab: TabRecord & { visible, navigation: { address, params, revision }, signal, actions: { openResource, openTab, close } } }`
（官方展开逻辑：`dsh-client-ui-sidebar-right/lib/client.js` 的 `tabInfoFactory`，R2: line 3601-3635；签名 `SlotHookFactory<'sidebar.right.pane.tab', UseSidebarRightTabInfo>`，类型见 `contract/slots.d.ts` 的 `SidebarRightTabInfo` / `UseSidebarRightTabInfo`）。
→ **`tab` 是它自己的那条记录**，`navigation.revision` 每次导航自增，所以「同一个 tab 被再次 open」可被观测。
→ 注意：`TabHookContext` 本身只有 `{ tabId, title, fullscreen, signal, actions, useStore, useTabNavigation }`（`dsh-client-ui-sidebar-right/lib/types/client/tab-info.d.ts`），**不是** `SidebarRightTabInfo`；要拿到后者必须走 `tabInfo` 工厂（或自己按官方那 35 行展开）。
`.menu.item` 的 `dismiss` 是**硬要求**：注释原文「An item that acts MUST call this」（`contract/slots.d.ts` 的 `SidebarRightTabMenuOwnerProps.dismiss`）。

---

## 4. 官方「活动栏 + 主面板」配对机制（问题 3）

### 4.1 配对是「id === main key」，但不是「必须注册 `main` 才能有图标」

| 事实 | 证据（**快照代号见 §1.1**） |
|---|---|
| `sidebar.panellist` 的每个 row 由 **list entry** 生成，`id/order/label` 都取自注册选项；label 经 `resolveSlotLabel` 求值、**缺省回退 id**；列表变更经 `slots.subscribe('sidebar.panellist', …)` 同步，locale 变更也触发同一同步 | `dsh-client-ui-sidebar/lib/client.js` 的 `syncPanels`（R2: line 345-360） |
| 点击 row → `selectPanel(id)` → **`ctx.layout.selectPanel(id)`** | `dsh-client-ui-sidebar/lib/client.js` 的 `PanelRow` 组件（R2: line 106-132）与 `apply` 里的 `selectPanel`（R2: line 370-372） |
| 中央面板按 **`activePanelId`** 派发；`null` → `'conversation'`；key 就是 sidebar entry id | `dsh-client-ui-layout/lib/client.js` 的 `AppFrame`（R2: line 115 的 `renderSlot("main", {}, { entryKey: usePanelInfo(…activePanelId) ?? "conversation" })`） |
| `ctx.layout.selectPanel(panelId)` 在**该 main key 未注册时抛错**并保留原选择 | `dsh-client-ui-layout/lib/client.js` 的 `selectPanel`（R2: line 412-415，`layout.selectPanel: main panel "…" is not registered`）；服务签名见服务目录 `layout.selectPanel` |
| 图标内容仍由**你自己的 entry**渲染：`renderSlot('sidebar.panellist', { size, active }, { only: id })` —— owner props `SidebarPanelIconOwnerProps = { size: number, active: boolean }` | `dsh-client-ui-sidebar/lib/client.js` 的 `PanelRow`（R2: line 120-131）；目录项 ownerProps 见槽位 `sidebar.panellist` |
| 退出活动栏状态由 `ctx.layout.retainMainPanels(panelIds)` 协调（未注册面板会被置回 `null`） | `dsh-client-ui-layout/lib/client.js`（R2: line 357-358） |

**结论**：这是一个**两半配套**的机制——
① 注册 `sidebar.panellist`（list, root）拿到**图标按钮**（`id` 即地址）；
② 注册 `main` 的**同 key**（keyed, root）拿到**中央面板正文**，否则点击会在 `selectPanel` 处抛错（或面板为空）。
这**就是**官方形态的「better-sidebar 式侧边面板」：活动栏图标 + 中央面板切换，**而且官方自己还没占任何 key**（`main` 的 `keyDomain` 只列出 `conversation` 被占；`sidebar.panellist` 的 `occupants` 为空，定位见 §1.3）。`scope` 是 `root`，所以面板**拿不到 session 绑定**——注释原文「other keys receive no Session binding」（槽位 `main` 的 `doc`），要按会话取数得自己在面板里用 `useSessions`/投影。

### 4.2 与现有 `sidebar.workspaces` 的关系（对行徽标的意义）

`sidebar.workspaces` 在 rc.2 **仍是 single 且 replaceRisk 未变**，`main` 是**新增**的另一个 root 槽（不是把 `sidebar.workspaces` 挪走）。因此 `row-badges`（DOM 启发式层）所依赖的「侧边栏会话行」容器**在槽位层面没有被替换**——静态层未见新风险；真实 DOM 是否仍匹配由 `t3`（lab 实测）给出运行时结论，本文不替代。

---

## 5. 我们 4 个现有槽的字段级 diff（rc.2 vs 0.1.2-rc.1）（问题 5）

方法（机械判定，可复现）：对两个目录快照的 `kind / scope / registerOptions / ownerProps / declaredBy / occupants / replaceRisk / example / keyDomain / slotInject / hookContext` 做**逐字节**比较（`source`/`doc`/`summary` 的行号与文案漂移不计入）：

```
node .tmp/slot-recon/slot-contract-strict.mjs \
     .tmp/slot-recon/slots-0.1.2-rc.1.json .tmp/slot-recon/slots-0.1.5-rc.2.json
→ 49 个共有槽：32 个 11 字段全等；17 个有漂移（§2.3 逐项列出）
→ 我方 5 个槽（4 个现有 + conversation.view）全部在「全等」集合
```

| 槽位 | kind/scope | registerOptions | ownerProps | declaredBy | occupants | replaceRisk | 差异 |
|---|---|---|---|---|---|---|---|
| `sidebar.workspaces.directoryFlow` | single/root 同 | 同（`[]`） | 同（`DirectoryFlowOwnerProps`） | 同 | 同（`…directory-picker-browse/native`） | 同 `shadows-shipped-ui` | **仅 `standardProps` +2** |
| `conversation.hero.workspace.directoryFlow` | single/root 同 | 同 | 同 | 同 | 同 | 同 `shadows-shipped-ui` | **仅 `standardProps` +2** |
| `settings.section` | list/root 同 | 同（`id`/`order`/`label`） | 同（`SettingsSectionOwnerProps`） | 同 | 同（4 个 section） | 同 `none` | **仅 `standardProps` +2** |
| `conversation.session.header.actions` | list/session 同 | 同 | 同（`ConversationHeaderActionOwnerProps`） | 同 | 同（4 个 action） | 同 `none` | **仅 `standardProps` +2**，`source` 行号漂移（上游文件行 105→133） |

唯一的 `standardProps` 变化是**全局追加两个**（49 个共有槽**全部**如此）：

```
+ "useResource: UseResource"     （新增全局标准面）
+ "usePanelInfo: UsePanelInfo"   （`dsh-client-ui-layout/lib/types/client/index.d.ts` 的 `GlobalStandardProps`）
```

`usePanelInfo` 的类型声明为 `SnapshotSelectorHook<PanelInfo>`，`PanelInfo.activePanelId` 即第 4 节的选择状态（见 `dsh-client-ui-layout/lib/types/client/index.d.ts` 的 `UsePanelInfo` / `GlobalStandardProps`）。**追加是纯加法**：我们的 4 处注册都没有声明 `hooks`，组件也不会因为多收到一个 hook 而改变行为。→ **本次重排对我们零隐性破坏**。

补充：`conversation.view`（`REQ-I1` 目标）在上述严格比较里属于 **32 个 clean 之一**——`kind/scope/registerOptions/ownerProps/occupants('chat','trajectory')/replaceRisk('none')/example` 全部逐字节相同；只有 `source` 字段的**上游文件行号**在漂（`packages/client/ui-conversation/src/client/contract/slots.ts` 的 117 → 156），与契约无关。

---

## 6. 依赖与装载事实（决定「要不要加 peer」）

| 事实 | 证据（符号/字段名优先） |
|---|---|
| `ui-sidebar-right` 是 **rc.2 web 捆绑的默认行**，不是可选第三方 | `@deepseek-ai/dsh-web-app@0.1.5-rc.2/package.json` 的 `dependencies` 含 `@deepseek-ai/dsh-client-ui-sidebar-right ^0.1.5-rc.2`；同包 `cordis.patch.yml` 有 `- id: ui-sidebar-right` 行（紧邻 `ui-layout` / `resources`） |
| 对照 `0.1.2-rc.1`：**没有**这个包，也没有 `rightbar`/`main` 体系 | 全局安装树 `…\dsh\node_modules\@deepseek-ai\` 下不存在 `dsh-client-ui-sidebar-right`；其 `dsh-web-app` 的 deps 只含 `dsh-client-ui-{conversation,layout,sidebar}`；槽位目录见 §2 |
| 它对外提供**两个服务**：`ctx.sidebarRight`（`SidebarRightController`）与 `ctx.sidebarRightTabs`（注册表） | 类型 `dsh-client-ui-sidebar-right/lib/types/client/index.d.ts` 的 `declare module '@deepseek-ai/cordis'` 段（同时声明两个键）；实现 `dsh-client-ui-sidebar-right/lib/client.js` 的 `apply`（`ctx.reflect.provide('sidebarRightTabs'\|'sidebarRight', …)`，R2: line 3667-3668） |
| `ctx.reflect.provide(name, value)` 是 cordis 的合法公开面：注册服务、**返回 disposer**、名字已被提供或被声明为 accessor 时抛错 | `@deepseek-ai/cordis@4.0.2/lib/types/reflect.d.ts` 的 `Context.provide` / `ReflectService.provide`（⇒ `Disposable<Promise<void>>`） |
| 消费方语法：官方 `ui-chat` 在 `inject` 数组里列 `'sidebarRight'`，然后 `ctx.sidebarRight.openResource(url)` | `dsh-client-ui-chat@0.1.5-rc.2/lib/client.js` 的 `inject` 数组（含 `'sidebarRight'`）与其 `apply` 内的 `ctx.sidebarRight.openResource(url)` 调用 |
| **版本门**：全套 rc.2 槽位只在 `0.1.5-rc.2+` 存在；`0.1.2-rc.1` 家族里 `ctx.sidebarRight` 与 `rightbar`/`main` 都不存在 | 上两行对照 + §2 |

**对我们的含义**：本插件 peer 已是联合范围 `^0.1.2-rc.1 || ^0.1.5-rc.1`（`package.json` 的 `peerDependencies`，**声明不新增包**），所以：

1. 任何用到 rc.2 新槽/新服务的代码**必须走可选路径**（`ctx.get('sidebarRight')` 判空 → 缺服务时优雅降级），或把 `@deepseek-ai/dsh-client-ui-sidebar-right` 显式加进 `package.json` 的 `dsh.client.inject` + peer 联合范围——**后者等于给整包加一个硬依赖，本轮不建议**（`ADR-0009` 的窄化原则）。
2. `inject: ['sidebarRight']` 这种**硬依赖写法会让插件在 0.1.2-rc.1 宿主上永不激活**，属于破坏联合窗口，**禁止**。
3. 服务键在当前 DSH 里并不经过 `dsh.client.inject` 的装载顺序保证（它是 cordis 的 `reflect.provide`，不是 `slots`/`locale` 那类由 bundle 排序的插件面），所以**首用探测**仍是唯一稳的做法（`docs/compatibility.md` §4.1-4.2）。

---

## 7. 对 `REQ-I1` 的判定（问题 4）

### 7.1 事实对比

| 面 | `conversation.view`（原目标） | `sidebar.right.pane.tab` + `ctx.sidebarRight` | `sidebar.panellist` + `main` |
|---|---|---|---|
| 用户看见的是 | 对话/轨迹区**那颗 tab 环**（chat / trajectory 旁） | **右侧面板**里的一个 tab（可停靠/浮动/分屏） | **最左侧活动栏图标** → 切换**中央面板** |
| kind/scope | list / session | keyed / session | list / root + keyed / root |
| 注册面 | `ctx.slots.register({ id, order, label }, …)`，**一处** | **两处**：类型注册表 + keyed 槽（`.title` 第三处可选） | **两处**：panellist 图标 + `main` 同 key |
| 拿到 sessionId | **是**（session scope） | **是**（session scope） | **否**（root：「other keys receive no Session binding」） |
| 官方已占者 | `chat` / `trajectory`（**并列新增**） | 三个 type（`guide` / 文档预览 / 文件树），key 未占满 | `main` 只占 `conversation`；panellist 空 |
| replaceRisk | `none` | `none` | `shadows-shipped-ui`（**但只在复用自己的 key 时才发生**） |
| 生命周期可逆性 | `ctx.slots.inject` 等待声明 + fiber 事务 | 注册表 `register()` 返回 disposer（要自己挂 effect）+ 槽位同左 | 同左 |
| 版本门 | `0.1.2-rc.1` 起就有 | **`0.1.5-rc.2` 才有** | **`0.1.5-rc.2` 才有** |

### 7.2 判定：`REQ-I1` **不换落点**，理由按权重

1. **需求原话就是那颗 tab 环**（"对话/轨迹这个 tab 区还能加面板 tab"）。`sidebar.right.pane.tab` 是**右侧面板自己的 tab 条**，形状是「同一屏多面板」，不是「对话区多视图」——**换落点等于换需求**。
2. **rc.2 没动 `conversation.view` 的契约**：本次字段级 diff 证明 `kind/scope/registerOptions/ownerProps/occupants/replaceRisk` 全等；实现侧也仍是同一形状——`ConversationRoot` 调 `renderSlot('conversation.view', {viewRequest, openView, completeViewRequest}, { only: active.id })`、常量 `DEFAULT_VIEW_ID = 'chat'`、tab 条仍要求 `tabs.length > 1`、blank 会话仍 `return null`（均在 `dsh-client-ui-conversation@0.1.5-rc.2/lib/client.js`；R2 之外的该文件无快照冲突，行号仅作自查：15124-15128 / 14979 / 15085 / 15121）。→ `ADR-0016` **不需要修订**，其风险表 R1–R9 全部继续有效。
3. **联合支持窗口**：`REQ-I1` 走 `conversation.view` 时，0.1.2-rc.1 与 0.1.5-rc.2 **两个家族都能用**；换成右侧面板体系则**只有 rc.2 能用**，等于把插件功能按宿主切两半。这是本轮最重的取舍。
4. **替换风险与接管面**：`conversation.view` 的 `replaceRisk: none`（新增 entry，与 chat/trajectory 并列）；`main`/`rightbar`/`main.conversation`/`conversation.session.header.corner` 全是 `shadows-shipped-ui`——**注册即替换官方 UI**（角落位已被 `ExpandButton` 占用，被我们注册后右侧面板的「展开」入口就没了）。
5. **成本**：`REQ-I1` 已有一份成本已知的骨架（`ADR-0016` §5，含 `id` 入 localStorage 偏好键这一不可改名约束）；右侧面板路线要做「类型 + 体 + 标题 + 可能 guide entry」四处注册，还要自造 store/导航语义，**远超"可扩展面板 tab"这个需求**。

### 7.3 与之并列的**新需求候选**（不在本 ADR 决策范围内，交由用户拍板）

| 候选 | 内容 | 前置 |
|---|---|---|
| `REQ-I2b`（右侧面板 Tab） | 用 `ctx.sidebarRightTabs.register` + `sidebar.right.pane.tab` 把「远程机器状态 / 连接日志 / 远端目录」做成**右侧面板 tab**，`ctx.sidebarRight.openTab()` 打开 | 仅 rc.2；需决定是否接受「只在 rc.2 可用」 |
| `REQ-I3`（活动栏 + 中央面板） | 用 `sidebar.panellist` + `main` 把「会话/工作区浏览」之外的一个**全局面板**（例如「远程机器控制台」）放上活动栏 | 仅 rc.2；root scope 无 session 绑定，需自取数 |
| `REQ-I4`（header 角落位） | `conversation.session.header.corner` —— **不建议**：已被官方 `ExpandButton` 占用，注册即顶掉右侧面板展开入口 | — |

> 与 `ADR-0016` §4.3 的保留项一致：这些都是**另一条体验线**，不阻塞 `REQ-I1`。

### 7.4 本轮「最小远程状态入口」（`t4`）的落点：与上述判定**一致**，不冲突

captain 已把 `t4` 的主落点定在 **`conversation.session.header.utilities`**（`list` / `session` / `replaceRisk: none`），兜底为已占的 `conversation.session.header.actions`。本 ADR **支持**该落点，理由与 §7.2 同源：

| 判据 | `conversation.session.header.utilities` | `sidebar.right.pane.tab` |
|---|---|---|
| 存在于哪个家族 | **0.1.2-rc.1 与 0.1.5-rc.2 都有**（§1.3 的 `R1` 列 + §5 clean） | 只有 rc.2 |
| 注册成本 | 一处 `slots.register`（与现有 4 处同模式，`src/client/index.ts`） | 三处（类型 + 体 + 可选标题）+ 自造 store |
| `scope` | `session`（直接拿 `sessionId`） | `session`（但需经 `tabInfo` 工厂展开） |
| 是否需要新依赖/新服务探测 | **不需要** | 需要 `ctx.get('sidebarRight*')` 探测 |
| 与本 ADR 结论的关系 | 同属「用既有官方槽做入口」 | 属 `REQ-I2b` 候选，本轮不做 |

> 因此：**`REQ-I1` 的大面板仍走 `conversation.view`；本轮的「最小远程状态入口」走 `header.utilities`。** 两者是不同粒度的两件事，互不替换，也不冲突——`t4` 的最小入口**不**等于 `REQ-I1` 的实现。

### 7.5 `t4` 实际交付事实（由 engineer-client 报告，供 `t6` 与评审引用）

| 项 | 值 |
|---|---|
| 槽位 | `conversation.session.header.utilities`（逐字；`list` / `session` / `replaceRisk: none`） |
| entry `id` | `dsh-workspace-enhancement-remote`（自有——**不覆盖** shipped 的 `open-in-app` 与 `session-log-download`） |
| `order` | **26**（见下「为什么 26」） |
| `locale` / `label` | `locale: 'dsw'`；`label: () => t('header.remote.label')`（thunk ⇒ 语言切换**不重注册**） |
| 新增词典键 | **2**：`header.remote.label`、`header.remote.title`（含 `{machine}` 参数） |
| 新增用例 | **7**（`test/remote-status.test.ts`，沙箱内真跑、未 SKIP） |
| 真相源 | `ctx.sessions.list` 的 snapshot（`{ids,byId,current,phase}`，`byId` 以 sessionId 为键且行内含 `cwd`）→ `routeIdOf(cwd)`；**本地会话或取不到 cwd/会话行一律不显示**（零噪音） |
| 状态口径 | 端点 `conn.status` / `conn.reconnect`（与 `row-badges` **同一对**），复用 `StatusCenter`，**零新增计时器** |
| 验证 | `check:static`=0 / `typecheck`=0 / `test:agent`=0 / `build`=0；另 `npm test`=0（283/282/0，含 `.tsx` 用例） |

**为什么 `order: 26`** —— 由**契约原文**背书（不是推导）：三个设计选择逐一对应 `registerOptions` 的 `doc` 文本，可用
`npm run slots -- --key conversation.session.header.utilities <bundle.js>` 复核（§1.2）：

| `t4` 的选择 | 契约原文（逐字，来自该槽的 `registerOptions[].doc`） | 由谁背书 |
|---|---|---|
| 自有 `id`：`dsh-workspace-enhancement-remote` | 「Use an id of your own: **a fresh id is added beside the shipped entries**, while reusing a shipped id puts you in THAT cell and replaces it」 | **加在旁边**，不替换任何 shipped entry |
| `order: 26` | 「Position among the entries, **ascending (default 0)**」+ 两个 shipped occupant **都未声明 order** ⇒ 默认 0 ⇒ 任何 `order > 0` 都排在**它们之后** | **不改动任何 shipped cell 的相对次序**；不用负 order 挤到最前（captain 要求「不动 shipped」优先） |
| `label: () => t('header.remote.label')` | 「**A thunk is re-read on every projection**, so localized text follows the active locale without re-registering」 | 语言切换**不重注册** |
| 组件用 `props.sessionId` | 两家族的 `standardProps` **都含** `sessionId: SessionId`（rc.2 另加 `useResource` / `usePanelInfo`） | 标准包由框架注入，无需适配 |

> 该槽在两家族的**一致**部分（`kind: list` / `scope: session` / `replaceRisk: none` / `declaredBy: an entry in 'conversation.session.header'`）与 occupants 差异（rc.1 = `session-log-download`；rc.2 = `open-in-app` + `session-log-download`）已由**三次独立复核**确认：t1 的目录抽取、engineer-client 的 JSON dump、engineer-client 用本节工具 `--key` 的第三次复核。**⇒ 「特性在线上家族可见」是硬事实，不是推断。**

**fallback 规则（记录备查，且已核实无需回退）**：若将来 lab 实测该 seat 不挂载，**只把常量 `REMOTE_STATUS_SLOT` 改成 `conversation.session.header.actions`**（一行），**永不双注册**——客户端没有「同步判定槽位是否存在」的公开面（`slots.inject` 是**等声明**，不是**问存在**），双注册只会两边都挂。按 §1.3/§5 的证据（该槽在 `R1` 里**既声明又渲染**），这条 fallback 基本用不上，可写作「**已核实无需回退**」。

**一处需要在兼容性里点明的改动**：`routeIdOf` 从 `src/client/row-badges.ts` **纯搬迁**到新纯 `.ts` 模块 `src/client/route-id.ts`，`row-badges.ts` 改为 `import` + `export { routeIdOf }`（对外导出名与行为不变，`test/row-badges.test.ts` 一字节未动）。动机：`test:agent` 的纯类型剥离连**传递依赖的 `.tsx`** 都加载不了 —— 这是 `docs/compatibility.md` §4 之外的一条**沙箱约束**，`t6` 需写入真相源。

### 7.6 客户端 route 判定是 host 判定的**宽松镜像**（不承诺等价）

`remoteConnectionIdOf` 的 `ssh://` 分支与 `routeIdOf` 的正则都比 host 侧判定**更宽松**。三处偏离（**已由 scout-slots 逐条对 host 源码复核**，非转述）：

| # | 输入 | 客户端（`src/client/route-id.ts` / `remote-status.ts`） | host（`src/registry.ts` `parseSshRoute` / `src/transport.ts` `routeFromPlaceholder`） |
|---|---|---|---|
| **D1** | `ssh://c3`（有 id 无路径） | 返回 `c3`（只校验 id 正则） | `separator <= 0` ⇒ **null（当作本地）** |
| **D2** | `ssh://<id>/<非绝对路径>` | 返回 id（**不校验 path 绝对性**） | `!posix.isAbsolute(path)` ⇒ null |
| **D3** | 任一**包含** `dsw-routes/<seg>` / `dsh-ssh-routes/<seg>` 的字符串 | 正则全局命中即取 `<seg>`（**不要求在 `$DSH_HOME` 之下**） | `relative(root, resolve(value))` 必须落在根内，且存在时有 **realpath 重试** ⇒ 根外输入为 null |

**实际影响面（别夸大）**：
1. **这是既有行为，不是 t4 新增**。`git diff -- src/client/row-badges.ts` 只显示 `routeIdOf` 的**定义行被移除**、改为 `import` + `export`；`row-badges.ts:201`（工作区路径）与 `:235`（会话 cwd）两处调用**逐字未改**。t4 只是让第二个消费者（`remote-status.ts:36`）复用同一规则。
2. **D1/D2 在当前 host 契约下不可达**：host 产出的是 `ssh://<id>/<绝对路径>`（`session-workspaces.ts:142-146` 的 `normalizeRemoteKey(\`ssh://${route.connectionId}${route.path}\`)`，其中 `path` 来自 `routeFromPlaceholder` ⇒ 必以 `/` 开头），且 lab 实测会话 cwd 用的是**占位符树路径**（`…\dsw-routes\c1\home\uuz\…`）而非 `ssh://`。⇒ 这两条是**防御性分支**。
3. **D3 是概念上可连通的**：它只看字符串，所以本地目录里恰好出现字面 `dsw-routes/<id>` 段（例 `/tmp/dsw-routes/c1/x`）时，客户端会给一个本地会话判断出远程 id ⇒ 我们的 cell 会**多显示一次**（状态通常停在 `未检测`）。这正是 t5 把它列为「有意偏离需注释」的原因。
4. **D3 的宽松是架构性的、不是疏忽**：客户端没有 `node:fs`，**做不了 realpath 归一**，只能按字符串判定。
5. **需要等价判定的地方必须回 host 取事实**（例如 `session.route`），**不要**用客户端镜像当权威。

> 处置：本 ADR 记录事实与边界；t5 要求的「代码注释补一句『有意偏离』」属 `src/` 变更，**不在本轮任何已派任务范围内**（t4 已终态；t8 是徽标 DOM 修复）。若拍板要消灭 D3 的误判，应**另开一条**（改 `routeIdOf` 会动到 row-badges 既有语义，属独立决策）。

**AUDIT-4 修法（t5 观察 ①，已登记待偿）**：`showsRemoteStatus`（`src/client/remote-status.ts:92`）在 `src/**` **零调用者**（只有 `test/remote-status.test.ts` 引用它），真正决定渲染的是 `remote-status-entry.tsx:59` 的 `connId === undefined → null`。修法 = 把判定下沉为**唯一决策函数**、视图只消费它：

```ts
// src/client/remote-status.ts（纯 .ts，沙箱可测）
export function remoteCellOf(facts: RemoteSessionFacts | undefined): { connId: string } | null {
  const connId = remoteConnectionIdOf(facts?.cwd)
  return connId === undefined ? null : { connId }
}
export const showsRemoteStatus = (facts: RemoteSessionFacts | undefined): boolean => remoteCellOf(facts) !== null
```

视图侧改为 `const cell = remoteCellOf(facts); if (cell === null) return null` 后使用 `cell.connId` —— 这样**被测的那条分支就是决定渲染的那条分支**（`.tsx` 本身在沙箱仍跑不到，但决定权已离开视图）。**验收**：`npm run test:agent` 能覆盖真正决定渲染的那条分支。

---

## 8. 注册示例（**客户端 bundle 可用的普通 JS**：`React.createElement`，无 bundler 转换、无 TS 语法）

### 8.1 `REQ-I1` 目标形状（`conversation.view`，沿用 `ADR-0016`）

```js
// 复用现有模式（src/client/index.ts:185-215 的三处注册）+ rc.2 契约
return {
  inject: ['slots', 'workspaces', 'sessions', 'locale'],
  apply(ctx) {
    const t = ctx.locale.bind('dsw')
    ctx.slots.inject('conversation.view', () => ctx.slots.register({
      name: 'conversation.view',
      id: 'dsh-workspace-enhancement-panel',   // 进入 localStorage 偏好键，发布后不可改名
      order: 20,                               // chat(0) → trajectory(10) → 本面板(20)
      label: () => t('panel.tab'),             // thunk：语言切换就地生效
      locale: 'dsw',
      registrant: 'dsh-workspace-enhancement',
      inject: (sessionId) => ({
        rpc: (endpoint, payload) => callDsw(ctx, endpoint, { sessionId, ...payload }),
      }),
    }, function WorkspacePanel(props) {
      return React.createElement('div', { role: 'tabpanel' }, String(props.sessionId))
    }))
  },
}
```

### 8.2 右侧面板 Tab 的最小形状（**未落地**；仅证明接缝可用，供 `REQ-I2b` 起手）

```js
// 两阶段 + 可选标题；全部走 ctx.get 探测（联合窗口：0.1.2-rc.1 上这两个服务不存在）
const KIND = 'dsw-remote'
const TYPE_ID = 'dsh-workspace-enhancement/remote-status'

return {
  inject: ['slots', 'locale'],           // 注意：不 inject 'sidebarRight'（会破坏老宿主激活）
  apply(ctx) {
    const t = ctx.locale.bind('dsw')
    const tabs = ctx.get('sidebarRightTabs')      // 可选服务，判空
    const right = ctx.get('sidebarRight')
    if (tabs === undefined || right === undefined) return   // 老宿主：静默降级，不炸
    ctx.effect(() => tabs.register({
      id: TYPE_ID,                        // ← 就是这个 id 作为下面两个槽的 key
      kind: KIND,                         // 自建 kind：不要复用 'guide'/'files'/'text'
      priority: 'extension',              // 第三方默认 band
      title: () => t('panel.remote.statusTitle'),   // 打开时捕获进 layout 记录
      // 省略 patterns → 页面类型，由 openTab(KIND) 打开（资源类型才需要 globs）
    }), 'dse: remote tab type')
    ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
      name: 'sidebar.right.pane.tab', key: TYPE_ID,
      locale: 'dsw',
      // tabInfo 工厂：官方在 dsh-client-ui-sidebar-right/lib/client.js 的 tabInfoFactory 里给出完整展开
      // 本插件自建面板时按同样形状展开即可（不要假设 props 直接带 tab）
      inject: { hooks: { tabInfo: (standard, context) => () => ({
        tabId: context.tabId, fullscreen: context.fullscreen, signal: context.signal,
        actions: context.actions, navigation: context.useTabNavigation(context.tabId),
      }) } },
    }, function RemoteStatusBody(props) {
      return React.createElement('div', null, String(props.useTabInfo().tabId))
    }))
    // 打开：right.openTab(KIND) —— 无 mounted seat 时会抛（ui-sidebar-right 的 SidebarRightController.require），
    // 调用点必须先查 right.active() !== undefined 或 try/catch，并回退到已有 header 动作入口
  },
}
```

（`props.useTabInfo` 由 `inject.hooks.tabInfo` 隔舱转成同名 `use<Name>` hook —— `dsh-client-ui-slots` 的 `InjectFace<I>` 语义；`TabHookContext` 字段见 `dsh-client-ui-sidebar-right/lib/types/client/tab-info.d.ts`。）

---

## 9. 风险清单

| # | 风险 | 影响 | 处置 |
|---|---|---|---|
| R1 | rc.2 新槽/R 服务**只在 `0.1.5-rc.2+` 存在** | 用它们的功能在老宿主上不可用 | 只做「加法 + 能力探测」；**禁止**把 `sidebarRight` 写进 `inject`；示例见 §8.2 |
| R2 | `main` / `rightbar` / `main.conversation` / `header.corner` 的 `replaceRisk = shadows-shipped-ui` | 注册即**替换官方 UI**（角落位一注册就顶掉 `ExpandButton`） | 这些面只做「我们自己的 key / 明确想要接管时才用」；`REQ-I1` 不碰它们 |
| R3 | `sidebar.right.pane.tab` 的 key 语义=「kind 的类型 id」 | 只注册槽不注册类型 → 打开后显示官方 "nothing can view this"；只注册类型不注册槽 → 面板空 | 两阶段一起注册（§3.1） |
| R4 | 同 band 二次注册同 kind 抛错（`coexists`，`dsh-client-ui-sidebar-right/lib/client.js`，R2: line 3293-3296） | 与官方/其它插件撞 kind 时**插件加载失败** | 用带前缀的自有 kind（`dsw-*`），不复用 `guide`/`files`/`text`（§3.2） |
| R5 | `ctx.sidebarRight.openTab` 在无 mounted seat 时**抛错** | 从设置页/命令面板等无座位处调用会炸 | 调用点先 `active() !== undefined` 或 `try/catch` 并回退到我们已有的 header 动作入口 |
| R6 | 被删的 3 个槽（`conversation`/`details`/`conversation.details.tool`）**没有自动闸门** | 占用者静默失去挂载点（不报错）；我们**不是**占用者（已核查现网 5 个第三方包） | 已知风险登记在 `docs/compatibility.md` §2；不引入新占用 |
| R7 | `standardProps` 全局追加 `useResource` / `usePanelInfo` | 纯加法，现有 entry 不受影响 | 已核对（§5）；将来若声明 `hooks` 需重核 `dsh-client-ui-slots` 版本 |
| R8 | `row-badges` 是 DOM 启发式，rc.2 重排了右列/主面板 | 静态层无新风险（`main` 是新增槽、未替换 `sidebar.workspaces`） | 运行时结论以 `t3`（lab 50599 + rc.2 家族）为准；本文不替代实测 |
| R9 | 上游行号漂移 | 引用失效 | 本文所有引用带完整 `文件:行号`；升级家族时按 §1 流程重抽 JSON 再 diff（脚本已留在 `.tmp/slot-recon/`） |

## 10. 被否方案（"不做"的理由）

| 方案 | 否决理由 |
|---|---|
| 把 `REQ-I1` 改到 `sidebar.right.pane.tab` | 面不同（右侧面板 ≠ 对话区 tab 环）；只在 rc.2 可用，破联合窗口；成本从「一处注册」升到「类型+体+标题」三处（§7.2） |
| 把 `REQ-I1` 改到 `sidebar.panellist` + `main` | 那是**中央面板切换**（root scope，无 session 绑定），与「会话内的多视图」不是同一交互；且仍是 rc.2-only |
| 注册 `conversation.session.header.corner` 放我们的入口 | `single` + `shadows-shipped-ui`，官方 `ExpandButton` 已在里面——注册即让用户失去右侧面板展开入口 |
| 重复注册 `main` 的 `conversation` key | 会替换掉官方 `ConversationPanel`（整个对话面），同 `ADR-0016` §7 对 `conversation` 槽的否决 |
| 用 rc.2 新体系重写 `row-badges` | 行级**仍然没有**官方槽（`sidebar.workspaces` 依旧 single 且 `shadows-shipped-ui`）；DOM 层仍是唯一手段（`t2`/`t3` 负责其存活判定） |
| 为右侧面板给本包加 `dsh-client-ui-sidebar-right` 硬依赖 | 会把本包从"双家族支持"降级为"仅 rc.2"，与 `ADR-0009`/`docs/compatibility.md` §1 的联合窗口承诺冲突 |

---

## 11. 未取证项（**明确留给下一轮/lab**）

| # | 未取证 | 为什么 | 由谁 |
|---|---|---|---|
| U1 | rc.2 上 `row-badges` 的真实 DOM 是否仍匹配侧边栏行 | 静态只能证明「槽位未被替换」，证明不了 DOM 形状（React 组件内部 markup） | `t2` 静态 + `t3` lab 实测 |
| U2 | `ctx.reflect.provide` 与 `ctx.provide` 在**客户端运行时**的行为差异（是否需要在 `dsh.client.inject` 里登记才能被 `ctx.get` 看到） | 本仓库只读到 cordis 的类型契约与 `ui-chat` 的调用样本，未在 rc.2 实机调用 | 若 `REQ-I2b` 立项，用 lab（50599）实测 |
| U3 | ~~`tab.kind` 的完整出厂集合~~ → **本轮已取证**：`"guide"` / `"files"` / `"text"` 三个字面量（§3.2 表） | — | 已闭环，留此记录 |
| U6 | kind 的**保留字**是否存在（例如 `guide` 是否被 seat 的 settle 逻辑特殊对待） | `dsh-client-ui-sidebar-right/lib/types/client/stores.d.ts` 的模块注释提到「page uniqueness」按 kind 去重，但未列出保留字清单 | 若 `REQ-I2b` 立项再查 |
| U4 | `main` 面板在 root scope 下取「当前会话」的官方推荐姿势 | rc.2 文档只说「no Session binding」，未给出范例 | 若 `REQ-I3` 立项再查 |
| U5 | rc.2 的 `sidebar.workspaces` 内部行 markup（供 `t2` 对照） | 属 `t2` 范围（`dsh-client-ui-workspace@0.1.5-rc.2`），本 ADR 不重复 | `t2` |

---

## 12. 验收证据（本轮可复核）

| 项 | 命令 / 方式 | 结果 |
|---|---|---|
| 槽位目录 52→61（增 12 删 3） | `node .tmp/slot-recon/slot-keys.mjs <rc.1 runner> <rc.2 runner>` | exit 0；输出见 §2 |
| 49 个共有槽 11 字段逐字节比较 | `node .tmp/slot-recon/slot-contract-strict.mjs slots-0.1.2-rc.1.json slots-0.1.5-rc.2.json` | exit 0；**clean 32 / drifted 17**（我方 5 个槽全在 clean 集合） |
| 我们 4 个槽 + `conversation.view` 的逐字段结论 | 同脚本 `--key <key>` ×5 | exit 0；§5 表 |
| `conversation.view` rc.2 契约 | `slot-field-diff.mjs --key conversation.view` + `dsh-client-ui-conversation@0.1.5-rc.2/lib/client.js` 的 `ConversationRoot` / `DEFAULT_VIEW_ID` | 已核（§7.2） |
| 服务目录 diff | `services-0.1.2-rc.1.json` vs `services-0.1.5-rc.2.json`：8→8，`layout` 换 2 增 4（`selectPanel`/`beginNavigation`/`openRightbar`/`closeRightbar`），`uiWorkspace` 增 3 | 已核（§4.1） |
| 右侧面板两阶段模型的官方范例 | `dsh-client-ui-sidebar-right/lib/client.js` 的 `guideDefinition()`（类型定义）、`grep 'ctx.effect(() => ctx.sidebarRightTabs.register'` 行（类型注册）、`guide` 的 `sidebar.right.pane.tab` / `.title` 两处 `slots.register`（R2: line 3574-3591 / 3704 / 3749-3762） | 已核 |
| `ctx.reflect.provide` 合法性 | `@deepseek-ai/cordis@4.0.2/lib/types/reflect.d.ts` 的 `Context.provide` 与 `ReflectService.provide` | 已核 |
| rc.2 默认挂载 ui-sidebar-right | `dsh-web-app@0.1.5-rc.2/package.json` 的 `dependencies` + 其 `cordis.patch.yml` 的 `- id: ui-sidebar-right` 行 | 已核 |
| 现网第三方无被删槽占用 | grep `$DSH_HOME/profiles/web/node_modules/{dsh-better-sidebar,dsh-context,dsh-mnemon,dsh-whale-widget,dshmarket}` | 已核（0 命中槽名） |
| 未调用被禁工具 | 本会话未调用 `cordis_inspect_*` | 遵守 |

> 本 ADR **不产生代码改动**。`REQ-I1` 的实现轮需在 rc.2 契约上补 `e2e/scenarios.md` 新场景（`ADR-0016` §9 已给 `E2E-08` 草案）与 `docs/uat/` 脚本；右侧面板线（`REQ-I2b`/`REQ-I3`）若要立项，需先做 `U2` 的 lab 实测。
