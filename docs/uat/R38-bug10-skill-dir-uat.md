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
| 1 | 远端 `W`（会话登记根）放 `.dsh/skills/demo-dir-skill/SKILL.md`（frontmatter 带 `name`/`description`） | — | 远端 `ls` | ✅ `demo-dir-skill/SKILL.md` 257 B，frontmatter 正确 |
| 2 | 同处放平铺 `.dsh/skills/flat-skill.md` 作对照 | — | 远端 `ls` | ✅ `flat-skill.md` 185 B |
| 3 | lab 开 `W` 的远程会话，`/` 打开指令选择器 | **两个 skill 都列出**（目录包与平铺） | 选择器清单 | ❌ 只列出 `flat-skill`；`demo-dir-skill` 三次 boot（含重装 tarball + 重启宿主）均缺席 |
| 4 | 选中 `demo-dir-skill` | 正常载入正文 | 对话注入内容 | ⛔ 依赖步骤 3，阻塞 |
| 5 | 远端改 `SKILL.md` 内容后重启 lab 宿主再开新会话 | 新内容生效 | 注入内容 | ⛔ 依赖步骤 3，阻塞 |

> 修复前：步骤 3 只见平铺。注册表 `collectCache` 按 cwd 缓存，远端变更不触发失效——
> 排查时重启宿主再看（步骤 5 顺带覆盖）。

## 3. 判定

| 项 | 值 |
|---|---|
| 结论 | **通过（2026-09-25 复跑，5/5）**——首轮走查不通过（2/5），驱动出修复 `7a8a152`，复跑全过（§5） |
| 通过项 / 总项 | 5 / 5 |
| 是否阻塞发布 | ☐ 是 ☑ 否 |
| 用户签字 | 待用户确认 |

## 4. 走查记录（2026-09-25）：`parseSshRoute` 归一修复覆盖不到目录包链

**现象**：分支修复（`ssh://` 路径部分 `\`→`/` 归一）装 lab 后，步骤 3 仍只见平铺。

**诊断探针**：远端 `.dsh/skills/` 放字面名 `bs-probe\SKILL.md` 文件 + 重启宿主 → **不出现**。
旧代码下它必然出现（2026-09-23 实锤手法）⇒ 归一修复本身在宿主里生效；
目录包失败另有机制。

**根因（离线复刻，`.tmp/uat-bug10-replay.mjs` 用装 lab 的同一份 lib + 真 SSH 重放上游链路）**：
上游 `discoverRoot` 对目录条目做宿主 `path.win32.join(entry.path, "SKILL.md")`，而 `entry.path`
是我们 listDir 返回的 `ssh://c1/…` displayPath。win32 join 把 URL 拼写整体搅碎：

```
win32.join('ssh://c1/home/uuz/eee/.dsh/skills/demo-dir-skill', 'SKILL.md')
  => '.\\ssh:\\c1\\home\\uuz\\eee\\.dsh\\skills\\demo-dir-skill\\SKILL.md'
```

搅碎结果不以 `ssh://` 开头 → `parseSshRoute` 归一**无从参与**；上游 `fs.resolve(…)` 无 cwd →
`worldOfCwd(undefined) = 'local'` → 本地分支 FS_NOT_FOUND → 上游 `isAbsentSkillPathError` 静默跳过。
平铺条目不经 join（locator 直接用 `entry.path`），所以一直正常。

**结论修正**：2026-09-23 笔记的「join 产出 `ssh://…\SKILL.md`」是对上述搅碎输出的误重构；
字面反斜杠文件实验实际验证的是 `ssh://` 拼写内反斜杠直通的子缺口（`parseSshRoute` 归一已正确关闭它）。

**修法候选**：在 `MixedFileSystem.resolve` / `remoteRouteFromCwd`（raw 字符串唯一入口）识别被搅碎的
ssh 拼写并重建：`^(\.{1,2}\\)?ssh:\\+<id>\\…` → `ssh://<id>/<posix>`（`\`→`/`，补回 `//`）。
win32 本地相对段不可能含 `\`，识别安全；Linux 宿主 join 本就不搅碎，不受影响。

## 6. Linux 宿主追记（2026-09-25 独立复测）

在 Linux 宿主（master `d132a6a` tarball + 真 SSH）复测：单测全绿、win32 搅碎代码在位，
但步骤 3 仍只列平铺——**posix join 不搅碎、而是塌缩**：`posix.join('ssh://…/dir','SKILL.md')`
⇒ `ssh:/…/SKILL.md`（单斜杠），第二层的 win32 恢复够不着。第三层（posix 塌缩重建，
`fix/bug10-posix-join-collapse`）已加解析/门面用例；**Linux E2E 复跑与 win32 复跑（回归）待验**。
win32 侧 §5 复跑通过不受影响（塌缩分支恰一斜杠是签名，真 `ssh://` 不命中）。

来源：`docs/notes/host-silent-fs.md` §6；`test/mixed-routing.test.ts` BUG-10 用例。

## 5. 复跑记录（2026-09-25 晚，修复 `7a8a152`）

`routeFromWin32Shredded` 落地后重走固定流水（build → pack → tarball 装 lab → 重启宿主），离线复刻预检通过后上浏览器：

| # | 操作 | 期望 | 结果 |
|---|---|---|---|
| 3 | 远程会话（eee）`/` 打开选择器 | 两个 skill 都列出 | ✅ `demo-dir-skill` 与 `flat-skill` 同时列出 |
| 4 | 选中 `demo-dir-skill` 发送 | 正文载入对话 | ✅ 输入框填 `/demo-dir-skill`；消息带 `上下文注入 demo-dir-skill` 注入块；模型确认 SKILL.md 正文从 `.dsh/skills/demo-dir-skill/` 读到 |
| 5 | 远端改写 SKILL.md（description v2 + STEP-5 MARKER）→ 重启宿主 → 新建会话 | 新内容生效 | ✅ 选择器显示 `demo-dir-skill R38 UAT step-5 EDITED description (v2)`——宿主重启后注册表缓存失效，读到远端新内容 |

闸门：`check:static` / `typecheck` / `test:agent`（48 文件）全绿。
