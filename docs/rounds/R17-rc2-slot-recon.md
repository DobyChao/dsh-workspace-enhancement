# R17（槽位侦察轨道）— 0.1.5-rc.2 客户端槽位重排侦察 + REQ-I1 路线重估

> 触发：`0.1.5-rc.2` 发布（全家 `next` 指向它），客户端槽位目录从 **52 → 61**。
> 本轨道**只做侦察与决策文档**：产出 `ADR-0017`（proposed）。实现代码与行徽标实测属同轮其它轨道（`t2`/`t3`/`t4`/`t5`）。
> 硬约束遵守：**未调用** `cordis_inspect_list` / `cordis_inspect_query`（`AGENTS.md` §5.7 红线 7）；契约全部来自磁盘权威源。
> **引用规范**（captain 2026-09-10 指示）：契约事实用 `key` 名 + 字段名；行号只作定位锚，且必须与产生它的文件一起引用。本报告的槽位行号一律标注快照代号 —— **`R2`** = `.tmp/slot-recon/runner-rc2/lib/client.js`（rc.2，来自 npm tarball），**`R1`** = 全局安装树的 `dsh-cordis-client-runner/lib/client.js`（0.1.2-rc.1）。**两套行号不可混用**（详见 `ADR-0017` §1.1/§1.3）。

## 1. 事实（取证，全部可复现）

