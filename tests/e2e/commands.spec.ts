import { expect, test } from '@playwright/test'

test('exposes six menus and keeps save/export disabled without an active document', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page.getByRole('navigation', { name: '应用菜单' }).getByRole('button')).toHaveCount(
    6,
  )
  await page.getByRole('button', { name: '文件', exact: true }).click()
  await expect(page.getByRole('menu', { name: '文件' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: /^保存 / })).toBeEnabled()
  await expect(page.getByRole('menuitem', { name: /^导出$/ })).toBeEnabled()
  await page.getByLabel('关闭标签').last().click()
  await page.getByLabel('关闭标签').first().click()
  await page.getByRole('button', { name: '文件', exact: true }).click()
  await expect(page.getByRole('menuitem', { name: /^保存 / })).toBeDisabled()
  await expect(page.getByRole('menuitem', { name: /^导出$/ })).toBeDisabled()
  await expect(page.getByRole('button', { name: '保存' })).toBeDisabled()
  await expect(page.getByRole('button', { name: '导出' })).toBeDisabled()
})

test('dispatches the same view command from menu, toolbar and shortcut', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '视图', exact: true }).click()
  await page.getByRole('menuitem', { name: '仅源码' }).click()
  await expect(page.locator('.workbench')).toHaveClass(/mode-source/)
  await page.getByRole('button', { name: '双栏', exact: true }).click()
  await expect(page.locator('.workbench')).toHaveClass(/mode-split/)
  await page.keyboard.press('Control+B')
  await expect(page.locator('.app-shell')).toHaveClass(/nav-collapsed/)
  await expect(page.getByRole('status', { name: '命令反馈' })).toContainText('已执行：导航')
})
