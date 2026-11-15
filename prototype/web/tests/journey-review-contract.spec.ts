/// <reference lib="es2024.promise" />
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import type * as ReactRuntime from './react-runtime'
import type * as ReviewModule from '../src/journey/JourneyReviewPanel'
import type * as LayoutModule from '../src/journey/JourneyLayout'
import type * as DataModule from '../src/journey/case-data'
import type * as DomainModule from '../src/journey/case'
import type * as SessionModule from '../src/emergency/session'
import type * as StoreModule from '../src/journey/case-store'
import type * as ExampleModule from '../src/journey/example-report'
import type * as ProductModule from '../src/product/product-case'

declare global {
  interface Window {
    reportReviewOpenReport: () => void
    reportReviewOpenSubmission: () => void
    reportReviewDeliverExample: () => Promise<void>
    reportReviewCompleteReceipt: () => Promise<void>
    reportReviewApprovals: DomainModule.ApprovalInput[]
    reportReviewCopyPrepared: number
    reportReviewPreparations: number
    reportReviewReleasePreparation: () => void
    reportReviewRestoreCaseWrites?: () => void
    reportReviewReadCase: () => Promise<DomainModule.JourneyCase | null>
    reportReviewCommand: (command: DomainModule.CaseCommand) => Promise<DomainModule.CommitResult>
  }
}

