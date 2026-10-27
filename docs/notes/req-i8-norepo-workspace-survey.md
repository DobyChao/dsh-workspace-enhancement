# REQ-I8「不在项目中工作」现状调查（norepo 挂工作区，2026-10-27）

> 只读调查，不改代码/backlog。磁盘权威源四份（引用一律给 key/符号名 + 出处包，行号不是契约）：
>
> - **[G]** 全局安装树 `@deepseek-ai/dsh@0.2.1-rc.2`（`C:\Users\Admin\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai\*`；lab 与 `next` 通道家族）
> - **[R20]** 本仓库 `.tmp\release-verify\node_modules\@deepseek-ai\*`（**0.2.0-rc.2，产品 `latest` 家族**）
> - **[REPO]** 本仓库 `node_modules\@deepseek-ai\*`（0.1.7-rc.2，devDependencies）
> - **[R15]** `C:\Users\Admin\.dsh-lab\rc1-cli\...`（0.1.5-rc.2，仅对照）
>
> 未调用 `cordis_inspect_*`；契约读法为 `npm run slots -- --key <key> <bundle.js>` 与直接读包源码/dist。

## 1. 背景与原始设想

- backlog 行（§2 P3）：`REQ-I8 | Spike：fork + 换 cwd（norepo 挂工作区） | todo | 核列表/resume/标题。产出 ADR（可行 → 生命周期；不可行 → fork 留档 + 新会话）`。
- 原始设想的机制（0.1.x 时代语境）：**fork 一个既有会话（携带事件日志），把子会话 cwd 换到不在任何项目里的目录**，从而「不在项目中工作」。fork 当年只是设想——ADR-0007（2026-08-25）侦察记录的三条硬约束塑造了整条线：
  1. `SessionHeader.cwd` 创建后不可变；
  2. 工作区归属 = `canonical(header.cwd) === workspace.path`（1 session → 1 canonical cwd → 1 workspace）；
  3. `sandbox/mode` 是每会话一个 knob。
- ADR-0019（2026-09-12）权限档位退役时**明确保留**面板/store，理由是它们是「工作区生命周期线（REQ-I8 及其后继）的 UI 载体」；R20 同口径。
- 原始验收核心：**会话列表 / resume / 标题 不破**。

## 2. 记录 vs 现状对照表