| 事实 | 值 / 证据 |
|---|---|
| 取样两个家族 | rc.2：`npm pack @deepseek-ai/dsh-cordis-client-runner@0.1.5-rc.2` → `.tmp/slot-recon/runner-rc2/lib/client.js`（5174 行）；rc.1：全局安装树 `…\npm\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai\dsh-cordis-client-runner\lib\client.js`（版本 `0.1.2-rc.1`） |
| ⚠️ 溯源陷阱（engineer-client 报告，已复核） | 本机 `D:\ZCodeProject\deepseek-harness` 是 **0.1.0-rc.5**（HEAD `47f943859b`，2026-08-13）、槽位只有 **42** 个、**零** `panellist`/`pane.tab` 命中 ⇒ 拿它核验 rc.2 会得出「新槽位不存在」的**错误**结论。本报告与 `ADR-0017` **均未引用**该树（grep 无命中）。只认「已发布包解包后的 `lib/`」与全局安装树。详见 `ADR-0017` §1.1 |
| 槽位目录规模 | **52 → 61**：新增 12、删除 3（`node .tmp/slot-recon/slot-keys.mjs <rc.1> <rc.2>`，exit 0） |
| `CLIENT_SLOT_API` 边界 | `R2` 段的 `CLIENT_SLOT_API` 数组（`SLOT_CATALOG = new Map(CLIENT_SLOT_API…)` 紧随其后）；`R1` 同结构 —— 具体行号见 `ADR-0017` §1.3（避免两套快照行号混用） |
| 共有槽契约漂移 | 49 个共有槽做 11 个行为字段的**逐字节**比较：**32 clean / 17 drifted**（`node .tmp/slot-recon/slot-contract-strict.mjs …`，exit 0） |
| **我们 5 个槽全部 clean** | `sidebar.workspaces.directoryFlow` / `conversation.hero.workspace.directoryFlow` / `settings.section` / `conversation.session.header.actions` / `conversation.view` 的 `kind/scope/registerOptions/ownerProps/declaredBy/occupants/replaceRisk/example` 全部逐字节相同 |
| 唯一的全局变化 | 49 个共有槽**全部**在 `standardProps` 追加 `useResource: UseResource` 与 `usePanelInfo: UsePanelInfo`（并集 ADDED，**REMOVED 为空**）——纯加法 |
| 服务目录变化 | 顶层 key 8 → 8（`layout/locale/sessions/slots/theme/timer/uiWorkspace/workspaces`）；`layout` 删 `openDetails`/`closeDetails`、增 `selectPanel`/`beginNavigation`/`openRightbar`/`closeRightbar`；`uiWorkspace` 增 `openSession`/`openWorkspace`/`forkSession` |
| 新增 12 槽 | `rightbar`(single/root)、`rightbar.session`(single/session)、`sidebar.right.pane.tab`(**keyed**/session)、`.title`(keyed)、`sidebar.right.tab.document`(keyed)、`sidebar.right.tab.guide`(**chain**)、`sidebar.right.tab.menu.item`(list)、`sidebar.panellist`(**list**/root)、`main`(**keyed**/root)、`main.conversation`(single)、`conversation.session.header.corner`(single，**已被官方 `ExpandButton` 占**)、`tool.call.images`(single) |
| 删除 3 槽 | `conversation`、`details`、`conversation.details.tool`（均被 `main`/`rightbar` 体系取代） |
| 现网第三方是否被砸 | **否**：`$DSH_HOME/profiles/web/node_modules/{dsh-better-sidebar,dsh-context,dsh-mnemon,dsh-whale-widget,dshmarket}` 全仓 grep 无一处注册/注入这 3 个被删槽（`dsh-better-sidebar` 的 `markdown-html.ts:61`、`dshmarket` 的 `<details>` 是 HTML 标签） |
| 右侧面板 Tab 的注册链 | 两阶段：`ctx.sidebarRightTabs.register({id, kind, title, patterns?, priority?, canOpen?})`（服务由 `ui-sidebar-right/lib/client.js` 的 `apply` 用 `ctx.reflect.provide` 提供）+ `ctx.slots.register({name:'sidebar.right.pane.tab', key: <definition.id>})`；**key = 生效定义的 `id`，回退 `tab.kind`**（`ui-sidebar-right/lib/client.js` 的 `TabSlot`） |
| 打开 tab 的 API | `ctx.sidebarRight.openTab(kind, {paneId?, replaceTab?, revealIfOpened?, params?})`（`ui-sidebar-right/lib/types/client/service.d.ts` 的 `ISidebarRight.openTab` / `SidebarRightOpenTabOptions`）；无 mounted seat 时**抛错**（`sidebarRight: no session surface is mounted`） |
| 出厂 kind 集合 | `"guide"`（`ui-sidebar-right/lib/client.js` 的 `GUIDE_KIND`）、`"files"`（`ui-sidebar-files/lib/client.js` 的 `FILES_KIND`）、`"text"`（`ui-sidebar-documentpreview/lib/client.js` 的 `TEXTPREVIEW_KIND`）；文档预览是**第三方接入的活样板**（同一个 `apply` 里做类型注册 + 体/标题注册） |
| 活动栏 + 主面板 | `sidebar.panellist` list entry 生成 row（`ui-sidebar/lib/client.js` 的 `syncPanels`）→ 点击 `ctx.layout.selectPanel(id)`（同文件 `PanelRow` / `apply`）→ 中央面板按 `activePanelId ?? 'conversation'` 派发 `main`（`ui-layout/lib/client.js` 的 `AppFrame`）；未注册 key 在 `layout.selectPanel` 内抛错 |
| rc.2 默认挂载右侧面板 | `@deepseek-ai/dsh-web-app@0.1.5-rc.2` 的 `dependencies` 含 `dsh-client-ui-sidebar-right`，且其 `cordis.patch.yml` 有 `- id: ui-sidebar-right`；rc.1 两者皆无 |
| `conversation.view` 在 rc.2 实现侧不变 | `ConversationRoot` 的 `renderSlot('conversation.view', …, { only: active.id })`、`DEFAULT_VIEW_ID='chat'`、tab 条要 `tabs.length > 1`、blank 不渲染、偏好键 `dsh.conversation.<sessionId>`（`dsh-client-ui-conversation@0.1.5-rc.2/lib/client.js`） |
| **`conversation.session.header.utilities` 不是 rc.2 新增** | 它在 **0.1.2-rc.1 就存在**（`R1` 目录内 line 3132，`list`/`session`/`replaceRisk: none`，occupant `session-log-download`），并在 rc.1 已渲染；rc.2 只是**多了一个 occupant** `open-in-app`。**`conversation.session.header.*` 里 rc.2 真正新增的只有 `corner`**（single，已被 `client-ui-sidebar-right ExpandButton` 占，`shadows-shipped-ui`） |

