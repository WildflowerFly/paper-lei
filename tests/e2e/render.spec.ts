import { expect, test } from '@playwright/test'

test('updates the isolated preview after editing and strips unsafe HTML', async ({ page }) => {
  await page.goto('/')
  const editor = page.locator('.cm-content')
  await editor.click()
  await page.keyboard.press('Control+A')
  await page.keyboard.type('# Live preview\n\n<script>window.pwned = true</script>\n\n**safe**')

  const preview = page.frameLocator('iframe[title="隔离的 Markdown 预览"]')
  await expect(preview.locator('h1')).toHaveText('Live preview')
  await expect(preview.locator('strong')).toHaveText('safe')
  await expect(preview.locator('script')).toHaveCount(0)
  await expect(page.locator('.preview-frame')).toHaveAttribute('sandbox', 'allow-same-origin')
})

test('does not let an older document render replace the active preview', async ({ page }) => {
  await page.goto('/')
  const editor = page.locator('.cm-content')
  await editor.click()
  await page.keyboard.press('Control+A')
  await page.keyboard.type('# README result')
  await page.getByRole('tab', { name: /notes\.md/ }).click()
  await expect(page.frameLocator('iframe[title="隔离的 Markdown 预览"]').locator('h1')).toHaveText(
    'Notes',
  )
})
