# 代理与团队配置

> 目标：把「一轮开发该有哪些角色、按什么 DAG 拆」从每轮临时决定，变成可复用的配置。
> 本目录存放 **AgentTeams 团队 profile 的契约与可粘贴配置**；实际生效需要在宿主组合里注册。

## 1. 为什么需要它

过去 12 轮开发（见 `docs/rounds/`）每轮都由 Captain 现场组队、现场拆任务。有效，但：

- 角色与粒度每轮重来，好的拆法没有沉淀；
- 新接手的代理不知道该拉几个角色、谁验谁审；
- 并行与依赖边界靠临场判断，容易要么过度并行、要么串成一条长链。

## 2. 两个标准 profile

### `dsw-round` —— 标准开发轮次

| 角色 | 职责 | 不该做什么 |
|---|---|---|
| captain | 拆解目标、维护 DAG、派活、收口 | 不替成员写实现 |
| engineer-host | `src/*.ts` 宿主半（provider/注册表/工具/RPC） | 不碰客户端 UI |
| engineer-client | `src/client/*.tsx` 客户端半（槽位/表单/徽标） | 不碰宿主服务接线 |
| verifier | 单测 + lab E2E + `--dump-config` 断言，产出证据 | 不改产品代码 |
| reviewer | 按验收标准评审，给 `pass` / `needs_revision` | 不审自己的实现 |

- `taskPlanning: captain`：Captain 依据目标现场拆 DAG，而不是套固定模板。
- 任务粒度：**一个模块边界 + 一个可验证断言**。依赖链只连真前置。
- 质量门：需求 → 实现 → 验证 → 评审 → 集成；评审不过自动进修复 + 复审。

### `dsw-spike` —— 只做侦察与设计

| 角色 | 职责 |
|---|---|
| captain | 收口结论，产出 ADR 草稿 |
| scout | 磁盘权威源/上游契约侦察（**禁止** `cordis_inspect_*`） |
| architect | 方案对比、取舍、风险 |

- 产出必须落到 `docs/decisions/ADR-*.md`（proposed）与 `docs/backlog.md`，**不写实现代码**。

## 3. 配置契约

profile 由 `@nanmicoder/dsh-agent-teams` 读取，配置位于宿主组合中该插件行的 `config.profiles` 段
（profile 名 → `{ description, protocol, taskPlanning, members[], tasks[] }`）。
字段语义见该包 `lib/types/profiles.d.ts`。

仓库内提供可直接粘贴的片段：

- [`agents/dsw-round.yml`](./agents/dsw-round.yml)
- [`agents/dsw-spike.yml`](./agents/dsw-spike.yml)

**不要写死 provider/model**：成员默认继承当前会话的路由；只有目标明确要求不同模型时才在 profile 里指定。

## 4. 落地步骤（需仓库所有者执行）

1. 打开宿主组合（例如 `$DSH_HOME/profiles/web/cordis.patch.yml`）。
2. 在 `@nanmicoder/dsh-agent-teams` 那一行的 `config:` 下加入 `profiles:`，内容取自上面两个片段（合并，不要覆盖已有键）。
3. `dsh --profile web --dump-config` 确认 `profiles` 出现在该插件行。
4. 重启该 profile 后，用 `/agent-teams --profile dsw-round <目标>` 验证 roster 与 DAG 是否为预期。

> 代理不代改产品 profile（见 `AGENTS.md` §5 红线 2/3）：该文件在仓库工作区之外，且改动需重启才生效。

## 5. 与状态的关系

- 这两个 profile 本身是待办 `INFRA-8a` / `INFRA-8b`，状态在 `docs/backlog.md`；
- 每次用它跑完一轮，在 `docs/rounds/` 记录实际 DAG 与偏差——**profile 是要迭代的，不是一次写死**。
