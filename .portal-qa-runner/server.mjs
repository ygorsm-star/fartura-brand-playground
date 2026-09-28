import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import process from 'node:process'

const root = new URL('./out/', import.meta.url).pathname
const port = Number(process.env.PORT || 10000)

const types = {
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', 'http://localhost')
    let path = decodeURIComponent(url.pathname)
    if (path === '/') path = '/summary.json'
    const safe = normalize(path).replace(/^([.][.][/\\])+/, '')
    const file = join(root, safe)
    const info = await stat(file)
    if (!info.isFile()) throw new Error('not file')
    const body = await readFile(file)
    res.writeHead(200, {
      'content-type': types[extname(file)] || 'application/octet-stream',
      'cache-control': 'no-store',
    })
    res.end(body)
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('not found')
  }
}).listen(port, '0.0.0.0', () => {
  console.log(`visual jury evidence server on ${port}`)
})
