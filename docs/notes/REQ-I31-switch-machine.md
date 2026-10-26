# REQ-I31 — 实验性切机器工具

> 2026-10-24 用户点名的约束。待办在 [`../backlog.md`](../backlog.md)。
> 2026-10-26 Phase 0 侦察完成（见文末「侦察结论」）：机制在 0.2.1-rc 宿主上**已整条存在**，REQ-I31 的定性从「造切换机制」变为「给现成机制加门禁与缺件」。
> 2026-10-26 **已实现**（分支 `feat/REQ-I31-switch-machine`，R58）：见「实现记录」。

允许 agent 把**本会话**切到另一台已注册机器，使之后的 `ctx.fs` 走那台机器。

## 已定约束

- 实验性。设置页有开关，**默认关**。关闭时工具不注册。
- 只有 `danger-full-access` 能调用。会话档不是该档、本次也没有批准时，拒绝，并且不改工作目录。
- 切换改的是会话工作目录的路由（占位路径，或另一条 `fs.resolve` 能认回同一台机器的 cwd），不是只影响某一次读取的旁路。
- 目标必须是本会话已连接的注册机器。未知 id、未连接、保留字 `local` 都拒绝。
- 文案进 `src/locale/`（命名空间 `dsw`）。模型可见的说明用英文。

## 会跟着变的行为

工作目录是 `ctx.fs`、子进程、技能扫描和 `sw_exec` 默认机器的同一把钥匙。切过去之后，这些都会指向新机器，需要测试，也要写进给模型的说明：

- `sw_exec`：省略 `server` 时的默认机器、以及「主工作区已在该机就改用 bash」的拒绝。
- 官方 bash / pwsh：世界钉（远程主会话的 bash、Windows 上的 pwsh）。
- 技能扫描：项目 `.dsh/skills` 跟新的 cwd 走（见 [BUG-22](./BUG-21-22.md)，`processPath` 若仍返回纯 POSIX，切机器后的子代理一样扫不到）。
- 终端、子代理：继承切换后的 cwd。

## 未拍板

- ~~工具名~~ → **`sw_use_machine`**（2026-10-26 开工时按默认拍板）。
- ~~切回本机的方式~~ → **v1 不做**（原始约束本就「保留字 `local` 拒绝」；`set(agent, header.cwd)` 一行即回，留待真实用法反馈）。
- **宿主裸通道怎么处理**（侦察新增，见下）：0.2.1 宿主上模型已能经宿主自带 `working_directory` 工具 `cd ssh://<id>/…` 无门禁切换。v1 **接受并在本文声明**；如需封堵（profile `cordis.patch.yml` 的 `tool-working-directory` 行按 last-write-wins 可覆盖，但插件以依赖形态安装、能否写 patch 行未查实）另立 backlog。

## 已消解的旧问题（侦察结论）

- ~~「是否同时改 `header.cwd`」~~：`SessionHeader.cwd` 是**创建时不可变元数据**（`dsh-session` types `SessionHeader`，readonly，仅 `CreateSessionOptions.meta.cwd` 进入）。会话中改目录的宿主正道就是 `workingDirectory` 投影，header 永远保留原项目路径——这反而是切回本机的天然锚点。

## 侦察结论（2026-10-26，Phase 0）

磁盘权威源：全局安装 `@deepseek-ai/dsh@0.2.1-rc.2`（`C:\Users\Admin\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai\*`）。行号属于该快照，只认 key/符号名。

### 机制已整条存在（仅 0.2.1-rc 家族）

- **`dsh-working-directory` 是 0.2.1 线新包**（npm 首发 `0.2.1-alpha.2`；0.1.x / 0.2.0 无任何版本）。服务名 `workingDirectory`（`ctx.workingDirectory`）：
  - `set(agent, path)`：`ctx.fs.resolve` → `ctx.fs.stat`（必须是目录）→ `ctx.fs.processPath` → 落盘为会话事件 `working-directory/change` + 投影 `workingDirectory` + 给模型注入一条用户消息「The working directory changed from X to Y」。**串行化 per-session，不改已有进程与权限**。
  - `get(session)` 读已提交值；`ensure(agent)` 校验当前目录、消失则**回落 `header.cwd`（原项目）**并提交告知。
  - 注册必选 system-prompt context `working-directory:current`（模型每轮可见当前 cwd），且每次 prompt 装配前先 `ensure()`——**目标机掉线会在下一轮装配自动回落本机原项目**，自愈。
