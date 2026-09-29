# UPSTREAM-11 调查：dsh 桌面版适配（2026-09-29，子代理调查归档）

> 途径：官方 monorepo `deepseek-ai/deepseek-harness`（`apps/` 目录、desktop/desktop-host 源码）、
> 0.2.0-rc.1 全局 CLI 源码（bin.js / app-boot / plugin 载体）、npm、GitHub discussions。
> 桌面包是 private（不走 npm），故本调查以仓库源码为权威源。

## 1. 桌面版事实

- **官方桌面版存在且已分发**：monorepo `apps/desktop` + `apps/desktop-host`；形态 = **Electron 壳包住
  完整 dsh Web 应用**（RunAsNode 子进程跑共享 profile runner，Electron 加载打包 Web 入口
  `dsh-app://app/`）。非 Tauri、非 ACP（`dsh-acp-app` 是自动化 stdio profile，与桌面无关）。
- 包 `@deepseek-ai/dsh-desktop` / `-desktop-host`，**private 不发 npm**，走应用内更新；**与 dsh
  同版本同日发布**（今天发的 `dsh-v0.2.0-rc.2` 即桌面 rc.2）。
- **`desktop` 是保留 profile 名**：CLI boot 无条件拒绝；`dsh plugin --profile desktop` 只有桌面
  自带的 CLI 载体能过（`manageDesktopProfile` 标志），npm 装的 CLI 永远拒绝。
- **桌面 profile 组合（关键）**：`apps/desktop/src/project-manager.ts` 用 `PROFILE_TEMPLATES.web`
  初始化 ⇒ **desktop profile = `dsh-base + dsh-web-app` + 插件**，与我们 web profile 同底座；
  端口默认 **19387**（web=3080）；`$DSH_HOME` 两端共享，但 profile 目录有单实例锁独占。
- npm 上的 `dsh-desktop` 0.2.0（2026-08-13）是**社区占位包**（个人维护、0.1.x 旧壳），与官方无关——
  防混淆。

## 2. 耦合面 × 情景

实证情景 = **桌面即 web 组装的壳**：

| 耦合面 | 存续 |
|---|---|
| `/api/dsw` 通道（inject webServer + fetch.register） | ✓ desktop-host 跑完整 web 应用 |
| 客户端槽位（lib/client.js） | ✓ 同一打包 Web 客户端；`dsh.client.platform` 合法值只有 `web`，无独立桌面平台 |
| cordis.patch.yml（disable 三个 -auto 行） | ✓ 被补丁的行都在 dsh-base/dsh-web-app 里 |
| bundles/安装机制 | ✓ 但入口受限：桌面 Plugins 设置页，或桌面自带 CLI（npm CLI 拒绝） |
| peer（0.2.0 强制） | ✓ 联合 pin 已覆盖（UPSTREAM-10 实证） |

「独立组合」情景（无 dsh-web-app）**无任何证据**，仅作监视。

## 3. 适配方案（调查建议）

**方案 1（推荐）：零代码改动，同插件装进 desktop profile + 文档 + 一轮桌面真机 UAT。**
UAT 重点（桌面特有，lab 复现不了）：① Electron Node 进程里跑 ssh2（原生构建受阻时纯 JS 兜底需实证）；
② `dsh-app://app/` 源下我们通道的转发；③ 双端并跑（3080+19387）同写
`machines.json` 的并发——单实例锁只护 profile 目录不护我们的注册表文件；④ 被 disable 的
`-auto` picker 在桌面原生对话框语境下的行为确认。
配套：README 桌面安装路径（先启动一次桌面完成 profile 初始化）；compatibility.md 记社区假包防混淆。
**跟踪增量**：每周 `gh api` 探 monorepo 三个文件（`apps/desktop/package.json` 版本、
`project-manager.ts`【组合分叉的最早信号】、`desktop-host/src/index.ts`），变化开 issue——
现有三层哨兵对 private 桌面包全盲，此为唯一覆盖。明天 04:00 UTC tag-watch 必响（next→rc.2，预期，
认领基线即可；上游 rc.2 又缺 `settings-account@rc.2`，drift 复测前先看是否补齐）。

方案 2（webServer 降可选）：与桌面无关（桌面永远有 webServer），且会扩大 F1 类静默面——不做。
方案 3（拆多入口）：无消费方（平台只有 web 值）——不做，除非跟踪信号显示组合分叉。
