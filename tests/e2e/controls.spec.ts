import { expect, test } from '@playwright/test'

const url = '/tests/fixtures/controls.html'

test('dialog focuses the safe action, cycles focus and restores the trigger', async ({ page }) => {
  await page.goto(url)
  const trigger = page.getByRole('button', { name: '打开对话框' })
  await trigger.focus()
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: '移至回收站' })
  const cancel = dialog.getByRole('button', { name: '取消' })
  const confirm = dialog.getByRole('button', { name: '移至回收站' })
  await expect(cancel).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(confirm).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(cancel).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(trigger).toBeFocused()
  await trigger.click()
  await cancel.click()
  await expect(dialog).toBeHidden()
  await expect(trigger).toBeFocused()
})

test('menu, tooltip and feedback work with keyboard focus', async ({ page }) => {
  await page.goto(url)
  const menu = page.getByRole('button', { name: '文件' })
  await menu.focus()
  await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('menuitem', { name: '新建' })).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('menuitem', { name: '保存' })).toBeDisabled()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('menu')).toBeVisible()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('status')).toHaveText('已选择重命名')
  await expect(menu).toBeFocused()
  await page.keyboard.press('ArrowUp')
  await expect(page.getByRole('menuitem', { name: '重命名' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(menu).toBeFocused()

  const copy = page.getByRole('button', { name: '复制' })
  await copy.focus()
  await expect(page.getByRole('tooltip')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('tooltip')).toBeHidden()
  const field = page.getByRole('textbox', { name: '文档名称' })
  await expect(field).toHaveAccessibleDescription('请输入文档名称。')
  await field.fill('示例.md')
  await expect(field).not.toHaveAttribute('aria-invalid', 'true')
  await expect(page.getByText('保存失败。请检查写入权限后重试。')).toBeVisible()
})

test('themes meet text, focus and control contrast targets', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' })
  await page.goto(url)
  await expect(page.locator('html')).toHaveCSS('background-color', 'rgb(13, 17, 23)')
  for (const [theme, background] of [
    ['light', 'rgb(255, 255, 255)'],
    ['dark', 'rgb(13, 17, 23)'],
  ]) {
    await page.getByRole('combobox').selectOption(theme!)
    await expect(page.locator('html')).toHaveCSS('background-color', background!)
    const ratios = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement)
      const button = document.querySelector<HTMLElement>('[data-variant="primary"]')!
      button.focus()
      const action = getComputedStyle(button)
      const input = getComputedStyle(document.querySelector('input')!)
      const luminance = (color: string) =>
        (color.match(/\d+/g) ?? [])
          .slice(0, 3)
          .map((value) => Number(value) / 255)
          .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4))
          .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index]!, 0)
      const contrast = (first: string, second: string) => {
        const levels = [luminance(first), luminance(second)]
        return (Math.max(...levels) + 0.05) / (Math.min(...levels) + 0.05)
      }
      return {
        text: contrast(root.color, root.backgroundColor),
        focus: contrast(action.outlineColor, root.backgroundColor),
        action: contrast(action.color, action.backgroundColor),
        control: contrast(input.borderTopColor, input.backgroundColor),
      }
    })
    expect(ratios.text).toBeGreaterThanOrEqual(4.5)
    expect(ratios.action).toBeGreaterThanOrEqual(4.5)
    expect(ratios.focus).toBeGreaterThanOrEqual(3)
    expect(ratios.control).toBeGreaterThanOrEqual(3)
    if (process.env.UI_EVIDENCE)
      await page.screenshot({ path: `docs/verification/UI-01/${theme}.png` })
  }
})
