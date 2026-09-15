# ADR-0022: 远端沙箱围栏（bwrap 兼容 runner over SSH）

- 状态: accepted
- 日期: 2026-09-13
- 范围: `src/remote-sandbox.ts`（新：纯逻辑）、`src/process.ts`（`SshSubprocessHandle` 启动序列加 argv 阶段）、
  `src/subprocess.ts`（可选围栏依赖）、`src/plugin.ts`（构建并注入围栏）、`src/registry.ts` / `src/web.ts` /
  `src/client/machine-form.tsx`（逐机器 `remoteSandbox`）、`src/locale/`、`src/exec-tools.ts`（可选：拒写标记）、
  `docs/uat/R24-req-i9-remote-runner.md`
- 关联: 实现 **REQ-I9**；与 **ADR-0020**（审批门）分层——审批是「要不要跑」，围栏是「跑起来也出不去」；
  收窄 **ADR-0021 §2.7** 的边界（执行面获得真围栏，fs 面仍没有）；上游沙箱栈事实见
  `docs/rounds/` 与本 ADR §1（`dsh-sandbox` 的 same-world 契约：远端 executor 应替换接缝，而非加后端）

## 0. 结论

给「远程 world 的 spawn」加一层**逐机器的、fail-closed 的 bwrap 围栏**：`SshSubprocessHandle` 在
**approval preflight 之后、命令序列化之前**多一个 argv 阶段，把原始命令包成
`<runner> <bwrap profile args> -- <original argv>`。围栏不可用 ⇒ 抛 `SANDBOX_UNAVAILABLE`，**命令一个字节都不发**。
默认 `off`（零迁移、与今天逐字节相同）。**fs/SFTP 写面不在围栏内**（bwrap 只围进程；收口见 `ADR-0023`）。

## 1. 上游事实（侦察 A3，磁盘权威源 `…\dsh\…\@deepseek-ai\*`，0.1.5-rc.2）

- 契约：`@deepseek-ai/dsh-sandbox` 的 `SandboxProvider.confine(argv, policy): ConfinedArgv`，
  **argv[0] 就是 runner**；`SandboxPolicy.mode` 在类型层排除 `danger-full-access`。
- 本地 provider `@deepseek-ai/dsh-sandbox-local`：设了 `runnerCommand` ⇒
  `[...runnerCommand, ...bwrapProfileArgs(policy), '--', ...argv]`（断言 enforcement=full，**不探测、不选链**）；
  否则走 `PLATFORM_CHAINS`（linux: bwrap → landlock）。
- README 的「bwrap 兼容」属实：profile = `--ro-bind / / --dev /dev --unshare-pid --proc /proc --die-with-parent`，
  workspace-write 追加 `--tmpfs /tmp` 与 `--bind <ws> <ws>`；没有 `--unshare-net` / `--clearenv` / `--chdir` /
  `--new-session`。功能探针 `defaultProbeBwrap` = 用只读 profile 包 `true`，`status === 0`。
- **`bwrapProfileArgs` 没有导出**，`dsh-sandbox-local` 也不是本仓库依赖（lockfile 无条目）⇒ 不能 import，
  本地重写这 ~10 个 token，并用「部署包存在时读它、比对 argv 向量」的**漂移测试**钉住（CI 上不存在则跳过）。
- **`runnerCommand` 不是本特性的杠杆**：它是本地 `ctx.sandbox` 单例上的**逐 provider** 设置，把它指向远端 runner
  会把**本地**命令也发去远端，且按设计跳过探测。远端围栏必须长在本插件的远程分支里。
- **SSH 没有 argv 通道**：`src/process.ts` 把 argv 序列化成
  `cd -- '<cwd>' && exec env -i -- <env> <quoteShellArg(argv)…>`（红线 6 的引号转义已具备）⇒ 包装必须发生在
  **序列化之前**，`ssh <host> <argv…>` 不是保 argv 的传输。

## 2. 决定

1. **逐机器轴 `remoteSandbox: 'off' | 'read-only' | 'workspace-write'`**（默认 `off`，缺字段=off，零迁移），
   进 `SshConnectionSpec` / `MachineInput` / `MachineView` / `machines.add` 白名单 / 设置页表单 / 徽标 / 词典。
   它**不是** `ctx.sandboxPolicy` 的镜像：远程会话的 sandbox 模式被 `forceRemoteSandboxMode` 钉成
   `danger-full-access`（那样 `bash-sandbox` 才不会把**本地** runner 塞进远端命令），所以远程档位必须自成一轴。
