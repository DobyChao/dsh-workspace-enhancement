# R22 — AUDIT-6 实施：远程会话审批门 + AI answerer + 诚实化文案（ADR-0020 落地）

- 日期：2026-09-12
- 分支：`feat/audit-6-remote-approval-gate`（基于 R21 的两个 docs 提交；diff/评审基线是
  `feat/req-i7-side-workspace-simplify`，不是 master）
- 产出：ADR-0020 全量实现（七决策 D1–D7）——接缝审批门、AI answerer、逐机器三态配置面、
  诚实化文案；`docs/uat/R22-audit6-remote-approval-gate.md` 验收脚本
- backlog：AUDIT-6 → `done`（代码与文档齐；真机 UAT 按 `docs/uat/` 脚本由用户执行）

## 1. 实现方式（按 ADR-0020 §3 轮廓逐行）

| 轮廓 # | 落点 | 实际实现 |
|---|---|---|
| 1 | `src/remote-approval-gate.ts`（新，纯逻辑） | shell 形状判定（`isRemoteShellShape`：basename ∈ {bash,sh,zsh,dash,pwsh,powershell} + `-c`/`-Command`/POSIX 组合短旗标 `-[…]c`；`.exe` 剥除、大小写归一）；reason 标记 `[dsw-remote-gate] machine=<id> target=<u>@<h> cmd=<预览>`（严格可逆解析 `parseGateReason`；预览 160 字符截断且截断预览永不自动放行）；结局→错误映射（六条两两可区分英文文案 `GATE_ERRORS`，ADR-0014 英文常量不进词典）；白名单规则表 `REMOTE_COMMAND_WHITELIST`（独立可评审常量）+ 匹配器；asker `askRemoteApproval`（降级阶梯 fail-closed）与 answerer `createRemoteApprovalAnswerer`（全量 catch、异常一律 `next()`）；`remoteApprovalDepsOf(ctx)` 用 `ctx.get(name, false)` 运行时判空拼 deps |
| 2/3 | `src/subprocess.ts` / `src/process.ts` | `SshSubprocessEngine` 收可选 `gate`：`spawn` 把问询塞进 `SshSubprocessHandle` 构造器注入的 `preflight`（`run()` 之首、任何 SSH 字节之前——先于 `buildCommand`/`getClient`），同步契约不动（句柄立即返回，拒绝走 `done` reject）；`spawnTerminal` 异步签名前置 `await runGate(..., terminal: true)`（终端恒拦，D1） |
| 4 | `src/plugin.ts` | 聚合行装配：`installMixedProviders` 与纯 SSH 兜底（`ctx.plugin(SshSubprocessRuntime, gate)`）都传入 `createRemoteSpawnGate(ctx)`；AI answerer `registerRemoteApprovalAnswerer`（`ctx.effect(() => ctx.on('approval/request', h, { prepend: true }))`，挂载可逆） |
| 5 | `src/registry.ts` + `src/web.ts` + `src/connection.ts` + 客户端 | `remoteApproval?: 'off'\|'human'\|'ai'` 单字段贯穿：`SshConnectionSpec`（machines.json）→ `normalizeMachine`（缺/非法 ⇒ `'off'`，且 `'off'` 不落盘字段——零迁移）→ `MachineInput`/`MachineView`（视图恒带归一化值）→ `saveMachine` upsert 语义（省略=保留、显式 `'off'`=清除）→ `machines.add` payload 白名单（`isMachineInput`）→ 设置页机器行「🛡 审批」徽标 + 表单高级区三向下拉（编辑时非 `'off'` 自动展开高级区）→ `machinePayload` 恒带显式值 |
| 6 | `src/model-prompts.ts` + `src/tools.ts` | `remoteNoSandbox`（远程主工作区会话恒注入）与 `remoteGateActive`（机器开门时注入）两句英文常量接进 `sw-remote` 段 `composeWorkspacePrompt`（机器查表复用既有 route→registry 路径；`PromptMachineFace` 加可选字段，缺省视为 `'off'`） |
| 7 | `src/locale/dsw.ts` + `dsw.en.ts` | zh 真源 + en 同键各 6 键：表单标签/三态选项/提示句 + 机器行徽标（`form.label.remoteApproval`、`form.remoteApproval.off|human|ai|hint`、`settings.machines.gateBadge`，模板参数 `{mode}` zh/en 一致） |
| 8 | README / README.zh / SECURITY | 功能表一行 + 设计要点「远程审批门」段（en/zh 结构同构，check:static 校验 8=8 标题）；SECURITY 已知边界补 D1 不覆盖四条（SFTP 写路径、固定探针、临时连接、非壳形状）+ UX-1 正典指引 |
| 9 | `docs/uat/R22-audit6-remote-approval-gate.md` | ADR 附录 A 十场景 + A-11 提示段核对，共 11 项，含环境指纹与清理清单 |
| 11 | 测试 | `test/remote-approval-gate.test.ts`（26 用例）+ `test/side-prompt.test.ts`（提示段三态注入） |

