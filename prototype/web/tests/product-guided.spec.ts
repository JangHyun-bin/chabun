/// <reference lib="es2024.promise" />
import { test, expect, type Page } from '@playwright/test'
import type ReactModule from 'react'
import type * as ReactDOMClient from 'react-dom/client'
import type * as CaseDataModule from '../src/journey/case-data'
import type { CaseBatch } from '../src/journey/case-data'
import type { JourneyCase, Stage } from '../src/journey/case'
import type * as ProductFlowModule from '../src/product/ProductFlow'
import type * as ProductOutboxModule from '../src/product/product-outbox'
import type * as ProductCaseModule from '../src/product/product-case'
import type * as CaseStoreModule from '../src/journey/case-store'
import type * as CaseDomainModule from '../src/journey/case'

type WriteKind = 'photo' | 'voice' | 'navigate' | 'copy' | 'other'
type WriteGate = { kind: WriteKind; stage?: Stage }

declare global {
  interface Window {
    mobileGuided: {
      fail: WriteGate | null
      hold: WriteGate | null
      waiting: boolean
      release: () => void
      writes: Record<WriteKind, number>
      followups: number
      readCase: () => Promise<JourneyCase | null>
      readVoice: () => Promise<string | null>
      readPhoto: () => Promise<number | null>
      localHold: boolean
      localFail: 'quota' | 'unavailable' | 'invalid' | null
      localWaiting: boolean
      releaseLocal: () => void
    }
  }
}

const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true })
const phone = (page: Page) => page.locator('[data-care-device="mobile"][data-product-stage]')
const photos = (page: Page) => page.locator('.journey-evidence')
const voiceInput = (page: Page) => page.locator('.journey-voice textarea')