async function mountReview(page: Page, options: { mode?: 'study' | 'product'; media?: boolean; prepare?: boolean; holdPreparation?: boolean; empty?: boolean } = {}) {
  await page.setViewportSize({ width: 393, height: 852 })
  await page.goto('/?study=journey-catalog')
  await page.evaluate(async options => {
    // Vite modules must load inside the browser realm, not Playwright's Node process.
    const runtimePath = '/tests/react-runtime.ts'
    const reviewPath = '/src/journey/JourneyReviewPanel.tsx'
    const layoutPath = '/src/journey/JourneyLayout.tsx'
    const dataPath = '/src/journey/case-data.tsx'
    const domainPath = '/src/journey/case.ts'
    const sessionPath = '/src/emergency/session.ts'
    const storePath = '/src/journey/case-store.ts'
    const examplePath = '/src/journey/example-report.ts'
    const productPath = '/src/product/product-case.ts'
    const { React, createRoot }: typeof ReactRuntime = await import(/* @vite-ignore */ runtimePath)
    const { JourneyReviewPanel }: typeof ReviewModule = await import(/* @vite-ignore */ reviewPath)
    const { JourneyLayout }: typeof LayoutModule = await import(/* @vite-ignore */ layoutPath)
    const { CaseDataProvider, studyCaseData }: typeof DataModule = await import(/* @vite-ignore */ dataPath)
    const domain: typeof DomainModule = await import(/* @vite-ignore */ domainPath)
    const { createSession }: typeof SessionModule = await import(/* @vite-ignore */ sessionPath)
    const { commitCase, loadCase }: typeof StoreModule = await import(/* @vite-ignore */ storePath)
    const { createExampleReport }: typeof ExampleModule = await import(/* @vite-ignore */ examplePath)
    const { createProductCase }: typeof ProductModule = await import(/* @vite-ignore */ productPath)
    const mode = options.mode ?? 'study'
    const now = '2026-11-15T09:12:00.000Z'
    let value = mode === 'product' ? createProductCase(crypto.randomUUID(), now) : domain.createCase(createSession('SC01', 'connected'), crypto.randomUUID(), now)
    value.stage = 'review'
    value.fixtureId = mode === 'study' ? 'partial-evidence' : null
    const assets: DomainModule.AssetWrite[] = []
    if (options.media !== false) {
      const sources: { id: string; label: string; kind: DomainModule.EvidenceKind; path: string }[] = [
        { id: 'front', label: '전방 영상', kind: 'video', path: '/journey-samples/front-20s.mp4' },
        { id: 'photo', label: '현장 전체 사진', kind: 'photo', path: '/journey-samples/scene.png' },
        { id: 'audio', label: '음성 진술', kind: 'audio', path: '/journey-samples/voice-statement-ko-v1.wav' },
      ]
      for (const source of sources) {
        const response = await fetch(source.path)
        if (!response.ok) throw new Error('Cannot load report evidence fixture')
        const blob = await response.blob()
        let duration: number | null = null
        if (source.kind !== 'photo') {
          const media = document.createElement(source.kind)
          const url = URL.createObjectURL(blob)
          try {
            const { promise, resolve, reject } = Promise.withResolvers<number>()
            media.onloadedmetadata = () => Number.isFinite(media.duration) && media.duration > 0 ? resolve(media.duration) : reject(new Error('Invalid evidence duration'))
            media.onerror = () => reject(new Error('Cannot decode report evidence fixture'))
            media.preload = 'metadata'; media.src = url; media.load()
            duration = await promise
          } finally { media.removeAttribute('src'); media.load(); URL.revokeObjectURL(url) }
        }
        const assetId = crypto.randomUUID()
        value = domain.reduceCase(value, { type: 'evidence-put', evidence: { id: source.id, label: source.label, revision: 1, kind: source.kind, origin: 'sample', availability: 'available', assetId,
          captureTarget: source.kind === 'photo' ? 'scene' : null, metadata: { mime: blob.type, bytes: blob.size, duration, capturedAt: now, sourceLabel: '시연 자료' } } })
        assets.push({ id: assetId, caseId: value.id, blob })
      }
    }
    if (!options.empty) value = domain.reduceCase(value, { type: 'statement-edit', id: 'statement', text: '정차 중 오른쪽에서 충격을 느꼈어요. 정확한 사고 경위는 확인 중이에요.', audioEvidenceIds: value.evidence.some(item => item.id === 'audio') ? ['audio'] : [] })
    if (mode === 'study' && !options.empty) {
      const report = createExampleReport(value)
      if (!report) throw new Error('Expected an example report from the current evidence')
      value = domain.reduceCase(value, { type: 'report-result', report })
    }
    const saved = await commitCase(value, null, assets)
    if (!saved.ok) throw new Error(saved.reason)
    value = saved.value
    const ref = React.createRef<ReviewModule.JourneyReviewHandle>()
    window.reportReviewApprovals = []
    window.reportReviewCopyPrepared = 0
    window.reportReviewPreparations = 0
    const preparationGate = options.holdPreparation ? Promise.withResolvers<void>() : null
    window.reportReviewReleasePreparation = () => preparationGate?.resolve()
    document.getElementById('root')!.hidden = true
    const target = document.createElement('div')
    target.dataset.testid = 'report-review-contract'
    document.body.append(target)
    const root = createRoot(target)
    async function onCommand(command: DomainModule.CaseCommand): Promise<DomainModule.CommitResult> {
      const result = await commitCase(domain.reduceCase(value, command), value.revision)
      if (result.ok) { value = result.value; render() }
      return result
    }
    window.reportReviewReadCase = () => loadCase(value.id)
    window.reportReviewCommand = onCommand
    async function onApprove(input: DomainModule.ApprovalInput): Promise<DomainModule.ApprovalCommitResult> {
      window.reportReviewApprovals.push(structuredClone(input))
      const approved = input.kind === 'share' ? domain.makeShare(value, input) : domain.makeSubmission(value, input)
      if (!approved.ok) return approved
      const result = await commitCase(approved.value, value.revision)
      if (result.ok) { value = result.value; render() }
      return result
    }
    const onPrepareExample = options.prepare ? async () => {
      window.reportReviewPreparations++
      await preparationGate?.promise
      const report = createExampleReport(value)
      if (!report) return false
      const result = await onCommand({ type: 'report-result', report })
      return result.ok
    } : undefined
    function render() {
      root.render(React.createElement(CaseDataProvider, { data: studyCaseData, children: React.createElement(JourneyLayout, { device: 'mobile', summary: React.createElement('p', {}, '현재 기록 검토'),
        children: React.createElement(JourneyReviewPanel, { ref, mode, value, saving: false, reloading: false, explicitTransport: true, onCommand, onApprove, onPrepareExample,
          onCopyPrepared: async () => { window.reportReviewCopyPrepared++; return true } }) }) }))
    }
    window.reportReviewOpenReport = () => ref.current?.openReport()
    window.reportReviewOpenSubmission = () => ref.current?.openSubmission()
    window.reportReviewDeliverExample = async () => {
      const report = createExampleReport(value)
      if (!report) throw new Error('No example report available')
      const result = await onCommand({ type: 'report-result', report })
      if (!result.ok) throw new Error(result.reason)
      ref.current?.openReport()
    }
    window.reportReviewCompleteReceipt = async () => {
      const submissionId = value.activeSubmissionIds.insurance
      if (!submissionId) throw new Error('No explicitly approved insurance request')
      for (const command of [
        { type: 'transport-start', caseId: value.id, submissionId, now },
        { type: 'transport-result', caseId: value.id, submissionId, status: 'sent', now },
        { type: 'request-result', caseId: value.id, agency: 'insurance', submissionId, status: 'received', now,
          externalReceipt: { number: '시연-0000', agencyName: '시연 보험사', receivedAt: now, next: '차량 지원·정비소 안내를 확인하세요.' } },
      ] satisfies DomainModule.CaseCommand[]) {
        const result = await onCommand(command)
        if (!result.ok) throw new Error(result.reason)
      }
    }
    render()
  }, options)
  const root = page.getByTestId('report-review-contract')
  await expect(root.getByRole('button', { name: '경위서', exact: true })).toBeVisible()
  return root
}

