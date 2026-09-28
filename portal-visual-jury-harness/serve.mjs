import http from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'

const root = normalize(join(process.cwd(), 'public'))
const types = {
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.html': 'text/html; charset=utf-8',
}

http.createServer(async (req, res) => {
  try {
    const raw = req.url === '/' ? '/index.html' : (req.url || '/index.html').split('?')[0]
    const file = normalize(join(root, raw))
    if (!file.startsWith(root)) throw new Error('bad path')
    const info = await stat(file)
    if (!info.isFile()) throw new Error('not a file')
    const data = await readFile(file)
    res.writeHead(200, {
      'content-type': types[extname(file)] || 'application/octet-stream',
      'cache-control': 'no-store',
    })
    res.end(data)
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('not found')
  }
}).listen(Number(process.env.PORT || 10000), '0.0.0.0')
