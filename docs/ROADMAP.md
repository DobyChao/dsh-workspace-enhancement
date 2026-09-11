# Roadmap — dsh-workspace-enhancement

> 公开进度摘要。**唯一待办真相源是 [`backlog.md`](./backlog.md)**，当前版本与提交见
> [`status.md`](./status.md)（由 `npm run status` 生成）。本文件不另立待办表，避免多处漂移。
> 内部研究与决策记录见 [`architecture.md`](./architecture.md)、[`decisions/`](./decisions/)、[`rounds/`](./rounds/)。

## 现在在哪

- 已发布：**v0.1.1**（npm）。仓库内 `0.1.2` 已代码就绪（依赖对齐修复 + 运行时国际化），待发布。
- 能力面：本地/远程（SSH）工作区统一引擎（`ctx.subprocess` / `ctx.fs` 混合 provider）、
  多机注册表与 `ssh://<id>/<path>` 路由、TOFU 主机指纹、OS 钥匙串、共享机器表单、
  会话栏远程标识与三态徽标、`sw_*` 模型工具（含跨服务器 `sw_exec`）、
  会话关联副工作区（主 cwd 不变 + 逐副目录 `fs`/`exec` 权限）、运行时国际化（zh/en 三面全量）。
- 质量：单测全绿（CI 全量 + 沙箱内可跑子集）、typecheck 0 错误、静态闸门 12 项、
  Playwright 黑盒场景入库、上游漂移哨兵每周跑。
- 已知环境要求：远端需装 `pwsh`（PowerShell 工具）与 `ripgrep`（glob）；终端（bash）开箱即用。

## 接下来

按 [`backlog.md`](./backlog.md) §1/§2 的优先级执行，近期顺序：

1. `PUB-1` 发布 0.1.2 → `PUB-2` 生产实例换装并重启（由仓库所有者执行）
2. `REQ-I1` 对话/轨迹区可扩展面板 Tab（需前端槽位侦察）
3. `REQ-A4` 端口转发 → `REQ-A5` 顺手清理
4. ~~`SEC-1` / `SEC-2` 副工作区权限绕过补强~~（已随 REQ-I7 权限模型退役关闭，见 `ADR-0019`）

## 已完成轮次

| 轮 | 内容 | 状态 |
|---|---|---|
| R0.5 | dsh-ssh 精简引擎独立落地（provider 重构、死代码清除） | ✅ |
| R0.6 | dsh-remote 最小合并（TOFU、钥匙串、机器注册表、设置页、`sw_*` 工具） | ✅ |
| R1 | 更名抛光（`/dsw` 渠道、`dsw:` 前缀、新路由根 + 旧树兼容） | ✅ |
| R2 | UI 统一（共享机器表单 + 会话栏远程标识/三态/重连） | ✅ |
| R3 | 抛光轮（表单交互守卫、缓存一致性、同名误标修复） | ✅ |
| R4 | 远程认知提示 + 混合 provider 真实远程执行 + 执行适配 | ✅ |
| R5 | 会话关联多工作区（副目录）+ 逐工作区权限 | ✅ |
| A3 | 发布 npm v0.1.0 | ✅ |
| S1/S2 | 跨服务器执行 `sw_exec` + win32 宿主 `bash` 接缝 | ✅ v0.1.1 |
| R6 | 运行时国际化（客户端 / 宿主提示 / 工具面 zh+en） | ✅ 0.1.2 待发布 |

每轮的完整事实记录（目标、任务 DAG、验证、遗留）见 [`rounds/`](./rounds/)。

## 已关闭 / 撤销

- 镜像/同步：**不做**（`decisions/ADR-0003`）。
- 审计日志：**不做**（`decisions/ADR-0004`）。
- 更新检查：**不做**（上游节奏过快，无收益）。
- 内嵌侧边栏：**不做**（只对接独立安装的 `dsh-better-sidebar`，`decisions/ADR-0006`）。
- 上游 PR：**撤销**（上游不接受公开 PR，`decisions/ADR-0011`）。
