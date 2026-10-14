# REQ-A6 — 远程上传件与产物可浏览、可预览

隔离 lab（`DSH_HOME` 指向 lab home，不要碰 3080）。better-sidebar 未安装时，本插件其余表面应照常；装上之后才出现「远程文件」页。

## 准备

1. 保存一台可用的远程机器，并把一个远程目录设为会话工作区（cwd 能路由到这台机器）。
2. 在该会话里上传一个文本文件和一个图片（或 PDF）。它们应出现在远端工作区的 `.dsh-uploads/`。
3. 若会话里有工作区内的产物路径，它们出现在「工作区内的产物」；工作区外、本机上存在的文件被复制到 `.dsh-artifacts/`（REQ-I28）。

## 有 better-sidebar

1. 打开该远程会话，在 better-sidebar 里打开「远程文件」（tab id `dsw:workspaces`，不是宿主的「文件」页）。
2. 页头有远程连接状态。展开「上传」「产物」。
3. 点击 `.dsh-uploads` 或 `.dsh-artifacts` 下的一个文件（例如 `uat-seed.txt`）。
4. 页内预览必须离开「选择一个文件以预览」，看到文本、图片或 PDF。宿主没有 `remote.workspaceFiles`（控制台不应再出现 `without inject`）时也一样：页内预览走 `browse.read`。宿主文档预览可用时，右侧另外打开 `dsh-resource://file/session/…`。
5. 宿主原来的「文件」页仍在，没有被这个 tab 替换。

## 没有 better-sidebar

1. 不安装 `dsh-better-sidebar` 时，插件正常加载：目录选择、设置页、会话头远程状态都在。
2. 没有「远程文件」tab，也不报 `betterSidebar` 缺失。
