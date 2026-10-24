import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { readFile } from 'node:fs/promises'

async function openWorkspace(page) {
  await page.goto('/')
  await expect(page.getByText('Historical Elexon data', { exact: true })).toBeVisible()
  await expect(page.getByText('Average forecast wind', { exact: true })).toBeVisible()
}

async function assertFits(page) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
  ).toBeTruthy()
}

const inspector = (page) => page.getByRole('complementary', { name: 'Interval detail' })
const display = (page) => page.getByRole('group', { name: 'Forecast display' })
const format = (value) => Math.round(value).toLocaleString('en-GB')

async function capture(page, testInfo, suffix = 'forecast') {
  await page.mouse.move(0, 0)
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({
    path: `../artifacts/windwatch-${testInfo.project.name}-${suffix}.png`,
    fullPage: true,
  })
}

test('forecast profile, unit selection and explicit hindsight', async ({ page }, testInfo) => {
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await openWorkspace(page)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Day-ahead wind forecast')
  await expect(page.getByLabel('Show hindsight actuals')).not.toBeChecked()
  await expect(page.getByText('Hindsight review', { exact: true })).toHaveCount(0)
  await expect(page.getByLabel('Chart unit')).toHaveValue('GW')
  await page.getByLabel('Chart unit').selectOption('MW')
  await expect(page.getByLabel('Chart unit')).toHaveValue('MW')
  await page.getByLabel('Show hindsight actuals').check()
  await expect(page.getByText('Hindsight review', { exact: true })).toBeVisible()
  await expect(inspector(page).getByText('hindsight', { exact: false })).toBeVisible()
  await page.getByLabel('Show hindsight actuals').uncheck()
  await page.getByLabel('Chart unit').selectOption('GW')
  await assertFits(page)
  expect(errors).toEqual([])
  await capture(page, testInfo)
})

test('interval inspector and sortable table use the same source values', async ({ page }) => {
  await openWorkspace(page)
  const day = new URL(page.url()).searchParams.get('date')
  const snapshot = await (await page.request.get(`/api/day?date=${day}&cutoff=09:00`)).json()
  await page.getByLabel('Settlement period', { exact: true }).selectOption('24')
  await expect(inspector(page).locator('.forecast-value')).toHaveText(
    `${format(snapshot.series[24].forecast)} MW`
  )
  await page.getByLabel('Next settlement period').click()
  await expect(page.getByLabel('Settlement period', { exact: true })).toHaveValue('25')
  await display(page).getByRole('button', { name: 'Table', exact: true }).click()
  const region = page.getByRole('region', { name: 'Settlement interval data' })
  await expect(region.getByRole('row')).toHaveCount(49)
  await page.getByRole('button', { name: 'Sort by Forecast MW', exact: true }).click()
  await page.getByRole('button', { name: 'Sort by Forecast MW', exact: true }).click()
  await expect(region.getByRole('row').nth(1).locator('td').first()).toHaveText(
    format(snapshot.summary.forecast_max)
  )
  await region.getByRole('button', { name: /Inspect period 1,/ }).click()
  await expect(page.getByLabel('Settlement period', { exact: true })).toHaveValue('0')
  await expect(inspector(page).locator('.forecast-value')).toHaveText(
    `${format(snapshot.series[0].forecast)} MW`
  )
  await assertFits(page)
})

test('missing-only filter exposes real forecast gaps', async ({ page }) => {
  await openWorkspace(page)
  await display(page).getByRole('button', { name: 'Table', exact: true }).click()
  await page.getByLabel('Only missing forecasts').check()
  await expect(page.getByText('No missing forecasts at this cutoff.')).toBeVisible()
  await page.getByLabel('Decision cutoff UTC').fill('00:00')
  await expect(page.getByText('Incomplete forecast coverage', { exact: true })).toBeVisible()
  await expect(page.getByText(/44 of 48 half-hours/)).toBeVisible()
  await expect(
    page.getByRole('region', { name: 'Settlement interval data' }).getByRole('row')
  ).toHaveCount(5)
  await expect(page.getByText('4 of 48 periods · values in MW')).toBeVisible()
  await page.getByLabel('Decision cutoff UTC').fill('09:00')
  await expect(page.getByText('Incomplete forecast coverage', { exact: true })).toHaveCount(0)
  await expect(page.getByText('No missing forecasts at this cutoff.')).toBeVisible()
})

