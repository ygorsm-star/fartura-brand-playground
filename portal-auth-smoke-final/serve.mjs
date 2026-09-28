import http from 'node:http'
import { readFile } from 'node:fs/promises'
const port=Number(process.env.PORT||10000)
http.createServer(async (_req,res)=>{
  try{
    const body=await readFile('auth-result.json')
    res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'})
    res.end(body)
  }catch{
    res.writeHead(503,{'content-type':'application/json'})
    res.end(JSON.stringify({ready:false}))
  }
}).listen(port,'0.0.0.0')
