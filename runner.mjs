import { chromium } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import process from 'node:process'

const target = process.env.PORTAL_JURY_URL?.trim()
if (!target) throw new Error('PORTAL_JURY_URL ausente')

const expectedSha = process.env.PORTAL_JURY_SHA?.trim() || null
const viewports = [
  ['mobile-390', 390, 844],
  ['mobile-430', 430, 932],
  ['tablet-820', 820, 1180],
  ['desktop-1440', 1440, 900],
]

await mkdir('evidence', { recursive: true })
const browser = await chromium.launch({ headless: true })
const report = {
  ok: true,
  target: new URL(target).origin,
  expectedSha,
  generatedAt: new Date().toISOString(),
  viewports: [],
}

try {
  for (const [name, width, height] of viewports) {
    const context = await browser.newContext({
      viewport: { width, height },
      locale: 'pt-BR',
      deviceScaleFactor: 1,
    })
    const page = await context.newPage()
    const consoleErrors = []
    const pageErrors = []
    page.on('console', (msg) => {
      if (msg.type() === 'error' && !/vercel\.live|analytics|speed-insights/i.test(msg.text())) {
        consoleErrors.push(msg.text())
      }
    })
    page.on('pageerror', (err) => pageErrors.push(err.message))

    const response = await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 120000 })
    await page.waitForTimeout(2500)

    const url = page.url()
    if (/vercel\.com\/sso-api|vercel\.com\/login/i.test(url)) {
      throw new Error(`${name}: Preview redirecionou para SSO: ${url}`)
    }
    if (!response || response.status() >= 400) {
      throw new Error(`${name}: HTTP inválido ${response?.status() ?? 'sem resposta'}`)
    }

    const heroGlobe = page.locator('[data-hero-globe]')
    const live = page.locator('[data-hero-live]')
    const geoGlobe = page.locator('[data-geo-globe]')
    const geoMap = page.locator('[data-geo-map]')
    const h1 = page.getByRole('heading', { level: 1, name: /Sua terra\. Agora também digital\./i })

    const metrics = {
      heroGlobe: await heroGlobe.count(),
      live: await live.count(),
      secondaryGlobe: await geoGlobe.count(),
      geoMap: await geoMap.count(),
      h1: await h1.count(),
      scrollWidth: await page.evaluate(() => document.documentElement.scrollWidth),
      innerWidth: await page.evaluate(() => window.innerWidth),
      consoleErrors,
      pageErrors,
    }

    if (metrics.heroGlobe !== 1) throw new Error(`${name}: hero globe count=${metrics.heroGlobe}`)
    if (metrics.live !== 1) throw new Error(`${name}: AO VIVO ausente`)
    if (metrics.secondaryGlobe !== 0) throw new Error(`${name}: segundo globo detectado`)
    if (metrics.geoMap < 1) throw new Error(`${name}: mapa geoespacial ausente`)
    if (metrics.h1 !== 1) throw new Error(`${name}: H1 canônico ausente`)
    if (metrics.scrollWidth > metrics.innerWidth + 1) {
      throw new Error(`${name}: overflow horizontal ${metrics.scrollWidth - metrics.innerWidth}px`)
    }
    if (pageErrors.length) throw new Error(`${name}: pageerror: ${pageErrors.join(' | ')}`)
    if (consoleErrors.length) throw new Error(`${name}: console error: ${consoleErrors.join(' | ')}`)

    await page.screenshot({ path: `evidence/${name}-full.png`, fullPage: true })
    await heroGlobe.screenshot({ path: `evidence/${name}-hero.png` })
    await geoMap.scrollIntoViewIfNeeded()
    await page.waitForTimeout(500)
    await geoMap.screenshot({ path: `evidence/${name}-map.png` })

    report.viewports.push({ name, width, height, ...metrics, finalUrl: url, pass: true })
    await context.close()
  }
} catch (error) {
  report.ok = false
  report.error = error instanceof Error ? error.message : String(error)
  throw error
} finally {
  await browser.close()
  await writeFile('evidence/report.json', JSON.stringify(report, null, 2))
}
