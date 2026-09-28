import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'

const shareUrl = process.env.TARGET_SHARE_URL?.trim()
const expectedSha = process.env.EXPECTED_SHA?.trim()
if (!shareUrl) throw new Error('TARGET_SHARE_URL ausente')
if (!expectedSha) throw new Error('EXPECTED_SHA ausente')

const parsed = new URL(shareUrl)
const baseUrl = `${parsed.protocol}//${parsed.host}`
const outDir = new URL('./out/', import.meta.url).pathname
await mkdir(outDir, { recursive: true })

const viewports = [
  { name: 'mobile-390', width: 390, height: 844, mobile: true },
  { name: 'mobile-430', width: 430, height: 932, mobile: true },
  { name: 'tablet-820', width: 820, height: 1180, mobile: true },
  { name: 'desktop-1440', width: 1440, height: 900, mobile: false },
]

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})

const summary = {
  ok: false,
  expectedSha,
  baseUrl,
  generatedAt: new Date().toISOString(),
  viewports: [],
}

try {
  for (const vp of viewports) {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      isMobile: vp.mobile,
      hasTouch: vp.mobile,
      locale: 'pt-BR',
      deviceScaleFactor: 1,
    })

    const page = await context.newPage()
    const consoleErrors = []
    const pageErrors = []
    const failedRequests = []

    page.on('console', msg => {
      if (msg.type() === 'error' && !/vercel\.live|analytics|speed-insights/i.test(msg.text())) {
        consoleErrors.push(msg.text())
      }
    })
    page.on('pageerror', err => pageErrors.push(err.message))
    page.on('requestfailed', req => {
      const url = req.url()
      if (!/vercel\.live|analytics|speed-insights|favicon/i.test(url)) {
        failedRequests.push(`${req.failure()?.errorText ?? 'request failed'} :: ${url}`)
      }
    })

    // Primeiro acesso usa o share token para o Vercel gravar o cookie de bypass.
    await page.goto(shareUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.waitForTimeout(1200)

    // Prova de proveniência do deployment.
    const health = await page.evaluate(async () => {
      const response = await fetch('/api/health', { cache: 'no-store' })
      return { status: response.status, json: await response.json().catch(() => null) }
    })
    assert(health.status === 200, `${vp.name}: /api/health status ${health.status}`)
    assert(health.json?.release?.sha === expectedSha, `${vp.name}: SHA divergente em /api/health`)

    await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.waitForTimeout(1600)

    const heroGlobe = page.locator('[data-hero-globe]')
    assert(await heroGlobe.count() === 1, `${vp.name}: esperado exatamente 1 data-hero-globe`)
    assert(await heroGlobe.isVisible(), `${vp.name}: globo do hero invisível`)

    const live = page.locator('[data-hero-live]')
    assert(await live.count() === 1, `${vp.name}: badge AO VIVO ausente`)
    assert(await live.isVisible(), `${vp.name}: badge AO VIVO invisível`)
    const liveText = (await live.innerText()).trim().toUpperCase()
    assert(liveText.includes('AO VIVO'), `${vp.name}: texto AO VIVO ausente`)

    const secondGlobe = page.locator('[data-geo-globe]')
    assert(await secondGlobe.count() === 0, `${vp.name}: segundo globo detectado`)

    const heroBox = await heroGlobe.boundingBox()
    assert(heroBox && heroBox.width > vp.width * 0.32, `${vp.name}: globo pequeno demais`)
    assert(heroBox && heroBox.height > vp.height * 0.28, `${vp.name}: globo baixo demais`)

    await page.screenshot({
      path: join(outDir, `${vp.name}-hero.png`),
      fullPage: false,
    })

    const geo = page.locator('[data-agro-geo]')
    assert(await geo.count() === 1, `${vp.name}: seção geoespacial ausente`)
    await geo.scrollIntoViewIfNeeded()
    await page.waitForTimeout(900)

    const map = page.locator('[data-geo-map]')
    assert(await map.count() === 1, `${vp.name}: mapa geoespacial ausente`)
    assert(await map.isVisible(), `${vp.name}: mapa geoespacial invisível`)
    await map.screenshot({ path: join(outDir, `${vp.name}-map.png`) })

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    }))
    assert(
      overflow.scrollWidth <= overflow.viewportWidth + 2,
      `${vp.name}: overflow horizontal de ${overflow.scrollWidth - overflow.viewportWidth}px`,
    )

    const before = await page.evaluate(() => window.scrollY)
    const mapBox = await map.boundingBox()
    if (mapBox) {
      const x = Math.min(Math.max(mapBox.x + mapBox.width / 2, 1), vp.width - 2)
      const y = Math.min(Math.max(mapBox.y + Math.min(mapBox.height / 2, vp.height / 2), 1), vp.height - 2)
      await page.mouse.move(x, y)
      await page.mouse.wheel(0, 360)
      await page.waitForTimeout(180)
      const after = await page.evaluate(() => window.scrollY)
      assert(after > before, `${vp.name}: wheel normal ficou preso no mapa`)
    }

    await page.screenshot({
      path: join(outDir, `${vp.name}-full.png`),
      fullPage: true,
    })

    assert(pageErrors.length === 0, `${vp.name}: page errors: ${pageErrors.join(' | ')}`)
    assert(consoleErrors.length === 0, `${vp.name}: console errors: ${consoleErrors.join(' | ')}`)

    summary.viewports.push({
      name: vp.name,
      width: vp.width,
      height: vp.height,
      healthSha: health.json?.release?.sha ?? null,
      globe: { visible: true, width: heroBox?.width ?? null, height: heroBox?.height ?? null },
      live: true,
      secondGlobeCount: 0,
      map: true,
      overflow,
      pageErrors,
      consoleErrors,
      failedRequests,
      screenshots: {
        hero: `${vp.name}-hero.png`,
        map: `${vp.name}-map.png`,
        full: `${vp.name}-full.png`,
      },
    })

    await context.close()
  }

  summary.ok = true
  await writeFile(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2))
  console.log(JSON.stringify({ ok: true, viewports: summary.viewports.map(v => v.name), expectedSha }))
} catch (error) {
  summary.error = String(error?.message ?? error)
  await writeFile(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2))
  console.error(error)
  process.exitCode = 1
} finally {
  await browser.close()
}
