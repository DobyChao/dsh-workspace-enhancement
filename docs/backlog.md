# Backlog — 唯一待办真相源

> **本文件是项目唯一的待办/需求真相源。** 需求讨论、拍板结论、优先级、状态都成在这里；
> 其它文档（README / ROADMAP / CHANGELOG / rounds）只陈述结果，不得另立待办表。
> 历史研究草稿在本地 `drafts/`（不入库），只作素材；任何结论一旦拍板就落到本文件。
>
> **状态取值**：`todo` 待开工 · `doing` 进行中 · `blocked` 被外部条件挡住 · `done` 代码完成
> · `shipped` 已发布/已上线 · `dropped` 明确不做。
>
> **ID 贯穿**：需求 ID → 提交信息尾行 `Refs: REQ-I3` → 测试名/场景编号 → CHANGELOG 条目
> → `docs/status.md` 计数。改状态就改本文件；状态由 `npm run status` 汇总到看板。

## 1. 当前进行中

| ID | 标题 | 状态 | 优先级 | 备注 |
|---|---|---|---|---|
| INFRA-1 | 真相源入库与结构化（AGENTS.md / docs/ 全量） | done | P0 | architecture/decisions/testing/compatibility/rounds/uat/status 已入库 |
| INFRA-2 | 统一质量门 `npm run check`（typecheck+test+静态闸门+build+pack 冒烟） | done | P0 | 本地与 CI 共用同一命令；另加 `test:agent` 沙箱通道 |
| INFRA-3 | GitHub Actions CI + 上游最新 rc 冒烟 | done | P0 | `.github/workflows/{ci,upstream}.yml`；e2e job 手动触发 |
| INFRA-4 | 上游兼容四层防护（Renovate 分组 / peer 家族闸门 / 兼容矩阵 / 能力探测） | done | P1 | `renovate.json` + check.mjs #6 + `upstream.yml` + `docs/compatibility.md` |
| INFRA-5 | E2E 资产化（Playwright 入库 + 场景目录 + 证据规则） | done | P1 | `e2e/`，9/9 通过（lab 50599）；替代一次性 python 探针 |
| INFRA-6 | 状态看板生成器 `npm run status` | done | P1 | 输出 `docs/status.md`，闸门校验不得过期 |
| INFRA-7 | UAT 脚本与反馈模板 | done | P1 | `docs/uat/`（含 R6 真实示例） |
| INFRA-8 | AgentTeams profile 固化（标准轮次角色与 DAG） | todo | P2 | 见 §5 |

## 2. 已排期（按优先级）

