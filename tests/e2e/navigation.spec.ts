import { expect, test } from '@playwright/test'

test('supports keyboard navigation tabs and file/search/outline states', async ({ page }) => {
  await page.goto('/')
  const navTabs = page.getByRole('tablist', { name: '导航页签' }).getByRole('tab')
  await navTabs.first().focus()
  await page.keyboard.press('ArrowRight')
  await expect(navTabs.nth(1)).toBeFocused()
  await expect(page.getByRole('searchbox', { name: '搜索文件或内容' })).toBeVisible()
  await page.keyboard.press('End')
  await expect(navTabs.nth(2)).toBeFocused()
  await expect(page.getByRole('button', { name: 'Markdown Studio' })).toBeVisible()
  await page.keyboard.press('Home')
  await expect(navTabs.first()).toBeFocused()
  if (process.env.UI_EVIDENCE) {
    await page.screenshot({
      path: `docs/verification/UI-04/${process.env.UI_THEME ?? 'light'}.png`,
      fullPage: true,
    })
  }
})

test('shows duplicate paths, recent/favorite groups and missing-file feedback', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'README.md examples/README.md' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'README.md docs/README.md' })).toBeVisible()
  await expect(page.getByText('最近打开')).toBeVisible()
  await expect(page.getByText('收藏')).toBeVisible()
  await page.getByRole('button', { name: 'archive.md docs/archive.md' }).click()
  await expect(page.getByRole('status', { name: '命令反馈' })).toContainText('文件不存在')
})

test('reuses an opened file and returns to welcome state after closing all tabs', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'notes.md docs/notes.md' }).click()
  await expect(page.getByRole('tab', { name: /notes\.md/ })).toHaveCount(1)
  await page.getByLabel('关闭标签').first().click()
  await page.getByLabel('关闭标签').first().click()
  await expect(page.getByRole('region', { name: '欢迎页' })).toBeVisible()
  await expect(page.getByText('开始使用 Markdown Studio')).toBeVisible()
  await expect(page.getByRole('button', { name: '新建文档' })).toBeVisible()
})
