# E2E（Playwright 黑盒测试）

本目录是 `dsh-workspace-enhancement` 的**可入库、可重复**的浏览器端 E2E 资产：
用 Playwright 驱动真实 DSH Web 页面，验证插件客户端半（`lib/client.js`）在页面里
注册的 UI、布局与文案。取代历史上散落在 `C:\Users\Admin\.dsh-lab\e2e\*.py` 和
`.tmp/*.py` 的一次性 python 探针（browser-use + 本地 Chromium）。

- 场景目录（编号 / 需求 / 断言要点）：[`scenarios.md`](./scenarios.md)
- 配置：[`playwright.config.ts`](./playwright.config.ts)
- 夹具：[`fixtures/`](./fixtures) ｜ 用例：[`specs/`](./specs) ｜ 启动前检查：[`setup/lab-reachability.ts`](./setup/lab-reachability.ts)

> **绝不针对 3080 运行**：`playwright.config.ts` 在加载时检查 baseURL 端口，
> 命中 `3080` 直接抛错。本套用例会写 lab 的机器注册表与语言偏好，必须只跑隔离 lab。

---

## 1. 前置：依赖与浏览器

```powershell
# 仓库根目录
npm install                 # @playwright/test 已在 devDependencies（^1.50.0）
npx playwright install chromium   # 若本机 ms-playwright 缺少该版本期望的 revision
```

已知本机现状（2026-08-29 实测）：

| 项 | 状态 |
|---|---|
| `@playwright/test` in `package.json` | ✅ 已在 `devDependencies` |
| `node_modules/@playwright/test` | ❌ **未安装**（需 `npm install`；沙箱内会 EPERM，由 captain 在真实 shell 执行） |
| 浏览器二进制 | ✅ `%LOCALAPPDATA%\ms-playwright\chromium-1234\chrome-win64\chrome.exe`、`chromium_headless_shell-1234` |

若安装后的 Playwright 期望的 chromium revision 与 `chromium-1234` 不一致，两条路：

1. `npx playwright install chromium`（联网下载期望 revision）；或
2. 直接钉住已有二进制：
   ```powershell
   $env:DSW_E2E_CHROMIUM = "$env:LOCALAPPDATA\ms-playwright\chromium-1234\chrome-win64\chrome.exe"
   ```

## 2. 前置：起 lab 实例

```powershell
# 终端 1（前台，Ctrl+C 停）：独立 DSH_HOME=C:\Users\Admin\.dsh-lab，端口 50599
pwsh -File scripts/dev-lab.ps1
```

lab 没起时，`globalSetup` 会在第一个用例之前失败并打印上面这条命令（8s 探测超时），
不会让 7 个用例各等 45s。

## 3. 跑

```powershell
npm run e2e                      # 全量（scripts 由 captain 维护）
# 等价于：
npx playwright test --config=e2e/playwright.config.ts

npx playwright test --config=e2e/playwright.config.ts specs/E2E-02-settings-zh-layout.spec.ts
npx playwright test --config=e2e/playwright.config.ts --grep "E2E-06"
npm run e2e:report               # 打开 HTML 报告（若已加脚本）
```

环境变量：

| 变量 | 作用 | 默认 |
|---|---|---|
| `DSW_E2E_BASE_URL` | lab 地址（**端口 3080 会被拒绝**） | `http://127.0.0.1:50599` |
| `DSW_E2E_TOKEN` | lab 的 URL token（`dsh web` 打印的那串） | 自动从 lab 日志里找 |
| `DSW_E2E_LAB_LOG` | 指定 lab 日志路径（自动找 token 时用） | `.tmp/e2e-lab.stdout.log` 等 |
| `DSW_E2E_CHROMIUM` | 指定 Chromium 可执行文件 | 自动挑 `%LOCALAPPDATA%\ms-playwright\chromium-*` 里最新那个 |
| `DSW_E2E_RETRIES` | 重试次数；`1` 才会产生 `trace: on-first-retry` 的 trace | `0` |
| `DSW_E2E_STRICT_CONSOLE` | `1` = 任何未捕获页面异常都判失败 | 关闭（仅记录为 annotation） |

