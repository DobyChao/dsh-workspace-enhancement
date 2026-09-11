# R19 — F2 落地：通道改走官方 `/api` 精确 Fetch 路由，0.1.5 家族运行时支持成立

- **轮次目标**：把 `UPSTREAM-3` 的 **F2**（`/dsw` 在 0.1.5 家族上 405）真正修掉，并按所有者决定
  **放弃 0.1.2 家族**（`UPSTREAM-4`）
- **日期**：2026-09-11
- **宿主家族**：`0.1.5-rc.2`（全局安装树 `@deepseek-ai/dsh@0.1.5-rc.1` + 230 个家族包 rc.2）、
  repo devDependencies 同族；隔离 lab `C:\Users\Admin\.dsh-lab`（唯一以 `link:` 装本插件的 profile）
- **决策**：`ADR-0018`（候选 A 自挂 `/dsw` vs 候选 B′ 官方精确 Fetch 路由 → **采纳 B′**）

## 0. 结论速览

| 问题 | 判定 |
|---|---|
| F2 修好了吗？ | **是**。真机（lab profile + 0.1.5-rc.2 宿主）：`POST /api/dsw/connections.list → HTTP 200`，`result.ok=true`，`value=[]`（真数据面） |
| 为什么不是 R18 的候选 A？ | A 要在 `webServer` 上下文里自挂 `/dsw` 前缀路由并**自行复刻上游桥接**（信封/栅栏/body 上限/流式语义）；B′ 走官方 `connection.fetch.register`，这些全由上游承担。**且 `rpc.intercept('/api')` 这条路被 `dsh-api-gateway` 占死**（单占位拦截器），精确 Fetch 路由是唯一「共享但互不打架」的官方接缝（`ADR-0018` §2） |
| 客户端改了多少？ | 一行语义：`rpc.call('/dsw', e)` → `rpc.call('/api', 'dsw/' + e)`；**信封协议零改动** |
| 0.1.2 家族？ | **退出支持**：peer/dev 全部收窄为 `^0.1.5-rc.1`；`upstream.yml` 删除 `legacy`（0.1.2-rc.1）通道；`--channel-warn` 降级口删除 |
| 闸门还绿吗？ | `check:static` **ALL PASS**（13 peer / 21 dev 同族）、`typecheck` **exit 0**（对 0.1.5-rc.2）、`test:agent` **SANDBOX-LIMITED PASS**（259 例：253 过 / 6 例沙箱受限）、`build` **exit 0** |
| 中途抓到什么？ | 真机探针先给了一次 **HTTP 200 但 `gateway/bad-request`**：我按裸端点名比对信封 `method`，而线上口径是 `/api` 之下的完整路径（`dsw/connections.list`）。已修并加用例钉死（§4） |

## 1. 关键事实（符号级）

| 事实 | 证据 |
|---|---|
| `connection.rpc.handle` 在 0.1.5 不可用 | `dsh-client-connection@0.1.5-rc.2/lib/index.js`：`get rpc()` → `const owner = this.ctx`；`register()` 末行 `owner.effect(() => owner.webServer.register(route), …)`；`const inject = ["credentials"]`（0.1.2-rc.1 为 `["webServer","credentials"]`） |
| 共享拦截器**已被占用** | `registerInterceptor()`：`if (this.interceptors.has(channel)) throw new Error('… already has an interceptor')`；`dsh-api-gateway@0.1.5-rc.2/lib/index.js:455` 已 `intercept("/api", …)`；lab 的 `--dump-config` 里该行在组合中 |
| 精确 Fetch 路由**优先于**拦截器 | `createSharedFetchHandler()`：先 `this.fetchRoutes.get(pathname)`，未命中才取 `this.interceptors.get(channel)`；`registerFetchRoute()` 只做 `owner.effect(...)`，不读 `owner.webServer` |
| 官方先例 | `dsh-client-file-upload@0.1.5-rc.2/lib/index.js:170` `ctx.connection.fetch.register({ path: FILE_UPLOAD_PATH, methods: ['POST'], requestBody: 'streaming', fetch })` |
| 栅栏仍在 | `/api` 前缀路由（由上游自己挂）在 `bridge()` 之前做 `connection.requestRejection(req)`（401/403），再校验浏览器会话 |
| 端点合法性 | `ENDPOINT_SEGMENT_PATTERN = /^[A-Za-z0-9_$.-]+$/`（点号合法）⇒ `dsw/connections.list` 是两段合法端点；`CHANNEL_PATTERN` 只约束通道本身（`/api`） |

## 2. 仓库改动

