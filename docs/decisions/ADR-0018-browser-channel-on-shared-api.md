# ADR-0018: 浏览器通道改走官方共享 `/api` 的精确 Fetch 路由

- 状态: accepted
- 日期: 2026-09-11
- 范围: `src/web.ts`（宿主半挂载）、`src/web-channel.ts`（新增，线协议）、`src/client/index.ts`（客户端通道）、
  `scripts/boot-smoke.mjs`（哨兵）、`.github/workflows/upstream.yml`（通道矩阵）
- 关联: `UPSTREAM-3`（F1/F2/F3）、`UPSTREAM-4`（0.1.2 家族退场）、
  `docs/rounds/R18-F2-dsw-405.md`（根因定位）、`docs/rounds/R19-f2-shared-api-channel.md`（落地与实证）

## 0. 结论

插件的一元 RPC 通道不再自挂 `/dsw`，改为**官方共享 `/api` 传输上的精确 Fetch 路由**：

```ts
ctx.connection.fetch.register({
  path: '/api/dsw/<endpoint>',        // 精确路径，如 /api/dsw/connections.list
  methods: ['POST'],
  requestBody: 'buffered',
  fetch: request => …,                // 校验信封 → dispatch → {type:'server-response', rpcId, result}
})
```

客户端相应改为 `connection.rpc.call('/api', 'dsw/<endpoint>', payload, signal)`。**信封协议不变**
（`{type:'client-request', rpcId, method, payload}` → `{type:'server-response', rpcId, result}`），
变的只有承载路径与「谁做栅栏」。

## 1. 背景：两条上游 API 都被堵死

0.1.5 家族上：

| 候选 | 状态 | 证据 |
|---|---|---|
| `connection.rpc.handle('/dsw', handler)` | **不可用** | `register(owner, …)` 末行 `owner.webServer.register(route)`，`owner` = Connection 服务自己的 ctx；该包 0.1.5 只声明 `["credentials"]` ⇒ 属性读取抛 `cannot get property "webServer" without inject`。**注册从未发生**（F1 = 行级致命、F2 = 子 fiber 非致命后 `/dsw` 静默 405） |
| `connection.rpc.intercept('/api', matches, handler)` | **已被占用** | `registerInterceptor` 是**单占位**（`if (this.interceptors.has(channel)) throw`），`@deepseek-ai/dsh-api-gateway` 在组合里已经注册（`--dump-config` 可见该行），我们插不进去 |
| `connection.fetch.register(route)` | **可用且官方** | `registerFetchRoute` 只做 `owner.effect(...)` + 一张 `Map`，全程不读 `owner.webServer`；`dsh-client-file-upload` 就是这样挂 `/api/upload` 的；`createSharedFetchHandler` 分发时**先查精确路由**，未命中才交给拦截器 |

## 2. 备选方案与代价

| | **A. 自挂 `/dsw` 前缀路由**（R18 的候选 A） | **B′. 官方精确 Fetch 路由**（本 ADR 采纳） |
|---|---|---|
| 宿主 | `ctx.inject(['connection','webServer'], c => c.webServer.register({kind:'prefix', path:'/dsw', handler}))` | `ctx.connection.fetch.register({path:'/api/dsw/<endpoint>', …})` |
| 客户端 | 零改动（URL 与协议都不变） | `rpc.call('/dsw', e)` → `rpc.call('/api', 'dsw/'+e)` |
| 协议语义 | **自行复刻**上游桥接（信封、栅栏、错误码、body 上限、`requestBody` 模式） | 完全走上游实现；我们只写一个 `fetch(request)` |
| 漂移风险 | 上游改信封/流式语义时要跟（R18 §8.2 列为未验证项） | 低：信封解析与响应由上游落盘逻辑承担，我们只做同一个 schema 的最小校验 |
| 命名空间 | 独占 `/dsw` | 与 `api-gateway`/`file-upload` 共享 `/api`，靠**精确路径 + 命名空间段 `dsw/`** 避免碰撞 |
| 依赖 | 需要 `webServer` 注入（F1 的诱因面） | 不需要 `webServer`：无 web 传输时路由自然不可达，宿主照常启动 |

选 B′ 的决定性因素：**A 要求我们长期复刻一条上游私有桥接**（唯一正确性来源是行号级抄写），而 B′ 的承载、
栅栏、body 上限、错误信封全部由上游承担；代价只是一次客户端路径改动——而 0.1.2 家族已按所有者决定退场
（`UPSTREAM-4`），不再有「保持已发布客户端半兼容」的约束。

## 3. 关键实现约束（评审关注点）

1. **线协议单一来源**：路径、命名空间、信封形状集中在 `src/web-channel.ts`，两半都 import。
   旧设计把 `'/dsw'` 硬编码在宿主与客户端三处，是 F2 期间「改一处漏一处」的结构性原因。
2. **`method` 的取值**：信封里 `method` 是 **`/api` 之下的完整端点路径**（`dsw/connections.list`），
   与上游 `endpointFromPath(channel, pathname)` 的口径一致；dispatch 收到的是**裸名**（`connections.list`）。
   本轮真机探针正是先抓到「按裸名比对」的错误（HTTP 200 但 `gateway/bad-request`），故记录在案。
3. **重载可逆**：注册落在 **Connection 服务**的 effect 作用域（不是我们的 ctx）。正常卸载会回收路由，
   但若重载时旧路由仍在，第二次注册撞 `already registered` —— 此时**捕获并继续**（不抛），
   并且路由必须**无状态**（按请求从 `liveDispatch` 取当前 dispatch），这样幸存路由服务的就是新代码。
4. **哨兵必须强断言**：`scripts/boot-smoke.mjs` 对 `POST /api/dsw/connections.list` 断言
   `200 + result.ok=true`，且**删除了 `--channel-warn` 降级口**——一条「已知破坏」的白名单比没有哨兵更危险。
5. **`gateway/bad-request` 与 `invalid-request`**：非法信封用上游同码回答，可用 `rpcId` 原样回显、
   否则回 `invalid-request` 占位（与上游一致），避免客户端在关联 `rpcId` 时拿到未定义行为。

## 4. 后果

- **正面**：0.1.5 家族（rc.1/rc.2）上通道真实可用（真机实测 `result.ok=true`），且宿主启动不再依赖
  「哪个上下文能读 `webServer`」；家族收窄后 peer/dev 全部落在 `^0.1.5-rc.1`，哨兵只剩 next/alpha 两条真通道。
- **负面/需跟**：
  - 端点路径变了（`/dsw/<e>` → `/api/dsw/<e>`）；**已发布的 0.1.3 客户端半与新版宿主半不兼容**——
    本次未发布，且 3080 已不装本插件，故无线上影响（这是所有者决定退场 0.1.2 家族的直接收益）。
  - 与其它 `/api` 消费者共享命名空间：所有端点必须留在 `dsw/` 段下，且不得注册 `api-gateway` 已认领的端点。
  - 上游若把「精确路由优先于拦截器」的次序改掉，通道会 404 —— 由 `upstream.yml` 的 boot 哨兵（强断言）兜住。