async function mount(page: Page, caseId: string, initialFail: WriteGate | null = null) {
  await page.evaluate(async ({ caseId, initialFail }) => {
    // Browser imports share Vite's React context and IndexedDB; Node imports cannot.
    const root = '/src/'
    const hookSource = await (await fetch(root + 'journey/useJourneyCase.ts')).text()
    const entrySource = await (await fetch(root + 'main.tsx')).text()
    const reactUrl = hookSource.match(/from "([^"]*\/react\.js[^"]*)"/)![1]
    const clientUrl = entrySource.match(/from "([^"]*\/react-dom_client\.js[^"]*)"/)![1]
    const React = (await import(reactUrl)).default as typeof ReactModule
    const { createRoot } = (await import(clientUrl)).default as typeof ReactDOMClient
    const dataUrl = hookSource.match(/from "([^"]*\/journey\/case-data\.tsx[^"]*)"/)![1]
    const { CaseDataProvider, studyCaseData } = await import(dataUrl) as typeof CaseDataModule
    const { ProductFlow } = await import(root + 'product/ProductFlow.tsx') as typeof ProductFlowModule
    const { createProductOutbox, tabDraftId } = await import(root + 'product/product-outbox.ts') as typeof ProductOutboxModule
    const { loadCase, commitCase } = await import(root + 'journey/case-store.ts') as typeof CaseStoreModule
    const { reduceCase } = await import(root + 'journey/case.ts') as typeof CaseDomainModule
    await import(root + 'product/ProductApp.tsx')
    const outbox = createProductOutbox({ origin: location.origin, clientId: 'mobile-guided-tests', draftId: tabDraftId(), databaseName: 'mobile-guided-tests' })
    const control: Window['mobileGuided'] = {
      fail: initialFail, hold: null, waiting: false, release: () => {},
      localHold: false, localFail: null, localWaiting: false, releaseLocal: () => {},
      writes: { photo: 0, voice: 0, navigate: 0, copy: 0, other: 0 }, followups: 0,
      readCase: () => loadCase(caseId),
      readVoice: async () => (await outbox.readEditorDraft(caseId, 'voice'))?.text ?? null,
      readPhoto: async () => (await outbox.readEditorDraft(caseId, 'photo'))?.blob.size ?? null,
    }
    window.mobileGuided = control
    async function gate(batch: CaseBatch, kind: WriteKind) {
      control.writes[kind] += 1
      const destination = batch.kind === 'changes' ? batch.commands.find(command => command.type === 'navigate')?.stage : undefined
      if (destination === 'follow-up') control.followups += 1
      const matches = (rule: WriteGate | null) => !!rule && rule.kind === kind && (!rule.stage || rule.stage === destination)
      if (matches(control.hold)) {
        control.hold = null; control.waiting = true
        const { promise, resolve } = Promise.withResolvers<void>()
        control.release = resolve
        await promise
        control.waiting = false
      }
      return matches(control.fail)
    }
    const data: CaseDataModule.CaseData = {
      ...studyCaseData, ...outbox, mode: 'remote',
      stageBatch: async batch => {
        if (control.localHold) {
          control.localHold = false; control.localWaiting = true
          await new Promise<void>(resolve => { control.releaseLocal = resolve })
          control.localWaiting = false
        }
        if (control.localFail) return { durable: false, reason: control.localFail }
        return outbox.stageBatch(batch)
      },
      apply: async batch => {
        const kind = batch.kind === 'changes' && batch.commands.some(command => command.type === 'evidence-put') ? 'photo'
          : batch.kind === 'changes' && batch.commands.some(command => command.type === 'voice-save') ? 'voice'
          : batch.kind === 'changes' && batch.commands.some(command => command.type === 'navigate') ? 'navigate' : 'other'
        if (await gate(batch, kind)) return { ok: false, reason: 'unavailable' }
        const current = await loadCase(batch.local.id)
        if (current && current.revision !== batch.expectedRevision) return { ok: false, reason: 'conflict', latest: current }
        const next = batch.kind === 'changes' && current ? batch.commands.reduce(reduceCase, current) : batch.local
        const saved = await commitCase(next, batch.expectedRevision, batch.assets)
        if (!saved.ok) return { ok: false, reason: saved.reason }
        return { ok: true, value: saved.value, ackMutationId: batch.mutationId, ackRevision: saved.value.revision }
      },
      approveCopy: async batch => {
        if (await gate(batch, 'copy')) return { ok: false, reason: 'unavailable' }
        return studyCaseData.approveCopy(batch)
      },
    }
    const container = document.createElement('div')
    container.id = 'mobile-guided-tests'
    document.getElementById('root')!.hidden = true
    document.body.append(container)
    createRoot(container).render(React.createElement(CaseDataProvider, { data, children: React.createElement(ProductFlow, {
      session: { role: 'phone', caseId, clientId: 'mobile-guided-tests', csrfToken: 'local-browser-test', expiresAt: new Date(Date.now() + 3600000).toISOString() },
    }) }))
  }, { caseId, initialFail })
  await expect(button(page, '지금 기록할 수 있어요')).toBeEnabled()
}

async function begin(page: Page, { decided = 0, statement = '' } = {}) {
  await page.goto('/?study=journey-catalog')
  const caseId = await page.evaluate(async ({ decided, statement }) => {
    // Seed through the browser's real persistence module.
    const root = '/src/'
    const { createProductCase } = await import(root + 'product/product-case.ts') as typeof ProductCaseModule
    const { captureTargets } = await import(root + 'journey/case.ts') as typeof CaseDomainModule
    const { commitCase } = await import(root + 'journey/case-store.ts') as typeof CaseStoreModule
    const value = createProductCase(crypto.randomUUID(), new Date().toISOString())
    value.evidence = captureTargets.slice(0, decided).map(target => ({
      id: crypto.randomUUID(), label: target.label, kind: 'photo', origin: 'user', revision: 1,
      captureTarget: target.id, availability: 'skipped', assetId: null,
      metadata: { mime: '', bytes: 0, duration: null, capturedAt: null, sourceLabel: '사용자가 생략' },
    }))
    if (statement) value.statements = [{ id: 'primary-statement', text: statement, audioEvidenceIds: [], revision: 1, confirmedRevision: 1 }]
    const saved = await commitCase(value, null)
    if (!saved.ok) throw new Error(saved.reason)
    return value.id
  }, { decided, statement })
  await mount(page, caseId)
  await button(page, '지금 기록할 수 있어요').click()
  await expect(phone(page)).toHaveAttribute('data-product-stage', 'record')
  return caseId
}

