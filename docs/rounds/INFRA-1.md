# INFRA-1 — 工程化基建改造

- **需求**：`INFRA-1`…`INFRA-8`（`docs/backlog.md`）
- **日期**：2026-09-10
- **性质**：基建轮（不新增产品功能；顺带修掉 3 个真实缺陷）

## 目标

把工程化基建从「靠人肉记得跑」改成「可继承 + 可自动执行」：真相源入库、统一质量门、
CI、上游追踪、E2E 资产化、状态看板、UAT 流程、AgentTeams profile。

起因是一次体检，发现四类断层：关键资产全部 gitignore（clone 只剩代码）、
代理跑不了测试（沙箱 `spawn EPERM`）、黑盒证据散在仓库外（189 个一次性探针）、
上游 28 天 16 个 rc 却零追踪。

## 拆解

| 流 | 负责 | 产出 |
|---|---|---|
| A 文档真相源 | 子代理 | `docs/architecture.md` + `docs/decisions/ADR-0001..0012` |
| B 过程留痕 | 子代理 | `docs/rounds/R0.5…R6`（12 份）+ `docs/uat/`（4 份） |
| C 黑盒资产 | 子代理 | `e2e/`（19 文件：config/fixtures/8 specs/scenarios/README） |
| D 核心基建 | captain | `.gitignore`/`AGENTS.md`/`package.json`/`scripts/*`/`.github/*`/`renovate.json`/`docs/{backlog,status,testing,compatibility,agents,ROADMAP}`/`CONTRIBUTING`/`SECURITY`/`CLAUDE.md`/`.cursor/rules` |

关键取舍：

- 待办真相源选**仓库内 `docs/backlog.md`**（沙箱内也能读写），不依赖 GitHub Issues。
- `drafts/` 继续 gitignore（可能含机器专属数据），但**结论必须搬进 `docs/`**。
- 质量门只有一条 `npm run check`，本地与 CI 共用；沙箱另给 `npm run test:agent`。
- 代理不 push / 不打 tag / 不 publish（红线不变），也不改产品 profile。

## 验证

| 门 | 结果 |
|---|---|
| 静态闸门 `npm run check:static` | **16 项全 PASS**（新增 peer 家族一致性、CHANGELOG/状态不漂移、提交信息规范、仓库根残留物、backlog 格式、密钥扩面扫描） |
| 类型 `npm run typecheck` | 0 错误 |
| 单测 `npm test`（CI 权威） | **238/238** |
| 沙箱单测 `npm run test:agent` | 196 通过 + 7 沙箱受限（进程/DACL），退出 0 |
| 构建 `npm run build` | 成功（tsc + tsdown） |
| 发布面 `scripts/pack-smoke.mjs` | ALL PASS（80 文件 / 0.26 MB） |
| 黑盒 `npm run e2e` | **9/9 通过**（隔离 lab 50599，21s） |

## 结果

- **顺带修掉 3 个真实缺陷**（都是新基建首跑抓到的，此前无人发现）：
  1. `dsh-session` 0.1.2-rc.1 移除 `Session.events` → `t6` 静默失败 2 天（`FIX-1`）；
  2. 设置页用户名输入框溢出卡片 13px（`inputStyle` 缺 `minWidth: 0`，`FIX-2`）；
  3. npm 包内含 source map，118 文件 / 0.40 MB → 80 文件 / 0.26 MB（`FIX-3`）。
- 仓库从 77 个入库文件扩到「代码 + 规则 + 决策 + 轮次 + 测试策略 + 兼容矩阵 + E2E + UAT」，
  clone 后任何 agent 都能自己跑门、自己看状态。
- 状态从 5 处手写快照收敛为 `docs/status.md`（生成）+ `docs/backlog.md`（唯一待办），
  静态闸门校验不得过期。

## 遗留

- `INFRA-8`（AgentTeams profile 注册）**blocked**：契约与可粘贴配置已入库（`docs/agents.md`），
  但生效需要把 `profiles:` 合入宿主组合并重启——属产品 profile，由仓库所有者执行。
- `SEC-1` / `SEC-2`（副工作区权限绕过）仍待拍板，见 `ADR-0012`。
- `PUB-1` / `PUB-2`（发布 0.1.2 + 生产换装）待用户 2FA 与重启。
- E2E 现有 7 个场景只覆盖「不需要真实 SSH 服务器」的面；远程连接/`sw_exec` 场景需另立（见 `e2e/scenarios.md` 的「刻意不覆盖」）。

来源：本轮实现与 `git log`；体检结论见 `docs/status.md`、`docs/testing.md`、`docs/compatibility.md`。
