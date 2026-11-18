import { expect, test } from '@playwright/test'

test('raw HTML cannot supply scripts, resources, styles, navigation or source mappings', async ({
  page,
}) => {
  const external: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).origin !== 'http://127.0.0.1:1420') external.push(request.url())
  })
  await page.goto('/security-probe.html')
  const result = await page.evaluate(async () => {
    const { safetyProbe } = window as unknown as {
      safetyProbe: typeof import('../../src/services/render-safety')
    }
    const payload =
      '<script>parent.pwned=true</script><img src="https://example.invalid/track"><a href="javascript:alert(1)">link</a><base href="https://example.invalid"><meta http-equiv="refresh" content="0;url=https://example.invalid"><span style="position:fixed" class="katex" id="clobber" data-source-line="999" onclick="alert(1)">text</span><svg><foreignObject>bad</foreignObject></svg>'
    const clean = safetyProbe.sanitizeRawHtml(payload)
    const frame = document.createElement('iframe')
    const loaded = new Promise((resolve) => frame.addEventListener('load', resolve, { once: true }))
    safetyProbe.attachPreview(frame, clean + '<script>parent.pwned=true</script>')
    document.body.append(frame)
    await loaded
    return {
      clean,
      sandbox: frame.sandbox.value,
      pwned: 'pwned' in window,
      text: frame.contentDocument?.body.textContent,
    }
  })
  expect(result.clean).not.toMatch(/script|img|href|class=|id=|data-|style=|onclick|svg/i)
  expect(result.sandbox).toBe('allow-same-origin')
  expect(result.pwned).toBe(false)
  expect(result.text).toContain('text')
  expect(external).toEqual([])
})

test('formula output and SVG remain readable across distinct sanitization policies', async ({
  page,
}) => {
  await page.goto('/security-probe.html')
  const result = await page.evaluate(() => {
    const { safetyProbe } = window as unknown as {
      safetyProbe: typeof import('../../src/services/render-safety') & {
        katex: typeof import('katex')
      }
    }
    const formula = safetyProbe.sanitizeFormula(
      safetyProbe.katex.renderToString(String.raw`\frac{n(n+1)}{2}`, {
        trust: false,
        maxExpand: 1000,
      }),
    )
    const diagram = safetyProbe.sanitizeDiagram(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><text x="20" y="30">开始</text><image href="https://example.invalid/a"/><foreignObject>bad</foreignObject><path fill="url(https://example.invalid/paint)" d="M0 0L20 20"/></svg>',
    )
    return { formula, diagram }
  })
  expect(result.formula).toContain('katex')
  expect(result.formula).toContain('<math')
  expect(result.diagram).toContain('开始')
  expect(result.diagram).not.toMatch(/foreignObject|https:|<image/)
})
