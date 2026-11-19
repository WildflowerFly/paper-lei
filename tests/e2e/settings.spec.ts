import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
})

test('applies theme and layout settings immediately and restores them on reload', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: '打开设置' }).click()
  await page.getByRole('combobox', { name: '主题偏好' }).selectOption('dark')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.getByRole('combobox', { name: '默认布局' }).selectOption('source')
  await expect(page.locator('.workbench')).toHaveClass(/mode-source/)
  await page.waitForTimeout(600)
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.locator('.workbench')).toHaveClass(/mode-source/)
})

test('falls back to defaults and surfaces a recovery notice for invalid configuration', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'markdown-studio.settings',
      JSON.stringify({ settings: { schemaVersion: 999 } }),
    )
  })
  await page.goto('/')
  await page.getByRole('button', { name: '打开设置' }).click()
  await expect(page.locator('.settings-warning')).toContainText('配置文件无法读取')
  await expect(page.getByRole('combobox', { name: '主题偏好' })).toHaveValue('system')
})

test('cycles system, light and dark themes from the toolbar', async ({ page }) => {
  await page.goto('/')
  const theme = page.getByRole('button', { name: '当前主题' })
  await theme.click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await theme.click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await theme.click()
  await expect(page.locator('html')).not.toHaveAttribute('data-theme')
})
