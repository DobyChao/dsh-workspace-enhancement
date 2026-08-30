/**
 * dsw locale dictionary — the single source of truth for the `dsw` namespace.
 *
 * ZH is the key-set source of truth; `src/locale/dsw.en.ts` declares the EN
 * dictionary as `Record<DswKey, string>`, so a missing or surplus key in EN is
 * a compile error. Both halves of the plugin (client UI via `ctx.locale` and
 * the host prompt/tool faces via `src/locale/host.ts`) import THESE SAME
 * files; the namespace is registered as `dsw` on the client and used
 * self-contained on the host.
 *
 * Key naming: `<surface>.<scope>.<item>` (surfaces: flow, form, side,
 * settings, status, rpc, prompt, tool, permission). Template parameters use
 * `{name}` placeholders and are interpolated by `lookup()`, matching the
 * framework's translate semantics. Machine-parseable markers that must stay
 * byte-identical with the official bash tool ([exit code: N], [stderr], ...)
 * deliberately share the same value in both languages.
 *
 * Never put secrets (passwords, passphrases, key material) into a value or a
 * `{param}` — templates carry leaf values only.
 * @module src/locale/dsw
 */

// Type-only: erased at compile time (host tsc and the client tsdown purity
// gate both see no runtime import). Importing the merge interface in the same
// module as the `declare module` augmentation is the official pattern
// (dsh-client-locale / dsh-client-ui-sidebar) and keeps module linking exact.
import type { LocaleNamespaceMap } from '@deepseek-ai/dsh-client-ui-slots'

