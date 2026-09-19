# ADR-0023: 远端「一个核心」——执行围栏与远端读写共用一个可校验产物

- 状态: accepted
- 日期: 2026-09-13（同日补拍：远端**读写**纳入核心，不再当「完全体后置」）
- 范围: 产品方向与远面前置条件；载体是 `REQ-I5`（本 ADR 为其范围依据）。落地时会触及
  远程 `ctx.fs` 分支（`src/filesystem.ts` / `src/mixed.ts`）、远程 spawn 围栏
  （`src/remote-sandbox*.ts` / `src/process.ts`）、browse/picker 的 SFTP 列举与 mkdir
  （`src/listing.ts` / `src/picker.ts` / `src/web.ts`）、注册表健康面、`remoteEnvProbe`、
  模型面提示，以及**新增**的核心部署/校验/RPC 模块
- 关联: 承接 **REQ-I9** / **ADR-0022**（runner 契约保留；§2.7 的 SFTP 洞由本 ADR 收口）、
  **AUDIT-6**（无核心时退化为审批门 + 低权用户）、**ADR-0021 §2.7**（fs 可见性门仍在；
  强制层改由核心进程的沙箱 profile 承担）；收尾 `REQ-I12` ④

## 0. 结论

远端的**唯一人工前置**是「部署一个核心」。核心是一个**单一、可校验的产物**（静态二进制或单文件包，
带版本 + 校验和），由插件负责上传、校验、版本探测与升级；**不代跑包管理器、不需要 root**。

核心不是「把 `bwrap`/`rg`/`pwsh` 打进一个 tarball」。它是远端上**唯一被围栏的执行世界**：
模型发起的命令 **和** 官方 `read`/`write`/`edit`/`glob`/`grep` 的文件操作，都变成这个进程里的
syscall / 子进程。否则 ADR-0022 §2.7 / UAT I9-9 仍然成立——围栏开着，SFTP 照样能在工作区外写成功。

用户拍板：2026-09-13「最多装一个核心」；同日补拍「远端读写的范畴也纳入这个核心」，`REQ-I1` 往后排。

## 1. 背景：分项前置已经变成摩擦

- **要求分散且措辞过时**：同一条「远端需装 pwsh / ripgrep」写在 `SECURITY.md`、`docs/architecture.md`、
  `docs/testing.md`、`docs/ROADMAP.md`、`CHANGELOG.md` 五处；**模型面提示**（`src/model-prompts.ts` 的
  `envMissing`）甚至仍在教用户 `sudo apt-get install ripgrep`。REQ-I9 之后还要再加一项 `bwrap`。
- **每一项都在把宿主的工程问题推给用户**：`rg` 是官方 glob/search 在远端的事实依赖；`bwrap` 是围栏 runner；
  `pwsh` 是 Windows 目标的执行面。都不是用户「想装」的东西。
- **REQ-I9 证明接缝可替换**：包装点、正向探针、fail-closed 都已落地（ADR-0022）。真正的结构缺口是
  **SFTP 写面在 sshd 的 `sftp-server` 里、不在 bwrap 里**（UAT I9-9）。「纳入读写」= 远程 `ctx.fs`
  从 SFTP 客户端换成核心进程 RPC，而不是再后置一个完全体。

## 2. 决定

