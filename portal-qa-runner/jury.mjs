import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const base = process.env.PREVIEW_URL?.trim()
const share = process.env.VERCEL_SHARE?.trim()
const expectedSha = process.env.EXPECTED_SHA?.trim()
if (!base || !share || !expectedSha) {
  throw new Error('missing PREVIEW_URL/VERCEL_SHARE/EXPECTED_SHA')
}

await mkdir('out', { recursive: true })

const viewports = [
  ['mobile-390', 390, 844, true],
  ['mobile-430', 430, 932, true],
  ['tablet-820', 820, 1180, true],
  ['desktop-1440', 1440, 900, false],
]

const browser = await chromium.launch({ headless: true })
const results = []

try {
  for (const [name, width, height, isMobile] of viewports) {
    const context = await browser.newContext({
      viewport: { width, height },
      isMobile,
      hasTouch: isMobile,
      locale: 'pt-BR',
    })
    const page = await context.newPage()

    const consoleErrors = []
    const pageErrors = []
    const failedRequests = []
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })
    page.on('pageerror', (error) => pageErrors.push(error.message))
    page.on('requestfailed', (request) => {
      if (!/vercel\.live|analytics|speed-insights/i.test(request.url())) {
        failedRequests.push(
          `${request.failure()?.errorText ?? 'failed'} :: ${request.url()}`,
        )
      }
    })

    const response = await page.goto(
      `${base}/?_vercel_share=${encodeURIComponent(share)}`,
      { waitUntil: 'domcontentloaded', timeout: 120_000 },
    )
    await page.waitForTimeout(3500)

    if (/vercel\.com\/sso-api/i.test(page.url())) {
      throw new Error(`${name}: Vercel SSO interceptou o Preview`)
    }
    if (!response || response.status() >= 400) {
      throw new Error(`${name}: homepage HTTP ${response?.status() ?? 'no-response'}`)
    }

    const heroGlobe = page.locator('[data-hero-globe]')
    const secondaryGlobe = page.locator('[data-geo-globe]')
    const live = page.locator('[data-hero-live]')
    const h1 = page.getByRole('heading', { level: 1 }).first()
    const map = page.locator('[data-geo-map]')

    const heroGlobeCount = await heroGlobe.count()
    const secondaryGlobeCount = await secondaryGlobe.count()
    const liveVisible = await live.isVisible()
    const h1Text = (await h1.textContent())?.trim() ?? ''

    if (heroGlobeCount !== 1) throw new Error(`${name}: hero globe count != 1`)
    if (secondaryGlobeCount !== 0) throw new Error(`${name}: secondary globe exists`)
    if (!liveVisible) throw new Error(`${name}: AO VIVO not visible`)
    if (!/Sua terra\.\s*Agora também digital\./i.test(h1Text)) {
      throw new Error(`${name}: H1 inesperado: ${h1Text}`)
    }

    await page.screenshot({
      path: path.join('out', `${name}-hero.png`),
      fullPage: false,
    })

    await map.scrollIntoViewIfNeeded()
    await page.waitForTimeout(900)
    const mapVisible = await map.isVisible()
    if (!mapVisible) throw new Error(`${name}: map not visible`)

    await map.screenshot({ path: path.join('out', `${name}-map.png`) })

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    }))
    if (overflow.scrollWidth > overflow.viewportWidth + 1) {
      throw new Error(
        `${name}: horizontal overflow ${overflow.scrollWidth - overflow.viewportWidth}px`,
      )
    }

    const before = await page.evaluate(() => window.scrollY)
    const box = await map.boundingBox()
    if (box) {
      await page.mouse.move(
        Math.min(box.x + box.width / 2, width - 2),
        Math.min(box.y + Math.min(box.height / 2, height / 2), height - 2),
      )
      await page.mouse.wheel(0, 420)
      await page.waitForTimeout(180)
      const after = await page.evaluate(() => window.scrollY)
      if (after <= before) throw new Error(`${name}: wheel scroll trapped`)
    }

    await page.screenshot({
      path: path.join('out', `${name}-full.png`),
      fullPage: true,
    })

    results.push({
      name,
      width,
      height,
      expectedSha,
      finalUrl: page.url(),
      h1: h1Text,
      heroGlobeCount,
      secondaryGlobeCount,
      liveVisible,
      mapVisible,
      overflow,
      consoleErrors,
      pageErrors,
      failedRequests,
      pass:
        pageErrors.length === 0 &&
        consoleErrors.length === 0 &&
        failedRequests.length === 0,
    })

    await context.close()
  }
} finally {
  await browser.close()
}

const failed = results.filter((result) => !result.pass)
const payload = {
  ok: failed.length === 0,
  expectedSha,
  previewUrl: base,
  results,
}
await writeFile('out/results.json', JSON.stringify(payload, null, 2))

console.log(JSON.stringify({
  ok: payload.ok,
  expectedSha,
  viewports: results.length,
}))

if (failed.length) process.exit(2)
