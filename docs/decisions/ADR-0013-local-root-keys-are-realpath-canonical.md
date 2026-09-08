# ADR-0013: 本地副工作区根键按 realpath 规范化

- 状态: accepted
- 日期: 2026-09-10

## 背景

副工作区的权限门（`fs: r` 拒写、`exec: off` 拒启）靠**字符串前缀匹配**工作：
`store` 把 attach 时的路径规范化成 rootKey，`ctx.fs` 每次操作把目标路径交给匹配器，
命中哪个 root 就套用哪个权限。

两侧的规范化口径原本不一致：

- `store` 用 `resolve()`（**纯词法**，不解析符号链接）；
- `ctx.fs` 的本地后端交给门禁的是 **realpath 形状**的 targetKey。

只要同一个目录存在两种拼写，匹配就落空，门禁**静默失效**——写操作被放行，没有任何报错。
触发条件在真实环境里并不罕见：NTFS junction、`subst` 虚拟盘、Windows 8.3 短名
（`RUNNER~1` vs `runneradmin`，GitHub Actions 的 `%TEMP%` 正是这种形状）、以及用户手工
写下的等价拼写。

发现路径：CI 的 windows-latest 作业在 `AUDIT-TC01/02/07/08/12` 上失败，而本机全绿；
用 junction 把 `%TEMP%` 换成"另一种拼写"后在本机完整复现。

## 决定

本地 rootKey 的规范化口径统一为 **realpath 规范化**：

- `normalizeSideRootKey('local', path)`：取路径**最近的存在祖先**做 `realpathSync.native`，
  再把不存在的尾部段按词法接回去（目标文件通常还不存在）；
- `sideWorkspaceOf` 的本地分支用同一函数规范化候选路径；
- 持久化加载时同样重新规范化（`normalizeSideWorkspaceRecord`），因此**旧记录会自动愈合**；
- `match()` 在没有副工作区时短路，不给普通 fs 操作增加 realpath 探测开销。

远端键（`ssh://<id>/<path>`）不变，仍走 POSIX 规范化。

## 后果

- junction / subst / 8.3 短名三种拼写收敛到同一 rootKey，只读门在这些环境下不再失效。
- 同一目录的旧记录与新建记录口径一致；持久化文件里可能出现拼写变化（一次性、自愈）。
- 每次带副工作区的 fs 操作多一次 realpath 探测（最近存在祖先，通常 1 次）；无副工作区时短路。
- 新增回归用例：用 junction/symlink 建两种拼写，断言两者规范化到同一 key 且都能匹配到记录
  （`test/session-workspaces.test.ts`）。
- 测试中的本地路径期望一律经 `localKey()` 助手构造，禁止再与 `resolve()` 直接比较——
  否则测试只在"词法 == realpath"的机器上偶然通过。

## 被否方案

- **只在测试里跳过 win32 失败用例**：掩盖真实缺陷，用户在任何 junction/subst 环境都会静默失去门禁。
- **在匹配时对两侧都做 realpath**：每次匹配要对所有 root 做 realpath，开销随 root 数增长；
  规范化在写入侧做一次即可。
- **缓存 realpath 结果**：junction 变更后缓存会失效，收益不足以抵消正确性风险，暂不做。