1. **产品目标 = C 路线（部署一个核心）**，`REQ-I5` 为其载体。**分项安装清单随之作废**。
2. **核心 = 同一套围栏里的执行世界 + 文件世界**（不再分「先 runner、fs 后置」）：
   1. **围栏执行器**——REQ-I9 的 argv 包装契约保留（`<runner> <profile> -- <argv>`、正向功能探针、
      `SANDBOX_UNAVAILABLE` fail-closed、审批门仍看未包装 argv）。实现可以是静态 `bwrap`，也可以是
      不依赖 userns 的自研实现。G1 从用户问题变成核心内部问题。
   2. **远端 fs RPC**——远程 `FileSystemBranch`（`resolve`/`stat`/`lstat`/`read*`/`listDir`/`writeText`/`editText`）
      与 browse 的 `list`/`mkdir` **不再走 SFTP**。文件操作为核心进程的 syscall，因此落在与 spawn 相同的
      mount namespace 里：`read-only` 下官方 `write`/`edit` 与 `echo hi > /tmp/x` 一样被拒；
      `workspace-write` 下工作区内写经 fs 工具与经 shell 一致。这是「纳入读写」的全部含义。
   3. **打包的 `rg`（或等价搜索）**——官方 glob/grep 今天是 **spawn `rg`**，不是 SFTP 遍历；
      `rg` 进核心后，搜索自动继承同一套围栏，用户不用预装。
3. **读面语义对齐本地沙箱，不另造「只能读工作区」**：上游只读 profile 是 `--ro-bind / /`
   （整机只读可见 + 工作区外写失败）。v1 核心 fs 读面同样如此——`read /etc/hostname` 仍然成功。
   若以后要「读也只限工作区」，那是新档位，不混进 v1。
4. **SFTP 只留给未围栏与引导**：`remoteSandbox: off`（默认）保持今天的 SFTP + 裸 spawn，零迁移。
   核心**首次上传**本身允许走 SFTP/`cat`（操作者动作，不是模型工具）。围栏一旦打开，模型面的
   fs/browse/mkdir 必须走核心；再留一条 SFTP 写路径 = 围栏是摆设。
5. **一个产物，可校验**：单一文件/工件，带**版本 + 校验和**；插件负责上传、校验、版本探测与升级。
   **不代跑包管理器**。默认部署到登录用户可写路径（如 `~/.dsh-core/`），**不需要 root**。
6. **形态（调研结论，落地时可细化协议，不可改「谁做 syscall」）**：
   宿主经 SSH exec 拉起一个长驻 `dsh-core serve`（stdin/stdout 成帧 RPC，或核心在 jail 内再听 Unix socket）。
   该进程**在对应 `remoteSandbox` profile 里启动**（或核心自己是 supervisor，子进程一律进同一 profile）。
   混合门面的远程分支从「SFTP 客户端」改成「这条 RPC 的客户端」；`spawn` 改为请核心在 jail 内起子进程
   （不再 `ssh exec` 一条裸命令再在远端包 bwrap——包装点仍在序列化前，但执行者是核心）。
   接缝方法集合以 `FileSystemBranch` 为准，外加 browse 的一层 listing / mkdir。
7. **v1 目标 = Linux 远端**（x86_64，aarch64 为明确的第二架构）。Windows 远端没有 bwrap 语义；
   `pwsh` 仍是「目标机上的 shell」，**不塞进 Linux 核心包**。无核心的 Windows 机器保持今天的 SFTP + 审批门，
   健康面如实说「无围栏核心」。
8. **退路如实**：核心跑不起来（架构不符、无 userns 且自研 runner 也失败、用户目录不可写、容器限制）⇒
   退化为「审批门（ADR-0020）+ 低权用户/容器」，**fs 与 spawn 一齐拒绝围栏档，绝不只拦命令、放开 SFTP**。
9. **与现有机制**：`remoteSandboxRunner` 死字段由核心路径取代，不再让用户填；`remoteEnvProbe` 从
   「缺 rg/pwsh/bash」改为「核心是否就位 / 版本 / 能力位（fs-rpc / runner / rg）」；
   审批门仍看未包装 argv。
10. **不做 / 已否**：
    - 远端通用包管理器、语言生态代理、把整个宿主 DSH 搬过去、需要 root 的系统级安装；
    - **FUSE**（常要 fuse 组/root，且把信任根换成内核模块）；
    - **改 sshd `ForceCommand` / 自带 sftp-server 进 bwrap**（要改 sshd_config，超出用户域）；
    - **SFTP 继续写 + 再派一个 helper 去围栏里写**（SFTP 仍是绕过）；
    - **只把 `sftp-server` 塞进核心包**（它仍由 sshd 拉起，不在我们的 bwrap 里）。

