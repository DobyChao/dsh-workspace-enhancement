# 上游兼容矩阵与追踪

> 本插件寄生在快速迭代的宿主上：`@deepseek-ai/dsh` 在 2026-08-10 ~ 09-07 的 28 天里发了
> **16 个版本**（同一天多个 rc 是常态），官方仓库根**没有 CHANGELOG**，且 GitHub 侧
> `has_issues=false` / `has_pull_requests=false`（只有 discussions）——**上游改了什么，你不会有通知**。
> 因此兼容性必须靠自动化盯着，而不是靠出事后再查。

## 1. 支持窗口

| 插件版本 | 宿主 `@deepseek-ai/dsh` | 状态 | 说明 |
|---|---|---|---|
| 0.1.3（当前） | `0.1.2-rc.1` 家族 | 支持 | 发布形态修正：`dependencies` 仅 `ssh2`、15 个 peer 走 `^0.1.2-rc.1`；含 BUG-2 贴图修复与 REQ-I6 |
| 0.1.2 | `0.1.2-rc.1` 家族 | 建议升级 | 同家族，但 npm 产物仍是旧依赖形态（13 个 `@deepseek-ai/*` 落在 `dependencies`） |
| 0.1.1 | `0.1.1-rc.2` 家族 | 停止支持 | 家族劈叉缺陷版；建议升级 |
| 0.1.0 | `0.1.0-rc.6` 家族 | 停止支持 | 首次发布版 |
| 更早 / 更晚 | — | 未验证 | 上游 rc 通道，不承诺向前或向后兼容 |

**窗口策略**：只支持"当前家族"，不为旧宿主做兼容层（与社区标杆 dsh-better-sidebar 的做法一致：
宣布支持窗口，让旧宿主用户钉旧版插件）。跨越家族升级时，在 CHANGELOG 写明破坏点。

## 2. 已知破坏案例（都是真实发生过的）

| 日期 | 上游变化 | 症状 | 处置 | 现在被什么挡住 |
|---|---|---|---|---|
| 2026-08-30 | 接缝包家族版本劈叉（`dsh-fs`/`dsh-subprocess`/`dsh-timeout` 停在 `^0.1.0-rc.6`，`dsh-llm` 钉 `0.1.1-rc.1`，其余 `^0.1.1-rc.2`） | pnpm hoist 图出现重复副本 → Cordis 服务身份分裂（service/工具注册失效） | 全家族对齐同一 rc；`dependencies` 只留 `ssh2` | `check.mjs` #6「一个 rc 家族」+ #6b「peer 用 rc 通道」 |
| 2026-09-08 | `@deepseek-ai/dsh-session` 升到 `0.1.2-rc.1`，`Session.events` 数组被 `ownEvents()` / `snapshotEvents()` 取代 | `test/mixed-install.test.ts` 的 t6 静默失败 **2 天无人发现**（无 CI、代理跑不了测试） | 改用 `ownEvents()` | `ci.yml` 全量单测 + `upstream.yml` 每周哨兵 |

> 第二个案例是建立 CI 的直接动因：**依赖升级能悄悄弄坏测试，而当时没有任何机制会喊一声。**

## 3. 四层防护

| 层 | 机制 | 位置 | 触发 |
|---|---|---|---|
| L1 静态 | 所有 `@deepseek-ai/dsh-*` 必须同一 rc 家族；peer 范围必须带 `-rc.`；宿主包不得进 `dependencies` | `scripts/check.mjs` #6 | 每次 `npm run check` |
| L2 升级 | Renovate 把 `@deepseek-ai/*` 分组为一个 PR（peer 与 dev 同步升级），禁止自动合并 | `renovate.json` | 每周 |
| L3 哨兵 | **双通道**探测：`next`（我们锚定的 rc 家族）与 `alpha`（下一代预警）各自重装家族，跑 typecheck + 全量单测 + 静态闸门；任一红则自动开/更新 issue | `.github/workflows/upstream.yml` | 每周一 + 每周四 + 手动 |
| L4 运行时 | 能力探测而非版本假设：可选服务 `ctx.get()` 判空、特性探测、双键回退、首用 fail-loud | `src/**`（见下） | 运行期 |

L3 的判读：它红不代表要立刻改代码，而是**代表"上游已经变了，你需要看一眼"**——
这正是"上游非兼容修改识别"想要的信号。

### 3.1 双通道哨兵：为什么要盯 alpha

npm 上 `@deepseek-ai/dsh` 家族有三个通道：`latest`（`0.0.1-rc.1`，旧）→ `next`（我们锚定的 rc 家族）
→ **`alpha`（下一代）**。**破坏性接缝变更最先落在 alpha**，其内容迟早被提升为 rc；等它变成 rc 再动，
就只剩救火窗口。所以哨兵同时探测两条通道：

| 通道 | 现在解析到 | 含义 |
|---|---|---|
| `next` | `0.1.2-rc.1` | 我们已声明支持的家族——红了 = **线上坏了** |
| `alpha` | `0.1.5-alpha.2` | 下一代——红了 = **提前预警**（还有提升缓冲期） |

alpha 已经出现我们**从未依赖过的新包**：`@deepseek-ai/dsh-brand`、`@deepseek-ai/dsh-invariants`
（`dsh-fs@alpha` 的依赖里可见）——这正是「alpha 内容并入 rc 后我们需要改」的典型形态；
用户实测「用最新 alpha 装插件会炸」也是同一来源。**判读**：红了不是立刻改代码，而是当天看一眼；
alpha 的 issue 会一直挂着直到处理（自动开/评论，不用人肉记）。

> 历史坑：旧版哨兵 `npm install --no-save <pkg>` 不带版本，装的是 `latest` 标签（`0.0.1-rc.1`），
> 比 `next` 还旧——等于每周测了一个更老的家族。现在按 dist-tag 显式解析、并打印实际解析结果。

## 4. 运行时能力探测约定（写代码时遵守）

1. **可选服务**用 `ctx.get('name')` 判空，不要用 `inject` 硬绑（硬依赖才 `inject`）。
2. **特性开关**优先探测能力（如 `features.includes('x')`），其次才比较版本字符串。
3. **服务改名过渡期**用双键回退：`ctx.get('newName') ?? ctx.get('oldName')`。
4. **可选 peer** 用 `peerDependenciesMeta.<pkg>.optional = true` 声明，不要塞进 `dependencies`。
5. **依赖其它插件行为的校验延后到首次使用**（最早可解析点 fail-loud），不要在 `apply()` 里做。
6. **副作用必须可逆**：注册/监听/定时器/槽位一律挂 `ctx.effect()` / `ctx.on()`；重装或热更新后再挂一次不能抛
   "already registered"（生态里真实崩过，属于固定回归点）。

## 5. 维护本文件

- 每次发布：在 §1 增加一行（插件版本 × 宿主家族 × 状态），并把窗口收窄/放宽写清。
- 每次踩到上游变更：在 §2 加一行（日期 / 变化 / 症状 / 处置 / 现在被什么挡住）。
- 表格里的"现在被什么挡住"必须是**已存在的自动化**，不能是"下次注意"。
