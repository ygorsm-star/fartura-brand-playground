import http from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'

const port = Number(process.env.PORT || 10000)
const root = join(process.cwd(), 'evidence')
const mime = { '.json':'application/json; charset=utf-8', '.png':'image/png' }

http.createServer(async (req, res) => {
  try {
    const requested = req.url === '/' ? '/report.json' : req.url.split('?')[0]
    const safe = normalize(requested).replace(/^([.][.][/\\])+/, '')
    const file = join(root, safe)
    if (!file.startsWith(root)) throw new Error('invalid path')
    await stat(file)
    const body = await readFile(file)
    res.writeHead(200, {
      'content-type': mime[extname(file)] || 'application/octet-stream',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex',
    })
    res.end(body)
  } catch {
    res.writeHead(404, { 'content-type':'text/plain' })
    res.end('not found')
  }
}).listen(port, '0.0.0.0')
