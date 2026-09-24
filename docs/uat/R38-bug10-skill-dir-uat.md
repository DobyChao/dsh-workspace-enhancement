# UAT：BUG-10 远程目录包 skill 发现

> 复现链路与证据在 [`notes/host-silent-fs.md`](../notes/host-silent-fs.md) §6。
> 本脚本只验收修复后能在对话里看到的事：`/` 选择器列出**目录包** skill。

## 0. 基本信息

| 项 | 值 |
|---|---|
| 轮次 / 主题 | R38 — `ssh://` 路径分隔符归一 |
| 验收对象 | win32 宿主 + 远程 Linux 会话的 `.dsh/skills/<name>/SKILL.md` 出现在 `/` 选择器 |
| 需求 / 缺陷 ID | BUG-10 |
| 脚本作者 / 日期 | agent / 2026-09-25 |
| 预期耗时 | 10 分钟 |

## 1. 前置条件

| 项 | 值 |
|---|---|
| 版本 | 本分支 tarball 装 lab（`npm run build` + `npm pack`，见 `R37` §1 装包命令） |
| lab 地址 | `http://127.0.0.1:50599/`（绝不碰 3080） |
| 宿主 OS | **Windows**（本缺陷只在 win32 join 出现；Linux 宿主走同一步骤作对照，可 N/A） |
| 远端 | linux x86_64 已连接机器（如 `c1`） |

## 2. 步骤

| # | 操作 | 期望 | 观察点 | 结果 |
|---|---|---|---|---|
| 1 | 远端 `W`（会话登记根）放 `.dsh/skills/demo-dir-skill/SKILL.md`（frontmatter 带 `name`/`description`） | — | 远端 `ls` | |
| 2 | 同处放平铺 `.dsh/skills/flat-skill.md` 作对照 | — | 远端 `ls` | |
| 3 | lab 开 `W` 的远程会话，`/` 打开指令选择器 | **两个 skill 都列出**（目录包与平铺） | 选择器清单 | |
| 4 | 选中 `demo-dir-skill` | 正常载入正文 | 对话注入内容 | |
| 5 | 远端改 `SKILL.md` 内容后重启 lab 宿主再开新会话 | 新内容生效 | 注入内容 | |

> 修复前：步骤 3 只见平铺。注册表 `collectCache` 按 cwd 缓存，远端变更不触发失效——
> 排查时重启宿主再看（步骤 5 顺带覆盖）。

## 3. 判定

| 项 | 值 |
|---|---|
| 结论 | 待验收 |
| 通过项 / 总项 | / 5 |
| 是否阻塞发布 | ☐ 是 ☑ 否（功能缺失面窄，平铺不受影响） |
| 用户签字 | 待用户确认 |

来源：`docs/notes/host-silent-fs.md` §6；`test/mixed-routing.test.ts` BUG-10 用例。
