# R55 — REQ-A6：宿主「工作区文件」页即主验收路径

> 2026-10-17。ZCode lab 在未装 `dsh-better-sidebar` 时 PASS 5/5。
> 产品决定（所有者 + Grok）：主路径是宿主原生工作区文件页；optional tab 保留为增强。
> 本轮只改文档，不改插件版本、peer 或运行时。

## 1. 目标

`REQ-A6` 的验收不依赖 `dsh-better-sidebar`。远程会话工作区里的上传与产物，
在宿主「工作区文件」页经官方接缝 / `ctx.fs` 即可浏览和预览。

## 2. 拆解

- 文档：`REQ-A6` 从 doing 挪到 done；UAT 改成以宿主文件页为主、better-sidebar 为次。
- 代码不动。`registerTab`「远程文件」（`dsw:workspaces`）仍随包可选注册，不抢宿主 `files` kind（ADR-0006）。
- 顺手：`UPSTREAM-13` 已由 PR #76 合入 master（`375bc70`）。drift run 39016266340 的 next 与 alpha 各只红两例，都是 `watchLinuxScopeStart`。backlog 标 done。GitHub issue #75 不在本轮关闭。

## 3. 验证

ZCode lab，宿主 `@deepseek-ai/dsh@0.2.1-rc.2`，better-sidebar 已卸。
**PASS 5/5** — 宿主「工作区文件」页能浏览远程会话工作区、展开 `.dsh-uploads/`、
打开标记文本并预览、打开 `.dsh-artifacts/uat-artifact.txt`。

证据在协调机（不入库）：`/workspace/evidence/req-a6-host-files/`
（`PREP.md`、`uat/*.jpg`、`uat/observations.md`）。

本轮预检：node 22.14 / npm 10.9 / git / gh 可用；WSL 缺失（本机即 Linux，且无跨平台代码改动）；
browser-use 未用（无新 UI，lab 已由协调方跑完）。

## 4. 结果

`REQ-A6` 按宿主文件页收口。optional better-sidebar tab 仍是增强，实现留在 `src/client/better-sidebar.ts`。
插件版本仍是 `0.2.4`。`UPSTREAM-13` 在 backlog 标 done。

## 5. 遗留

- 次路径（已装 better-sidebar 时的「远程文件」tab）不是本轮验收条件。
- issue #75 仍开。契约分类已在 master；本轮不代关 issue。

来源：`docs/uat/REQ-A6-remote-files.md`；协调机 `/workspace/evidence/req-a6-host-files/`；PR #76。
