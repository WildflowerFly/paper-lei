import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
})

test('renders a CodeMirror markdown editor with line numbers and wrapping', async ({ page }) => {
  await expect(page.locator('.cm-editor')).toBeVisible()
  await expect(page.locator('.cm-content')).toHaveAttribute('contenteditable', 'true')
  await expect(page.locator('.cm-gutters')).toBeVisible()
  await expect(page.locator('.cm-lineNumbers')).toBeVisible()
  await expect(page.locator('.cm-content')).toContainText('Markdown Studio')
})

test('keeps each document text and dirty marker independent across tab switches', async ({
  page,
}) => {
  const editor = page.locator('.cm-content')
  await editor.click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type('\nREADME change')
  await expect(page.locator('.document-tab').first()).toContainText('●')

  await page.getByRole('tab', { name: /notes\.md/ }).click()
  await expect(page.locator('.cm-content')).toContainText('独立的文档草稿')
  await editor.click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type('\nNotes change')

  await page.getByRole('tab', { name: /README\.md/ }).click()
  await expect(page.locator('.cm-content')).toContainText('README change')
  await expect(page.locator('.cm-content')).not.toContainText('Notes change')
  await editor.click()
  await page.keyboard.press('Control+Z')
  await expect(page.locator('.cm-content')).not.toContainText('README change')

  await page.getByRole('tab', { name: /notes\.md/ }).click()
  await expect(page.locator('.cm-content')).toContainText('Notes change')
})
