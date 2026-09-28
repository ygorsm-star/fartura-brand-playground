import{chromium}from'playwright';import fs from'node:fs/promises';
const b=(process.env.BASE_URL||'').replace(/\/+$/,''),s=process.env.SHARE_URL||'',x=process.env.EXPECTED_SHA||'';
const t=new URL(s).searchParams.get('_vercel_share');if(!b||!t||!x)throw Error('env missing');
const B=await chromium.launch({headless:true,args:['--no-sandbox']}),C=await B.newContext({locale:'pt-BR'}),p=await C.newPage(),R={pass:false,target:b,expectedSha:x,checks:{}};
async function j(path,init={}){return await p.evaluate(async a=>{const r=await fetch(a.path,{...a.init,credentials:'include',cache:'no-store'});let body=null;try{body=await r.json()}catch{}return{status:r.status,body}}, {path,init})}
try{
 const pe=[];p.on('pageerror',e=>pe.push(e.message));
 const u=b+'/login?t=portal&surface=demo&as=produtor&_vercel_share='+encodeURIComponent(t);
 const rr=await p.goto(u,{waitUntil:'domcontentloaded',timeout:120000});await p.waitForTimeout(1500);
 R.checks.shareEntryStatus=rr?.status()??null;R.checks.shareEntryFinalUrl=p.url();
 if(p.url().includes('vercel.com/sso-api'))throw Error('share not established');
 await p.waitForSelector('#email',{timeout:30000});await p.waitForSelector('#password',{timeout:30000});
 const email=await p.locator('#email').inputValue(),password=await p.locator('#password').inputValue();
 R.checks.demoFixtureEmail=email;R.checks.demoEmailDomain=/@demo\.portal\.local$/i.test(email);R.checks.demoPasswordPrefilled=password.length>0;
 const h=await j('/api/health');Object.assign(R.checks,{healthStatus:h.status,releaseSha:h.body?.release?.sha??null,lock:h.body?.lock??null,tenants:h.body?.tenants??null,storeFingerprint:h.body?.storeFingerprint??null,runtimeGate:h.body?.runtimeGate??null});
 if(h.status!==200||h.body?.release?.sha!==x||h.body?.lock!=='portal'||!Array.isArray(h.body?.tenants)||h.body.tenants.length!==1||h.body.tenants[0]!=='portal')throw Error('health/provenance mismatch');
 if(!R.checks.demoEmailDomain||!R.checks.demoPasswordPrefilled)throw Error('demo preset unavailable');
 const l=await j('/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password,tenantId:'portal'})});
 R.checks.loginStatus=l.status;if(l.status!==200||l.body?.redirect!=='/portal')throw Error('login '+l.status);
 const ck=await C.cookies(b),sc=ck.find(c=>c.httpOnly&&c.value&&c.expires!==0&&!/^_vercel_/i.test(c.name));R.checks.sessionCookie=!!sc;R.checks.sessionHttpOnly=!!sc?.httpOnly;if(!sc)throw Error('session missing');
 await p.goto(b+'/portal',{waitUntil:'domcontentloaded',timeout:120000});await p.waitForTimeout(1000);if(!p.url().startsWith(b+'/portal'))throw Error('portal redirect');
 const links=p.locator('a[href^="/portal/talhao/"]');R.checks.fieldLinkCount=await links.count();if(R.checks.fieldLinkCount<1)throw Error('no fields');
 await p.reload({waitUntil:'domcontentloaded',timeout:120000});await p.waitForTimeout(500);R.checks.sessionPersisted=p.url().startsWith(b+'/portal');if(!R.checks.sessionPersisted)throw Error('session reload');
 const href=await p.locator('a[href^="/portal/talhao/"]').first().getAttribute('href');if(!href)throw Error('field href');
 await p.goto(b+href,{waitUntil:'domcontentloaded',timeout:120000});await p.waitForTimeout(500);R.checks.fieldOpened=p.url().includes('/portal/talhao/');if(!R.checks.fieldOpened)throw Error('field open');
 const o=await j('/api/auth/logout',{method:'POST'});R.checks.logoutStatus=o.status;if(o.status!==200)throw Error('logout '+o.status);
 R.checks.sessionRemoved=!(await C.cookies(b)).some(c=>c.name===sc.name&&c.value);if(!R.checks.sessionRemoved)throw Error('cookie remains');
 await p.goto(b+'/portal',{waitUntil:'domcontentloaded',timeout:120000});await p.waitForTimeout(700);R.checks.protectedAfterLogout=p.url().includes('/login');if(!R.checks.protectedAfterLogout)throw Error('post logout '+p.url());
 R.checks.pageErrors=pe;if(pe.length)throw Error('page errors '+pe.join('|'));R.pass=true;await fs.writeFile('auth-result.json',JSON.stringify(R,null,2));console.log(JSON.stringify(R));
}catch(e){R.error=String(e?.stack||e);await fs.writeFile('auth-result.json',JSON.stringify(R,null,2));console.error(JSON.stringify(R));process.exitCode=2}finally{await B.close()}
