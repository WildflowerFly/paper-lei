import { expect, test, type Page } from '@playwright/test'

function preview(page: Page) {
  return page.frameLocator('.preview-frame')
}

function documentSource(sections: number) {
  return Array.from({ length: sections }, (_, index) => {
    if (index === 2) return `## Section ${index}\n\n${'Spaced text.\n'.repeat(80)}\n`
    if (index === 8)
      return `## Section ${index}\n\n${'A wide paragraph wraps differently. '.repeat(20)}\n`
    return `## Section ${index}\n\nParagraph ${index}.\n`
  }).join('\n')
}

async function enterDocument(page: Page, sections = 48) {
  await page.goto('/')
  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+A')
  await page.keyboard.insertText(documentSource(sections))
  await expect(preview(page).locator('h2')).toHaveCount(sections)
  await page.keyboard.press('Control+Home')
}

function headingDistance(page: Page, section: number) {
  return preview(page)
    .locator(`h2[id$="-section-${section}"]`)
    .evaluate((heading) => Math.abs(heading.getBoundingClientRect().top))
}

async function scrollPreviewTo(page: Page, section: number) {
  await preview(page)
    .locator(`h2[id$="-section-${section}"]`)
    .evaluate((heading) => heading.scrollIntoView({ block: 'start' }))
}

async function moveSource(page: Page, delta: number) {
  await page.locator('.cm-scroller').hover()
  await page.mouse.wheel(0, delta)
}

async function sourceTop(page: Page) {
  return page.locator('.cm-scroller').evaluate((editor) => editor.scrollTop)
}

for (const sections of [32, 96]) {
  test(`keeps ${sections} uneven sections aligned from either scroll pane`, async ({ page }) => {
    await enterDocument(page, sections)
    await moveSource(page, 900)
    await expect.poll(() => sourceTop(page)).toBeGreaterThan(850)
    const body = preview(page).locator('body')
    const previewTop = () =>
      body.evaluate((element) => element.ownerDocument.scrollingElement!.scrollTop)
    await expect.poll(previewTop).toBeGreaterThan(200)
    expect(await previewTop()).toBeLessThan(500)

    await scrollPreviewTo(page, 12)
    await expect.poll(() => headingDistance(page, 12)).toBeLessThan(3)
    const sourceHeading = page.locator('.cm-line').filter({ hasText: /^## Section 12$/ })
    const sourceViewport = page.locator('.cm-scroller')
    await expect
      .poll(async () => {
        const bounds = await sourceHeading.boundingBox({ timeout: 1000 })
        const viewport = await sourceViewport.boundingBox()
        return Math.abs((bounds?.y ?? 0) - (viewport?.y ?? 0))
      })
      .toBeLessThan(25)

    await moveSource(page, -425)
    await expect.poll(() => headingDistance(page, 12)).toBeGreaterThan(40)
    const settled = await previewTop()
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    )
    expect(await previewTop()).toBeCloseTo(settled, 0)
  })
}

test('retains the reading block after delayed image sizing, resizing, editing and changing tabs', async ({
  page,
}, info) => {
  await enterDocument(page)
  await scrollPreviewTo(page, 12)
  await expect.poll(() => headingDistance(page, 12)).toBeLessThan(3)

  await page.locator('.preview-frame').evaluate((frame) => {
    const document = (frame as HTMLIFrameElement).contentDocument!
    const paragraph = [...document.querySelectorAll('p')].find(
      (element) => element.textContent === 'Paragraph 3.',
    )!
    const image = document.createElement('img')
    image.alt = 'Synthetic layout test image'
    paragraph.append(image)
    image.src = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="320"><rect width="240" height="320" fill="gray"/></svg>')}`
  })
  await expect
    .poll(() =>
      preview(page)
        .locator('img')
        .evaluate((image: HTMLImageElement) => image.naturalHeight),
    )
    .toBe(320)
  await expect.poll(() => headingDistance(page, 12)).toBeLessThan(3)
  await page.getByRole('separator', { name: '调整预览和源码宽度' }).press('ArrowLeft')
  await page.setViewportSize({ width: 1050, height: 780 })
  await expect.poll(() => headingDistance(page, 12)).toBeLessThan(3)

  await page.locator('.cm-content').focus()
  await page.keyboard.press('Control+Home')
  await page.keyboard.insertText('# Added before existing sections\n\n')
  await expect(
    preview(page).locator('h1').filter({ hasText: 'Added before existing sections' }),
  ).toBeAttached()
  await scrollPreviewTo(page, 12)
  await page.keyboard.insertText('More content\n\n')
  await expect(preview(page).getByText('More content', { exact: true })).toBeAttached()
  await expect.poll(() => headingDistance(page, 12)).toBeLessThan(3)

  await page.getByRole('tab', { name: /notes\.md/ }).click()
  await expect(preview(page).locator('h1')).toHaveText('Notes')
  await page.getByRole('tab', { name: /README\.md/ }).click()
  await expect.poll(() => headingDistance(page, 12)).toBeLessThan(3)
  await page.screenshot({ path: info.outputPath('light.png') })
  await page.getByRole('button', { name: '当前主题' }).click()
  await page.getByRole('button', { name: '当前主题' }).click()
  await expect(preview(page).locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect.poll(() => headingDistance(page, 12)).toBeLessThan(3)
  await page.screenshot({ path: info.outputPath('dark.png') })
})

test('view menu switches independent scrolling on and remembers the choice', async ({ page }) => {
  await enterDocument(page)
  const menuButton = page.getByRole('button', { name: '视图', exact: true })
  const menuItem = page.getByRole('menuitemcheckbox', { name: '滚动同步' })
  await menuButton.click()
  await expect(menuItem).toHaveAttribute('aria-checked', 'true')
  await menuItem.click()
  const before = await sourceTop(page)
  await scrollPreviewTo(page, 12)
  await expect.poll(() => headingDistance(page, 12)).toBeLessThan(3)
  expect(await sourceTop(page)).toBe(before)
  await page.reload()
  await menuButton.click()
  await expect(menuItem).toHaveAttribute('aria-checked', 'false')
})