- **校验走的就是本插件的 `ctx.fs`**：`ssh://<id>/…` 与占位形态都远程优先路由（`mixed.ts` resolve）；`processPath` 对远程目标返回占位路径（`filesystem.ts:156` 的 BUG-22 修复**注释里直接点名 `working-directory.set` 会把它存成会话 cwd**——上游早铺好了）。落盘 cwd 形如 `$DSH_HOME/dsw-routes/<id>/<remote path>`，`remoteRouteFromCwd` 认得回。
- **宿主已装配模型可调的 `working_directory` 工具**（`dsh-tool-working-directory`，`dsh-base/cordis.patch.yml` 两行：`working-directory` + `tool-working-directory`，无任何配置/门禁）。`cd` 参数省略=读当前目录，给出=`set`。**宿主侧没有 UI/API 改 cwd 的入口**——唯一变更面就是这个模型工具（外加子代理创建：`dsh-subagent` 用 `workingDirectory.set(child, create.cwd)` 给子会话定 cwd）。
- **宿主消费者全走投影**：`dsh-tool-fs`、`dsh-tool-skill`（ensure）、终端控制器、子代理、API 观察层（`projections.values.workingDirectory ?? header.cwd ?? defaultDirectory`——**投影优先、header 兜底**，这就是插件该抄的读法）。

### 插件侧缺口（REQ-I31 要补的）

1. **插件自己的 cwd 读法落后**：`sessionCwdOf`（`exec-tools.ts:1117`）与 prompt 装配（`session-remote-context.ts:84`）读的是 `header.cwd`（冻结的创建值），不跟投影走。切换后 sw_exec 的默认机、「主工作区已在该机→用 bash」的判定、`sw-remote` prompt 段都不会跟着变。修法：投影优先读（`ctx.get('workingDirectory'/'sessionProjections', false)` 可选服务查 + header 兜底），0.2.1 前家族自然退化为现行为。
2. **第三批 stale 读点（WW 语义连带）**：`initiatorSessionOf(ctx)?.header?.cwd`（`remote-policy.ts:85`）的全部消费点——`core-hub.ts:248`（`knownRootsOf` 声明根：新主根不进集合 ⇒ WW 下写被拒，REQ-I19「未声明 cwd 不新铸 jail」）、`core-fs.ts:454`、`remote-confine.ts:38`、`remote-spawn-policy.ts:70`。修法同上：一个「投影优先、header 兜底」的统一读缝，全部消费点过它。
3. **无门禁的宿主裸通道**：0.2.1 宿主 + 本插件在场时，模型**今天就能** `cd ssh://<任意注册机 id>/…`——无 danger 档检查、无「本会话已连接」检查、无视 REQ-I31 的默认关。REQ-I31 的开关只管得住自己的工具，管不住宿主工具（见未拍板第三条）。
4. **家族门**：机制仅 0.2.1-rc 有。插件对该服务只能可选消费（`ctx.get('workingDirectory', false)`），peer 声明要 `peerDependenciesMeta.optional`（否则 0.1.7/0.2.0 宿主装不上）；实验开关在老家族上等效常关。
5. **宿主权限锚跟 header 不跟投影（按设计）**：宿主 `sandboxPolicy.resolve()` 的 `workspaceRoot` 取 `session.header.cwd`（`dsh-sandbox-policy` lib index:145），切走后**本机** WW 可写集仍锚在原项目（`set` 文档语义就是「不改已有权限」）。⇒ 切换后新主根的 WW 可写性完全由插件侧声明根集合决定（缺口 2）；本机侧不随切换收紧，属既定语义，写进给模型的说明即可。

### 门禁积木（现成）

- danger 档判定：`resolveRemoteSessionMode(ctx)`（`remote-policy.ts`，读 `ctx.get('sandboxPolicy')`；词汇 `'read-only' | 'workspace-write' | 'danger-full-access'`）。
- 「本会话已连接」判定：`requireConnectedServer` / `connectedMachinesOf`（sw_exec 已用，ADR-0021 §2.5）。
- 切换落点路径铸造：`defaultRemoteDir`（machine spec `workspace` → `cwd` → `/`，`exec-tools.ts:267`）→ `ssh://<id>/<dir>` 交给 `set`。
- 切回本机：`header.cwd` 永远是原项目（不可变），`set(agent, header.cwd)` 即回。

