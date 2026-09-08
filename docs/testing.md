# 测试与验证策略

> 本文是测试面的唯一说明。命令清单在 `AGENTS.md`，待办在 `docs/backlog.md`，
> 每轮真实验收记录在 `docs/rounds/`，用户验收脚本在 `docs/uat/`。

## 1. 五层验证金字塔

| 层 | 内容 | 命令 | 运行者 | 失败含义 |
|---|---|---|---|---|
| L0 静态闸门 | 词典键集、CJK 硬编码、密钥/真实主机泄漏、版本一致性、peer 家族一致性、CHANGELOG/状态不漂移、提交信息规范、仓库根残留物 | `npm run check:static` | 代理 / CI | 契约被破坏，先修再谈 |
| L1 类型 | `tsc --noEmit` | `npm run typecheck` | 代理 / CI | 类型面不成立 |
| L2 单测 | `test/**/*.test.ts`（`node --test`） | `npm test` | CI / 本地 shell | 逻辑回归 |
| L3 组合层 | 挂载树与补丁语义：`dsh --profile <scratch> --dump-config` 断言 bundle 行、工具、槽位注入齐全 | 见 `scripts/boot-smoke.sh` 与 `upstream.yml` | CI | 组合层没挂上（Cordis 特有，最廉价的一层） |
| L4 黑盒 | Playwright 真浏览器场景（`e2e/`） | `npm run e2e` | 本地 shell / CI | 用户可见行为坏了 |
| L5 用户验收 | 按 `docs/uat/` 脚本人工走查 + 反馈模板 | 人工 | 用户 | 体验不达预期 |

发布前的最低要求：L0–L3 全绿 + L4 关键场景绿 + 一份 L5 脚本随轮次交付。

## 2. 沙箱内的现实（重要）

代理运行在 DSH 文件沙箱（workspace-write）里，**不能开管道**，因此：

| 现象 | 原因 | 结论 |
|---|---|---|
| `npm test` / `node --test` 失败 `spawn EPERM` | 测试运行器逐文件 spawn 子进程 | 沙箱内改用 `npm run test:agent` |
| `tsx` 失败 `spawn EPERM` | tsx 启动 esbuild service worker | 沙箱内不要用 tsx |
| `tsc --noEmit` 正常 | 纯 JS，不 spawn | 代理可独立跑 |
| 真进程用例失败（`MixedSubprocess*`、`AUDIT-TC*`） | 沙箱拒绝 spawn | `test:agent` 归类为 SANDBOX，不计失败 |
| `SetFileSecurityW EACCES` | 沙箱拒绝复制 Windows DACL | 同上 |

`npm run test:agent` 的行为（`scripts/test-agent.mjs`）：

1. 扫描 `test/*.test.ts`；**直接 import `.tsx` 的文件被跳过**（JSX 需要 esbuild），当前 4 个；
2. 其余文件用 `node --experimental-transform-types --test --experimental-test-isolation=none` 单进程跑；
3. 把失败按块分类：命中 `spawn EPERM` / `EACCES` / `SetFileSecurityW` 等标记的算 **沙箱受限**，
   只要没有"真失败"，退出码为 0 并打印 `SANDBOX-LIMITED PASS`。

因此代理的可信信号是：

- `npm run test:agent` 退出 0 → 单测面没被自己写坏；
- **权威判定仍然是 CI 里的 `npm test`**（Linux runner 无沙箱限制，全部 21 个文件）。

## 3. 浏览器黑盒（L4）

- 资产在 `e2e/`：`playwright.config.ts` + `specs/` + `fixtures/`，场景目录见 `e2e/scenarios.md`，
  坑清单见 `e2e/README.md` §7。
- 目标实例永远是**隔离 lab**（`scripts/dev-lab.ps1`，`DSH_HOME=.dsh-lab`，端口 50599）；
  `playwright.config.ts` 里有守卫，baseURL 指向 3080 直接抛错。
- **lab 需要 URL token**：`dsh web` 打印 `http://127.0.0.1:50599/?token=<token>`，直接访问 `/` 是 401。
  `e2e/setup/lab-reachability.ts` 自动兑换 token（303 + HttpOnly Cookie）并写成 storage state，
  也可用 `DSW_E2E_TOKEN` 显式指定。
- **浏览器二进制**：Playwright 会挑 `%LOCALAPPDATA%\ms-playwright\chromium-*` 里最新那个
  （本机是 1234，而 `@playwright/test` 期望的 revision 可能不同）；`DSW_E2E_CHROMIUM` 可覆盖。
- 定位只用 `getByRole` / 文本 / `data-*`；禁止 CSS/XPath 深链（DOM 一变就碎）。
  **对话输入框是 Lexical `contenteditable[role=textbox]`，不是 `<textarea>`**——
  裸 `getByRole('textbox')` 会命中侧栏搜索框（已踩过）。
- 证据：`trace: 'on-first-retry'`、`screenshot: 'only-on-failure'`，落 `e2e/artifacts/`（**不入库**），
  CI 里作为 artifact 上传。全程 trace/录屏不做（太重）。
- 历史教训：一次性 python 探针（曾散落 189 个文件在仓库外）无法复现，才改成入库的 spec。
  当前 **9/9 通过**（`copy-contract` 静态守卫 + E2E-01…07）。

## 4. 组合层断言（L3）

Cordis 的组合树可以离线断言，比装真实例便宜得多：

```bash
dsh --profile <scratch> --dump-config   # 检查 bundle 行、patch 行、工具与 client 注入
```

`upstream.yml` 每周用最新宿主 rc 跑一次这套断言 + 全量单测，作为"上游坏了第一时间知道"的哨兵。

## 5. 写测试的约定

- 一个测试 = 一个可验证断言；用例名写清"什么行为"，不要写"test1"。
- 与需求相关的用例，在文件头注释里带需求 ID（`REQ-I3`），并在提交信息尾行写 `Refs: REQ-I3`。
- **逻辑放 `.ts`，`.tsx` 只做视图**：`.tsx` 里的逻辑无法被沙箱内单测覆盖（JSX 需 esbuild）。
  新增组件时，把可测逻辑抽到同名 `.ts`，由 `.tsx` 引用。
- 需要真进程的用例单独分组命名（如 `(process-level)`），便于沙箱分类识别。
- 不写 `.only` / `.skip`（静态闸门会拦）。

## 6. 已知环境要求

- 远端主机需装 `pwsh`（PowerShell 工具）与 `ripgrep`（glob）；终端（bash）开箱即用。
- 本机 Playwright 浏览器二进制在 `%LOCALAPPDATA%\ms-playwright`；`@playwright/test` 是 devDependency。
- Node ≥ 22.8（`--experimental-test-isolation` 与内置 TS transform 的最低要求）。
