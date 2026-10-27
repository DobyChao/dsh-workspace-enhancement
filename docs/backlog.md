# Backlog — 唯一待办真相源

> **本文件是项目唯一的待办/需求真相源。** 改状态改这里；其它文档只陈述结果，不得另立待办表。
>
> **分区 = 状态列**（闸门会拦，跨代理同一套）：§1 `doing` · §2 `todo`（P0→P3）· §3 `blocked` ·
> §4 `done`/`shipped` · §5 `dropped` · §6 AgentTeams 子项（`blocked`/`todo`）。
> 一行只属于一个分区。`doing` 不得留在 §2。
>
> **备注只写还没做完的事 + 指针**（§1–3 ≤220 字，§4 ≤160；链接按标签计）。
> 调查、根因、已落地实现进 [`decisions/`](./decisions/) 或 [`rounds/`](./rounds/)。
> 备注里的字面 `|` 必须写成 `\|`。
>
> **ID 贯穿**：提交尾行 `Refs: <ID>` → 测试名 → CHANGELOG → `docs/status.md`。

## 1. 当前进行中（doing）

| ID | 标题 | 状态 | 优先级 | 备注 |
|---|---|---|---|---|
| PUB-12 | 0.2.7 发布 | doing | P1 | 插件与远程组件同升 0.2.7。peer 不变。合并后所有者打 tag `v0.2.7` 并 Approve npm-publish。本 PR 不打 tag、不发布。档案 [R59](./rounds/R59-pub12-v0.2.7-release.md) |
| REQ-I31 | 实验性切机器工具 | doing | P2 | R58 已实现 + BUG-20 修复（PR #86）：mixed.resolve 绑路径自己的机器 + 工具层错提交回滚 + gate 遥测。lab 双向重验通过（c3/c1 提交与读回一致）。待 owner a/b 复测 + UAT 步骤 5–15。裸通道 v1 接受（见笔记） |

## 2. 已排期（todo，按优先级）

| ID | 标题 | 状态 | 优先级 | 备注 |
|---|---|---|---|---|
| REQ-I32 | 新建工作区二级菜单：免进入建多文件夹工作区 | todo | P2 | 2026-10-27 用户提。现状建工作区须先进入再逐个挂副目录。目标：「新建工作区」入口加二级菜单，创建时一次选定多个源文件夹（本机+已连机器；形态参考宿主「创建项目」弹窗的源文件夹多选区）。挂点（宿主按钮可否挂槽/替换）与验收待开工调查；归工作区生命周期线（ADR-0019） |
| REQ-I20 | 系统提示段对齐官方 order | todo | P3 | 2026-09-22。远程段紧跟 persona：`sw-remote`=90、工具段=105，夹在身份 0 与 `PLAN_POLICY` 500 之间。官方工具段从 1000 起，段名也是 `tool:bash`。先定落点。见 [prompt-section-order](./notes/prompt-section-order.md) |
| REQ-A4 | 端口转发（local/reverse + autoStart） | todo | P3 | 移植 dsh-remote forwards。延后见 `ADR-0005`。2026-09-22 从 P2 降到 P3 |
| FIX-8 | dev-lab.ps1 冒烟探针打已废弃的 /dsw 通道 | todo | P3 | ADR-0018 后通道在 /api/dsw/<端点>，-Smoke 仍 POST /dsw/connections.list 必 404（09-29 升 0.2.0 实机时实锤）。改为 /api/dsw/ + 会话 cookie（对齐 boot-smoke） |
| INFRA-12 | boot-smoke 成功后不退出 | todo | P3 | 显式 `process.exit`；只清 `dsh-boot-smoke-*`。验收：SMOKE PASS 后 5s 内退出、码 0 |
| REQ-A5 | 旧 dsh-ssh-routes 占位树退役 | todo | P3 | 仓库侧旧树已删（10-12 核实）；剩 `transport.ts:78` 运行时仍读 $DSH_HOME 下 pre-rename 同名树——定退役时点（改读 dsw-routes + 迁移或告警）+ home 归档盘点 |
| AUDIT-4 | 远程状态：判定与渲染合成一份被测函数 | todo | P3 | `remoteCellOf` + 测试改指它（`ADR-0017` §7.6）。不要并进 `AUDIT-5` |
| REQ-I8 | Spike：fork + 换 cwd（norepo 挂工作区） | todo | P3 | 10-27 调查：原案死——fork 官方存在但不收 cwd 覆盖；正道=0.2.1 `workingDirectory.set`（0.2.0 无）。改向「目录即会话上下文」（A 会话中迁移 / B cwd-only 开场），开工前先拍需求。见 [survey](./notes/req-i8-norepo-workspace-survey.md) |
| REQ-I1 | 对话/轨迹区可扩展面板 Tab | todo | P3 | 往后排。走 `conversation.view`（ADR-0016 / 0017）。tab id 进 localStorage，发布后不可改名 |
## 3. 被挡住 / 待拍板（blocked）

