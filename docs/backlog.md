# Backlog — 唯一待办真相源

> **本文件是项目唯一的待办/需求真相源。** 改状态改这里；其它文档只陈述结果，不得另立待办表。
>
> **备注只写还没做完的事 + 指针。** 调查过程、根因长文、已落地实现进
> [`decisions/`](./decisions/) 或 [`rounds/`](./rounds/)，不要再往本表贴。
>
> **状态**：`todo` · `doing` · `blocked` · `done` · `shipped` · `dropped`。
> **分区**：§1 `doing` · §2 `todo`（按优先级）· §3 `blocked` · §4 `done`/`shipped` · §5 `dropped` · §6 AgentTeams 子项。
> 一行只属于一个分区。备注里的字面 `|` 必须写成 `\|`（闸门会拦）。
>
> **ID 贯穿**：提交尾行 `Refs: <ID>` → 测试名 → CHANGELOG → `docs/status.md`。

## 1. 当前进行中（doing）

| ID | 标题 | 状态 | 优先级 | 备注 |
|---|---|---|---|---|
| REQ-I5 | 远端「一个核心」（执行围栏 + 远端读写） | doing | P1 | **主线。** 范围认 `ADR-0023` + `ADR-0024`（§6 寿命/工作区键）。权限轴认 `ADR-0025` / `REQ-I13`。与 I13 **同一 PR、同一份 UAT**：`docs/uat/R27-req-i13-remote-session-sandbox.md`（R26 脚本已作废）。lab 50599 已跑 R27；收口见该脚本 |
| REQ-I13 | 远端权限对齐本地 sandbox 提权 | doing | P1 | 范围认 `ADR-0025`。与 `REQ-I5` 同 PR、同一份 UAT `docs/uat/R27-req-i13-remote-session-sandbox.md`。无核心+围栏档 fail-closed 与 Windows 无核心默认 workspace-write 失败都在该脚本里。lab 50599 已跑 R27 |
| INFRA-15 | 核心分发：npm 带工件 + 第三方工具不由我们分发 | doing | P1 | 代码完成，分支 `feat/INFRA-15-core-artifact-distribution`（[`R28`](./rounds/R28-infra15-core-artifact-distribution.md)）。① npm 包只带 `dsh-core`：`files` 加 `core/dist`、`prepack` 守卫、`check` 链加 `build:core`、release.yml 加 setup-go（用户报「有些服务器装不上核心」根因）。② **政策修订（所有者 2026-09-16 拍板）**：本仓库**不再分发任何第三方二进制**——`bwrap` 由远端发行版提供（核心三层解析，缺失即拒绝该次围栏 + 给安装命令或 danger 出路），`rg` 远端优先、缺失才由宿主取官方 release 并按 pin 校验后随核心推送。③ 版本/pin 单一来源 + `check:static` 第 14 道闸门拦漂移。**待**：push → PR → CI（go test/build 权威）→ 远端四组合 UAT（有/无 bwrap × 有/无 rg）→ 合并后改 done |

## 2. 已排期（todo，按优先级）