test('openReport reveals the report without erasing a dirty sentence or permitting implicit replacement', async ({ page }) => {
  const root = await mountReview(page)
  await page.evaluate(() => window.reportReviewOpenReport())
  const first = root.getByRole('article', { name: '문장 1', exact: true })
  await expect(root.locator('.journey-report-example').getByText('예시 경위서', { exact: true })).toBeVisible()
  await first.getByRole('button', { name: '정정하기', exact: true }).click()
  await first.getByLabel('문장 내용', { exact: true }).fill('내가 확인한 내용만 남긴 수정 초안이에요.')
  await root.getByRole('button', { name: '사고 영상', exact: true }).click()
  await page.evaluate(() => window.reportReviewOpenReport())
  await expect(first.getByLabel('문장 내용', { exact: true })).toHaveValue('내가 확인한 내용만 남긴 수정 초안이에요.')
  await page.evaluate(() => window.reportReviewOpenSubmission())
  await expect(first.getByLabel('문장 내용', { exact: true })).toBeVisible()
  await page.evaluate(() => window.reportReviewDeliverExample())
  await expect(first.getByLabel('문장 내용', { exact: true })).toHaveValue('내가 확인한 내용만 남긴 수정 초안이에요.')
  await root.getByText('새 초안 비교', { exact: true }).click()
  await expect(root.getByRole('button', { name: '이 초안으로 교체', exact: true })).toBeDisabled()
  await first.getByRole('button', { name: '정정 저장', exact: true }).click()
  await expect(first.getByText('확인 필요', { exact: true })).toBeVisible()
  await expect(first.getByText('내가 확인한 내용만 남긴 수정 초안이에요.', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => window.reportReviewApprovals)).toEqual([])
})

test('each generated media reference opens its actual video, photo or spoken recording with the example label', async ({ page }) => {
  const root = await mountReview(page)
  await page.evaluate(() => window.reportReviewOpenReport())
  for (const [index, kind] of [[1, 'video'], [2, 'img'], [3, 'audio']] as const) {
    const paragraph = root.getByRole('article', { name: `문장 ${index}`, exact: true })
    await paragraph.getByRole('button', { name: '근거 보기', exact: true }).click()
    const drawer = root.getByRole('dialog', { name: '문장의 근거', exact: true })
    await expect(drawer.getByText('예시 경위서', { exact: true })).toBeVisible()
    if (kind === 'video') await expect(drawer.getByRole('button', { name: '전방 영상 재생', exact: true })).toBeEnabled()
    else if (kind === 'img') await expect.poll(() => drawer.locator('img').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0)
    else await expect.poll(() => drawer.locator('audio').evaluate((audio: HTMLAudioElement) => audio.readyState)).toBeGreaterThanOrEqual(2)
    await expect(drawer.getByText('근거를 열 수 없어요', { exact: true })).toHaveCount(0)
    await drawer.getByRole('button', { name: '근거 닫기', exact: true }).click()
    await paragraph.getByRole('button', { name: '문장 확인', exact: true }).click()
    await expect(paragraph.getByText('내용 확인함', { exact: true })).toBeVisible()
  }
  await expect(root.getByRole('article', { name: '문장 4', exact: true }).getByText('미확인', { exact: true })).toBeVisible()
})

