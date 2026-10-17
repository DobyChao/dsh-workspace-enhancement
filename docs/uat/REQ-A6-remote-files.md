# REQ-A6 — 远程上传件与产物可浏览、可预览

隔离 lab（`DSH_HOME` 指向 lab home，不要碰 3080）。

**主验收是宿主原生「工作区文件」页，不安装 `dsh-better-sidebar`。**
远程会话的 cwd 经官方接缝 / `ctx.fs` 路由后，这一页就能浏览工作区、展开上传目录并预览文件。
`dsh-better-sidebar` 的 `registerTab`「远程文件」（tab id `dsw:workspaces`）只是可选增强：
只对接独立安装的侧栏，不抢宿主 `files` kind（[ADR-0006](../decisions/ADR-0006-integrate-external-sidebar-only.md)）。
这段实现留着，缺它不算失败。

## 2026-10-17 lab（权威）

ZCode lab，宿主 `@deepseek-ai/dsh@0.2.1-rc.2`，better-sidebar 已卸。
**PASS 5/5**：宿主「工作区文件」页能浏览远程会话工作区、展开 `.dsh-uploads/`、
打开标记文本并预览、打开 `.dsh-artifacts/uat-artifact.txt`。

证据在协调机，不入库：`/workspace/evidence/req-a6-host-files/`
（`PREP.md`、`uat/*.jpg`、`uat/observations.md`）。决定见 [R55](../rounds/R55-req-a6-host-files.md)。

## 准备

1. 保存一台可用的远程机器，并把一个远程目录设为会话工作区（cwd 能路由到这台机器）。
2. 确认未安装 `dsh-better-sidebar`。
3. 在该会话里上传一份标记文本。它应出现在远端工作区的 `.dsh-uploads/`。
4. 若有工作区外、且本机磁盘上存在的文件被复制进工作区，它出现在 `.dsh-artifacts/`（例如 `uat-artifact.txt`，REQ-I28）。

## 主路径：宿主「工作区文件」（无 better-sidebar）

1. 打开该远程会话，打开宿主「工作区文件」页（不是第三方 tab）。
2. 文件树以会话工作区为根，能浏览远程内容。
3. 展开 `.dsh-uploads/`，打开标记文本，预览能看到正文。
4. 打开 `.dsh-artifacts/uat-artifact.txt`，能看到该产物。
5. 插件其余表面照常：目录选择、设置页、会话头远程状态都在。没有「远程文件」tab，也不报 `betterSidebar` 缺失。

## 次路径：可选 better-sidebar「远程文件」

仅当环境里已经独立安装了 `dsh-better-sidebar` 时才看。缺它不算失败。

1. 打开「远程文件」（tab id `dsw:workspaces`）。宿主「工作区文件」页仍在，没有被这个 tab 替换。
2. 页头有远程连接状态。展开后能看到 `.dsh-uploads` / `.dsh-artifacts` 与工作区内产物。
3. 点击其中文件：页内预览离开「选择一个文件以预览」（文本、图片或 PDF）。宿主没有 `remote.workspaceFiles` 时也一样，页内预览走 `browse.read`。
