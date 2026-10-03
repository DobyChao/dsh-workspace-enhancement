# R47 — PUB-8：0.2.3 发布（含发版前终检与两个哨兵 issue 收口）

> tag `v0.2.3` 由 owner 推（2026-09-30），publish run 36737916290（OIDC + npm-publish
> environment owner Approve），npm `latest=0.2.3`。日期：2026-09-30/10-03。

## 1. 发版内容

v0.2.2 → 0.2.3：21 个提交。核心：**0.2.0 宿主可安装**（联合 peer pin，发版动机）；
0.1.7 两处运行时断点修复（UPSTREAM-8/9）；上游信号升级（INFRA-19/20）；跨 agent
协作协议（INFRA-21）；核心供给线重做（REQ-I14/I17/I21 + INFRA-22：工具渠道、部署必问、
版本门 major.minor 线、sha256 白名单溯源）。核心工件仍 0.2.2（同线免重部署）。

## 2. 发版前终检（九项，全过）

1. HEAD 干净（`8755167`）；2. v0.2.2..HEAD 21 提交逐一对得上轮次；3. `npm run check`
ALL PASS；4. 包体检（0.2.3 / 联合 pin / deps 仅 ssh2 / 147 文件 / 核心工件在内 / 无 map
无 src 泄漏）；5. 包内自洽（lib 白名单含 dist 核心 hash）；6. **0.2.0-rc.2 全家安装无
ERESOLVE**（545 包——强制 peer 下的发版动机当场实证）；7. **同树 boot SMOKE PASS**；
8. release.yml 路径推演（tag→ci→check(带 Go 自登记)→publish→Approve）；9. WSL 复验。
随终检修复：`build-core` 的 Windows GNU tar 盘符冒号坑（cwd+相对路径）+ 已构建早退
（本地重复 check 不折腾 compatHashes）。

## 3. 哨兵 issue 收口

- **#56（tag-watch：`latest` 0.1.7-rc.2 → 0.2.0-rc.2）**：新装宿主默认 0.2.0 家族。
  联合 pin 已覆盖（终检第 6/7 项即证据）⇒ pin 不动；基线认领。主 dev 家族是否翻
  0.2.0 属 owner 拍板（UPSTREAM-9 先例 vs 0.2.0 仍是 rc 线，不急）。
- **#57（alpha drift 失败）**：竞态实锤——drift 报 `ETARGET node-addon-native-custom-loader@0.1.7`
  于 10:13:13，该包 10:13:16 才上架，**差 3 秒**；其后三天定时 drift 全绿。上游发版
  残缺的非我方不兼容，issue 随发补齐。
- 基线重写同时捎出 **alpha 翻代 `0.1.7-alpha.2` → `0.2.1-alpha.1`**（0.2.1 线酝酿中，
  周四 drift 自动探，无需手动）。

## 4. 尾巴

- REQ-I21 弹问闭环 UAT（删核心→拒→再问→允许）仍待实机；matrix N8 顺带。
- 0.2.1-alpha.1 的 drift 结果看下周四；若断接缝，early warning 窗口开启。
