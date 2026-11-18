import katex from 'katex'
import 'katex/dist/katex.min.css'
import {
  attachPreview,
  sanitizeRawHtml,
  sanitizeFormula,
  sanitizeDiagram,
} from '../services/render-safety'

Object.assign(window, {
  safetyProbe: { attachPreview, sanitizeRawHtml, sanitizeFormula, sanitizeDiagram, katex },
})
const frame = document.createElement('iframe')
const input = document.createElement('input')
input.setAttribute('aria-label', '响应测试输入')
document.getElementById('probe')?.append(input)
frame.id = 'preview'
attachPreview(frame, sanitizeRawHtml('<h1>隔离预览</h1>'))
document.getElementById('probe')?.append(frame)
