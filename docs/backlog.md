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

## 2. 已排期（todo，按优先级）

| ID | 标题 | 状态 | 优先级 | 备注 |
|---|---|---|---|---|
| REQ-I14 | 核心部署无感化：连接预热 + 探测翻链 + 首用审批 | todo | P2 | 围栏≠off 时连接后后台 `core.status`→`core.deploy`；升级探测通过才翻 `current`；缺核心首用走 `approval`。红线见 [ADR-0024](./decisions/ADR-0024-remote-core-protocol.md) §3 |
| UPSTREAM-5 | 0.1.6-alpha.1 subprocess 接口漂移 | todo | P2 | 四处加宽导致三实现类失配。收口清单 [ADR-0026](./decisions/ADR-0026-upstream-ssh-runtime.md) §1.2 / §4。验收：alpha 回绿；升 rc 前收口 |
| UPSTREAM-6 | 官方 SSH 运行时定位拍板 + 新包巡检 | todo | P2 | **待所有者**拍 [ADR-0026](./decisions/ADR-0026-upstream-ssh-runtime.md) §5（A/B/C）。代理：新包巡检要会响 |
| INFRA-11 | `link:` 安装的 `lib/` 漂移 | todo | P2 | ① 内容哈希升阻断 ② `restart-3080.ps1` 前 `build`。证据 [R15](./rounds/R15-infra-11-dev-build-drift.md) |
| REQ-A4 | 端口转发（local/reverse + autoStart） | todo | P2 | 移植 dsh-remote forwards。延后见 `ADR-0005` |
| AUDIT-5 | 分组视图下会话子行拿不到 compact 徽标 | todo | P2 | 分组容器改**后代**扫描。证据 [R17](./rounds/R17-rc2-badge-verification.md) §6。勿与 F2、`AUDIT-4` 同 PR |
| UX-1 | 远程会话 composer 显示 `Custom` | todo | P2 | 根因随 ADR-0025 消失。lab 确认 chip 回到 Workspace write 后改 `done`。勿补 `remote-full` |
| UX-5 | 刚添加完机器，编辑页立即出现「请填写主机名」 | todo | P3 | 先查初值 vs 校验时机。验收：打开编辑页零警告，改后或提交时才触发 |
| REQ-I12 | 围栏可见面 + 死字段 `remoteSandboxRunner` | todo | P3 | 剩余：`sw_status` 报档位/探针；徽标接 live `conn.status` |
| INFRA-12 | boot-smoke 成功后不退出 | todo | P3 | 显式 `process.exit`；只清 `dsh-boot-smoke-*`。验收：SMOKE PASS 后 5s 内退出、码 0 |
| AUDIT-1 | 混合门面改为 `extends` 上游基类 | todo | P3 | 防基类新增方法后门面漏实现。证据 R14 审计 O2 |
| AUDIT-2 | 把 `resolveExecutable`「恒本地」写成 ADR | todo | P3 | `architecture.md` §4 已点到；还差 ADR 一句话。证据 R14 O1 |
| REQ-A5 | 顺手清理旧占位树 | todo | P3 | 确认无引用后删旧 `dsh-ssh-routes/` 与 `$DSH_HOME` 归档盘点 |
| AUDIT-4 | 远程状态：判定与渲染合成一份被测函数 | todo | P3 | `remoteCellOf` + 测试改指它（`ADR-0017` §7.6）。不要并进 `AUDIT-5` |
| REQ-I8 | Spike：fork + 换 cwd（norepo 挂工作区） | todo | P3 | 核列表/resume/标题。产出 ADR（可行 → 生命周期；不可行 → fork 留档 + 新会话） |
| UX-4 | `CONN_STATE_COLOR` 状态色 token 化 | todo | P3 | `status.tsx` 仍硬编码 hex。证据 PR #20。验收：双主题走宿主语义 token |
| REQ-I1 | 对话/轨迹区可扩展面板 Tab | todo | P3 | 往后排。走 `conversation.view`（ADR-0016 / 0017）。tab id 进 localStorage，发布后不可改名 |

## 3. 被挡住 / 待拍板（blocked）

| ID | 标题 | 状态 | 优先级 | 备注 |
|---|---|---|---|---|
| SEC-3 | `remote-full` 无二次确认 | blocked | P1 | 上游按 preset **id** 判确认门。`ADR-0011` 已否上游 PR。等 `UX-1` lab 确认 Custom 消失 |
| INFRA-8 | AgentTeams 标准 profile 注册 | blocked | P2 | 配置在 `docs/agents.md`。**需所有者**写入宿主组合（代理不碰产品 profile）。子项 §6 |
| UX-2 | 副工作区面板「浏览」输入框去留 | blocked | P3 | 等用户用几天再定 |
| BUG-1 | 设置页顶部空白边框条 | blocked | P3 | lab 未复现。要浏览器/视口/缩放/主题/语言指纹 |

## 4. 已完成（done / shipped，ID 留作追溯）

事实在 round / ADR；这里只留结果指针。未跑的真机尾巴一句点到脚本。

| ID | 标题 | 状态 | 优先级 | 备注 |
|---|---|---|---|---|
| INFRA-1 | 真相源入库 | done | P0 | `AGENTS.md` + `docs/`。收口见 `INFRA-13` |
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
| BUG-4 | 宿主项目根探测铸出祖先 jail | done | P1 | 只传 `path`。附录 [notes/host-silent-fs.md](./notes/host-silent-fs.md)。尾巴：无 `.git` 远程会话看 `ps` |
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
| REQ-I13 | 远端权限对齐本地 sandbox 提权 | done | P1 | 同 PR #18 / 同一份 UAT R27 |
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

新增需求先在这里加一行（ID + `todo`，放进 §2 对应优先级块）再开工。任何「只在聊天里说过」的待办都不算数。
