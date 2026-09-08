# ADR-0009: 宿主共享包进 peerDependencies，`dependencies` 只留 ssh2
- 状态: accepted
- 日期: 2026-08-30（依赖对齐补记；工程约定自 R0.5 起，2026-08）

## 背景

Cordis 的服务身份是**模块级 Symbol**。若把宿主已经提供的 `@deepseek-ai/*` 包写进本插件的
`dependencies`，它们会被当成自有运行时依赖装出一份更近的副本，**遮蔽宿主单例**，造成
Cordis `Symbol` / `instanceof` 身份分裂——service 注册失效、`HarnessError` 判类失效
（`AGENTS.md` §2）。

2026-08-30 的 profile 依赖诊断进一步暴露了同一问题的现实后果：web profile 出现 6 条风险级 peer 不匹配，
根因是 **v0.1.1 自己的 `dependencies` 家族劈叉**（`dsh-fs` / `dsh-subprocess` / `dsh-timeout` 仍是
`^0.1.0-rc.6`、`dsh-llm` 为精确 `0.1.1-rc.1`，而其余接缝包已是 `^0.1.1-rc.2`；pnpm hoisted 图里
唯一正则依赖来源就是本插件）（`drafts/CONTEXT.md` 2026-08-30 补记）。

## 决定

- 宿主已装的共享包（`@deepseek-ai/cordis`、`dsh-fs*`、`dsh-subprocess*`、`dsh-host-directory-picker*`、
  `dsh-llm`、`dsh-sandbox*`、`dsh-system-prompt`、`dsh-timeout`、`dsh-tools`、`schemastery` 等）
  **一律进 `peerDependencies`**（只声明契约，由宿主安装；宿主回退在启动时愈合，见官方
  plugin-peer-dependency-warnings），并在 `devDependencies` 同步保留供 `tsc` / `tsdown` 取类型。
- **`dependencies` 只留 `ssh2`**。
- 处置依赖劈叉：A = profile 级 `pnpm.overrides` 把 4 个包钉到同一族（脚本由用户在外部终端执行）；
  B = 仓库 `package.json` 对齐 rc.2 家族（`AGENTS.md` §2、`drafts/CONTEXT.md` 2026-08-30 补记）。

## 后果

- 当前 `package.json`：`peerDependencies` 15 项（含 RC 通道范围，如 `^0.1.2-rc.1`；
  `@deepseek-ai/cordis` `^4.0.2`、`@deepseek-ai/schemastery` `^3.18.2`）、`dependencies` 只有 `ssh2`、
  `devDependencies` 保留同一族 + 类型源（`dsh-client-locale` / `dsh-client-ui-slots` / `dsh-settings`）。
- 客户端运行时**零新增依赖**：只经 `ctx.locale` 服务与类型导入（`dsh-client-locale` 不进 tsdown EXTERNALS）
  （`drafts/i18n-design.md` §11、`CHANGELOG.md` 0.1.2）。
- 0.1.2 的发布口径 = 依赖对齐修复 + R6 i18n 同发（`drafts/CONTEXT.md` §5.12 与 2026-08-30 补记）。

## 被否方案

- **把共享包放 `dependencies`**：会被装出更近的副本并遮蔽宿主单例 → Cordis Symbol / `instanceof`
  身份分裂（`AGENTS.md` §2）。
- **不声明 peer、只依赖宿主回退愈合**：官方确有启动时愈合机制，但契约应显式声明，
  否则部署侧的 peer 诊断无法发现家族不匹配（`AGENTS.md` §2、`drafts/CONTEXT.md` 2026-08-30 补记）。
