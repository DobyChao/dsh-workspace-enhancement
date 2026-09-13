# Roadmap — dsh-workspace-enhancement

> 公开进度摘要。**唯一待办真相源是 [`backlog.md`](./backlog.md)**，当前版本与提交见
> [`status.md`](./status.md)（由 `npm run status` 生成）。本文件不另立待办表，避免多处漂移。
> 内部研究与决策记录见 [`architecture.md`](./architecture.md)、[`decisions/`](./decisions/)、[`rounds/`](./rounds/)。

## 现在在哪

- 已发布：**v0.1.3**（npm，OIDC 信任发布 + provenance）。当前 `package.json` 版本 `0.1.3`。
- 能力面：本地/远程（SSH）工作区统一引擎（`ctx.subprocess` / `ctx.fs` 混合 provider）、
  多机注册表与 `ssh://<id>/<path>` 路由（**REQ-I11 起为注册表级**：任何注册机器的路径都能解析）、
  TOFU 主机指纹、OS 钥匙串、共享机器表单、会话栏远程标识与三态徽标、
  会话级机器连接（`sw_connect(machines)` + 面板驾驶舱 + 运行时上下文中插）、`sw_*` 模型工具（含 `sw_exec`）、
  会话关联副工作区（REQ-I7 起为**薄声明清单**，无权限档位，见 `ADR-0019`）、
  逐机器远程沙箱围栏（`remoteSandbox: off|read-only|workspace-write`，fail-closed，见 `ADR-0022`）、
  运行时国际化（zh/en 三面全量）。
- 质量：单测 420 例（CI 全量 + 沙箱内可跑子集）、typecheck 0 错误、静态闸门、Playwright 黑盒场景入库、
  上游漂移哨兵每周跑、真 boot 哨兵（`boot-smoke`）。
- **远端前置（现状 → 方向）**：现状要用户在远端装 `pwsh`（PowerShell 工具）、`ripgrep`（glob）
  与 `bwrap`（围栏 runner）；**方向是收敛为一个核心**——远端只需部署一个可校验产物，
  由插件负责上传/校验/升级（`ADR-0023`，载体 `REQ-I5`）。核心落地前，本文与提示词都不得宣称「已围栏」。

## 接下来

按 [`backlog.md`](./backlog.md) §2 的优先级执行。**主线 = `REQ-I5`（远端「一个核心」，C 路线，`ADR-0023`）**：
把远端「装 pwsh / ripgrep / bwrap」三项收敛为**部署一个可校验产物**，其中 runner（围栏）优先，
`rg` 随核心就位，完全体再加远端 fs 服务以覆盖 fs 写面。

近期顺序（不另立待办表，以 backlog 为准）：

1. **真机验收**（由仓库所有者执行，缺一不可）：`docs/uat/R23-req-i11-session-connections.md`（15 步）、
   `docs/uat/R23-req-i9-remote-runner.md`（11 步 + G1–G3 可行性门）；
2. `REQ-I12` 围栏可见面收尾（`sw_status` 报围栏结论、拒写标记、徽标接实时 feed、死字段 `remoteSandboxRunner` 处置）；
3. `AUDIT-6` 的 e2e / UAT 尾巴（按用户拍板延后到 REQ-I9 之后统一审视）；
4. `REQ-I5` 开工前的两个前置决定：核心产物的**供应链**（来源/签名/校验和）与**架构覆盖**（x86_64 / aarch64）。

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
| R6 | 运行时国际化（客户端 / 宿主提示 / 工具面 zh+en） | ✅ |
| R13 | 系统提示英文化 + 按需注入（REQ-I6） | ✅ |
| R14/R15 | 契约审计修复：`processPathFromHostPath`（BUG-2）、`lib/` 漂移闸门（INFRA-11） | ✅ |
| R17/R19 | rc.2 槽位重排侦察 / 0.1.5 家族运行时兼容（F1 启动崩溃 + F2 通道 405 + F3 哨兵） | ✅ |
| R20 | 副工作区简化：权限档位退役（REQ-I7，`ADR-0019`） | ✅ |
| R21/R22 | 远程命令审批门 + AI 自动放权（AUDIT-6，`ADR-0020`） | ✅ 真机尾巴待做 |
| R23 | 会话级机器连接与远程工具门控（REQ-I11，吸收 SEC-5）+ 远端沙箱围栏（REQ-I9） | ✅ 代码完成，真机待验 |

> R23 的评审由 **GLM-5.3** 完成（首轮 `needs_revision`：1 blocker + 3 major，全部修复后复审 `pass`）。
> 完整事实见 [`rounds/R23-session-connections-and-remote-fence.md`](./rounds/R23-session-connections-and-remote-fence.md)。

每轮的完整事实记录（目标、任务 DAG、验证、遗留）见 [`rounds/`](./rounds/)。

## 已关闭 / 撤销

- 镜像/同步：**不做**（`decisions/ADR-0003`）。
- 审计日志：**不做**（`decisions/ADR-0004`）。
- 更新检查：**不做**（上游节奏过快，无收益）。
- 内嵌侧边栏：**不做**（只对接独立安装的 `dsh-better-sidebar`，`decisions/ADR-0006`）。
- 上游 PR：**撤销**（上游不接受公开 PR，`decisions/ADR-0011`）。
