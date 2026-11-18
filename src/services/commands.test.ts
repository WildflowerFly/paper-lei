import { describe, expect, it } from 'vitest'
import {
  commandIsEnabled,
  commandMenus,
  commands,
  findCommandByShortcut,
  findShortcutConflicts,
} from './commands'

describe('command registry', () => {
  it('defines the six product menus and has no shortcut conflicts', () => {
    expect(commandMenus.map((menu) => menu.label)).toEqual([
      '文件',
      '编辑',
      '视图',
      '格式',
      '工具',
      '帮助',
    ])
    expect(findShortcutConflicts()).toEqual([])
    expect(findCommandByShortcut('Ctrl+B')?.id).toBe('view.navigation')
    expect(findCommandByShortcut('Ctrl+Shift+S')?.id).toBe('file.saveAll')
  })

  it('uses one document availability rule for save and export', () => {
    const save = commands.find((command) => command.id === 'file.save')!
    const exportCommand = commands.find((command) => command.id === 'file.export')!
    expect(commandIsEnabled(save, false)).toBe(false)
    expect(commandIsEnabled(exportCommand, false)).toBe(false)
    expect(commandIsEnabled(save, true)).toBe(true)
    expect(commandIsEnabled(exportCommand, true)).toBe(true)
  })
})