test('January decision boundaries, early history and day CSV', async ({ page }) => {
  await openWorkspace(page)
  await page.getByLabel('Purchase decision date', { exact: true }).selectOption('2026-01-02')
  await expect(page.getByText('Insufficient earlier history', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Previous decision day')).toBeDisabled()
  await page.getByLabel('Purchase decision date', { exact: true }).selectOption('2026-02-01')
  await expect(page.getByLabel('Next decision day')).toBeDisabled()
  await expect(page.getByText('2026-01-31 09:00 UTC', { exact: true })).toBeVisible()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('link', { name: 'Export day CSV', exact: true }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('windwatch-2026-02-01-0900.csv')
  expect(await download.failure()).toBeNull()
})

test('accuracy filters, CSV, sorting and forecast drill-down preserve context', async ({
  page,
}, testInfo) => {
  await openWorkspace(page)
  await page.getByRole('button', { name: 'Accuracy', exact: true }).click()
  await expect(page.getByText('1,488 / 1,488 paired half-hours')).toBeVisible()
  await capture(page, testInfo, 'accuracy')
  await page.getByLabel('First delivery day').fill('2026-01-10')
  await page.getByLabel('Last delivery day').fill('2026-01-12')
  await expect(page.getByText('144 / 144 paired half-hours')).toBeVisible()
  const table = page.getByRole('region', { name: 'Daily accuracy results' })
  await expect(table.getByRole('row')).toHaveCount(4)
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export daily CSV' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('windwatch-accuracy-2026-01-10-2026-01-12-0900.csv')
  const downloadPath = testInfo.outputPath('accuracy.csv')
  await download.saveAs(downloadPath)
  const csv = await readFile(downloadPath, 'utf8')
  expect(csv.split('\r\n')).toHaveLength(4)
  expect(csv).toContain('"2026-01-10","09:00","48"')
  await page.getByLabel('Largest errors first').check()
  const values = await table.locator('tbody tr td:nth-child(3)').allTextContents()
  const numeric = values.map((v) => Number(v.replaceAll(',', '')))
  expect(numeric).toEqual([...numeric].sort((a, b) => b - a))
  await table.getByRole('button', { name: 'Inspect forecast for 2026-01-12' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Day-ahead wind forecast')
  await expect(page.getByLabel('Purchase decision date', { exact: true })).toHaveValue('2026-01-12')
  await page.getByRole('button', { name: 'Accuracy', exact: true }).click()
  await expect(page.getByLabel('First delivery day')).toHaveValue('2026-01-10')
  await page.getByRole('button', { name: 'Full period' }).click()
  await expect(page.getByText('1,488 / 1,488 paired half-hours')).toBeVisible()
  await assertFits(page)
})

test('diagnostic charts expose accessible analysis tables', async ({ page }) => {
  await openWorkspace(page)
  await page.getByRole('button', { name: 'Accuracy', exact: true }).click()
  for (const [value, title, rows] of [
    ['hour', 'Error by delivery hour', 25],
    ['horizon', 'Error by forecast horizon', 9],
    ['distribution', 'Error distribution', null],
  ]) {
    await page.getByLabel('Error analysis breakdown').selectOption(value)
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Show analysis data table' }).click()
    const table = page.getByRole('region', { name: `${title} data`, exact: true })
    if (rows) await expect(table.getByRole('row')).toHaveCount(rows)
    else expect(await table.getByRole('row').count()).toBeGreaterThan(1)
    await assertFits(page)
  }
  await page.getByRole('button', { name: 'Data & methodology', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Coverage & provenance' })).toBeVisible()
  await expect(page.getByRole('link', { name: /Elexon forecast documentation/ })).toHaveAttribute(
    'href',
    /WINDFOR/
  )
  await expect(page.getByText('18,080', { exact: true })).toBeVisible()
  await assertFits(page)
})

test('API errors clear the old snapshot and support retry', async ({ page }) => {
  await openWorkspace(page)
  await page.route('**/api/day?**', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ detail: 'Test temporary outage' }),
    })
  )
  await page.getByLabel('Decision cutoff UTC').fill('08:00')
  await expect(page.getByRole('alert')).toContainText('Test temporary outage')
  await expect(page.getByText('Average forecast wind', { exact: true })).toHaveCount(0)
  await page.unroute('**/api/day?**')
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(page.getByText('Average forecast wind', { exact: true })).toBeVisible()
})

test('a slow older request cannot replace the latest cutoff', async ({ page }) => {
  await openWorkspace(page)
  let releaseOlder, markIntercepted, markFinished
  const olderBlocked = new Promise((resolve) => {
    releaseOlder = resolve
  })
  const intercepted = new Promise((resolve) => {
    markIntercepted = resolve
  })
  const finished = new Promise((resolve) => {
    markFinished = resolve
  })
  await page.route('**/api/day?**', async (route) => {
    if (route.request().url().includes('cutoff=08:00')) {
      markIntercepted()
      await olderBlocked
      await route.continue().catch(() => {})
      markFinished()
      return
    }
    await route.continue()
  })
  await page.getByLabel('Decision cutoff UTC').fill('08:00')
  await intercepted
  await page.getByLabel('Decision cutoff UTC').fill('10:00')
  await expect(page.getByText('2026-01-16 10:00 UTC', { exact: true })).toBeVisible()
  releaseOlder()
  await finished
  await expect(page.getByText('2026-01-16 08:00 UTC', { exact: true })).toHaveCount(0)
  await expect(page.getByText('2026-01-16 10:00 UTC', { exact: true })).toBeVisible()
})

test('URL restores the selected decision, cutoff, view and accuracy range', async ({ page }) => {
  await page.goto('/?view=decision&date=2026-02-01&cutoff=08:00')
  await expect(page.getByText('Average forecast wind', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Purchase decision date', { exact: true })).toHaveValue('2026-02-01')
  await expect(page.getByLabel('Decision cutoff UTC')).toHaveValue('08:00')
  await page.getByRole('button', { name: 'Accuracy', exact: true }).click()
  await page.getByLabel('First delivery day').fill('2026-01-10')
  await page.getByLabel('Last delivery day').fill('2026-01-12')
  await expect(page.getByText('144 / 144 paired half-hours')).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Forecast accuracy')
  await expect(page.getByLabel('First delivery day')).toHaveValue('2026-01-10')
  await expect(page.getByLabel('Last delivery day')).toHaveValue('2026-01-12')
  await expect(page.getByLabel('Decision cutoff UTC')).toHaveValue('08:00')
})

test('keyboard navigation and automated accessibility checks across all views', async ({
  page,
}, testInfo) => {
  await openWorkspace(page)
  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('main')).toBeFocused()
  await page.getByLabel('Settlement period', { exact: true }).focus()
  await page.keyboard.press('ArrowDown')
  await expect(page.getByLabel('Settlement period', { exact: true })).toHaveValue('1')
  for (const name of ['Forecast', 'Accuracy', 'Data & methodology']) {
    await page.getByRole('button', { name, exact: true }).click()
    if (name === 'Forecast')
      await expect(page.getByText('Average forecast wind', { exact: true })).toBeVisible()
    else if (name === 'Accuracy')
      await expect(page.getByText('Mean absolute error', { exact: true })).toBeVisible()
    else await expect(page.getByRole('heading', { name: 'Coverage & provenance' })).toBeVisible()
    const result = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze()
    expect(
      result.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        nodes: v.nodes.map((n) => n.target),
      }))
    ).toEqual([])
    await assertFits(page)
    if (testInfo.project.name === 'mobile') {
      await page.setViewportSize({ width: 320, height: 844 })
      await assertFits(page)
      await page.setViewportSize({ width: 390, height: 844 })
    }
  }
})