## 2. 结论

1. **`REQ-I1` 不换落点**：仍走 `conversation.view`（`ADR-0016` 原路线）。rc.2 的**右侧面板 Tab**（`sidebar.right.pane.tab` + `ctx.sidebarRight`）与**活动栏 + 主面板**（`sidebar.panellist` + `main`）是**另外两个面**，且都是 **rc.2-only**——换过去会把「双家族支持」降级为「只支持 rc.2」，收益却是换掉需求本身。
2. **rc.2 重排对我们零隐性破坏**：4 个已占槽 + `conversation.view` 的 11 个行为字段逐字节相同；唯一变化是全局 `standardProps` 追加 2 个 hook（纯加法）。
3. **官方右侧面板接缝可用且零上游改动**：`ctx.sidebarRightTabs` + `sidebar.right.pane.tab` 是公开两阶段路径，官方文档明确以第三方包（`ui-sidebar-documentpreview`）为样板。若要落地，**必须走 `ctx.get()` 可选探测**（`inject: ['sidebarRight']` 会让插件在 0.1.2-rc.1 上永不激活）。
4. **三处「看着像坑」的点**：`main`/`rightbar`/`main.conversation`/`conversation.session.header.corner` 都是 `shadows-shipped-ui`（注册即替换官方 UI，角落位一注册就顶掉右侧面板展开按钮）；`sidebar.right.pane.tab` 的 key 不是自由字符串而是**类型 id**；`openTab` 在无座位时抛错。
5. **行徽标（`row-badges`）**：槽位层面 `sidebar.workspaces` 未变（`main` 是**新增**槽）——**这只是静态层结论，不等于运行时安全**；真实 DOM 是否仍匹配由 `t2`（静态判定）与 `t3`（lab 50599 实测）给出，写入 `docs/rounds/R17-rc2-badge-verification.md`，`t6` 引用其结论时不得改写成「已知安全/已知失效」。
6. **本轮 `t4` 的「最小远程状态入口」落点与 `REQ-I1` 判定不冲突**：captain 已定主落点 = **`conversation.session.header.utilities`**（`list`/`session`/`replaceRisk: none`，**双家族都存在**），兜底 `.actions`；本 ADR 支持该落点（依据见 `ADR-0017` §7.4）。**`REQ-I1` 的大面板仍走 `conversation.view`**，两者是不同粒度的两件事。

## 3. 产出

| 文件 | 内容 |
|---|---|
| `docs/decisions/ADR-0017-rc2-client-slot-recon.md`（新建，proposed） | 12 新增 / 3 删除 / 17 处次要漂移 / 我方 5 槽字段级 diff / 右侧面板与活动栏契约 / `REQ-I1` 路线判定 / 普通 JS 注册示例 / 风险 9 条 / 未取证 5 项 |
| 本文 | 证据表与结论摘要 |

**未改** `src/`、`test/`、`package.json`、`docs/status.md`（本轨道只侦察）。

## 4. 复现命令（脚本已留在 `.tmp/slot-recon/`，`.tmp/` 不入库）

