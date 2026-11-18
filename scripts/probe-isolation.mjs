import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { setTimeout as wait } from 'node:timers/promises'

const executable = resolve('src-tauri/target/debug/examples/render_probe.exe')
const directory = resolve('.tmp/isolation')
await mkdir(directory, { recursive: true })
const host = spawn(executable, ['host'], {
  windowsHide: true,
  env: {
    ...process.env,
    STUDIO_RENDER_PROFILE: resolve(directory, 'host'),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=19343',
  },
  stdio: 'ignore',
})
let socket
let renderer
try {
  let page
  for (let attempt = 0; attempt < 50 && !page; attempt++) {
    await wait(200)
    const pages = await fetch('http://127.0.0.1:19343/json/list')
      .then((result) => result.json())
      .catch(() => [])
    page = pages.find((page) => page.url.includes('/security-probe.html'))
  }
  if (!page) throw Error('native host did not become ready')
  socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve) => socket.addEventListener('open', resolve, { once: true }))
  const pending = new Map()
  let sequence = 0
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (message.id) pending.get(message.id)?.(message)
  })
  function evaluate(expression) {
    const id = ++sequence
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('host did not respond')), 1000)
      pending.set(id, (response) => {
        clearTimeout(timer)
        pending.delete(id)
        resolve(response.result?.result?.value)
      })
      socket.send(
        JSON.stringify({
          id,
          method: 'Runtime.evaluate',
          params: { expression, returnByValue: true },
        }),
      )
    })
  }
  renderer = spawn(executable, ['stall'], {
    windowsHide: true,
    env: { ...process.env, STUDIO_RENDER_PROFILE: resolve(directory, 'renderer') },
    stdio: 'ignore',
  })
  const exited = new Promise((resolve) => renderer.once('exit', (code) => resolve(code)))
  const durations = []
  for (let index = 0; index < 60; index++) {
    const start = performance.now()
    const value = await evaluate(
      `document.querySelector('input').value='${index}'; document.querySelector('input').value`,
    )
    if (value !== `${index}`) throw Error('input value mismatch')
    durations.push(performance.now() - start)
    await wait(40)
  }
  const code = await exited
  if (code !== 2) throw Error(`stalled process exit: ${code}`)
  const htmlSafety = await evaluate(`(() => {
    const safe=window.safetyProbe.sanitizeRawHtml('<h1>正文</h1><script>parent.pwned=true</script><img src="https://example.invalid"><span data-source-line="999" onclick="alert(1)">text</span>');
    return !/script|img|data-source|onclick/.test(safe) && safe.includes('正文');
  })()`)
  if (!htmlSafety) throw Error('native sanitizer check failed')
  const report = {
    samples: durations.length,
    p95Ms: durations.toSorted((left, right) => left - right)[
      Math.ceil(durations.length * 0.95) - 1
    ],
    maximumMs: Math.max(...durations),
    stalledProcessExitCode: code,
    nativeSanitizerPassed: htmlSafety,
  }
  await writeFile(resolve(directory, 'result.json'), JSON.stringify(report, null, 2))
  console.log(report)
} finally {
  socket?.close()
  renderer?.kill()
  host.kill()
}
