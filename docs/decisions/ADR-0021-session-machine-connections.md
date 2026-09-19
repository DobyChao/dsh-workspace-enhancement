# ADR-0021: 会话级机器连接与远程工具门控（`sw_connect` 重塑）

- 状态: accepted
- 日期: 2026-09-13
- 范围: `src/session-connections.ts`（新：会话级连接存储）、`src/tools.ts`（`sw_connect`/`sw_status`/提示段）、
  `src/exec-tools.ts`（`sw_exec` 会话门）、`src/web.ts`（`session.conn.*` 端点 + store 装配）、
  `src/mixed.ts`（fs 注册表级路由，**已落地** `cb622d3`）、`src/registry.ts`（临时连接退役）、
  `src/client/`（面板 → 会话工作区驾驶舱）、`src/locale/`（词典增删）、`SECURITY.md`、`test/`
- 关联: 实现 **REQ-I11**、吸收 **SEC-5**（凭据面）；与 **ADR-0020**（远程命令审批门）正交分层；
  承接 **ADR-0019**（副根薄声明）的同一条「把权限叙事收缩到诚实边界」的路线；
  强制执行面的强围栏留给 **ADR-0022 / REQ-I9**；`sw_pick_workspace` 日落见 **ADR-0027 / REQ-I10**

## 0. 结论

**一次会话拥有一份「已连接机器」集合**（用户注册表的子集）。`sw_connect(machines: [...])` 与面板开关写**同一份**
会话级存储——这是**工具暴露的粗门**：集合为空 = 本会话没有远程执行工具、没有远程提示。fs 面走官方
read/write/edit/glob/grep + `ssh://<id>/` **注册表级**路由；该路由是**可见性门控、不是强制围栏**（§5 如实记录）。
凭据与机器注册全部移出模型面，SEC-5 的红线 1 冲突**由结构消失**而非由守卫修补。

## 1. 背景：现状三件套与两处结构性错误

- **工具面**：`sw_status` / `sw_connect` / `sw_pick_workspace` 三件套（`src/tools.ts`）。其中 `sw_connect` 名义上
  「选择本会话工作区」，实际是**机器注册器**：`host/username/port/password/privateKeyPath/save` 六个参数，
  `save !== false` 时 `connectUpsert` 写注册表并设为当前机器——它从不碰会话。
- **错误①（红线 1）**：`password` 是**模型工具参数**（`src/tools.ts:274` 声明、`:354` 透传），而 `tool/call`
  事件的 `arguments` 会原文持久化进会话日志 ⇒ 模型代填密码即明文落盘（SEC-5 发现①）。
- **错误②（模型可静默改用户域）**：`save` 缺省为真 ⇒ 模型可向用户注册表加机器并设为当前机器（SEC-5 发现②）。
- **fs 路由**：只有「会话 cwd 命中远程路由」或「命中已声明副根」才走远端；本地会话即使知道 `ssh://c1/...`
  也无法经官方文件工具到达那台机器（`src/mixed.ts` 旧 `resolve`/`lstat`）。

用户 2026-09-12/13 的连续拍板：`sw_pick_workspace` 日落（REQ-I10，另轮）；`sw_connect` 重塑为
「会话挂载注册表机器的开关」（REQ-I11，吸收 SEC-5）；临时连任意主机**砍掉**；fs 路由放宽为**注册表级**。

## 2. 决定

1. **机器宇宙 = 用户注册表。** 不提供任何「连任意主机」入口：`host/username/port/password/privateKeyPath/save`
   参数整体删除，`SshRegistry.connectTemporary` 退场（临时 machine id 不再是合法 `server`）。
   凭据只从注册表 / 钥匙串 / `~/.ssh/config` 解析（既有 `resolvePassword` 解析序不变）。
2. **`sw_connect(machines: string[])` = 会话开关。** 语义是**替换**本会话的连接集合（`[]` = 全断），不是并集；
   每个 id 必须在注册表中存在（未知 id 报错并列出已知 id），然后逐个做一次有界 ping：
   **可达者写入存储，不可达者在输出里逐台如实报告；若全部不可达则报错且不改动存储**（原子性）。
   **已知代价（有意为之）**：替换语义 + 以可达性为写入条件意味着**瞬时不达会把该机器从集合里摘掉**
   （不是「保留但标记离线」）；输出逐台说明哪台没答、为什么，模型可重试。不做后台自动重连——
   与其维护一份可能与现实不符的「已连接」清单，不如让状态始终等于「刚才真的通了」。