2. **围栏点 = `SshSubprocessHandle.run()` 的启动序列**（`src/process.ts`）：把现有 `preflight?` 推广为有序启动段，
   新增 `resolveArgv?: (argv) => Promise<argv>`，在 `await preflight()` **之后**、`buildCommand(...)` **之前**调用。
   **禁止**在 `MixedSubprocessRuntime.spawn` 里包装：那样审批门看到的 argv[0] 会变成 `bwrap`，
   `isRemoteShellShape()` 判定失败 ⇒ **AUDIT-6 的门会对所有远程命令静默失效**（侦察 A3 明确标出的陷阱）。
   审批门继续拿**未包装**的 argv（弹窗预览仍是用户写的原始命令）。
3. **fail-closed，且必须是「正向功能探针」**：远端缺 `bwrap` 时报的是
   `env: 'bwrap': No such file or directory`（exit 127），**不匹配**上游 `RUNNER_FAILURE_RULES` 的 `'bwrap: '` 特征，
   所以不能靠 stderr 匹配判定。探针 = `command -v bwrap` + `bwrap --version` + 用**只读 profile 包 `true`** 并
   要求 exit 0（经控制通道 `connection.exec`，仿 `resolveRemoteOs`/`createRemoteOsCache` 的按连接缓存）。
   探针不过 ⇒ `SANDBOX_UNAVAILABLE`，**拒绝执行**；绝不裸跑、绝不静默降级。
   **exit 0 是唯一的成功信号**：非 0、垃圾输出、`exitCode === null` 一律判失败并带非空 detail。
   **实现偏离（本轮记录）**：侦察建议把 profile 向量包成一个预引号字符串，实现改为**按 argv 词逐个拼**——
   因为 runner 路径可能含空格；功能检查完全等价（真只读 profile 包 `true`、要求 exit 0），
   且 runner 路径的四次出现都过 `quoteShellArg`（红线 6；三次在探测门上、一次是功能步的 argv[0]），
   裸词表是固定的 operator 词汇（有 `;`/`&&`/内嵌引号的注入用例钉住）。
   `remoteRunnerArgv` 的返回值**永远不得直接交给 shell**，必须在接缝的序列化处统一引用。
   **首版实现把这个方向做反了**（GLM-5.3 评审 blocker，2026-09-13）：它先把向量 `join(' ')` 再整体引号，
   于是引号移除后只剩**一个词**——远端 shell 会去找一个名字里带空格的「程序」，在任何主机上都 exit 127；
   而「非 0 = runner 不可用」的 fail-closed 会把这条错误变成**每台机器永远拒绝所有命令**。
   测试当时还把错误形状钉住并配了「引号移除得到 runner argv」的错误注释，所以套件全绿。
   现在测试把功能步**反向 token 化成 12 个 argv 词**并断言「拼接成串」的形态不存在——这才是会红的断言。
4. **v1 范围**：只围 `spawn`（模型发起的命令）。**`spawnTerminal` 在 `remoteSandbox ≠ off` 时拒绝**并给出明确错误
   （交互终端 + `--dev` 下 `/dev/tty`、`--new-session` 语义未验证，宁可诚实地不给，也不开一个没围栏的终端）。
5. **档位语义**：`off` = 今天逐字节相同；`read-only` = 只读 profile；`workspace-write` = 只读 + `--tmpfs /tmp` +
   `--bind <远端工作区> <远端工作区>`。工作区根取该次 spawn 的远端 cwd（与 `sw_exec` 的 workdir 语义一致）。
6. **探针时机**：按连接身份缓存（连接重建即失效），**首条命令前**完成；探针失败 ⇒ 该连接上的围栏命令全部 fail-closed。
   探针结论可在 `sw_status` 里如实报告（v1 允许仅内存缓存）。
7. **如实记录两条边界**（文档与提示词都要写）：
   ① **fs 写面（SFTP）不在围栏内**——它走宿主进程的 SFTP 通道，不经远端进程，bwrap 围不住；远端写面的强制层
   只有远端 OS 权限（低权用户/容器）或未来由核心接管的远端 fs RPC（REQ-I5 / `ADR-0023`：读写纳入核心后，此边界消失）；
   ② 围栏只覆盖**经 spawn 的命令**，同 ADR-0021 §2.7。
8. **与审批门的关系**：审批门保持现状（未包装 argv、逐机器三态）；围栏是它**之后**的第二道。两者都能拒绝，
   互不替代：`remoteApproval` 决定「要不要跑」，`remoteSandbox` 决定「跑起来能不能越界」。
