# ADR-0006: 侧边栏只对接独立安装的 dsh-better-sidebar，不捆绑
- 状态: accepted
- 日期: 2026-08（`drafts/CONTEXT.md` §5.5 决策；宿主已装 dsh-better-sidebar 0.15.0 为 2026-08-23 实测）

## 背景

宿主环境已**独立安装并独立挂载** `dsh-better-sidebar@0.15.0`（bundle 列表里有它）
（`drafts/CONTEXT.md` §2.4）。而 `dsh-remote` 把侧边栏作为**硬依赖**内嵌，并靠「别处已挂则退避」的守卫式挂载
规避重复挂载（`drafts/features-breakdown.md` §2.8.6、§3「侧边栏」行）。工程约定也明确：不要把它作为硬依赖打进本插件。

## 决定

**只对接**独立安装的 dsh-better-sidebar，**不捆绑、不重复挂载**；需要侧边栏能力时通过其自身 slot 对接，
并做「已存在则退避」的守卫（`drafts/CONTEXT.md` §5.5、`AGENTS.md` §2）。

## 后果

- 实际交付**完全未关联侧边栏**（`drafts/CONTEXT.md` §5.5）——本插件只注册自己的槽位
  （`src/client/index.ts` 的四个槽位 + DOM 增辉层）。
- 用户可见的侧栏终端仍是本地：dsh-better-sidebar 的 `agent-pty` 直连 node-pty，**不经过** `ctx.subprocess` 接缝；
  要变 SSH 终端需要改造该插件（spawn 点 seam 化）。用户决策：**暂不处理，且本项目插件保持独立**
  （不 monkey-patch / 不兜底第三方内部实现，只依赖官方接缝与官方路径）
  （`drafts/CONTEXT.md` §7「面板终端 seam 化」）。
- 远程终端的可用路径 = 模型终端工具：`dsh-bash-terminal` 经 `ctx.subprocess.spawnTerminal` 已经远程
  （`drafts/CONTEXT.md` §7、§6.2 R4 第⑥项）。

## 被否方案

- **内嵌侧边栏**（dsh-remote 做法）：与宿主已装版本存在重复挂载风险，且是本插件不必要的包袱。
- **改造 dsh-better-sidebar 使终端走接缝**：超出本插件范围，用户决策不做（不侵入第三方内部实现）。
