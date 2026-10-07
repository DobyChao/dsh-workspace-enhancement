# 上游兼容矩阵与追踪

> 本插件寄生在快速迭代的宿主上：`@deepseek-ai/dsh` 在 2026-08-10 ~ 09-07 的 28 天里发了
> **16 个版本**（同一天多个 rc 是常态），官方仓库根**没有 CHANGELOG**，且 GitHub 侧
> `has_issues=false` / `has_pull_requests=false`（只有 discussions）——**上游改了什么，你不会有通知**。
> 因此兼容性必须靠自动化盯着，而不是靠出事后再查。

## 1. 支持窗口

| 插件版本 | 宿主 `@deepseek-ai/dsh` | 状态 | 说明 |
|---|---|---|---|
| 未发布（master + `UPSTREAM-8/9/10`） | `^0.1.7-rc.2 || ^0.2.0-rc.1`（**联合双家族**） | 开发中 | 09-28：UPSTREAM-8 运行时接缝修复 + UPSTREAM-9 pin 升 0.1.7 + 实机矩阵/WSL lab（INFRA-19/20）。09-29：UPSTREAM-10 拍板 A 案——0.2.0 宿主强制执行 peer（不符整 bundle 跳过⇒通道 404），peer 改联合 pin（0.2.0-rc.1 宿主 boot 哨兵 SMOKE PASS）；upstream.yml 补 `pinned-0.1.7-rc.2` 固定通道，drift next 随 tag 探 0.2.0 线；workflow 顶层键闸门入 check.mjs | 2026-09-28 宿主包 `latest` 翻到 `0.1.7-rc.2`（seam 包自身 latest 卡 `0.0.1` 不作数，信号以宿主包为准），UPSTREAM-5 留的「peer 等 latest 翻再升」兑现：34 个 dsh-* range 升 `^0.1.7-rc.2`（cordis `^4.0.4` / schemastery `^3.18.4` 跟随家族闭包）；`UPSTREAM-8` 同轮补齐 0.1.7 运行时接缝（SettingsForms locale 读 + jobs owner/ring 输出）。0.1.7 家族 typecheck/单测/build 全绿；boot 哨兵（0.1.5-rc.1 宿主）仍 SMOKE PASS = 已装 0.2.2 的 0.1.5 宿主运行时不回退 |
| 0.2.2（当前发布） | `^0.1.5-rc.1`（**单家族**） | 支持 | 0.2.1 之后：`BUG-10` 远程目录包 skill 三层修复（宿主 join 三种破坏形态）、`UPSTREAM-5` 0.1.7-rc 接缝（fs `watch` + subprocess `terminalEnvironment`，README 增 0.1.7-rc 行）、`UPSTREAM-7` scope watch 哨兵、drift workflow 加固。核心工件 `0.2.2`（serve 世界绑定，需重部署）。0.1.7-rc.2 宿主上有两处运行时断点（locale 渲染 + 后台 jobs），修复在未发布行 |
| 0.2.1 | `^0.1.5-rc.1`（**单家族**） | 支持 | 0.2.0 之后：`REQ-I10` 日落 pick、`REQ-I15` 读面降级、`REQ-I16` bash 按工作区注入、`BUG-7`/`BUG-8`/`BUG-9`。核心工件 `0.2.1`（hello 从误留的 `0.2.0-dev` 对齐）。宿主窗口与 0.2.0 相同 |
| 0.2.0 | `^0.1.5-rc.1` | 支持 | 远端一个核心（`REQ-I5` / `REQ-I13`）+ 核心分发（`INFRA-15`）+ UI 设计语言（`UX-3`）+ `BUG-4`/`BUG-5`/`BUG-6` |
| 0.1.4 | `^0.1.5-rc.1`（**单家族**） | 支持 | UPSTREAM-1：补上 0.1.5 线新增的 `readByteRange`（引擎 + 门面）；**UPSTREAM-3 R19**：浏览器通道从自挂 `/dsw` 改为**官方共享 `/api` 的精确 Fetch 路由**（`ADR-0018`），F1/F2/F3 全部落地；**UPSTREAM-4**：按所有者决定退场 0.1.2 家族，peer 13 项 + dev 21 项收窄为 `^0.1.5-rc.1`，哨兵只留 next/alpha 两条通道。**运行时口径（2026-09-11 实测）**：lab profile（`link:` 装本插件）+ `0.1.5-rc.2` 宿主真 boot ⇒ `POST /api/dsw/connections.list → 200, result.ok=true`；**0.1.5 家族可宣称运行时支持**（HTTP/宿主装配级；浏览器全流程见 UAT） |
| 0.1.3 | `0.1.2-rc.1` 家族 | **停止支持** | 发布形态修正：`dependencies` 仅 `ssh2`、15 个 peer 走 `^0.1.2-rc.1`；含 BUG-2 贴图修复与 REQ-I6。**2026-09-11 起 0.1.2 家族整体退场**（`UPSTREAM-4`）：本仓库不再为该线做兼容，升级宿主必须一并升级本插件 |
| 0.1.2 | `0.1.2-rc.1` 家族 | 停止支持 | 同家族，但 npm 产物仍是旧依赖形态（13 个 `@deepseek-ai/*` 落在 `dependencies`） |
| 0.1.1 | `0.1.1-rc.2` 家族 | 停止支持 | 家族劈叉缺陷版；建议升级 |
| 0.1.0 | `0.1.0-rc.6` 家族 | 停止支持 | 首次发布版 |
| 更早 / 更晚 | — | 未验证 | 上游 rc 通道，不承诺向前或向后兼容 |