async function statementStep(page: Page, options: { statement?: string } = {}) {
  const caseId = await begin(page, { decided: 6, ...options })
  await button(page, '진술로 계속').click()
  await expect(phone(page)).toHaveAttribute('data-record-step', 'voice')
  return caseId
}

async function copyPreview(page: Page) {
  await statementStep(page, { statement: '오른쪽에서 충격을 느꼈고 이동 경로는 확인하지 못했어요.' })
  await button(page, '내용 확인으로 계속').click()
  await button(page, '내 사본 범위 선택').click()
  await page.getByRole('checkbox', { name: /직접 남긴 내용 1/ }).check()
  await button(page, '선택한 내용 미리보기').click()
  await expect(page.getByRole('region', { name: '내 사본 미리보기' })).toBeVisible()
}

async function photoFile(page: Page) {
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 100
    const context = canvas.getContext('2d')!
    context.fillStyle = '#a4a8ae'; context.fillRect(0, 0, 160, 100)
    context.fillStyle = '#313236'; context.fillRect(30, 25, 100, 50)
    return canvas.toDataURL('image/png').split(',')[1]
  })
  return { name: 'scene.png', mimeType: 'image/png', buffer: Buffer.from(base64, 'base64') }
}

test('pending local persistence reports saving, then advances only after the real write', async ({ page }) => {
  await begin(page)
  await photos(page).getByLabel('사진 파일 선택', { exact: true }).setInputFiles(await photoFile(page))
  await page.evaluate(() => { window.mobileGuided.localHold = true })
  await button(page, '이 사진 사용').click()
  await expect.poll(() => page.evaluate(() => window.mobileGuided.localWaiting)).toBe(true)
  await expect(page.getByRole('status').filter({ hasText: '이 기기에 초안을 저장하고 있어요' })).toBeVisible()
  await expect(page.getByRole('alert').filter({ hasText: '이 기기에 초안을 안전하게 보관하지 못했어요' })).toHaveCount(0)
  await expect(photos(page)).toHaveAttribute('data-current-photo-target', 'scene')
  expect(await page.evaluate(() => window.mobileGuided.writes.photo)).toBe(0)
  await page.evaluate(() => window.mobileGuided.releaseLocal())
  await expect(photos(page)).toHaveAttribute('data-current-photo-target', 'own-car')
  expect(await page.evaluate(async () => (await window.mobileGuided.readCase())?.evidence.length)).toBe(1)
  await expect(page.getByText('이 기기에 초안을 저장하고 있어요', { exact: false })).toHaveCount(0)
})

for (const reason of ['quota', 'unavailable', 'invalid'] as const) test(`actual local ${reason} failure preserves photo input and target until retry`, async ({ page }) => {
  await begin(page)
  await photos(page).getByLabel('사진 파일 선택', { exact: true }).setInputFiles(await photoFile(page))
  await page.evaluate(reason => { window.mobileGuided.localFail = reason }, reason)
  await button(page, '이 사진 사용').click()
  await expect(page.getByRole('alert').filter({ hasText: '이 기기에 초안을 안전하게 보관하지 못했어요' })).toBeVisible()
  await expect(photos(page)).toHaveAttribute('data-current-photo-target', 'scene')
  await expect(page.getByRole('img', { name: '저장 전 현장 전체 사진', exact: true })).toBeVisible()
  expect(await page.evaluate(() => window.mobileGuided.writes.photo)).toBe(0)
  expect(await page.evaluate(async () => (await window.mobileGuided.readCase())?.evidence.length)).toBe(0)
  await page.evaluate(() => { window.mobileGuided.localFail = null; window.mobileGuided.localHold = true })
  await photos(page).getByRole('button', { name: '저장 다시 시도', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.mobileGuided.localWaiting)).toBe(true)
  await expect(page.getByRole('status').filter({ hasText: '이 기기에 초안을 저장하고 있어요' })).toBeVisible()
  await expect(page.getByRole('alert').filter({ hasText: '이 기기에 초안을 안전하게 보관하지 못했어요' })).toHaveCount(0)
  await page.evaluate(() => window.mobileGuided.releaseLocal())
  await expect(photos(page)).toHaveAttribute('data-current-photo-target', 'own-car')
  expect(await page.evaluate(async () => (await window.mobileGuided.readCase())?.evidence.length)).toBe(1)
})

