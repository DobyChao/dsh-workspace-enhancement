# R40 — 发布 npm `v0.2.2`

- **日期**：2026-09-26
- **需求**：`PUB-7`（随本轮进 master 的：`BUG-10` / `UPSTREAM-5` / `UPSTREAM-7` / `AUDIT-1`）
- **范围**：版本 bump + 核心工件 `0.2.1 → 0.2.2`；不含 REQ-I14 / REQ-I17 等仍在 §2 的项

## 1. 目标

把已进 `master` 的 0.2.1 之后改动发布为 `0.2.2`：远程目录包 skill 三层修复
（宿主 join 的归一 / win32 搅碎 / posix 塌缩三种破坏形态）、0.1.7-rc 接缝对齐
（fs `watch` + subprocess `terminalEnvironment`）、scope watch 哨兵、drift workflow 加固。

## 2. 拆解

1. 版本：`package.json` / lock、`CHANGELOG` 0.2.2 段、`core/artifact.json` + 生成的
   `src/core-artifact.ts`（`sync:core-manifest`）、Go `coreArtifactVersion`。
2. **核心工件 bump 到 `0.2.2`**：serve 的 workspace 世界绑定变化在核心里（PR #31），
   已部署 0.2.1 核心的机器需再点一次「部署核心」（CHANGELOG 已写明）。
3. 兼容窗口：`docs/compatibility.md` §1 当前发布改到 0.2.2；宿主仍 `^0.1.5-rc.1`
   （0.1.7-rc 线经哨兵实证兼容，README/zh Compatibility 表已注明自本版生效）。
4. tag `v0.2.2` → `release.yml` 排队 → 所有者在 `npm-publish` 点 Approve → OIDC 发布。

## 3. 验证

产品代码已在 #37 / #38 / #42 的 CI 全绿；发版当日的 drift 终 dispatch 三作业全绿
（run 36216275977）。PR #43（`chore/PUB-7-v0.2.2`）CI 全绿；WSL 复验 TEST_EXIT=0。

发版产物核验：npm `0.2.2` **解包 3.53 MB**——`core/dist` 里曾累积 0.2.0/0.2.1/0.2.2
三个工件、`files` 的 glob 会全打包（8.29 MB），清掉后干净；CI 干净检出无此问题
（0.2.1 的发布物 5.67 MB 疑似带着 0.2.0 旧核——deploy 按精确文件名选工件，
无正确性问题，纯体积，已记录）。

真机：BUG-10 win32 UAT 5/5（[`../uat/R38-bug10-skill-dir-uat.md`](../uat/R38-bug10-skill-dir-uat.md) §5）。

## 4. 结果

npm `0.2.2` 已发布（publish run 36221466070）。`PUB-7` 进 §4 `shipped`。

## 5. 遗留

- BUG-10 的两个验收尾巴（Linux E2E 复跑 + win32 回归）不阻塞发布（路由面已被
  单测 / WSL / 离线复放覆盖），记录在 §4 行内。
- 0.1.7 家族升 pin 等 `latest` 翻（ADR-0026 §4.7）；scope watch 会在上游动时响。
- 3080 不装本插件；lab 验证装 0.2.2 tarball 时记得先 `dsh plugin --profile web remove`
  旧的再 add（固定动作，AGENTS §3）。

来源：PR #43；`docs/compatibility.md` §1；npm registry。
