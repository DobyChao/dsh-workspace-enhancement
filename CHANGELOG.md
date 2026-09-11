# Changelog

所有显著改动记录在此文件，格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)（版本：语义化版本）。

## [0.1.4](https://github.com/DobyChao/dsh-workspace-enhancement) (未发布)

0.1.5 家族运行时支持成立 + 浏览器通道换轨到官方 `/api` + **0.1.2 家族退场** +
**副工作区权限档位退役（REQ-I7）**。

### 修复

- **`/dsw` 通道在 `0.1.5` 家族上返回 405（`UPSTREAM-3` F2）**：`ctx.connection.rpc.handle('/dsw', …)` 不可用——`dsh-client-connection` 的 `register` 末行读 `owner.webServer`，而 `owner` 是 **Connection 服务自己的 ctx**，该包在 0.1.5 上只声明 `["credentials"]` ⇒ 抛 `cannot get property "webServer" without inject`，注册**从未发生**（F1 的启动崩溃是它的行级形态，子 fiber 化后就是静默 405）。通道改挂**官方共享 `/api` 的精确 Fetch 路由**（`ctx.connection.fetch.register`）：`rpc.intercept('/api')` 这条官方扩展点被单占位的 `dsh-api-gateway` 占死，而精确路由**先于**拦截器被分发且不读 `owner.webServer`（`dsh-client-file-upload` 同款）。客户端改为 `rpc.call('/api', 'dsw/<endpoint>')`，**信封协议不变**。决策见 `ADR-0018`，实证见 `docs/rounds/R19-f2-shared-api-channel.md`。
- **启动崩溃（`UPSTREAM-3` F1）**：同上根因；换轨后宿主启动不再依赖「哪个上下文能读 `webServer`」。
- **`dsh-subprocess@0.1.5` 的 `@deepseek-ai/dsh-http-proxy` peer 未落盘**：仓库 `.npmrc` 的 `legacy-peer-deps=true` 不会自动装 peer ⇒ 三个套件在 0.1.5 类型面下直接 `ERR_MODULE_NOT_FOUND`；补进 devDependencies。

### 变更（**破坏性**）

- **副工作区权限模型退役，副根降级为薄声明清单（REQ-I7，ADR-0019，用户 2026-09-12 拍板）**：`SideWorkspaceItem` 收缩为 `id/kind/rootKey/label`（删 `fs`/`exec` 字段；加载既有 `dsw-session-workspaces.json` 时忽略旧字段，不报错、不迁移）；删 `mixed.ts` 的 fs 写门与 exec 门（`writeText`/`editText`/`spawn`/`spawnTerminal` 不再因副根档位拒绝；副根路由分支与最长前缀匹配原样保留）；`session.ws.add`/`session.ws.update` RPC 参数收窄（仍带 `fs`/`exec` 的旧客户端请求以 `bad-request` 拒绝）；面板删两个权限下拉（只剩挂/卸 + 显示名）；提示词清单行去掉权限标记、边界注改为无档位表述；词典删 6 键（zh/en 仍严格相等）。`SEC-1`/`SEC-2` 随之 dropped（失去对象），`ADR-0012` 作废。动机：远程主工作区成熟后，远程会话内同机任意绝对路径本就可达，副根对同机目录只剩限权作用，而权限门是 advisory 且有已知绕过。
- **放弃 0.1.2 家族支持（`UPSTREAM-4`，所有者 2026-09-11 拍板）**：peer 13 项 + dev 21 项全部收窄为 `^0.1.5-rc.1`；`upstream.yml` 删除 `legacy`（0.1.2-rc.1）通道，哨兵只剩 `next` / `alpha`；`scripts/boot-smoke.mjs` 的 `--channel-warn`「已知破坏」降级口删除，每通道都强断言。
- **浏览器通道路径变更**：`/dsw/<endpoint>` → `/api/dsw/<endpoint>`（`docs/architecture.md` §5.6）。**与已发布的 0.1.3 客户端半不兼容**；升级宿主必须一并升级本插件。

### 质量