test('phone body actions lead from the first target through statement and explicit copy approval', async ({ page }) => {
  await begin(page)
  await expect(page.locator('.product-header')).toHaveCount(0)
  await expect(page.getByRole('navigation', { name: '사고 후 할 일' })).toHaveCount(0)
  await expect(photos(page)).toHaveAttribute('data-current-photo-target', 'scene')
  await photos(page).getByLabel('사진 파일 선택', { exact: true }).setInputFiles(await photoFile(page))
  await expect(page.getByRole('img', { name: '저장 전 현장 전체 사진', exact: true })).toBeVisible()
  await button(page, '이 사진 사용').click()
  await expect(photos(page)).toHaveAttribute('data-current-photo-target', 'own-car')
  await expect(photos(page).locator('[data-photo-count]')).toHaveText('1 / 6')
  await expect(photos(page).locator('[data-photo-skipped]')).toHaveText('생략 0개')
  for (const target of ['own-car', 'other-car', 'plate', 'road-marks', 'signals']) {
    await expect(photos(page)).toHaveAttribute('data-current-photo-target', target)
    await button(page, '지금 촬영하기 어려워요').click()
  }
  await expect(phone(page)).toHaveAttribute('data-record-step', 'voice')
  const microphone = button(page, '말로 기록하기')
  await expect(microphone).toBeVisible()
  await microphone.scrollIntoViewIfNeeded()
  expect(await microphone.evaluate(element => {
    const icon = element.querySelector('svg')!.getBoundingClientRect()
    const action = element.getBoundingClientRect()
    const hit = document.elementFromPoint(icon.x + icon.width / 2, icon.y + icon.height / 2)
    return icon.width > 0 && icon.height > 0 && icon.left >= action.left && icon.top >= action.top && icon.right <= action.right && icon.bottom <= action.bottom && icon.top >= 0 && icon.bottom <= innerHeight && !!hit && element.contains(hit)
  })).toBe(true)
  await button(page, '직접 입력').click()
  await voiceInput(page).fill('오른쪽에서 충격을 느꼈어요. 정확한 경위는 확인 중이에요.')
  await button(page, '기록 저장').click()
  await expect(phone(page)).toHaveAttribute('data-product-stage', 'review')
  await button(page, '내 사본 범위 선택').click()
  await page.getByRole('checkbox', { name: /직접 남긴 내용 1/ }).check()
  await button(page, '선택한 내용 미리보기').click()
  expect(await page.evaluate(async () => (await window.mobileGuided.readCase())?.shares.length)).toBe(0)
  await expect(phone(page)).toHaveAttribute('data-product-stage', 'review')
  await button(page, '이 내용으로 내 사본 준비').click()
  await expect(phone(page)).toHaveAttribute('data-product-stage', 'follow-up')
  expect(await page.evaluate(async () => {
    const value = await window.mobileGuided.readCase()
    return { copies: value?.shares.length, obtained: value?.evidence.filter(item => item.availability === 'available').length, skipped: value?.evidence.filter(item => item.availability === 'skipped').length }
  })).toEqual({ copies: 1, obtained: 1, skipped: 5 })
  await expect(page.getByRole('region', { name: '이후 할 일' }).getByText('보험사 전송 없음 · 접수 미확인', { exact: true })).toBeVisible()
})