```powershell
# 1) 取两个家族的客户端 runner
npm pack "@deepseek-ai/dsh-cordis-client-runner@0.1.5-rc.2" --pack-destination .tmp/slot-recon
tar -xzf .tmp/slot-recon/deepseek-ai-dsh-cordis-client-runner-0.1.5-rc.2.tgz -C .tmp/slot-recon/runner-rc2 --strip-components=1
$old = "C:\Users\Admin\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai\dsh-cordis-client-runner\lib\client.js"

# 2) 目录 → JSON（括号配平 + new Function 求值，产物纯数据）
node .tmp/slot-recon/extract-slot-api.mjs $old CLIENT_SLOT_API .tmp/slot-recon/slots-0.1.2-rc.1.json
node .tmp/slot-recon/extract-slot-api.mjs .tmp/slot-recon/runner-rc2/lib/client.js CLIENT_SLOT_API .tmp/slot-recon/slots-0.1.5-rc.2.json
node .tmp/slot-recon/extract-slot-api.mjs .tmp/slot-recon/runner-rc2/lib/client.js SERVICE_API .tmp/slot-recon/services-0.1.5-rc.2.json

# 3) 差异
node .tmp/slot-recon/slot-keys.mjs $old .tmp/slot-recon/runner-rc2/lib/client.js
node .tmp/slot-recon/slot-contract-strict.mjs .tmp/slot-recon/slots-0.1.2-rc.1.json .tmp/slot-recon/slots-0.1.5-rc.2.json
node .tmp/slot-recon/slot-field-diff.mjs .tmp/slot-recon/slots-0.1.2-rc.1.json .tmp/slot-recon/slots-0.1.5-rc.2.json --key conversation.view
```

脚本清单（本轮新增/复用）：`extract-slot-api.mjs`、`slot-contract-strict.mjs`（新增）；`list-slots.mjs`、`dump-slot.mjs`、`slot-keys.mjs`、`slot-field-diff.mjs`（已有）。

## 5. 未取证 / 移交

| # | 项 | 去处 |
|---|---|---|
| 1 | rc.2 上 `row-badges` 的真实 DOM 存活 | **`t2` 已完成静态部分**（`docs/rounds/R17-rc2-badge-verification.md` §5 结论：rc.2 未引入行 markup 变化 ⇒ 不会**因 rc.2** 破坏行徽标层；并顺带证伪两代共有的 A5「分组视图子行无徽标」假设）；**`t3` 浏览器实测尚未写入**（该文件「第二部分」仍为空）。`t6` 引用时必须**同时**标注静态/实测来源，不得把静态结论写成运行时已验 |
| 2 | `ctx.reflect.provide` 在客户端运行时与 `ctx.provide` 的行为差异（`ctx.get` 是否可见、需要 `dsh.client.inject` 登记否） | 若 `REQ-I2b` 立项，用 lab 实测（ADR-0017 §11 U2） |
| 3 | `main` 在 root scope 下取「当前会话」的官方姿势 | 若 `REQ-I3` 立项再查（U4） |
| 4 | `kind` 是否有保留字 | 若 `REQ-I2b` 立项再查（U6） |

## 6. 移交下一轮的建议 —— **已执行完毕（2026-09-10 由 t14 收口）**

> **本节状态说明**：原计划的 `t6` **已退役**（其依赖 `t3` 以 FAILED 收场、永久锁死），
> `t8`（徽标修复）**亦退役**。本节 §6.1/§6.2 的全部内容 **+ 本轮新增事实（t11 的 F1、t12 的 F2、
> t3 报告 §10–§13 的实测定论）** 由新任务 **`t14`** 一次承接并已落地。**下表保留为可追溯的原始素材
> 清单**，执行结果见 `docs/backlog.md`（`UPSTREAM-2`/`UPSTREAM-3`/`AUDIT-4`/`AUDIT-5`/`REQ-I1`）
> 与 `docs/compatibility.md`（§1/§2/§3.1/§4/§5）。

### 6.1 写入清单（**已由 `t14` 执行**；下表状态为收口后的实际结果）

