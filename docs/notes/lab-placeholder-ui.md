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
