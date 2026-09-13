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

## 2. 已排期（todo，按优先级）

| ID | 标题 | 状态 | 优先级 | 备注 |
|---|---|---|---|---|
| REQ-I5 | 远端「一个核心」（执行围栏 + 远端读写） | todo | P1 | **主线。** 范围只认 `ADR-0023`（2026-09-13 补拍：读写纳入核心，不再后置）。一个可校验产物；远程 `ctx.fs` 在围栏档改走核心 RPC（不再 SFTP）；spawn 由核心在同一 jail 里起；打包 `rg`。v1 = Linux。退路 = 审批门 + 低权用户，且 fs 与 spawn 一齐拒绝。验收在 ADR §4 |
| INFRA-11 | `link:` 安装的 `lib/` 漂移 | todo | P2 | 已有非阻断 mtime WARN。**待做**：① 改内容哈希/构建戳再升级为阻断（PR #14 已证明纯 mtime 假阳性）；② `restart-3080.ps1` 重启前 `npm run build`。证据 [`rounds/R15-infra-11-dev-build-drift.md`](./rounds/R15-infra-11-dev-build-drift.md)。验收：改 `src/` 不 build 必提示；正常重建不误报 |
| REQ-A4 | 端口转发（local/reverse + autoStart） | todo | P2 | 移植 dsh-remote forwards。延后决定见 `ADR-0005` |
| REQ-I10 | 日落 `sw_pick_workspace` | todo | P2 | 删工具 + 8 个词典键；`sw_connect`/`sw_status` 文案改诚实（工作区由添加流/设置页管理）；短 ADR 取代 `ADR-0001` 的四工具终态。验收：`src/` 无该符号（docs 历史除外）+ `check:static`/`typecheck`/`test:agent`/`build`/`boot-smoke --no-channel` |
| AUDIT-5 | 分组视图下会话子行拿不到 compact 徽标 | todo | P2 | 修法：兄弟扫描 → 分组容器内**后代**扫描。证据与精确补丁 [`rounds/R17-rc2-badge-verification.md`](./rounds/R17-rc2-badge-verification.md) 第一部分 §6。不要跟「文案停在未检测」搞混（那是已修的 F2）。两代共有，非 rc.2 回归。不要和 `AUDIT-4` 混在同一 PR |
| REQ-I12 | 围栏可见面 + 死字段 `remoteSandboxRunner` | todo | P3 | 围栏语义已落地（`REQ-I9`）。剩余：① `sw_status` 报档位/探针；② 拒写回显 `sandboxDenialMarker`；③ 徽标接 live `conn.status`；④ **死配置**：围栏读 `machine.remoteSandboxRunner`，注册表从未存过 → 恒为 PATH 上的裸 `bwrap`。④ 必须接进注册表或删掉，不能留着装可配。win32 `bash` 拒绝文案不要套 `sw_exec` 前缀 |
| INFRA-12 | boot-smoke 成功后不退出 | todo | P3 | 收尾补显式 `process.exit`；清理只删 `dsh-boot-smoke-*` 子目录、勿删父 temp。证据 R20/R22。验收：SMOKE PASS 后 5s 内自行退出、码 0 |
| AUDIT-1 | 混合门面改为 `extends` 上游基类 | todo | P3 | 防 BUG-2 那种「基类新增具现方法、门面纯对象漏方法」。证据 [`rounds/R14-BUG-2-contract-audit.md`](./rounds/R14-BUG-2-contract-audit.md) O2。验收：门面 `instanceof` 基类 + `check` 绿 |
| AUDIT-2 | 把 `resolveExecutable`「恒本地」写成 ADR | todo | P3 | 文档项。`architecture.md` §4 已点到；还差 ADR 一句话。证据 R14 审计 O1。当前无运行时影响 |
| REQ-A5 | 顺手清理旧占位树 | todo | P3 | 确认无引用后删旧 `dsh-ssh-routes/` 与 `$DSH_HOME` 归档盘点 |
| AUDIT-4 | 远程状态：判定与渲染合成一份被测函数 | todo | P3 | `showsRemoteStatus` 零调用者；渲染看 `remote-status-entry.tsx`。修法：`remoteCellOf` + 测试改指它（`ADR-0017` §7.6）。不要并进 `AUDIT-5` |
| REQ-I8 | Spike：fork + 换 cwd（norepo 挂工作区） | todo | P3 | 用 `ctx.sessionPersistence` 拼带历史的新 cwd。核三件事：列表是否出现、能否 resume、标题/投影。产出 ADR（可行 → 工作区生命周期；不可行 → fork 留档 + 新会话） |
| REQ-I1 | 对话/轨迹区可扩展面板 Tab | todo | P3 | **往后排**（2026-09-13：先做核心）。走 `conversation.view`（`ADR-0016`；`ADR-0017` §7）。tab id 进 localStorage，发布后不可改名。不要改走右侧面板 Tab |

## 3. 被挡住 / 待拍板（blocked）

| ID | 标题 | 状态 | 优先级 | 备注 |
|---|---|---|---|---|
| SEC-3 | `remote-full` 无二次确认 | blocked | P1 | 上游客户端按 preset **id** 判确认门，不看 sandbox 档。插件无干净入口（`ADR-0011` 已否上游 PR）。UX-1 方案 A 的已知副作用，不阻塞 A，但落地前用户要知情。等拍板：放弃方案 A，或接受文档警示 |
| INFRA-8 | AgentTeams 标准 profile 注册 | blocked | P2 | 配置已在 `docs/agents.md`。**需所有者**写入宿主组合并重启（代理不碰产品 profile） |
| UX-1 | 远程会话 composer 显示 `Custom` | blocked | P2 | 修法只在 `ADR-0015`（用户改 `cordis.patch.yml` 补 `remote-full`）。代理无剩余动作。副作用见 `SEC-3` |
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
| UPSTREAM-1 | `readByteRange` | done | P1 | [`R16-upstream-1-byte-range.md`](./rounds/R16-upstream-1-byte-range.md)。双家族窗口随后被 `UPSTREAM-4` 收窄 |
| UPSTREAM-2 | rc.2 槽位重排侦察 | done | P2 | `ADR-0017`；我方槽位未破。读取器 `npm run slots` |
| UPSTREAM-3 | 0.1.5 运行时兼容（F1/F2/F3） | done | P0 | `ADR-0018`。[`R19-f2-shared-api-channel.md`](./rounds/R19-f2-shared-api-channel.md) |
| UPSTREAM-4 | 0.1.2 家族退场 | done | P1 | peer/dev `^0.1.5-rc.1`；哨兵只留 next/alpha |
| AUDIT-3 | 权限门测试 stub 漏方法 | done | P3 | 随 `REQ-I7` 整文件删除，失去对象 |
| AUDIT-6 | 远程命令审批门 + AI 自动放权 | done | P1 | `ADR-0020`。[`R22-audit6-remote-approval-gate.md`](./rounds/R22-audit6-remote-approval-gate.md)。**e2e/UAT 按拍板延后**，与 `REQ-I9` 后统一审视；「e2e 零覆盖」仍算验收缺口，不勾销 |

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
