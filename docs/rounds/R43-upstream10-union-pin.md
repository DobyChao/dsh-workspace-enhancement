# R43 — UPSTREAM-10：0.2.0 家族对齐（A 案联合 pin）

> 一轮 = 一条指令（用户拍板 A）= 一个 PR（#50，squash `7333586`）。
> 日期：2026-09-29。前置：R42（INFRA-19/20），UPSTREAM-8/9 已合并（peer `^0.1.7-rc.2`）。

## 1. 背景

上游把 harness master 以 rc 发布：`next` → **`0.2.0-rc.1`**（13 个 seam 包同步跳线；首个 rc 组合残缺——
`dsh-web-app` 钉了未发布的 `dsh-client-ui-settings-account@0.2.0-rc.1`，次日补齐）。三哨兵首日实战
全响（tag-watch #48 / scope-watch #46 / drift #49）。

快速兼容性排查（用户指令）三层结论：

1. **契约面**（`.tmp/rc20-contract` scratch 磁盘权威源 diff）：settings / jobs owner+ring / fs /
   subprocess / `ToolRunContext.agent` 与 0.1.7-rc.2 **逐字一致**——UPSTREAM-8 双家族适配原样覆盖。
2. **静态+单测+build**：dispatch drift 对 0.2.0-rc.1 全绿。
3. **boot**：原 pin 插件被 0.2.0 宿主**静默跳过**——0.2.0 新增**boot 时强制执行插件
   peerDependencies**（不符即整 bundle skip、通道 404；0.1.x 仅 pnpm 警告；stderr 提供
   `dsh plugin allow-version` 豁免通道）。联合 pin 副本探针 SMOKE PASS ⇒ 运行时兼容，唯一缺口 = pin。

用户在 A（立即联合 pin）/ B（等 `latest` 翻整体升）间**拍板 A**：静默无通道的坏体验是现实风险。

## 2. 交付（PR #50）

- **联合 pin**：13 个 peer `^0.1.7-rc.2` → `^0.1.7-rc.2 || ^0.2.0-rc.1`；devDeps 留 `^0.1.7-rc.2`
  （主家族不变，锁文件最小扰动）。**真仓库**对 0.2.0-rc.1 宿主 boot 哨兵 SMOKE PASS（端到端证明）。
- **upstream.yml**：drift 矩阵加 `pinned-0.1.7-rc.2` 固定版本通道——联合范围每个家族必须被点名探
  （闸门规则）；0.2.0 线随移动的 `next` tag。
- **check.mjs**：①家族点名检查按备选归一化（`^0.2.0-rc.1` 的家族身份是裸版本）；②**workflow 顶层键
  唯一性闸门**（负向验证过：重建 09-28 的重复 `jobs:` 坏文件 → FAIL 且点名 `jobs`）。
- 文档：CHANGELOG、README/zh 0.2.0 行（警示 0.2.0 宿主勿装 0.2.2）、compatibility 支持窗口。

## 3. 验证

本地：check:static ALL PASS（含新闸门 + 联合家族点名 2/2）+ typecheck + test:agent（50 文件）+ build +
WSL verify-linux（联合 peers 下 npm ci/tests/pack 全绿）+ boot 哨兵双跑（0.1.5 全局宿主回归 PASS；
0.2.0-rc.1 宿主 PASS）。CI：PR #50 全绿；合并后 dispatch drift 三通道（next=0.2.0 线应转绿 → 关 #49）。

## 4. 事故与教训（本轮自纠）

1. **09-28 埋雷**：INFRA-20 给 upstream.yml 插 tag-watch 时造出重复顶层 `jobs:` 键，整个 workflow
   被 GitHub 拒收——tag-watch 与 drift **静默不跑**，且 CI 不校验该文件（dispatch 报 422 才暴露）。
   已热修并把该 bug 类做成闸门（本轮交付）。教训：workflow 是代码，改动需要校验闭环。
2. **轮初 backlog 编辑静默失效**：搬 §1 的 node 脚本 replace 未命中却照常打印成功、提交未携带
   （收尾时发现合并提交无 backlog diff，已补 §4）。教训（重申）：脚本化文档编辑必须断言替换命中
   ——`String.replace` 不命中是无操作。此坑 R41/R42 也踩过变体，**值得进 INFRA-21 的协议或一个小
   工具函数**（如 scripts/lib 的 `replaceOrThrow`）。
3. 网络整日不稳（7890 代理多次抖动/宕机），gh/git 反复走 `env -u *_PROXY` 直连。

## 5. 遗 tail

- 0.2.0 宿主上的 L1 矩阵走查（M3/M4 工具路径）——首个涉工具路径的 PR 或发版前 L2。
- `pinned-0.1.7-rc.2` 通道随 0.1.7 家族退役一并移除；`latest` 翻 0.2.0 时按政策评估收窄回单家族。
- CHANGELOG Unreleased 已攒三轮（UPSTREAM-8/9、INFRA-19/20、UPSTREAM-10），发版时机待用户。
