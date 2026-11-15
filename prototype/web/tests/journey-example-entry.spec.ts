import { test, expect, type Page } from '@playwright/test'
import { completeSafetyGuide, expectJourneyStep, storedJourney } from './helpers/scenario-journey'

test.use({ viewport: { width: 1682, height: 1210 }, deviceScaleFactor: 1 })

async function openVehicleApp(page: Page) {
  await page.addInitScript(() => {
    window.ChabunNative = {
      host: () => JSON.stringify({ version: 1, demo: false, handoff: false, sdk: '2.3.2', environment: 'emulator', windowPx: { width: 1682, height: 1210 } }),
      handoff() {}, dial: () => 'opened',
    }
  })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/?host=pleos-app')
  await expectJourneyStep(page, 1)
  await page.locator('[data-cell=guide]').getByRole('button', { name: '괜찮아요', exact: true }).click()
  await completeSafetyGuide(page)
  await page.locator('[data-cell=guide]').getByRole('button', { name: '기록 시작', exact: true }).click()
  await expectJourneyStep(page, 5)
  await expect(page.getByRole('button', { name: /시연 event/ }).filter({ visible: true })).toHaveCount(0)
}

const report = (page: Page) => page.getByRole('region', { name: '경위서 검토', exact: true })

test('after saving a record the guide cell offers the example report and a round trip keeps it intact', async ({ page }) => {
  await openVehicleApp(page)
  const statement = '정차 중 오른쪽 차량과 접촉했어요.'
  const record = page.locator('[data-cell=record]')
  await record.getByRole('button', { name: '직접 입력', exact: true }).click()
  await record.getByRole('textbox', { name: '사고 기록', exact: true }).fill(statement)
  await record.getByRole('button', { name: '기록 저장', exact: true }).click()
  const make = page.locator('[data-cell=guide]').getByRole('button', { name: '예시 경위서 만들기', exact: true })
  await expect(make).toBeEnabled()
  await page.screenshot({ path: '/tmp/rev-report-after-3-record-saved.png' })
  await make.click()
  await expectJourneyStep(page, 6)
  await expect(report(page).getByRole('article').filter({ hasText: statement })).toBeVisible()
  await page.screenshot({ path: '/tmp/rev-report-after-4-report.png' })
  const created = await storedJourney(page)

  await page.locator('[data-cell=record]').getByRole('button', { name: '기록 더 남기기', exact: true }).click()
  await expectJourneyStep(page, 5)
  await make.click()
  await expectJourneyStep(page, 6)
  await expect(report(page).getByRole('article').filter({ hasText: statement })).toBeVisible()
  await expect(report(page).getByText('근거를 열 수 없어요', { exact: true })).toHaveCount(0)
  const returned = await storedJourney(page)
  expect(returned.report).toEqual(created.report)
  expect(returned.evidence).toEqual(created.evidence)
  expect(returned.pendingReport).toBeNull()

  await page.reload()
  await expectJourneyStep(page, 6)
  await expect(page.getByRole('button', { name: '경위서', exact: true }).filter({ visible: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(report(page).getByRole('article').filter({ hasText: statement })).toBeVisible()
})