**窗口策略**：声明"当前家族"为主，**例外**是同一条线上的一次破坏性接缝变更（`readByteRange`）——
那一次用**加法实现 + 联合 peer 范围**同时保住新旧两代宿主（2026-09-10 用户拍板），而不是把老宿主踢出去。
联合范围是**有代价的承诺**：闸门 #6 要求每个被声明的家族都在 `upstream.yml` 里有对应通道，不许只改声明不验证。

> **「声明支持」不等于「运行时可用」**（2026-09-10 教训，见 §2 的 F1/F2 行）：peer 范围只约束**编译/装载**，
> 而 F1（启动崩溃）在**只跑 typecheck + 单测**的哨兵下**完全隐形** —— 两代家族的 typecheck 全绿，
> 宿主却起不来。因此本表的「状态」列今后按**运行时证据**填写；upstream.yml 已补 boot 冒烟（§3）。

## 2. 已知破坏案例（都是真实发生过的）

| 日期 | 上游变化 | 症状 | 处置 | 现在被什么挡住 |
|---|---|---|---|---|
| 2026-08-30 | 接缝包家族版本劈叉（`dsh-fs`/`dsh-subprocess`/`dsh-timeout` 停在 `^0.1.0-rc.6`，`dsh-llm` 钉 `0.1.1-rc.1`，其余 `^0.1.1-rc.2`） | pnpm hoist 图出现重复副本 → Cordis 服务身份分裂（service/工具注册失效） | 全家族对齐同一 rc；`dependencies` 只留 `ssh2` | `check.mjs` #6「一个 rc 家族」+ #6b「peer 用 rc 通道」 |
| 2026-09-08 | `@deepseek-ai/dsh-session` 升到 `0.1.2-rc.1`，`Session.events` 数组被 `ownEvents()` / `snapshotEvents()` 取代 | `test/mixed-install.test.ts` 的 t6 静默失败 **2 天无人发现**（无 CI、代理跑不了测试） | 改用 `ownEvents()` | `ci.yml` 全量单测 + `upstream.yml` 每周哨兵 |
| 2026-09-09（**alpha 预警**） | `alpha` 通道 `0.1.5-alpha.2`：上游 `FileSystem` 新增抽象成员 `readByteRange`；家族新增 `@deepseek-ai/dsh-brand`、`@deepseek-ai/dsh-invariants` | `drift (alpha)` 红：`Non-abstract class 'SshFileSystem' does not implement inherited abstract member readByteRange`（`src/filesystem.ts:589`） | **已处置（2026-09-10）**：见下一行 —— 预警当天还是 alpha，第二天就进了 rc | `upstream.yml` 双通道哨兵 + 自动 issue #7 |
| 2026-09-10（**rc 提级**） | `0.1.5-rc.1` 发布，且宿主包 `@deepseek-ai/dsh` 的 **`latest` 直接指向它**；同一抽象成员现在落在 rc 线上（`drift (next)` 也红） | 与上一行同一条编译错，但性质从"提前预警"变成"下一个宿主版本就会撞" | **已修**：`SshFileSystemEngine.readByteRange` + `SshFileSystem` 前向 + `MixedFileSystem` 门面（含老宿主守卫）+ 反射契约扩到 14 方法 + 窗口语义用例；peer 改联合范围；哨兵加 `legacy` 通道盯住线上家族 | `test/mixed-fs-contract.test.ts`（静态 14 方法清单，与家族无关）+ `test/upstream-1-byte-range.test.ts` + `upstream.yml` 三通道 |
| 2026-09-10（**F1 启动崩溃**） | `dsh-client-connection@0.1.5-*` 把自己的 `const inject` 从 `["webServer","credentials"]` 收紧为 `["credentials"]`（0.1.2-rc.1 是前者）；其 `register(owner, …)` 末行**恒读** `owner.webServer`，而 `owner` 是 **Connection 服务自己的 ctx** | 插件在 **0.1.5-rc.1 与 rc.2 上启动即崩**：抛 `cannot get property "webServer" without inject`，整棵 plugin tree 加载失败（`web.ts` 的 `apply()` 在插件根上下文调 `connection.rpc.handle`）。**编译级与单测级全绿**（typecheck 不报错、240 例通过）⇒ 自动化**完全没拦住** | **已修（t11）**：挂载搬进 `ctx.inject(['webServer'], webCtx => …)`（与上游自己挂 `/api` 同形状）。真 boot 矩阵：rc.2 / 真·rc.1 / legacy **三家族 SMOKE PASS**；**负向对照**（pre-fix 挂载）**FAIL exit 1** 且复现同样的 `without inject` | **`scripts/boot-smoke.mjs`（新增）+ `upstream.yml` 三通道都加 `npm run build` + boot smoke** —— 这是本轮补上的**唯一**能拦住 F1 的机制（`UPSTREAM-3` ③ F3） |
| 2026-09-11（**F2 修复 + 0.1.2 退场**，`R19`） | F1 的修法只把失败装进子 fiber ⇒ `/dsw` 静默不存在；且 `rpc.intercept('/api')` 这条官方扩展点被**单占位**的 `dsh-api-gateway` 占死 | rc.2 上 `/dsw` 的 `POST` → **405**（空 body）、`GET` → **404**（SPA 兜底位，含义是「没有具名路由匹配」），数据面（连接列表/状态/重连/browse）全部不可用 | **已修（`ADR-0018`）**：通道改挂**官方共享 `/api` 的精确 Fetch 路由**（`connection.fetch.register`，先于拦截器被分发、不读 `owner.webServer`，`dsh-client-file-upload` 同款）；客户端改 `rpc.call('/api', 'dsw/<endpoint>')`，信封不变。真机实证：lab profile + 0.1.5-rc.2 ⇒ `POST /api/dsw/connections.list → 200, result.ok=true`（修前同一探针 405）。**所有者同日拍板 0.1.2 家族退场**（`UPSTREAM-4`） | **`scripts/boot-smoke.mjs` 强断言**（`POST /api/dsw/connections.list` 必须 200 + `result.ok=true`，`--channel-warn` 降级口已删）+ `test/web-channel.test.ts`（信封/路径/重载/端点清单锁定）+ `upstream.yml` next/alpha 每通道都跑 |
| 2026-09-10（**rc.2 客户端槽位重排**） | `0.1.5-rc.2` 的客户端槽位目录 `CLIENT_SLOT_API` 从 **52 → 61**：**新增 12**、**删除 3**（`conversation`、`details`、`conversation.details.tool`，被 `main`/`rightbar` 体系取代） | 占用**被删 3 槽**的插件在 rc.2 上**静默**失去挂载点 —— 槽未声明 ⇒ `slots.inject` 的回调**永不执行且不报错**（不是异常，是"什么都没发生"）。**已核查现网 5 个第三方包无一占用**该 3 槽；**我方 5 个槽逐字节未变**（详见 `UPSTREAM-2`） | 本次为**上游重排**，我方无需改动；已把「槽位/服务目录 diff」资产化为 `npm run slots -- --list\|--key\|--diff`（`scripts/slot-catalog.mjs`，入库） | **目前无自动闸门**：槽位目录**没有**任何守卫，靠 `upstream.yml` 三通道哨兵 + **人工比对**（哨兵只跑编译/单测/boot，不会发现槽位消失）。判定该风险是否成立需人工执行 `npm run slots -- --diff` |
| 2026-09-15（**`0.1.6-alpha.1` 新世代**） | ① `@deepseek-ai/dsh-subprocess` 加宽：`SubprocessHandle.control`（`Duplex \| undefined`，fd 7 继承型控制通道）、`SubprocessTerminalSpawnSpec.terminalType`（**必填**）、`SubprocessTerminalHandle.resize(cols, rows)`、`SubprocessRuntime.terminalEnvironment()`；② **同批首发官方 SSH 家族**：`@deepseek-ai/dsh-ssh` / `dsh-fs-ssh` / `dsh-sandbox-ssh` / `dsh-subprocess-ssh`——四者都**只有** `0.1.6-alpha.1` 一个版本（2026-09-15T03:25Z 起，无 rc、无旧版），默认组合（`dsh` CLI / `dsh-base`）**不含**它们 | `drift (alpha)` 红 = **编译错**：`CoreSubprocessHandle`（`src/core-process.ts:47`）/ `SshTerminalHandle`（`src/terminal.ts:28`）/ `SshSubprocessRuntime`（`src/subprocess.ts:338`）三处实现失配。**SSH 家族本身零运行时影响**（未安装、未依赖） | 登记为 **`UPSTREAM-5`**（`0.1.6` 升 rc 前收口；实现注意清单见 `ADR-0026` §4）。家族事实见 `ADR-0026`；定位拍板 = **`UPSTREAM-6`**（待所有者）；新包巡检 = **`UPSTREAM-7`** | 目前**只有 alpha 通道**会红（`next` 仍是 `0.1.5-rc.2`）。**新包不在哨兵家族清单里 ⇒ 哨兵看不见它们**：如实记「目前无自动闸门」，靠人工 `npm view` 比对（§6） |
| 2026-09-25（**`0.1.7-rc.2` 接缝再扩**） | `next` 推进到 `0.1.7-rc.2`：① `dsh-fs-local` 具体后端新增 `watch(target, changed, signal)`（chokidar，基类未声明）；② subprocess 的 `terminalEnvironment` 落到具体本地后端 | 手动 dispatch 的 drift 双通道红：`MixedFileSystem` 缺 `watch` 被**反射契约**点名；`MixedSubprocessRuntime` 缺 `terminalEnvironment` **无任何门拦住**——R14 O2 预言的「门面=子集类型」在 subprocess 侧没有反射契约（→ `AUDIT-1` 补） | **已修（`UPSTREAM-5`）**：fs 门面补 `watch`（local 转发 / remote 诚实 `FS_IO_ERROR` / 老委托同式守卫）；subprocess 门面补 `terminalEnvironment`（世界无关随 local 委托，委托太老按上游同式自算宿主事实）；契约静态清单扩到 15 方法。**同日追记**：dispatch 复跑时 `dsh-fs@next` 亦从 `0.1.5-rc.2` 跳到 `0.1.7-rc.2`（上午快照之后），基类 `FileSystem.prototype` 自己具现 `watch`——契约的基类快照改**家族自适应**（floor 必在 ⊆ 已知集，新名字仍红） | `test/mixed-fs-contract.test.ts`（15 方法全集 + 自适应基类快照）+ drift 双通道（typecheck + 单测 + boot smoke）+ subprocess 反射契约（`AUDIT-1`） |
| 2026-09-28（**`0.2.0-rc.1` 首次接触**，`UPSTREAM-10`） | 宿主 master 以 rc 发布：`next` 从 `0.1.7-rc.2` → **`0.2.0-rc.1`**（13 个 seam 包同步跳线）；`dsh-web-app@0.2.0-rc.1` 组合新增/更名若干包并**精确钉了尚未发布的 `dsh-client-ui-settings-account@0.2.0-rc.1`**（该包 npm 上最高 `0.1.7-rc.2`） | 三哨兵同日全响（tag-watch #48 / scope-watch #46 / drift #49，均为 INFRA-20/7 机制**首日实战**）。drift next：typecheck + 全量单测 + 静态门 + build **全绿**（UPSTREAM-8 双家族适配直接覆盖 0.2.0），但 **boot smoke 红**——宿主树因缺包装不完整（本地复现同：`ETARGET dsh-client-ui-settings-account@0.2.0-rc.1`），属**上游发版残缺**，非我方不兼容 | 契约 diff（磁盘权威源 `.tmp/rc20-contract` scratch）：settings 面 / jobs owner+ring / fs 面 / subprocess 面 / `ToolRunContext.agent` 与 0.1.7-rc.2 **逐字一致**；cordis 仍 `~4.0.4`。**已确定的己方问题**：peer `^0.1.7-rc.2` 上限 `<0.2.0`——`latest` 翻 0.2.0 时新装必被拒，届时联合 pin（`^0.1.7-rc.2` 加 `^0.2.0-rc.1`）或整体升 pin（每家族需在 upstream.yml 点名，闸门规则）。上游补齐缺失包后：dispatch drift 复测 boot + 拍 pin | 契约 diff 脚本流程（R41/R42 磁盘权威源法）+ drift 双通道 + **每日 tag-watch**（本次比 cron 早，由 dispatch 触发首响） |
| 2026-09-29（**`0.2.0-rc.1` boot 实证 + peer 强制执行**，`UPSTREAM-10`） | 上游补齐 `dsh-client-ui-settings-account@0.2.0-rc.1`（宿主树可完整安装，288 包）；且 **0.2.0 宿主在 boot 时强制执行插件 peerDependencies**——不符即 skip 整个 bundle（0.1.x 仅 pnpm 警告），stderr 明示豁免通道 `dsh plugin allow-version` | 原样插件（pin `^0.1.7-rc.2`）在 0.2.0-rc.1 宿主上被 skip ⇒ `/api/dsw` 404（boot 哨兵抓到）；**联合 pin 副本**（`^0.1.7-rc.2` 加 `^0.2.0-rc.1`）同一宿主 **SMOKE PASS**（boot + token + 通道 200 ok=true） | **结论：运行时兼容，唯一缺口 = pin**。修复路径二选一：①联合 pin（闸门要求 upstream.yml 点名每个家族）；②等 `latest` 翻 0.2.0 整体升（UPSTREAM-5/9 先例）。基线已认领（tag + composition）；drift next 在 pin 落地前预期红（peer skip ⇒ 404），#49 追踪至绿 | boot 哨兵强断言（404 即红）+ 磁盘权威源 scratch 探针 + 每日 tag-watch |
| 2026-09-28（**`0.1.7-rc.2` 运行时两断点，用户实机报告**） | ① `dsh-settings@0.1.7-rc.2` 把 settings 服务整体重写为 `SettingsForms`（`describe`/`update`/`replace`/`mutate` 配置表单面），`get(namespace)` 读取器消失；② `dsh-jobs@0.1.7-rc.2` 的 `start` 契约：`owner` 从 **Agent 实例**改为 **SessionId 字符串**，`run(job)` 收 `JobHandle`，输出从 hooks 的 `readOutput` 改为 spec 的 `output` **pull source**（registry 泵进 ring，模型经 `read` 消费带 channel 的 chunks） | ① 凡渲染本地化标记（空输出 / exit code / 沙箱拒绝）即 `TypeError: settings.get is not a function`，render 直接抛；② 三处后台注册（`sw_exec` 远程 / `sw_exec local` / win32 `bash`）`owner` 传 Agent 对象 ⇒ 0.1.7 的 owner 预检拒收，后台全灭；且不接 `output` 的话即便过了 owner，`job_output` 也只会读到空 ring | **已修（`UPSTREAM-8`）**：① `localePreferenceOf` 家族自适应——settings 有 `get` 走 0.1.5 读法，没有则回退 EN（0.1.7 的 `describe()` 每次遍历全部 profile 条目、带 revision 副作用，是配置 UI 读取不是热路径读；官方 bash 工具 0.1.7 自己也硬编码 EN 标记）；② `jobOwnerOf`（以 `readAt` 在场判 ring 家族：owner 传 `agent.id`）+ `collectSources`（collect readers 晚绑定 pull source，官方 bash 同款接法）+ `deltaRingSource`（宿主 shell 增量 `readOutput` 的字节游标桥，8 MiB 保留界 + UTF-8 码点边界裁剪）；0.1.5 路径原样保留（owner 实例 + `readOutput` hook） | `test/locale-host.test.ts`（0.1.7 `SettingsForms` fixture：不抛、回退 EN）+ `test/exec-tools.test.ts`（`jobOwnerOf` / `deltaRingSource` 字节游标与裁剪 + 三处 ring 家族注册用例）+ drift `next` 通道跑全部。**教训**：typecheck / 单测 / boot 三层当时全绿——断的是运行时契约而非编译期形状，检出来靠用户实机；0.1.7 契约 fixture 本轮已从磁盘权威源（`@next` scratch 安装）核出并锁进测试 |
| 2026-10-03（**`latest` 翻 0.2.0 线 + alpha 翻 0.2.1 代**，认领） | 宿主包 `latest` 从 `0.1.7-rc.2` → **`0.2.0-rc.2`**（#56）：新装宿主默认 0.2.0 家族（强制 peer）；`alpha` 同时 `0.1.7-alpha.2` → **`0.2.1-alpha.1`**（下一代预警，周四 drift 自动探） | 联合 pin `^0.1.7-rc.2 \|\| ^0.2.0-rc.1` 按语义化覆盖 rc.2——**发布前终检即实证**：0.2.3 tarball 在 0.2.0-rc.2 全家安装无 ERESOLVE + boot SMOKE PASS；lab 长期跑 rc.2 宿主 | **结论：pin 不动，新装即可用**。主 dev 家族是否从 0.1.7 翻到 0.2.0 属 owner 拍板（UPSTREAM-9 先例是 latest 翻即升；当前 0.2.0 仍是 rc 线，联合 pin 已保安装面，不急）。附带：#57 alpha 竞态实锤（ETARGET 10:13:13 vs 补发包 10:13:16 上架，差 3 秒；其后三天的定时 drift 全绿），上游发版残缺非我方不兼容，随发补齐 | 每日 tag-watch + 发布前终检（scratch 安装/boot）+ drift 三通道 |
| 2026-09-29（**`next` 再进：`0.2.0-rc.2`**，认领即收口） | 距 rc.1 认领仅数小时，`next` 从 `0.2.0-rc.1` → **`0.2.0-rc.2`**（13 个 seam 包同步）；tag-watch 当日再响（#52），drift 家族漂移（#53） | 按哨兵指引**手动 dispatch drift**：`drift (next)`（=rc.2 全家重装 + typecheck + 全量单测 + 静态门 + build + boot 冒烟）**绿**（8m44s）；本地 scratch 双证：宿主 `0.2.0-rc.2` + 13 seam `@next` + 当前分支 pack tarball 一次安装**无 ERESOLVE**（0.2.0 宿主强制 peer 下联合 pin 直接可装），同树 boot 哨兵 **SMOKE PASS**（boot + `/api/dsw` 通道 200 ok=true） | **结论：联合 pin `^0.1.7-rc.2 \|\| ^0.2.0-rc.1` 按语义化版本已覆盖 rc.2（caret 含同 tuple 预发布），无需改 pin**；PUB-8（0.2.3）发版窗口不受影响——rc.2 宿主装 0.2.3 即开箱可用。tag 基线已认领（composition 无漂移，scope-watch 绿，不重写）；#52/#53 关闭 | 每日 tag-watch + 手动 dispatch drift（哨兵指引动作）+ 本地 scratch 安装/ boot 探针（R41/R42 磁盘权威源法同款流程） |
| 2026-10-07（**组合漂移认领**，#58） | scope-watch 响（10-05 开 issue）：宿主组合**纯新增**——`dsh@latest`(0.2.0-rc.2) +`dsh-experimental-schedule-bundle`（Schedule 任务页 + 时间上下文进 Web 组合）；`dsh@alpha`(0.2.1-alpha.1) +`dsh-tool-schedule`（工具面持久 after/at/固定频率提醒）、`dsh-experimental-auto-review`（Auto 权限档 per-tool LLM 审批）、`dsh-experimental-inspector-profile`；`dsh-web-app@alpha` +8 客户端包（快捷键×2、session-log 上传设置、产品埋点/OTel×3、schedule 系×3） | **零契约冲击**：逐包核 peer/dependencies——新增包无一依赖 `dsh-subprocess` / `dsh-fs(-local)` 接缝家族（schedule 系 peer 是 llm/agent/tools/session/persistence），`ctx.subprocess`/`ctx.fs` 接缝所有权不变；基线 diff 无任何**移除**，SSH 四包仍未被收编（UPSTREAM-6 现况不变） | **结论：认领，零代码动作**。pin 不动（alpha 0.2.1 本就不在联合 pin 支持面）。前瞻一条：`auto-review` 若进正式线，我方 `sw_connect`/`sw_status` 的工具描述要经得起 LLM 审批者读 | 每日 tag-watch + 周一 scope-watch（本轮即其战果）+ 周四 drift(alpha) 自动探 0.2.1 代 |