/** ZH dictionary — real source of truth for the key set. */
export const zh = {
  /* ------------------------------------------------------------- flow.tsx */
  'flow.dialog.label': '选择工作区目录',
  'flow.title': '选择工作区目录',
  'flow.close.label': '关闭',
  'flow.cancel': '取消',
  'flow.sidebar.label': '连接与位置',
  'flow.sidebar.local.section': '本机',
  'flow.sidebar.local.title': '本机目录',
  'flow.sidebar.local.subtitle': '选择本机目录作为工作区',
  'flow.sidebar.saved.section': '已保存连接',
  'flow.sidebar.saved.title': '已保存连接',
  'flow.sidebar.saved.loading': '正在加载已保存连接',
  'flow.retry': '重试',
  'flow.sidebar.saved.empty.title': '还没有保存的连接',
  'flow.sidebar.saved.empty.text': '点右下角「＋」新建，或从下方 SSH 配置主机一键添加。',
  'flow.badge.auth.password': '密码',
  'flow.badge.auth.agent': 'Agent',
  'flow.badge.auth.key': '私钥',
  'flow.badge.jump': '跳板 ×{n}',
  'flow.connection.delete.label': '删除连接 {label}',
  'flow.connection.delete.title': '删除连接',
  'flow.connection.delete.dialogLabel': '删除远程连接',
  'flow.sidebar.ssh.section': 'SSH 配置主机',
  'flow.sidebar.ssh.title': 'SSH 配置主机',
  'flow.sidebar.ssh.loading': '正在读取 ~/.ssh/config',
  'flow.sidebar.ssh.error': '无法读取 ~/.ssh/config：{detail}',
  'flow.sidebar.ssh.empty.title': '未发现 SSH 配置主机',
  'flow.sidebar.ssh.empty.text': '在 ~/.ssh/config 中添加 Host 条目后，这里会直接列出，点击即可连接。',
  'flow.ssh.registered.title': '已注册为 {user}@{host}:{port}',
  'flow.ssh.clickRegister.title': '{user}@{host}:{port} — 点击注册并浏览',
  'flow.ssh.noUsername.title': '未指定用户 — 点击打开表单补全',
  'flow.ssh.adding': '正在添加并连接…',
  'flow.ssh.addFailed': '添加失败：{message}',
  'flow.ssh.noUsername': '未指定用户',
  'flow.ssh.added': '已添加',
  'flow.ssh.badge.key': '私钥',
  'flow.ssh.badge.jump': '跳板',
  'flow.connection.new.label': '新建连接',
  'flow.connection.new.title': '新建连接',
  'flow.crumbs.label': '当前路径',
  'flow.crumb.home.label': '回到主目录',
  'flow.crumb.home.title': '主目录',
  'flow.nativePicker.label': '用系统选择器选择文件夹',
  'flow.nativePicker.title': '打开系统文件夹选择器',
  'flow.nativePicker.text': '系统选择器',
  'flow.mkdir.label': '在当前目录新建文件夹',
  'flow.mkdir.title': '新建文件夹',
  'flow.mkdir.dialogLabel': '新建文件夹',
  'flow.hidden.hideLabel': '隐藏以点开头的文件夹',
  'flow.hidden.showLabel': '显示以点开头的文件夹',
  'flow.hidden.hideTitle': '隐藏点开头的文件夹',
  'flow.hidden.showTitle': '显示点开头的文件夹',
  'flow.refresh.label': '刷新当前目录',
  'flow.refresh.title': '刷新',
  'flow.loading.label': '正在加载目录',
  'flow.browse.error.remote': '无法读取远程目录',
  'flow.browse.error.local': '无法读取目录',
  'flow.auth.complete': '补全认证',
  'flow.empty.title': '没有子文件夹',
  'flow.empty.hidden': '另有 {n} 个点开头的文件夹未显示',
  'flow.empty.text': '可直接在此目录新建文件夹，或选择上方路径',
  'flow.truncated': '文件夹过多，仅显示开头部分。',
  'flow.footer.connecting': '连接中…',
  'flow.footer.pick': '选择此目录',
  'flow.footer.open': '连接并打开',
  'flow.footer.select': '选择目录',
  'flow.mkdir.location': '位置：',
  'flow.mkdir.placeholder': '未命名文件夹',
  'flow.mkdir.create': '创建',
  'flow.connection.delete.confirm': '删除连接「{label}」？',
  'flow.connection.delete.text': '将移除 {u}@{h}:{p} 的注册信息；删除后需要重新添加才能再次连接。',
  'flow.ssh.confirm.title': '添加连接「{alias}」？',
  'flow.ssh.confirm.dialogLabel': '添加 SSH 配置主机',
  'flow.ssh.confirm.text': '将把 {u}@{h}:{p} 保存到「已保存连接」，并打开它的远程目录。',
  'flow.ssh.confirm.text.jump': '将把 {u}@{h}:{p}（经 {n} 级跳板）保存到「已保存连接」，并打开它的远程目录。',
  'flow.ssh.confirm.submit': '添加并连接',
  'flow.error.invalidResponse.title': '无法创建远程会话',
  'flow.error.invalidResponse.text': '宿主返回了无法解析的错误响应——最常见的原因是 SSH 连接失败。请检查该主机的认证与网络配置后重试。',
  'flow.error.auth.title': '认证失败',
  'flow.error.auth.text': '该主机没有可用的私钥或密码，SSH 服务器拒绝了登录。可点击「补全认证」，在表单中填写认证信息后重试。',
  'flow.error.key.title': '私钥不可用',
  'flow.error.key.text': '无法读取或解析私钥文件，请检查路径、口令与文件权限。原始错误：{raw}',
  'flow.error.timeout.title': '连接超时',
  'flow.error.timeout.text': '在超时前未能建立连接，请检查主机名、端口与网络可达性。',
  'flow.error.refused.title': '连接被拒绝',
  'flow.error.refused.text': '目标端口未开放或拒绝了连接，请核对端口。',
  'flow.error.dns.title': '找不到主机',
  'flow.error.dns.text': '域名解析失败，请核对主机名或修正 ~/.ssh/config 中的 HostName。',
  'flow.error.unreachable.title': '网络不可达',
  'flow.error.unreachable.text': '本机无法路由到该主机，请检查网络或跳板配置。',
  'flow.error.generic.title': '无法连接远程主机',
  'flow.route.empty': 'session.route 未返回会话目录',
  'flow.resolve.empty': '别名解析结果为空',
  'flow.add.missingId': '注册结果缺少连接 id',
  'flow.mkdir.invalidName': '名称不能包含 / 或 \\，也不能是 . 或 ..',
  'flow.subtitle.local': '选择一个本机目录作为新工作区',
  'flow.subtitle.remote': '正在浏览 {endpoint} 的远程目录',

  /* -------------------------------------------------------------- rpc.tsx */
  'rpc.browseList': '浏览目录列表失败',
  'rpc.sessionRoute': '会话路由失败',
  'rpc.connectionsList': '连接列表失败',
  'rpc.configHosts': 'SSH 配置主机读取失败',
  'rpc.pickNative': '系统选择器调用失败',
  'rpc.connectionsResolve': '连接解析失败',
  'rpc.connectionsAdd': '连接添加失败',
  'rpc.browseMkdir': '新建文件夹失败',
  'rpc.connectionsRemove': '连接删除失败',
  'rpc.transportUnavailable': '网页传输不可用',
  'rpc.registryNotMounted': '连接注册表未挂载',
  'rpc.unknownConnectionId': '未知连接 id {id}',
  'rpc.sideStoreNotMounted': '副工作区存储未挂载',
  'rpc.invalidSideRoot': '无效的远程副工作区根 {root}',
  'rpc.unknownMachine': '副工作区引用了未知机器 "{id}"',
  'rpc.cannotList': '无法列出 {target}：不是完全限定路径',
  'rpc.cannotCreate': '无法在 {path} 下创建：不是完全限定路径',
  'rpc.notSingleSegment': '"{name}" 不是单一路径段',
  'rpc.alreadyExists': '{target} 已存在',
  // session-workspaces attach 的网关侧键化校验（web.ts 先于 attach 预校验；
  // 类内英文消息仅留作内部兜底，见 i18n-design.md §13-9）
  'rpc.sideWsIdEmpty': '副工作区 id 必须是非空字符串',
  'rpc.sideWsSessionEmpty': '会话 id 必须是非空字符串',
  'rpc.sideWsPathRemote': '副工作区路径必须是 ssh://<id>/<绝对 POSIX 路径>：{path}',
  'rpc.sideWsPathLocal': '副工作区路径必须是绝对本地路径：{path}',
  // registry.ts / transport.ts / session-workspaces.ts 的协议/数据校验与
  // 路由错误（t15-r2 拍板：host 可触发面全部键化，见 i18n-design.md §13-9 已移除）
  'rpc.hostEmpty': 'host 必须是非空字符串',
  'rpc.usernameEmpty': 'username 必须是非空字符串',
  'rpc.portInvalid': 'port 必须是 1..65535 的整数：{port}',
  'rpc.cwdShape': 'cwd 必须是 POSIX 绝对路径：{cwd}',
  'rpc.jumpHostEmpty': 'jump[{index}].host 必须是非空字符串',
  'rpc.invalidWorkdir': '无效的远程工作目录 {dir}',
  'rpc.workdirUnknownConnection': '远程工作目录引用了未知连接 "{id}"（是否已挂载 dsw/web？）',
  'rpc.targetUnknownConnection': '目标引用了未知连接 "{id}"（是否已挂载 dsw/web？）',

  /* ------------------------------------------------------------- form.tsx */
  'form.dialog.label': '新建远程连接',
  'form.title': '新建远程连接',
  'form.subtitle': '保存后将出现在连接侧栏中，可直接浏览其远程目录',
  'form.close.label': '关闭',
  'form.cancel': '取消',
  'form.jump.unresolved': '跳板链中存在无法解析的段',
  'form.jump.summary': '跳板 {count} 段 · {hops}',
  'form.jump.summaryOne': '跳板 {count} · {hops}',
  'form.jump.unresolvedHint': '跳板链中存在无法解析的段，请检查 user@host[:port] 格式',
  'form.resolve.privateKey': '私钥 {path}',
  'form.resolve.jump': '跳板 {hops}',
  'form.error.host': '请填写主机名或 ~/.ssh/config 别名',
  'form.error.required': '必填',
  'form.error.port.number': '端口必须是数字',
  'form.error.port.range': '端口范围 1–65535',
  'form.error.username': '请填写登录用户名',
  'form.config.reading': '正在读取 ~/.ssh/config…',
  'form.config.resolved': '已识别 {alias} → {endpoint}',
  'form.config.resolveFailed': '识别失败：{message}',
  'form.test.noHost': '请先填写主机名',
  'form.test.noPassword': '请填写密码，或改用私钥认证',
  'form.test.noKey': '请填写私钥文件路径，或改用密码认证',
  'form.test.testing': '正在测试连接…',
  'form.test.success': '连接成功，可以保存了',
  'form.test.failed': '连接失败：{message}',
  'form.test.error': '测试失败：{message}',
  'form.save.incomplete': '请先补全上方必填项',
  'form.save.saving': '正在保存…',
  'form.save.missingId': '保存结果缺少机器 id',
  'form.encrypt.fallback': '（⚠ 系统加密后端不可用，密码已明文保存）',
  'form.save.failed': '保存失败：{message}',
  'form.save.flowLabel': '保存并浏览',
  'form.save.settingsLabel': '保存',
  'form.clear.edit': '取消编辑',
  'form.clear.empty': '清空',
  'form.label.host': '主机名 / 别名',
  'form.placeholder.host': 'prod 或 server.example.com',
  'form.config.recognize': '识别 ssh 配置',
  'form.config.matching': '正在匹配 ~/.ssh/config…',
  'form.config.hint': '填写 ~/.ssh/config 里的别名可在失焦时自动补全用户名、端口、私钥与跳板',
  'form.config.empty': '~/.ssh/config 里没有可识别的 Host 条目',
  'form.config.badge.key': '[私钥]',
  'form.config.badge.jump': '⛳',
  'form.label.port': '端口',
  'form.label.username': '用户名',
  'form.label.name': '名称（可选）',
  'form.placeholder.name': '默认 user@host',
  'form.label.workspace': '默认工作区（可选）',
  'form.placeholder.workspace': '/home/username（不填则浏览时选择）',
  'form.label.auth': '认证方式',
  'form.auth.keyTab': '私钥文件',
  'form.auth.passwordTab': '密码',
  'form.placeholder.keyPassphrase': '私钥口令（可选）',
  'form.placeholder.keyPath': '~/.ssh/id_ed25519',
  'form.placeholder.password.edit': '留空 = 保持不变',
  'form.placeholder.password.new': 'SSH 密码',
  'form.password.hint.edit': '编辑时留空表示保持不变；「加密保存」在下方高级折叠区内。',
  'form.advanced.expanded': '▾ 高级（收起）',
  'form.advanced.collapsed': '▸ 高级',
  'form.label.credentialStore': '密码保管',
  'form.encrypt.checkbox': '加密保存密码（系统钥匙串）',
  'form.label.hostKey': 'HostKey 模式',
  'form.hostKey.default': '（默认 accept-new）',
  'form.hostKey.acceptNew': 'accept-new（信任首次，之后校验）',
  'form.hostKey.verify': 'verify（严格：拒绝陌生主机）',
  'form.hostKey.off': 'off（不校验，不推荐）',
  'form.label.jump': '跳板链（可选）',
  'form.placeholder.jump': 'bastion 或 user@bastion.example.com:2202，多台用逗号分隔',
  'form.jump.clear': '清除',
  'form.test.button': '测试连接',

  /* ---------------------------------------------------------- settings.tsx */
  'settings.encrypt.fallback': '（⚠ 系统加密后端不可用，密码已明文保存）',
  'settings.saved': '已保存 {label}{fallback}',
  'settings.rpc.listMachines': '读取机器列表失败',
  'settings.delete.confirm': '确定删除这台机器？',
  'settings.rpc.removeFailed': '删除失败',
  'settings.deleted': '已删除',
  'settings.rpc.switchFailed': '切换失败',
  'settings.setCurrent': '已设为当前机器',
  'settings.rpc.forgetKeyFailed': '忘记主机指纹失败',
  'settings.forgotten': '已忘记 {host}:{port} 的主机指纹（下次连接重新记录）',
  'settings.title': '远程工作区（机器管理）',
  'settings.description': '维护多台 SSH 机器（密码 / 私钥 / 主机指纹信任 / 钥匙串）。路径在新建或选择工作区时选：「本机」走系统文件夹对话框；「远程」选一台机器在其远程目录中选择。',
  'settings.machines.title': '已配置的机器',
  'settings.machines.encryptFallbackBadge': '⚠ 加密不可用',
  'settings.machines.currentBadge': '· 当前',
  'settings.machines.setCurrent': '设为当前',
  'settings.machines.forgetKey': '忘记指纹',
  'settings.machines.edit': '编辑',
  'settings.machines.delete': '删除',
  'settings.machines.empty': '还没有机器。在下方添加。',
  'settings.form.editTitle': '编辑机器',
  'settings.form.addTitle': '添加机器',
  'settings.label': '远程工作区',

  /* ---------------------------------------------------- side-workspaces.tsx */
  'side.rpc.failed': 'dsw: 请求失败',
  'side.headerAction.title': '关联工作区（本会话的副目录）',
  'side.headerAction.label': '工作区',
  'side.error.unresolvedPath': '无法解析该目录的远程路径，请重新浏览',
  'side.error.noMachine': '请先选择机器',
  'side.error.path.remote': '请输入远程路径（/ 开头）',
  'side.error.path.local': '请输入本地目录路径',
  'side.card.label': '关联工作区',
  'side.card.title': '关联工作区（本会话副目录）',
  'side.close.label': '关闭',
  'side.loading': '加载中…',
  'side.empty': '未关联任何副目录。副目录是模型可以直接读写的附加根，各有独立权限。',
  'side.fs.label': 'fs 权限',
  'side.exec.label': '执行权限',
  'side.rename.title': '编辑名称',
  'side.rename.button': '改名',
  'side.remove.title': '移除',
  'side.kind.label': '目录类型',
  'side.kind.local': '本机目录',
  'side.kind.remote': '远程目录',
  'side.machine.label': '机器',
  'side.draft.path.remote': '远程路径，如 /srv/app（或直接点浏览…）',
  'side.draft.path.local': '本地目录绝对路径',
  'side.browse': '浏览…',
  'side.draft.labelPlaceholder': '显示名（默认目录名）',
  'side.mount': '挂载',

  /* ------------------------------------------------------------ permission */
  'permission.rw': '读写',
  'permission.r': '只读',
  'permission.execOn': '可执行',
  'permission.execOff': '禁执行',

  /* ------------------------------------------------------------ status.tsx */
  'status.rpc.failed': 'dsw rpc 失败',
  'status.unknown': '未检测',
  'status.active': '已连接',
  'status.offline': '离线',
  'status.checking': '检测中…',
  'status.connecting': '连接中…',
  'status.retryAction.title': '重新检测并尝试连接',
  'status.retryAction.compact': '重连',
  'status.retryAction.full': '重新检测并尝试连接',
  'status.retryAction.recheck': '重新检测',

  /* ------------------------------------------------------- prompt (host) */
  'prompt.remote.emphasis':
    '⚠ 你当前的工作区是**远程 SSH 工作区**：`{endpoint}:{displayPath}`（由本地占位路径 `{placeholderRoot}\\{connectionId}\\…` 路由；你看到的占位路径只是路由别名，**所有命令与文件操作都真实发生在远程服务器上**，工作目录为 POSIX 绝对路径）。',
  'prompt.side.fs.r': '只读',
  'prompt.side.fs.rw': '读写',
  'prompt.side.exec.off': '关',
  'prompt.side.exec.on': '开',
  'prompt.side.item': '- 副工作区 **{label}**：`{rootKey}`（fs: {fs} · exec: {exec}）',
  'prompt.side.heading': '**本会话额外关联的工作区（副目录，模型可直接操作）**：',
  'prompt.side.note':
    '注意权限标记：只读（fs: 只读）拒绝写入，禁执行（exec: 关）拒绝在该目录下运行命令；被拒绝的操作请改用有权限的工作区或请用户调整。命令默认在主工作区执行；在其它服务器执行请用 `sw_exec(server, command)`。',
  'prompt.env.missing':
    '提示: 远端缺少 {missing} —— 安装请在远端执行（仅供参考，不会自动安装）：rg → sudo apt-get install ripgrep；pwsh → https://aka.ms/powershell',
  'prompt.section.swExec':
    'sw_exec 在指定服务器上执行命令；workdir 缺省为该服务器主工作区；检查每个结果的 [exit code: N] 标记，非 0 退出先排查再继续。',
  'prompt.section.win32Bash':
    'bash 工具面向远程 Linux 工作区；本地（Windows）会话请用 pwsh。检查每个结果的 [exit code: N] 标记。',

  /* ------------------------------------------------ tool: shared fragments */
  'tool.common.noActive': '没有活动的机器——请先用 sw_connect 指定主机。',
  'tool.common.backgroundSentence':
    '长时间运行命令请设置 `run_in_background: true`：调用会立即返回任务 id；用 `job_output` 读取输出、`job_kill` 停止。',
  'tool.common.backgroundUnavailable': '后台执行不可用；长时间运行的命令必须在超时内完成。',

  /* -------------------------------------------------------- tool: sw_status */
  'tool.sw_status.description':
    '显示当前远程机器（主机/用户/端口）、连接健康（ping）、当前远程工作区与主机指纹策略/状态。先调用它以了解现状，或在某个 sw_* 调用失败时检查连通性。',
  'tool.sw_status.ping.ok': 'Ping: 正常 — {prefix} ({outcome})',
  'tool.sw_status.ping.failed': 'Ping: 失败 — {detail}',
  'tool.env.heading': '远程环境：',
  'tool.sw_status.outputs.host': '远程主机：{u}@{h}:{p}{source}',
  'tool.sw_status.outputs.workspace': '当前远程工作区：{ws}',
  'tool.sw_status.outputs.workspaceNone': '当前远程工作区：（无——调用 sw_pick_workspace 设置）',
  'tool.sw_status.outputs.connected': '已连接：{yesno}',
  'tool.sw_status.outputs.hostKey': '主机指纹：{trusted}（模式={mode}）',
  'tool.sw_status.outputs.backend': '密码后端：{backend}',

  /* ------------------------------------------------------- tool: sw_connect */
  'tool.sw_connect.description':
    '为远程工作区工作连接 SSH 到远程主机。需要提供 host，可选 user、password 或 privateKeyPath/port。默认把机器保存到注册表并设为当前机器（save=false 仅作临时连接）。连接后调用 sw_pick_workspace 选择本会话应使用的工作区目录。',
  'tool.sw_connect.param.host': '远程主机 IP 或主机名',
  'tool.sw_connect.param.username': 'SSH 用户（默认 root）',
  'tool.sw_connect.param.port': 'SSH 端口（默认 22）',
  'tool.sw_connect.param.password': 'SSH 密码（可能时优先使用 SSH 私钥）',
  'tool.sw_connect.param.privateKeyPath': '私钥文件绝对路径',
  'tool.sw_connect.param.save': '把机器保存到注册表并设为当前机器（默认 true）',
  'tool.sw_connect.output': '已连接到 {host}（id={id}）。\n\n请用 sw_pick_workspace (path=<abs>) 选择工作区。',
  'tool.sw_connect.error.hostRequired': 'sw_connect: 必须提供 host',
  'tool.sw_connect.error.connectFailed': 'sw_connect: 无法连接 {host} — {detail}',

  /* ---------------------------------------------------- tool: sw_pick_workspace */
  'tool.sw_pick_workspace.description':
    '设置本会话在已连接远程上视为工作根目录的远程工作区目录。会校验其存在且为目录；并持久化到活动机器（recentWorkspaces 保留最近 8 个）。',
  'tool.sw_pick_workspace.param.path': '远程目录绝对路径，如 /home/dev/code/project',
  'tool.sw_pick_workspace.output': '工作区已设置为 {path}（活动机器：{u}@{h}）。',
  'tool.sw_pick_workspace.error.invalidPath': 'sw_pick_workspace: path 必须是远程目录绝对路径：{path}',
  'tool.sw_pick_workspace.error.noActive': 'sw_pick_workspace: 没有活动机器——请先调用 sw_connect',
  'tool.sw_pick_workspace.error.notDir': 'sw_pick_workspace: {path} 不是目录',

  /* -------------------------------------------------------------- tool: sw_exec */
  'tool.sw_exec.description':
    '在已注册的 SSH 服务器上执行命令并返回其 stdout/stderr。`server` id 选择机器（注册表 id 如 c1，或 sw_connect save:false 的临时 id）；缺省为当前会话工作区所在机器，没有服务器的本地会话会报错。目标 OS 每次连接探测一次并记录在第一行：POSIX 运行 `bash -c`，Windows 运行 `pwsh -Command`，unknown 时诚实使用 bash。每次调用都在全新 shell 中运行：调用之间不保留状态（cwd、变量、函数）——请传 `workdir` 而不是用 `cd`。非 0 退出以 `[exit code: N]` 报告——先排查再继续。长输出截断到尾部；完整输出保存到文件并在可用时报告路径。',
  'tool.sw_exec.param.workdir':
    '目标服务器上的工作目录。缺省为该服务器主工作区；相对路径基于会话工作区解析；`ssh://<id>/<path>` 显式指定机器与目录。',
  'tool.sw_exec.param.server':
    '目标服务器 id：注册表机器 id（c1、c2…）或 sw_connect save:false 的临时 id。缺省为当前会话工作区所在机器。未知 id 报错并列出已知 id。',
  'tool.sw_exec.output.background': '已在 {server}（{endpoint}）上启动后台任务 {jobId}',
  'tool.sw_exec.output.header': '服务器：{id}（{endpoint}）· 系统：{os}',
  'tool.sw_exec.error.workdirEmpty': 'sw_exec: workdir 不能为空',
  'tool.sw_exec.error.invalidWorkdir': 'sw_exec: 无效的远程工作目录 {dir}',
  'tool.sw_exec.error.workdirShape': 'sw_exec: workdir 必须是 POSIX 路径或 ssh://<id>/<path>（远程世界）',
  'tool.sw_exec.error.relativeNoCwd': 'sw_exec: 相对 workdir 需要远程会话 cwd',
  'tool.sw_exec.error.absoluteShape': 'sw_exec: workdir 必须是 POSIX 绝对路径或 ssh://<id>/<path>',
  'tool.sw_exec.error.noActive': 'sw_exec: 没有活动服务器——请先调用 sw_connect',
  'tool.sw_exec.error.unknownServer': 'sw_exec: 未知服务器 "{id}"',
  'tool.sw_exec.error.spawnFailed': 'sw_exec: 启动失败：{detail}',
  'tool.sw_exec.error.serverRequired': 'sw_exec: 本地会话必须提供 server',

  /* ------------------------------------------------------------- tool: bash */
  'tool.bash.description':
    '在会话的远程 Linux 工作区上执行 bash 命令（`bash -c`）并返回其 stdout/stderr。本主机是 Windows 且没有本地 bash：命令始终在会话路由到的远程服务器上运行，本地（Windows）会话会报错——请在那里使用 pwsh。每次调用都在全新 shell 中运行：调用之间不保留状态（cwd、变量、函数）——请传 `workdir` 而不是用 `cd`。非 0 退出以 `[exit code: N]` 报告——先排查再继续。长输出截断到尾部；完整输出保存到文件并在可用时报告路径。',
  'tool.bash.param.workdir':
    '该命令的工作目录。缺省为会话工作区；相对路径基于它解析；`ssh://<id>/<path>` 显式指定机器与目录。',
  'tool.bash.output.background': '已启动后台任务 {jobId}',
  'tool.bash.error.localSession': 'bash 工具面向远程 Linux 工作区（本机 Windows 无 bash）；请使用 pwsh 或终端面板',
  'tool.bash.error.spawnFailed': 'bash: 启动失败：{detail}',

  /* ------------------------------------------- tool: shared parameter props */
  'tool.param.command': '在目标服务器上执行的命令。',
  'tool.param.description':
    '简要、主动语态地描述该命令的作用，5-10 个词（界面中显示）。示例："ls" → "List files in current directory"；"git status" → "Show working tree status"；"npm install" → "Install package dependencies"。',
  'tool.param.timeout':
    '毫秒级超时（执行器默认 120 秒，上限 600 秒——超出会被钳制）。超时后工具会终止命令并报告 [timed out after Nms]。',
  'tool.param.runInBackground': '后台运行并立即返回任务 id（用 job_output 收集、job_kill 停止）。后台任务无超时。',

  /* --------------------------------------------- tool: output markers/errors */
  'tool.job.detail.killed': '退出前被终止',
  'tool.job.detail.signal': '信号：{sig}',
  'tool.job.detail.exit': '退出码：{code}',
  // NOTE: the following output markers stay byte-identical in both languages
  // (machine-parseable contract, mirrors the official bash tool).
  'tool.output.dropped': '[some output was dropped from memory; full output: {path}]',
  'tool.output.truncated': '[output truncated; full output: {path}]',
  'tool.output.stderrMarker': '[stderr]',
  'tool.output.empty': '（无输出）',
  'tool.output.timedOut': '[timed out after {ms}ms]',
  'tool.output.killedSignal': '[killed by signal: {sig}]',
  'tool.output.exitCode': '[exit code: {code}]',
  'tool.error.subprocessMissing': 'sw_exec: subprocess 接缝未挂载（是否已挂载 dsh-workspace-enhancement？）',
  'tool.error.jobsUnavailable': '后台任务不可用：请加载 @deepseek-ai/dsh-jobs 与 @deepseek-ai/dsh-tool-jobs',
  'tool.error.backgroundDisabled': '该部署禁用 run_in_background（enableRunInBackground: false）',
  'tool.error.aborted': 'tool call aborted',
  'tool.param.error.commandEmpty': '无效命令：应为非空字符串',
  'tool.param.error.descriptionEmpty': '无效描述：应为非空字符串',
  'tool.param.error.timeoutInvalid': '无效 timeoutMs：应为正数，实际为 {v}',
} as const

/** Every key the `dsw` namespace defines (the ZH key set is the source of truth). */
export type DswKey = keyof typeof zh

/**
 * Merge the `dsw` namespace into the framework's typed locale registry. This
 * must live in an entry module (lexical merge) — see drafts/i18n-contracts.md
 * §2.1 — and makes `register('dsw', { zh, en })` / `TranslateNS<'dsw'>`
 * type-check: ZH is the key-set source of truth, EN must carry the exact same
 * keys (enforced by `Record<DswKey, string>` in dsw.en.ts).
 */
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    dsw: DswKey
  }
}