**实施偏离（两处，均已在 ADR-0020 范围行与 CHANGELOG 记录）**：

1. **devDependency 偏离（轮廓 #10）**：`@deepseek-ai/dsh-user-approval` 未加进
   devDependencies。理由：文件沙箱禁 `npm install`；本仓库 lockfile 里该包只作为 rc.2 部署包的
   peer 要求出现（`package-lock.json:443`），`packages` 映射**没有**它的条目、node_modules 也没装——
   只加 package.json 列必然令 `npm ci` 失步（lockfile 与 package.json 不同步即 hard fail）。替代：
   `remote-approval-gate.ts` 内联**结构化最小面**（`RemoteApprovalServiceFace` 等），与
   0.1.5-rc.1/rc.2 磁盘 `lib/types/*.d.ts` **逐字节核对一致**（rc.1 与 rc.2 的
   `dsh-user-approval/lib/types/types.d.ts` 内容完全相同——本轮复核）；运行时消费本就是 ADR 规定的
   `ctx.get('approval')` 字符串名。另在模块尾对本包不依赖的 `approval/request` 事件做**宽松本地声明**
   （`declare module '@deepseek-ai/cordis'`，仅本仓库类型检查用；宿主真实增强更宽，不冲突——该包
   类型从不进入本仓库编译）。
