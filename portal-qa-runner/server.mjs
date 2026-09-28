import http from 'node:http'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

const port = Number(process.env.PORT || 10000)
const root = path.resolve('out')

const mime = {
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
}

http.createServer(async (req, res) => {
  let pathname = req.url === '/' ? '/results.json' : req.url
  pathname = pathname.split('?')[0]
  const file = path.resolve(root, '.' + pathname)
  if (!file.startsWith(root)) {
    res.writeHead(403)
    return res.end('forbidden')
  }
  try {
    const data = await readFile(file)
    res.writeHead(200, {
      'content-type': mime[path.extname(file)] || 'application/octet-stream',
      'cache-control': 'no-store',
    })
    res.end(data)
  } catch {
    res.writeHead(404)
    res.end('not found')
  }
}).listen(port, '0.0.0.0', () => {
  console.log(`qa evidence server on ${port}`)
})
