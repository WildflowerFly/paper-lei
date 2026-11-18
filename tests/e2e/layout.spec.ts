import { expect, test } from '@playwright/test'

test('renders the desktop workbench with navigation, tabs, split panes and status', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await expect(page.getByRole('main', { name: 'Markdown Studio' })).toBeVisible()
  await expect(page.getByRole('complementary', { name: '工作区导航' })).toBeVisible()
  await expect(page.getByRole('tablist', { name: '打开的文档' })).toBeVisible()
  await expect(page.getByRole('region', { name: '文档工作区' })).toBeVisible()
  await expect(page.getByRole('separator', { name: '调整预览和源码宽度' })).toBeVisible()
  await expect(page.locator('footer.status-bar')).toContainText('README.md · 已保存')
  const shell = page.locator('.app-shell')
  await expect(
    shell.evaluate((element) => getComputedStyle(element).gridTemplateRows.split(' ')[0]),
  ).resolves.toBe('40px')
  await expect(
    shell.evaluate((element) => getComputedStyle(element).gridTemplateRows.split(' ')[1]),
  ).resolves.toBe('36px')
  if (process.env.UI_EVIDENCE)
    await page.screenshot({ path: 'docs/verification/UI-02/desktop.png', fullPage: true })
})

test('supports keyboard split resizing and layout mode switching', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  const separator = page.getByRole('separator', { name: '调整预览和源码宽度' })
  const initial = Number(await separator.getAttribute('aria-valuenow'))
  await separator.focus()
  await page.keyboard.press('ArrowRight')
  await expect(separator).toHaveAttribute('aria-valuenow', String(initial + 16))
  await page.getByRole('button', { name: '源码', exact: true }).click()
  await expect(page.locator('.workbench')).toHaveClass(/mode-source/)
  await expect(page.locator('.source-pane')).toBeVisible()
  await page.getByRole('button', { name: '双栏', exact: true }).click()
  await expect(page.locator('.workbench')).toHaveClass(/mode-split/)
})

test('hides navigation and provides preview/source switcher in a narrow window', async ({
  page,
}) => {
  await page.setViewportSize({ width: 800, height: 640 })
  await page.goto('/')
  await expect(page.getByRole('complementary', { name: '工作区导航' })).toBeHidden()
  await expect(page.getByRole('toolbar', { name: '窄窗区域切换' })).toBeVisible()
  await expect(page.getByRole('button', { name: '源码', exact: true }).last()).toBeVisible()
  await page.getByRole('button', { name: '源码', exact: true }).last().click()
  await expect(page.locator('.workbench')).toHaveClass(/mode-source/)
  await expect(page.getByRole('textbox', { name: '源码编辑器' })).toBeVisible()
  if (process.env.UI_EVIDENCE)
    await page.screenshot({ path: 'docs/verification/UI-02/narrow-source.png', fullPage: true })
})
