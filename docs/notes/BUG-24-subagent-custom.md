# BUG-24 — 子代理的权限显示成 Custom

> 2026-10-24。待办在 [`../backlog.md`](../backlog.md)。和 [BUG-22](./BUG-21-22.md) 一样出现在子代理上，原因不同。

点进子代理后，权限类型是 **Custom**。父会话若是 Workspace Write，子代理不该变成一个对不上号的名字。

宿主 `dsh-subagent` 的 `captureDelegatedPolicyOverrides`（`lib/index.js`）在创建子代理时：

- 审批策略一律写成 `never`，不管父会话是不是 `ask`。
- 预设名只在父会话当前是 `auto` 或 `danger-full-access` 时才抄过去。Workspace Write 不抄。

`dsh-permission-presets` 的 Workspace Write 预设是「沙箱 `workspace-write` + 审批 `ask`」。子代理变成「沙箱仍是 workspace-write、审批是 never」之后，没有任何预设对得上，`derive` 返回 `custom`，界面名是 `Custom`（「Current sandbox and approval settings do not match a preset.」）。

本插件没有给子代理写权限事件。显示名在宿主这两处。

验收：子代理不再显示 Custom。沙箱档与某个预设一致时显示该预设名。审批仍是 never，不把它显示成完全权限。芯片只有预设名这一格，审批关闭不会另起一行。