test('all photos and the optional statement can be explicitly skipped without inventing a copy', async ({ page }) => {
  await begin(page)
  for (let index = 0; index < 6; index += 1) await button(page, '지금 촬영하기 어려워요').click()
  await button(page, '진술은 지금 생략').click()
  await expect(phone(page)).toHaveAttribute('data-product-stage', 'review')
  await button(page, '사본 없이 후속 안내').click()
  await expect(phone(page)).toHaveAttribute('data-product-stage', 'follow-up')
  expect(await page.evaluate(async () => {
    const value = await window.mobileGuided.readCase()
    return { copies: value?.shares.length, statements: value?.statements.length, obtained: value?.evidence.filter(item => item.availability === 'available').length }
  })).toEqual({ copies: 0, statements: 0, obtained: 0 })
})

test('held duplicate photo saves and failed retries retain the preview and advance exactly one target', async ({ page }) => {
  await begin(page)
  await photos(page).getByLabel('사진 파일 선택', { exact: true }).setInputFiles(await photoFile(page))
  await page.evaluate(() => { window.mobileGuided.hold = { kind: 'photo' }; window.mobileGuided.fail = { kind: 'photo' } })
  await button(page, '이 사진 사용').dblclick()
  await expect.poll(() => page.evaluate(() => window.mobileGuided.waiting)).toBe(true)
  expect(await page.evaluate(() => window.mobileGuided.writes.photo)).toBe(1)
  await expect(photos(page)).toHaveAttribute('data-current-photo-target', 'scene')
  await page.evaluate(() => window.mobileGuided.release())
  await expect(photos(page).getByRole('alert')).toContainText('사진을 저장하지 못했어요')
  await expect(page.getByRole('img', { name: '저장 전 현장 전체 사진', exact: true })).toBeVisible()
  await page.evaluate(() => { window.mobileGuided.fail = null })
  await photos(page).getByRole('button', { name: '저장 다시 시도', exact: true }).click()
  await expect(photos(page)).toHaveAttribute('data-current-photo-target', 'own-car')
  expect(await page.evaluate(async () => (await window.mobileGuided.readCase())?.evidence.length)).toBe(1)
})

test('statement failures and a failed review navigation keep the current text until a successful continuation', async ({ page }) => {
  await statementStep(page)
  await button(page, '직접 입력').click()
  await voiceInput(page).fill('저장에 실패해도 남아 있어야 하는 진술')
  await page.evaluate(() => { window.mobileGuided.fail = { kind: 'voice' } })
  await button(page, '기록 저장').click()
  await expect(page.locator('.journey-voice-message')).toContainText('저장하지 못했어요')
  await expect(voiceInput(page)).toHaveValue('저장에 실패해도 남아 있어야 하는 진술')
  await expect(phone(page)).toHaveAttribute('data-product-stage', 'record')
  await page.evaluate(() => { window.mobileGuided.fail = { kind: 'navigate', stage: 'review' }; window.mobileGuided.hold = { kind: 'voice' } })
  await button(page, '기록 저장').dblclick()
  await expect.poll(() => page.evaluate(() => window.mobileGuided.waiting)).toBe(true)
  expect(await page.evaluate(() => window.mobileGuided.writes.voice)).toBe(2)
  await page.evaluate(() => window.mobileGuided.release())
  await expect(button(page, '내용 확인으로 계속')).toBeEnabled()
  await expect(voiceInput(page)).toHaveValue('저장에 실패해도 남아 있어야 하는 진술')
  await expect(phone(page)).toHaveAttribute('data-product-stage', 'record')
  await page.evaluate(() => { window.mobileGuided.fail = null })
  await button(page, '내용 확인으로 계속').click()
  await expect(phone(page)).toHaveAttribute('data-product-stage', 'review')
})

