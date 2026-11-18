import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

export const samples = {
  prose: '# 中文与 English\n\n一段可复现的测试文字，包含 Emoji 😀 与标点。\n\n',
  code: '# Code\n\n```ts\nconst greeting: string = "你好 😀"\nconsole.log(greeting)\n```\n\n',
  mixed:
    '# 图表与图片\n\n![图标](./sample.svg)\n\n```mermaid\nflowchart LR\n  A[开始] --> B[完成]\n```\n\n$$x^2 + y^2 = z^2$$\n\n',
}

export function makeFixture(kind, byteLength) {
  const sample = Buffer.from(samples[kind] ?? '', 'utf8')
  if (!sample.length || !Number.isSafeInteger(byteLength) || byteLength < sample.length) {
    throw new Error('Invalid fixture kind or size')
  }
  const output = Buffer.alloc(byteLength, 0x20)
  output.fill(sample, 0, byteLength - (byteLength % sample.length))
  return output
}

export async function generateFixtures(directory) {
  await mkdir(directory, { recursive: true })
  await copyFile(
    new URL('../src/assets/studio.svg', import.meta.url),
    resolve(directory, 'sample.svg'),
  )
  for (const size of [1, 5, 10]) {
    for (const kind of Object.keys(samples)) {
      await writeFile(
        resolve(directory, `${kind}-${size}MiB.md`),
        makeFixture(kind, size * 1024 ** 2),
      )
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = fileURLToPath(new URL('../.tmp/fixtures/', import.meta.url))
  await generateFixtures(directory)
  console.log(`Generated nine synthetic fixtures in ${directory}`)
}
