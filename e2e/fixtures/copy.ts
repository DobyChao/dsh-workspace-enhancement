/**
 * Copy contract: the exact UI strings the specs assert, in both languages.
 *
 * WHY A TABLE INSTEAD OF IMPORTING `src/locale/dsw.ts`:
 * Playwright transpiles specs with esbuild, and importing a repo source module
 * across the `e2e/` boundary is a loader-dependent bet. The table below is
 * literal, and `copyDrift()` re-reads the real dictionaries from disk and
 * reports every mismatch — `specs/copy-contract.spec.ts` fails on drift, so the
 * table can never silently rot away from `src/locale/dsw.ts`.
 *
 * Every entry is a pair of TRANSLATIONS of the same dictionary key. `shell.*`
 * keys are NOT part of our dictionary: they are DSH shell (third-party) copy
 * the navigation helpers must match. They are pinned here on purpose — if an
 * upstream rename breaks them, the failure names the exact string to update.
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The two locales the plugin dictionary supports. */
export type Lang = 'zh' | 'en'

/** One dictionary key rendered in both languages. */
export interface CopyPair {
  readonly zh: string
  readonly en: string
}

export const COPY = {
  /* ---------------------------------------------------------- flow.tsx */
  'flow.dialog.label': { zh: '选择工作区目录', en: 'Choose a workspace directory' },
  'flow.close.label': { zh: '关闭', en: 'Close' },
  'flow.cancel': { zh: '取消', en: 'Cancel' },
  'flow.sidebar.label': { zh: '连接与位置', en: 'Connection & location' },
  'flow.sidebar.local.section': { zh: '本机', en: 'Local' },
  'flow.sidebar.saved.section': { zh: '已保存连接', en: 'Saved connections' },

  /* -------------------------------------------------- machine-form.tsx */
  'form.label.host': { zh: '主机名 / 别名', en: 'Hostname / alias' },
  'form.placeholder.host': { zh: 'prod 或 server.example.com', en: 'prod or server.example.com' },
  'form.label.port': { zh: '端口', en: 'Port' },
  'form.label.username': { zh: '用户名', en: 'Username' },
  'form.label.name': { zh: '名称（可选）', en: 'Name (optional)' },
  'form.placeholder.name': { zh: '默认 user@host', en: 'default user@host' },
  'form.label.workspace': { zh: '默认工作区（可选）', en: 'Default workspace (optional)' },
  'form.label.auth': { zh: '认证方式', en: 'Authentication' },
  'form.auth.keyTab': { zh: '私钥文件', en: 'Private key file' },
  'form.auth.passwordTab': { zh: '密码', en: 'Password' },
  'form.test.button': { zh: '测试连接', en: 'Test connection' },
  'form.save.settingsLabel': { zh: '保存', en: 'Save' },
  'form.advanced.collapsed': { zh: '▸ 高级', en: '▸ Advanced' },

  /* ------------------------------------------------------ settings.tsx */
  'settings.label': { zh: '远程工作区', en: 'Remote workspaces' },
  'settings.title': { zh: '远程工作区（机器管理）', en: 'Remote workspaces (machine management)' },
  'settings.machines.title': { zh: '已配置的机器', en: 'Configured machines' },
  'settings.machines.empty': { zh: '还没有机器。在下方添加。', en: 'No machines yet. Add one below.' },
  'settings.machines.edit': { zh: '编辑', en: 'Edit' },
  'settings.machines.delete': { zh: '删除', en: 'Delete' },
  'settings.machines.setCurrent': { zh: '设为当前', en: 'Set as current' },
  'settings.machines.forgetKey': { zh: '忘记指纹', en: 'Forget key' },
  'settings.form.addTitle': { zh: '添加机器', en: 'Add machine' },
  'settings.form.editTitle': { zh: '编辑机器', en: 'Edit machine' },
  'settings.saved': { zh: '已保存 {label}{fallback}', en: 'Saved {label}{fallback}' },

  /* ------------------------------------------------ side-workspaces.tsx */
  'side.headerAction.label': { zh: '工作区', en: 'Workspace' },
  'side.headerAction.title': {
    zh: '关联工作区（本会话的副目录）',
    en: 'Link workspace (side directory of this session)',
  },
  'side.card.label': { zh: '关联工作区', en: 'Link workspace' },
  'side.card.title': {
    zh: '关联工作区（本会话副目录）',
    en: 'Link workspace (side directory of this session)',
  },
  'side.empty': {
    zh: '未关联任何副目录。副目录是模型可以直接读写的附加根，各有独立权限。',
    en: 'No side directories linked. Side directories are extra roots the model can read and write directly, each with its own permissions.',
  },
  'side.kind.local': { zh: '本机目录', en: 'local directory' },
  'side.kind.remote': { zh: '远程目录', en: 'remote directory' },
  'side.close.label': { zh: '关闭', en: 'Close' },
  'side.browse': { zh: '浏览…', en: 'Browse…' },
  'side.mount': { zh: '挂载', en: 'Mount' },
  'side.fs.label': { zh: 'fs 权限', en: 'fs permission' },
  'side.exec.label': { zh: '执行权限', en: 'execution permission' },

  /* ------------------------------------------------------ permission */
  'permission.rw': { zh: '读写', en: 'read-write' },
  'permission.r': { zh: '只读', en: 'read-only' },
  'permission.execOn': { zh: '可执行', en: 'executable' },
  'permission.execOff': { zh: '禁执行', en: 'not executable' },

  /* ---------------------------------------------------------- status */
  'status.unknown': { zh: '未检测', en: 'not detected' },
  'status.active': { zh: '已连接', en: 'connected' },
  'status.offline': { zh: '离线', en: 'offline' },

  /* ------------------------------------------------- DSH shell (third party) */
  'shell.settings.trigger': { zh: '设置', en: 'Settings' },
  'shell.settings.general': { zh: '通用设置', en: 'General' },
  'shell.settings.close': { zh: '关闭', en: 'Close' },
  'shell.language.rowTitle': { zh: '语言', en: 'Language' },
  'shell.language.zh': { zh: '中文', en: '中文' },
  'shell.language.en': { zh: 'English', en: 'English' },
  'shell.workspace.add': { zh: '添加工作区', en: 'Add workspace' },
  'shell.sidebar.open': { zh: '打开侧边栏', en: 'Open sidebar' },
  'shell.input.send': { zh: '发送消息', en: 'Send message' },
} as const

