# UX-19：运行时目录就地标注

目标：远程会话的 runtime-context 不再将本地路由占位路径直接称为当前实际工作目录。
通过官方会话级 `systemPrompt.context` 覆盖 `working-directory:current`，保留内部 cwd 和路由语义。

## 验收步骤

仅在 `.dsh-lab` / 50599 执行 build → pack → 插件管理器 remove/add → 重启。

1. 打开远程工作区 `/home/uuz`，发送只读探针，展开最新 runtime-context。
2. 同一目录条目应显示 `Current working directory (remote): "/home/uuz".`，紧邻显示
   `Local routing placeholder: "C:\\Users\\Admin\\.dsh-lab\\dsw-routes\\c1\\home\\uuz"`
   并注明 routing alias only、实际命令和文件操作发生在远端。
3. 发送第二轮只读探针，确认状态不变时没有重复目录快照刷屏。
4. 本地会话仍显示宿主的 `Current working directory: ...`；切换 cwd 后 provider 使用新的有效目录。
5. 卸载覆盖后宿主原始 provider 重新可见；旧宿主缺少可选服务时不注册覆盖。

## 验证记录

2026-11-02，Windows lab 50599，宿主 0.2.1-rc.2，原 PR95 验收会话第 8 轮：

- 最新 runtime-context 的目录条目确实为 `Current working directory (remote): "/home/uuz".`。
  紧邻的下一段为 `Local routing placeholder: ...`，原来的无标注 cwd 行已替换。
- 官方 bash 的 pwd 输出仍为 /home/uuz，未改 cwd、文件或权限。模型重复调用了两次 pwd，
  两次输出一致；不把此重复归因于插件，也不宣称本轮没有重复工具调用。
- 页面截图：`.tmp/ux19-cwd/runtime-context.png`；展开文本和 DOM 分别在 runtime-context.txt、trajectory-dom.txt。
- Windows 最终完整 npm run check 通过：799 例，796 通过、0 失败、3 跳过。
- WSL 完整复验通过：798 例，797 通过、0 失败、1 跳过；之后新增同名 scoped provider
  冲突回退，对最终两个文件补跑本模块四例测试，4/4 通过。WSL 没有 Go，Go 测试按脚本跳过。
- 独立 boot-smoke.mjs 通过并退出 0：进程存活、HTTP 根页 200、connections.list 200 + result.ok=true。
- 同名 scoped provider 被 preset 占用时保留原 provider，记录 warning，不能因此阻止会话创建。
- 本地目录文案、切换有效目录、旧宿主回退与卸载释放由本模块回归测试覆盖；未在 UI 实测本地会话、切机器或热卸载。
- 最终安装包 SHA-256：`dda387aa5d64de3ba189880eaee4efd0c8755d81fd748c1e1bac9f358f4b549b`。
  最终代码已重新打包安装到 lab。模型可见文案按 ADR-0014 使用英文。

本轮新增实现为 working-directory-context.ts、tools.ts 的注册调用及 model-prompts.ts 的文本。
源代码通过 agent/created 在 agent.ctx 注册同名 scoped context，仍由宿主 refreshContext 正常求值；
没有修改安装目录中的宿主文件，也没有修改 workingDirectory 服务或持久化 cwd。
旧轨迹消息是历史记录，保持原文本；新请求才使用新说明。

