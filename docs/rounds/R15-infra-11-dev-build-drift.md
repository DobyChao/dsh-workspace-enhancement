# R15 — 开发安装的 `lib/` 产物漂移（INFRA-11）

> 触发：2026-09-09 用户问「下一步做啥」，接手排查时发现 **3080 正在跑过期产物**。
> 本轮**不写产品代码**（用户明确「只做收尾，先别写代码」），只做取证、闸门可见性、文档与看板。

## 1. 发现（取证）

3080 的 profile（`$DSH_HOME/profiles/web/package.json`）以 `link:D:/ZCodeProject/dsh-workspace-enhancement`
安装本插件，`main` = `lib/index.js`——**加载的是 gitignore 的构建产物 `lib/`，不是 `src/`**。

| 事实 | 值 |
|---|---|
| 3080 监听进程 | PID 28224，启动于 `2026-09-09 14:11:22` |
| `lib/` 最后构建 | `2026-09-09 11:47:32–33` |
| 其后合并的 src 提交 | PR #3 `13291be`（BUG-2，15:14）、PR #5 `8dea759`（REQ-I6，17:52） |
| 重建后变化的产物 | `lib/tools.js`、`lib/exec-tools.js`、`lib/dsw.js`、`lib/dsw.en.js`、`lib/client.js`（5 个） |

**结论**：该实例加载的产物**早于** BUG-2 与 REQ-I6 的合并，即 REQ-I6 的最终态（模型提示英文化 +
按需注入 + 词典删 12 键）在 3080 上**没有生效**。已执行 `npm run build` 重建 `lib/`；**必须重启
3080 才会加载新产物**（红线 3：重启只由用户执行）。

**为什么没人发现**：`lib/` 被 `.gitignore` 覆盖，`scripts/check.mjs` 的 12 项静态闸门没有一项
比较 `lib/` 与 `src/`；而 CI 每次都在干净检出里先 `build`，所以 CI 永远绿——这是**只有开发机
（link 安装）才会中的盲区**。

## 2. 本轮改动

| 文件 | 改动 |
|---|---|
| `scripts/check.mjs` | 新增第 13 项**非阻断诊断**：`lib/` 最新产物 mtime 早于 `src/` 最新修改时打 `WARN`（提示 `npm run build`）。CI 无 `lib/` → 静默跳过；永不进 `failures`，不误红 |
| `AGENTS.md` | §3 加「改了 `src/` 必须 `npm run build`」+ 3080 link 安装的后果说明；`check:static` 行标注 WARN；§8 的「当前唯一即刻事项」从已过期的 `PUB-1 0.1.2` 改为当前事项 |
| `docs/backlog.md` | 新增 `INFRA-11`（todo）：记录实锤证据 + 待做（升级为阻断、`restart-3080.ps1` 重启前自动 build） |
| `docs/status.md` | `npm run status` 重新生成 |

**为何是 WARN 不是 FAIL**：mtime 只是启发式——`tsc`/`tsdown` 对**字节相同**的产物不重写（本轮
观察到 `lib/model-prompts.js` 保留旧 mtime），改成阻断会产生假阳性并卡住 `npm run check`。
更稳的信号（构建戳 / 内容哈希）留给 `INFRA-11` 待做项。

## 3. 验证

- `npm run check:static` —— 12 项 PASS（新增 WARN 在 `lib/` 新于 `src/` 时不输出）
- `npm run typecheck` —— 0 错误
- `npm run test:agent` —— 沙箱内单进程用例（产品代码未改，预期无变化）
- 负向验证：把 `src/` 里任一文件 `touch` 到比 `lib/` 新 → 闸门输出 WARN（见下）

## 4. 遗留

- 用户重启 3080 后需确认 REQ-I6 生效（本地会话系统提示不含本插件文案）。
- `INFRA-11` 待做两项：阻断级信号、`restart-3080.ps1` 自动 build。