export type CopyKey = keyof typeof COPY

/** Escape a literal string for embedding in a RegExp. */
export function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** The copy for one key in one language. */
export function copy(key: CopyKey, lang: Lang): string {
  return COPY[key][lang]
}

/** The literal prefix of a templated value (`已保存 {label}` -> `已保存`). */
export function copyPrefix(key: CopyKey, lang: Lang): string {
  const brace = copy(key, lang).indexOf('{')
  return brace < 0 ? copy(key, lang) : copy(key, lang).slice(0, brace)
}

/**
 * Anchored matcher for ONE language. Anchor both ends so an ancestor element
 * (whose text content concatenates its children) can never match: the plugin's
 * form rows put a label and an input in the same container, and an unanchored
 * matcher would hit the container too and trip Playwright strict mode.
 */
export function exactLang(key: CopyKey, lang: Lang): RegExp {
  return new RegExp(`^${escapeRe(copy(key, lang))}$`)
}

/** Anchored matcher accepting ANY language — for specs that must not care. */
export function anyLang(...keys: CopyKey[]): RegExp {
  const alternatives = keys.flatMap(key => [escapeRe(COPY[key].zh), escapeRe(COPY[key].en)])
  return new RegExp(`^(?:${[...new Set(alternatives)].join('|')})$`)
}

/** Unanchored matcher accepting any language (for substring assertions). */
export function anyLangLoose(key: CopyKey): RegExp {
  return new RegExp(`${escapeRe(COPY[key].zh)}|${escapeRe(COPY[key].en)}`)
}

/* -------------------------------------------------------------- drift guard */

/** One dictionary entry parsed out of `src/locale/dsw*.ts`. */
interface DictEntry {
  key: string
  value: string
}

/** Repository root, resolved from this module's location (cwd-independent). */
function repoRoot(): string {
  try {
    return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
  } catch {
    return process.cwd()
  }
}

/**
 * Parse single-line `'key': 'value',` entries out of a dictionary module.
 * Multi-line values (template literals) are skipped by design: no asserted key
 * uses one, and the table never asserts them.
 */
function parseDictionary(file: string): Map<string, string> {
  const text = readFileSync(file, 'utf8')
  const entries = new Map<string, string>()
  const pattern = /^\s*'([^']+)':\s*'([^']*)',?\s*$/gm
  for (const match of text.matchAll(pattern)) {
    const key = match[1]
    const value = match[2]
    if (key !== undefined && value !== undefined) entries.set(key, value)
  }
  return entries
}

/** One mismatch between the COPY table and the real dictionary. */
export interface CopyDrift {
  key: CopyKey
  lang: Lang
  table: string
  dictionary: string | null
}

/**
 * Compare every `dsw.*` key in the COPY table with `src/locale/dsw.ts` /
 * `src/locale/dsw.en.ts`. Shell keys are skipped (they belong to DSH).
 * @returns one entry per mismatch; empty means the table is in sync.
 */
export function copyDrift(): CopyDrift[] {
  const root = repoRoot()
  const dictionaries: Record<Lang, Map<string, string>> = {
    zh: parseDictionary(resolve(root, 'src', 'locale', 'dsw.ts')),
    en: parseDictionary(resolve(root, 'src', 'locale', 'dsw.en.ts')),
  }
  const drift: CopyDrift[] = []
  for (const key of Object.keys(COPY) as CopyKey[]) {
    if (key.startsWith('shell.')) continue
    for (const lang of ['zh', 'en'] as const) {
      const expected = COPY[key][lang]
      const actual = dictionaries[lang].get(key) ?? null
      if (actual !== expected) drift.push({ key, lang, table: expected, dictionary: actual })
    }
  }
  return drift
}