> 第二个案例是建立 CI 的直接动因：**依赖升级能悄悄弄坏测试，而当时没有任何机制会喊一声。**

## 3. 四层防护

| 层 | 机制 | 位置 | 触发 |
|---|---|---|---|
| L1 静态 | 所有 peer 必须声明**同一个**范围（可以是 `||` 联合）；dev 必须是该范围里的一个备选；peer 范围必须带 `-rc.`；宿主包不得进 `dependencies`；**联合范围里每个家族都必须在 `upstream.yml` 里被点名** | `scripts/check.mjs` #6 | 每次 `npm run check` |
| L2 升级 | Renovate 把 `@deepseek-ai/*` 分组为一个 PR（peer 与 dev 同步升级），禁止自动合并 | `renovate.json` | 每周 |
| L3 哨兵 | **两通道**探测：`next` / `alpha` 各自重装家族，跑 typecheck + 全量单测 + 静态闸门 + boot 冒烟；任一红则自动开/更新 issue。**scope watch**（`UPSTREAM-7`）：每周一同一 workflow 比对宿主包 `@deepseek-ai/*` 组成与 `scripts/upstream-baseline.json`，漂移即开 issue（SSH 四包收编单独点名，是 `UPSTREAM-6` 复评触发器） | `.github/workflows/upstream.yml` + `scripts/upstream-watch.mjs` | 每周一 + 每周四（alpha）+ 手动 |
| L4 运行时 | 能力探测而非版本假设：可选服务 `ctx.get()` 判空、特性探测、双键回退、首用 fail-loud | `src/**`（见下） | 运行期 |

