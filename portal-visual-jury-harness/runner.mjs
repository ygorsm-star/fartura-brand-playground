import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'

const target = process.env.TARGET_URL?.trim()
if (!target) throw new Error('TARGET_URL missing')

const viewports = [
  ['mobile-390', 390, 844],
  ['mobile-430', 430, 932],
  ['tablet-820', 820, 1180],
  ['desktop-1440', 1440, 900],
]

await mkdir('public', { recursive: true })
const browser = await chromium.launch({ headless: true })
const results = []

try {
  for (const [name, width, height] of viewports) {
    const mobile = name !== 'desktop-1440'
    const context = await browser.newContext({
      viewport: { width, height },
      locale: 'pt-BR',
      isMobile: mobile,
      hasTouch: mobile,
    })
    const page = await context.newPage()
    const consoleErrors = []
    const pageErrors = []

    page.on('console', (message) => {
      const text = message.text()
      if (message.type() === 'error' && !/vercel\.live|analytics|speed-insights/i.test(text)) {
        consoleErrors.push(text)
      }
    })
    page.on('pageerror', (error) => pageErrors.push(error.message))

    await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.waitForTimeout(4_000)

    const finalUrl = page.url()
    if (/vercel\.com\/sso-api/.test(finalUrl)) {
      throw new Error(`${name}: stuck on Vercel SSO`)
    }

    const heroGlobe = await page.locator('[data-hero-globe]').count()
    const liveBadge = await page.locator('[data-hero-live]').count()
    const secondGlobe = await page.locator('[data-geo-globe]').count()
    const geoMap = await page.locator('[data-geo-map]').count()
    const h1 = ((await page.locator('h1').first().textContent().catch(() => '')) || '').trim()
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      scrollHeight: document.documentElement.scrollHeight,
    }))

    if (heroGlobe !== 1) throw new Error(`${name}: heroGlobe=${heroGlobe}`)
    if (liveBadge !== 1) throw new Error(`${name}: liveBadge=${liveBadge}`)
    if (secondGlobe !== 0) throw new Error(`${name}: secondGlobe=${secondGlobe}`)
    if (geoMap !== 1) throw new Error(`${name}: geoMap=${geoMap}`)
    if (overflow.scrollWidth > overflow.viewportWidth + 1) {
      throw new Error(`${name}: horizontal overflow ${overflow.scrollWidth - overflow.viewportWidth}px`)
    }

    await page.screenshot({ path: `public/${name}-full.png`, fullPage: true })

    const hero = page.locator('[data-hero-product-scene]').first()
    if (await hero.count()) {
      await hero.screenshot({ path: `public/${name}-hero.png` })
    }

    const map = page.locator('[data-geo-map]').first()
    await map.scrollIntoViewIfNeeded()
    await page.waitForTimeout(800)
    await map.screenshot({ path: `public/${name}-map.png` })

    results.push({
      name,
      width,
      height,
      finalUrl,
      h1,
      heroGlobe,
      liveBadge,
      secondGlobe,
      geoMap,
      overflow,
      consoleErrors,
      pageErrors,
    })

    await context.close()
  }
} finally {
  await browser.close()
}

await writeFile(
  'public/report.json',
  JSON.stringify({ ok: true, target, results }, null, 2),
)

await writeFile(
  'public/index.html',
  '<meta charset="utf-8"><pre id="o">loading...</pre><script>fetch("./report.json").then(r=>r.json()).then(x=>o.textContent=JSON.stringify(x,null,2))</script>',
)

console.log(JSON.stringify({
  ok: true,
  results: results.map((item) => ({
    name: item.name,
    h1: item.h1,
    overflow: item.overflow,
  })),
}))