- `scripts/boot-smoke.mjs` 探测改新路径并强断言 `result.ok=true`；新增 `test/web-channel.test.ts`（线身份、信封/方法不符、415/400/404、dispatch 抛错 500、重载契约、端点清单 ↔ dispatch switch 一致性、两半不得再硬编码通道）。
- 真机实证（lab profile + `0.1.5-rc.2` 宿主）：`POST /api/dsw/connections.list → 200, result.ok=true`；同一探针在修前构建上给 405。

## [0.1.3](https://github.com/DobyChao/dsh-workspace-enhancement) (2026-09-09)

依赖对齐发布 + 模型提示词英文化 + 带图请求修复。

### 新增

- **模型提示词英文化与按需注入（REQ-I6）**：model-facing 文案统一英文、不随 UI 语言切换（`prompt.remote.emphasis` / `prompt.side.*` / `prompt.env.missing` / `prompt.section.swExec` / `prompt.section.win32Bash`），且只在会话确有远程事实或副工作区时注入——本地会话的系统提示不再出现本插件文案；词典删 12 键（340→328，zh/en 仍严格相等）。决策见 `ADR-0014`。

### 修复

- **带图请求全部变成 `TRANSPORT`（BUG-2）**：`ctx.fs` 门面 `MixedFileSystem` 只实现了 `dsh-fs` 接缝的 12 个方法，缺第 13 个 `processPathFromHostPath`——图片附件解析正是走 `ctx.get("fs")?.processPathFromHostPath(hostPath)`，贴图必现 `TypeError` 并被适配器包成 `LlmError(TRANSPORT)`（请求根本没出网）。补齐该方法并转发 local 后端（远程世界不共享宿主文件），另加反射式契约用例锁定上游 13 个方法全集，删任一方法即红。
- **测试套件里的 Linux 假设（PR #3）**：新增契约用例用裸 POSIX 路径冒充远程 cwd（`worldOfCwd` 的 `/…`→remote 判定只对 win32 生效），Ubuntu 矩阵红、Windows 绿；改用 `sshRoutesRoot()`。
- **本地 Linux 复验脚本在 Windows 检出下不可执行（FIX-7）**：缺 `.gitattributes` 导致 `scripts/*.sh` 被检出为 CRLF，WSL 里 `set -euo pipefail` 直接报错；补 `*.sh text eol=lf`，并把 WSL 复验写进 push 前必做（`AGENTS.md`）。
- **发布物依赖形态（ADR-0009）**：0.1.2 的 npm 产物仍是旧的 `dependencies` 形态（13 个 `@deepseek-ai/*` 落在 dependencies），本版起 `dependencies` 仅 `ssh2`、宿主共享包全部走 `peerDependencies`（rc 通道）。

### 质量

- 单测 **259 用例**（`npm test`，CI 权威：ubuntu 22/24 + windows 22 矩阵）；typecheck 0 错误；静态闸门 16 项；`npm pack` 冒烟通过。
- 新增 WSL Linux 全量复验通道（`scripts/verify-linux.sh`），push 前必跑。
- 发布改用 **npm Trusted Publishing（OIDC）**：推 `v*` tag 由 GitHub Actions 发布并生成 provenance，不再需要本地 `npm login` 与通行密钥。

### 基建

- 默认分支 `main` → `master`，并加分支保护（必需 CI 检查、禁强推、禁删除）。

## [0.1.2](https://github.com/DobyChao/dsh-workspace-enhancement) (2026-08-31)
（R6 I18N）：客户端 UI、宿主「远程认知」系统提示与 `sw_*` 工具面三面全量双语（zh/en）。

### 新增

- **R6 I18N（运行时国际化）**：复用框架 `ctx.locale`（LocaleRuntime）与设置页 Language 行，单一共享词典 `src/locale/`（命名空间 `dsw`，zh 键集真源 + en 编译校验，zh/en 各 340 键严格相等）；客户端 UI 全部文案走 `t()`——目录浏览流程、连接/机器表单、设置页、副工作区面板、状态徽标（row-badges 语言切换即时重绘），切换即生效并持久化；宿主语言 = `settings.locale.preference ?? 'en'`（每次求值即时读，settings 可选、无缓存）；`sw_*` 工具描述/13 条参数/输出渲染/错误消息（路线 B description/parameters getter 范式）与远程认知系统提示（sw-remote section）按当前语言组装；机器标记（`[exit code: N]`/`[stderr]`/`[timed out after Nms]` 等）两语逐字节一致；`bad-request:` 协议层诊断与协议/品牌枚举值保持原文。
- **依赖对齐**：`@deepseek-ai` 接缝依赖族对齐 `^0.1.1-rc.2`（dsh-fs/dsh-subprocess/dsh-timeout/dsh-llm 等；对应 0.1.1 发布后的 web profile 依赖诊断），devDeps 增加 `dsh-client-locale`/`dsh-client-ui-slots`/`dsh-settings`（类型源，运行时零新增依赖），`dsh.client.inject` 增 `@deepseek-ai/dsh-client-locale`。

