# 轮次索引（Round Reports）

> 本目录是**入库的轮次事实档案**：每一轮做了什么、任务怎么拆的、怎么验的、交付了什么、还剩什么。
> 事实来源仅限仓库内的权威来源（见文末「来源清单」），不补充任何来源之外的推断。
> 设计草稿与决策记录仍在 `drafts/`（不入库）；面向用户的进度概览见 [docs/ROADMAP.md](../ROADMAP.md)。

## 1. 轮次总表

| 轮次 | 主题 | 状态 | 关键产出 | 报告文件 |
|---|---|---|---|---|
| R0.5 | dsh-ssh 精简版独立落地（删死代码、提取共享核心） | ✅ 上线 | `src/ssh-core.ts`、`src/listing.ts`、精简 `runtime/connection`、`scripts/dev-lab.ps1` | [R0.5.md](./R0.5.md) |
| R0.6 | dsh-remote 最小合并（TOFU、钥匙串、机器注册表、设置页、`sw_*` 工具） | ✅ 上线 | `src/hostkey.ts`、`src/credential.ts`、machines 注册表、3 个 `sw_*`、`src/client/settings.tsx` | [R0.6.md](./R0.6.md) |
| R1 | 抛光轮：5 项已知边界 + 更名 + 清理 | ✅ 上线 | `/dsw` 渠道、`dsw:` 前缀、`dsw-routes` 新根（旧树兼容） | [R1.md](./R1.md) |
| R2 | UI 统一轮（共享机器表单 + 会话栏远程标识/三态/重连） | ✅ 上线 | 共享 `MachineForm`、`row-badges`、`/dsw/conn.{status,probe,reconnect}` | [R2.md](./R2.md) |
| R3 | A1 抛光轮（P2 四项 + F2 + C3 同名误标） | ✅ 上线 | inflight 键控、跳板校验、busy 守卫、编辑态认证保留、同名不误标 | [R3.md](./R3.md) |
| R4 | I2 + I4 并轨（远程认知提示 + 混合 provider 真实远程执行） | ✅ 上线 | `sw-remote` 提示 section、`src/mixed.ts`、执行适配层、覆盖/编辑修复 | [R4.md](./R4.md) |
| R5 | I3：会话关联多工作区（副目录）+ 逐工作区权限 | ✅ 上线 | `dsw-session-workspaces.json`、`sideWorkspaceOf`、副工作区面板 | [R5.md](./R5.md) |
| R5 打磨 | 三轮打磨：UI 主题化/复用 flow 浏览 + 浏览交互方案一 + README 品类化 | ✅ 上线 | 提交 `9b38349`、`8fad1fa`、README（EN/ZH） | [R5-polish.md](./R5-polish.md) |
| A3 | 发布 npm `v0.1.0` | ✅ 已发布 | 103 文件 pack 预检、lab tarball 冒烟、tag `v0.1.0` | [R-A3-release.md](./R-A3-release.md) |
| S1+S2 | 跨服务器执行 `sw_exec` + win32 宿主 `bash` 接缝（`v0.1.1`） | ✅ 已发布 | `src/exec-tools.ts`、真跑 17/17 | [R-S1-S2.md](./R-S1-S2.md) |
| R6（I18N） | 运行时国际化：客户端 UI / 远程认知提示 / `sw_*` 工具面三面双语 | ✅ 代码完成（`0.1.2` 待发布） | `src/locale/`（340 键）、设置页 Language 行、`row-badges` 就地重绘 | [R6-i18n.md](./R6-i18n.md) |
| INFRA-1 | 工程化基建改造（真相源入库 / 统一质量门 / CI / 上游追踪 / E2E 资产化 / 状态看板 / UAT） | ✅ 完成（本地提交） | `AGENTS.md`、`docs/`（含 12 ADR、12 轮报告、UAT）、`e2e/`（9/9）、`.github/workflows/`、`scripts/{check,status,test-agent,pack-smoke}.mjs` | [INFRA-1.md](./INFRA-1.md) |

| R13 | REQ-I6 系统提示词英文化/按需注入 + UX-1、REQ-I1 侦察 + 发布事实校正 | ✅ 代码完成（本地提交） | `src/model-prompts.ts`、`src/session-remote-context.ts`、`ADR-0014..0016`、`AGENTS.md` §5 磁盘等价物、`PUB-3`/`SEC-3` | [R13-req-i6-and-recon.md](./R13-req-i6-and-recon.md) |

