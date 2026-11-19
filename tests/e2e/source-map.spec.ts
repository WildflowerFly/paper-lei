import { expect, test } from '@playwright/test'

test('clicking a mapped preview block reveals its source line without editing', async ({
  page,
}) => {
  await page.goto('/')
  const editor = page.locator('.cm-content')
  await editor.click()
  await page.keyboard.press('Control+A')
  await page.keyboard.insertText(
    '# Heading\n\nParagraph to locate\n\n- one\n- two\n\n```\ncode\n```',
  )

  const preview = page.frameLocator('iframe[title="隔离的 Markdown 预览"]')
  await expect(preview.locator('[data-source-block="block-1"]')).toHaveText('Paragraph to locate')
  await expect(preview.locator('[data-source-block]')).toHaveCount(5)
  await expect(preview.locator('pre')).toHaveAttribute('data-source-block', 'block-3')
  const before = await editor.textContent()

  await preview.locator('[data-source-block="block-1"]').click()
  await expect(page.locator('.cm-source-highlight')).toHaveCount(1)
  await expect(editor).toHaveText(before ?? '')
})

test('preview interactions do not trigger source positioning', async ({ page }) => {
  await page.goto('/')
  const editor = page.locator('.cm-content')
  await editor.click()
  await page.keyboard.press('Control+A')
  await page.keyboard.insertText(
    '[external](https://example.com)\n\n![image](https://example.com/image.png)',
  )

  const preview = page.frameLocator('iframe[title="隔离的 Markdown 预览"]')
  await expect(preview.locator('a')).toHaveAttribute('href', 'https://example.com')
  await expect(preview.locator('img')).toHaveCount(0)
  await preview.locator('a').click()
  await expect(page.locator('.cm-source-highlight')).toHaveCount(0)
})
