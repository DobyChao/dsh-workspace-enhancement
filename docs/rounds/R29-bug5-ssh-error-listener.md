# R29 — BUG-5：ssh2 死链观察与 keepalive 默认值

> 档案（本轮做了什么），现状看 `docs/backlog.md` / `docs/status.md`。

## 背景与结论

上游 issue #19（外部用户 DobyChao 报告）：SSH 连接**认证成功后**被重置时，插件抛出的是未捕获异常，直接终止整个 `dsh` 宿主进程（`dsh web` 整体退出，实例日志反复「启动 → 崩溃」）。本会话先对 master 复核确认属实（登记 `BUG-5`，P1），当轮完成修复，PR #21 合入（squash 86f9d6f）。

## 根因（源码核实）

1. **无监听窗口**：全仓库唯一给 ssh2 `Client` 挂 `error` 的位置在 `connectReady()`，且 `ready` 一到即 `removeListener`；此后 `SshSession` 只 `client.end()`，从不挂生命周期监听。Node 对无人监听的 `'error'` 直接抛 → 未捕获异常 → 进程退出。连接建立阶段不崩（`once('error')` 还挂着）。
2. **keepalive 默认 0**：`runtime.ts` Config schema 与 `connection.ts` spec 兜底都是 0 → 长连接不保活不探测，空闲回收/`ClientAliveInterval` 到期只会以裸 `ECONNRESET` 冒出来。
3. **同源假阳性**：`isConnected()` 只在 `dispose()` 翻 false → socket 静默死亡后 registry/UI 仍报「已连接」。

## 修法（与 issue #19 建议一致）

- `openChain()` 新增可选 `onClient`：每个 hop 的 `new Client()` 在**连接尝试之前**交给 session，消除「ready 后到挂监听前」的窗口。
- `watchChainClient(client, onDead)`：`error` + `close`（覆盖无错误的静默死亡）。
- `SshSession.handleChainDeath(generation, error)`：generation + disposed 双守卫（失败的连接尝试由 openChain 自拆、被新连接取代的旧链、dispose 主动结束，均不误触发）→ `invalidate()` 清 `ready`/`sftp`/`sftpOpening`/`remoteEnvironment`/死 clients → 下次调用自动重开。
- keepalive 默认 `0 → 30_000` × countMax 3：静默死链 ~90s 内被发现。行为变更，修复拍板时（2026-09-16，用户「把 bug-5 修了吧」）一并批准。
- `isConnected()` 现反映静默断链。

## 验证

- `check:static` ALL PASS；typecheck 干净；`test:agent` 全绿（2 个失败为已知沙箱受限）。
- 新增 `test/ssh-session-lifecycle.test.ts` 5 例：watcher 观察、守卫表、invalidate 清扫幂等、断链后重试。
- `npm run build` 成功；`boot-smoke --no-channel` **SMOKE PASS**（之后悬挂为 INFRA-12 既有问题）。
- CI（PR #21）：ubuntu 22/24 + windows node 22 全绿。

## 真机验收（已过，2026-09-16）

Windows OpenSSH 服务需要管理员提权起不了，改用 **ssh2 自带 Server 模式**做桩：`127.0.0.1:29222`、固定 host key（避免重启后 TOFU accept-new 误报）、密码认证，机器以 `c3` 登记进 lab 注册表（验证后已移除）。lab 50599 的插件是 junction 指向本仓库，重启实例后加载修复后的 `lib/`。

流程与断言：

1. `conn.probe` → **active**（握手 + exec 往返 46ms）。
2. **杀掉 SSH 服务端进程**（对客户端表现为 RST，正是 BUG-5 场景）→
   - 宿主进程**存活**：`GET /` HTTP 200——修复前此处整个 `dsh web` 直接退出；
   - `conn.status` **即时** `offline` / `connected:false`——修复前是僵尸 `connected:true`。
3. 重启服务端 → `conn.probe` → **active**（34ms；缓存已失效，自动重开链路）。

证据：`.tmp/bug5-server*.log`、`.tmp/bug5-ssh-server.mjs`（验证桩，不入库）；backlog BUG-5 备注已同步。

## 过程备注

- push 授权在本执行环境未落地（git 凭据 helper 起不来），本会话内 BUG-5 的 docs 分支与 fix 分支均由所有者手工 push；分支命名规则同轮拍板：纯记录用 `docs/` 前缀，`fix/` 只给完成的修复。
- PR #20（UX-3）同日合入，收尾入账见 `docs/backlog.md`（UX-3 done + 真机尾巴 R28 UAT；新增 UX-4 token 化收紧项）。
