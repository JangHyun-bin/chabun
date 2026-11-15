import { test, expect } from '@playwright/test'
import { createSession } from '../src/emergency/session'
import { createCase, makeSubmission, reduceCase, validateCase, type JourneyCase } from '../src/journey/case'
import { expectJourneyStep, storedJourney } from './helpers/scenario-journey'

const now = '2026-11-12T00:00:00.000Z'
function approved(explicit = true) {
  let value = createCase(createSession('SC01'), 'transport-case', now)
  value = reduceCase(value, { type: 'statement-edit', id: 'note', text: '정차 중 오른쪽에서 충격을 느꼈어요.', audioEvidenceIds: [] })
  value = reduceCase(value, { type: 'statement-confirm', id: 'note' })
  const result = makeSubmission(value, { agency: 'insurance', recipient: '선택한 보험사', id: 'approved-record', now,
    transport: explicit ? 'explicit' : undefined,
    selection: { observationIds: [], statementIds: ['note'], evidenceIds: [], includeDiagram: false, includeReport: false } })
  if (!result.ok) throw new Error(result.reason)
  return result.value
}
const identity = (value: JourneyCase) => ({ caseId: value.id, submissionId: value.activeSubmissionIds.insurance!, now })

test('explicit approval, start and result preserve the approved snapshot across failure and retry', () => {
  let value = approved()
  const snapshot = structuredClone(value.submissions[0].payload)
  expect(value.emergency.requests.insurance).toBe('checking')
  expect(value.submissions[0].transport).toBe('approved')
  expect(reduceCase(value, { type: 'transport-result', ...identity(value), status: 'sent' })).toBe(value)
  value = reduceCase(value, { type: 'transport-start', ...identity(value) })
  expect(reduceCase(value, { type: 'navigate', stage: 'record' })).toBe(value)
  expect(reduceCase(value, { type: 'transport-start', ...identity(value) })).toBe(value)
  expect(reduceCase(value, { type: 'request-result', ...identity(value), agency: 'insurance', status: 'received', externalReceipt: null })).toBe(value)
  value = reduceCase(value, { type: 'transport-result', ...identity(value), status: 'failed' })
  value = reduceCase(value, { type: 'navigate', stage: 'record' })
  value = reduceCase(value, { type: 'statement-edit', id: 'note', text: '새로 작성한 내용', audioEvidenceIds: [] })
  const failedIdentity = identity(value)
  expect(reduceCase(value, { type: 'transport-start', ...identity(value) })).toBe(value)
  value = reduceCase(value, { type: 'transport-start', ...identity(value), retryId: 'retry-record' })
  expect(reduceCase(value, { type: 'transport-result', ...failedIdentity, status: 'sent' })).toBe(value)
  value = reduceCase(value, { type: 'transport-result', ...identity(value), status: 'sent' })
  expect(value.submissions).toHaveLength(2)
  expect(value.submissions[0].status).toBe('failed')
  expect(value.submissions[1].payload).toEqual(snapshot)
  expect(value.submissions[0].payload).toEqual(snapshot)
  expect(value.submissions[1].status).toBe('sent')
  expect(value.submissions[0].externalReceipt).toBeNull()
  expect(reduceCase(value, { type: 'request-result', ...identity(value), agency: 'insurance', status: 'failed', externalReceipt: null })).toBe(value)
  expect(reduceCase(value, { type: 'request-result', ...identity(value), agency: 'insurance', status: 'connected', externalReceipt: null })).toBe(value)
  expect(value.statements[0].text).toBe('새로 작성한 내용')
  expect(validateCase(value)).toBe(true)
})

test('legacy sent loads unchanged and stale transport events do not affect the current request', () => {
  const legacy = approved(false)
  expect(validateCase(legacy)).toBe(true)
  expect(legacy.submissions[0].status).toBe('sent')
  expect(legacy.submissions[0].transport).toBeUndefined()
  expect(reduceCase(legacy, { type: 'transport-start', ...identity(legacy) })).toBe(legacy)
  const value = approved()
  expect(reduceCase(value, { type: 'transport-start', ...identity(value), caseId: 'other-case' })).toBe(value)
  expect(reduceCase(value, { type: 'transport-start', ...identity(value), submissionId: 'other-request' })).toBe(value)
  expect(validateCase({ ...value, submissions: [{ ...value.submissions[0], transport: 'sending', status: 'sent' }] })).toBe(false)
})