| ID | 标题 | 状态 | 优先级 | 备注 |
|---|---|---|---|---|
| UPSTREAM-5 | 0.1.6-alpha.1 subprocess 接口漂移 | todo | P2 | `@deepseek-ai/dsh-subprocess@0.1.6-alpha.1` 加宽四处 ⇒ `CoreSubprocessHandle` / `SshTerminalHandle` / `SshSubprocessRuntime` 编译失配（drift run 34950619028、issue #7）。成员表与**收口注意清单** [`ADR-0026`](./decisions/ADR-0026-upstream-ssh-runtime.md) §1.2 / §4。验收：alpha 通道回绿 + `check:static`/`typecheck`/`test:agent`/boot smoke 全绿；`0.1.6` 升 rc 前收口 |
| UPSTREAM-6 | 官方 SSH 运行时定位拍板 + 新包巡检 | todo | P2 | 官方在 `0.1.6-alpha.1` 首发 SSH 家族（`dsh-ssh`/`dsh-fs-ssh`/`dsh-sandbox-ssh`/`dsh-subprocess-ssh`）；事实、helper 模型、差异矩阵 [`ADR-0026`](./decisions/ADR-0026-upstream-ssh-runtime.md)。**待所有者**：§5 定位拍板（A/B/C）。代理侧：scope 新包巡检（哨兵只装固定 13 包、看不见新能力包）。验收：§5 有结论 + 巡检有落地机制（或如实写「人工 + 频率」） |
| INFRA-11 | `link:` 安装的 `lib/` 漂移 | todo | P2 | 已有非阻断 mtime WARN。**待做**：① 改内容哈希/构建戳再升级为阻断（PR #14 已证明纯 mtime 假阳性）；② `restart-3080.ps1` 重启前 `npm run build`。证据 [`rounds/R15-infra-11-dev-build-drift.md`](./rounds/R15-infra-11-dev-build-drift.md)。验收：改 `src/` 不 build 必提示；正常重建不误报 |
| REQ-A4 | 端口转发（local/reverse + autoStart） | todo | P2 | 移植 dsh-remote forwards。延后决定见 `ADR-0005` |
| REQ-I10 | 日落 `sw_pick_workspace` | todo | P2 | 删工具 + 8 个词典键；`sw_connect`/`sw_status` 文案改诚实（工作区由添加流/设置页管理）；短 ADR 取代 `ADR-0001` 的四工具终态。验收：`src/` 无该符号（docs 历史除外）+ `check:static`/`typecheck`/`test:agent`/`build`/`boot-smoke --no-channel` |
| AUDIT-5 | 分组视图下会话子行拿不到 compact 徽标 | todo | P2 | 修法：兄弟扫描 → 分组容器内**后代**扫描。证据与精确补丁 [`rounds/R17-rc2-badge-verification.md`](./rounds/R17-rc2-badge-verification.md) 第一部分 §6。不要跟「文案停在未检测」搞混（那是已修的 F2）。两代共有，非 rc.2 回归。不要和 `AUDIT-4` 混在同一 PR |
| REQ-I12 | 围栏可见面 + 死字段 `remoteSandboxRunner` | todo | P3 | 围栏语义已落地（`REQ-I9` + `REQ-I5`）。④ 死字段已随 I5 停止读取。② 拒写 `sandboxDenialMarker` 随 `REQ-I13` 做。剩余：① `sw_status` 报档位/探针；③ 徽标接 live `conn.status`。win32 `bash` 拒绝文案不要套 `sw_exec` 前缀 |
| INFRA-12 | boot-smoke 成功后不退出 | todo | P3 | 收尾补显式 `process.exit`；清理只删 `dsh-boot-smoke-*` 子目录、勿删父 temp。证据 R20/R22。验收：SMOKE PASS 后 5s 内自行退出、码 0 |
| AUDIT-1 | 混合门面改为 `extends` 上游基类 | todo | P3 | 防 BUG-2 那种「基类新增具现方法、门面纯对象漏方法」。证据 [`rounds/R14-BUG-2-contract-audit.md`](./rounds/R14-BUG-2-contract-audit.md) O2。验收：门面 `instanceof` 基类 + `check` 绿 |
| AUDIT-2 | 把 `resolveExecutable`「恒本地」写成 ADR | todo | P3 | 文档项。`architecture.md` §4 已点到；还差 ADR 一句话。证据 R14 审计 O1。当前无运行时影响 |
| REQ-A5 | 顺手清理旧占位树 | todo | P3 | 确认无引用后删旧 `dsh-ssh-routes/` 与 `$DSH_HOME` 归档盘点 |
| AUDIT-4 | 远程状态：判定与渲染合成一份被测函数 | todo | P3 | `showsRemoteStatus` 零调用者；渲染看 `remote-status-entry.tsx`。修法：`remoteCellOf` + 测试改指它（`ADR-0017` §7.6）。不要并进 `AUDIT-5` |
| REQ-I8 | Spike：fork + 换 cwd（norepo 挂工作区） | todo | P3 | 用 `ctx.sessionPersistence` 拼带历史的新 cwd。核三件事：列表是否出现、能否 resume、标题/投影。产出 ADR（可行 → 工作区生命周期；不可行 → fork 留档 + 新会话） |
| UX-4 | `CONN_STATE_COLOR` 状态色 token 化 | todo | P3 | `src/client/status.tsx` 的 `CONN_STATE_COLOR` 仍是 JS 硬编码 hex（#8A8F98/#22C55E/#F25A5A）且被 `row-badges.ts` 消费（行内状态点走内联色），与 UX-3「状态点走 state-* token」不完全一致。评审证据：PR #20。验收：状态点颜色全部来自宿主语义 token，双主题核对 |
| REQ-I14 | 核心部署无感化：连接预热 + 探测翻链 + 首用审批 | todo | P2 | 设计已议定（2026-09-15，本轮对话）：① 机器连接成功且围栏档≠off → 后台 job 自动 `core.status`→`core.deploy`（artifact 已随 npm 分发，秒级）；未就绪期间 fail-closed 降级审批门，不阻断功能。② 升级走版本化目录并存：新版本健康探测（version 门 + profile 探针）通过才翻 `current` symlink，不过不翻、旧目录保留回滚。③ 模型路径首次调用遇「核心未安装」→ 走 `ctx.approval` 发明确标注的安装审批（人类机器弹人 / AI 机器 answerer 放行），把 ADR-0024「不偷偷装」红线转译为显式一键同意。**红线**：无用户来源同意绝不上传执行二进制。键 [`ADR-0024`](./decisions/ADR-0024-remote-core-protocol.md) §3；依赖 INFRA-15（npm 分发 artifact）与 AUDIT-6 面。排期：INFRA-15 合并后下一轮 |
| REQ-I1 | 对话/轨迹区可扩展面板 Tab | todo | P3 | **往后排**（2026-09-13：先做核心）。走 `conversation.view`（`ADR-0016`；`ADR-0017` §7）。tab id 进 localStorage，发布后不可改名。不要改走右侧面板 Tab |
| UX-1 | 远程会话 composer 显示 `Custom` | todo | P2 | **根因随 ADR-0025 消失**（不再钉 `{danger, ask}`）。待 lab 确认 chip 回到 Workspace write 后改 `done`。勿再补 `remote-full` 除非仍 Custom |