| # | 当年记录说的 | 今天的代码/契约现实 | 判定 |
|---|---|---|---|
| 1 | fork 是**设想**（没有就造） | fork **官方存在**：客户端服务面 `sessions.fork`（[G]/[R20] SERVICE_API `sessions`；[G] 多 `allowMigration`，[R20] 仅 `sessionId/atSeq?/increaseTitle?/onCreated?`）+ `uiWorkspace.forkSession`；宿主 `dsh-api-session-controller` `SessionCommandController.fork()`（[G]/[R20] 同形） | 已漂移（设想→官方 API，但见 #2 的限制） |
| 2 | 「换 cwd」必须靠 fork | fork **不收 cwd 覆盖**：子会话 `meta.cwd = source.header.cwd` 原样复制，且 `forkWorkspace()` 把子会话强制 attach 到**源的**工作区（[G]/[R20] `SessionCommandController.fork`/`forkWorkspace`）。换 cwd 的正道变成了 0.2.1 新接缝 `workingDirectory`（§3.4），fork 对「换 cwd」已无用 | 已漂移 |
| 3 | `header.cwd` 不可变 ⇒ 会话终生钉在创建目录 | 不可变**仍成立**（[G] `SessionHeader.cwd`、`CreateSessionOptions.meta.cwd`），但 0.2.1 起有官方**会话中换 cwd**：`WorkingDirectoryService.set/get/ensure` + `working_directory` 模型工具 + `workingDirectory` 投影（§3.4）。0.2.0（产品家族）**无此包**（[R20] 树中不存在 `dsh-working-directory`） | 已漂移（分家族） |
| 4 | 会话必须在项目（workspace）里；norepo 要 hack | 宿主 `session.create` **接受裸 cwd**（「accepts workspaceId or cwd, not both」；[R20] 宿主端已验证，[G] 同）；无 workspace 的会话进侧栏「未分组桶」（`groupByWorkspace` 的 stray 分支，[G] `dsh-client-ui-workspace`）。但 **web UI 仍项目门**：hero「cwd-only 会话被闸」（本仓库 `src/client/flow.tsx` `openRemotePath` 注释）、`uiWorkspace.startSession` 只从 workspace 发起 | 部分成立（API 层成立、UI 层未开放） |
| 5 | cwd 只能是本机路径（`ssh://` 过不了宿主 mkdir） | 仍成立：`createOrAdopt` 用 `node:fs/promises` `mkdir(cwd, {recursive:true})`（[R20]/[G]）。插件的**占位树方案**已是现行正解：`session.route` 建 `$DSH_HOME\dsw-routes\<id>\<path>`、回写 machine workspace、返回 `{cwd: placeholder}`（`src/web.ts` `session.route` 分支 + `src/transport.ts`） | 仍成立（且已产品化） |
| 6 | 面板/store 是「工作区生命周期线」的 UI 载体（ADR-0019/R20） | 面板已演进为**会话工作区驾驶舱**（ADR-0021 §2.9：主工作区只读 + 副根薄声明 + 已连接机器；`src/client/side-workspaces.tsx` + `cockpit.ts`），store 是 `SessionSideWorkspaceStore`（`src/session-workspaces.ts`，挂/卸/改名 + 路由索引）。**没有任何 cwd 切换/会话迁移 UI**；「生命周期」实际由 REQ-I31（切机器）与 REQ-I32（批量建工作区，2026-10-27 新增）各自推进 | 已漂移（载体在、「生命周期」职能未兑现于面板） |
| 7 | 副根曾是权限档位载体 | 已按计划消失（ADR-0019 本体；REQ-I24 后本机副根与主根同权） | 已消失（按计划） |
| 8 | 验收三件套是黑盒（「核列表/resume/标题」） | 今天可精确映射（§3.5）：列表按 `header.cwd`（冷会话无 cwd 直接剔除）；resume 按 `(sessionId, cwd)` 校验（`ApiSessionCwdConflict`）；标题是 `session/title` 事件投影（fork 种子携带，`increaseTitle` 是客户端 fork 包装的改名） | 仍成立且更精确 |
| 9 | ADR-0007 侦察：工作区归属 = header cwd 等值匹配 | 仍成立：`WorkspaceEntity.attachSession` 用 `node:fs` `realpath` 验证 `header.cwd === workspace.path`；bootstrap 按 canonical cwd 自动分组；`dsh-workspace` **直连 node:fs，不走 `ctx.fs`**（[G]/[R20] `dsh-workspace/lib/index.js` 顶部 import） | 仍成立 |

## 3. 宿主接缝证据（key / 符号名 + 出处）

### 3.1 会话 fork（0.2.0 与 0.2.1 都有）

- 客户端 SERVICE_API `sessions` 方法 `fork(opts)`（[G] `dsh-cordis-client-runner/lib/client.js` 目录条目；[R20] 同目录同方法、签名无 `allowMigration`）。「Fork a session from an exact inclusive prefix of the source」。
- `uiWorkspace.forkSession(sessionId, onCreated?, options?)`（[G] SERVICE_API `uiWorkspace`）：「Fork a Session without changing the current selection」。
- 宿主实现 `SessionCommandController.fork`（[G]/[R20] `dsh-api-session-controller/lib/index.js`）：
  - `buildForkSeed`（[REPO] 0.1.7-rc.2 的 `@deepseek-ai/dsh-session` 已导出——session-store 级 fork 种子机制自 0.1.x 就在）；
  - 子 `meta = { cwd: source.header.cwd, parentSession, isSeeded: true, agentPreset }`——**cwd 无覆盖入口**；
  - `forkWorkspace(source)`：找持有源会话的 workspace（subagent 溯祖先），把子会话 `attachSession` 进**同一个**工作区；源无工作区则子也无归属。