test('a new risk during the last photo save suspends progression until safety is explicitly rechecked', async ({ page }) => {
  await begin(page, { decided: 5 })
  await expect(photos(page)).toHaveAttribute('data-current-photo-target', 'signals')
  await photos(page).getByLabel('사진 파일 선택', { exact: true }).setInputFiles(await photoFile(page))
  await page.evaluate(() => { window.mobileGuided.hold = { kind: 'photo' } })
  await button(page, '이 사진 사용').click()
  await expect.poll(() => page.evaluate(() => window.mobileGuided.waiting)).toBe(true)
  await button(page, '새 위험이 있어요').click()
  await expect(phone(page)).toHaveAttribute('data-product-stage', 'response')
  await page.evaluate(() => window.mobileGuided.release())
  await expect.poll(() => page.evaluate(async () => (await window.mobileGuided.readCase())?.suspended)).toBe(true)
  await expect(phone(page)).toHaveAttribute('data-record-step', 'photos')
  await button(page, '지금 기록할 수 있어요').click()
  await expect(button(page, '다음 촬영 대상으로')).toBeEnabled()
  await button(page, '다음 촬영 대상으로').click()
  await expect(phone(page)).toHaveAttribute('data-record-step', 'voice')
  expect(await page.evaluate(async () => (await window.mobileGuided.readCase())?.evidence.filter(item => item.assetId).length)).toBe(1)
})

test('dirty statement guards and pause reload preserve the same local draft', async ({ page }) => {
  const caseId = await statementStep(page)
  await button(page, '직접 입력').click()
  await voiceInput(page).fill('쉬었다 돌아와도 유지할 미저장 초안')
  await button(page, '진술은 지금 생략').click()
  await expect(phone(page)).toHaveAttribute('data-product-stage', 'record')
  await expect(voiceInput(page)).toHaveValue('쉬었다 돌아와도 유지할 미저장 초안')
  await button(page, '잠시 쉬기').click()
  await expect(phone(page)).toHaveAttribute('data-product-stage', 'response')
  await expect.poll(() => page.evaluate(() => window.mobileGuided.readVoice())).toBe('쉬었다 돌아와도 유지할 미저장 초안')
  await page.reload()
  await mount(page, caseId)
  await button(page, '지금 기록할 수 있어요').click()
  await button(page, '진술로 계속').click()
  await expect(voiceInput(page)).toHaveValue('쉬었다 돌아와도 유지할 미저장 초안')
  await button(page, '기록 저장').click()
  await expect(phone(page)).toHaveAttribute('data-product-stage', 'review')
})

test('failed copy approval preserves the preview and failed follow-up navigation retries without a second approval', async ({ page }) => {
  await copyPreview(page)
  await page.evaluate(() => { window.mobileGuided.fail = { kind: 'copy' } })
  await button(page, '이 내용으로 내 사본 준비').click()
  await expect(page.getByRole('region', { name: '내 사본 미리보기' })).toBeVisible()
  await expect(page.locator('.journey-submission').getByRole('alert')).toContainText('사본을 서버에 보관하지 못했어요')
  expect(await page.evaluate(async () => (await window.mobileGuided.readCase())?.shares.length)).toBe(0)
  await page.evaluate(() => { window.mobileGuided.fail = { kind: 'navigate', stage: 'follow-up' } })
  await button(page, '이 내용으로 내 사본 준비').click()
  await expect(button(page, '후속 안내로 계속')).toBeEnabled()
  await expect(phone(page)).toHaveAttribute('data-product-stage', 'review')
  expect(await page.evaluate(async () => (await window.mobileGuided.readCase())?.shares.length)).toBe(1)
  expect(await page.evaluate(() => window.mobileGuided.writes.copy)).toBe(2)
  await page.evaluate(() => { window.mobileGuided.fail = null })
  await button(page, '후속 안내로 계속').click()
  await expect(phone(page)).toHaveAttribute('data-product-stage', 'follow-up')
  expect(await page.evaluate(() => window.mobileGuided.writes.copy)).toBe(2)
})