2. **元字符守卫补 `\n`/`\r`（D4 名单微扩）**：ADR D4 列的守卫集是 ``` ; | & ( ) ` > < $ ```；
   换行/回车与 `;` 同为命令分隔符，一并拒绝（安全向收紧，测试覆盖 `bash -c echo hi\ncurl evil`）。

**接手审查发现并修复（上一任半成品中的两处缺陷）**：

- `SshSubprocessRuntime` 的类注释宣称「every deployment form fences … uniformly」，但裸挂载
  （subpath 行 `dsh-workspace-enhancement/subprocess`）时构造器不传 gate——声明与事实不符。修复：
  构造器 `gate ?? createRemoteSpawnGate(ctx)` 默认挂门（新增测试证明裸挂载仍拦 gated 机器）；
  注释同步改为如实分层（问询门全部署形态统一；**AI 自动放权 answerer 是聚合行特性**，subpath
  部署问询后落到人类 answerer，fail-closed，只是不自动放行）。
- `src/web.ts` `isMachineInput` 的文档注释与函数声明被挤在同一行（`*/function`，HEAD 即如此），
  顺手修复排版；无行为变化。

## 2. 白名单终稿（D4「实施轮定稿」）

放行面（全部**只读/打印**单命令；先过「单命令且无元字符（含换行）」守卫，再按 token 匹配）：

| 程序 | 放行参数 | 说明 |
|---|---|---|
| `pwd` / `whoami` | 无参 | |
| `uname` | 仅 dash 旗标（`-a`、`--all`…） | |
| `ls` `cat` `head` `tail` `wc` | 任意 | 只读/计数 |
| `echo` | 任意 | 仅打印（元字符守卫已排除 `$(…)`/反引号/重定向） |
| `git status` / `git log` / `git diff` / `git show` | 子命令在 argv[1]，其后任意 | 全局 git 旗标（`git -c …`）**不放行**（`git -c core.pager=sh …` 可执行任意命令） |
| `node -v` / `node --version` | 精确版本旗标 | `node -e` 到人 |
| `rg --version` / `rg -V` | 精确版本旗标 | `rg` 本体**不放行**：`--pre` 可执行命令 |

永不放行：截断预览（不可见尾部）、任何元字符、终端形状（无 `-c` payload）、`git -c`、
`node -e`、`rg --pre`、名单外一切（`touch`/`rm`/…）。**名单外≠拒绝，= 交给人类**。

## 3. 验证方式与证据

| 项 | 命令 | 结果 |
|---|---|---|
| 静态闸门 | `npm run check:static` | ALL PASS（词典 zh=en=331 键、模板参数一致、peer 家族、提交信息格式） |
| 类型 | `npm run typecheck` | 0 错误 |
| 单测（沙箱内） | `npm run test:agent` | 267 用例：265 通过 + 2 例沙箱受限（`mixed-routing` 的 process-level spawn EPERM 与 `SetFileSecurityW` EACCES，AGENTS §4 已分类；`test:agent` 判 SANDBOX-LIMITED PASS，权威判定 CI `npm test`） |
| 构建 | `npm run build` | host + client 半完成；闸门无 lib 漂移 WARN |
| 真 boot 哨兵 | `npm run build` 后 `node scripts/boot-smoke.mjs --no-channel` | SMOKE PASS：host 存活 / `GET /?token` 303 / `GET /` 200；（`--no-channel` 按任务白名单） |

单测覆盖映射（backlog 验收标准逐条）：

- **门行为（假 approval 服务）**：allowed-once 放行；`rejected`/`cancelled`/`unavailable`/越界值
  四结局各自可区分文案（`texts.size === 4` 断言）；`never` 策略确定性拒绝且门**不特判**（fake 直接
  前置返回 rejected，与上游 `lib/index.js:178` 语义一致）；覆盖判定（off 机器/未知机器/无
  connectionId/非壳形状零问询）。
- **降级阶梯**：无 approval 服务 / 无 agent / `request()` 抛错，三条独立文案。
- **AI answerer**：只答带标记 ask 且机器 `'ai'` 且白名单命中；无标记/human 机器/未知机器一律
  `next()` 恰一次；分类器异常（deps 抛错）→ `next()` 且 warn、绝不放行绝不 throw；链条后续抛错
  原样透传不吞（上游容器化语义保持）。
- **生命周期**：`ctx.on` disposer 卸载后重挂不抛 already registered；双重注册亦然（事件注册
  fiber-scoped，无占位冲突）。
- **引擎/门面**：拒绝在**任何 SSH 活动之前**（哨兵 transport：`getRemoteEnvironment` 未达即
  done reject）；allowed-once 后才走到哨兵（次序证明）；spawnTerminal 先门后终端；混合门面本地
  分支零问询；`sw_exec` 的 `buildShellArgv` 产物形状=门覆盖形状（两种 OS）。
- **配置面**：`normalizeMachine` 缺字段 ⇒ `'off'`（读盘验证 `'off'` 不落字段）；upsert 省略保留 /
  显式 `'off'` 清除；`machinePayload` 恒带显式值。
- **subpath 裸挂载**：`new SshSubprocessRuntime(ctx)`（不传 gate）默认挂门（本轮修复项）。
- **提示段**：`remoteNoSandbox` 恒注入远程会话；`remoteGateActive` 恰在机器开门时注入
  （off/human/ai/缺省四态）。

## 4. 证据与已知环境事实

- 上游契约复核（磁盘权威源，未用 cordis_inspect_*）：`dsh-user-approval/lib/types/{index,types}.d.ts`
  （全局安装 rc.1 与 `.dsh-lab` rc2-cli 各一份，`types.d.ts` 逐字节相同）；`cordis/lib/types/`
  的 `get(name, strict?)`、`provide`、`on(name, listener, EventOptions{prepend})`、
  `effect(fn, label?)`、`plugin(Class, ...args)` 全部与实现用法吻合。
- **boot-smoke 环境事实（如实记录）**：本沙箱里脚本内置的 `taskkill /T /F` 清理杀不死 host 子树
  （SMOKE PASS 后宿主进程残留，需操作者手动 `Stop-Process`；两次运行复现，判定不受影响——四条
  断言已全过，host 存活断言之后手动确认进程已死）。前一次前台直跑在 200s 工具超时处被杀（输出
  缓冲丢失），改后台运行 + `job_output` 读取即正常——这是运行方式问题，不是脚本问题。
- UAT 十一场景（`docs/uat/R22-audit6-remote-approval-gate.md`）：待用户在 lab（50599）执行；
  ADR-0020 §6 的四条未验证假设对应 A-3/A-4/A-6/A-9 场景。

## 5. 影响面与遗留

- 默认 `'off'` ⇒ 升级零行为变化；门关闭时 AI answerer 对一切请求 `next()`，其它工具审批流零影响
  （unmarked 委派测试为证）。
- 已知边界不收口（D1 诚实清单）：SFTP 写路径（写脚本+`bash script.sh` 组合绕过）、固定探针、
  `sw_connect save:false` 临时连接、非壳形状 spawn——结构性答案在 REQ-I9（远端 bwrap runner）。
- UX-1 `remote-full` 预设片段正典仍在 ADR-0015（README/SECURITY 只放指引）。
- PR/push/CI 由主代理统一执行（本轮不 push）；lab UAT 与 e2e 手动轮待排。