- `increaseTitle` 是**客户端**包装（[G] `dsh-api-session-controller/lib/client.js` `fork()`）：fork 后对子会话 `rename(increasedForkTitle(sourceTitle))`。
- 普通会话 fork 的血缘 UI：`conversation.session.header.lineage` 槽（single，session 作用域）当前唯一 occupant 是 `client-ui-subagent SubagentHeaderLineage`——**只覆盖 subagent 血缘**（[G] slots 目录）。

### 3.2 会话创建：cwd 是必经参数，workspace 可缺席

- 宿主 Remote 端点 `create`（[R20]/[G] `SessionCommandController.create`）：
  - `workspaceId` 与 `cwd` **互斥**，二者都无则 `defaultCwd`（构造参数，宿主为 `process.cwd()` 一类）；
  - `cwd = workspace?.path ?? request.cwd ?? this.defaultCwd`；
  - 有 workspace 才 `attachSession`；**cwd-only 会话不 attach 任何工作区**。
- `createOrAdopt(sessionId, cwd, ...)`（[R20]/[G] 同包）：命中持久化同 id 会话则校验 `header.cwd === cwd` 后 resume；否则 **`node:fs` `mkdir(cwd, {recursive:true})`** 再 `agents.create({meta:{cwd}})`——cwd 必须是宿主本机可 mkdir 的路径。
- 0.2.1 客户端新增 `ISessions.create(opts?: {workspaceId?/cwd?/sessionId?/agentPreset?})`（[G] runner bundle `ISessions` declaration）；**0.2.0 客户端服务面无 `create`**（[R20] 目录只有 retain/using/retainInfo/refreshProjections/search/fork/scope/binding）——cwd-only 创建在 0.2.0 只有宿主端点，插件客户端半无官方入口。

### 3.3 工作区（项目）接缝

- SERVICE_API `workspaces`（[G]）：`create({path})`（「Register an existing path as a Workspace」）、`rename`、`delete`（不删会话/文件）、`archiveSession`/`unarchiveSession`、`insertSessionBefore`。
- `WorkspaceRegistry`/`WorkspaceEntity`（[G]/[R20] `dsh-workspace/lib/index.js`）：`path` 是 create 时 `fs.realpath` 正典、永不重写；`attachSession` 校验 `header.cwd` realpath 等值；bootstrap `replaceHeaderIndex`/`indexHeader` 按存量 header cwd **自动分组**（无主会话自动成组，标题取 basename）；`status()` 报 `missing-dir`。**全程 node:fs 直连**——`ssh://` 路径进不了工作区注册表，但**占位路径可以**（它就是本机目录）。
- 侧栏分组 `groupByWorkspace`（[G] `dsh-client-ui-workspace/lib/client.js`）：workspace 内按账面成员分组；**未归属会话进 stray/未分组桶**（组 key 空、无 path、标题空串、`workspaceLabel(cwd)` 取 basename 兜底）。
- 「添加工作区」宿主流：`WorkspacePickFlow` 的 `adoptDirectory = (path) => createWorkspace({path}).then(w => onPick(w.workspaceId))`（[G] 同包）——**任何被选目录（含插件占位路径）都先注册成 workspace 再开会话**。directoryFlow 槽（`conversation.hero.workspace.directoryFlow` / `sidebar.workspaces.directoryFlow`，本插件占用）的 ownerProps 明言 busy =「`createWorkspace` in flight」。

### 3.4 会话中换 cwd（**仅 0.2.1 家族**）

