import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'

const target = process.env.TARGET_URL?.trim()
const expectedSha = process.env.EXPECTED_SHA?.trim() || null
if (!target) throw new Error('TARGET_URL missing')

const targetUrl = new URL(target)
const publicTarget = `${targetUrl.protocol}//${targetUrl.host}${targetUrl.pathname}`

const viewports = [
  ['mobile-390', 390, 844],
  ['mobile-430', 430, 932],
  ['tablet-820', 820, 1180],
  ['desktop-1440', 1440, 900],
]

await mkdir('public', { recursive: true })
const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})
const results = []

try {
  for (const [name, width, height] of viewports) {
    const mobile = name !== 'desktop-1440'
    const context = await browser.newContext({
      viewport: { width, height },
      locale: 'pt-BR',
      isMobile: mobile,
      hasTouch: mobile,
      deviceScaleFactor: 1,
    })
    const page = await context.newPage()
    const consoleErrors = []
    const pageErrors = []
    const failedRequests = []
    const badResponses = []
    const workers = []

    page.on('console', async (message) => {
      const text = message.text()
      if (message.type() === 'error' && !/vercel\.live|analytics|speed-insights/i.test(text)) {
        const args = await Promise.all(
          message.args().map(async (arg) => {
            try {
              return await arg.evaluate((value) => {
                if (value instanceof Error) {
                  return {
                    kind: 'Error',
                    name: value.name,
                    message: value.message,
                    stack: value.stack ?? null,
                  }
                }
                if (value && typeof value === 'object') {
                  return {
                    kind: 'object',
                    name: 'name' in value ? String(value.name) : null,
                    message: 'message' in value ? String(value.message) : null,
                    stack: 'stack' in value ? String(value.stack) : null,
                    string: String(value),
                  }
                }
                return { kind: typeof value, string: String(value) }
              })
            } catch {
              return { kind: 'unserializable' }
            }
          }),
        )
        consoleErrors.push({
          text,
          location: message.location(),
          args,
        })
      }
    })
    page.on('pageerror', (error) => pageErrors.push(error.message))
    page.on('requestfailed', (request) => {
      const url = request.url()
      if (!/vercel\.live|analytics|speed-insights|favicon/i.test(url)) {
        failedRequests.push({
          url: url.replace(/([?&]_vercel_share=)[^&]+/g, '$1<redacted>'),
          error: request.failure()?.errorText ?? 'request failed',
          type: request.resourceType(),
        })
      }
    })
    page.on('response', (response) => {
      const status = response.status()
      if (status >= 300) {
        const url = response.url()
        if (!/vercel\.live|analytics|speed-insights|favicon/i.test(url)) {
          badResponses.push({
            status,
            url: url.replace(/([?&]_vercel_share=)[^&]+/g, '$1<redacted>'),
            type: response.request().resourceType(),
          })
        }
      }
    })
    page.on('worker', (worker) => {
      const url = worker.url()
      workers.push(url.replace(/([?&]_vercel_share=)[^&]+/g, '$1<redacted>'))
    })

    // The share token is consumed only by the browser to establish the Preview cookie.
    await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.waitForTimeout(2_000)

    if (/vercel\.com\/sso-api/.test(page.url())) {
      throw new Error(`${name}: stuck on Vercel SSO`)
    }

    const health = await page.evaluate(async () => {
      const response = await fetch('/api/health', { cache: 'no-store' })
      return {
        status: response.status,
        json: await response.json().catch(() => null),
      }
    })
    if (health.status !== 200) throw new Error(`${name}: /api/health=${health.status}`)
    const healthSha = health.json?.release?.sha ?? null
    if (expectedSha && healthSha !== expectedSha) {
      throw new Error(`${name}: release SHA ${healthSha} != ${expectedSha}`)
    }

    // Re-open without the share query; the Vercel bypass cookie remains in this context.
    await page.goto(publicTarget, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.waitForTimeout(2_000)

    const heroGlobe = page.locator('[data-hero-globe]')
    const liveBadge = page.locator('[data-hero-live]')
    const secondGlobe = page.locator('[data-geo-globe]')
    const geoMap = page.locator('[data-geo-map]')
    const h1 = page.locator('h1').first()

    const cleanEntryCounts = {
      heroCopy: await page.locator('[data-hero-copy]').count(),
      heroProof: await page.locator('[data-hero-proof]').count(),
      heroDock: await page.locator('[data-hero-dock]').count(),
      sequenceLabel: await page.locator('[data-hero-sequence-label]').count(),
      scrollHint: await page.locator('[data-story-scroll-hint]').count(),
    }

    if (await heroGlobe.count() !== 1) throw new Error(`${name}: hero globe count != 1`)
    if (!(await heroGlobe.isVisible())) throw new Error(`${name}: hero globe invisible`)
    if (await liveBadge.count() !== 1) throw new Error(`${name}: AO VIVO badge count != 1`)
    if (!(await liveBadge.isVisible())) throw new Error(`${name}: AO VIVO invisible`)
    if (!/AO VIVO/i.test(await liveBadge.innerText())) throw new Error(`${name}: AO VIVO text missing`)
    if (await secondGlobe.count() !== 0) throw new Error(`${name}: secondary globe detected`)

    for (const [key, count] of Object.entries(cleanEntryCounts)) {
      if (count !== 0) throw new Error(`${name}: clean entry violation ${key}=${count}`)
    }

    const h1Text = ((await h1.textContent().catch(() => '')) || '').trim()
    if (!/Portal do Produtor.*sua terra agora também digital/i.test(h1Text)) {
      throw new Error(`${name}: semantic H1 missing`)
    }

    const heroBox = await heroGlobe.boundingBox()
    if (!heroBox || heroBox.width < width * 0.30 || heroBox.height < height * 0.25) {
      throw new Error(`${name}: hero globe is too small`)
    }

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      scrollHeight: document.documentElement.scrollHeight,
    }))
    if (overflow.scrollWidth > overflow.viewportWidth + 1) {
      throw new Error(`${name}: horizontal overflow ${overflow.scrollWidth - overflow.viewportWidth}px`)
    }

    await page.screenshot({ path: `public/${name}-full.png`, fullPage: true })

    const hero = page.locator('[data-hero-product-scene]').first()
    if (await hero.count()) await hero.screenshot({ path: `public/${name}-hero.png` })

    const geo = page.locator('[data-agro-geo]').first()
    if (await geo.count() !== 1) throw new Error(`${name}: geospatial section missing`)
    await geo.scrollIntoViewIfNeeded()
    await page.waitForTimeout(800)

    if (await geoMap.count() !== 1) throw new Error(`${name}: geo map count != 1`)
    if (!(await geoMap.isVisible())) throw new Error(`${name}: geo map invisible`)
    await geoMap.screenshot({ path: `public/${name}-map.png` })

    if (pageErrors.length || consoleErrors.length) {
      console.error(JSON.stringify({
        visualJuryDiagnostic: true,
        name,
        pageErrors,
        consoleErrors,
        failedRequests,
        badResponses,
        workers,
        cookieNames: (await context.cookies()).map((cookie) => cookie.name).sort(),
      }))
    }
    if (pageErrors.length) throw new Error(`${name}: page errors: ${pageErrors.join(' | ')}`)
    if (consoleErrors.length) throw new Error(`${name}: console errors: ${JSON.stringify(consoleErrors)}`)

    results.push({
      name,
      width,
      height,
      h1: h1Text,
      healthStatus: health.status,
      healthSha,
      heroGlobe: 1,
      liveBadge: 1,
      secondGlobe: 0,
      cleanEntryCounts,
      geoMap: 1,
      overflow,
      consoleErrors,
      pageErrors,
      failedRequests,
      badResponses,
      workers,
      screenshots: {
        hero: `${name}-hero.png`,
        map: `${name}-map.png`,
        full: `${name}-full.png`,
      },
    })

    await context.close()
  }
} finally {
  await browser.close()
}

await writeFile(
  'public/report.json',
  JSON.stringify({
    ok: true,
    targetHost: targetUrl.host,
    targetPath: targetUrl.pathname,
    expectedSha,
    results,
  }, null, 2),
)

await writeFile(
  'public/index.html',
  '<meta charset="utf-8"><pre id="o">loading...</pre><script>fetch("./report.json").then(r=>r.json()).then(x=>o.textContent=JSON.stringify(x,null,2))</script>',
)

console.log(JSON.stringify({
  ok: true,
  expectedSha,
  results: results.map((item) => ({
    name: item.name,
    healthSha: item.healthSha,
    h1: item.h1,
    cleanEntryCounts: item.cleanEntryCounts,
    overflow: item.overflow,
  })),
}))
