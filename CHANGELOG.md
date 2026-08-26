# Changelog

所有显著改动记录在此文件，格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)（版本：语义化版本）。

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
