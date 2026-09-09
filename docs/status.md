# 项目状态（生成文件，请勿手改）

> 由 `npm run status` 从 git / package.json / test/ / docs/backlog.md 生成。
> 生成时间：2026-09-09 09:53 UTC · 唯一待办真相源：`docs/backlog.md`

## 版本与提交

| 项 | 值 |
|---|---|
| package.json 版本 | `0.1.3` |
| npm 已发布版本 | `0.1.2` |
| 最新 tag | `v0.1.2` |
| 分支 / HEAD | `chore/release-0.1.3` / `8dea759` |
| HEAD 提交 | `feat(prompt): make model-facing prompts English and inject them on demand (#5)` (2026-09-09) |
| 与远端 | 1 ahead / 0 behind origin/main |

## 质量

| 项 | 值 |
|---|---|
| 单测文件 | 24 |
| 单测用例（静态计数） | 263 |
| E2E 场景文件 | 8 |
| ADR | 16 |
| 轮次报告 | 15 |

## 待办分布（docs/backlog.md）

| 状态 | 数量 |
|---|---|
| `todo` | 8 |
| `doing` | 1 |
| `blocked` | 7 |
| `done` | 22 |
| `shipped` | 4 |
| `dropped` | 5 |

## 被挡住 / 待拍板

- UX-1 — 远程会话 composer 权限预设显示 `Custom`
- SEC-1 — 副工作区 `fs:只读 + exec:开` 可被 `workdir` 命令绕成
- INFRA-8 — AgentTeams 标准 profile 注册
- SEC-2 — 主 workdir 命令可写/删只读副工作区（命令面无围栏）
- SEC-3 — full 沙箱风险确认门按 preset id 判定，`remote-full` 等价 full 却无二次确认
- UX-2 — 副工作区面板「浏览」输入框去留
- BUG-1 — 用户截图「设置页顶部空白边框条」lab 未复现

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