9. **模式语义不共用控件**（A3 未知 #9）：~~会话的 `/permission` 只影响本地世界；`remoteSandbox` 是机器级轴。~~
   **被 ADR-0025 取代**：远端权限与本地一样走会话 `/permission` + 官方提权；机器
   `remoteSandbox` 不再当权限轴。本条只保留历史：当初钉 `danger-full-access` 是为了
   不让本机 runner 进入远端 argv，现改为远程 cwd 上 `confine` 短路。

## 3. 代价与风险

- **漂移风险**：本地重写的 profile 向量与上游 `dsh-sandbox-local` 可能分叉 ⇒ 漂移测试在部署包存在时必须跑；
  上游改 profile 时 CI（`upstream.yml` 通道）会红在正确的地方。
  **诚实标注该漂移测试的强度**：它是**正则匹配部署产物**（不 eval、不 import，沙箱内安全），
  函数改名会立刻红，但一次「足够刁钻的重写」理论上可以绕过分支体正则——所以它是**哨兵**，不是证明；
  上游真改语义时仍以 `upstream.yml` 通道 + 人工比对为准。
  另：部署包两个候选路径都存在的机器上跑的是 lab 副本分支；两者都不存在时走**显式 skip**（用带
  `{ skip: … }` 的选项对象而非 `.skip(`，以免静态闸门把文件当空测试），并另有一条无条件用例保证该文件
  在 CI 上不是 no-op。
- **可行性未知（决定 REQ-I9 能否成立）**：目标机上 `bwrap` 能否以**登录用户**通过功能探针
  （`kernel.unprivileged_userns_clone=0`、seccomp/AppArmor 挡 `CLONE_NEWUSER`、无 setuid 的 bwrap 都会失败）。
  这个「否」会让 REQ-I9 在该类主机上退化为 ADR-0020 路线 A（审批）+ 路线 C（低权用户）。必须在 lab 用真 Linux 远端
  先验这一条，再谈实现收口。
- **信号与孤儿进程**：`channel.signal()` 在非 PTY exec 上历史上是 no-op（OpenSSH bug 1424），sshd 会孤儿化非 PTY
  会话进程（bug 396），`--die-with-parent` 的实际行为需 lab 实测；`terminate()` 可能无效 ⇒ 在 UAT 里如实记录，
  必要时后续加显式远端 kill。
- **工作区路径形态**：`--bind <ws> <ws>` 要求源存在；symlink / bind mount / NFS 上的工作区可能拒绝挂载
  ⇒ workspace-write 在那种主机上不可用（探针只证明只读档可用，工作区档需单独验）。

## 4. 验收

以 lab（`C:\Users\Admin\.dsh-lab`，端口 50599，一台真 Linux 远端）为准，落
`docs/uat/R24-req-i9-remote-runner.md`；实现侧先跑 `check:static` / `typecheck` / `test:agent` / `build` /
`boot-smoke --no-channel`。关键场景（完整表在侦察报告 `.tmp/recon/A3-remote-runner.md` §Q5）：

| # | 断言 |
|---|---|
| I9-1 | `read-only` 下 `echo hi > /tmp/x` 被拒（`read-only file system`），且文件**确实不存在** |
| I9-2 | `read-only` 下普通读（`cat /etc/hostname`）正常 —— 围栏不能把正常工作打死 |
| I9-3 | `workspace-write` 下工作区内写成功，并经 **fs 工具**读回（两条接缝一致） |
| I9-4 | `workspace-write` 下工作区外写被拒 |
| I9-5 | **fail-closed**：远端移除 `bwrap` 后执行 `touch /tmp/i9-ran` ⇒ 调用以 `SANDBOX_UNAVAILABLE` 失败，且**该文件不存在**（证明命令从未执行——本套最强断言） |
| I9-6 | `bwrap` 存在但功能探针不过（容器禁 userns）⇒ 同样 `SANDBOX_UNAVAILABLE`，零执行 |
| I9-7 | `off`（以及所有既有机器）⇒ 与今天逐字节相同：不包装、不探测、无新提示 |
| I9-8 | 审批门 + 围栏同时开：审批卡片预览显示**原始命令**；放行后围栏仍拒绝越界写 |
| I9-9 | **诚实边界**：围栏开着时，经 fs 工具在工作区外写**仍然成功**（SFTP 不受围栏）——断言并文档化，不粉饰 |
| I9-10 | 无双重包装：远程命令里只有一个 runner，本地 bwrap/landlock argv 绝不出现 |
| I9-11 | 本地回归：本地会话沙箱行为不变；`npm run check` + `boot-smoke --no-channel` 全绿 |