## 3. 被挡住 / 待拍板（blocked）

| ID | 标题 | 状态 | 优先级 | 备注 |
|---|---|---|---|---|
| SEC-3 | `remote-full` 无二次确认 | blocked | P1 | 上游客户端按 preset **id** 判确认门，不看 sandbox 档。插件无干净入口（`ADR-0011` 已否上游 PR）。UX-1 方案 A 的已知副作用；钉档取消后此条可能失去对象。等 lab 确认 Custom 消失 |
| INFRA-8 | AgentTeams 标准 profile 注册 | blocked | P2 | 配置已在 `docs/agents.md`。**需所有者**写入宿主组合并重启（代理不碰产品 profile） |
| UX-2 | 副工作区面板「浏览」输入框去留 | blocked | P3 | 等用户用几天再定 |
| BUG-1 | 设置页顶部空白边框条 | blocked | P3 | lab 未复现。要用户环境指纹（浏览器/视口/缩放/主题/语言） |

## 4. 已完成（done / shipped，ID 留作追溯）

事实在对应 round / ADR；这里只留结果指针。真机尾巴写在备注末句。

| ID | 标题 | 状态 | 优先级 | 备注 |
|---|---|---|---|---|
| INFRA-1 | 真相源入库 | done | P0 | `AGENTS.md` + `docs/` 结构。收口见 `INFRA-13` |
| INFRA-13 | 文档地图收口 | done | P3 | [`docs/README.md`](./README.md) 是地图；architecture 短引导；轮次为档案。同轮 `ADR-0023` 补拍：远端读写纳入核心，`REQ-I1` 往后排 |
| INFRA-2 | 统一质量门 `npm run check` | done | P0 | 另有 `test:agent` |
| INFRA-3 | GitHub Actions CI + 上游冒烟 | done | P0 | `ci.yml` / `upstream.yml` |
| INFRA-4 | 上游兼容四层防护 | done | P1 | 见 `compatibility.md` |
| INFRA-5 | E2E 资产化 | done | P1 | `e2e/`，lab 50599 |
| INFRA-6 | `npm run status` | done | P1 | 生成 `docs/status.md` |
| INFRA-7 | UAT 脚本与反馈模板 | done | P1 | `docs/uat/` |
| INFRA-9 | 默认分支 `main` → `master` | done | — | 保护规则已上。历史 rounds 里的 `main` 不改 |
| INFRA-10 | 上游 alpha 通道预警 | done | — | 现为 next/alpha 两通道 + 自动 issue。见 `compatibility.md` §3.1 |
| BUG-2 | 缺 `processPathFromHostPath` → 贴图 `TRANSPORT` | done | P1 | [`R14-BUG-2-fix.md`](./rounds/R14-BUG-2-fix.md)。随 `PUB-3` 发布 |
| BUG-3 | 本机目录接错 `workspaces` 服务 | done | P1 | 改接 `uiWorkspace`。[`R15-BUG-3-local-directory.md`](./rounds/R15-BUG-3-local-directory.md) |
| BUG-4 | 宿主项目根探测铸出祖先 jail | done | P1 | 根因：`resolve`/`lstat` 把**探测目标**当 `cwd` 交给 hub，而 `resolveCoreWorkspace` 对不在已声明根里的 cwd 会铸 sibling jail ⇒ 每个祖先各成一份 `--workspace` bind。改为只传 `path`（`CoreRoutingFileSystem`），探测落回会话根 / 机器登记 workspace。事实与证据 [`host-silent-fs.md`](./host-silent-fs.md)；回归 `test/core-routing.test.ts`「BUG-4」（拿掉修复即红）。**真机尾巴**：无 `.git` 的远程会话开一次，`ps` 只该见会话根（+ 机器登记 workspace），不得出现 `/home`、`$HOME` |
| BUG-5 | ssh2 死链打挂宿主（无 error 监听 + keepalive 默认 0） | done | P1 | 根因、修法、回归与**真机验收全在** [`R29-bug5-ssh-error-listener.md`](./rounds/R29-bug5-ssh-error-listener.md)。代码随 PR #21（squash 86f9d6f）进 master |
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
| REQ-I6 | 系统提示英文 + 按需注入 | done | P2 | `ADR-0014`。[`R13-req-i6-and-recon.md`](./rounds/R13-req-i6-and-recon.md) |
| UX-3 | 客户端 UI 统一到宿主 dsh 设计语言 | done | P2 | PR #20 合并（squash 883a99f）。四类界面全量走 `--dsw-*` token + 宿主几何；评审确认 CSS module 内联进 `lib/client.js`、词典 370/370、无宿主半夹带。**真机尾巴**：UAT [`docs/uat/R28-ui-design-language.md`](./uat/R28-ui-design-language.md)（浅/深主题 12 步，第 11 步旧配色哨兵）待跑；`CONN_STATE_COLOR` 收紧拆 `UX-4` |
| REQ-I7 | 副工作区权限档退役 | done | P1 | `ADR-0019`。[`R20-req-i7-permission-retirement.md`](./rounds/R20-req-i7-permission-retirement.md) |
| REQ-I9 | 远端沙箱围栏（runner 原型） | done | P1 | 代码完成，`ADR-0022`。[`R24-session-connections-and-remote-fence.md`](./rounds/R24-session-connections-and-remote-fence.md)。**待用户**：[`uat/R24-req-i9-remote-runner.md`](./uat/R24-req-i9-remote-runner.md)（G1–G3；G1 为否则该主机类退化为审批门 + 低权用户） |
| REQ-I11 | 会话级机器连接（吸收 SEC-5） | done | P1 | 代码完成，`ADR-0021`。同上 R24 报告。**待用户**：[`uat/R24-req-i11-session-connections.md`](./uat/R24-req-i11-session-connections.md) |
| REQ-R6 | 运行时国际化 | done | — | [`R6-i18n.md`](./rounds/R6-i18n.md) |
| REQ-S1 | `sw_exec` | shipped | — | v0.1.1 |
| REQ-S2 | win32 宿主 `bash` | shipped | — | v0.1.1 |
| SEC-5 | `sw_connect` 凭据不得进工具参数 | done | P1 | 随 `REQ-I11` 由结构消除（参数面只剩 `machines[]`）。`SECURITY.md` 红线 1 |
| PUB-1 | 发布 0.1.2 | shipped | P1 | 产物早于依赖对齐，缺口由 `PUB-3` 补 |
| PUB-2 | 3080 换装 0.1.2 | done | P1 | 当时 `link:` 安装；3080 现已不装本插件 |
| PUB-3 | 发布 0.1.3 | shipped | P1 | OIDC；`dependencies` 仅 `ssh2` |
| PUB-4 | 发布 0.1.4 | shipped | P1 | tag `v0.1.4`；OIDC Approve 后 npm 已上。不含 `REQ-I5`（预定 0.2.0）。档案 [`rounds/R25-v0.1.4-release.md`](./rounds/R25-v0.1.4-release.md) |
| UPSTREAM-1 | `readByteRange` | done | P1 | [`R16-upstream-1-byte-range.md`](./rounds/R16-upstream-1-byte-range.md)。双家族窗口随后被 `UPSTREAM-4` 收窄 |
| UPSTREAM-2 | rc.2 槽位重排侦察 | done | P2 | `ADR-0017`；我方槽位未破。读取器 `npm run slots` |
| UPSTREAM-3 | 0.1.5 运行时兼容（F1/F2/F3） | done | P0 | `ADR-0018`。[`R19-f2-shared-api-channel.md`](./rounds/R19-f2-shared-api-channel.md) |
| UPSTREAM-4 | 0.1.2 家族退场 | done | P1 | peer/dev `^0.1.5-rc.1`；哨兵只留 next/alpha |
| AUDIT-3 | 权限门测试 stub 漏方法 | done | P3 | 随 `REQ-I7` 整文件删除，失去对象 |
| AUDIT-6 | 远程命令审批门 + AI 自动放权 | done | P1 | `ADR-0020`。[`R22-audit6-remote-approval-gate.md`](./rounds/R22-audit6-remote-approval-gate.md)。**e2e/UAT 按拍板延后**，与 `REQ-I9` 后统一审视；「e2e 零覆盖」仍算验收缺口，不勾销 |
| INFRA-14 | Upstream drift 假红灯修复（boot smoke 装机缺陷） | done | P2 | 根因：boot smoke 步骤（PR #11 引入）用 `--legacy-peer-deps` 裸装宿主 CLI，漏 `dsh-app-boot` 的非可选 peer `cordis-plugin-group`，宿主启动即 `ERR_MODULE_NOT_FOUND`，next/alpha 两通道同因（issues #7/#9），三条断言从未执行；alpha 家族安装另被 `\| tail` 吞了退出码（对 rc.2 跑却声称 alpha）。修复：CLI 树 `@deepseek-ai/*` 闭合循环 + `pipefail` + 家族锚点断言（装错通道即红）。真 seam 漂移信号（rc.2 静态闸门）全程绿；next 通道实测回绿（run 34950619028），alpha 转真信号 `UPSTREAM-5`。调查档案 `.tmp/drift/report-2026-09-15.md` |

