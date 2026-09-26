# R39 — BUG-10 宿主 join 三层修复 + UPSTREAM-5 接缝收口 + UPSTREAM-7 哨兵 + AUDIT-1 评估

- **日期**：2026-09-25 → 2026-09-26（PR #37 / #38 / #42，三段合并；#39/#41 中途并入 #42）
- **需求**：`BUG-10`、`UPSTREAM-5`、`UPSTREAM-7`、`AUDIT-1`
- **范围**：`ssh://` 路由对宿主 join 三种破坏形态的恢复；0.1.7-rc.2 全接缝对齐；scope watch 哨兵；
  drift workflow 对 npm ≥ 11 与混合版本树的加固；混合门面 extends 评估

## 目标

远程目录包 skill 在 win32 与 Linux 宿主上都能被发现；0.1.7 家族（rc.2）全接缝对齐且哨兵
双通道绿；上游新包有会响的哨兵；AUDIT-1 的 extends 建议给出明确结论。

## 拆解

1. **BUG-10 三层修复**（上游 skill 发现用宿主 `path.join` 重组我们的 `ssh://` listDir 条目，
   两个平台的 join 各破坏一种、同一缺陷共三种形态）：
   - 第一层：`parseSshRoute` 把 `ssh://` 路径部分的字面 `\` 归一为 `/`（R38 `bs-probe`
     探针证实关闭「拼写内反斜杠直通」子缺口）。
   - 第二层（win32 搅碎形，R38 UAT §4 走查实证）：win32 join 把前缀整体搅碎成
     `.\ssh:\<id>\…`（反斜杠分隔）——`routeFromJoinShredded` win32 分支重建。
   - 第三层（posix 塌缩形，2026-09-25 Linux 宿主独立复测带出）：posix join 把 `://`
     塌成 `:/`，产出 `ssh:/<id>/…`（单斜杠、正斜杠）——塌缩分支以「恰一斜杠」为签名
     重建（真 `ssh://` 永不命中、坏 id 仍本地、`.git` 形被 id 字符集拒）。
   - win32 lab UAT 复跑 5/5 通过（R38 §5）；Linux E2E 复跑与 win32 回归为验收尾巴。
2. **UPSTREAM-5 收口**：当日手动 dispatch 的 drift 双通道红是哨兵首次真信号——`next`
   推进到 0.1.7-rc.2（`dsh-fs` 当日下午跟上，**基类**具现 `watch`）。fs 门面补 `watch`
   （local 转发 / remote 诚实 `FS_IO_ERROR` / 老委托守卫）；subprocess 门面补
   `terminalEnvironment`（世界无关随 local 委托，委托太老按上游同式自算）；契约静态清单
   扩到 15 方法、基类快照改**家族自适应**（floor ⊆ 已知集）。peer 仍 `^0.1.5-rc.1`
   （`latest` 未翻，ADR-0026 §4.7）；README/zh Compatibility 表新增 0.1.7-rc 行。
3. **drift workflow 加固**（两个老化假设，均被当日 dispatch 实锤）：
   - npm ≥ 11 对多匹配 `npm view pkg@range version` 输出 `name@ver 'ver'` 双形态，8 处
     `tail -1` 拿到 spec 碎片 → 404 → boot smoke 死。统一「末行末 token → 去引号 → 剥
     `name@`」，对旧 npm 等价。
   - boot-smoke 闭包只补「缺失」不升「过旧」：repo lockfile 留着 `dsh-session@0.1.5`
     （Session v3），撞上闭包装进来的 0.1.7 持久化插件（catalog v4）→ 宿主启动即崩。
     闭包改为走过的整个 `@deepseek-ai` 图对齐显式 spec（requirer range 压过 stale
     channel pin），spec 集稳定终止；UNRESOLVED 检查先于终止。
4. **UPSTREAM-7 哨兵**：`upstream.yml` scope-watch 作业（每周一 + 手动）：比对
   `dsh` / `dsh-web-app` × latest/next/alpha 的 `@deepseek-ai/*` 组成与入库基线
   `scripts/upstream-baseline.json`，漂移开 issue；SSH 四包收编单独点名（`UPSTREAM-6`
   复评触发器）。纯逻辑 8 例单测。**报警路径已演练**：删基线一依赖 → dispatch →
   issue #40 按设计开出（内容准确）→ 带说明关闭；演练分支不入库。
5. **AUDIT-1 评估结论：extends 不做**（决策记录在 `test/mixed-subprocess-contract.test.ts`
   头注）：① 接缝基类是 cordis `Service` 子类（构造要 `Context`、自带生命周期），门面是
   `ctx.set()` 的纯路由对象；② 基类运行时原型近乎空（抽象成员被 TS 擦除）；③ **静默继承
   会让上游新增具现方法绕过世界路由**——契约红强迫逐方法显式路由（`watch` 即模板）比静默
   继承安全。落地：subprocess 侧反射契约（fs 侧同构）——它拦的正是本轮 `terminalEnvironment`
   漏实现（O2 形态实锤）。

## 验证

- 单测：`mixed-routing`（三形态解析/门面路由）、`mixed-fs-contract`（15 方法 + 自适应基类
  快照 + `watch` 四用例）、`mixed-subprocess-contract`（4 例）、`upstream-watch`（8 例）。
- 双家族：锁定 0.1.5 与 CI 同款全家族（含 `dsh-fs@0.1.7-rc.2`）分别全绿（609 例）。
- 端到端：UAT 复放脚本对真 SSH c1 重放上游 skill 发现链；boot smoke 对 `dsh@0.1.7-rc.2`
  真宿主 SMOKE PASS；workflow 修复版在分支上真跑三作业全绿（run 36147930488）。
- UAT：[`R38`](../uat/R38-bug10-skill-dir-uat.md) win32 复跑 **5/5**（2026-09-25）；
  Linux 宿主独立复测带出第三层（§6 追记）。
- WSL `scripts/verify-linux.sh` 每分支合前全绿。
- 每个分支常规 CI（ubuntu 22/24 + windows 22 + 标题闸门）全绿。

## 结果

- `BUG-10`：三层修复进 §4（尾巴：Linux E2E 复跑 + win32 回归）。
- `UPSTREAM-5`：0.1.7-rc.2 全接缝对齐 + workflow 加固 + 终 dispatch 绿（见 run 36216275977）进 §4。
- `UPSTREAM-7`：哨兵上线 + 报警演练通过，进 §4。
- `AUDIT-1`：extends 明确不做、双侧反射契约承担风险，进 §5 留痕。

## 遗留

- Linux E2E 复跑 + win32 回归（复测方同法执行；单测/WSL/离线复放已覆盖路由面）。
- 0.1.7 家族升 pin 等 `latest` 翻（ADR-0026 §4.7）。
- 远程 `watch` 一律拒绝（SFTP 无宿主侧监听）；上游若给远程会话加监听需求需核心侧轮询，另立项。
- drift issue #7/#32 随终 dispatch 绿关闭。

来源：PR #37 / #38 / #42（#39/#41 并入 #42）；[`docs/uat/R38-bug10-skill-dir-uat.md`](../uat/R38-bug10-skill-dir-uat.md)；
ADR-0026 §4/§5；`docs/compatibility.md` §2/§3.1。
