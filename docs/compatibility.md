# 上游兼容矩阵与追踪

> 本插件寄生在快速迭代的宿主上：`@deepseek-ai/dsh` 在 2026-08-10 ~ 09-07 的 28 天里发了
> **16 个版本**（同一天多个 rc 是常态），官方仓库根**没有 CHANGELOG**，且 GitHub 侧
> `has_issues=false` / `has_pull_requests=false`（只有 discussions）——**上游改了什么，你不会有通知**。
> 因此兼容性必须靠自动化盯着，而不是靠出事后再查。

## 1. 支持窗口

| 插件版本 | 宿主 `@deepseek-ai/dsh` | 状态 | 说明 |
|---|---|---|---|
| 0.1.4（本轮，未发布） | `^0.1.5-rc.1`（**单家族**） | 支持 | UPSTREAM-1：补上 0.1.5 线新增的 `readByteRange`（引擎 + 门面）；**UPSTREAM-3 R19**：浏览器通道从自挂 `/dsw` 改为**官方共享 `/api` 的精确 Fetch 路由**（`ADR-0018`），F1/F2/F3 全部落地；**UPSTREAM-4**：按所有者决定退场 0.1.2 家族，peer 13 项 + dev 21 项收窄为 `^0.1.5-rc.1`，哨兵只剩 next/alpha 两条通道。**运行时口径（2026-09-11 实测）**：lab profile（`link:` 装本插件）+ `0.1.5-rc.2` 宿主真 boot ⇒ `POST /api/dsw/connections.list → 200, result.ok=true`；**0.1.5 家族可宣称运行时支持**（HTTP/宿主装配级；浏览器全流程见 UAT） |
| 0.1.3（当前发布） | `0.1.2-rc.1` 家族 | **停止支持** | 发布形态修正：`dependencies` 仅 `ssh2`、15 个 peer 走 `^0.1.2-rc.1`；含 BUG-2 贴图修复与 REQ-I6。**2026-09-11 起 0.1.2 家族整体退场**（`UPSTREAM-4`）：本仓库不再为该线做兼容，升级宿主必须一并升级本插件 |
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

> 第二个案例是建立 CI 的直接动因：**依赖升级能悄悄弄坏测试，而当时没有任何机制会喊一声。**

## 3. 四层防护

| 层 | 机制 | 位置 | 触发 |
|---|---|---|---|
| L1 静态 | 所有 peer 必须声明**同一个**范围（可以是 `||` 联合）；dev 必须是该范围里的一个备选；peer 范围必须带 `-rc.`；宿主包不得进 `dependencies`；**联合范围里每个家族都必须在 `upstream.yml` 里被点名** | `scripts/check.mjs` #6 | 每次 `npm run check` |
| L2 升级 | Renovate 把 `@deepseek-ai/*` 分组为一个 PR（peer 与 dev 同步升级），禁止自动合并 | `renovate.json` | 每周 |
| L3 哨兵 | **三通道**探测：`next` / `alpha` / `legacy` 各自重装家族，跑 typecheck + 全量单测 + 静态闸门；任一红则自动开/更新 issue | `.github/workflows/upstream.yml` | 每周一（三条）+ 每周四（alpha）+ 手动 |
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
| `next` | **`0.1.5-rc.2`**（rc.1 → rc.2 为**同日连续发版**） | 我们声明支持的家族（**唯一**一条）——红了 = **下一个宿主版本就会撞** |
| `alpha` | `0.1.5-alpha.2` | 下一代——红了 = **提前预警**（还有提升缓冲期） |

> **`legacy`（0.1.2-rc.1）通道已于 2026-09-11 删除**（`UPSTREAM-4`）：所有者拍板 3080 不再安装本插件、
> 后续不考虑 0.1.2 兼容，peer 范围随之收窄为单家族，再留一条 legacy 通道就是**验证一个我们不支持的家族**。
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

## 6. 维护本文件

- 每次发布：在 §1 增加一行（插件版本 × 宿主家族 × 状态），并把窗口收窄/放宽写清。
- 每次踩到上游变更：在 §2 加一行（日期 / 变化 / 症状 / 处置 / 现在被什么挡住）。
- 表格里的"现在被什么挡住"必须是**已存在的自动化**，不能是"下次注意"；**若确实没有自动化，
  就如实写「目前无自动闸门」并说明人工比对方式**（例：§2 的 rc.2 槽位重排一行）——
  把「无守卫」写成「有守卫」比不写更危险。
- §1 的「状态」列今后按**运行时证据**填写，不按 peer 声明填写（§1 表下的注记）。