L3 的判读：它红不代表要立刻改代码，而是**代表"上游已经变了，你需要看一眼"**——
这正是"上游非兼容修改识别"想要的信号。

### 3.1 三通道哨兵：为什么要盯 alpha，也要盯线上家族

npm 上 `@deepseek-ai/dsh` 家族有三个通道：`latest` → `next`（rc）→ `alpha`（下一代）。
**破坏性接缝变更最先落在 alpha**，其内容迟早被提升为 rc；等它变成 rc 再动，就只剩救火窗口。
2026-09-10 当天就演示了这条链路有多快：alpha 的 `readByteRange` 上午还是"预警"，
下午 `0.1.5-rc.1` 发布、**宿主包的 `latest` 直接指向它**。哨兵探**两条**通道：

| 通道 | 现在解析到 | 含义 |
|---|---|---|
| `next` | **`0.2.0-rc.2`**（2026-09-29 实测；`latest` 仍 `0.1.7-rc.2`） | 下一代 rc——红了 = 提前预警 + boot 复测入口。2026-09-29 认领：联合 pin 按语义化版本已覆盖 rc.2（`^0.2.0-rc.1` 含同 tuple 预发布），drift (next) 绿 + 本地 scratch 安装/boot 双证（见当日行）；rc.1 时代的 pin 缺口已由 `UPSTREAM-10` 联合 pin 收口 |
| `alpha` | **`0.1.7-alpha.2`**（2026-09-25 实测） | 下一代——红了 = **提前预警**（还有提升缓冲期）。0.1.6 的 SSH 新包事实见 `ADR-0026` |