test('report selection and preview require explicit approval and receipts remain visibly simulated', async ({ page }) => {
  const root = await mountReview(page)
  await page.evaluate(() => window.reportReviewOpenReport())
  for (const paragraph of await root.getByRole('article').all()) {
    await paragraph.getByRole('button', { name: '문장 확인', exact: true }).click()
    await expect(paragraph.getByText('내용 확인함', { exact: true })).toBeVisible()
  }
  await root.getByRole('button', { name: '보낼 내용 확인', exact: true }).click()
  await expect(root.getByText('시연 · 실제 외부 전송 없음', { exact: true })).toBeVisible()
  await root.getByLabel('수신처', { exact: true }).fill('시연 보험사')
  await root.getByRole('checkbox', { name: '경위서', exact: true }).check()
  await root.getByRole('button', { name: '선택한 내용 미리보기', exact: true }).click()
  await expect(root.getByText('선택한 자료와 경위서의 근거를 다시 확인해주세요. 경위서에 연결된 자료도 함께 선택해야 해요.', { exact: true })).toBeVisible()
  for (const label of ['전방 영상', '현장 전체 사진', '음성 진술']) await root.getByRole('checkbox', { name: label, exact: true }).check()
  await root.getByRole('button', { name: '선택한 내용 미리보기', exact: true }).click()
  await expect(root.getByRole('region', { name: '보낼 내용 미리보기', exact: true }).getByText('예시 경위서', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => window.reportReviewApprovals)).toEqual([])
  await root.getByRole('button', { name: '선택 다시 하기', exact: true }).click()
  await expect(root.getByRole('checkbox', { name: '경위서', exact: true })).toBeChecked()
  await root.getByRole('button', { name: '선택한 내용 미리보기', exact: true }).click()
  await root.getByRole('button', { name: '이 내용으로 요청', exact: true }).click()
  await expect(root.getByText('승인한 내용이 보관됐어요', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => window.reportReviewApprovals)).toHaveLength(1)
  await page.evaluate(() => window.reportReviewCompleteReceipt())
  const receipt = root.getByRole('region', { name: '요청 결과', exact: true })
  await expect(receipt.getByText('시연 결과 · 실제 접수 아님', { exact: true })).toBeVisible()
  await expect(receipt.getByText('시연-0000', { exact: true })).toBeVisible()
  await expect(receipt.getByText('시연 접수번호 · 실제 보험사·차량 지원 접수번호가 아니에요.', { exact: true })).toBeVisible()
})

test('a failed sentence save keeps the draft and the explicit approval boundary', async ({ page }) => {
  const root = await mountReview(page, { media: false })
  await page.evaluate(() => window.reportReviewOpenReport())
  const first = root.getByRole('article', { name: '문장 1', exact: true })
  await first.getByRole('button', { name: '정정하기', exact: true }).click()
  await first.getByLabel('문장 내용', { exact: true }).fill('저장에 실패해도 남아 있어야 하는 정정이에요.')
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'cases') throw new DOMException('Full', 'QuotaExceededError')
      return original.apply(this, args)
    }
    window.reportReviewRestoreCaseWrites = () => { IDBObjectStore.prototype.put = original }
  })
  await first.getByRole('button', { name: '정정 저장', exact: true }).click()
  await expect(first.getByText('저장하지 못했어요. 정정 내용은 이 화면에 남아 있어요.', { exact: true })).toBeVisible()
  await expect(first.getByLabel('문장 내용', { exact: true })).toHaveValue('저장에 실패해도 남아 있어야 하는 정정이에요.')
  await page.evaluate(() => window.reportReviewOpenSubmission())
  await expect(first.getByLabel('문장 내용', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => window.reportReviewApprovals)).toEqual([])
  await page.evaluate(() => window.reportReviewRestoreCaseWrites?.())
  await first.getByRole('button', { name: '정정 저장', exact: true }).click()
  await expect(first.getByText('저장에 실패해도 남아 있어야 하는 정정이에요.', { exact: true })).toBeVisible()
  await expect(first.getByText('확인 필요', { exact: true })).toBeVisible()
})

