# Changelog

所有显著改动记录在此文件，格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)（版本：语义化版本）。

## [0.1.2](https://github.com/DobyChao/dsh-workspace-enhancement) (2026-08-31)

依赖对齐修复与运行时国际化（R6 I18N）：客户端 UI、宿主「远程认知」系统提示与 `sw_*` 工具面三面全量双语（zh/en）。

### 新增

- **R6 I18N（运行时国际化）**：复用框架 `ctx.locale`（LocaleRuntime）与设置页 Language 行，单一共享词典 `src/locale/`（命名空间 `dsw`，zh 键集真源 + en 编译校验，zh/en 各 340 键严格相等）；客户端 UI 全部文案走 `t()`——目录浏览流程、连接/机器表单、设置页、副工作区面板、状态徽标（row-badges 语言切换即时重绘），切换即生效并持久化；宿主语言 = `settings.locale.preference ?? 'en'`（每次求值即时读，settings 可选、无缓存）；`sw_*` 工具描述/13 条参数/输出渲染/错误消息（路线 B description/parameters getter 范式）与远程认知系统提示（sw-remote section）按当前语言组装；机器标记（`[exit code: N]`/`[stderr]`/`[timed out after Nms]` 等）两语逐字节一致；`bad-request:` 协议层诊断与协议/品牌枚举值保持原文。
- **依赖对齐**：`@deepseek-ai` 接缝依赖族对齐 `^0.1.1-rc.2`（dsh-fs/dsh-subprocess/dsh-timeout/dsh-llm 等；对应 0.1.1 发布后的 web profile 依赖诊断），devDeps 增加 `dsh-client-locale`/`dsh-client-ui-slots`/`dsh-settings`（类型源，运行时零新增依赖），`dsh.client.inject` 增 `@deepseek-ai/dsh-client-locale`。

### 质量

- 单测 225/225（含 i18n 22 项：键集全等/模板参数一致/机器标记字节一致/宿主语言解析/localizeTool getter 等，存量 202 零回归）；typecheck 0 错误；硬编码门禁（除词典外中文串 0、英文 UI 抽尽，白名单=注释/日志/库错误透传/协议枚举）通过。
- lab E2E：设置页 Language 行 中文↔English 即时切换（UI/流程/设置/表单双语一致、row-badges 8 枚重绘）、新建远程会话（c1）系统提示与工具面随语言重新组装（会话日志记录 `System Prompt and Tools Updated`）、重启后语言偏好持久；全程隔离 `.dsh-lab`，未触碰真实实例与 `~/.dsh`。

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