> **`legacy`（0.1.2-rc.1）通道已于 2026-09-11 删除**（`UPSTREAM-4`）：所有者拍板 3080 不再安装本插件、
> 后续不考虑 0.1.2 兼容，peer 范围随之收窄为单家族，再留一条 legacy 通道就是**验证一个我们不支持的家族**。
>
> **seam 包自身的 `latest` 不作数**（2026-09-28 实测卡在 `0.0.1-rc.1`）：家族信号以宿主包
> `@deepseek-ai/dsh` 的 `latest` 为准——它指向哪条 rc 线，新装宿主就提供哪个家族组合。
> 闸门 #6 的「多家族必须多通道」检查因此不再触发——声明少一条，就必须少验一条。

**每通道都跑 boot 冒烟**（`UPSTREAM-3` ③）：原先哨兵只跑 typecheck + 单测 + 静态闸门，
`0.1.5-rc.1`/`rc.2` 上**插件启动即崩**却全绿（F1）——「能编译」被当成了「能运行」。
现在每通道都 `npm run build` + 跑 `scripts/boot-smoke.mjs`
（临时 `DSH_HOME` → 起宿主 → 断言进程存活 / `GET /` 200 / `POST /api/dsw/connections.list` 200 + `result.ok=true`）。
判定口径：**每条通道都强断言**——通道现在挂在官方 `/api` 精确 Fetch 路由上（`ADR-0018`），
全线可用，`--channel-warn` 那个「已知破坏」降级口已随 F2 修复一并删除。

