import { expect, test } from '@playwright/test'

for (const theme of ['light', 'dark'] as const) {
  test(`starts without remote requests in ${theme} mode`, async ({ page }) => {
    const external: string[] = []
    page.on('request', (request) => {
      if (new URL(request.url()).origin !== 'http://127.0.0.1:1420') external.push(request.url())
    })
    await page.emulateMedia({ colorScheme: theme })
    await page.goto('/')
    await expect(
      page.getByRole('heading', { name: 'Markdown Studio', exact: true }).first(),
    ).toBeVisible()
    await expect(page.getByText('本地 Markdown 工作台')).toBeVisible()
    expect(external).toEqual([])
  })
}
