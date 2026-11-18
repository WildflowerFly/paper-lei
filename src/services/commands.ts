export type CommandMenu = 'file' | 'edit' | 'view' | 'format' | 'tools' | 'help'

export type CommandId =
  | 'file.new'
  | 'file.open'
  | 'file.openFolder'
  | 'file.save'
  | 'file.saveAll'
  | 'file.saveAs'
  | 'file.export'
  | 'file.print'
  | 'file.close'
  | 'edit.undo'
  | 'edit.redo'
  | 'edit.cut'
  | 'edit.copy'
  | 'edit.paste'
  | 'edit.selectAll'
  | 'edit.find'
  | 'edit.replace'
  | 'view.split'
  | 'view.preview'
  | 'view.source'
  | 'view.navigation'
  | 'view.outline'
  | 'view.scrollSync'
  | 'view.theme'
  | 'view.focus'
  | 'view.fullscreen'
  | 'format.heading'
  | 'format.bold'
  | 'format.italic'
  | 'format.strikethrough'
  | 'format.list'
  | 'format.quote'
  | 'format.code'
  | 'format.link'
  | 'format.image'
  | 'format.table'
  | 'tools.search'
  | 'tools.quickOpen'
  | 'tools.copyMarkdown'
  | 'tools.copyHtml'
  | 'tools.settings'
  | 'help.shortcuts'
  | 'help.about'
  | 'help.licenses'

export type CommandDefinition = {
  id: CommandId
  menu: CommandMenu
  label: string
  shortcut?: string
  requiresDocument?: boolean
}

export const commandMenus: { id: CommandMenu; label: string }[] = [
  { id: 'file', label: '文件' },
  { id: 'edit', label: '编辑' },
  { id: 'view', label: '视图' },
  { id: 'format', label: '格式' },
  { id: 'tools', label: '工具' },
  { id: 'help', label: '帮助' },
]

export const commands: CommandDefinition[] = [
  { id: 'file.new', menu: 'file', label: '新建', shortcut: 'Ctrl+N' },
  { id: 'file.open', menu: 'file', label: '打开文件', shortcut: 'Ctrl+O' },
  { id: 'file.openFolder', menu: 'file', label: '打开文件夹', shortcut: 'Ctrl+Alt+O' },
  { id: 'file.save', menu: 'file', label: '保存', shortcut: 'Ctrl+S', requiresDocument: true },
  {
    id: 'file.saveAll',
    menu: 'file',
    label: '全部保存',
    shortcut: 'Ctrl+Shift+S',
    requiresDocument: true,
  },
  { id: 'file.saveAs', menu: 'file', label: '另存为', requiresDocument: true },
  { id: 'file.export', menu: 'file', label: '导出', requiresDocument: true },
  {
    id: 'file.print',
    menu: 'file',
    label: '打印',
    shortcut: 'Ctrl+Shift+P',
    requiresDocument: true,
  },
  { id: 'file.close', menu: 'file', label: '关闭标签', shortcut: 'Ctrl+W', requiresDocument: true },
  { id: 'edit.undo', menu: 'edit', label: '撤销', shortcut: 'Ctrl+Z', requiresDocument: true },
  { id: 'edit.redo', menu: 'edit', label: '重做', shortcut: 'Ctrl+Y', requiresDocument: true },
  { id: 'edit.cut', menu: 'edit', label: '剪切', requiresDocument: true },
  { id: 'edit.copy', menu: 'edit', label: '复制', requiresDocument: true },
  { id: 'edit.paste', menu: 'edit', label: '粘贴', requiresDocument: true },
  { id: 'edit.selectAll', menu: 'edit', label: '全选', requiresDocument: true },
  { id: 'edit.find', menu: 'edit', label: '查找', shortcut: 'Ctrl+F', requiresDocument: true },
  { id: 'edit.replace', menu: 'edit', label: '替换', shortcut: 'Ctrl+H', requiresDocument: true },
  { id: 'view.split', menu: 'view', label: '双栏' },
  { id: 'view.preview', menu: 'view', label: '仅预览' },
  { id: 'view.source', menu: 'view', label: '仅源码' },
  { id: 'view.navigation', menu: 'view', label: '导航', shortcut: 'Ctrl+B' },
  { id: 'view.outline', menu: 'view', label: '目录' },
  { id: 'view.scrollSync', menu: 'view', label: '滚动同步' },
  { id: 'view.theme', menu: 'view', label: '主题' },
  { id: 'view.focus', menu: 'view', label: '专注', shortcut: 'F8' },
  { id: 'view.fullscreen', menu: 'view', label: '全屏', shortcut: 'F11' },
  { id: 'format.heading', menu: 'format', label: '标题', requiresDocument: true },
  { id: 'format.bold', menu: 'format', label: '粗体', requiresDocument: true },
  { id: 'format.italic', menu: 'format', label: '斜体', requiresDocument: true },
  { id: 'format.strikethrough', menu: 'format', label: '删除线', requiresDocument: true },
  { id: 'format.list', menu: 'format', label: '列表', requiresDocument: true },
  { id: 'format.quote', menu: 'format', label: '引用', requiresDocument: true },
  { id: 'format.code', menu: 'format', label: '代码', requiresDocument: true },
  { id: 'format.link', menu: 'format', label: '链接', requiresDocument: true },
  { id: 'format.image', menu: 'format', label: '图片', requiresDocument: true },
  { id: 'format.table', menu: 'format', label: '表格', requiresDocument: true },
  { id: 'tools.search', menu: 'tools', label: '工作空间搜索' },
  { id: 'tools.quickOpen', menu: 'tools', label: '快速打开', shortcut: 'Ctrl+P' },
  { id: 'tools.copyMarkdown', menu: 'tools', label: '复制 Markdown', requiresDocument: true },
  { id: 'tools.copyHtml', menu: 'tools', label: '复制渲染 HTML', requiresDocument: true },
  { id: 'tools.settings', menu: 'tools', label: '设置' },
  { id: 'help.shortcuts', menu: 'help', label: '快捷键说明' },
  { id: 'help.about', menu: 'help', label: '关于' },
  { id: 'help.licenses', menu: 'help', label: '版本与开源许可证' },
]

export function commandIsEnabled(command: CommandDefinition, hasDocument: boolean) {
  return !command.requiresDocument || hasDocument
}

export function findCommandByShortcut(shortcut: string) {
  return commands.find((command) => command.shortcut === shortcut)
}

export function findShortcutConflicts() {
  const seen = new Map<string, CommandId>()
  const conflicts: [string, CommandId, CommandId][] = []
  for (const command of commands) {
    if (!command.shortcut) continue
    const previous = seen.get(command.shortcut)
    if (previous) conflicts.push([command.shortcut, previous, command.id])
    else seen.set(command.shortcut, command.id)
  }
  return conflicts
}