| ID | 标题 | 状态 | 优先级 | 备注 |
|---|---|---|---|---|
| BUG-2 | `MixedFileSystem` 缺 `processPathFromHostPath` → 带图请求全变 `TRANSPORT` | done | P1 | **已修（R14）**：`MixedFileSystem` 补该方法并转发 local 后端（`src/mixed.ts`），`FileSystemBranch` 类型补第 13 个方法；契约回归用例 `test/mixed-fs-contract.test.ts`（反射锁定上游 13 方法全集）+ install/routing 断言；t4 独立探针复刻上游调用式（`dsh-llm-deepseek/lib/index.js:2029` 逐字）验证 fixed/prefix 对照。见 `docs/rounds/R14-BUG-2-fix.md`。**PR #3 补记（2026-09-09）**：新增契约用例里远程 cwd 用了裸 POSIX 路径 `/srv/work`，Ubuntu 红（`worldOfCwd` 的 win32-only 启发式，`src/mixed.ts:122`），已改用 `sshRoutesRoot()`；暴露的根因是本地没有可用的 Linux 复验通道（见 FIX-7）。原记录（现象/根因/验收）如下：**现象**（用户 2026-09-09 报，实机）：给支持图片的模型贴图必现失败，约 10ms 内报 `DeepSeek API stream from … failed`（`TRANSPORT`），请求未出网；纯文本正常。**根因**：`dsh-fs` 接缝实为 **13 个方法**——第 13 个 `processPathFromHostPath(hostPath): string \| undefined`（`dsh-fs/lib/index.js:83` 基类空实现；`dsh-fs/lib/types/index.d.ts:106`）只在「把宿主文件映射进执行世界」时被调，图片附件解析正是这条路径：`dsh-llm-deepseek/lib/index.js:2029` 与 `dsh-llm-pi-ai/lib/index.js:2496` 均为 `resolveImageAccess: (attachments, ref) => resolveImageAttachmentAccess(attachments, (hostPath) => ctx.get("fs")?.processPathFromHostPath(hostPath), ref)`。本插件把 `ctx.fs` 换成 `MixedFileSystem`（`src/plugin.ts:100`），而该类只实现 `FileSystemBranch` 声明的 12 个方法（`src/mixed.ts:190` 类型、`:228-360` 类体），方法缺失 → `TypeError: processPathFromHostPath is not a function`，被适配器包成 `LlmError(…, "TRANSPORT", { cause })`（`dsh-llm-deepseek/lib/index.js:1630`）。**为何闸门没拦住**：`FileSystemBranch` 类型里没有该方法，`tsc` 无从报错；贴图路径此前零覆盖（254 用例无一调用它）。**修法**：`MixedFileSystem` 补该方法并转发给 local 后端——`LocalFileSystem` 有实现（`dsh-fs-local/lib/index.js:716`：`isAbsolute(hostPath) ? resolve(hostPath) : undefined`），`SandboxedFileSystem extends LocalFileSystem` 自动继承，两种 delegate 都覆盖；remote 世界不共享宿主文件，不转发给 `SshFileSystemEngine`；同时把该方法补进 `FileSystemBranch` 类型，否则同样的漏法会再犯。**验收**：① `ctx.get('fs').processPathFromHostPath` 存在，绝对宿主路径返回 local 映射结果、相对路径返回 `undefined`；② 回归用例（建议加在 `test/mixed-install.test.ts` 断言门面暴露该方法且映射正确，`test/mixed-routing.test.ts` 断言不误路由到 remote）；③ lab 内贴图请求成功、不再 `TRANSPORT`；④ `npm run check:static && npm run typecheck && npm run test:agent`。**顺带观察（非阻塞）**：用户报 session 轨迹里看不到 `cause`——修完若仍不可见，另开条目。**发布归属**：随 `PUB-3`（0.1.3）发布；3080 以 `link:` 装本仓库，改完重启即生效 |
| REQ-I1 | 对话/轨迹区可扩展面板 Tab（better-sidecar 式） | todo | P1 | 前置：前端槽位侦察；已否 A2 上游 PR 路线 |
| PUB-1 | 发布 0.1.2（依赖对齐 + i18n） | todo | P1 | 用户 2FA 执行；本地已就绪 |
| PUB-2 | 3080 换装 0.1.2 + 重启 | todo | P1 | 重启由用户执行（`scripts/restart-3080.ps1`） |
| REQ-A4 | 端口转发（local/reverse + autoStart） | todo | P2 | 移植 dsh-remote forwards 语义 |
| REQ-I6 | 系统提示词英文化 + 按工作区状态按需注入 | todo | P2 | 用户 2026-09-09 提出（原话「bug2」）。① **英文化**：model-facing 文案统一英文、不随 UI 语言切换——`prompt.remote.emphasis`/`prompt.side.*`/`prompt.env.missing`（`src/tools.ts` 的 `sw-remote` section）与 `prompt.section.swExec`、`prompt.section.win32Bash`（`src/exec-tools.ts`）；② **按需注入**：无远程事实、无副工作区时 `tool:sw-exec`/`tool:bash` 两段零注入。验收：本地会话系统提示不出现本插件文案；远程会话文案全英文且仅在远程事实成立时出现；`npm run check` 绿。实现时需同步闸门词典规则并补一条 ADR（决策：model-facing 文案不入 i18n） |
| UX-1 | 远程会话 composer 权限预设显示 `Custom` | todo | P2 | 用户 2026-09-09 复现（新建远程工作区会话，权限显示 `Custom`）；推荐方案 A（部署预制表补 `remote-full={sandbox:full, approval:ask}`）；改 `cordis.patch.yml` 需 lab 验证，代理只产出片段不碰产品 profile |
| AUDIT-1 | 混合门面改为 `extends` 上游 Service 基类（防 G1 模式复发） | todo | P3 | R14 契约审计观察 O2：`MixedFileSystem`/`MixedSubprocessRuntime` 是纯对象 `ctx.set` 替换（`src/plugin.ts:96/:100`）而非继承 `dsh-fs` `FileSystem` / `dsh-subprocess` `SubprocessRuntime`——上游基类新增**具现**方法（如 BUG-2 的 `processPathFromHostPath`，`dsh-fs/lib/index.js:83`）时门面会再次缺方法抛错，且无类型报错。证据：`docs/rounds/R14-BUG-2-contract-audit.md` §1/§2 观察项。修法：门面改为 `extends` 对应基类（具现方法自动继承），或维持成员矩阵评审。验收：typecheck 过 + 门面 instanceof 基类 + `npm run check` 绿 |
| AUDIT-2 | `resolveExecutable`「恒本地」世界边界 ADR 化 | todo | P3 | R14 契约审计观察 O1：`MixedSubprocessRuntime.resolveExecutable` 无 cwd 参数、恒走 local（`src/mixed.ts:156-169`）。宿主树未找到调用点（仅 `dsh-subprocess` README:44 示例），当前无影响；未来若有远程会话消费方解析出本地绝对路径，会被 `remoteArgvOf`（`src/mixed.ts:134`）削成裸名自愈。修法：ADR 一句话记录该边界即可（文档）。证据：`docs/rounds/R14-BUG-2-contract-audit.md` §2 O1 |
| AUDIT-3 | `test/side-workspace-gates.test.ts` 的 `stubFs` 补 `processPathFromHostPath` | todo | P3 | t2 报备：`FileSystemBranch` 补第 13 方法后，该文件的 `FileSystemBranch` 字面量 stub（`test/side-workspace-gates.test.ts:37`）缺新方法。当前无害（tsconfig 只 include `src`，测试不参与 typecheck；该文件只测 resolve/lstat/成闸门，不会走到该方法）。修法：stub 补一行 `processPathFromHostPath: () => undefined`。验收：stub 与 `FileSystemBranch` 类型形状一致 |
| REQ-A5 | 顺手清理（旧 `dsh-ssh-routes/` 占位树、`$DSH_HOME` 归档盘点） | todo | P3 | 确认无引用后人工清理 |
| REQ-I5 | 远期：vscode-server 式「把部分 DSH 能力部署到远端」 | todo | P4 | 愿景备忘，未排期 |