| 文件 | 改动 |
|---|---|
| `src/web-channel.ts` | **新增**：线协议单一来源 —— `API_CHANNEL`、`CHANNEL_NAMESPACE`、`channelEndpointOf`/`channelPathOf`、`channelRouteOf`（信封校验 + Fetch 适配器）、`isAlreadyRegistered` |
| `src/web.ts` | 挂载改为 `ctx.connection.fetch.register`（逐端点、`ctx.effect` 可逆）；`CHANNEL_ENDPOINTS`（26 个端点）与 `liveDispatch`（重载安全）；模块增强只声明 `connection.fetch`，**故意不声明 `rpc.handle`**；删掉 F1 的 `try/catch` 静默与 `ctx.inject(['webServer'])` 包裹 |
| `src/client/index.ts` | 两处 `rpc.call` 改走 `API_CHANNEL` + `channelEndpointOf(endpoint)`；模块注释更新 |
| `test/web-channel.test.ts` | **新增 11 例**：线身份、路由形状、信封/方法不符、415/400/404、dispatch 抛错 500、**重载契约**（老路由服务新 dispatch）、`isAlreadyRegistered` 判据、**端点清单 ↔ switch 一致性（读源码）**、**两半不得再硬编码通道**（读源码） |
| `package.json` | peer 13 项、dev 21 项全部收窄 `^0.1.5-rc.1`；dev 补 `@deepseek-ai/dsh-http-proxy`（0.1.5 的 `dsh-subprocess` 把它声明为 peer，而 `.npmrc` 的 `legacy-peer-deps=true` 不会自动装 ⇒ 三个套件曾 `ERR_MODULE_NOT_FOUND`） |
| `scripts/boot-smoke.mjs` | 探测路径改 `/api/dsw/connections.list`；**删除 `--channel-warn`**（不再有「已知破坏」白名单）；默认 CLI 解析补全（本仓库不再依赖 `node_modules/@deepseek-ai/dsh`） |
| `.github/workflows/upstream.yml` | 删除 `legacy` 通道与 `--channel-warn` 分支；注释与 issue 文案同步 |
| `docs/architecture.md` §4.1/§5.6 | 通道机制、模块表、端点口径改写；`ADR-0018` 新增 |

## 3. 验证（命令 + 结果）

```powershell
# 家族收窄后（package.json：peer 13 / dev 21 全部 ^0.1.5-rc.1）
npm run check:static     # ALL PASS（"peers declare one range — 0.1.5-rc.1: 13 pkg" / "dev… 0.1.5-rc.1: 21 pkg"）
npm run typecheck        # exit 0（对 0.1.5-rc.2 类型面）
npm run test:agent       # SANDBOX-LIMITED PASS：28 文件 259 例，253 通过，6 例 spawn/DACL 沙箱受限，exit 0
npm run build            # exit 0（lib/web-channel.js + lib/client.js 重建）
```

**真机（lab profile + 0.1.5 宿主）**，`.tmp/engineer-host/lab-home-probe.ps1`（不删 home、临时端口、自带清理）：

| 构建 | 结果 |
|---|---|
| **修前**（F1 的 `inject(['webServer'])` + `rpc.handle`） | `FAIL POST /dsw/connections.list -> HTTP 405`（= F2 基线） |
| **修后**（本 ADR 的精确 Fetch 路由） | `ok POST /api/dsw/connections.list -> HTTP 200, result.ok=true`，body `{"type":"server-response","rpcId":"lab-probe","result":{"ok":true,"value":[]}}` |

同一轮里 lab home 先被修好（`link:` junction 丢失、`storages/workspace.json` 被二进制覆盖、19 个
`session.jsonl.zstd` 内容不是 zstd 帧 ⇒ 疑似文件系统级损坏）；这三条属环境修复，见交接记录，与本 ADR 无关。

## 4. 中途抓到的真缺陷（值得留档）

第一次真机探测拿到的是 **HTTP 200 + `result.ok=false`**：

```
{"type":"server-response","rpcId":"lab-probe","result":{"ok":false,"error":{"code":"gateway/bad-request",
 "message":"method \"dsw/connections.list\" does not match endpoint \"connections.list\"", …}}}
```

原因：我把信封里的 `method` 按**裸端点名**比对，而线上口径是「`/api` 之下完整端点路径」
（`endpointFromPath(channel, pathname)` 的返回值，客户端 `rpc.call('/api', 'dsw/…')` 发的就是它）。
⇒ 教训有两条：① **只看 HTTP 状态码会放过「路由通了但语义错」**——哨兵必须断言 `result.ok=true`
（`boot-smoke.mjs` 一直如此，探针本轮补上了）；② 端点名的两种口径必须在**同一处**定义，
故把 `channelEndpointOf`/`channelPathOf` 收进 `web-channel.ts` 并加用例。

## 5. 未验证 / 遗留

| # | 项 | 状态 |
|---|---|---|
| 1 | 浏览器内**完整 UI 流程**（已保存连接、保存机器、挂载副目录、browse.mkdir） | ⚠️ 未跑（本轮只做 HTTP 层 + 单测；需要 Playwright + `docs/uat/R17-rc2-official-slot-entry.md`） |
| 2 | `npm test` / `npm run e2e` 全量（沙箱内不可跑） | ⚠️ 交 CI（`upstream.yml` 的 next 通道已改为强断言 boot） |
| 3 | Linux 复验（改测试 ⇒ `AGENTS.md` §3 要求 WSL 跑一次） | ⚠️ 待跑 |
| 4 | 发布（`0.1.4`） | 未做，属所有者 |
| 5 | `AUDIT-5`（会话子行徽标）/ `AUDIT-4`（判定分离） | 仍为 todo（本轮未动 `src/client/row-badges.ts` 判定层） |

来源：本报告所有命令输出与探针日志（`%TEMP%\dsw-labprobe-*`）；`dsh-client-connection@0.1.5-rc.2`、
`dsh-api-gateway@0.1.5-rc.2`、`dsh-client-file-upload@0.1.5-rc.2` 的 `lib/index.js` 符号级核对；
lab `--dump-config` 输出（`.tmp/lab-dump-config.txt`）；`docs/rounds/R18-F2-dsw-405.md`；`ADR-0018`。