| # | 目标文件 | 内容 | 状态 |
|---|---|---|---|
| 1 | `docs/backlog.md` | 新增 **`UPSTREAM-2`**（§2 末尾、`todo`/P2）：rc.2 槽位重排 删 3 增 12；**静态来源与运行时来源分行标注**（静态 = `ADR-0017` + t2；运行时 = **t3 实测，留空待填**）；写明「槽位目前**无自动闸门**」 | **已落地（t14）** |
| 2 | `docs/backlog.md` | **`REQ-I1`** 行备注指向 `ADR-0017`（路线判定：仍走 `conversation.view`） | **已落地（t14）** |
| 3 | `docs/backlog.md` | 新增 **`AUDIT-4`**（排在 `AUDIT-3` 之后、`todo`/P3）——**修法不必抄写，指向 `ADR-0017` §7.6 即可**（该节已含 `remoteCellOf` 唯一决策函数、视图改法与「`test:agent` 覆盖真正决定渲染的那条分支」的验收口径）。行内只写：现状 = `showsRemoteStatus`（`remote-status.ts`）在 `src/**` 零调用者、真正渲染判定在 `remote-status-entry.tsx` 的 `connId === undefined → null` ⇒ 同一判定两份实现、只有一份被测；**症状级证据** = `test/remote-status.test.ts:90` 那条用例**自称** `the render decision is remote-only (local sessions show nothing)`，实际钉的却是 `showsRemoteStatus`（名不副实）。**修法与纠正绑定做（顺序不可拆）**：先新增 `remoteCellOf` 下沉判定、视图只消费它，**然后把该用例重指 `remoteCellOf`** ⇒ 名字自然变真；**改名从属于重指**（只改名不改测试目标，等于把"说大话"换成"名字含糊"，护栏仍缺）；修法见 `ADR-0017` §7.6；**排期 = 下一轮单独开任务 + 评审（captain 裁决：本轮不修、只登记；不塞进 `t8`，因其视图形与 t8 的客户端区域重叠会混 diff）**；来源 = t5 评审记录（`R17-rc2-badge-verification.md` 的非阻断观察 ①） | **已落地（t14）** |
| 4 | `docs/compatibility.md` **§4** | **「客户端判定不假设与 host 等价」一句**（captain 裁定落点 = §4「运行时能力探测约定（写代码时遵守）」，**不进 §2**）：`routeIdOf`（`src/client/route-id.ts`）是 host 判定（`remoteRouteFromCwd` → `parseSshRoute` / `routeFromPlaceholder`）的**宽松镜像**，已知 **D1/D2/D3** 三处偏离（D1/D2 = 在当前 host 契约下**不可达**的防御分支；D3 = **仅字符串匹配、无 realpath**）；**需要等价判定的地方必须回 host 取事实**；详见 `ADR-0017` §7.6。**必须注明「既有行为，非 t4 引入」**，证据 = `git diff` 显示 `routeIdOf` 定义被**迁移**、`row-badges.ts:201/:235` 两处调用**逐字未改**（两个 index 构造器定义在 `:194`/`:228`）。**护栏措辞（captain 2026-09-10 亲自核实后定稿，按此写，不再用旧说法）**：> 三条偏离**都有护栏**，但可见性不同：**D1/D2 是直接断言且沙箱可见**（`test/remote-status.test.ts` 在 `npm run test:agent` 里真跑，如 `:77` 断言 `ssh://c3 → c3`）；**D3 是间接护栏**（经 `remoteWorkspaceIndex`/`remoteSessionIndex` → `routeIdOf`，由 `test/row-badges.test.ts` 中 **16 处 `remotePath(...)`** 钉住——实测 `remotePath(` 计数 = 16，含 `:73` 的定义），**但该文件在 `test:agent` 被 SKIP（直接 import `.tsx`）⇒ 只在 CI 的 `npm test` 可见**。⇒ 收紧 D3 会**先红一片、不可被静默改动**；但其护栏**在沙箱里看不见**，所以本地改 D3 前必须先跑 CI 口径（或直接 `node --import tsx --test test/row-badges.test.ts`）。改 D3 须**同时**补/改断言并更新 `ADR-0017` §7.6。**禁止**写成「D3 无任何断言」 | **已落地（t14）** |
| 5 | `docs/compatibility.md` **§4** | **`routeIdOf` 搬迁**一句（与第 4 项**相邻**）：`src/client/row-badges.ts` → 新纯 `.ts` `src/client/route-id.ts`（改 import + re-export，导出名与行为不变，`test/row-badges.test.ts` 未动）；动机 = `test:agent` 纯类型剥离连**传递依赖的 `.tsx`** 都加载不了（沙箱约束） | **已落地（t14）** |
| 6 | `docs/compatibility.md` | §1 补一行 0.1.3/未发布 0.1.4 对 0.1.5-rc.2 的实测结论；§2 新增 rc.2 客户端槽位重排一行（症状=占用被删槽者**静默**失去挂载点；**如实写「目前无自动闸门」**）；§3.1 补「rc.2 起哨兵 `next` 覆盖到 rc.2」 | **已落地（t14）** |
| 7 | `docs/backlog.md` | **t5 四条非阻断观察**合成 1–2 行（不虚空行）：① = 第 3 项 `AUDIT-4`；②/③ rc.2 occupant 口径统一为「rc.1 与 rc.2 **均存在**该槽，rc.2 仅多 `open-in-app`」；④ `remoteConnectionIdOf` docstring 的「有意偏离」补充 = **并入 `t8`（窄口子：只许注释/文档字符串行；内容覆盖 D1/D2/D3 + D1/D2 现契约下不可达 + D3 架构性 + 等价判定须回 host + 指向 `ADR-0017` §7.6；`test:agent` 与 `remote-status.test.ts` 必须仍全绿；完成输出需贴该文件 diff）**；来源 = 评审记录。**冲突已由 captain 2026-09-10 终局裁定**：engineer-client 引的「t8 边界排除 `remote-status*`/`route-id.ts`」是**旧口径、已作废**，以窄口子为准（captain 已单独通知并收到其接受回执） | **已落地（t14）** |
| 8 | — | 口径说明：`scripts/slot-catalog.mjs` 是**本轮要入库的交付物**（收口 `git add`），**不进 npm 发布物**（`files` 未改，与 `check.mjs`/`status.mjs` 一致） | **已落地（t14）** |

