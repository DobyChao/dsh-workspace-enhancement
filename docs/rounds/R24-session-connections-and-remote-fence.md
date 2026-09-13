# R24 — 会话级机器连接（REQ-I11，吸收 SEC-5）+ 远端沙箱围栏（REQ-I9）

- **日期**：2026-09-13
- **分支**：`feat/REQ-I11-machine-connect`（栈在 `chore/backlog-tidy` 之上；**只落本地，未推 PR**——用户「不急交」）
- **提交范围**：`cb622d3` … `d458462`（本轮 20 个提交）
- **评审**：GLM-5.3（`zai-coding-cn/glm-5.3`，effort high），报告 `.tmp/review/GLM-5.3-req-i11-i9.md` + 复审 `GLM-5.3-recheck.md`
- **需求**：`docs/decisions/ADR-0021-session-machine-connections.md`（accepted）、`ADR-0022-remote-sandbox-runner.md`（accepted）

## 1. 本轮目标与结果

| 项 | 目标 | 结果 |
|---|---|---|
| REQ-I11 | `sw_connect` 重塑为**会话级机器连接开关** + 远程工具门控 | ✅ 代码完成（含客户端半） |
| SEC-5 | `password` 作为模型工具参数入会话日志（红线 1） | ✅ **由结构消除**（参数面只剩 `machines: string[]`），非守卫修补 |
| REQ-I9 | 远端 bwrap 兼容 runner：侦察 + 原型 | ✅ 代码完成；**真机可行性未验**（见 §7） |

## 2. 侦察（三份报告，全部磁盘权威源）

- **A1 工具注册粒度**（`.tmp/recon/A1-tool-registration-scope.md`）：per-session 可见性确实存在（`restrict` / preset scope），但需要会话的 `agent.ctx`，宿主组合行拿不到（未验证钩子）⇒ 采用**执行侧门**；附带两条平台事实：**模型侧参数 schema 每 assembly 重读**（本仓库早已依赖它做 i18n）、**重复注册同步抛错、dispose-再注册是官方模式**（MCP 同款）。
- **A3 远端 runner**（`A3-remote-runner.md`）：本地 runner 契约、bwrap profile 向量、**`bwrapProfileArgs` 未导出且包不是依赖** ⇒ 本地重写 + 漂移测试；**陷阱**：若在 `MixedSubprocessRuntime.spawn` 包装，审批门看到的 `argv[0]` 会变成 `bwrap`、shell 形状判定失效 ⇒ 门对所有远程命令静默失效；远端缺 bwrap 报 `env: …`、**不匹配**上游失败特征 ⇒ fail-closed 必须靠**正向功能探针**。
- **A2 中插 API**：子代理跑了 1.5 小时无结论，被我中断并**自己从类型定义回答**：`SystemPrompt` 只有 `section()`/`context()`，没有历史中插；但 `context()` 的契约是「materialized as a **durable user-role snapshot**」⇒ 易变状态（已连接机器 + 副根）改走它，稳定框架留 section（ADR-0021 §2.8）。

## 3. 实现（四个切片 + 整合）

| 切片 | 内容 | 提交 |
|---|---|---|
| fs 路由 | 任何 `ssh://<id>/…`（及占位树）自行指名远程世界，无需先声明副根 | `cb622d3` |
| 连接存储 | `SessionMachineConnections`（只存 id 引用；`retain` 清理被删机器） | `a22ad40` |
| 宿主半 | `sw_connect(machines[])` 替换语义 + 逐台有界 ping + 全不可达原子失败；`sw_exec` 会话门（含 `ssh://` workdir 绕过口）；`session.conn.*` 四端点；提示两段分工 | `33f8496` |
| 客户端半 | 面板 → 会话工作区驾驶舱（主工作区/副根/已连机器），纯逻辑 `cockpit.ts` + 14 例 | `5d455e5`、`ec63985` |
| REQ-I9 纯逻辑 | `src/remote-sandbox.ts`（档位、profile 向量、正向探针、失败方言）+ 漂移测试 | `33f8496`、`340269b` |
| REQ-I9 接线 | `process.ts` 的 `resolveArgv` 阶段、引擎围栏、终端拒绝、逐机器 `remoteSandbox` 三态 | `b335e10` |
| fail-closed 收口 | 安装失败兜底用**拒用围栏** + 地雷守卫；**任何挂载形态**都围栏（引擎从 ctx 惰性解析） | `73cbbbd`、`1c5c616` |
| 整合 | `machines.remove` → `retain`；win32 `bash` 接缝补门；提示词加围栏句；SECURITY.md 两条绕过；ADR 校正三处「注释比代码勇敢」 | `2df9dbe`、`87a09f1`、`96667e3`、`9939842`、`cb89adc` |

## 4. 评审：GLM-5.3 抓到了一个「套件全绿但功能必死」的 blocker

首轮 `needs_revision`（**1 blocker + 3 major + 5 minor/nit**），报告 `.tmp/review/GLM-5.3-req-i11-i9.md`：

1. **blocker** — 探针的功能步把 runner argv **先 `join(' ')` 再整体引号**，引号移除后只剩**一个词**：远端 shell 去找一个名字里带空格的「程序」，任何主机都 exit 127；而「非 0 = runner 不可用」的 fail-closed 把它变成**每台机器永远拒绝所有命令**。方向是安全的，但功能**出生即死**，lab I9-2（普通读必须工作）不可能通过。**修复** `ff0f43a`：`map(quoteShellArg).join(' ')`。
   **为什么套件没拦住**：所有围栏测试都**注入**探针结论；而探针测试还把错误形状钉住并配了一句错注释「引号移除得到 runner argv」。现在测试把功能步**反向 token 化成 12 个 argv 词**，并断言「拼接成串」的形态不存在——这才是会红的断言。