- `dsh-working-directory`（[G]，0.2.1 线新包；0.1.x/0.2.0 无任何版本——见 REQ-I31 笔记 2026-10-26 npm 侦察）：服务 `ctx.workingDirectory`，`set(agent, path)`（ctx.fs resolve→stat 必须是目录→processPath 落盘事件 `working-directory/change` + 投影 `workingDirectory` + 给模型注入变更通告；**不改已有进程与权限**）、`get(session)`（投影 → `defaultDirectory` 兜底）、`ensure(agent)`（目录消失回落 `header.cwd` 原项目，自愈）。
- 组合行 `dsh-base/cordis.patch.yml` 两行：`working-directory` + `tool-working-directory`（[G]）——宿主自带**无门禁**的 `working_directory` 模型工具（REQ-I31「裸通道」未拍板项）。
- 校验走 `ctx.fs`（[G] `dsh-working-directory/lib/index.js` 直接调 `this.ctx.fs.resolve/stat/processPath`）——即**走本插件 mixed 门面**，`ssh://` 与占位拼写都路由远程。
- 插件已全链接入（R58/REQ-I31）：读缝 `effectiveCwdOf`/`sessionProjectionsOf`（`src/remote-policy.ts`，投影优先、header 兜底，消费点含 `sessionCwdOf`、`sessionWorkspaceContextOf`、`initiatorEffectiveCwdOf`）+ 实验工具 `sw_use_machine`（`src/use-machine-tool.ts`，danger 门 + 已连接门 + `set(agent, sshTargetKey(...))`）。驾驶舱「主工作区」区随投影走（`src/client/side-workspaces.tsx` `useSessionCwd` → `remoteFacts`）。

### 3.5 列表 / resume / 标题（原验收三件套的现行机制）

- **列表**：`session.list` 的冷会话循环 `if (record.header.cwd === void 0) continue`——**无 header.cwd 的冷会话从列表消失**；live 会话总在（[R20]/[G] `dsh-api-session-controller`）。搜索同滤（`visible.filter(record => record.header.cwd !== void 0)`）。⇒ norepo 会话**必须保有某个 header.cwd**（哪怕占位路径）才可见可寻。
- **resume**：`createOrAdopt` 的 resume 分支要求 `observation.header.cwd === cwd`，否则 `ApiSessionCwdConflict`；`sourceFor` 对 `header.cwd === undefined` 的会话直接按 not-found 拒绝。`SessionTarget = SessionId | SubagentAddress`（[G] runner bundle）——连接按 id 寻址，cwd 校验发生在 workspace 连接（cwd 取 `workspace.path`）。⇒ header.cwd 不可变 ⇒ resume 天然稳；`workingDirectory` 投影不参与寻址。
- **标题**：`dsh-session-title` 的 `title` 投影折叠 `session/title` 事件；fork 种子携带事件 ⇒ 子会话继承标题事件；`rename` 端点写新事件。⇒ 换 cwd（投影）不触标题；fork 携带标题。

## 4. 候选实现路径与推荐

| 路径 | 做法 | 接缝证据 | 家族 | 代价 | 风险 / 缺点 |
|---|---|---|---|---|---|
| **A. 会话中切目录（推荐主路径）** | 扩展 REQ-I31 的机制：`workingDirectory.set` 到任意目录——本机绝对路径或 `ssh://<id>/<posix>`（远程落盘为占位 cwd）。形态二选一：①放宽 `sw_use_machine` 到「同机目录切换」（现工具只换机器）；②新实验工具 `sw_cd` 或驾驶舱「主工作区」区的手动切换 | §3.4 全部；`effectiveCwdOf` 读缝与驾驶舱跟随已就绪 | **仅 0.2.1** | S（REQ-I31 已铺 80%） | ①本机 WW 写集锚 `header.cwd` 不跟切（REQ-I31 缺口 5 既定语义：新目录写需副根声明/提权）；②宿主裸通道无门禁（既有未拍板项）；③产品家族 0.2.0 无此服务（按名可选消费，老家族等效常关） |
| **B. cwd-only 新会话（norepo 开场）** | 客户端 `sessions.create({cwd})`（远程目录先走 `session.route` 占位）→ `sessions.retain/openSession`。可再叠 A（进去后随便切）或叠 fork（`sessions.fork` 后 `set` 切走，携带历史） | §3.2/§3.3 | **仅 0.2.1**（客户端 `create`） | S–M | ①未分组桶的产品化未验（标题=basename、无 workspace 菜单）；②fork 变体名不副实：子会话仍归**源**工作区（`forkWorkspace`），列表还在原项目组 |
| C. 注册即项目（现状延伸） | 任何目录（含远程占位）注册成 workspace 再开会话——**今天添加工作区流已经这么跑**；REQ-I32 是它的批量增强 | §3.3 `adoptDirectory` | 全家族 | ≈0（现状） | 与「norepo」初衷相反：每目录一条注册；工作区列表膨胀（远程目录以占位路径入册） |
| D. 原案复刻「fork+换 cwd」 | fork 后改子会话 cwd | §3.1 #2：fork 无 cwd 覆盖；0.2.0 无 `workingDirectory` | — | — | **不通**：fork API 不收 cwd；0.2.0 上没有任何官方换 cwd 接缝（投影事件类型由 0.2.1 包声明，插件无法自造被官方消费者认可的投影） |

