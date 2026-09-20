# 项目状态（生成文件，请勿手改）

> 由 `npm run status` 从 git / package.json / test/ / docs/backlog.md 生成。
> 生成时间：2026-09-20 14:50 UTC · 唯一待办真相源：`docs/backlog.md`

## 版本与提交

| 项 | 值 |
|---|---|
| package.json 版本 | `0.2.1` |
| npm 已发布版本 | `0.2.0` |
| 最新 tag | `v0.2.0` |
| 分支 / HEAD | `chore/PUB-6-v0.2.1` / `a67196e` |
| HEAD 提交 | `feat(remote): degrade confined reads to SFTP and inject win32 bash per workspace (#28)` (2026-09-20) |
| 与远端 | in sync with origin/master |

## 质量

| 项 | 值 |
|---|---|
| 单测文件 | 48 |
| 单测用例（静态计数） | 585 |
| E2E 场景文件 | 8 |
| ADR | 27 |
| 轮次报告 | 37 |

## 待办分布（docs/backlog.md）

| 状态 | 数量 |
|---|---|
| `todo` | 17 |
| `doing` | 0 |
| `blocked` | 6 |
| `done` | 51 |
| `shipped` | 8 |
| `dropped` | 7 |

## 被挡住 / 待拍板

- SEC-3 — `remote-full` 无二次确认
- INFRA-8 — AgentTeams 标准 profile 注册
- UX-2 — 副工作区面板「浏览」输入框去留
- BUG-1 — 设置页顶部空白边框条
- INFRA-8a — `dsw-round` profile
- INFRA-8b — `dsw-spike` profile

## 质量门

| 命令 | 作用 | 谁能跑 |
|---|---|---|
| `npm run check` | 静态闸门 + typecheck + 单测 + build + pack 冒烟 | CI / 本地 shell |
| `npm run test:agent` | 单进程单测（无 esbuild，沙箱内可跑） | 代理 |
| `npm run e2e` | Playwright 黑盒验收（lab 实例） | 本地 shell / CI |
| `npm run status` | 重新生成本文件 | 任何人 |

---

改动状态请改 `docs/backlog.md`，然后重跑 `npm run status`；本文件由 CI 校验不得过期。

> 说明：HEAD / tag / 待办分布以**生成时刻**为准，提交后重跑一次即可刷新（版本号与待办分布由闸门校验）。
