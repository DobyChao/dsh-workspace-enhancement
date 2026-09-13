# UAT：REQ-I5 远端一个核心（反转 I9-9）

> 对偶 [R24-req-i9-remote-runner.md](./R24-req-i9-remote-runner.md) 的 I9-1/2/3，并把 I9-9 **反过来**：围栏打开时官方 `write` 工作区外必须失败，且目标文件不存在。

## 0. 基本信息

| 项 | 值 |
|---|---|
| 轮次 / 主题 | R26 — 远端一个核心 |
| 验收对象 | 围栏档远程 fs + spawn 同进 Go 核心 jail；`off` 仍 SFTP |
| 需求 / 缺陷 ID | REQ-I5 / ADR-0023 / ADR-0024 |
| 脚本作者 / 日期 | agent / 2026-09-13 |
| 预期耗时 | 25–40 分钟 |

## 1. 前置条件

| 项 | 值 |
|---|---|
| 版本 | `0.1.4` 源码线上的未发 0.2.0 能力（`package.json` 不 bump） |
| 分支 | `feat/REQ-I5-remote-core` |
| commit | `<短 sha>` |
| 构建产物 | `npm run build` 且（如要真机部署）`npm run build:core` |
| lab 地址 | `http://127.0.0.1:50599/`（`scripts/dev-lab.ps1`） |
| 启动命令 | `pwsh -File scripts/dev-lab.ps1` |
| 浏览器与视口 | 任意现行浏览器 / 1440×900 |
| 主题 | 浅色 |
| 语言 | 中文 |
| 缩放 | 100% |
| 其他前置 | 一台 **linux x86_64** 远端；lab 已注册机器 `c1`；操作者从设置页点过「部署核心」 |

**禁止**：在 3080 上执行；改产品 profile；使用真实凭据。

## 2. 步骤

| # | 操作 | 期望 | 观察点 | 结果 |
|---|---|---|---|---|
| 1 | 设置页对 `c1` 点「核心状态」再「部署核心」 | 部署成功后状态含版本 `0.2.0-dev` 与 arch | RPC `core.status` / `core.deploy`；设置页一行文案 | ☐ |
| 2 | 机器 `remoteSandbox = off`，官方 `write` 工作区外一路径 | **仍成功**（零迁移） | 远端文件存在且内容符合 | ☐ |
| 3 | 改为 `read-only`，重启/重连后官方 `write` 同一工作区外路径 | **失败**；目标文件**不存在**（I9-9 反转） | 工具错误含 `SANDBOX_UNAVAILABLE` 或 permission / EROFS；`ls` 无该文件 | ☐ |
| 4 | `read-only` 下官方 `read` 工作区外一既存文件 | 成功（只读） | 读出内容 | ☐ |
| 5 | `workspace-write`，工作区内 `write` | 成功 | 文件内容 | ☐ |
| 6 | `workspace-write`，工作区外 `write` | 失败且文件不存在 | 同步骤 3 | ☐ |
| 7 | 围栏档 `bash -c 'echo hi'` | 成功；审批门若开仍看到**未包装** argv（无 `bwrap` 当 argv[0]） | 工具输出；如有审批预览 | ☐ |
| 8 | 围栏档 `glob`/`grep`（spawn `rg`） | 不因缺系统 `rg` 而 127（核心 `PATH` 前置捆绑 rg） | 搜索命中或明确核心缺失 | ☐ |
| 9 | 临时把远端 `~/.dsh-core/current` 挪走，再 `read` + `bash` | **两者都拒绝**，读面不得悄悄走 SFTP | 两次失败均为 `SANDBOX_UNAVAILABLE`（或等价） | ☐ |
| 10 | 围栏档打开交互终端 | 拒绝，不打开未围栏 PTY | 错误文案含 terminal / fence | ☐ |
| 11 | Windows 远端或 `uname -m` 非 x86_64 | 部署按钮失败；健康面「无围栏核心」；档位请保持 `off` | `core.deploy` detail | ☐ |

## 3. 判定

| 项 | 值 |
|---|---|
| 结论 | ☐ 通过 ☐ 不通过 |
| 通过项 / 总项 | `<n>/11` |
| 证据链接 | `<lab 截图 / RPC>` |
| 未通过项 | `<FEEDBACK>` |
| 是否阻塞发布 | 步骤 3、6、9 失败则 **是**（不得宣称已围栏） |
| 用户签字 | |

## 4. 环境指纹

| 项 | 值 |
|---|---|
| 实例 / 端口 | lab / 50599 |
| 插件版本 | `0.1.4`（未发 0.2.0 能力） |
| commit | |
| 宿主 OS / 版本 | |
| 远端 | linux x86_64 / `<发行版>` |
| 浏览器 / 视口 / 缩放 | |
| 主题 / 语言 | |
| 相关机器 id | `c1` |

## 5. 备注

- 捆绑 `bin/bwrap` / `bin/rg` 若未打进 tarball，步骤 1 后核心能 `version` 但 jail 会失败——记入 FEEDBACK，不要标「已围栏」。
- 审批门仍不覆盖 fs 写（ADR-0020 D1）；围栏档的 fs 由**核心**覆盖，不是审批门。
- 验收后恢复 `remoteSandbox=off`、删测试文件、确认 50599 已停。

来源：`docs/uat/README.md`；`docs/decisions/ADR-0023-one-remote-core.md`；`docs/decisions/ADR-0024-remote-core-protocol.md`