**尚未开工的轮次**（来源里只有排期，故无报告）：R6 I1（对话/轨迹区可扩展面板 Tab，📋 排期；
前置槽位侦察已于 R13 完成，见 `ADR-0016`）、
A4 端口转发（排后）、A5 顺手清理（排后）。**已撤销/不做**：A2 上游 PR（撤销）、镜像/同步与审计日志（明确不做）。

## 2. 每份报告的固定五段

每份 `R*.md` 结构一致，便于横向对比与接手：

| 段 | 内容 |
|---|---|
| **目标** | 这一轮要解决什么（一句话 + 需求 ID，如 I3 / A1 / S1） |
| **拆解** | 任务 DAG：任务主题 + 依赖关系 + 角色（自 `.agent-teams/archive/*/team.json` 提炼，非原文照抄） |
| **验证** | 单测数、typecheck、E2E / 真机验证结论、评审结论（approve / needs-fix → 修复后通过） |
| **结果** | 交付了什么、是否上线 / 发布（含版本号与 commit 短 sha，仅写来源里有的） |
| **遗留** | 已知边界、未决项、后续轮次引用 |

末行固定为 `来源：<文件>`。

## 3. 脱敏约定（公开仓库）

本目录所有文档已按公开仓库要求脱敏，占位符含义：

| 占位符 | 含义 |
|---|---|
| `user@host` / `user@192.0.2.10:22` | 测试用 SSH 连接（真实主机名/用户名已替换） |
| `127.0.0.1:50599` | 本机回环 lab 地址（非敏感，按原样书写） |
| `<fingerprint>` | 主机指纹（TOFU 记录值） |
| `%DSH_HOME%` | 真实 DSH 数据根目录 |
| `$LAB_HOME` | lab 隔离根（`scripts/dev-lab.ps1` 的 `$LabHome`，同时作为该实例的 `DSH_HOME`） |
| `<repo>` | 本仓库绝对路径 |
| `<host>` | 远程主机名 |

自检命令（命中数必须为 0；两条模式分别命中「真实用户名 @ 主机」与「私钥块头」。
模式本身做了转义拼接，以免自检脚本把自己的命令串判为命中）：

```bash
grep -nE 'uu''z@|BEGIN[ ].*PRIVATE' docs/rounds/*.md docs/uat/*.md
```

## 4. 来源清单

> 下表部分来源（`drafts/`、`.agent-teams/`）是**本地工作素材，不入库**：本目录的报告是它们的
> 提炼产物，clone 后只能看到报告本身。这是有意的——草稿可能含机器专属数据。

| 来源 | 用途 |
|---|---|
| `drafts/CONTEXT.md` | §0 进度快照、§6.1 已完成轮次（R0.5/R0.6/R1–R5 详细事实）、§6.2 后续轮候选、§7 风险与开放问题 |
| `docs/ROADMAP.md` | 公开路线图表（已完成轮次、下一步、已关闭项） |
| `CHANGELOG.md` | 各版本质量与特性记录（0.1.0 / 0.1.1 / 0.1.2） |
| `drafts/ideas.md` | 需求 I1–I5、工程遗留 A1–A5 与拍板记录 |
| `.agent-teams/archive/*/team.json` | 12 轮 AgentTeams 的真实任务 DAG、角色、评审结论 |
| `.agent-teams/archive/*/inbox/captain.jsonl` | 各轮上报细节（提交 sha、E2E 断言、部署验证） |
| `AGENTS.md` §8 | 当前状态与接手三分钟 |

## 5. 来源不足的标注

以下位置在权威来源中缺信息，报告内以「来源不足」显式标注，不做补写：

- **R0.5** 未记录单测数量（该轮以 typecheck / build / 评审 / E2E 为门）。
- **R5 打磨第三项（README 品类化 + 人性化）** 无 AgentTeams 归档，只有 ROADMAP 与 CONTEXT 的结果性记录。
- **A3 发布轮的 tag 指向** 存在来源口径差异（见 `R-A3-release.md` 遗留）。
- **R6** 的本地分支名未记录（提交明确为「仅本地、未 push」）。