> **不写** `docs/status.md`（captain 收口时用 `npm run status` 生成）。
> **`ADR-0017` 不再加新章节**（captain 2026-09-10）：它是本轮技术主记录，后续增量一律落真相源文件。

### 6.2 护栏事实 —— **已定稿并写入 `docs/compatibility.md` §4**（**2026-09-10 三次更正版**：先前「D3 无任何断言」「两条语义同源」**均已作废**）

以 **三档护栏** 表述（engineer-client 提出、scout-slots 逐条实测复核、captain 定稿方向）：

| 档 | 覆盖 | 唯一证据 | 在哪跑 | 改它时会遇到什么 |
|---|---|---|---|---|
| **① 有意钉住** | **D1 / D2**（`ssh://<id>` 无路径、路径非 POSIX 绝对） | `test/remote-status.test.ts:77` `remoteConnectionIdOf('ssh://c3') === 'c3'`、`:87` malformed id ⇒ `undefined` | **沙箱内真跑**（该文件不在 SKIP 名单 —— `remote-status.ts` 只 import `./route-id.ts`，**不** import `status.tsx`） | **先红**，逼出显式决策（改判定 + 改测试 + 改 `ADR-0017` §7.6）。D1 是"容忍 host 不会发出的简写"，值得有意保留 |
| **② 顺带钉住（incidental）** | **D3 的宽松语义**（"不落在任何 DSH 根内也算远程"） | **只有** `test/row-badges.test.ts:73` 的 `` `C:\dsh\dsw-routes\${id}\home\u` ``（**无 `.dsh` 段** ⇒ 不在任何 DSH 根之下），经 `remoteWorkspaceIndex`/`remoteSessionIndex` 的 **15 个使用点**（`remotePath(` 计数 **16 = 15 使用 + 1 定义**）断言为远程（例 `:83` `index.get('docs') === 'c2'`） | **只在 CI**（该文件 `:19` 从 `status.tsx` import，`test:agent` **实测 SKIP**） | **CI 里 15 处"意外红"** —— 它们**不是**你破坏了契约，而是**夹具路径需要换**（换成真正落在 root 下的路径，如 `<homedir>/.dsh/dsw-routes/<id>/…`）。**不知道这点的人会把"夹具要改"误读成"语义回归"** |
| **③ 无断言** | 其余（`routeIdOf` 自身的正则、`dsh-ssh-routes` 旧命名树的根外形态等） | — | — | 无护栏 |

