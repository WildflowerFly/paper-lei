import { expect, test, type Page } from '@playwright/test'

const showcase = `# Markdown showcase

## GFM elements

- [ ] Pending task
- [x] Completed task

| Name | Value |
| --- | ---: |
| Alpha | 1 |
| Beta | 2 |

See [the docs](https://example.com) and a footnote.[^note]

> A readable quote.

${'```'}js
const value = 'keeps scrolling';
${'```'}

[^note]: Footnote content.`

async function setEditor(page: Page) {
  const editor = page.locator('.cm-content')
  await editor.click()
  await page.keyboard.press('Control+A')
  await page.keyboard.insertText(showcase)
}

test('renders GitHub-style GFM elements and isolates markdown styles', async ({ page }) => {
  await page.goto('/')
  await setEditor(page)

  const preview = page.frameLocator('iframe[title="隔离的 Markdown 预览"]')
  await expect(preview.locator('h1')).toHaveAttribute('id', 'user-content-markdown-showcase')
  await expect(preview.locator('.task-list-item-checkbox')).toHaveCount(2)
  await expect(preview.locator('.task-list-item-checkbox').first()).toBeDisabled()
  await expect(preview.locator('table')).toBeVisible()
  await expect(preview.locator('.footnotes')).toBeVisible()
  await expect(preview.locator('.heading-anchor')).toHaveCount(2)
  await expect(preview.locator('pre')).toBeVisible()

  const style = await page.locator('.preview-frame').evaluate((frame) => {
    const previewDocument = (frame as HTMLIFrameElement).contentDocument
    return {
      bodyBackground: previewDocument ? getComputedStyle(previewDocument.body).backgroundColor : '',
      appButtonColor: getComputedStyle(document.querySelector('button') ?? document.body).color,
    }
  })
  expect(style.bodyBackground).toBe('rgb(255, 255, 255)')
  expect(style.appButtonColor).not.toBe('')
})

test('switches isolated markdown preview between light and dark themes', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '打开设置' }).click()
  await page.getByRole('combobox', { name: '主题偏好' }).selectOption('dark')
  const preview = page.frameLocator('iframe[title="隔离的 Markdown 预览"]')
  await expect(preview.locator('body')).toHaveCSS('background-color', 'rgb(13, 17, 23)')
  await page.getByRole('combobox', { name: '主题偏好' }).selectOption('light')
  await expect(preview.locator('body')).toHaveCSS('background-color', 'rgb(255, 255, 255)')
})

test('keeps wide tables and code blocks within the preview frame', async ({ page }) => {
  await page.goto('/')
  const editor = page.locator('.cm-content')
  await editor.click()
  await page.keyboard.press('Control+A')
  await page.keyboard.insertText(
    `| ${'x'.repeat(160)} | ${'y'.repeat(160)} |\n| --- | --- |\n| ${'a'.repeat(160)} | ${'b'.repeat(160)} |`,
  )
  await expect(
    page.frameLocator('iframe[title="隔离的 Markdown 预览"]').locator('table'),
  ).toBeVisible()
  const metrics = await page.locator('.preview-frame').evaluate((frame) => {
    const previewDocument = (frame as HTMLIFrameElement).contentDocument!
    const tableScroll = previewDocument.querySelector('.table-scroll')!
    return { frameWidth: frame.clientWidth, tableScrollWidth: tableScroll.scrollWidth }
  })
  expect(metrics.tableScrollWidth).toBeGreaterThan(metrics.frameWidth)
})