test('receipt and call lifecycle are independent and insurance success does not end a call', () => {
  let value = reduceCase(approved(), { type: 'contact-start', now })
  const rescue = { caseId: value.id, submissionId: value.activeSubmissionIds.rescue!, agency: 'rescue' as const, now, externalReceipt: null }
  value = reduceCase(value, { type: 'request-result', ...rescue, status: 'received' })
  value = reduceCase(value, { type: 'request-result', ...rescue, status: 'connected' })
  value = reduceCase(value, { type: 'transport-start', ...identity(value) })
  value = reduceCase(value, { type: 'transport-result', ...identity(value), status: 'sent' })
  expect(value.submissions.find(item => item.id === rescue.submissionId)?.call).toBe('connected')
  expect(value.emergency.requests.rescue).toBe('received')
  expect(reduceCase(value, { type: 'call-end', ...rescue, caseId: 'other-case' })).toBe(value)
  value = reduceCase(value, { type: 'call-end', ...rescue })
  expect(value.submissions.find(item => item.id === rescue.submissionId)?.call).toBe('ended')
  expect(value.emergency.requests.rescue).toBe('received')
  expect(reduceCase(value, { type: 'request-result', ...rescue, status: 'connected' })).toBe(value)
  expect(validateCase(value)).toBe(true)
})


test('failed contact ends that call attempt and later results cannot reopen it', () => {
  let value = reduceCase(createCase(createSession('SC01'), 'contact-failure', now), { type: 'contact-start', now })
  const first = value.activeSubmissionIds.rescue!
  value = reduceCase(value, { type: 'request-result', caseId: value.id, submissionId: first, agency: 'rescue', status: 'failed', externalReceipt: null, now })
  expect(value.submissions[0].call).toBe('ended')
  value = reduceCase(value, { type: 'contact-start', now })
  const current = value.activeSubmissionIds.rescue
  value = reduceCase(value, { type: 'request-result', caseId: value.id, submissionId: first, agency: 'rescue', status: 'connected', externalReceipt: null, now })
  expect(value.submissions[0].call).toBe('ended')
  expect(value.activeSubmissionIds.rescue).toBe(current)
  expect(value.submissions[1].call).toBe('connecting')
  expect(validateCase(value)).toBe(true)
})

test('a contact failure ends a connected call while preserving its confirmed receipt', () => {
  let value = reduceCase(createCase(createSession('SC01'), 'received-contact', now), { type: 'contact-start', now })
  const result = { caseId: value.id, submissionId: value.activeSubmissionIds.rescue!, agency: 'rescue' as const, now, externalReceipt: null }
  value = reduceCase(value, { type: 'request-result', ...result, status: 'connected' })
  const receipt = { number: 'confirmed-receipt', receivedAt: now, agencyName: '구호', next: '안내 대기' }
  value = reduceCase(value, { type: 'request-result', ...result, status: 'received', externalReceipt: receipt })
  const endedAt = '2026-11-12T00:01:00.000Z'
  value = reduceCase(value, { type: 'request-result', ...result, status: 'failed', now: endedAt })
  expect(value.submissions[0]).toMatchObject({ status: 'received', call: 'ended', externalReceipt: receipt })
  expect(value.emergency.requests.rescue).toBe('received')
  expect(value.updatedAt).toBe(endedAt)
  expect(reduceCase(value, { type: 'request-result', ...result, status: 'connected' })).toBe(value)
  expect(validateCase(value)).toBe(true)
})