test('an approval finishing behind a new risk retains the copy without invoking hidden progression', async ({ page }) => {
  await copyPreview(page)
  await page.evaluate(() => { window.mobileGuided.hold = { kind: 'copy' } })
  await button(page, '이 내용으로 내 사본 준비').dblclick()
  await expect.poll(() => page.evaluate(() => window.mobileGuided.waiting)).toBe(true)
  await button(page, '새 위험이 있어요').click()
  await page.evaluate(() => window.mobileGuided.release())
  await expect.poll(() => page.evaluate(async () => (await window.mobileGuided.readCase())?.suspended)).toBe(true)
  await expect(phone(page)).toHaveAttribute('data-product-stage', 'response')
  expect(await page.evaluate(() => window.mobileGuided.followups)).toBe(0)
  expect(await page.evaluate(() => window.mobileGuided.writes.copy)).toBe(1)
  await button(page, '지금 기록할 수 있어요').click()
  await expect(button(page, '후속 안내로 계속')).toBeEnabled()
  await button(page, '후속 안내로 계속').click()
  await expect(phone(page)).toHaveAttribute('data-product-stage', 'follow-up')
  expect(await page.evaluate(() => window.mobileGuided.writes.copy)).toBe(1)
})

test('a failed photo and its queued save survive reload, then reconnect without a duplicate photo', async ({ page }) => {
  const caseId = await begin(page)
  await photos(page).getByLabel('사진 파일 선택', { exact: true }).setInputFiles(await photoFile(page))
  await page.evaluate(() => { window.mobileGuided.fail = { kind: 'photo' } })
  await button(page, '이 사진 사용').click()
  await expect(photos(page).getByRole('alert')).toContainText('사진을 저장하지 못했어요')
  await expect.poll(() => page.evaluate(() => window.mobileGuided.readPhoto())).toBeGreaterThan(0)
  await page.reload()
  await mount(page, caseId, { kind: 'photo' })
  await expect.poll(() => page.evaluate(() => window.mobileGuided.readPhoto())).toBeGreaterThan(0)
  expect(await page.evaluate(async () => (await window.mobileGuided.readCase())?.evidence.length)).toBe(0)
  await page.evaluate(() => { window.mobileGuided.fail = null })
  await button(page, '지금 기록할 수 있어요').click()
  await expect(photos(page)).toHaveAttribute('data-current-photo-target', 'own-car')
  expect(await page.evaluate(async () => (await window.mobileGuided.readCase())?.evidence.length)).toBe(1)
})

test('a revision conflict preserves the photo while latest content is loaded and retried', async ({ page }) => {
  await begin(page)
  await photos(page).getByLabel('사진 파일 선택', { exact: true }).setInputFiles(await photoFile(page))
  await page.evaluate(() => { window.mobileGuided.hold = { kind: 'photo' } })
  await button(page, '이 사진 사용').click()
  await expect.poll(() => page.evaluate(() => window.mobileGuided.waiting)).toBe(true)
  await page.evaluate(async () => {
    const root = '/src/'
    const { reduceCase } = await import(root + 'journey/case.ts') as typeof CaseDomainModule
    const { commitCase } = await import(root + 'journey/case-store.ts') as typeof CaseStoreModule
    const current = await window.mobileGuided.readCase()
    if (!current) throw new Error('Missing case')
    const latest = reduceCase(current, { type: 'statement-edit', id: 'primary-statement', text: '다른 기기에서 남긴 최신 진술', audioEvidenceIds: [] })
    const saved = await commitCase(latest, current.revision)
    if (!saved.ok) throw new Error(saved.reason)
  })
  await page.evaluate(() => window.mobileGuided.release())
  await expect(button(page, '내 입력을 보존하고 최신 기록 보기')).toBeEnabled()
  await expect(page.getByRole('img', { name: '저장 전 현장 전체 사진', exact: true })).toBeVisible()
  await button(page, '내 입력을 보존하고 최신 기록 보기').click()
  await expect(photos(page).getByRole('button', { name: '저장 다시 시도', exact: true })).toBeEnabled()
  await expect(page.getByRole('img', { name: '저장 전 현장 전체 사진', exact: true })).toBeVisible()
  await photos(page).getByRole('button', { name: '저장 다시 시도', exact: true }).click()
  await expect(photos(page)).toHaveAttribute('data-current-photo-target', 'own-car')
  expect(await page.evaluate(async () => (await window.mobileGuided.readCase())?.statements[0].text)).toBe('다른 기기에서 남긴 최신 진술')
})