## 3. 被挡住 / 待拍板

| ID | 标题 | 状态 | 优先级 | 备注 |
|---|---|---|---|---|
| SEC-1 | 副工作区 `fs:只读 + exec:开` 可被 `workdir` 命令绕成 | blocked | P1 | 待用户拍板；候选 a 提示强化 / b 门层拒绝该组合 / c UI 联动 / d 文档边界。见 `docs/decisions/ADR-0012` |
| INFRA-8 | AgentTeams 标准 profile 注册 | blocked | P2 | 契约与可粘贴配置已入库（`docs/agents.md`）；**需仓库所有者**把 `profiles:` 合入宿主组合并重启（代理不碰产品 profile） |
| SEC-2 | 主 workdir 命令可成/删只读副工作区（命令面无围栏） | blocked | P2 | 同上，属 SSH 固有 + 沙箱档位边界 |
| UX-2 | 副工作区面板「浏览」输入框去留 | blocked | P3 | 等用户实际使用几天后再定 |
| BUG-1 | 用户截图「设置页顶部空白边框条」lab 未复现 | blocked | P3 | 需用户环境指纹（浏览器/视口/缩放/主题/语言）才能复现 |

## 4. 已完成（保留 ID 以便追溯）

| ID | 标题 | 状态 | 优先级 | 备注 |
|---|---|---|---|---|
| REQ-I2 | SSH 工作区终端/文件按对应系统唤起 | done | — | R4 达成（PTY/fs 透明走远程） |
| REQ-I3 | 单 session 关联多工作区（副目录）+ 逐工作区权限 | done | — | R5 上线 |
| REQ-I4 | 远程焦点时模型认知保证 | done | — | R4：系统提示 + 状态注入 |
| REQ-S1 | `sw_exec` 跨服务器执行 | shipped | — | v0.1.1 |
| REQ-S2 | win32 宿主 `bash` 接缝 | shipped | — | v0.1.1 |
| REQ-R6 | 运行时国际化（客户端/宿主提示/工具面 zh+en） | done | — | 0.1.2 待发布 |
| REQ-DEP | `@deepseek-ai/*` 家族对齐 rc 通道 | done | — | 0.1.2 待发布；peer 家族闸门已自动化 |
| REQ-A3 | 首次发布 npm v0.1.0 | shipped | — | 2026-08-26 |
| FIX-1 | `dsh-session` 0.1.2-rc.1 移除 `Session.events` 导致 t6 静默失败 | done | — | 2026-09-08 起坏了 2 天无人发现；CI 建立当日定位并修复（改用 `ownEvents()`）。见 `docs/compatibility.md` §2 |
| FIX-2 | 设置页用户名输入框溢出卡片 13px（`inputStyle` 缺 `minWidth: 0`） | done | — | E2E-02 首跑抓到；`d30dc57` 修复的残留。见 `src/client/machine-form.tsx` |
| FIX-3 | npm 包内含 source map（118 文件 / 0.40 MB） | done | — | `pack-smoke` 首跑抓到；`files` 加 `!**/*.map` 后 80 文件 / 0.26 MB |
| FIX-4 | 测试套件的 Windows 假设让 Linux CI 首跑全红 | done | — | 三处：模块顶层抛错的 PowerShell 解析、两处硬编码 `\\`、`AUDIT-TC08` 大小成归一。CI 矩阵已加 `windows-latest`；Linux 侧先在 WSL 复验 |
| FIX-5 | 只读门在 junction / subst / 8.3 短路径下静默失效 | done | — | **安全相关**：store 存词法路径、fs 层给 realpath → 前缀匹配落空。Windows CI 的 `%TEMP%` 就是这种拼成。根键改为 realpath 规范化（见 `ADR-0013`），并加 junction 回归用例 |
| FIX-6 | PR 标题非 Conventional → 合并后 main 必红 | done | — | squash 合并用 PR 标题当提交标题，而闸门校验 HEAD 标题；PR 上绿、合并后红。新增 `PR title (squash subject)` 作业在合并前拦截，闸门报错文案补充指引 |
| FIX-7 | `scripts/*.sh` 在 Windows 检出为 CRLF → 本地 Linux 复验形同虚设 | done | — | **本轮实锤**：仓库无 `.gitattributes`，Git for Windows 默认 `core.autocrlf=true` 把 `verify-linux.sh` 检出成 CRLF，WSL 里 `bash verify-linux.sh` 在 `set -euo pipefail` 直接报 `set: pipefail: invalid option name`（`git ls-files --eol` = `i/lf w/crlf`）。后果：本仓库唯一能本地抓 Linux-only 缺陷的通道**从未真正跑过**，PR #3 的 Ubuntu 红因此溜到 push 之后。修法：新增 `.gitattributes`（`*.sh text eol=lf`）并重新检出两个脚本，`bash -n` 通过；AGENTS.md §3/§7 已把「改测试/跨平台代码 → push 前跑 WSL 复验」写成必做 |
| INFRA-9 | 默认分支 `main` → `master` + 分支保护 | done | — | 2026-09-09 用户要求。① 引用改名：`.github/workflows/ci.yml` push 触发器、`AGENTS.md`/`CONTRIBUTING.md` 分支模型与流程、`scripts/status.mjs` 改为从 `origin/HEAD` 解析上游（回退 `origin/master` / `origin/main`）；② GitHub 侧：默认分支切到 `master`、删除远端 `main`；③ 保护规则：必需 4 个 CI 检查（ubuntu 22/24 + windows 22 + PR title）、禁强推、禁删除、`enforce_admins=false`（owner 仍可直推急修）。历史报告 `docs/rounds/*` 里的 `main` 保留原样（当时事实） |