3. **会话级连接存储** = `SessionMachineConnections`（cordis 服务 `sessionConnections`，
   文件 `<dsh home>/dsw-session-connections.json`，结构 `{ sessions: { <sessionId>: <machineId[]> } }`）。
   **只存 id 引用**——没有凭据、没有连接对象，删机器不会从这份文件泄漏任何东西（本轮已落地 `a22ad40`）。
   `retain(known)` 清理注册表已删除机器的残留引用。
4. **隐式主机器**：会话 header cwd 路由到某机器（`remoteRouteFromCwd`）时，该机器**视为已连接**——
   读取时取并集，不写回存储（远程会话不该在首次使用时凭空产生持久状态）。
5. **工具门在执行侧**：`sw_exec` 仍在装配期**全局注册**（原因见 §3 被否方案），但 `execute` 内校验：
   会话集合为空 ⇒ 明确错误「本会话未连接任何机器，请先 `sw_connect`」；请求的 `server` 不在集合内 ⇒
   报错并列出本会话已连接的 id。`sw_status` 增加「本会话已连接机器」一行。
6. **fs 面 = 注册表级路由**（本轮已落地）：任何 `ssh://<id>/<path>`（及其 `dsw-routes` 占位拼写）自行指名远程世界，
   本地会话也能直达——**不必先声明副根**。旧的副根分支保留为回退（win32 上裸 POSIX 路径匹配远程副根）。
7. **门控层级如实声明**：连接集合是**可见性/暴露门控**，不是强制围栏；强制层只有两处——
   ADR-0020 的 **spawn 审批门**（只覆盖经 spawn 的命令）与 ADR-0022 的**远端围栏**（同样只围 spawn），
   以及远端 OS 权限（低权用户/容器）。fs 写面**仍不在任何围栏内**（SFTP 走宿主进程）。
   **exec 面同样不是强制门**（本轮实测取证）：官方 `bash`/`pwsh` 工具把模型给的 `workdir` 原样当 `spec.cwd`
   透传（`dsh-tool-bash/lib/index.js`：`...args.workdir !== void 0 ? { cwd: args.workdir } : {}`，
   `resolveWorkdir` 只把**相对**路径接到会话 cwd），而混合门面按 `worldOfCwd(spec.cwd)` 路由 ⇒
   **零连接的本地会话只要传 `workdir: "ssh://c1/srv"` 就能在已注册机器上执行命令**，粗门拦不住。
   这是**结构性**的、不是疏漏：`SubprocessSpawnSpec` 不携带会话身份，门面在 spawn 时无从判别是哪个会话，
   所以门只能做在工具层（用户 2026-09-12 拍板「会话门控只做在工具层与提示层」正是这个原因）。
   命令级仍有 AUDIT-6 审批门兜底（该路径 argv 仍是 shell 形状，`isRemoteShellShape()` 判定成立）。
8. **提示：用「运行时上下文快照」做中插，而不是往头部 prompt 塞。** 侦察结论（磁盘权威源
   `dsh-system-prompt/lib/types/index.d.ts`）：`SystemPrompt` 只暴露 `section()` / `context()` /
   `suppressRuntimeContext()`，**没有**「会话中途插一条 system 消息」的 API；会话面里 `system/message`
   就是系统提示本身那个节点（surface node 0），不是历史中插口。但 `context()` 的文档写得很明确——
   *「Dynamic model context materialized as a **durable user-role snapshot**」*，且 `AssembleContext.scope`
   与 section 同源（同样能按会话作用域求值）⇒ **这就是「中插」的正典机制**（宿主自己也用它承载运行时事实，
   `suppressRuntimeContext` 就是给它准备的静音口）。因此：
   - **易变状态**（本会话已连接机器清单 + 副根清单）走 `ctx.systemPrompt.context({ name: 'dsw-session-workspace',
     order, text })`：每次 assembly 求值、以**耐久 user-role 快照**形式进入对话，模型在会话中途就能看到状态变化；
   - **稳定框架**（远程强调 + `remoteNoSandbox` + `remoteGateActive`）留在 `section('sw-remote', order 90)`；
   - 两者在「无远程事实」时都必须贡献空串 ⇒ 本地零连接会话**零注入**（补完 REQ-I6 零注入的工具侧）；
   - `tool:sw-exec` 段的存在性同样由「本会话有远程事实（远程 cwd / 副根 / 已连接机器）」决定。
   **诚实标注**：快照的投递与耐久语义是**读类型定义得出**的，未经真机确认 ⇒ `R24` 验收脚本必须至少一步
   证明「连接动作后，模型在**同一会话的后续回合**里确实看得到机器清单」（而不是只在头部 prompt 里）。
