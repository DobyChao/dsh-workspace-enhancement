# R14 — BUG-2 修复：MixedFileSystem 补 processPathFromHostPath（带图请求全变 TRANSPORT）

- 轮次：R14（分支 `fix/BUG-2-mixed-fs-hostpath`，base `main` = e0334ac）
- 团队：bug2-mixed-fs（A 路 t1→t2→t4→t5→t6；B 路 t3 契约审计）
- 状态：BUG-2 → done；发布归 PUB-3（0.1.3），3080 重启由用户执行

## 1. 根因链

1. `dsh-fs` 接缝实为 **13 个方法**：第 13 个 `processPathFromHostPath(hostPath): string | undefined`（声明 `dsh-fs/lib/types/index.d.ts:106`；基类具现空实现 `dsh-fs/lib/index.js:83`；`LocalFileSystem` 真实实现 `dsh-fs-local/lib/index.js:716`，`SandboxedFileSystem extends LocalFileSystem` 自动继承）。
2. 图片附件解析走这条路径：`dsh-llm-deepseek/lib/index.js:2029` 与 `dsh-llm-pi-ai/lib/index.js:2496` 均为 `resolveImageAccess: … (hostPath) => ctx.get("fs")?.processPathFromHostPath(hostPath)`。
3. 本插件把 `ctx.fs` 换成 `MixedFileSystem`（`src/plugin.ts:100`），而该类只实现 `FileSystemBranch` 声明的 12 个方法（`src/mixed.ts:190` 类型、类体）→ 方法缺失 → `TypeError` → 被适配器包成 `LlmError(…, "TRANSPORT", { cause })`（`dsh-llm-deepseek/lib/index.js:1630`）→ 带图请求约 10ms 内失败、未出网；纯文本正常。
4. 闸门为何没拦住：`FileSystemBranch` 类型里没有该方法，`tsc` 无从报错；贴图路径此前零测试覆盖。

## 2. 改动清单（本分支两提交之和）

- `src/mixed.ts`：`FileSystemBranch` 补第 13 个方法 `processPathFromHostPath(hostPath): string \| undefined`（原来 12 个 → 这就是闸门盲区）；`MixedFileSystem` 实现为 `return this.local.processPathFromHostPath(hostPath)`——该接缝无 targetKey/cwd 可路由，宿主文件只属 local 世界，remote（`SshFileSystemEngine`）不共享宿主文件、故意不转发。
- `test/mixed-fs-contract.test.ts`（新增，7 条）：
  - 反射式契约：从具体后端（LocalFileSystem/SandboxedFileSystem 原型链）反射得到 13 个方法名全集并硬断言；门面缺任一即红。**注意**：任务书原口径 `Object.getOwnPropertyNames(FileSystem.prototype)` 不可行——运行时只有 `['constructor','processPathFromHostPath','sandboxMode']`（抽象成员被 TS 擦除），t2 改为对具体后端反射，覆盖更强（上游新增抽象方法时该用例会红，提示补门面）。
  - 语义：真实 `LocalFileSystem` 逐输入比对（绝对→resolve、相对/空→undefined、`ssh://` 前缀→undefined）；`SandboxedFileSystem` 同样断言。
  - 世界归属：远程 cwd 下宿主映射仍走 local，`explodingRemote()` 保证任何远程委派立即抛。
- `test/mixed-install.test.ts`：安装后门面断言（sandboxed delegate 与 bare local 两条安装路径）。
- `test/mixed-routing.test.ts`：stub 补该方法（类型要求）+ 断言宿主映射不误路由 remote。
- `docs/backlog.md`：BUG-2 置 done + AUDIT-1/2/3 新行（见 §5）。
- `docs/rounds/R14-BUG-2-contract-audit.md`：t3 契约审计报告。

## 3. 验证证据（t4 独立验证，全部 verifier 自建）

- **闸门**（最终工作树）：`npm run check:static` → exit 0 ALL PASS（16 项）；`npm run typecheck` → exit 0；`npm run test:agent` → exit 0（22 文件：18 可跑 / 4 需 esbuild；213 tests / 207 pass / 6 fail，6 条全部沙箱受限：`mixed-routing.test.ts:155/322`（spawn EPERM / SetFileSecurityW EACCES）与 `side-workspace-attacks.test.ts:255/266/272/281`（spawn EPERM）；`SANDBOX-LIMITED PASS`）。main 快照对照证明这 2 条 mixed-routing 失败修复前即存在，非 t2 引入。
- **上游调用式探针**（`.tmp/t4/probe.ts`，经真实 `installMixedProviders`，mapper 逐字复制 `dsh-llm-deepseek/lib/index.js:2029`）：
  - fixed：`methodPresent=true`；绝对路径（`C:\…\dsw-bug2-probe.png`、`/tmp/…`、`C:\Users\Admin\shot.png`）返回非空映射且与 `path.resolve` 及真实 `LocalFileSystem` 输出逐输入相等；相对/空/`ssh://` → `undefined`；全程不抛。
  - prefix（main 快照）：`methodPresent=false`；同一调用抛 `TypeError: … is not a function`，按上游 1626–1630 catch 形状包成 `LlmError code=TRANSPORT`——完整复现 BUG-2 现象并证明修复。
- **评审**：t5 verdict = pass（r1 一次通过）。

## 4. t3 契约审计结论摘要

对 `ctx.fs`（上游 15 成员）、`ctx.subprocess`（3 成员）、`sideWorkspaces`（自有服务 9 成员）做了「上游声明 / 门面实现 / 调用点 file:line」三列矩阵：**除 G1（=BUG-2 本体）外未发现新的「调用方存在、门面缺方法」缺口**。无调用点处均如实标注「未找到调用点」。反向检查（我方假设上游存在的成员：setSandboxMode、session/created、sandboxPolicy、jobs.start、ssh/sshRegistry、settings、client 窄面）全绿。详见 `docs/rounds/R14-BUG-2-contract-audit.md`。

## 5. 派生待办（已落 backlog）

| ID | 内容 | 优先级 |
|---|---|---|
| AUDIT-1 | 门面改 `extends` 上游基类，防「上游新增具现方法 → 门面缺方法」复发 | P3 |
| AUDIT-2 | `resolveExecutable` 恒本地的世界边界 ADR 化 | P3 |
| AUDIT-3 | `test/side-workspace-gates.test.ts:37` stubFs 补第 13 方法（当前无害） | P3 |

## 6. 剩余风险

- **session 轨迹看不到 cause**（用户原始观察之一）：本修复消除的是 cause 本身（不再抛），但「适配器把 cause 吞进 LlmError 后轨迹不显示」的展示层问题若独立存在，需另开条目观察——已在 BUG-2 备注中注明，未单独开行。
- 探针覆盖的是 deepseek/pi-ai 两条路由的 mapper 调用式；真机端到端贴图（上传→附件→请求→返回图）仍需 UAT（见 §7）。
- `test:agent` 的 6 条沙箱受限失败的权威判定仍是 CI `npm test`。

## 7. 待用户动作（代理不做）

1. `git push -u origin fix/BUG-2-mixed-fs-hostpath` + PR（标题必须 Conventional：`fix(mixed-fs): …`）+ squash merge。
2. 随 PUB-3（0.1.3）发布；3080 换装重启由用户执行（`scripts/restart-3080.ps1`，会话外）。
3. 真机 UAT：3080 重启后贴图发起带图请求，确认不再 TRANSPORT（建议脚本补进 `docs/uat/`）。
