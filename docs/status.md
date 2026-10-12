# 项目状态（生成文件，请勿手改）

> 由 `npm run status` 从 git / package.json / test/ / docs/backlog.md 生成。
> 生成时间：2026-10-12 12:36 UTC · 唯一待办真相源：`docs/backlog.md`

## 版本与提交

| 项 | 值 |
|---|---|
| package.json 版本 | `0.2.3` |
| npm 已发布版本 | `0.2.3` |
| 最新 tag | `v0.2.3` |
| 分支 / HEAD | `master` / `20045da` |
| HEAD 提交 | `docs(backlog): raise BUG-15 to P1` (2026-10-12) |
| 与远端 | in sync with origin/master |

## 质量

| 项 | 值 |
|---|---|
| 单测文件 | 63 |
| 单测用例（静态计数） | 675 |
| E2E 场景文件 | 8 |
| ADR | 31 |
| 轮次报告 | 51 |

## 待办分布（docs/backlog.md）

| 状态 | 数量 |
|---|---|
| `todo` | 16 |
| `doing` | 0 |
| `blocked` | 9 |
| `done` | 79 |
| `shipped` | 10 |
| `dropped` | 16 |

## 被挡住 / 待拍板

- UPSTREAM-6 — 官方 SSH 运行时定位拍板
- REQ-A7 — 包改名为远程工作区类名称
- UX-8 — 侧栏行徽章：data-row-key 锚 + Session 行官方槽迁移
- REQ-A6 — 适配 dsh-better-sidebar 插件
- REQ-I25 — 混合门面未知方法默认转发本地委托
- INFRA-8 — AgentTeams 标准 profile 注册
- AUDIT-5 — 分组视图下会话子行拿不到 compact 徽标
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
