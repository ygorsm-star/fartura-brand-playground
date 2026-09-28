import { chromium } from 'playwright'
import { writeFile } from 'node:fs/promises'

const base=(process.env.BASE_URL||'').replace(/\/+$/,'')
const shareUrl=process.env.SHARE_URL||''
const expectedSha=process.env.EXPECTED_SHA||''
const share=new URL(shareUrl).searchParams.get('_vercel_share')
if(!base||!share||!expectedSha) throw new Error('QA env missing')

const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']})
const context=await browser.newContext({locale:'pt-BR'})
const page=await context.newPage()
const result={pass:false,targetHost:new URL(base).host,expectedSha,checks:{}}

async function sameOrigin(path,init={}){
  return await page.evaluate(async ({path,init})=>{
    const response=await fetch(path,{...init,credentials:'include',cache:'no-store'})
    let body=null
    try{body=await response.json()}catch{}
    return{status:response.status,body}
  },{path,init})
}

try{
  const pageErrors=[]
  page.on('pageerror',error=>pageErrors.push(error.message))

  const loginShare=base+'/login?t=portal&surface=demo&as=produtor&_vercel_share='+encodeURIComponent(share)
  const entry=await page.goto(loginShare,{waitUntil:'domcontentloaded',timeout:120000})
  await page.waitForTimeout(1500)

  result.checks.shareEntryStatus=entry?.status()??null
  result.checks.shareEstablished=!page.url().includes('vercel.com/sso-api')
  if(!result.checks.shareEstablished) throw new Error('Vercel share access not established')

  await page.waitForSelector('#email',{timeout:30000})
  await page.waitForSelector('#password',{timeout:30000})

  const preset=await page.evaluate(()=>{
    const email=document.querySelector('#email')
    const password=document.querySelector('#password')
    return{
      demoEmail:Boolean(email && typeof email.value==='string' && /@demo\.portal\.local$/i.test(email.value)),
      passwordPresent:Boolean(password && typeof password.value==='string' && password.value.length>0),
    }
  })
  result.checks.demoEmailDomain=preset.demoEmail
  result.checks.demoPasswordPrefilled=preset.passwordPresent
  if(!preset.demoEmail||!preset.passwordPresent) throw new Error('Demo preset unavailable')

  const health=await sameOrigin('/api/health')
  result.checks.healthStatus=health.status
  result.checks.releaseSha=health.body?.release?.sha??null
  result.checks.lock=health.body?.lock??null
  result.checks.tenants=health.body?.tenants??null
  result.checks.storeFingerprintPresent=Boolean(health.body?.storeFingerprint)
  result.checks.runtimeGate=health.body?.runtimeGate??null

  if(health.status!==200) throw new Error('Health status '+health.status)
  if(health.body?.release?.sha!==expectedSha) throw new Error('Release SHA mismatch')
  if(health.body?.lock!=='portal') throw new Error('Tenant lock mismatch')
  if(!Array.isArray(health.body?.tenants)||health.body.tenants.length!==1||health.body.tenants[0]!=='portal'){
    throw new Error('Tenant surface mismatch')
  }

  const submit=page.locator('button[type="submit"]').first()
  await submit.click()
  await page.waitForURL(url=>url.href.startsWith(base+'/portal'),{timeout:120000})
  await page.waitForTimeout(900)
  result.checks.loginReachedPortal=true

  const cookies=await context.cookies(base)
  const session=cookies.find(cookie=>cookie.httpOnly&&cookie.value&&cookie.expires!==0&&!/^_vercel_/i.test(cookie.name))
  result.checks.sessionCookie=Boolean(session)
  result.checks.sessionHttpOnly=Boolean(session?.httpOnly)
  if(!session) throw new Error('HttpOnly session cookie missing')

  const fields=page.locator('a[href^="/portal/talhao/"]')
  result.checks.fieldLinkCount=await fields.count()
  if(result.checks.fieldLinkCount<1) throw new Error('No field link after login')

  await page.reload({waitUntil:'domcontentloaded',timeout:120000})
  await page.waitForTimeout(500)
  result.checks.sessionPersisted=page.url().startsWith(base+'/portal')
  if(!result.checks.sessionPersisted) throw new Error('Session did not persist after reload')

  const href=await page.locator('a[href^="/portal/talhao/"]').first().getAttribute('href')
  if(!href) throw new Error('Field href missing')
  await page.goto(base+href,{waitUntil:'domcontentloaded',timeout:120000})
  await page.waitForTimeout(500)
  result.checks.fieldOpened=page.url().includes('/portal/talhao/')
  if(!result.checks.fieldOpened) throw new Error('Field did not open')

  const logout=await sameOrigin('/api/auth/logout',{method:'POST'})
  result.checks.logoutStatus=logout.status
  if(logout.status!==200) throw new Error('Logout status '+logout.status)

  const afterLogout=await context.cookies(base)
  result.checks.sessionRemoved=!afterLogout.some(cookie=>cookie.name===session.name&&cookie.value)
  if(!result.checks.sessionRemoved) throw new Error('Session cookie remained after logout')

  await page.goto(base+'/portal',{waitUntil:'domcontentloaded',timeout:120000})
  await page.waitForTimeout(700)
  result.checks.protectedAfterLogout=page.url().includes('/login')
  if(!result.checks.protectedAfterLogout) throw new Error('Portal not protected after logout')

  result.checks.pageErrors=pageErrors
  if(pageErrors.length) throw new Error('Page errors detected')

  result.pass=true
  await writeFile('auth-result.json',JSON.stringify(result,null,2))
  console.log(JSON.stringify(result))
}catch(error){
  result.error=String(error?.stack||error)
  await writeFile('auth-result.json',JSON.stringify(result,null,2))
  console.error(JSON.stringify(result))
  process.exitCode=2
}finally{
  await browser.close()
}
