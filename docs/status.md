# 项目状态（生成文件，请勿手改）

> 由 `npm run status` 从 git / package.json / test/ / docs/backlog.md 生成。
> 生成时间：2026-09-13 11:05 UTC · 唯一待办真相源：`docs/backlog.md`

## 版本与提交

| 项 | 值 |
|---|---|
| package.json 版本 | `0.1.4` |
| npm 已发布版本 | `0.1.3` |
| 最新 tag | `v0.1.4` |
| 分支 / HEAD | `feat/REQ-I5-remote-core` / `ee25ed1` |
| HEAD 提交 | `chore: prepare npm v0.1.4 release (#17)` (2026-09-13) |
| 与远端 | in sync with origin/master |

## 质量

| 项 | 值 |
|---|---|
| 单测文件 | 38 |
| 单测用例（静态计数） | 492 |
| E2E 场景文件 | 8 |
| ADR | 24 |
| 轮次报告 | 29 |

## 待办分布（docs/backlog.md）

| 状态 | 数量 |
|---|---|
| `todo` | 12 |
| `doing` | 2 |
| `blocked` | 7 |
| `done` | 36 |
| `shipped` | 5 |
| `dropped` | 7 |

## 被挡住 / 待拍板

- SEC-3 — `remote-full` 无二次确认
- INFRA-8 — AgentTeams 标准 profile 注册
- UX-1 — 远程会话 composer 显示 `Custom`
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
