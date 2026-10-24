# BUG-23 — 远程沙箱不可用仍显示成绿色成功

> 2026-10-24。待办在 [`../backlog.md`](../backlog.md)。R53 验收里「none 机不是绿灯」当时未勾。

二进制部署成功、围栏档是 `none`（既不能 bwrap 也不能 Landlock）时，设置页仍把它画成成功。

- 部署结果：`deployBannerKind` 和部署芯片只看 `view.ok`。`ok: true` 就进绿色成功横幅（`bannerSuccess`）和绿色芯片（`coreChipOk`）。文案虽是 `settings.core.fenceNone`（「无法围栏」），颜色仍是成功绿。
- 之后点「远程组件状态」：`core.status` 走 `CoreHub.status`，只执行 `dsh-core version`，不跑 `fenceinfo`。返回值没有 `fence`。`coreStatusLabel` 落到 `settings.core.ok`，芯片是绿色的「远程组件 {version}{arch}」。围不住这件事在这一步消失。
- 指引：`fenceTierNote` 把原因、拒绝说明、安装 bwrap、Landlock 内核、关掉沙箱写进同一句，再塞进 `fenceNone` 的 `{detail}`，跟版本号挤在一行。

`deployCore` / `coreStatusViaExec` 会带上 `fence`。设置页的状态按钮不走这两条。

文案不要写「无法围栏」。这个词是实现用语，用户看不出后果。中文说远程沙箱无法使用，Workspace Write 受限（只读档同样无法强制，`danger-full-access` 仍可用）。英文用同一意思，不要写 fence。

验收：tier 为 `none` 时，部署横幅和芯片用警告色，不用成功绿。再点「远程组件状态」，仍能看出远程沙箱不可用，而不是绿色的「远程组件 {version}{arch}」。指引分成几行（原因、Workspace Write / 只读会拒绝、可走的出路），不要接在版本号后面挤成一句。
