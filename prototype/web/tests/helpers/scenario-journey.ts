import { expect, type Page } from '@playwright/test'
import type { JourneyCase } from '../../src/journey/case'

export const expectJourneyStep = (page: Page, step: number) => expect(page.getByTestId('journey-flow')).toHaveAttribute('data-step', String(step))

export async function storedJourney(page: Page): Promise<JourneyCase> {
  await expect(page.getByText('이 기기에 보관됨', { exact: true })).toBeAttached()
  return page.evaluate(async () => {
    // The store must load in the browser's Vite module graph, not the test runner.
    const path = '/src/journey/case-store.ts'
    const { loadCase } = await import(/* @vite-ignore */ path)
    const value = await loadCase(new URL(location.href).searchParams.get('case')!)
    if (!value) throw new Error('Expected a durable journey case')
    return value
  })
}

export async function completeSafetyGuide(page: Page) {
  const guide = page.locator('[data-cell=guide]')
  await expectJourneyStep(page, 3)
  for (const [title, action] of [
    ['비상등을 켜세요', '켰어요'],
    ['트렁크를 열어 주세요', '열었어요'],
    ['가드레일 밖으로 대피하세요', '대피했어요'],
  ]) {
    await expect(guide.getByRole('heading', { name: title, exact: true })).toBeVisible()
    await guide.getByRole('button', { name: action, exact: true }).click()
  }
  await expectJourneyStep(page, 4)
  const value = await storedJourney(page)
  for (const id of ['hazard', 'trunk', 'safe-arrival']) {
    expect(value.safetyActions.find(action => action.id === id)).toMatchObject({ status: 'user-confirmed', source: 'user' })
  }
}

export async function enterJourneyRecord(page: Page) {
  await completeSafetyGuide(page)
  await page.locator('[data-cell=guide]').getByRole('button', { name: '기록 시작', exact: true }).click()
  await expectJourneyStep(page, 5)
}

export async function openExampleReport(page: Page) {
  await expectJourneyStep(page, 5)
  await page.getByRole('button', { name: '예시 경위서 만들기', exact: true })
    .or(page.getByTestId('journey-primary')).filter({ visible: true }).first().click()
  await expectJourneyStep(page, 6)
  await expect(page.getByRole('region', { name: '경위서 검토', exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: '경위서 검토', exact: true }).getByText('예시 경위서', { exact: true }).filter({ visible: true })).toBeVisible()
}
