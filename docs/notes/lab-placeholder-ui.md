# 2026-10-19 lab：占位路径上的文件页与终端

> 专题附录，不是待办。待办是 `BUG-16`、`BUG-17`。
> 现场是隔离 lab（端口 50599），插件 `0.2.5`，另装 `dsh-better-sidebar@0.28.0`。
> 会话 cwd 是本机占位目录 `dsw-routes/<id>/<远端路径>`，对应远端 `/home/uuz/eee`。
> 占位目录在磁盘上是空的；远端该目录里有 `.dsh` 与 `hello.txt`。

## 1. 文件页（BUG-16）

宿主「文件」页的路径条印的是会话 cwd，所以显示占位路径。
列目录已经走 `ctx.fs`：树里的 `.dsh`、`hello.txt` 是远端条目，不是本机文件。

点开时，宿主用占位根拼出文件地址，交给 `sidebarRight.openResource`。
better-sidebar 的编辑器认领 `dsh-resource://file/**`，并在本地 `stat` 成功之后才跑 `detect`。
`hello.txt` 在占位目录里不存在，打开停在 `ENOENT`，到不了本插件只认 `.dsh-uploads` / `.dsh-artifacts` 的预览器。

会话 cwd 不能改成纯远端路径。宿主调用 `ctx.fs.resolve` 时经常不带 cwd，只有路径本身落在 `dsw-routes` 下才会被判成远程。

`REQ-A6` 验收的是未装 better-sidebar 时的宿主文件页。本现场装了 better-sidebar，路径条和打开都不在那次验收里。

## 2. 终端（BUG-17）

官方「终端」页先问 `terminalEnvironment` / `resolveExecutable`。这两个方法没有 cwd，混合门面按本机回答，Windows lab 上就是 `cmd.exe` 或 `pwsh`。
接着 `spawnTerminal` 带上占位 cwd，被判成远程，于是用 Windows shell 去远端 Linux 上开 PTY。
远端 SSH 运行时自己的 `terminalEnvironment` 知道那边是 `bash`，宿主终端不会问到它。

页面文案是 `终端错误：null`：失败对象到达面板时没有可用的 message。对话里的命令走另一条 spawn，不受这个面板影响。

## 3. 2026-10-20 修复与上游评估

- 我方新增独立原生资源类型（`dsw:remote-file`），只认领同一远程会话工作区里的文件。它的匹配模式比 better-sidebar 的通配模式更具体，读取前就确定归属，因此普通文件也能跳过本地 stat。正文使用新的受会话与工作区约束的 `workspace.read`，不扩大原有上传/产物预览白名单。
- 原生文件页的路径条通过已有 actions 槽显示远端路径，局部 CSS 只在我方标记存在时隐去占位路径，且只匹配页头的 `data-files-path="true"`；文件行携带同名路径属性，必须保留。没有替换 `files` kind，也没有改会话 cwd。
- 终端的 shell 探测在一次 `shells/create` 请求内绑定远端连接；缺失候选返回宿主认可的 `SubprocessExecutableNotFoundError`。实机又发现 Node writable 成功回调是 `null`，原先 `!== undefined` 导致 `reject(null)`；修复后远端 bash、pwd、uname 与输入输出均通过。
- lab：宿主 0.2.1-rc.2 + 本轮 tarball；无 better-sidebar 时原生路径条显示远端路径。启用 better-sidebar 0.28.0 后，从会话引用打开普通文本可见正文，页面无未捕获异常；该插件自己的文件树仍读本机占位目录，不能据此宣称远程目录树兼容。
- **需要上游改动，但不要重复开通用后端接缝 PR**：已核实仍开放的 [#359](https://github.com/omdsh-dev/DSH-better-sidebar/pull/359) 正在增加 `sidebarSessionBackends` / `sidebarHostApi`，覆盖远程会话的文件读取、列举等路由。优先跟进它对当前宿主 `ctx.fs` 的消费与版本适配，再决定是否给 dev 提精简的只读补丁。现有 `detect(path, head)` 要先经过本地读取，不适用于远端路径。[#565](https://github.com/omdsh-dev/DSH-better-sidebar/pull/565) 仅修外部编辑器 SSH URL 的文件/目录语义，不解决本问题。远程写入、Git、上传须另列边界。本轮没有向上游发评论或重复开 PR。

验收脚本：[BUG-16/17](../uat/BUG-16-17-remote-panels.md)。