### 修复

- **副工作区只读门在 junction / subst / 8.3 短路径下静默失效**（`src/session-workspaces.ts`，`ADR-0013`）：store 用词法 `resolve()` 存 rootKey，而 `ctx.fs` 的本地后端交给门禁的是 realpath 形状的 targetKey —— 同一目录存在两种拼写时前缀匹配落空，写操作被放行且无任何报错。本地根键改为"最近存在祖先的 realpath + 词法尾段"规范化，持久化加载时自动愈合旧记录；新增 junction 回归用例。
- **设置页用户名输入框溢出卡片**（`src/client/machine-form.tsx`）：共享 `inputStyle` 只有 `flex: 1`，缺 `minWidth: 0`——flex 项的 `min-width: auto` 会退回输入框固有宽度（约 169px），在 1440px 视口下用户名输入框越出卡片 13px。补 `minWidth: 0` + `boxSizing: border-box`。
- **`test/mixed-install.test.ts` t6 静默失败**：`@deepseek-ai/dsh-session` 0.1.2-rc.1 移除了 `Session.events`（改为 `ownEvents()` / `snapshotEvents()`），断言自 2026-09-08 起失败而无人察觉（无 CI）。改用 `ownEvents()`。
- **测试污染仓库根目录**：`mixed-install` 的写入探针改为私有临时目录，不再每次 `npm test` 生成 `smoke-install.txt`。
- **npm 包内残留 source map**：`files` 增加 `!**/*.map`，tarball 由 118 文件 / 0.40 MB 降至 80 文件 / 0.26 MB（`pack-smoke` 闸门拦截回归）。

### 质量

- 单测 **238/238**（`npm test`，CI 权威）；沙箱内 `npm run test:agent` 提供可信子集信号；typecheck 0 错误；静态闸门 16 项全过；`npm pack` 冒烟全过。
- 浏览器黑盒：**Playwright 9/9**（`e2e/`，隔离 lab 50599），覆盖启动注入、设置页 zh/en 布局、窄/宽视口换行、副工作区面板主题跟随、语言即时切换、本地会话无远程徽标。
- lab E2E（历史）：设置页 Language 行 中文↔English 即时切换、新建远程会话（c1）系统提示与工具面随语言重新组装、重启后语言偏好持久；全程隔离 `.dsh-lab`，未触碰真实实例与 `~/.dsh`。

## [0.1.1](https://github.com/DobyChao/dsh-workspace-enhancement) (2026-08-26)

跨服务器执行与主工作区命令接缝。

### 新增

- **`sw_exec` 工具**：在指定 `server`（机器 id）上执行命令，缺省 = 本会话主工作区机器。规格与官方 bash/pwsh 对齐（`command` / `description` / `timeoutMs` / `workdir` / `run_in_background`），另按目标机器 OS 判定选择 `bash -c` 或 `pwsh -Command`（`uname` → `cmd /c ver`，结果按连接缓存），输出首行标注 `server: <id> (<user@host>) · OS: …`；后台任务经 `ctx.jobs`（job_output / job_kill 可收集），命中副工作区 `exec: off` 仍被权限门拒绝。
- **win32 宿主补注册 `bash` 工具**：Windows 用户在远程 Linux 主工作区直接使用 bash；本地（Windows）会话下明确报错并引导 pwsh，绝不静默降级。POSIX 宿主不注册（避免与官方冲突）。
- 副工作区提示注入追加：命令默认在主工作区执行，其它服务器请用 `sw_exec(server, command)`。

### 修复