for (const unavailable of [false, true]) test(`safety confirmations stay sequential and persist ${unavailable ? 'unavailable actions' : 'driver confirmations'} without inventing vehicle signals`, async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await page.getByRole('button', { name: '이 상황으로 시작', exact: true }).click()
  await page.getByRole('button', { name: '괜찮아요', exact: true }).click()
  const guide = page.locator('[data-cell=guide]')
  const vehicle = page.locator('[data-cell=vehicle]')
  await expect(guide.getByRole('heading', { name: '비상등을 켜세요', exact: true })).toBeVisible()
  await expect(guide.getByText('1 / 3', { exact: true })).toBeVisible()
  await expect(guide.getByRole('button', { name: '열었어요', exact: true })).toHaveCount(0)
  await expect(guide.getByRole('button', { name: '대피했어요', exact: true })).toHaveCount(0)
  await expect(vehicle.locator('[data-vehicle-row=hazard]')).toContainText('미확인')
  await expect(vehicle.locator('[data-vehicle-row=trunk]')).toContainText('미확인')
  await guide.getByRole('button', { name: unavailable ? '지금 할 수 없어요' : '켰어요', exact: true }).click()
  await expect(guide.getByRole('heading', { name: '트렁크를 열어 주세요', exact: true })).toBeVisible()
  await expect(guide.getByText('2 / 3', { exact: true })).toBeVisible()
  await expectJourneyStep(page, 3)
  expect((await storedJourney(page)).safetyActions.some(item => item.id === 'safe-arrival')).toBe(false)
  await guide.getByRole('button', { name: unavailable ? '지금 할 수 없어요' : '열었어요', exact: true }).click()
  await expect(guide.getByRole('heading', { name: '가드레일 밖으로 대피하세요', exact: true })).toBeVisible()
  await expect(guide.getByText('3 / 3', { exact: true })).toBeVisible()
  await expect(guide.getByRole('button', { name: '기록 시작', exact: true })).toHaveCount(0)
  await expect(guide.getByRole('button', { name: '대피가 어려워요', exact: true })).toBeVisible()
  const beforeArrival = await storedJourney(page)
  expect(beforeArrival.stage).toBe('response')
  expect(beforeArrival.safetyActions.some(item => item.id === 'safe-arrival')).toBe(false)
  for (const id of ['hazard', 'trunk']) {
    expect(beforeArrival.safetyActions.find(item => item.id === id)).toMatchObject({ status: unavailable ? 'unavailable' : 'user-confirmed', source: 'user' })
    await expect(vehicle.locator(`[data-vehicle-row=${id}]`)).toContainText(unavailable ? '지금 할 수 없음' : id === 'hazard' ? '켜짐' : '열림')
    if (!unavailable) await expect(vehicle.locator(`[data-vehicle-row=${id}]`)).toContainText('직접 확인')
  }
  await guide.getByRole('button', { name: '대피했어요', exact: true }).click()
  await expectJourneyStep(page, 4)
  await guide.getByRole('button', { name: '기록 시작', exact: true }).click()
  await expectJourneyStep(page, 5)
  const saved = await storedJourney(page)
  expect(saved.safetyActions.find(item => item.id === 'safe-arrival')).toMatchObject({ status: 'user-confirmed', source: 'user' })
  expect(saved.submissions).toHaveLength(0)
  await page.reload()
  await expectJourneyStep(page, 5)
  expect((await storedJourney(page)).safetyActions).toEqual(saved.safetyActions)
})

test('a failed safety confirmation stays on that action until a successful retry', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await page.getByRole('button', { name: '이 상황으로 시작', exact: true }).click()
  await page.getByRole('button', { name: '괜찮아요', exact: true }).click()
  await storedJourney(page)
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'cases' && document.documentElement.dataset.storageFailure === 'yes') throw new DOMException('Full', 'QuotaExceededError')
      return original.apply(this, args)
    }
    document.documentElement.dataset.storageFailure = 'yes'
  })
  const guide = page.locator('[data-cell=guide]')
  await guide.getByRole('button', { name: '켰어요', exact: true }).click()
  await expect(guide.getByRole('alert')).toContainText('확인 내용을 저장하지 못했어요')
  await expect(guide.getByRole('heading', { name: '비상등을 켜세요', exact: true })).toBeVisible()
  await expect(guide.getByRole('button', { name: '열었어요', exact: true })).toHaveCount(0)
  await expectJourneyStep(page, 3)
  await page.evaluate(() => { delete document.documentElement.dataset.storageFailure })
  await guide.getByRole('button', { name: '켰어요', exact: true }).click()
  await expect(guide.getByRole('heading', { name: '트렁크를 열어 주세요', exact: true })).toBeVisible()
  const value = await storedJourney(page)
  expect(value.safetyActions.filter(item => item.id === 'hazard')).toEqual([
    expect.objectContaining({ status: 'user-confirmed', source: 'user' }),
  ])
  expect(value.safetyActions.some(item => item.id === 'safe-arrival')).toBe(false)
})