### 对图（两典型情况）的落点

切换统一为「`set` 一条 `ssh://` 路由」，10 个编号点坍缩为「落点路径」的选择。但**副根不薄**（ADR-0028 §5 2026-10-08 修订，REQ-I24 后：本机副根按目标路径/cwd 换 `workspaceRoot` 与主根同权；远程副根每根一条 WW serve），WW 可写性按**声明根集合**（`core-hub.ts` `knownRootsOf`：registry `workspace`/`cwd` + initiator cwd 路由 + 该机远程副根）判定：

- 目标机挂着远程副根（④⑦）：副根不转正也不撤——落 `defaultRemoteDir`（= registry 根）天然在声明集内可写；副根 serve 按路径/cwd 选根，切主根不影响；嵌套（7 在 6 下）共用 serve，兄弟分开，主根里跑命令写兄弟副根仍要提权。
- 空机（③⑤⑧⑩）：`defaultRemoteDir` 无 `workspace`/`cwd` 字段时解析到 `/`——`remember()` 明确忽略 `/`，且为 `/` 铸 serve 等于全机可写。**工具须拒绝无登记根的目标机（或要求显式 path 落点）**。
- 本机副（②⑨）：切走后声明仍在；本机 WW 权限锚不随切换移动（缺口 5），`widenPolicyToSideRoot` 按目标路径换根仍会命中，本机副根照旧可写。
- 远程主（⑥）：切走后每轮装配 `ensure()` 兜底，掉线自愈回原项目；原主根的 serve 按 `(machine, mode, workspaceRoot)` 缓存，不主动撤。

## 实现记录（2026-10-26，R58，分支 `feat/REQ-I31-switch-machine`）

侦察结论 1–5 的落地形态：

- **读缝（缺口 1+2）**：`remote-policy.ts` 新增 `effectiveCwdOf` + `sessionProjectionsOf`（按名可选消费 `sessionProjections.stateOf(session, 'workingDirectory')`；string 用投影，null/未注册回 header——init 从 header 折叠，null 永不掩盖 header 值）。消费点全改：`sessionCwdOf`（exec-tools）、`sessionWorkspaceContextOf`（session-remote-context，含两个 has* 透传）、`initiatorEffectiveCwdOf`（core-hub 声明根 / core-fs cwd 默认 / remote-confine / remote-spawn-policy）。
- **开关（缺口 3 的插件侧）**：`experimental.ts` 文件存储 `dsw-experimental.json`（默认关，corrupt 读全关），服务名 `experimentalToggles`，`onChange` 监听；web 行挂服务 + 新端点 `experimental.get`/`experimental.set`；设置页「实验特性」区一个开关。
- **工具**：`use-machine-tool.ts`，纯决策核 `decideUseMachine`（校验序：空→`local` 保留字→未知→未连接→path 形状→落点根；落点规则 `workspace`→`cwd`→拒绝，显式 path 须绝对 POSIX 且永不为 `/`；同机无 path 为诚实 no-op）。执行面：`validateEscalationArgs` → 会话/连接门（复用 `connectedMachinesOf` 的 stored∪implicit 并集）→ danger 门（常驻档或 `approveEscalation` 单次提权，subject `'machine switch'`）→ `workingDirectory.set(agent, sshTargetKey(id, landing))`。
- **注册门**：tools.ts 在 `registerSwExec` 后挂开关监视器——`experimentalToggles.switchMachine()` 且 `workingDirectoryOf(ctx)` 非空才注册（= 家族门 + 开关门），翻动即时重挂/卸载，`ctx.effect` 收尾。
- **缺口 4（家族门）**：不新增 peer——`workingDirectory`/`sessionProjections` 均按名结构化可选消费（ADR-0021 的 dsh-user-approval 先例），三家族照常安装，老家族上开关等效常关。
- **缺口 5（宿主权限锚）**：不改（`set` 文档语义「不改已有权限」）；给模型的说明写进工具描述与 locale 输出。
- **裸通道**：v1 接受（见未拍板第三条）。
- 验证：typecheck 绿；`check:static` 全过；`test:agent` 724 例全绿（新增 `use-machine-tool.test.ts`、`experimental.test.ts`）；boot-smoke 两条（`connections.list` + `experimental.get`）真 boot 通过（0.2.1-rc.2 宿主）。UAT 脚本 `docs/uat/R58-req-i31-switch-machine.md`。
