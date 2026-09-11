# E2E 场景目录

本文件是 `e2e/specs/` 的**唯一场景索引**：编号 / 名称 / 覆盖的需求或 issue / spec 文件 /
断言要点。新增场景必须同时改这里和 `specs/`（见 `README.md` §6）。

约定：

- 编号 `E2E-NN` 稳定、不复用；废弃场景保留编号并标注「已废弃」。
- 一个场景 = 一个 `test.describe` 块；同文件内的对照用例（如 E2E-04 的宽视口对照）仍算同一编号。
- 「不覆盖」一栏写明刻意不测的东西，避免下一个人误以为是遗漏。

## 目录

| 编号 | 名称 | 覆盖的需求 / issue | spec 文件 | 断言要点 |
|---|---|---|---|---|
| E2E-01 | 应用启动与插件注入 | `INFRA-5`（E2E 资产化）；`REQ-R6`（i18n 注册面）；插件挂载契约（`settings.section` + 两个 `directoryFlow` 洞） | `specs/E2E-01-app-boot.spec.ts` | ① 文档渲染出内容（`body.innerText` 非空）；② DSH 外壳挂载（设置触发器可见）；③ 设置面板导航出现本插件的 `settings.label` 行，点击后 `settings.title` 渲染；④ 外壳「添加工作区」按钮打开的是**本插件**的目录流对话框（`flow.sidebar.label` 导航 + `本机`/`已保存连接` 两个 region + 取消按钮）；⑤ 关闭后对话框卸载；⑥ 启动全程无来自插件 bundle 的未捕获异常 |
| E2E-02 | 设置页渲染（中文）+ 不溢出 | `INFRA-5`；`REQ-R6`（zh 文案）；R2 表单并集布局；`BUG-1` 相关布局回归守卫（lab 未复现，本场景防再发） | `specs/E2E-02-settings-zh-layout.spec.ts` | ① 中文文案齐全：`settings.title`、`settings.machines.title`、6 个表单 label、认证双 tab（`role=radio`）、测试连接 / 保存按钮；② 机器行渲染真实端点 `user@host:port`，四个行内按钮（编辑/删除/设为当前/忘记指纹）全部可见；③ 机器列表卡片与表单卡片均无横向溢出（`scrollWidth ≤ clientWidth+1`，且无子元素越过内容盒）；④ 行内按钮组与关键控件 boundingBox 全部落在所属卡片内 |
| E2E-03 | 设置页渲染（英文）+ 不溢出 | `INFRA-5`；`REQ-R6`（en 文案，英文比中文更长）；真实破板回归点 | `specs/E2E-03-settings-en-layout.spec.ts` | 与 E2E-02 完全相同的布局断言，但在 Language 切到 `English` 之后执行：英文 `settings.title` / 表单 label / 行内按钮（Edit/Delete/Set as current/Forget key）全部可见，两个卡片无溢出、控件不越界 |
| E2E-04 | 添加机器表单：窄视口 Port/Username 换行 | `INFRA-5`；R2 表单并集；真实回归点（两单元格 `flex: 1 1 220px` 曾把卡片撑破） | `specs/E2E-04-add-machine-narrow.spec.ts` | ① **640px 视口**（外壳设置面板扣除 48px 边距 + 188px 导航 + 52px 内边距后，内容盒 = `viewport-288`；换行阈值 `<446`、不溢出阈值 `>~261`，故取 640）：Port 与 Username 两个 label 落在**不同行**（`usernameLabel.y > portLabel.y + height - 2`），且换行后的 Username 单元格回到行左缘；② 该行宽度 ≤ 卡片宽度；③ 两个 label 与两个输入框全部在表单卡片内；④ 卡片无横向溢出。宽视口（1440px）对照用例反向断言两者**同行**且 Username 在 Port 右侧 |
| E2E-05 | 副工作区面板 + 主题跟随 | `REQ-I3`（单 session 多工作区/副目录）；`REQ-I7`（权限档位退役：面板=薄声明清单）；`UX-2`（面板「浏览」输入框）；`INFRA-5` | `specs/E2E-05-side-workspaces-panel.spec.ts` | ① 会话标题栏出现「工作区」按钮（`title=side.headerAction.title`，文本 = `side.headerAction.label`）；② 点击后 `role=dialog` 面板打开，标题/本机目录/远程目录/浏览…/挂载齐全；③ 默认本机模式下面板**无任何 `<select>`**（两个权限下拉已随 REQ-I7 退役）；④ 新会话显示空态文案（`side.empty`）；⑤ 面板解析 `--dswsw-surface` 主题 token、卡片背景不透明且等于该 token、文字对比度 ≥ 3:1；⑥ light/dark 下背景亮度方向正确（lab 主题被钉死时记 `theme-pinned` annotation 并跳过方向断言）；⑦ 关闭按钮可关闭面板 |
| E2E-06 | 语言切换即时生效（无需刷新） | `REQ-R6`（运行时国际化）；`INFRA-5` | `specs/E2E-06-language-switch.spec.ts` | 中文 → English → 中文：① 每次切换后 `settings.title` 用对应语言可见；② 表单 `端口/Port` label 与 `私钥文件/Private key file` tab 文案随之变化；③ 机器行「编辑/Edit」按钮随之变化（DOM 增辉层与 React 面同步）；④ 全程 `window` 哨兵仍在（证明**没有整页刷新**）；⑤ 三次切换共用一个页面实例 |
| E2E-07 | 会话栏远程标识（负向） | `REQ-I3`/`REQ-I4`（远程会话标识）；`REQ-A2` 被拒后改由 DOM 增辉层承担（C3 防误标） | `specs/E2E-07-local-session-no-badge.spec.ts` | ① 先证明本地会话行存在（按 marker 匹配 `[role=treeitem]`，否则负向断言无意义）；② settle 3s 后该行**无** `[data-dsw-badge]`、**无** `[data-dsw-conn-id]`、文本不含 `🌐`；③ 记录侧边栏里被标记的其他行数量，作为「徽标层是否真的在工作」的证据（`badge-layer-active` / `badge-layer-idle` annotation） |

## 静态守卫（非场景，无浏览器）

| 编号 | 名称 | 覆盖的需求 / issue | spec 文件 | 断言要点 |
|---|---|---|---|---|
| COPY-01 | 文案表与词典逐键一致 | `REQ-R6`；`INFRA-2`（质量门）；本目录断言可维护性 | `specs/copy-contract.spec.ts` | `fixtures/copy.ts` 的 COPY 表与 `src/locale/dsw.ts` / `dsw.en.ts` 的 `dsw.*` 键值**逐键相等**；不一致时打印 key、语言、表值、词典值。`shell.*` 键属 DSH 外壳，不参与比对 |

## 刻意不覆盖（避免误读）

| 不测 | 原因 |
|---|---|
| DSH 自身功能（会话列表、设置框架、主题服务、语言菜单本身） | 第三方；只当作导航手段，断言只落在本插件渲染的 UI 上 |
| 真实 SSH 连接 / 目录浏览 / 挂载副目录 | 依赖真实 sshd 与凭据；属宿主半单测（`test/`）与人工 UAT 的范畴 |
| 远程徽标的**正向**标记（远端工作区/会话应显示徽标） | 需要 lab 里预置远程工作区，环境依赖强；见 E2E-07 的 `badge-layer-active` 证据 |
| 宿主系统提示注入、工具面文案 | 不在浏览器里；由 `test/` 单测覆盖 |
| 设置页「测试连接」的真实结果 | 需要可达主机；本套用例只验证控件存在与布局 |