9. **面板 = 会话工作区驾驶舱**：主工作区（只读展示）+ 副根声明 + **已连接机器开关**；开关与 `sw_connect`
   写同一 store，UI 与模型不会各说一套。**两条入口的校验强度有意不同**：工具调用先 ping（模型驱动，
   可达性必须诚实），面板 toggle 不 ping（用户驱动、要即时反馈，用户看得见机器是否在线）。
   后果如实记录：经面板连接的机器可能当下不可达，`sw_exec` 在使用时会给出真实错误——这与「不维护
   可能失真的在线状态」是同一条原则。
10. **与 ADR-0020 的分层**：连接 = **粗门（可见性）**，审批 = **细门（每次远程命令的人审 / AI 放权）**。
    `remoteApproval` 是**逐机器**三态，`sessionConnections` 是**逐会话**集合，两轴正交、互不取代。
11. **SEC-5 收口**：参数面消失即 `password` 入日志的路径消失。`SECURITY.md` 红线 1 复述补记这条教训
    （「凭据永不作为模型工具参数」），并记明 `sw_connect` 现在只接受注册表 id。

## 3. 被否方案（侦察 A1 的磁盘证据）

| 方案 | 否掉的理由 |
|---|---|
| preset-scoped 注册（`dsh-agent-presets` 的 `createScope({agentPreset})`） | 需要拿到**会话的** `agent.ctx` 才能注册进该作用域，而宿主组合行拿不到它（A1 未知 #1）；且 preset 一经产出即固定，本地/远程会话同 preset 时无法区分 |
| 每 agent `ctx.tools.restrict({deny:['sw_exec']})` | 同上依赖 `agent.ctx`；`restrict` 在无作用域 ctx 上直接抛错 |
| `systemPrompt.tools` / `system-prompt/assemble` 装配期过滤 | 只影响**模型看到的清单**，不阻止调用；必须再配执行侧拒绝，复杂度换不来保证 |
| `parameters` getter 动态 enum（只列已连机器） | getter **没有 scope 参数**，只能靠「当前作用域」模块级耦合（脆弱、顺序未验证）；改为**执行侧校验 + 诚实报错列出已连 id**。getter 保留给纯展示用途（本仓库已在 `localizeTool` 上依赖「每 assembly 重读」这一事实） |
| 保留 `save:false` 临时连任意主机 | 用户拍板砍掉：凭据只能来自注册表/钥匙串/`~/.ssh/config`，临时路径绕开用户域且无法在设置页可见 |

## 4. 代价与风险

- **token 成本**：`sw_exec` 全局注册 ⇒ 未连接的本地会话也在工具清单里看到它。缓解 = 提示段零注入 + 执行侧拒绝
  + 诚实错误文案；若将来 A1 的未知 #1（能否拿到会话 `agent.ctx`）在 lab 里被证明可行，再升级为真正的按会话可见。
- **模型可能先 `sw_connect` 再干活**：这是期望行为（用户注册表是白名单），但意味着模型能**扩展**自己的执行面
  到用户已注册的任意机器——门控的信任根是「用户把机器注册进注册表」这一动作，ADR 如实记录。
- **fs 面非强制**：模型只要拼出 `ssh://<id>/…` 就能经官方文件工具读写注册机器（§2.7）。这是**已知且已接受**
  的边界，不得在文档里写成「已围栏」。
- **存储与会话生命周期**：宿主删除会话后文件里可能残留该会话的 key（`retain` 只按机器清理）。记为后续清理项，
  不影响正确性。

## 5. 验收

1. **工具面**：`sw_connect(machines:[])` 后 `sw_exec` 报「未连接任何机器」；`sw_connect(machines:['c1'])` 后
   `sw_exec(server:'c1')` 可达；`server:'c2'`（已注册未连接）报错并列出 `c1`；注册表未知 id 报「未知机器」。
2. **存储**：连接集合跨重启保持；`retain` 清掉被删机器；文件里**没有**任何凭据字段。
3. **RPC/面板**：`session.conn.list/connect/disconnect/set` 与工具写同一 store（面板开关后工具面随之变化，反之亦然）。
4. **fs**：本地会话 + 已注册机器 ⇒ 官方 read/edit 经 `ssh://<id>/…` 直达（`test/mixed-routing.test.ts` 已锁）。
5. **提示**：本地零连接 = `sw-remote` 与 `tool:sw-exec` 两段零注入；连接后下一次 assembly 出现机器清单。
6. **红线 1**：`src/` 与词典中不再存在 `password` 作为 `sw_connect` 参数；`SECURITY.md` 有对应条目。
7. 闸门：`check:static` / `typecheck` / `test:agent` / `build` / `boot-smoke --no-channel` 全绿；
   真机验收落在 lab（50599）+ `docs/uat/R24-req-i11-session-connections.md`（需用户执行）。