推荐、代价与期限在 [拍板队列](./decisions/queue.md)。逾期的可逆项会让静态闸门变红。

| ID | 标题 | 状态 | 优先级 | 备注 |
|---|---|---|---|---|
| UPSTREAM-6 | 官方 SSH 运行时定位拍板 | blocked | P1 | 10-08 复核：四包 `next`=`0.2.0-rc.2` 已进 rc，仍拒 win32 宿主、未接 Web、不进默认组合。细化对比（含 A′/B′）见 [ADR-0029](./decisions/ADR-0029-positioning-review.md)，推荐 A′。**待所有者**拍板；拍定即解挡 `REQ-A7` |
| REQ-A7 | 包改名为远程工作区类名称 | blocked | P2 | 候选 `dsh-remote-workspace`，旧包 `npm deprecate` 指向新包；`sw_` / `dsw` 不动。**挡于** `UPSTREAM-6`（A/A′/C 才改，B 另议）。见 [ADR-0029](./decisions/ADR-0029-positioning-review.md) §4.1 |
| REQ-I25 | 混合门面未知方法默认转发本地委托 | blocked | P3 | ADR-0030 选项 B：仍是唯一提供者，只拦带路径 / cwd 的方法，其余默认转发；`sandboxMode` 等 getter 单列。验收：纯本地会话与官方一致，三条矩阵行保持，boot-smoke 过。**挡于 ADR-0030 拍板** |
| INFRA-8 | AgentTeams 标准 profile 注册 | blocked | P2 | 配置在 `docs/agents.md`。**需所有者**写入宿主组合（代理不碰产品 profile）。子项 §6 |
| AUDIT-5 | 分组视图下会话子行拿不到 compact 徽标 | blocked | P2 | 2026-09-22 先挡住：这个徽标还要不要修未拍板。证据 [R17](./rounds/R17-rc2-badge-verification.md) §6。确认前勿改 |

## 4. 已完成（done / shipped，ID 留作追溯）

事实在 round / ADR；这里只留结果指针。未跑的真机尾巴一句点到脚本。