## 3. 代价与风险

- **供应链成为新的信任根**：核心二进制从哪来、谁签名、如何校验、如何升级，是本方向**最大的新风险面**。
- **架构覆盖**：x86_64 / aarch64 需要分别构建与验证；只支持其中一种必须**明说**。
- **多版本共存与升级**：按机器记录版本；升级不得打断正在跑的命令（或明确拒绝新请求直到替换完成）。
- **核心既是围栏执行者又是被围栏对象**：`serve` 挂了要 fail-closed 重拉，不能悄悄退回 SFTP。
- **核心落地前 ADR-0022 §2.7 仍然成立**：远程 `ctx.fs` 还走 SFTP 时，写面不被围栏覆盖；
  不得提前宣称「已围栏」。落地后 I9-9 必须反过来。

## 4. 验收（核心落地那轮的验收口径，供 backlog 引用）

> 权限轴已改会话 `/permission`（ADR-0025）。下文「档位」读作会话 `sandboxPolicy`；
> 文中的 `off` 读作 `danger-full-access` 的运输旁路。合验：
> `docs/uat/R27-req-i13-remote-session-sandbox.md`。

1. **一个产物**：一次面板/一条命令把核心部署到远端用户域，**不需要 root**；
2. **可校验**：版本 + 校验和，失败即拒绝使用；
3. **执行面**：`remoteSandbox: read-only|workspace-write` 不再要求系统 `bwrap`；fail-closed 口径沿用 REQ-I9
   （含「命令从未执行」）；
4. **读写面（与执行面同轮验收，不拆「完全体」）**：
   - `read-only` 下官方 `write`/`edit` 在工作区外与 `/tmp` **被拒**，目标文件不存在（对偶 I9-1，走 fs 接缝）；
   - `read-only` 下官方 `read` 读 `/etc/hostname` 仍成功（对偶 I9-2，对齐 `--ro-bind / /`）；
   - `workspace-write` 下工作区内 `write`/`edit` 成功，且 shell 与 fs 两条接缝读回一致（对偶 I9-3）；
   - 围栏打开时 browse `mkdir` 工作区外失败；`remoteSandbox: off` 仍走今天的 SFTP；
   - 核心不可用且档位不是 `off` ⇒ fs 写与 spawn **一起** `SANDBOX_UNAVAILABLE`，没有「命令被拦、SFTP 还能写」；
5. **搜索**：部署后 glob/grep 不要求用户预装 `rg`；
6. **退路可证**：核心跑不起来的主机有可执行的错误与降级说明；
7. **文档收敛**：分项安装清单（含模型提示 `envMissing`）一次性收口为「核心是否就位」。

## 5. 现状接缝（调研事实，供落地对照）

今天远程文件世界是 **宿主进程里的 SFTP 客户端**（`SshFileSystemEngine` → `transport.getSftp()`），
sshd 另起 `sftp-server`。它与模型命令不是同一个远端进程，所以 bwrap 包 spawn **围不住** `writeText` /
`editText`。browse/picker（`listRemoteLevel`、远程 mkdir）走同一条 SFTP。官方 glob/grep 则是
**spawn `rg`**（缺了报 127），所以 `rg` 进核心是搜索问题，不是列目录问题。

`FileSystemBranch` 当前方法：`resolve` / `processPath` / `processPathFromHostPath` / `fileUrl` /
`contains` / `stat` / `lstat` / `readText` / `streamText` / `readBytes` / `readByteRange` /
`listDir` / `writeText` / `editText`。核心 RPC 至少覆盖这些，外加 listing/mkdir；
`processPathFromHostPath` 对远程世界仍返回 `undefined`（宿主文件不进远端，BUG-2 语义不变）。
