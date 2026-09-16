# R28 — 客户端 UI 统一到宿主 dsh 设计语言（UX-3）

## 0. 基本信息

| 项 | 值 |
|---|---|
| 轮次 / 主题 | R28 — 客户端 UI 对齐宿主设计语言 |
| 验收对象 | 四类界面（设置页机器管理 / 添加工作区流 / 会话工作区 cockpit / 会话头部状态条）在浅色与深色主题下与宿主 dsh 视觉同语言 |
| 需求 / 缺陷 ID | `UX-3` |
| 脚本作者 / 日期 | agent（UI Designer） / 2026-09-16 |
| 预期耗时 | 15 分钟 |

## 1. 前置条件

| 项 | 值 |
|---|---|
| 版本 | `0.1.4` |
| 分支 | `feat/UX-3-dsh-design-language` |
| commit | 以分支 HEAD 为准（`git rev-parse --short HEAD`）；不绑固定 sha，避免 rebase 后失效 |
| 构建产物 | `lib/` 已重建（`npm run build`），时间戳晚于 `src/` |
| lab 地址 | `http://127.0.0.1:50599/`（`scripts/dev-lab.ps1`） |
| 启动命令 | `pwsh -File scripts/dev-lab.ps1 -SkipBuild` |
| 浏览器与视口 | Edge / Chrome 最新版 · 1440×900 |
| 主题 | 浅色与深色各走一遍（宿主 `body[data-ds-dark-theme]`） |
| 语言 | 中文 |
| 缩放 | 100% |
| 其他前置 | 至少 1 台已保存机器（占位主机名即可），用于渲染机器行与其状态胶囊 |

**禁止**：在 3080（真实实例）上执行本脚本；修改产品 profile；使用真实凭据。

## 2. 步骤

| # | 操作 | 期望 | 观察点 | 结果 |
|---|---|---|---|---|
| 1 | 打开设置 → 「远程工作区」 | 页面出现在宿主设置面板内，不自带第二层容器 | DevTools：该页根节点无 `padding` 与自绘边框/背景；`max-width` 为 720px | ☐ 通过 ☐ 不通过 |
| 2 | 同上，量标题与描述 | 与宿主同级标题一致 | `getComputedStyle`：标题 `font-size:16px` / `line-height:24px` / `font-weight:500`；描述 `14px/22px` | ☐ 通过 ☐ 不通过 |
| 3 | 量机器行卡片 | 描边卡，非灰底块 | 卡片 `border-radius:12px`、`border:1px solid` 且取值为 `--dsw-alias-border-l2`；行内操作按钮 `height:28px` / `border-radius:14px` | ☐ 通过 ☐ 不通过 |
| 4 | 量「添加机器」区的输入框 | 32px 高的描边输入框 | 输入框 `height:32px` / `border-radius:8px` / `background` 取 `--dsw-alias-bg-layer-1` | ☐ 通过 ☐ 不通过 |
| 5 | 打开「添加工作区」流（侧栏「工作区」或宿主添加入口） | 弹窗为宿主 Modal 语言 | 卡片 `border-radius:24px`、`box-shadow` 为 lv3；遮罩 `backdrop-filter: blur(2px)`；标题 `16px/24px/500` | ☐ 通过 ☐ 不通过 |
| 6 | 看弹窗左侧连接侧栏底部 | 无彩色悬浮圆按钮 | 底部是整宽虚线按钮「新建连接」，`border-style: dashed`、`border-radius:12px`、文案可见 | ☐ 通过 ☐ 不通过 |
| 7 | 点已保存连接进入目录浏览 | 面板底部动作为胶囊按钮 | 「选择目录」`border-radius:18px`、`height:36px`；背景取 `--dsw-alias-button-primary-fill` | ☐ 通过 ☐ 不通过 |
| 8 | 打开会话头部「工作区」面板（cockpit） | 三分区结构清晰 | 「主工作区 / 副工作区 / 已连接的机器」标题 `12px/18px/500` 且取 `--dsw-alias-label-secondary`；分区之间有 `border-l2` 发丝线；只读主工作区行为 `dashed` | ☐ 通过 ☐ 不通过 |
| 9 | 量头部动作条 | 两个动作同一几何 | 「远程状态」胶囊与「工作区」按钮均 `height:28px` / `border-radius:14px`；状态点颜色随状态变化 | ☐ 通过 ☐ 不通过 |
| 10 | 切到深色主题（`document.body.toggleAttribute('data-ds-dark-theme')`）后重走 1–9 | 无浅色残留、无不可读文字 | 卡片/输入框/弹窗背景变暗、文字变亮；机器行与侧栏分区仍可辨识；对比度肉眼可读 | ☐ 通过 ☐ 不通过 |
| 11 | 在 DevTools 里全量搜旧配色字面量 | 四类界面里一个都不剩 | 搜 `rgba(128, 128, 128`、`#2563eb`、`#e06c75`、`#98c379`、`--dshssh-`：以上述界面为作用域的命中数均为 **0** | ☐ 通过 ☐ 不通过 |
| 12 | 键盘走查：Tab 穿过机器行操作与弹窗按钮 | 焦点可见、顺序合理 | 每个可聚焦元素都有可见焦点环（`box-shadow: 0 0 0 2px` 或 outline），无焦点陷阱 | ☐ 通过 ☐ 不通过 |

> 「观察点」写**可取证**的东西：具体文案、颜色值、元素数量、文件内容、RPC 返回值、日志行。
> 纯主观感受（「看起来正常」）不算观察点。

## 3. 判定

| 项 | 值 |
|---|---|
| 结论 | ☐ 通过 ☐ 不通过 |
| 通过项 / 总项 | / 12 |
| 证据链接 | `$LAB_HOME\e2e\r28-*.png`（浅色/深色各一组）、`r28-e2e.log` |
| 未通过项 | 指向 FEEDBACK 条目 |
| 是否阻塞发布 | ☐ 是 ☐ 否 |
| 用户签字 | |

## 4. 环境指纹

| 项 | 值 |
|---|---|
| 实例 / 端口 | lab / 50599 |
| 插件版本 | `0.1.4` |
| commit | 分支 HEAD 短 sha |
| 宿主 OS / 版本 | Windows 11 · 宿主 dsh `0.1.5-rc.2`（launcher 托管，Node.js v24.9.0） |
| 远端（如涉及） | 不需要真实远端；占位主机名即可，本脚本不建立真实连接 |
| 浏览器 / 视口 / 缩放 | Edge 最新版 / 1440×900 / 100% |
| 主题 / 语言 | 浅色 + 深色 / 中文 |
| 相关机器 id | 任意占位机器（无连接要求） |

## 5. 备注

- 本脚本**只验视觉与几何**，不验连接行为；机器在线/离线不影响任何一步。
- 第 11 步是回归哨兵：旧字面量一旦被重新引入，这里会立刻现形。
- 已知边界：宿主自身的 `ui-theme` token 若在升级中改名，本插件会退回浏览器默认样式（不会崩）——
  这类漂移由 `docs/compatibility.md` 的上游冒烟覆盖，不在本脚本范围内。
- 验收后请清理 lab 状态（注册表 / 路由占位树 / 临时文件），并确认 50599 已停止。

来源：`docs/uat/README.md`；`docs/uat/TEMPLATE.md`；宿主 token 真相源 `packages/client/ui-theme/src/styles/design-platform.css`