**推荐**：把 REQ-I8 的定性从「fork+换 cwd 可行性」改为「**目录即会话上下文**」两段式——A（会话中迁移，复用 REQ-I31 成果）为主，B（免注册开场）为辅，C 是不需要做的现状底线。原 spike 问题（fork 通不通）已有确定答案：**fork 存在但与换 cwd 无关**，不必再 spike；新 spike 验证 A/B 的行为矩阵即可。产出物从 ADR「可行→生命周期」收敛为 ADR「目录上下文迁移的边界」（写清 WW 写集不跟切、裸通道、家族门三件事）。

## 5. Spike 验证清单（更新版；原验收「列表/resume/标题不破」保留并具体化）

1. **（0.2.1，lab 50599）`workingDirectory.set` 切目录后**：
   - 会话列表仍在原工作区组、标题不变（投影不触 header）；
   - 宿主重启后冷会话 resume 按 `(id, header.cwd)` 寻址不冲突；目录被删时下一轮装配 `ensure()` 回落原项目（自愈）；
   - 本机 workspace-write 档在新目录写文件的实际行为（预期被 `sandboxPolicy` 拒——锚在 header.cwd；副根声明后放行）；
   - 技能扫描（`.dsh/skills` 跟投影 cwd）、终端/sw_exec 默认机、驾驶舱「主工作区」区跟随（REQ-I31 已验大部分，补同机目录切换场景）；
   - 远程目标：`set` 收 `ssh://<id>/<dir>` 后 committed cwd 的占位拼写与 `remoteRouteFromCwd` 回读一致（BUG-20 机器绑定回归）。
2. **（0.2.1）`sessions.create({cwd})` 无工作区会话**：出现在未分组桶；默认标题；archive/unarchive、resume、搜索均可用；`session.route` 占位 cwd 的目录在宿主盘上被删后列表行为（`missing-dir` 语义）。
3. **（0.2.1）fork→set 组合**：子会话归属仍在源工作区（`forkWorkspace` 行为确认）；`increaseTitle` 改名生效；事件日志血缘可读。
4. **（0.2.0 对照）**：确认无 `workingDirectory` 时一切退化为路径 C（注册工作区）唯一可行——家族门文案如实。
5. 回归：`npm run check`（沙箱内 check:static + typecheck + test:agent）+ `boot-smoke`（每条 upstream 通道）。

## 6. 未决问题

1. **需求澄清优先**：「不在项目中工作」今天要的是哪个——免注册开会话（B）、会话中迁移（A）、还是远程目录能开会话即可（C=现状已满足）？拍板前不建议直接开工。
2. 未分组桶的产品化程度（标题、排序、与 archive/pin 的交互）没有任何验证记录。
3. 宿主裸通道（`working_directory` 工具无门禁）是 REQ-I31 遗留未拍板项，若 REQ-I8 走 A 应一并处置（封堵或声明接受）。
4. 家族策略：A/B 均 0.2.1-only；用户实机（3080，0.2.0-rc.2）何时随 `next` 升级决定这条线的实际收益。
5. 驾驶舱面板是否要长出「切换主工作区」的 UI（ADR-0019 当年预留的「生命周期 UI 载体」argument 到此才真正兑现），还是维持模型工具形态——UI 取向待拍板。