> **lab 需要 token**：`dsh web` 启动时打印 `http://127.0.0.1:50599/?token=<token>`，
> 直接 GET `/` 会返回 **401**。`setup/lab-reachability.ts` 会自动兑换这个 token
> （303 + HttpOnly `dsh-auth-*` Cookie，30 天）并落成 Playwright storage state，
> 所以正常跑不需要手动设；token 找不到时它会带着明确提示失败。

执行模型：`workers: 1` + `fullyParallel: false`。**这是刻意的**——lab 的语言偏好持久化在
`C:\Users\Admin\.dsh-lab\settings.yaml`，机器注册表也是全局的，并行会互相抢状态。

## 4. 证据在哪

```
e2e/artifacts/                    # 全部 gitignore（见 e2e/.gitignore）
├── screenshots/                  # 用例主动留的证据图（shot() 写入，同时附进 HTML 报告）
│   └── E2E-02-settings-zh-settings-zh.png
├── evidence/                     # 需要时写 JSON/文本测量结果（writeEvidence）
├── html-report/index.html        # npx playwright show-report e2e/artifacts/html-report
├── <test-id>/                    # 失败现场：screenshot（only-on-failure）+ trace（重试时）
```

- 成功路径**不产 trace**：`trace: 'on-first-retry'`，`DSW_E2E_RETRIES=1` 才会出现 trace。
- 失败截图：`screenshot: 'only-on-failure'`，落在 `artifacts/<test-id>/`。
- 主动证据图：用例调用 `app.shot('E2E-0X-...')`，文件同时在 HTML 报告里可见。
- 失败时先看 `artifacts/<test-id>/test-failed-1.png`，再看 `error-context.md` 的 ARIA 快照。

## 5. 目录结构与夹具

```
e2e/
├── playwright.config.ts        # baseURL/守卫/单 project chromium/trace/screenshot/outputDir
├── .gitignore                  # artifacts/
├── README.md  scenarios.md
├── setup/lab-reachability.ts   # globalSetup：lab 不可达即快速失败 + 给命令
├── fixtures/
│   ├── copy.ts                 # COPY 表（zh/en 文案契约）+ 词典漂移检测
│   ├── dom.ts                  # boundingBox / 溢出检测 / 对比度 / 截图
│   ├── shell.ts                # DSH 外壳导航：设置面板、语言切换、添加工作区、建会话
│   ├── plugin.ts               # 插件定位：机器卡片/行/表单字段、状态准备与清理
│   ├── assertions.ts           # 可复用的布局与主题断言
│   └── index.ts                # test.extend：app / machine / session 三个夹具
└── specs/
    ├── E2E-01..E2E-07-*.spec.ts
    └── copy-contract.spec.ts   # 静态守卫：COPY 表与 src/locale 词典逐键一致
```

三个夹具（`specs/*.spec.ts` 里 `import { test, expect } from '../fixtures/index.ts'`）：

| 夹具 | 提供 | 清理 |
|---|---|---|
| `app` | `page`（已 `goto('/')` 且外壳就绪）、`consoleErrors`、`pageErrors`、`shot(name)` | 无（context 随用例销毁） |
| `machine` | 一台**通过真实设置表单**添加的机器 `{label, host, port, username}` | 用例结束删除该行；下次运行还会先清掉所有 `e2e-dsw-*` 残留 |
| `session` | 一个真实本地会话 `{marker}`（含已展开的侧边栏） | 无（lab 里会留会话，见 §7） |

**隔离约定**：每个用例独立 context；需要前置状态一律走夹具显式准备，不依赖前一个用例的副作用。

## 6. 怎么加新场景