alpha 已经出现我们**从未依赖过的新包**：`@deepseek-ai/dsh-brand`、`@deepseek-ai/dsh-invariants`
（`dsh-fs@alpha` 的依赖里可见）——这正是「alpha 内容并入 rc 后我们需要改」的典型形态；
用户实测「用最新 alpha 装插件会炸」也是同一来源。**判读**：红了不是立刻改代码，而是当天看一眼；
alpha 的 issue 会一直挂着直到处理（自动开/评论，不用人肉记）。

> **哨兵盲区的第二形态（2026-09-15 实测，`UPSTREAM-6`）**：上面那类新包还能从**依赖图**里看见，
> 而 `0.1.6-alpha.1` 首发的 `@deepseek-ai/dsh-ssh` / `dsh-fs-ssh` / `dsh-sandbox-ssh` /
> `dsh-subprocess-ssh` 是**独立能力包**——它们既不进 seam 家族清单（`upstream.yml` 只装固定 13 包），
> 也不被家族成员的依赖带进来 ⇒ **通道红/绿都不会提到它们**。本次发现纯属人工翻 registry。
> 事实与差异矩阵见 `ADR-0026`；「scope 新包巡检」是 `UPSTREAM-7`。定位拍板是 `UPSTREAM-6`。

> 历史坑：旧版哨兵 `npm install --no-save <pkg>` 不带版本，装的是 `latest` 标签（`0.0.1-rc.1`），
> 比 `next` 还旧——等于每周测了一个更老的家族。现在按 dist-tag 显式解析、并打印实际解析结果。

