# 系统提示段的 order

> 专题附录，不是入口、也不是待办。待办是 `REQ-I20`。
> 磁盘权威源：全局安装的 `@deepseek-ai/dsh-system-prompt@0.1.5-rc.1`
> （`lib/types/index.d.ts` 的 `SECTION_ORDERS` / `CONTEXT_ORDERS`）。
> 装配按 `order` 再按段名排序（同包 `comparePromptSections`）。

2026-09-22 lab 系统提示词面板：身份两行之后紧接着本插件的远程工作区段。

## 1. 官方段位

| 名字 | order | 段名 |
|---|---|---|
| `HARNESS_IDENTITY` | -1000 | `harness:identity`（「You are an AI agent powered by DeepSeek Harness.」） |
| `DEPLOYMENT_PERSONA_PREFIX` | 0 | `deployment:persona-prefix`（截图里的 glm 编码代理行） |
| `PLAN_POLICY` | 500 | |
| `TEAM_POLICY` | 600 | |
| `PTC_ONLY` | 800 | |
| `FILE_REFERENCE` | 900 | |
| `TOOL_BASH` | 1000 | 官方 `tool:bash` |
| `TOOL_PWSH` | 1010 | 官方 `tool:pwsh` |
| `TOOL_READ` … `TOOL_REPORT` | 1100–2900 | 官方各工具段 |
| `TOOLS_SDK` | 5000 | |
| `DEPLOYMENT_PERSONA_SUFFIX` | 10200 | |

官方工具插件用 `getSectionOrder("TOOL_…")` 取位。`dsh-tool-bash` 的 `apply` 无条件注册段名 `tool:bash`。

运行时上下文是另一条列表，不进系统提示词正文。已命名的位置：`SANDBOX_POLICY` 110、`APPROVAL_POLICY` 115、`SUBAGENT_DELEGATION` 120。

工具 schema 也不走这段 order。未配置 `toolOrder` 时按工具名排序。

## 2. 本插件现在写死的位置

| 注册 | order | 落在 |
|---|---|---|
| `section('sw-remote')`（`src/tools.ts`） | 90 | persona `0` 与 `PLAN_POLICY` `500` 之间。截图里远程段因此紧贴身份行 |
| `context('dsw-session-workspace')` | 90 | 官方上下文 110 之前。易变清单走 user-role 快照，不在系统提示词面板里 |
| `section('tool:sw-exec')` / `section('tool:bash')`（`src/exec-tools.ts`） | 105 | 同一条空档，仍在官方 `TOOL_BASH` 1000 之前 |

`tool:bash` 与官方段同名。同一 layer 重名会在注册时抛错。这台 Windows lab 能起来并显示远程段，说明 90/105 已生效；官方 `tool:bash` 要么没挂进这个 profile，要么不在同一 layer。Linux 上两边都挂载时要单独核对。

这些数字不是 `SECTION_ORDERS` 里的名字。