1. `scenarios.md` 里加一行 `E2E-08`，写清：名称、覆盖的需求/issue、spec 文件、断言要点。
2. `specs/E2E-08-<slug>.spec.ts`：`import { test, expect } from '../fixtures/index.ts'`。
3. 需要的文案**先加进 `fixtures/copy.ts`**（zh/en 成对），否则 `copy-contract.spec.ts` 会红。
4. 定位只用 `getByRole` / `getByText` / `getByPlaceholder` / `getByTitle` / `data-*`：
   - 精确文案用 `exactLang(key, lang)`（锚定两端，避免匹配到祖先元素）；
   - 与语言无关的用例用 `anyLang(key)`；
   - 插件自身的卡片没有 `data-*`，用 `cardByTitle()`（唯一精确文本 + 一步 `.locator('..')`）。
5. 布局断言用 `expectInside()` / `expectNoOverflow()`；主题断言用 `themeSnapshot()` / `assertPanelTheme()`。
6. 负向断言必须**先证明目标存在**，再留 settle 窗口（见 E2E-07）。

## 7. 常见坑（历史探针 + 本次源码核对提炼）

**导航 / 交互**

1. **设置入口两条路径都对**：`button[aria-haspopup="dialog"]` 内含 `[data-slot="settings.trigger"]`
   （`i18n_layout_probe.py` 的 gear 路径）；或「打开侧边栏 → 设置 → 远程工作区」
   （`r2ui_full.py`）。`[aria-haspopup="dialog"]` 在页面里**不止一个**（chat/conversation/
   message-feedback 都有），必须再按 slot 或可访问名收窄。
2. **设置导航项是 `<button>`，可访问名就是区块标题**（`远程工作区` / `Remote workspaces`），
   不是 `[role=tab]`。点击后才渲染该区块内容。
3. **语言行只存在于「通用设置」区块**（`settings.general.item`，id=`language`）。切语言前必须先点
   `通用设置` / `General`；切完再点回我们的区块。
4. **语言菜单渲染在 portal 里**：`[role="menuitem"]` 不是 dialog 的子节点，要从 `page` 上找。
   菜单项文案固定为 `中文` / `English`。
5. **设置面板关闭按钮的可见文字是 sr-only**（`clip: rect(0 0 0 0)`），但可访问名仍是
   `关闭` / `Close`；`Escape` 也能关（面板自己监听 document keydown）。
6. **机器删除走 `window.confirm`**：Playwright 默认 **dismiss** 对话框，不注册
   `page.on('dialog', d => d.accept())` 就会静默取消删除（`app` 夹具已统一 accept）。
7. **发送消息存在竞态**：composer 首次按键可能丢，发送按钮仍 disabled。历史探针的做法是
   「发一次 → 等 → 没出现再发一次」；`startSession()` 已内置一次重试。

**定位 / 断言**

8. **表单 label 没有 `for`**，`getByLabel` 用不了；必须 `page.locator('label').filter({ hasText })`。
   必填字段的 label 文本是「文案 + ` *`」（如 `端口 *`），matcher 要放宽尾部的 `\s*\*?`。
9. **`getByText` 会匹配祖先**：父容器的 textContent 可能恰好等于同一串文本，导致 strict mode
   违规。文案断言一律锚定两端（`exactLang`），容器用 `{ exact: true }` + `toHaveCount(1)` 兜底。
10. **端口输入没有 placeholder**，唯一语义标记是 `inputmode="numeric"`；用户名输入要靠它所在
   的「label 单元格」定位（`.locator('..')` 一步）。
11. **插件没有自己的 `data-*`**（唯一例外是行徽标 `data-dsw-badge` / `data-dsw-conn-id` /
    `data-dsw-label` / `data-dsw-dot` / `data-dsw-action="reconnect"`，以及 shell 的
    `[data-slot=...]`）。卡片容器只能用「唯一精确文本的父元素」。
12. **`settings.saved` 是模板串**（`已保存 {label}{fallback}`），断言用前缀 + label，不能整串等值。
13. **`status.retryAction.title` 与 `status.retryAction.full` 文案相同**，按 title 定位时要注意。

**状态 / 时序**

14. **语言偏好持久化在 lab 的 `settings.yaml`**（`locale.preference`），跨用例、跨进程存在 →
    用例内显式 `ensureLanguage()`，且必须串行跑。