| ID | 标题 | 状态 | 优先级 | 备注 |
|---|---|---|---|---|
| PUB-11 | 0.2.6 发布 | shipped | P1 | tag [v0.2.6](https://github.com/DobyChao/dsh-workspace-enhancement/releases/tag/v0.2.6)；npm latest=0.2.6。档案 [R57](./rounds/R57-pub11-v0.2.6-release.md) |
| AUDIT-8 | 清理无用单元测试 | done | P3 | PR [#85](https://github.com/DobyChao/dsh-workspace-enhancement/pull/85) 已合入。删 7 个被取代用例（5 文件）+ 零调用死导出 `passthroughConfinedArgv`；83 文件三判据盘点表在 PR 描述，覆盖零丢失 |
| BUG-21 | 本机主工作区对远程副工作区跑 sw_exec 失败 | done | P1 | 本机会话对已连接远程机器同步标记 argv，不再等待宿主 confine。见 [笔记](./notes/BUG-21-22.md) |
| BUG-22 | 远程会话子代理扫不到项目技能 | done | P1 | processPath 返回可路由占位路径，fileUrl 仍是远端 POSIX。见 [笔记](./notes/BUG-21-22.md) |
| BUG-23 | 远程沙箱不可用仍显示成绿色成功 | done | P2 | tier none 改为警告色，点状态仍显示沙箱不可用。文案分行，不写「无法围栏」。见 [笔记](./notes/BUG-23-fence-none-green.md) |
| BUG-24 | 子代理权限显示成 Custom | done | P2 | 审批为 never 且沙箱与预设一致时显示该预设名。不显示成完全权限。见 [笔记](./notes/BUG-24-subagent-custom.md) |
| BUG-20 | 嵌套远程工作区侧边终端打不开 | done | P1 | 列目录 canonicalize 改走共享 SFTP，不再按路径 exec。取消的终端会关掉已开通道。尾巴：嵌套工作区重开侧边终端目测 |
| PUB-10 | 0.2.5 发布 | shipped | P1 | tag [v0.2.5](https://github.com/DobyChao/dsh-workspace-enhancement/releases/tag/v0.2.5)；npm latest=0.2.5。档案 [R56](./rounds/R56-pub10-v0.2.5-release.md) |
| BUG-16 | 远程会话文件页显示占位路径，打开落到本地 stat | done | P1 | PR [#80](https://github.com/DobyChao/dsh-workspace-enhancement/pull/80) 已合入 master。原生路径与远程预览见 [验收](./uat/BUG-16-17-remote-panels.md)。better-sidebar 目录树仍待上游 |
| BUG-17 | 远程会话终端按本机 shell 启动 | done | P1 | PR [#80](https://github.com/DobyChao/dsh-workspace-enhancement/pull/80) 已合入 master。终端请求绑定会话路由。验收见 [BUG-16/17](./uat/BUG-16-17-remote-panels.md) |
| BUG-19 | 远程终端把启动环境变量回显到屏幕 | done | P2 | 启动命令改走带 PTY 的 exec，不再写入登录 shell。环境清理仍在。尾巴：重开远程终端目测 |
| BUG-18 | 连接表单等子弹窗拖选仍关闭 | done | P2 | 新建连接、新建文件夹、删除拖出不关。验收 [选择器](./uat/UX-14-picker-chrome.md)。SSH 确认框因 lab 无 Host 未走 |
| UX-14 | 目录选择器：全名、可编辑路径、可拖拽分区 | done | P2 | 全名、可输入路径、分隔可拖且记住宽度。悬停不再铺灰带。验收 [选择器](./uat/UX-14-picker-chrome.md) |
| UX-15 | 重连/重新检测改为刷新图标 | done | P2 | 侧栏、选择器、会话头、设置页都是无边框刷新图标，悬停才有底色。侧栏远程标记改为线框服务器图标。验收 [选择器](./uat/UX-14-picker-chrome.md) |
| UX-16 | 工作区悬停显示服务器与真实路径 | done | P2 | 悬停卡显示服务器和远端路径。复制按钮仍是宿主原文。验收 [选择器](./uat/UX-14-picker-chrome.md)。lab 50599 通过 |
| PUB-9 | 0.2.4 发布 | shipped | P1 | tag [v0.2.4](https://github.com/DobyChao/dsh-workspace-enhancement/releases/tag/v0.2.4)；npm latest=0.2.4。档案 [R54](./rounds/R54-pub9-v0.2.4-release.md) |
| REQ-A6 | 远程上传/产物可在宿主工作区文件页浏览 | done | P2 | 主路径：宿主「工作区文件」页（ctx.fs，不需 better-sidebar）。optional「远程文件」tab 仍作增强。脚本 [REQ-A6](./uat/REQ-A6-remote-files.md)；决定与证据见 [R55](./rounds/R55-req-a6-host-files.md) |
| UPSTREAM-13 | 子进程契约把 watchLinuxScopeStart 归为内部方法 | done | P2 | PR #76 已合入。`watchLinuxScopeStart` 归入内部方法。drift [39016266340](https://github.com/DobyChao/dsh-workspace-enhancement/actions/runs/39016266340) 仅此两例。issue #75 不关 |
| UX-13 | 连接状态自动探测与可达性文案 | done | P2 | 打开即探测，不写入主机密钥。密钥对不上悬停「主机密钥已变更」。重新检测三态都在。脚本 [UX-13](./uat/UX-13-8-status.md) |
| UX-8 | 侧栏行徽章按 data-row-key 对齐 | done | P2 | 分组行按 data-row-key 对齐（无锚回退标题）。Session 行槽迁移不做。脚本 [UX-8](./uat/UX-13-8-status.md) |
| REQ-I26 | 远程组件覆盖 linux-arm64 | done | P2 | linux-arm64 与 linux-x64 同工件：uname 选包、独立 sha、CI/pack 双 tarball。rg 按架构。Windows 远端仍不做。尾巴：arm64 实机部署 |
| REQ-I28 | 远程会话上传落到远端工作区 | done | P2 | 回执返回前 SFTP 写入远端 `.dsh-uploads/`，失败则上传失败。产物路径进运行时上下文。[ADR-0032](./decisions/ADR-0032-remote-session-uploads.md)。尾巴：lab 打开产物 |
| INFRA-24 | 拍板队列与可逆期限 | done | P2 | 队列 [queue](./decisions/queue.md)（推荐、代价、reversible-until）。逾期闸门红。round 只在里程碑/事故写 |
| UX-11 | 「设为当前」决定新建工作区的起始机器 | done | P3 | 未指定连接时从当前机器开始浏览；横幅点名机器；当前行有选中样式。脚本 [UX-11](./uat/UX-11-12-settings.md) |
| UX-12 | 远程组件部署失败用红色错误样式 | done | P3 | 部署失败走红色错误横幅和红色状态芯片，不再用绿色成功横幅。脚本 [UX-12](./uat/UX-11-12-settings.md) |
| REQ-I29 | 远程围栏 bwrap 可用性：功能探测 + Landlock 后备档 + 用户引导 | done | P2 | PR #69（含 REQ-I30 并入；折入 UX-4 车道修复）。核心 tier 化 + fenceinfo + 部署/状态/设置页档位；core 0.2.3；授权对齐宿主（/dev/null、真实 /tmp）。**尾巴**：真 Docker 降档、老 core unknown 实机 [R53](./uat/R53-req-i29-fence-tier.md)。档案 [R53](./rounds/R53-req-i29-fence-tier.md) |
| BUG-15 | core-artifact.mjs 管道读 tar：沙箱 EPERM 静默跳过 sha 登记/溯源门 | done | P1 | PR #67。tar 解临时目录按文件哈希（零管道），存在但读不出必抛；pack-smoke 干净判红；单测 3 例。**尾巴**：lab 实机 UAT 走查 [R52](./uat/R52-bug14-15-ux4-10.md) |
| BUG-14 | 目录选择器：拖选松手在窗外即整窗关闭 | done | P2 | PR #67。`backdropDismissProps`（mousedown 起点 + click 双条件，跨渲染 fail-safe），flow/side-workspaces 两处换用；单测 5 例。**尾巴**：浏览器拖选实机 R52 |
| UX-10 | 新建/编辑连接表单：不预填 + 警告时机 | done | P3 | PR #67（含原 UX-5）。初值/EMPTY/wire 三处去 root 预填、别名不再猜 `/home/<user>`；保存重置补 `setRevealed(false)`；测试连接拒空用户名。**尾巴**：lab 目测 R52 |
| UX-4 | `CONN_STATE_COLOR` 状态色 token 化 | done | P3 | PR #67。三态色换宿主 `var(--dsw-alias-state-*)`，DOM 增辉点与 React 徽章同档随双主题。**尾巴**：双主题实机 R52 |
| REQ-I22 | Spike：远程围栏改走 `confine` 逐次策略 | done | P1 | PR #65。[ADR-0031](./decisions/ADR-0031-remote-fence-confine-policy.md) accepted：两问答死（调用面全量枚举 + 终端两路），实施随 REQ-I27 同 PR。档案 [R51](./rounds/R51-three-p1-round.md) |
| REQ-I27 | 实施远程围栏 `confine` 逐次策略 | done | P1 | PR #65。注册表（argv 身份）+ spawn/终端/fence 标记驱动 + ALS 退役 + sw_exec/win32-bash 官方同形；boot-smoke + 双 OS CI 绿。**尾巴**：N9 提权 / L1 抽查实机；0.1.7 消费者集合装机核。档案 R51 |
| INFRA-23 | L1 实机冒烟进 CI：假模型 + sshd 容器 | done | P1 | PR #65。`scripts/e2e-l1/`（假 Anthropic 服务器 + headless 真宿主 + M3–M5 断言）+ ci.yml `e2e-l1`。**尾巴**：secret `DSW_E2E_SSH_PASSWORD` 建好后真跑；M6/M7 浏览器半留 L1。WSL 预验 blocked（用户指示）。档案 R51 |
| UPSTREAM-11 | 桌面版 dsh 适配 | done | P1 | PR #65。desktop-watch 周探（四文件指纹 + 语义断言）+ compatibility §7 + 每周探测。**尾巴**：桌面实机 UAT（[UPSTREAM-11-desktop](./uat/UPSTREAM-11-desktop.md)，用户执行）。档案 R51 |
| BUG-13 | 直连停止线读到假 EOF，无远程组件的远端命令必现 SIGTERM | done | P1 | PR #62（#59）。真 stdin 复制到 fd 4，假 EOF 组杀去掉；真 EOF 仍组杀。**尾巴**：无 core 远端实机 [BUG-13](./uat/BUG-13-steward-stdin.md)。档案 [R50](./rounds/R50-bug13-steward-stdin.md) |
| BUG-12 | 远程会话提权 pwsh 仍按 workspace-write 打远端围栏 | done | P1 | PR #61。0.2.0 `shell.resolve` / `execute` 带上单次提权与 workdir。**尾巴**：远程 pwsh 提权实机 [R49](./uat/R49-side-root-sandbox-batch.md)。档案 [R49](./rounds/R49-side-root-sandbox-batch.md) |
| AUDIT-7 | 远程权限真值表 + 重叠机制清理 | done | P1 | PR #61。真值表 §4.1；远程只剩远程组件一条路。**尾巴**：子路径行实机。档案 [R49](./rounds/R49-side-root-sandbox-batch.md) |
| REQ-I24 | 本机副根与主根同权（第一级） | done | P2 | PR #61。并列副根与主根同权；祖先目录与盘符根不放宽。**尾巴**：Windows ACL 实机 [R49](./uat/R49-side-root-sandbox-batch.md)。见 ADR-0028 §5 |
| UX-7 | 去掉设置页「远程命令审批」 | done | P3 | PR #61。审批下拉与徽标已删；执行门保留，旧 `remoteApproval` 仍生效。**尾巴**：lab 目测。档案 R49 |
| REQ-I23 | Spike：本地接缝交还官方 | done | P3 | PR #61。路由层留作唯一提供者，推荐默认转发，见 [ADR-0030](./decisions/ADR-0030-local-seams-stay-routed.md)（待拍板）。实现是 `REQ-I25`。档案 R49 |
| UX-9 | 术语：「核心」改称「远程组件」 | done | P3 | PR #61。用户可见文案已改；标识符、线协议、面向模型的 core 不改。档案 R49 |
| PUB-8 | 0.2.3 发布 | shipped | P1 | tag `v0.2.3`；publish run 36737916290（OIDC，owner Approve）。发布前终检九项全过（含 0.2.0-rc.2 宿主安装+boot 实证）。npm `latest=0.2.3`。档案 [R47](./rounds/R47-pub8-v0.2.3-release.md) |
| REQ-I21 | 核心供给并入 sw_connect/sw_status；部署必问 + sha256 溯源 | done | P1 | PR #55（四次拍板）。`sw_connect` 同步供给报结果、`sw_status` 报核心态；部署必问；版本门同 major.minor 线；sha256 白名单（构建自登记）。**尾巴**：弹问闭环 UAT 待实机。档案 R46 |
| REQ-I14 | 核心部署无感化：连接预热 + 探测翻链 + 首用审批 | done | P2 | PR #54。探测翻链（探版本目录才翻 current）；预热/审批后被 REQ-I21 重塑为「问不了的路径不部署」+ 纯探测告警；ADR-0024 §3/§6.1 修订。档案 R45/R46 |
| REQ-I17 | 核心版本门：非本插件工件即拒执行 + 提示部署 | done | P2 | PR #54（放宽与溯源门随 PR #55）。同 major.minor 线可用（patch 漂移零打扰）、跨线拒；sha256 白名单；danger 落 SFTP。档案 R45/R46 |
| INFRA-22 | backlog 表格断行闸门 | done | P3 | PR #54。表格连续块 + 连续空行两条规则入 auditBacklog。档案 R45 |
| UPSTREAM-8 | 0.1.7-rc.2 实机两断点：locale 读取 + 后台 jobs owner | done | P0 | PR #44（含 UPSTREAM-9，原 #45 并入关闭）。契约从磁盘权威源（`@next` scratch）核出并锁进 fixture 测试。**尾巴**：0.1.7 侧为契约级验证，真机 UAT 待用户（后台 bash/sw_exec + `job_output` 有字节 + zh 会话标记现为 EN）。档案 [R41](./rounds/R41-upstream8-9-017-adaptation.md) |
| INFRA-19 | 实机测试矩阵：win32 lab + WSL Linux lab + browser-use | done | P1 | PR #47。`docs/uat/matrix.md` 为实机 case 唯一清单（L1 7/L2 12+双 lab，锚点=事故史）；WSL lab 真机 smoke PASS（0.1.7-rc.2）。**尾巴**：L1/L2 首轮 browser-use 执行未跑。档案 R42 |
| INFRA-20 | 上游信号升级：tag 每日轻探 + 真实家族形状契约 | done | P1 | 同 PR #47。tag-watch 每日 + settings 家族面契约测试进 `npm test`（drift 周跑）。首日实战三哨兵全响（#46/#48/#49）。档案 R42 |
| INFRA-21 | 跨 agent 协作协议：能力预检 + 点名派发 + 接续 | done | P2 | PR #51。`npm run preflight` + AGENTS.md §7 协议（点名派发/能力 blocked/接续三件套）+ doc-edit 断言编辑。同轮折入 REQ-A6/UPSTREAM-11/UX-8 三份调查与 PUB-8 发版窗口。档案 R44 |
| UPSTREAM-10 | 0.2.0 家族对齐 | done | P1 | PR #50（A 案联合 pin）。0.2.0 宿主强制 peer ⇒ `^0.1.7-rc.2`+`^0.2.0-rc.1`；真仓库对 0.2.0-rc.1 boot 哨兵 SMOKE PASS；pinned 通道 + workflow 闸门随行。**尾巴**：0.2.0 宿主上 L1（M3/M4）走查。档案 R43 |
| UPSTREAM-9 | `latest` 翻 0.1.7-rc.2：peer/dev 升 pin `^0.1.7-rc.2` | done | P0 | 同 PR #44。家族信号以宿主包 `latest` 为准（seam 自身 latest 不作数）。34 range + cordis/schemastery 升；0.1.7 主家族全门绿；boot 哨兵 0.1.5 宿主仍 PASS。档案 R41 |
| INFRA-1 | 真相源入库 | done | P0 | `AGENTS.md` + `docs/`。收口见 `INFRA-13` |
| REQ-I19 | 主/副工作区区域权限：工具绑世界 | done | P2 | PR #31。矩阵 [ADR-0028](./decisions/ADR-0028-region-permission-matrix.md)。UAT [R37](./uat/R37-req-i19-region-permissions.md) Windows 18/18；Linux 复跑 2026-09-25 用户确认收口。档案 [R37](./rounds/R37-req-i19-region-permissions.md) |
| BUG-11 | Linux 宿主区域矩阵五步失败 | done | P1 | 修复随 PR #31（拒 glued ssh workdir/jail 外 cwd、本地 sw_exec 回宿主 confine、清陈旧 jail）。Linux 复跑 R37 通过（2026-09-25 用户确认）。档案同上 R37 |
| BUG-10 | 远程项目 skill 目录包发现失败（宿主 join 破坏 `ssh://` 前缀） | done | P1 | PR #37/#42 三层修（归一 / win32 搅碎 / posix 塌缩重建）。win32 UAT 5/5。尾巴：Linux E2E 复跑 + win32 回归。档案 [R39](./rounds/R39-bug10-upstream5-7-audit1.md) |
| UPSTREAM-5 | 0.1.7 家族接缝对齐 | done | P0 | rc.2 全接缝（fs `watch` + subprocess `terminalEnvironment`）；契约 15 方法；workflow 加固后终 dispatch 绿（run 36216275977）。peer 等 `latest` 翻再升。档案 R39 |
| UPSTREAM-7 | 上游新包巡检要让哨兵响 | done | P1 | scope-watch 上线：宿主包组成比对基线，漂移开 issue，SSH 四包收编点名（`UPSTREAM-6` 触发器）。报警已演练（issue #40）。档案 R39 |
| INFRA-15 | 核心分发：npm 带工件 + 第三方不由我们分发 | done | P1 | PR #23。档案 [R28](./rounds/R28-infra15-core-artifact-distribution.md)。尾巴：四组合 UAT 未跑 |
| INFRA-13 | 文档地图收口 | done | P3 | [`docs/README.md`](./README.md) 是地图。同轮 `ADR-0023`：远端读写纳入核心 |
| INFRA-2 | 统一质量门 `npm run check` | done | P0 | 另有 `test:agent` |
| INFRA-3 | GitHub Actions CI + 上游冒烟 | done | P0 | `ci.yml` / `upstream.yml` |
| INFRA-4 | 上游兼容四层防护 | done | P1 | 见 `compatibility.md` |
| INFRA-5 | E2E 资产化 | done | P1 | `e2e/`，lab 50599 |
| INFRA-6 | `npm run status` | done | P1 | 生成 `docs/status.md` |
| INFRA-7 | UAT 脚本与反馈模板 | done | P1 | `docs/uat/` |
| INFRA-9 | 默认分支 `main` → `master` | done | — | 保护规则已上。历史 rounds 里的 `main` 不改 |
| INFRA-10 | 上游 alpha 通道预警 | done | — | next/alpha 两通道 + 自动 issue。见 `compatibility.md` §3.1 |
| BUG-2 | 缺 `processPathFromHostPath` → 贴图 `TRANSPORT` | done | P1 | [R14](./rounds/R14-BUG-2-fix.md)。随 `PUB-3` 发布 |
| BUG-3 | 本机目录接错 `workspaces` 服务 | done | P1 | 改接 `uiWorkspace`。[R15](./rounds/R15-BUG-3-local-directory.md) |
| BUG-4 | 宿主项目根探测铸出祖先 jail | done | P1 | 只传 `path`。附录 [notes/host-silent-fs.md](./notes/host-silent-fs.md)。尾巴已清：2026-09-23 无 `.git` 远程会话实机 `ps` 只见会话根（§6） |
| BUG-5 | ssh2 死链打挂宿主 | done | P1 | 全在 [R29](./rounds/R29-bug5-ssh-error-listener.md)。PR #21 |
| BUG-6 | 删掉核心后 `core.status` 仍显示「已安装」 | done | P2 | 只以磁盘工件为准。回归 `core-routing` BUG-6。尾巴：删核心后立即未安装 |
| BUG-7 | 跨传输 `version` 算法不一致 ⇒ 读→写 CAS 误报 | done | P2 | 共享 [fs-version.ts](../src/fs-version.ts)（路径 + size + 秒量化 mtimeMs 的 sha256）。Go 同式 |
| BUG-8 | `core.deploy` 解压依赖 PATH 的 `tar` | done | P2 | 宿主 [gzip-tar.ts](../src/gzip-tar.ts)，不 spawn PATH tar；失败带原因。远端仍 GNU tar |
| BUG-9 | 远端任务停止不了 | done | P1 | PR #26。档案 [R32](./rounds/R32-bug9-remote-task-stop-fix.md)；UAT [R32-bug9-stop-uat](./uat/R32-bug9-stop-uat.md) A/B 通过、C N/A |
| FIX-1 | `Session.events` 移除 | done | — | 改 `ownEvents()`。`compatibility.md` §2 |
| FIX-2 | 用户名输入溢出 13px | done | — | `machine-form.tsx` 补 `minWidth: 0` |
| FIX-3 | pack 含 source map | done | — | `files` 加 `!**/*.map` |
| FIX-4 | Windows 假设让 Linux CI 全红 | done | — | 矩阵含 windows；写法见 `testing.md` |
| FIX-5 | 只读门在 junction/短路径失效 | done | — | 根键 realpath（`ADR-0013`） |
| FIX-6 | PR 标题非 Conventional → 合并后必红 | done | — | `PR title (squash subject)` 作业 |
| FIX-7 | `*.sh` CRLF 让 WSL 复验跑不起来 | done | — | `.gitattributes` `eol=lf` |
| REQ-A3 | 首次发布 v0.1.0 | shipped | — | 2026-08-26 |
| REQ-DEP | 宿主包改 peer | done | — | `ADR-0009`；闸门自动化 |
| REQ-I2 | 远程终端/文件透明 | done | — | R4 |
| REQ-I3 | 会话副工作区 | done | — | R5；权限档已随 `REQ-I7` 退役 |
| REQ-I4 | 远程焦点时模型认知 | done | — | R4 |
| REQ-I6 | 系统提示英文 + 按需注入 | done | P2 | `ADR-0014`。[R13](./rounds/R13-req-i6-and-recon.md) |
| REQ-I10 | 日落 `sw_pick_workspace` | done | P2 | [ADR-0027](./decisions/ADR-0027-sunset-sw-pick-workspace.md)。删工具 + 6 个词典键；status/connect 改诚实 |
| REQ-I15 | 围栏档拆「读面/写面」：核心不可用时读可见降级 | done | P2 | PR #28。[R35](./rounds/R35-req-i15-i16.md)。lab UAT 通过 |
| REQ-I16 | bash 工具按工作区自主注入 | done | P3 | 同 PR #28 / R35。Win 本地不注入；远程 Linux 才出现 |
| UX-3 | 客户端 UI 统一到宿主 dsh 设计语言 | done | P2 | PR #20。尾巴：[uat/R28-ui-design-language.md](./uat/R28-ui-design-language.md) |
| REQ-I7 | 副工作区权限档退役 | done | P1 | `ADR-0019`。[R20](./rounds/R20-req-i7-permission-retirement.md) |
| REQ-I9 | 远端沙箱围栏（runner 原型） | done | P1 | `ADR-0022`。[R24](./rounds/R24-session-connections-and-remote-fence.md)。尾巴：[uat/R24-req-i9](./uat/R24-req-i9-remote-runner.md) |
| REQ-I11 | 会话级机器连接（吸收 SEC-5） | done | P1 | `ADR-0021`。同上 R24。尾巴：[uat/R24-req-i11](./uat/R24-req-i11-session-connections.md) |
| REQ-I5 | 远端「一个核心」 | done | P1 | PR #18。范围 ADR-0023/0024，权限 ADR-0025。[uat/R27](./uat/R27-req-i13-remote-session-sandbox.md) 11/12 通过 |
| REQ-I13 | 远端权限对齐本地 sandbox 提权 | done | P1 | 同 PR #18 / UAT R27（Write）。spawn 一次提权见 `REQ-I18` |
| REQ-I18 | 远程 spawn 一次提权 | done | P1 | 2026-09-22 用户 lab 简验。单测 `test/req-i18-ux-6.test.ts`。见 [ADR-0025](./decisions/ADR-0025-remote-session-sandbox.md) |
| UX-6 | 工具 schema 与官方统一英文 | done | P2 | 2026-09-22 用户 lab 简验。Language=zh 时 schema 英文、执行错误仍中文。见 [ADR-0014](./decisions/ADR-0014-model-facing-prompts-are-english.md) |
| REQ-R6 | 运行时国际化 | done | — | [R6](./rounds/R6-i18n.md) |
| REQ-S1 | `sw_exec` | shipped | — | v0.1.1 |
| REQ-S2 | win32 宿主 `bash` | shipped | — | v0.1.1 |
| SEC-5 | `sw_connect` 凭据不得进工具参数 | done | P1 | 随 `REQ-I11` 由结构消除。`SECURITY.md` 红线 1 |
| PUB-1 | 发布 0.1.2 | shipped | P1 | 产物早于依赖对齐，缺口由 `PUB-3` 补 |
| PUB-2 | 3080 换装 0.1.2 | done | P1 | 当时 `link:`；3080 现已不装本插件 |
| PUB-3 | 发布 0.1.3 | shipped | P1 | OIDC；`dependencies` 仅 `ssh2` |
| PUB-4 | 发布 0.1.4 | shipped | P1 | tag `v0.1.4`。档案 [R25](./rounds/R25-v0.1.4-release.md) |
| PUB-5 | 发布 0.2.0 | shipped | P1 | tag `v0.2.0`。档案 [R30](./rounds/R30-v0.2.0-release.md) |
| PUB-6 | 发布 0.2.1 | shipped | P1 | tag `v0.2.1` 待所有者推。档案 [R36](./rounds/R36-v0.2.1-release.md) |
| PUB-7 | 发布 0.2.2 | shipped | P1 | tag `v0.2.2`；publish run 36221466070（OIDC，所有者 Approve）。npm `0.2.2` 解包 3.53 MB（干净，未带旧核）。工件 `0.2.2` 促重部署。档案 [R40](./rounds/R40-pub7-v0.2.2-release.md) |
| INFRA-16 | npm 包泄漏 `build:core` staging | done | P1 | PR #24：`files` 收窄 `core/dist/*.tar.gz` + pack-smoke 闸门 |
| UPSTREAM-1 | `readByteRange` | done | P1 | [R16](./rounds/R16-upstream-1-byte-range.md)。窗口随后被 `UPSTREAM-4` 收窄 |
| UPSTREAM-2 | rc.2 槽位重排侦察 | done | P2 | `ADR-0017`。读取器 `npm run slots` |
| UPSTREAM-3 | 0.1.5 运行时兼容（F1/F2/F3） | done | P0 | `ADR-0018`。[R19](./rounds/R19-f2-shared-api-channel.md) |
| UPSTREAM-4 | 0.1.2 家族退场 | done | P1 | peer/dev `^0.1.5-rc.1`；哨兵只留 next/alpha |
| AUDIT-3 | 权限门测试 stub 漏方法 | done | P3 | 随 `REQ-I7` 整文件删除，失去对象 |
| AUDIT-6 | 远程命令审批门 + AI 自动放权 | done | P1 | `ADR-0020`。[R22](./rounds/R22-audit6-remote-approval-gate.md)。尾巴：e2e/UAT 延后 |
| INFRA-14 | Upstream drift 假红灯（boot smoke 装机） | done | P2 | CLI 树闭合 + `pipefail`。next 回绿；alpha 真信号 `UPSTREAM-5` |

## 5. 明确不做（决策留痕）

| ID | 标题 | 状态 | 优先级 | 备注 |
|---|---|---|---|---|
| REQ-A2 | 向上游提 PR（行级槽位） | dropped | — | `ADR-0011`；改 DOM 增辉层 |
| UPSTREAM-12 | 向上游提多根写策略需求 | dropped | — | 上游不接受 issue（所有者 10-08）。副根停在第一级，跨根写走提权。ADR-0029 §4.3 |
| REQ-X1 | 镜像/同步 | dropped | — | `ADR-0003` |
| REQ-X2 | 审计日志 | dropped | — | `ADR-0004` |
| REQ-X3 | 更新检查 | dropped | — | 上游节奏太快 |
| REQ-X4 | 内嵌侧边栏 | dropped | — | `ADR-0006` |
| SEC-3 | `remote-full` 无二次确认 | dropped | — | 预设不做（ADR-0015）。没有 `remote-full` 就没有确认门可补 |
| UX-1 | 远程会话 composer 显示 `Custom` | dropped | — | 钉档已取消（ADR-0025）。不再单列 lab 确认 |
| INFRA-11 | `link:` 安装的 `lib/` 漂移 | dropped | — | 3080 不装本插件；lab 用 tarball。WARN 已在。见 R15 |
| AUDIT-2 | `resolveExecutable` 恒本地写成 ADR | dropped | — | `architecture.md` §4 已写。不再单独立 ADR |
| BUG-1 | 设置页顶部空白边框条 | dropped | — | lab 未复现，无复现步骤 |
| UX-2 | 副工作区面板「浏览」输入框去留 | dropped | — | 无验收标准，不再等 |
| REQ-I12 | 围栏可见面 + 死字段 `remoteSandboxRunner` | dropped | — | 死字段已不读。审批下拉另见 `UX-7` |
| SEC-1 | 副根 `fs:r + exec:on` 绕过 | dropped | — | 随 `REQ-I7` 失去对象。调查留 `ADR-0012`（作废） |
| SEC-2 | 主 workdir 写删只读副根 | dropped | — | 同上；围栏改由 `AUDIT-6` / `REQ-I9` 线 |
| AUDIT-1 | 混合门面改为 `extends` 上游基类 | dropped | — | 不做：基类是 cordis Service，静默继承绕过世界路由。双侧反射契约承担（R39） |

## 6. AgentTeams 标准轮次（INFRA-8 目标）

| ID | 标题 | 状态 | 优先级 | 备注 |
|---|---|---|---|---|
| INFRA-8a | `dsw-round` profile | blocked | P2 | `docs/agents/dsw-round.yml`；待合入宿主组合 |
| INFRA-8b | `dsw-spike` profile | blocked | P2 | `docs/agents/dsw-spike.yml`；待合入宿主组合 |

---

新增需求先在这里加一行（ID + `todo`，放进 §2 对应优先级块）再开工。任何「只在聊天里说过」的待办都不算数。