**为什么是"顺带"而不是"有意"（夹具注释自证）**：`test/row-badges.test.ts:72` 的注释原文是
`/** A route placeholder root; mirrors the host's \`dsw-routes\` spelling. */` —— 它**只想造一个"看起来像远程"的路径**（"mirrors the spelling"），**没有主张**"根外也算远程"是契约；`C:\dsh`（无 `.dsh` 段）**顺带**造成了"根外"。

**⇒ `compatibility.md` §4 的准确措辞**（captain 定稿 + 三次精度更正）——**两条断言钉的不是同一件事，必须分开写**：

| 被钉住的语义 | 证据 | 可见性 |
|---|---|---|
| **能取出 id（"匹配"语义）** | `test/remote-status.test.ts:72` `C:\Users\dev\.dsh\dsw-routes\c1\srv\app`、`:73` `/home/dev/.dsh/dsw-routes/c1/srv/app`、`:75` 旧命名树、`:91` `/home/dev/.dsh/dsw-routes/c1/srv`；`:86` 断言无 id 段时返回 `undefined` —— **这些路径都带 `.dsh` 前缀，看起来就像落在根下** | **沙箱内真跑** |
| **"根外也算远程"（D3 宽松语义）** | **只有**上表 ② 的夹具 | **只在 CI 可见** |

**操作性后果（这条比"可见性不均"有用）**：若把 D3 **收窄成「必须落在某 root 形状之下」**（例要求 `.dsh/dsw-routes` 前缀），**沙箱那份继续全绿、只有 CI 红** ⇒ **本地全绿、CI 才红**；只有**取消宽松匹配本身**（要真实 root 解析）沙箱才会红。⇒ **收窄 D3 只跑沙箱可能误判为"没破坏语义"**，必须跑 CI 口径（`node --import tsx --test test/row-badges.test.ts`）。这也解释了 `t8` 为何坚持把 e2e 夹具建在**路由根之下**——避免新 spec 也变成"只在某种程度上成立"。

**不要给 D3 补正面断言**：D3 的宽松是**已知限制**（会误判本地路径），与 D1（host 不会发出的防御分支）性质不同。D1 值得有意钉住（已钉），**D3 不值得**再补一条正面断言把它固化成契约 —— 那只会给将来的收紧制造额外摩擦。

**书写要求（建议 t6 直接作为 `compatibility.md` §4 的纪律）**：**写护栏必须写清「钉的是哪个语义粒度、在哪跑、红了意味着语义回归还是夹具要改」**。

**为什么这个区分有操作性（不是学究）**：`test/remote-status.test.ts` 里那些路径虽然只是"字符串含 `dsw-routes/`"，但它们**都带 `.dsh/dsw-routes` 前缀，看起来就像落在根下**。因此——
- 若有人把 D3 **收窄成「必须落在某个 root 形状之下」**（例如要求 `.dsh/dsw-routes` 前缀），**沙箱内那份文件会继续全绿**，**只有 `row-badges.test.ts` 会红** ⇒ **沙箱全绿、CI 才红**；
- 只有**取消宽松匹配本身**（要求真实 root 解析），沙箱那份才会红。

⇒ 措辞定为：**三条都有护栏、都能先红，但红的位置不同**——D1/D2 与「匹配语义」**红在沙箱**（`test:agent` 真跑）；**「宽松语义」只在 CI 红**（`row-badges.test.ts`）。**收窄 D3 时若只跑沙箱，可能全绿并误以为没破坏语义** ⇒ 必须跑 CI 口径。也正因如此，`t8` 的 e2e 夹具坚持建在**路由根之下**，避免新 spec 也变成"只在某种程度上成立"。**禁止**写成「D3 无任何断言」。