## 5. 明确不做（决策留痕）

| ID | 标题 | 状态 | 优先级 | 备注 |
|---|---|---|---|---|
| REQ-X1 | 镜像/同步（sync/ignore/tasks/mirror） | dropped | — | 用户拍板：完全放弃 |
| REQ-X2 | 审计日志 | dropped | — | 会话轨迹已足够 |
| REQ-X3 | 更新检查 | dropped | — | 上游节奏太快，无收益 |
| REQ-X4 | 内嵌侧边栏 | dropped | — | 只对接独立安装的 dsh-better-sidebar |
| REQ-A2 | 向上游提 PR（行级槽位） | dropped | — | 上游不接受公开 PR；改由 DOM 增辉层承担 |

## 6. AgentTeams 标准轮次（INFRA-8 目标）

| ID | 标题 | 状态 | 优先级 | 备注 |
|---|---|---|---|---|
| INFRA-8a | `dsw-round` profile：需求→实现→验证→评审→集成 | blocked | P2 | 配置片段 `docs/agents/dsw-round.yml`；待合入宿主组合 |
| INFRA-8b | `dsw-spike` profile：只做侦察与设计，不成实现 | blocked | P2 | 配置片段 `docs/agents/dsw-spike.yml`；待合入宿主组合 |

---

**维护约定**：新增需求先在这里加一行（ID + 状态 `todo`），再开工；状态变化立即改本行；
发布后在 CHANGELOG 与 `docs/rounds/` 留记录。任何"只在聊天里说过"的待办都不算数。
