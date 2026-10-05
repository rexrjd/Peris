import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Produce one portable file from the same production bundle as the hosted game.
// File previews expose solo/practice; multiplayer requires the hosted project.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = path.join(root, 'dist')
const target = path.resolve(process.argv[2] || path.join(root, 'standalone', 'Peris-v6-playable.html'))
const mime = { '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' }

async function inlineAsset(url) {
  if (/^(data:|https?:|#)/.test(url)) return url
  const file = path.resolve(dist, url.replace(/^\//, ''))
  if (!file.startsWith(dist + path.sep)) throw new Error(`Asset outside build: ${url}`)
  const bytes = await fs.readFile(file)
  return `data:${mime[path.extname(file)] || 'application/octet-stream'};base64,${bytes.toString('base64')}`
}

let html = await fs.readFile(path.join(dist, 'index.html'), 'utf8')
const cssLinks = [...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g)]
for (const [tag, url] of cssLinks) {
  let css = await fs.readFile(path.join(dist, url.replace(/^\//, '')), 'utf8')
  const assets = [...new Set([...css.matchAll(/url\(\s*['"]?([^'"\)]+)['"]?\s*\)/g)].map(m => m[1]))]
  for (const asset of assets) css = css.split(asset).join(await inlineAsset(asset))
  html = html.replace(tag, () => `<style>${css.replace(/<\/style/gi, '<\\/style')}</style>`)
}
const scripts = [...html.matchAll(/<script\b[^>]*src="([^"]+)"[^>]*><\/script>/g)]
for (const [tag, url] of scripts) {
  const js = await fs.readFile(path.join(dist, url.replace(/^\//, '')), 'utf8')
  html = html.replace(tag, () => `<script type="module">${js.replace(/<\/script/gi, '<\\/script')}</script>`)
}
html = html.replace(/<link\b[^>]*rel="modulepreload"[^>]*>/g, '')
const favicon = html.match(/<link\b[^>]*rel="icon"[^>]*href="([^"]+)"[^>]*>/)
if (favicon) {
  const icon = await inlineAsset(favicon[1])
  html = html.replace(favicon[0], () => favicon[0].replace(favicon[1], () => icon))
}
await fs.mkdir(path.dirname(target), { recursive: true })
await fs.writeFile(target, html)
console.log(`Standalone ready: ${target} (${(Buffer.byteLength(html) / 1024 / 1024).toFixed(2)} MB)`)