> 探针自身的坑（2026-09-10）：家族成员会把新包声明为 **peer**（`dsh-subprocess@0.1.5-rc.1` →
> `@deepseek-ai/dsh-http-proxy`），而探针为了装"peer 范围外的家族"必须带 `--legacy-peer-deps`，
> 该开关**不自动安装 peer** → 包不进树，三个套件在跑到断言前就 `ERR_MODULE_NOT_FOUND`，
> 看起来像"产品在别处坏了"。故哨兵现在补装"家族闭包"（扫家族成员的 `dependencies` /
> `peerDependencies` / `optionalDependencies`，缺失的按同一通道补），并打印 `closure probe`、
> `ls node_modules/@deepseek-ai`、`require.resolve` 三条诊断。

## 4. 运行时能力探测约定（写代码时遵守）

1. **可选服务**用 `ctx.get('name')` 判空，不要用 `inject` 硬绑（硬依赖才 `inject`）。
2. **特性开关**优先探测能力（如 `features.includes('x')`），其次才比较版本字符串。
3. **服务改名过渡期**用双键回退：`ctx.get('newName') ?? ctx.get('oldName')`。
4. **可选 peer** 用 `peerDependenciesMeta.<pkg>.optional = true` 声明，不要塞进 `dependencies`。
5. **依赖其它插件行为的校验延后到首次使用**（最早可解析点 fail-loud），不要在 `apply()` 里做。
6. **副作用必须可逆**：注册/监听/定时器/槽位一律挂 `ctx.effect()` / `ctx.on()`；重装或热更新后再挂一次不能抛
   "already registered"（生态里真实崩过，属于固定回归点）。
7. **客户端判定不假设与 host 等价**：`routeIdOf`（`src/client/route-id.ts`，被 `remote-status` 与
   `row-badges` 消费）是 host 判定（`remoteRouteFromCwd` → `parseSshRoute` / `routeFromPlaceholder`）的
   **宽松镜像**，**不承诺等价**。已知 **D1/D2/D3** 三处偏离，方向一致（客户端更宽松）：
   **D1** `ssh://<id>`（有 id 无路径）客户端判连接、host 判本地；**D2** 客户端不校验 path 是否 POSIX 绝对；
   **D3** 客户端只按字符串含 `dsw-routes/<seg>` 取 id，host 要求落在 `$DSH_HOME/dsw-routes` 下
   （存在时还做 realpath 重试）。**三条均为既有行为**（`routeIdOf` 早已服务 row-badges 的两个 index
   构造器，本轮只做了**纯搬迁**到 `route-id.ts`：改 import + re-export，导出名与行为不变），
   **不是本轮引入**。D3 属**架构性**限制（浏览器侧无 `node:fs`，做不了 realpath 归一）。
   **需要等价判定的地方必须回 host 取事实**（如 `session.route`）。详见 `ADR-0017` §7.6。

   **护栏可见性（三档）** —— 写改动前先看这张表，判明「红了意味着**语义回归**还是**夹具要改**」：

   | 档 | 覆盖 | 证据 | 在哪跑 | 改它时你会遇到什么 |
   |---|---|---|---|---|
   | **① 有意钉住** | D1 / D2 | `test/remote-status.test.ts` 的解析器断言（`ssh://c3 → c3`；malformed id → `undefined`） | **沙箱内真跑**（`npm run test:agent`） | **先红** ⇒ 逼出显式决策（改判定 + 改测试 + 更新 `ADR-0017` §7.6） |
   | **② 顺带钉住（incidental）** | D3 的宽松语义（"不落在任何 DSH 根内也算远程"） | 只有 `test/row-badges.test.ts` 的夹具 `C:\dsh\dsw-routes\<id>\home\u`（**无 `.dsh` 段** ⇒ 不在任何 DSH 根之下），经 `remoteWorkspaceIndex`/`remoteSessionIndex` 的 **15 个使用点**断言为远程 | **只在 CI**（该文件直接 import `.tsx`，`test:agent` **SKIP**） | **CI 里一片"意外红"** —— 它们**不是**你破坏了契约，而是**夹具路径需要换**（换成真正落在 root 下的路径）。**不知道这点的人会把「夹具要改」误读成「语义回归」** |
   | **③ 无断言** | 其余（`routeIdOf` 自身的正则、旧命名树的根外形态等） | — | — | 无护栏 |

   **两条纪律**：**不得**给 D3 补正面断言（它是已知限制，与 D1 那种防御分支性质不同，固化只会给
   将来的收紧制造摩擦）；**写护栏时必须写清「钉的是哪个语义粒度、在哪跑、红了是语义回归还是夹具要改」**
   —— 只看「被断言的符号名」会得出相反结论（本轮实测教训）。

