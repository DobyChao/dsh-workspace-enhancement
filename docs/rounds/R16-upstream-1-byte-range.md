# R16 — UPSTREAM-1：`readByteRange` 与双家族声明

> 触发：2026-09-10 哨兵 `drift (next)`/`drift (alpha)` 双红 —— `0.1.5-rc.1` 发布，
> 且宿主包 `@deepseek-ai/dsh` 的 **`latest` 直接指向它**。用户拍板 **B：双家族**（加法实现 + 联合 peer 范围）。

## 1. 事实（取证）

| 事实 | 值 |
|---|---|
| 上游通道（2026-09-10 实测） | 接缝包 `latest=0.0.1-rc.1` / `next=0.1.5-rc.1` / `alpha=0.1.5-alpha.2`；**宿主 `@deepseek-ai/dsh` 的 `latest` 与 `next` 都是 `0.1.5-rc.1`**，`0.1.5-rc.1` 发布于当日 03:01 UTC |
| `0.1.5` 线上的版本 | 只有 `0.1.5-rc.1`（用户提到的 "rc.5" 实为版本号里的 `.5`） |
| 接缝差异 | `dsh-fs` 的 `lib/types/index.d.ts` 两版**只差一个新增抽象成员**：`readByteRange(target: FsTarget, range: {offset,length}, signal?): Promise<Uint8Array>`；无删除、无改名、无签名变更 |
| 老家族（0.1.2-rc.1） | 全局安装树里 `readByteRange` **零调用点** → 老宿主永远不会走到它 |
| 对新家族的类型错误 | 今天两条通道各只有 1 条：`src/filesystem.ts(589,14) TS2515 … does not implement inherited abstract member readByteRange` |
| 上游参考语义（`dsh-fs-local@0.1.5-rc.1`） | `statRegularFile` → `length === 0` 直接空 → `createReadStream{start: offset, end: offset+length-1}` → 拼接；**从不整读**；越界起点返回空流 |

## 2. 改动

| 文件 | 改动 |
|---|---|
| `src/filesystem.ts` | 引擎新增 `readByteRange`（SFTP 窗口读，`end` 闭区间；非普通文件 `FS_NOT_REGULAR_FILE`、中止 `FS_ABORTED`）；`SshFileSystem` 前向，**不写 `override`** |
| `src/mixed.ts` | `FileSystemBranch.readByteRange` **可选**（老家族后端没有它）+ 长注释说明为什么可选；`MixedFileSystem.readByteRange` 按 targetKey 路由，local 委托缺方法时抛 `FS_IO_ERROR`（显式失败，不退化成整读） |
| `package.json` | 13 个宿主 peer 改 `^0.1.2-rc.1 \|\| ^0.1.5-rc.1`；dev 保持 `0.1.2-rc.1`（CI 主路径继续验线上家族） |
| `scripts/check.mjs` | #6 重写：peer 必须同一声明范围（允许 `\|\|` 联合）、dev 必须是该范围的一个备选、**联合范围里每个家族都必须在 `upstream.yml` 被点名** |
| `.github/workflows/upstream.yml` | 矩阵改 `include`，新增 **`legacy` 通道**（按版本钉 `0.1.2-rc.1`，即线上 3080 跑的家族）；issue 文案分三档 |
| `test/mixed-fs-contract.test.ts` | 静态清单 13 → **14**（与家族无关，老家族下照样挡回归）+ 反射断言拆成"老方法没丢"与"跟得上安装家族"两条；反例自证参数化 |
| `test/upstream-1-byte-range.test.ts`（新） | 引擎窗口参数（`{start:5,end:9}`、`readFile` 零调用）、EOF 空、`length=0` 不开窗、非普通文件、中止、门面路由、**老宿主守卫**、真实后端语义（老家族自动 skip） |
| `docs/compatibility.md` | §1 支持窗口加双家族行；§2 加"rc 提级"一行；§3/§3.1 改三通道说明 |

## 3. 验证

- `npm run typecheck` —— **0 错误**（对老家族 0.1.2-rc.1：加法改动没伤它，这就是"还能用吗"的直接证据）
- `npm run test:agent` —— **240 pass / 0 fail / 1 skipped**（22 文件）；`test/mixed-fs-contract` + `test/upstream-1-byte-range` 16 例：15 pass、1 skip（语义用例需要 0.1.5 家族）
- `npm run check:static` —— ALL PASS，新增 5 条 #6 断言全绿（`0.1.2-rc.1 || ^0.1.5-rc.1: 13 pkg` / `dev=0.1.2-rc.1` / `2 families: 0.1.2-rc.1 | ^0.1.5-rc.1`）
- **新家族验证（CI，run 34467974837 首次三通道）**：
  - `drift (legacy)`（0.1.2-rc.1，**线上家族**）—— **全绿**
  - `drift (next)` / `drift (alpha)`（0.1.5 线）—— **typecheck 通过**（原 TS2515 消失），新用例全部通过，其中
    `real local backend: window semantics match the seam … ok 245` **在真实 0.1.5 后端上跑过且通过**（是对齐上游语义最强的证据）
  - 同一轮暴露**探针自身的缺口**（非产品缺陷）：`dsh-subprocess@0.1.5-rc.1` 依赖 `@deepseek-ai/dsh-http-proxy`，而 `npm install --no-save --legacy-peer-deps` 在既有树上替换家族成员时**没把新依赖带进来** → `mixed-install`/`mixed-routing`/`side-workspace-attacks` 三个套件 `ERR_MODULE_NOT_FOUND` 红。已修：探针新增"家族闭包"第二遍安装（扫描已装家族的 `dependencies`，缺失的按同一通道补装）

## 4. 覆盖边界（诚实标注）

1. **谁在新宿主上调 `readByteRange`**：本机只有 0.1.2-rc.1，无法 grep 调用方；引擎窗口参数由假 SFTP 断言，真实 SFTP 行为靠 ssh2 源码（`toRead = end - pos + 1`，EOF 时 `push(null)`）与上游参考实现对齐。
2. **Windows/Linux 差异**：本改动不涉及路径语义，但 CI 矩阵仍会跑（ubuntu 22/24 + windows 22）。
3. **`legacy` 通道的有效期**：当线上宿主升到 0.1.5 线后，`legacy` 应改为盯当时的"上一代"，或把 dev 切到新家族、`legacy` 保留为回归网。

## 5. 遗留

- `AUDIT-1`（门面 `ctx.set` 纯对象替换而非 `extends` 上游基类）**仍然是结构根因**：这次又靠"手工补方法 + 反射契约"救了一次，第三次还会重演。
- issue #7 应在三通道转绿后关闭（人工确认后关闭，不由 CI 自动关）。
