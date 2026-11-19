import DOMPurify from 'dompurify'
import markdownStyles from '../styles/markdown.css?inline'

const rawTags = [
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'br',
  'hr',
  'em',
  'strong',
  's',
  'del',
  'blockquote',
  'ul',
  'ol',
  'li',
  'pre',
  'code',
  'a',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'details',
  'summary',
  'sup',
  'sub',
  'kbd',
  'span',
  'div',
  'section',
  'input',
]

export function sanitizeRawHtml(html: string, allowGeneratedAttributes = false): string {
  const allowedAttributes = [
    'title',
    'colspan',
    'rowspan',
    'start',
    'href',
    ...(allowGeneratedAttributes
      ? ['class', 'id', 'aria-label', 'aria-hidden', 'checked', 'disabled', 'type']
      : []),
  ]
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: rawTags,
    ALLOWED_ATTR: allowedAttributes,
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    SANITIZE_NAMED_PROPS: true,
  })
}

export function sanitizeFormula(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      'span',
      'math',
      'semantics',
      'mrow',
      'mi',
      'mn',
      'mo',
      'mfrac',
      'msup',
      'msub',
      'msubsup',
      'mspace',
      'annotation',
      'mtext',
      'mtable',
      'mtr',
      'mtd',
      'msqrt',
      'mroot',
      'mover',
      'munder',
      'munderover',
    ],
    FORBID_TAGS: ['script', 'style', 'img', 'a', 'iframe', 'form', 'input', 'object', 'embed'],
    ALLOWED_ATTR: ['class', 'style', 'xmlns', 'encoding', 'display', 'mathvariant', 'aria-hidden'],
    ALLOW_DATA_ATTR: false,
  })
}

export function sanitizeDiagram(svg: string): string {
  const clean = DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: false },
    FORBID_TAGS: ['foreignObject', 'script', 'style', 'image', 'use', 'a', 'animate', 'set'],
    FORBID_ATTR: ['href', 'xlink:href', 'style'],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: true,
  })
  const document = new DOMParser().parseFromString(clean, 'image/svg+xml')
  if (document.querySelector('parsererror') || document.documentElement.localName !== 'svg')
    return ''
  for (const element of document.querySelectorAll('*')) {
    for (const attribute of [...element.attributes]) {
      if (/url\s*\(/i.test(attribute.value) && !/^url\(#[\w-]+\)$/.test(attribute.value)) {
        element.removeAttribute(attribute.name)
      }
    }
  }
  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style')
  style.textContent =
    'text{fill:#1f2328;font:16px sans-serif}rect,circle,ellipse,polygon{fill:#f6f8fa;stroke:#59636e}path,line,polyline{stroke:#59636e}path{fill:none}'
  document.documentElement.prepend(style)
  return new XMLSerializer().serializeToString(document.documentElement)
}

export const previewCsp =
  "default-src 'none'; script-src 'none'; connect-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src 'none'; base-uri 'none'; form-action 'none'"

export function createPreviewDocument(
  safeBody: string,
  theme: 'light' | 'dark' | 'system' = 'system',
): string {
  const themeAttribute = theme === 'system' ? '' : ` data-theme="${theme}"`
  return `<!doctype html><html lang="zh-CN"${themeAttribute}><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${previewCsp}"><style>${markdownStyles}</style></head><body><article class="markdown-body">${safeBody}</article></body></html>`
}

export function attachPreview(frame: HTMLIFrameElement, safeBody: string): void {
  frame.setAttribute('sandbox', 'allow-same-origin')
  frame.title = '隔离的 Markdown 预览'
  frame.addEventListener(
    'load',
    () => {
      const document = frame.contentDocument
      document?.addEventListener(
        'click',
        (event) => {
          if ((event.target as Element | null)?.closest('a,form,button,input'))
            event.preventDefault()
        },
        true,
      )
    },
    { once: true },
  )
  frame.srcdoc = createPreviewDocument(safeBody)
}
