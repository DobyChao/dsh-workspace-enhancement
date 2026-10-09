# R50 — BUG-13：直连停止线不再读到假 EOF

> #59。2026-10-08 合并为 [#62](https://github.com/DobyChao/dsh-workspace-enhancement/pull/62)。
> 同轮只入账、未实现：`REQ-I26`（linux-arm64 远程组件）。

没有远程组件的远端上，`bash` / `sw_exec` / `glob` 一启动就被 SIGTERM 杀掉。直连 steward 用后台
`(cat >/dev/null; kill -TERM 0) &` 守 SSH stdin；作业控制关闭时，POSIX 把这段异步列表的 stdin
接到 `/dev/null`，几毫秒内假 EOF，组杀发生在命令的第一个副作用之前。有远程组件的腿不走 steward。

修法在 `src/process.ts`：后台化之前 `exec 4<&0`，watcher 改为 `cat <&4`，用户命令 `4<&-` 不继承
停止线。stdin 真关闭时仍 `kill -TERM 0`。`stdin: 'pipe'` 不走 steward，未改。

Linux 上三条语义用例：stdin 保持打开则命令跑完；立刻 EOF 约 6ms 内 SIGTERM；fd 3 载荷仍进用户命令。
Windows 只锁脚本字符串。无远程组件的远端实机还没在 lab 跑，脚本
[`uat/BUG-13-steward-stdin.md`](../uat/BUG-13-steward-stdin.md)。#59 作者用同一改法在 aarch64 手机上验证过症状。
