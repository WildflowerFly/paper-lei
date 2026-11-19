import { expect, test } from '@playwright/test'

test('shows asynchronous Unicode statistics, cursor position and dirty state', async ({
  page,
}, info) => {
  await page.goto('/')
  const editor = page.locator('.cm-content')
  await editor.click()
  await page.keyboard.press('Control+A')
  await page.keyboard.insertText('中文 😀\nsecond line')
  await page.keyboard.press('Control+Home')
  await expect(page.locator('.status-document')).toContainText('README.md · 未保存')
  await expect(page.locator('.status-bar')).toContainText('4 字 · 16 字符')
  await expect(page.locator('.status-bar')).toContainText('行 1，列 1')
  await page.keyboard.press('Control+End')
  await expect(page.locator('.status-bar')).toContainText('行 2，列 12')
  await page.screenshot({ path: info.outputPath('light.png') })
  await page.getByRole('button', { name: '当前主题' }).click()
  await page.getByRole('button', { name: '当前主题' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.screenshot({ path: info.outputPath('dark.png') })
  await page.getByRole('tab', { name: /notes\.md/ }).click()
  await expect(page.locator('.status-document')).toContainText('notes.md · 未保存')
  await expect(page.locator('.status-bar')).toContainText('行 1，列 1')
  await expect
    .poll(async () => page.locator('.status-bar').innerText())
    .toMatch(/\d+ 字 · \d+ 字符/)
})

test('drops stale statistics after rapid edits', async ({ page }) => {
  await page.goto('/')
  const editor = page.locator('.cm-content')
  await editor.click()
  await page.keyboard.press('Control+A')
  await page.keyboard.insertText('old')
  await page.keyboard.insertText(' newest')
  await expect(page.locator('.status-bar')).toContainText('2 字 · 10 字符')
  await expect(page.locator('.status-bar')).not.toContainText('1 字 · 3 字符')
})

test('shows an empty untitled document as unsaved', async ({ page }) => {
  await page.goto('/')
  await page.keyboard.press('Control+N')
  await expect(page.locator('.status-document')).toContainText('未命名 3 · 未保存')
  await expect(page.locator('.status-statistics')).toHaveText('0 字 · 0 字符')
})