- 中止错误按官方契约归类为 `HarnessError(TOOL_ABORTED)`（name=AbortError），取消不再生成孤儿后台任务（background 注册前 abort 预检）。
- `timeoutMs` 对齐官方 executor 语义：默认 120s、上限 600s（越界钳制），返回值报告生效值。

### 质量

- 单测 202/202（+27），typecheck 0 错误；沙箱验证（sw_exec 真机直调 17/17 场景）；评审 + 复验闭环（Abort 分类 / background 预检 / 超时钳制）。

## [0.1.0](https://github.com/DobyChao/dsh-workspace-enhancement) (2026-08-26)

初始发布：统合 dsh-ssh 与 dsh-remote，把「工作区从哪里来、在哪里、如何被操作」收进一个插件——本地/远程（SSH）工作区、多跳连接、目录选择体验与机器管理，统一命名空间、统一配置、统一 UI。累计 R0.5–R5 七轮开发全部落地并通过真实实例验证。

### 里程碑（R0.5–R5）

- **R0.5** — dsh-ssh 精简引擎独立落地：provider 重构、死代码清除。
- **R0.6** — dsh-remote 最小合并：TOFU 主机指纹、OS 钥匙串、机器注册表、设置页、`sw_*` 模型工具。
- **R1** — 更名抛光：`/dsw` 渠道、`dsw:` 前缀、dsw-routes 新根 + 旧树兼容、边界清理。
- **R2** — UI 统一：共享机器表单 + 会话栏远程标识 / 三态徽标 / 重连。
- **R3** — A1 抛光轮：表单交互守卫、缓存一致性、同名误标修复等。
- **R4** — I2+I4 并轨：远程认知提示 + 混合 provider 真实远程执行 + 执行适配 + 覆盖/编辑修复。
- **R5** — I3：会话关联多工作区（主 cwd 不变 + 副目录，无焦点切换）+ 逐工作区权限（fs 只读/读写 + 执行开关，本地/远程）。

### 特性

- **引擎**：`ctx.subprocess` / `ctx.fs` 混合 provider，按工作目录路由本地/远程；单条 SSH 连接（支持 ProxyJump 多跳）承载 bash / 文件 / PTY（终端）；远端无需安装 DSH。
- **多机注册表**：`remote-workspaces/machines.json` + `ssh://<id>/<path>` 路由；识别 `~/.ssh/config` 别名。
- **安全**：TOFU 主机指纹（`accept-new` / `verify` / `off`，默认 `accept-new`）；凭据存 OS 钥匙串（DPAPI / security / secret-tool），错误信息脱敏；远程命令参数 POSIX 单引号转义。
- **Web UI**：添加工作区（连接侧栏 + 远程目录浏览）、机器设置（CRUD / 测试 / 设为当前 / 忘记指纹）、共享机器表单、会话栏远程标识与三态徽标。
- **模型工具**：`sw_status`、`sw_connect`（含 `save:false` 临时连接）、`sw_pick_workspace`。
- **副工作区**：会话关联多工作区，主 cwd 不变 + 副目录本地/远程，逐副目录权限（fs 只读/读写 + 执行开关），插件自持状态，不动 core。

### 修复 / 抛光

- 侧栏「浏览」picker 只回填、不挂载（方案一）：心智「浏览=辅助填写 → 挂载=提交」。
- 副工作区面板打开即定位到所选机器（`initialConnectionId`），只在匹配机器存在时回填路径。
- 副工作区面板跟随主题，并复用添加工作区的目录选择器。

### 质量

- 单测 175/175（node --test），typecheck 0 错误；每轮 AgentTeams 评审 + 沙箱 E2E 验证 + 真实 3080 实例运行态验证。
- 已知环境要求：远端需安装 pwsh（PowerShell 工具）与 ripgrep（glob）；终端（bash）开箱即用。

### 已知边界 / 后续

- 镜像/同步与审计日志明确不做（审计由会话轨迹替代）。
- A2 上游 PR 已撤销（上游当前不接受 PR；行级徽标由本插件 DOM 增辉层承担）。
- 后续排期：R6（对话/轨迹区可扩展面板 Tab）→ 端口转发（local/reverse + autoStart）→ 顺带清理。详见 [docs/ROADMAP.md](./docs/ROADMAP.md)。
