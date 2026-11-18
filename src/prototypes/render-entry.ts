import mermaid from 'mermaid'
import { sanitizeDiagram } from '../services/render-safety'

interface RenderRequest {
  nonce: string
  source: string
  stall?: boolean
}
interface RenderReply {
  nonce: string
  svg?: string
  error?: string
  ipcDenied: boolean
}

declare global {
  interface Window {
    renderProbe: (request: RenderRequest) => Promise<void>
    renderProbeResult: RenderReply | null
  }
}

mermaid.initialize({
  startOnLoad: false,
  securityLevel: 'strict',
  maxTextSize: 100 * 1024,
  maxEdges: 500,
  flowchart: { htmlLabels: false },
  theme: 'neutral',
})

window.renderProbeResult = null
window.renderProbe = async (request) => {
  let ipcDenied = false
  try {
    const tauri = (
      window as unknown as {
        __TAURI_INTERNALS__?: { invoke: (command: string) => Promise<unknown> }
      }
    ).__TAURI_INTERNALS__
    if (tauri) await tauri.invoke('business_probe')
    else ipcDenied = true
  } catch {
    ipcDenied = true
  }
  try {
    if (request.stall) {
      for (;;) {
        Math.sqrt(Date.now())
      }
    }
    if (
      !/^[a-f0-9-]{36}$/.test(request.nonce) ||
      new TextEncoder().encode(request.source).length > 100 * 1024 ||
      request.source.split('\n').length > 500
    ) {
      throw new Error('图表超出预算')
    }
    const { svg } = await mermaid.render(
      'trusted-diagram',
      request.source,
      document.getElementById('diagram')!,
    )
    const safe = sanitizeDiagram(svg)
    const parsedSvg = new DOMParser().parseFromString(safe, 'image/svg+xml')
    if (!safe || parsedSvg.querySelectorAll('*').length > 500) throw new Error('图表节点超出预算')
    window.renderProbeResult = { nonce: request.nonce, svg: safe, ipcDenied }
  } catch {
    window.renderProbeResult = { nonce: request.nonce, error: 'RENDER_FAILED', ipcDenied }
  }
}