test('product mode keeps CopyPanel and invokes its continuation only after explicit copy approval', async ({ page }) => {
  const root = await mountReview(page, { mode: 'product', media: false })
  await expect(root.getByRole('button', { name: '사진·음성·글', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await root.getByRole('button', { name: '이 내용 확인', exact: true }).click()
  await expect(root.getByText('내용 확인함', { exact: true })).toBeVisible()
  await root.getByRole('button', { name: '내 사본 범위 선택', exact: true }).click()
  await expect(root.getByRole('region', { name: '내 사본 범위 확인', exact: true })).toBeVisible()
  await expect(root.getByRole('region', { name: '전송 검토', exact: true })).toHaveCount(0)
  await expect(root.getByText('시연 · 실제 외부 전송 없음', { exact: true })).toHaveCount(0)
  await root.getByRole('checkbox', { name: /^직접 남긴 내용 1/ }).check()
  await root.getByRole('button', { name: '선택한 내용 미리보기', exact: true }).click()
  expect(await page.evaluate(() => window.reportReviewApprovals)).toEqual([])
  expect(await page.evaluate(() => window.reportReviewCopyPrepared)).toBe(0)
  expect(await page.evaluate(async () => (await window.reportReviewReadCase())?.shares)).toEqual([])
  await root.getByRole('button', { name: '이 내용으로 내 사본 준비', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.reportReviewCopyPrepared)).toBe(1)
  const approvals = await page.evaluate(() => window.reportReviewApprovals)
  expect(approvals).toHaveLength(1)
  expect(approvals[0]).toMatchObject({ kind: 'share', selection: { statementIds: ['statement'], evidenceIds: [], includeDiagram: false, includeReport: false } })
  const approved = await page.evaluate(() => window.reportReviewReadCase())
  expect(approved?.shares).toHaveLength(1)
  const copy = approved!.shares[0]
  expect(copy.payload).toMatchObject({
    observations: [], evidence: [], diagram: null, report: null,
    statements: [{ id: 'statement', text: '정차 중 오른쪽에서 충격을 느꼈어요. 정확한 사고 경위는 확인 중이에요.' }],
  })
  expect(copy.payload.statements).toHaveLength(1)
  const edited = await page.evaluate(() => window.reportReviewCommand({ type: 'statement-edit', id: 'statement', text: '사본 승인 뒤 정정한 현재 기록이에요.', audioEvidenceIds: [] }))
  expect(edited.ok).toBe(true)
  const latest = await page.evaluate(() => window.reportReviewReadCase())
  expect(latest?.statements[0].text).toBe('사본 승인 뒤 정정한 현재 기록이에요.')
  expect(latest?.shares[0]).toEqual(copy)
})

test('the product example action opens a labelled report only after its explicit preparation succeeds', async ({ page }) => {
  const root = await mountReview(page, { mode: 'product', media: false, prepare: true, holdPreparation: true })
  const prepare = root.getByRole('button', { name: '예시 경위서 만들기', exact: true })
  await expect(prepare).toBeVisible()
  expect(await page.evaluate(() => window.reportReviewPreparations)).toBe(0)
  await prepare.click()
  await expect(root.locator('.journey-review-content')).toHaveAttribute('aria-busy', 'true')
  await root.getByRole('button', { name: '예시 경위서 만드는 중', exact: true, includeHidden: true }).dispatchEvent('click')
  expect(await page.evaluate(() => window.reportReviewPreparations)).toBe(1)
  await expect(root.getByRole('button', { name: '사진·음성·글', exact: true, includeHidden: true })).toHaveAttribute('aria-pressed', 'true')
  await page.evaluate(() => window.reportReviewReleasePreparation())
  await expect(root.getByRole('button', { name: '경위서', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(root.locator('.journey-report-example').getByText('예시 경위서', { exact: true })).toBeVisible()
  await expect(root.getByRole('article', { name: '문장 1', exact: true }).getByText('정차 중 오른쪽에서 충격을 느꼈어요. 정확한 사고 경위는 확인 중이에요.', { exact: true })).toBeVisible()
  await root.getByRole('article', { name: '문장 1', exact: true }).getByRole('button', { name: '정정하기', exact: true }).click()
  await root.getByLabel('문장 내용', { exact: true }).fill('새 예시보다 먼저 보관할 정정 초안이에요.')
  await expect(root.getByRole('button', { name: '예시 경위서 만들기', exact: true })).toBeDisabled()
  expect(await page.evaluate(() => window.reportReviewPreparations)).toBe(1)
  expect(await page.evaluate(() => window.reportReviewApprovals)).toEqual([])
  await root.getByRole('button', { name: '정정 취소', exact: true }).click()
  for (const paragraph of await root.getByRole('article').all()) {
    await paragraph.getByRole('button', { name: '문장 확인', exact: true }).click()
    await expect(paragraph.getByText('내용 확인함', { exact: true })).toBeVisible()
  }
  await root.getByRole('button', { name: '내 사본 범위 선택', exact: true }).click()
  await root.getByRole('checkbox', { name: '확인한 경위서', exact: true }).check()
  await root.getByRole('button', { name: '선택한 내용 미리보기', exact: true }).click()
  await expect(root.getByRole('region', { name: '내 사본 미리보기', exact: true }).getByText('예시 경위서', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => window.reportReviewApprovals)).toEqual([])
})

test('an example preparation without evidence or statements stays on the current product records screen', async ({ page }) => {
  const root = await mountReview(page, { mode: 'product', media: false, empty: true, prepare: true })
  await root.getByRole('button', { name: '예시 경위서 만들기', exact: true }).click()
  await expect(root.getByText('예시 경위서를 만들지 못했어요. 자료 상태를 확인해주세요. 현재 입력은 그대로 있어요.', { exact: true })).toBeVisible()
  await expect(root.getByRole('button', { name: '사진·음성·글', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(root.getByRole('button', { name: '예시 경위서 만들기', exact: true })).toBeEnabled()
  expect(await page.evaluate(() => window.reportReviewPreparations)).toBe(1)
  expect(await page.evaluate(() => window.reportReviewApprovals)).toEqual([])
})