15. **行徽标是异步注入**（MutationObserver + store 订阅）：负向断言「本地会话没有徽标」必须
    先证明该行存在，再留 ~3s settle（`BADGE_SETTLE_MS`），否则可能在首轮扫描前就"通过"。
16. **会话创建最慢**：历史探针为等 header 出现最长等过 150s。`timeout: 180_000` +
    `startSession` 60s×2 次发送是刻意留的余量。
17. **副工作区面板 `role="dialog"` 但无 `aria-modal`**；设置面板有 `aria-modal`。用
    `getByRole('dialog', { name })` 区分，不要用 `[aria-modal]` 一刀切。
18. **主题跟随 `prefers-color-scheme`**（插件 CSS 用 `@media (prefers-color-scheme: light)`，
    宿主把主题写到 `document.documentElement.style.colorScheme`）。用
    `page.emulateMedia({ colorScheme })` 切换；若 lab 把主题钉死在一个方案，`assertPanelTheme`
    不会静默放过——它记录 `theme-pinned` annotation 并跳过方向断言。
19. **窄视口宽度不是随便选的**：DSH 设置面板 `width: 800px; max-width: calc(100vw - 48px)`，
    导航栏固定 `188px`，所以内容区 = `viewport - 236`，卡片内容盒 = `viewport - 288`。
    Port/Username 两单元格是 `flex: 1 1 220px`：
    - 要**换行**需 `viewport - 288 < 446` → `viewport < 734`；
    - 要**不溢出**需 `viewport - 288 > ~261`（label 90 + gap 6 + 控件固有最小宽 ~165）。
    可用窗口约 `560..733`，E2E-04 取 **640px**。低于 ~560px 时是外壳把内容挤到控件固有最小宽
    以下（外壳级挤压，不是插件缺陷）。
20. **中文在 PowerShell 里会乱码**（`Get-Content` 按 ANSI 解码）。核对文案请用编辑器/read 工具，
    不要用 `Get-Content` 的输出判断字符串。

**环境 / 卫生**

21. **不要开全程 trace**（`trace: 'on'`）：官方明确不推荐，体积大且拖慢。用
    `on-first-retry` + 失败截图。
22. **lab 里会残留会话**：`session` 夹具不删会话（删除会话属第三方功能，不测）。跑多了 lab 侧边栏
    会堆积 `e2e-local-*` 会话，必要时清空 `.dsh-lab` 或手工删。
23. **脱敏**：夹具里的机器是 `e2e-host.example.invalid` / `e2e-user` / 端口 `2222`（RFC 2606
    保留域，永不可解析）。禁止写入真实主机、用户名、指纹或私钥。

## 8. captain 需要跑的验证命令

本目录无法自证（沙箱内 `npm install` EPERM、lab 由 captain 启动），请按顺序执行：

```powershell
# 1) 安装依赖（沙箱外）
npm install

# 2) 类型/静态闸门不应被 e2e/ 影响（tsconfig include 仅 src）
npm run check:static
npm run typecheck

# 3) 起 lab（终端 1）
pwsh -File scripts/dev-lab.ps1

# 4) 先跑静态守卫 + 最快的一个场景，确认链路通
npx playwright test --config=e2e/playwright.config.ts specs/copy-contract.spec.ts
npx playwright test --config=e2e/playwright.config.ts specs/E2E-01-app-boot.spec.ts

# 5) 全量
npm run e2e

# 6) 3080 守卫自证（应当抛错退出）
$env:DSW_E2E_BASE_URL='http://127.0.0.1:3080'; npx playwright test --config=e2e/playwright.config.ts --list
```

建议由 captain 补进 `package.json`（本次交付不修改）：

```json
"e2e": "playwright test --config=e2e/playwright.config.ts",
"e2e:headed": "playwright test --config=e2e/playwright.config.ts --headed",
"e2e:report": "playwright show-report e2e/artifacts/html-report"
```

> `tsconfig.json` 的 `include` 只有 `["src"]`，所以 `e2e/` 不参与 `npm run typecheck`；
> 若希望 e2e 也进类型门，需要单独的 `tsconfig.e2e.json`（本次未创建，避免动仓库配置）。