## 5. 方法学教训（**比单条结论更值得复用**）

1. **「能编译 ≠ 能运行」** —— 2026-09-10 的 F1 是标本：`0.1.5` 家族上插件**启动即崩**，
   而哨兵当时只跑 typecheck + 单测 + 静态闸门，**两代家族全绿**。`readByteRange` 那种
   「缺方法 ⇒ 编译错」能被 typecheck 抓到，但 `inject` 收紧导致的**运行时属性读取失败**抓不到。
   ⇒ **凡涉及宿主装配（服务/cordis 组合/路由挂载）的改动，验证必须包含一次真 boot**；
   机制已落地为 `scripts/boot-smoke.mjs` + `upstream.yml` 三通道（§3.1）。
2. **判「有没有护栏」要看断言喂的数据与语义粒度，不能只看被断言的符号名** —— 本轮实测教训：
   `test/row-badges.test.ts` 里 grep 不到 `routeIdOf` 这个名字，但它的夹具（`C:\dsh\dsw-routes\…`）
   经两个 index 构造器**顺带钉住**了 D3；反过来，`test/remote-status.test.ts` 里那些
   **看起来**在测「远程判定」的路径全都带根前缀，钉的其实是另一个语义粒度。
   ⇒ 三档护栏表（§4.7）就是这条教训的产物，包含「红了是语义回归还是夹具要改」。
3. **上游契约引用必须「文件 + 版本 + 符号」同现** —— 行号只在**同一份快照内**有效，跨版本混用会得出
   相反的结论；本仓库已因此栽过两次：① `D:\ZCodeProject\deepseek-harness` 那份 checkout 是
   `0.1.0-rc.5`（槽位 42 个、零 `panellist` 命中），拿它核验 rc.2 会得出「新槽位不存在」；
   ② AGENTS.md 里曾用「`CLIENT_SLOT_API` 约 :2135」这类**没有版本标注**的行号指向**已被替换**的 bundle。
   ⇒ 引用纪律（类型面在 devDependency 树 / 运行时校验在解包产物 / 线上行为在全局安装树）与
   `npm run slots` 工具见 `ADR-0017` §1.1–§1.3。

## 6. 上游官方 SSH 运行时（`0.1.6-alpha.1` 首发）

**事实、远端 helper 部署模型、差异矩阵与定位选项都在 [`ADR-0026`](./decisions/ADR-0026-upstream-ssh-runtime.md)**——
本文件只留判读与纪律，避免第二份真相：

1. **不要因为上游做了 SSH 就改我方路线。** 官方形态是「一 profile 一别名 = 一个远端世界」、headless 优先、
   要求远端预装 helper + 整棵依赖 + SHA-256 pin，且**硬拒非 POSIX 宿主**
   （`dsh-ssh@0.1.6-alpha.1` `lib/index.js:46`）。我方的机器注册表 / `ssh://` 路由 / 浏览器面 /
   免远端预装都不在它的覆盖里（`ADR-0026` §3）。定位拍板是 `UPSTREAM-6`；新包巡检是 `UPSTREAM-7`。
2. **接缝加宽按官方抽象对齐**，别自造私有扩展：`UPSTREAM-5` 的四个成员是通用抽象，
   实现前读 `ADR-0026` §4（含 `control` 声明为 `undefined`、`resize(cols, rows)` 与 ssh2
   `setWindow(rows, cols)` 顺序相反、`terminalEnvironment` 必须报远端事实等）。
3. **契约引用一律「包 + 版本 + 符号」**（§5.3）：上游 `dsh-subprocess-ssh` 的类与我方
   `SshSubprocessRuntime` **重名**，只写类名必然读错。
4. **新包巡检（已自动化，`UPSTREAM-7`）**：`upstream.yml` 的 scope-watch 作业每周比对宿主包组成与 `scripts/upstream-baseline.json`（基线确认 = `node scripts/upstream-watch.mjs --write-baseline` 后提交）；SSH 四包被收编会在 issue 里单独点名（`UPSTREAM-6` 复评触发器）。手工核查仍可按 `ADR-0026` §6 的命令 `npm view`——
   通道"绿"只证明**接缝**兼容，不证明上游没换赛道。

## 7. 维护本文件

- 每次发布：在 §1 增加一行（插件版本 × 宿主家族 × 状态），并把窗口收窄/放宽写清。
- 每次踩到上游变更：在 §2 加一行（日期 / 变化 / 症状 / 处置 / 现在被什么挡住）。
- 每次上游新增**独立能力包**（像 `0.1.6-alpha.1` 的 SSH 家族那样不进家族清单、也不被依赖带进来的）：
  在 §6 与 `ADR-0026` 登记，并把它算作「哨兵看不见的事」——不要因为通道是绿的就跳过。
- 表格里的"现在被什么挡住"必须是**已存在的自动化**，不能是"下次注意"；**若确实没有自动化，
  就如实写「目前无自动闸门」并说明人工比对方式**（例：§2 的 rc.2 槽位重排一行）——
  把「无守卫」写成「有守卫」比不写更危险。
- §1 的「状态」列今后按**运行时证据**填写，不按 peer 声明填写（§1 表下的注记）。