2. **major** — ADR-0022 §2.3 记的形态与代码相反（已随修复对齐，并把该 blocker 的失败模式写进 ADR，防止有人把它「简化」回去）。
3. **major** — 测试钉住错误形状 + 缺「12 词」用例（同 1 一并修复）。
4. **major** — **我们自己的 win32 `bash` 接缝未设门**，而 SECURITY.md 只把绕过归给**官方**工具 ⇒ 已补 `requireConnectedServer`（`87a09f1`，含「拒绝时不得 spawn」「隐式主机器仍可跑」两条断言）。
5. 5 条 minor/nit：`side.conn.hint` 暗示连接决定 fs 可达（实为注册表级）、`tool.common.noActive` 仍写「call sw_connect with a host」（已不可能）、两处临时 id 旧注释、`retain` 声称的启动清理不存在、死导出。**已全部修**（`75153bc`）；死导出登记为 `REQ-I12`。

**复审**：`.tmp/review/GLM-5.3-recheck.md` —— **`VERDICT: pass`**。逐条确认：blocker 已修（12 词 token 化 + 「拼接成串」负向断言，revert 会触发三道独立 tripwire）、ADR 与代码一致且记录了失败模式、win32 门找不到绕过（相位/拼写/相对 workdir/隐式主机器/`off` 机器全部走查）、四条 minor 文案均已成真。**未修但已处置**：minor #9（`remove→retain` 仅有源码正则守卫——被调用的 dispatch 闭包不可导出，且属既有做法，低于修订门槛）、nit #10（死导出 → 登记 `REQ-I12`）。**复审新增 nit**：win32 `bash` 的拒绝复用了 `sw_exec` 的错误键，工具名张冠李戴（内容诚实、处置相同），已并入 `REQ-I12`。
复审在沙箱内自跑闸门：`check:static` ALL PASS、`typecheck` 干净、`test:agent` 420/419/1（那 1 例是 `spawn EPERM`，运行器自判 `SANDBOX-LIMITED PASS`）⇒ **零真实失败**。

## 5. 证据

- `npm run check:static` → ALL PASS（词典 zh=en=357；公开面无密钥；backlog 67 行 0 malformed）
- `npm run typecheck` → exit 0
- `npm run test:agent` → **420 例 / 418 通过 / 2 例沙箱受限**（`spawn EPERM`、`SetFileSecurityW`），**零真实失败**
- `npm run build` → 干净（`lib/client.js` 含 cockpit 与两端点字符串）
- `node scripts/boot-smoke.mjs --no-channel` → **SMOKE PASS**（宿主启动、进程存活、`GET /` 200）；**同时复现 INFRA-12**：PASS 后进程不自行退出。已按边界清理（只删 `dsh-boot-smoke-*`、保留父目录）
- 未跑：`npm test`（沙箱禁管道）、`npm run e2e`（需本地 shell）、Linux 复验（改动含 POSIX profile 向量与远端路径 ⇒ **push 前必须** `wsl -e bash -lc "bash /mnt/d/…/scripts/verify-linux.sh"`）

## 6. 教训（写给下一轮）

1. **「注入式测试」会掩盖生产路径的死**：围栏的 30+ 用例全绿，而真实探针命令在任何主机上都跑不通。**凡是把外部结果注入的测试，都要另有一条把真实构造物 token 化/解析回来的用例**。
2. **注释比代码勇敢**：本轮出现三处（探针的「引号移除得到 argv」、`plugin.ts` 的「refuses every ssh:// route」、`retain` 的「at startup」）。评审前自纠两处；**改注释与改代码同权**。
3. **两个代理共用一棵工作树**：期间出现过「所有改动看似消失」的瞬时窗口（一方在跑改工作树的 git 命令）。已明确禁止 `stash/checkout/restore/reset/clean`，并在 git 之外留 WIP 快照兜底；**绝不裸跑 `git commit`**（会把别的代理已 stage 的改动卷进文档提交）。
4. **自己人写的门也要算进门**：评审发现 win32 `bash` 接缝未设门，而文档只把绕过归给官方工具——「不是我们写的」不成立时就该补上。

## 7. 未完成 / 待用户（真机项，缺一不可）

1. `docs/uat/R24-req-i11-session-connections.md`（15 步）：连接/断开随动、**第 14 步验证「中插」真的在会话中途生效**、第 15 步**断言** exec 粗门可经官方 `bash` + `ssh://` workdir 绕过（预期行为，需确认文档已如实写明）。
2. `docs/uat/R24-req-i9-remote-runner.md`（11 步 + G1–G3 门）：**G1 远端 bwrap 能否以 SSH 登录用户通过只读功能探针**（为否则本项在该主机类不成立，退化为审批门 + 低权用户）、G2 `--bind` 对 symlink/bind/NFS 工作区、I9-5（移除 bwrap 后必须证明命令**从未执行**）、I9-9（断言 fs/SFTP 洞仍存在，不粉饰）。
3. **AUDIT-6 的尾巴**（e2e + 其 UAT）按用户拍板**延后到本轮之后统一审视**——它仍未完成，且 `e2e/` 对审批门零覆盖。
4. 未推 PR：按用户「不急交」，分支与 `chore/backlog-tidy` 都留在本地。