## 5. 明确不做（决策留痕）

| ID | 标题 | 状态 | 优先级 | 备注 |
|---|---|---|---|---|
| REQ-A2 | 向上游提 PR（行级槽位） | dropped | — | `ADR-0011`；改 DOM 增辉层 |
| REQ-X1 | 镜像/同步 | dropped | — | `ADR-0003` |
| REQ-X2 | 审计日志 | dropped | — | `ADR-0004` |
| REQ-X3 | 更新检查 | dropped | — | 上游节奏太快 |
| REQ-X4 | 内嵌侧边栏 | dropped | — | `ADR-0006` |
| SEC-1 | 副根 `fs:r + exec:on` 绕过 | dropped | — | 随 `REQ-I7` 失去对象。调查留 `ADR-0012`（作废） |
| SEC-2 | 主 workdir 写删只读副根 | dropped | — | 同上；围栏改由 `AUDIT-6` / `REQ-I9` 线 |

## 6. AgentTeams 标准轮次（INFRA-8 目标）

| ID | 标题 | 状态 | 优先级 | 备注 |
|---|---|---|---|---|
| INFRA-8a | `dsw-round` profile | blocked | P2 | `docs/agents/dsw-round.yml`；待合入宿主组合 |
| INFRA-8b | `dsw-spike` profile | blocked | P2 | `docs/agents/dsw-spike.yml`；待合入宿主组合 |

---

新增需求先在这里加一行（ID + `todo`）再开工。任何「只在聊天里说过」的待办都不算数。
