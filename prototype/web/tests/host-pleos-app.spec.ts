import { test, expect, type Page } from '@playwright/test'
import { build, preview, type PreviewServer } from 'vite'
import { fileURLToPath } from 'node:url'
import { enterJourneyRecord, openExampleReport, storedJourney as stored } from './helpers/scenario-journey'

type BridgeCall = { method: 'handoff'; command: string; argument: unknown } | { method: 'dial'; number: string }
type Size = { width: number; height: number }
type Bridge = { demo?: boolean; dial?: string; windowPx?: Size; handoff?: boolean }
type Box = Size & { x: number; y: number }

declare global {
  interface Window { bridgeCalls: BridgeCall[]; nativeFake: { claim(): void } }
}

test.use({ viewport: { width: 1682, height: 1210 }, launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] } })

// Mirrors the Android bridge: string-only calls in, CustomEvents out on the next task.
async function installBridge(page: Page, { demo = false, dial = 'opened', windowPx, handoff = true }: Bridge = {}) {
  await page.addInitScript(({ demo, dial, windowPx, handoff }) => {
    const later = () => new Date(Date.now() + 600_000).toISOString()
    const emit = (detail: unknown) => setTimeout(() => window.dispatchEvent(new CustomEvent('chabun:handoff', { detail })))
    const progress = (paired: boolean, photos: number) => ({ schemaVersion: 1, caseId: 'server-case', revision: photos + 1, updatedAt: new Date().toISOString(),
      stage: 'record', returnStage: null, suspended: false, riskCheckRequired: false, scene: { id: 'record', title: '기록', body: '', actions: [] },
      phone: { paired, online: paired, lastSeenAt: paired ? new Date().toISOString() : null, clientId: paired ? 'phone-1' : null },
      record: { photos, audio: 0, video: 0, statement: 'empty', report: 'empty' }, copy: { id: null, preparedAt: null }, insurance: { integration: 'unavailable', receipt: null } })
    const pair = { pairId: 'pair-1', joinUrl: 'https://demo.example/phone#pair-1', expiresAt: later() }
    window.bridgeCalls = []
    window.nativeFake = { claim: () => emit({ kind: 'pairing', pair, progress: progress(false, 0),
      claims: [{ claimId: 'claim-1', verificationCode: '123456', deviceLabel: 'Galaxy S25', expiresAt: later() }] }) }
    window.ChabunNative = {
      host: () => JSON.stringify({ version: 1, demo, handoff, sdk: '2.3.2', environment: 'emulator', ...windowPx && { windowPx } }),
      handoff(command, argJson) {
        const argument: unknown = JSON.parse(argJson)
        window.bridgeCalls.push({ method: 'handoff', command, argument })
        if (command === 'journey') emit({ kind: 'idle' })
        if (command === 'start') { emit({ kind: 'starting' }); emit({ kind: 'pairing', pair, claims: [], progress: progress(false, 0) }) }
        if (command === 'approve') emit({ kind: 'connected', progress: progress(true, 2) })
      },
      dial(number) {
        window.bridgeCalls.push({ method: 'dial', number })
        return dial
      },
    }
  }, { demo, dial, windowPx, handoff })
}

const flow = (page: Page) => page.getByTestId('journey-flow')
async function open(page: Page, bridge?: Bridge) {
  await installBridge(page, bridge)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/?host=pleos-app')
  await expect(flow(page)).toHaveAttribute('data-step', '1')
}
const bridgeCalls = (page: Page) => page.evaluate(() => window.bridgeCalls)
const dials = async (page: Page) => (await bridgeCalls(page)).flatMap(call => call.method === 'dial' ? [call.number] : [])
const handoffs = async (page: Page) => (await bridgeCalls(page)).flatMap(call => call.method === 'handoff' ? [{ command: call.command, argument: call.argument }] : [])
function sendFact(page: Page, fact: Record<string, unknown>) {
  return page.evaluate(detail => { window.dispatchEvent(new CustomEvent('chabun:vehicle-fact', { detail })) },
    { signal: 'seat-airbag-deployed', seatId: 'ROW_1_LEFT', sdkVersion: '2.3.2', observedAt: new Date().toISOString(), ...fact })
}
function expectBox(box: Box | null, expected: Box) {
  if (!box) throw new Error('element has no box')
  for (const key of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(box[key] - expected[key]), key).toBeLessThanOrEqual(1)
}

const windows = [
  { name: 'full window', viewport: { width: 1682, height: 1210 }, deviceScaleFactor: 1, windowPx: { width: 1682, height: 1210 }, mode: 'wide', shot: 'hybrid-web-host' },
  { name: 'split window', viewport: { width: 841, height: 1210 }, deviceScaleFactor: 1, windowPx: { width: 841, height: 1210 }, mode: 'narrow', shot: 'hybrid-web-host-split' },
  { name: 'full window in the Pleos WebView (DPR 1.375)', viewport: { width: 1224, height: 880 }, deviceScaleFactor: 1.375, windowPx: { width: 1682, height: 1210 }, mode: 'wide', shot: 'hybrid-web-host-webview' },
  { name: 'split window without windowPx (DPR fallback)', viewport: { width: 612, height: 880 }, deviceScaleFactor: 1.375, windowPx: undefined, mode: 'narrow', shot: 'hybrid-web-host-webview-split' },
] as const

for (const target of windows) test.describe(target.name, () => {
  test.use({ viewport: target.viewport, deviceScaleFactor: target.deviceScaleFactor })
  test('renders only the app window, laid out at physical pixels and filling the viewport', async ({ page }) => {
    await open(page, { windowPx: target.windowPx })
    const physical = target.windowPx ?? { width: Math.round(target.viewport.width * target.deviceScaleFactor), height: Math.round(target.viewport.height * target.deviceScaleFactor) }
    const shell = flow(page).locator('[data-care-component=vehicle-shell][data-pleos-app]')
    await expect(shell).toHaveAttribute('data-flow-mode', target.mode)
    for (const selector of ['[data-system]', '.ac-vehicle-status', '.ac-vehicle-dock', '.ac-pleos-other-app', '.ac-display-controls', '.fs-stages', '.journey-flow-actions',
      '.journey-flow-options', '.journey-review-controls', '.journey-review-heading', '.journey-controls-standalone', '.host-demo-strip']) await expect(page.locator(selector), selector).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^(이전|다음)/ })).toHaveCount(0)

    expect(await shell.evaluate(node => node instanceof HTMLElement ? [node.offsetWidth, node.offsetHeight] : [])).toEqual([physical.width, physical.height])
    expect(await page.getByTestId('flow-board').evaluate(node => [node.clientWidth, node.clientHeight])).toEqual([physical.width, physical.height])
    expectBox(await shell.boundingBox(), { x: 0, y: 0, ...target.viewport })
    expect(await shell.evaluate(node => getComputedStyle(node).getPropertyValue('--ac-type-body').trim())).toBe('1.625rem')
    expect(await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.scrollHeight])).toEqual([target.viewport.width, target.viewport.height])

    const slot = (id: string) => flow(page).locator(`[data-cell=${id}] .fs-cell-body`).evaluate(node => node instanceof HTMLElement ? Number(node.dataset.slotX) : NaN)
    if (target.mode === 'wide') {
      const [scene, guide, record] = [await slot('scene'), await slot('guide'), await slot('record')]
      expect(scene).toBeLessThan(guide)
      expect(guide).toBeLessThan(record)
    }
    const touchHeights = await flow(page).locator('.ac-action:visible').evaluateAll(nodes => nodes.map(node => node instanceof HTMLElement ? node.offsetHeight : 0))
    expect(touchHeights.length).toBeGreaterThan(0)
    expect(Math.min(...touchHeights)).toBeGreaterThanOrEqual(48)
    await page.screenshot({ path: `/tmp/${target.shot}.png` })
  })
})

test('a deployed airbag reading opens the phone screen once after ten seconds and never confirms a call', async ({ page }) => {
  await page.clock.install()
  await open(page)
  const emergency = flow(page).locator('[data-cell=emergency]')
  await expect(emergency.getByRole('button', { name: '지금 연결', exact: true })).toBeHidden()
  await sendFact(page, { kind: 'reading', value: true, source: 'simulation' })
  await expect(page.getByTestId('flow-board')).toHaveAttribute('data-target', 'emergency')
  await expect(flow(page).locator('[data-cell=guide]')).toContainText('에어백 전개 신호가 왔어요')
  await expect(emergency.getByLabel('119 전화 화면 열기까지', { exact: true })).toHaveText('10초')
  await expect(flow(page).locator('[data-cell=vehicle]')).toContainText('펼쳐짐')
  const before = await stored(page)
  expect(before.observations.filter(item => item.kind === 'seat-airbag-deployed')).toMatchObject([{ value: '펼쳐짐', source: 'fixture', confirmation: 'attention' }])
  expect(before.safetyActions.some(item => item.id === 'injury-reported')).toBe(false)
  expect(before.submissions).toHaveLength(0)
  await page.clock.runFor(9000)
  expect(await dials(page)).toEqual([])
  await page.clock.runFor(1100)
  await expect(flow(page)).toHaveAttribute('data-call', 'connecting')
  await expect(emergency).toContainText('119 전화 화면을 열었어요')
  await expect(emergency).toContainText('실제 통화·구호 접수 미확인')
  await sendFact(page, { kind: 'reading', value: true, source: 'simulation' })
  await sendFact(page, { kind: 'reading', value: false, source: 'simulation', seatId: 'ROW_1_RIGHT' })
  await page.clock.runFor(15000)
  expect(await dials(page)).toEqual(['119'])
  const value = await stored(page)
  expect(value.submissions.filter(item => item.agency === 'rescue')).toHaveLength(1)
  expect(value.emergency.requests).toMatchObject({ rescue: 'connection_unknown', insurance: 'not_sent', vehicle: 'not_sent' })
  expect(value.submissions.find(item => item.agency === 'rescue')).toMatchObject({ call: 'connecting', externalReceipt: null })
})

for (const input of ['okay', 'keyboard', 'pointer']) test(`${input} input stops the emergency countdown without opening a phone screen`, async ({ page }) => {
  await page.clock.install()
  await open(page)
  await flow(page).getByRole('button', { name: '다친 사람이 있어요', exact: true }).click()
  const emergency = flow(page).locator('[data-cell=emergency]')
  await expect(emergency.getByLabel('119 전화 화면 열기까지', { exact: true })).toBeVisible()
  const injured = await stored(page)
  expect(injured.safetyActions.find(item => item.id === 'injury-reported')).toMatchObject({ status: 'user-confirmed', source: 'user' })
  await page.clock.runFor(3000)
  if (input === 'okay') await emergency.getByRole('button', { name: '괜찮아요', exact: true }).click()
  else if (input === 'keyboard') {
    await emergency.getByRole('button', { name: '지금 연결', exact: true }).focus()
    await page.keyboard.press('Tab')
  } else await emergency.getByText('119 도움 요청', { exact: true }).click()
  await expect(emergency.getByLabel('119 전화 화면 열기까지', { exact: true })).toBeHidden()
  await page.clock.runFor(15000)
  expect(await dials(page)).toEqual([])
  await expect(flow(page)).toHaveAttribute('data-call', 'idle')
  expect((await stored(page)).submissions).toHaveLength(0)
})

test('a failed injury save cannot arm the countdown and a successful retry can open the phone screen', async ({ page }) => {
  await page.clock.install()
  await open(page)
  await stored(page)
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (...args) {
      const value: unknown = args[0]
      const emergencyAnswer = typeof value === 'object' && value !== null && 'safetyActions' in value && Array.isArray(value.safetyActions)
        && value.safetyActions.some((action: unknown) => typeof action === 'object' && action !== null && 'id' in action && action.id === 'situation-danger')
      if (this.name === 'cases' && emergencyAnswer && document.documentElement.dataset.storageFailure === 'yes') throw new DOMException('Full', 'QuotaExceededError')
      return original.apply(this, args)
    }
    document.documentElement.dataset.storageFailure = 'yes'
  })
  const injury = flow(page).getByRole('button', { name: '다친 사람이 있어요', exact: true })
  await injury.click()
  await expect(page.getByText('이 기기에 저장하지 못했어요. 입력 내용은 이 화면에 남아 있어요.', { exact: false }).first()).toBeAttached()
  await expect(flow(page).getByLabel('119 전화 화면 열기까지', { exact: true })).toBeHidden()
  await page.clock.runFor(15000)
  expect(await dials(page)).toEqual([])
  await expect(flow(page)).toHaveAttribute('data-step', '1')
  await page.evaluate(() => { delete document.documentElement.dataset.storageFailure })
  await injury.click()
  await stored(page)
  await expect(flow(page).getByLabel('119 전화 화면 열기까지', { exact: true })).toBeVisible()
  await page.clock.runFor(10100)
  await expect(flow(page)).toHaveAttribute('data-call', 'connecting')
  expect(await dials(page)).toEqual(['119'])
  expect((await stored(page)).emergency.requests.rescue).toBe('connection_unknown')
})

test('now opens the dialer without connecting and the explicit call-end demo survives reload', async ({ page }) => {
  await page.clock.install()
  await open(page, { demo: true, handoff: false })
  await flow(page).getByRole('button', { name: '다친 사람이 있어요', exact: true }).click()
  await flow(page).getByRole('button', { name: '지금 연결', exact: true }).click()
  await expect(flow(page)).toHaveAttribute('data-call', 'connecting')
  await expect(flow(page).locator('[data-cell=emergency]')).toContainText('119 전화 화면을 열었어요')
  await expect(flow(page).locator('[data-cell=guide]')).not.toContainText('119 전화 화면을 열었어요')
  await expect(flow(page).locator('[data-cell=emergency]')).toContainText('실제 통화·구호 접수 미확인')
  await flow(page).getByRole('button', { name: '대피 안내 보기', exact: true }).click()
  await enterJourneyRecord(page)
  await page.clock.runFor(15000)
  expect(await dials(page)).toEqual(['119'])
  const opened = await stored(page)
  expect(opened.submissions.find(item => item.agency === 'rescue')).toMatchObject({ call: 'connecting', status: 'connection_unknown', externalReceipt: null })
  await page.locator('.host-demo-strip').getByRole('button', { name: '시연', exact: true }).click()
  await page.getByRole('group', { name: '시연 조작', exact: true }).getByRole('button', { name: '시연 event: 통화 종료 확인', exact: true }).click()
  await expect(flow(page)).toHaveAttribute('data-call', 'ended')
  await stored(page)
  await page.reload()
  await expect(flow(page)).toHaveAttribute('data-call', 'ended')
  expect((await stored(page)).emergency.requests.rescue).toBe('connection_unknown')
})

test('an unreadable airbag signal reads 신호 확인 불가 and raises no emergency', async ({ page }) => {
  await open(page)
  const airbag = flow(page).locator('[data-cell=vehicle] [data-vehicle-row=airbag] dd')
  await expect(airbag).toHaveText('미확인')
  await sendFact(page, { kind: 'unavailable', cause: 'disconnected', seatId: 'all' })
  await expect(airbag).toContainText('신호 확인 불가')
  await expect(flow(page)).toHaveAttribute('data-emergency', 'false')
  await sendFact(page, { kind: 'reading', value: false, source: 'pleos-sdk' })
  await expect(airbag).toContainText('펼쳐지지 않음')
  await expect(airbag).toContainText('차량 확인')
  await expect(flow(page)).toHaveAttribute('data-emergency', 'false')
})

test('a vehicle without a dialer keeps the call idle and points the driver to the phone', async ({ page }) => {
  await open(page, { dial: 'unavailable' })
  await flow(page).getByRole('button', { name: '다친 사람이 있어요', exact: true }).click()
  await expect(flow(page)).toHaveAttribute('data-step', '2')
  const emergency = flow(page).locator('[data-cell=emergency]')
  await emergency.getByRole('button', { name: '지금 연결', exact: true }).click()
  await expect(emergency.getByRole('alert')).toContainText(/휴대폰.*119/)
  await expect(flow(page)).toHaveAttribute('data-call', 'idle')
  expect(await dials(page)).toEqual(['119'])
  expect((await stored(page)).submissions.filter(item => item.agency === 'rescue')).toHaveLength(0)
})

test('phone handoff commands round-trip through the native bridge without web fetches or stored credentials', async ({ page }) => {
  const api: string[] = []
  await page.route('**/api/**', route => { api.push(route.request().url()); return route.abort() })
  await open(page)
  const journeyId = await page.locator('[data-case-id]').getAttribute('data-case-id')
  await expect.poll(() => handoffs(page)).toEqual([{ command: 'journey', argument: { journeyId } }])
  const record = flow(page).locator('[data-cell=record]')
  await expect(record.locator('.vh-panel[data-compact=true]')).toContainText('휴대폰 연결 전')

  await flow(page).getByRole('button', { name: '괜찮아요', exact: true }).click()
  await enterJourneyRecord(page)
  await flow(page).locator('[data-cell=guide]').getByRole('button', { name: '휴대폰으로 이어가기', exact: true }).click()
  const panel = record.locator('section.vh-panel')
  await expect(panel).toHaveAttribute('data-handoff', 'pairing')
  await expect(panel.getByRole('img', { name: '휴대폰 연결 QR 코드' })).toHaveAttribute('data-join-url', 'https://demo.example/phone#pair-1')
  await expect(panel).toContainText('휴대폰을 기다리고 있어요')

  await page.evaluate(() => window.nativeFake.claim())
  await expect(panel.getByLabel('확인 숫자 1 2 3 4 5 6')).toHaveText('123 456')
  await panel.getByRole('button', { name: '승인', exact: true }).click()
  await expect(panel).toHaveAttribute('data-handoff', 'connected')
  await expect(panel).toContainText('휴대폰과 연결됐어요')
  await expect(panel.locator('[data-record=photos] dd')).toHaveText('2/6')

  expect(await handoffs(page)).toEqual([
    { command: 'journey', argument: { journeyId } },
    { command: 'start', argument: {} },
    { command: 'approve', argument: { claimId: 'claim-1' } },
  ])
  expect(api).toEqual([])
  expect(await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('chabun-vehicle-handoff')))).toEqual([])
})

test('a build without a backend runs standalone and never offers the phone link', async ({ page }) => {
  await open(page, { handoff: false })
  const record = flow(page).locator('[data-cell=record]')
  await expect(record).toContainText('아직 남긴 기록이 없어요')
  await expect(record.locator('.vh-panel')).toHaveCount(0)
  await flow(page).getByRole('button', { name: '괜찮아요', exact: true }).click()
  await enterJourneyRecord(page)
  await expect(record.getByRole('button', { name: '말로 남기기', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '휴대폰으로 이어가기', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '휴대폰 연결하기', exact: true })).toHaveCount(0)
  expect((await handoffs(page)).filter(call => call.command !== 'journey')).toEqual([])
  await record.getByRole('button', { name: '직접 입력', exact: true }).click()
  await record.getByRole('textbox', { name: '사고 기록', exact: true }).fill('정차 중 오른쪽에서 충격을 느꼈어요.')
  await record.getByRole('button', { name: '기록 저장', exact: true }).click()
  await openExampleReport(page)
  await page.getByRole('button', { name: '보낼 내용 확인', exact: true }).click()
  await page.getByRole('textbox', { name: '수신처', exact: true }).fill('시연 보험사')
  await page.getByRole('checkbox', { name: /남긴 이야기 1/ }).check()
  await page.getByRole('button', { name: '선택한 내용 미리보기', exact: true }).click()
  expect((await stored(page)).activeSubmissionIds.insurance).toBeNull()
  await page.getByRole('button', { name: '이 내용으로 요청', exact: true }).click()
  await expect(page.getByText('승인한 내용이 보관됐어요', { exact: true })).toBeVisible()
  const approved = await stored(page)
  const payload = approved.submissions.find(item => item.id === approved.activeSubmissionIds.insurance)?.payload
  await page.getByRole('button', { name: '승인한 내용 보내기', exact: true }).click()
  await expect.poll(async () => (await stored(page)).emergency.requests.insurance).toBe('received')
  await expect(flow(page).locator('[data-cell=guide]')).toContainText('접수번호를 받았어요')
  await page.getByRole('button', { name: '차량 지원·정비소 안내 보기', exact: true }).click()
  await expect(page.getByRole('heading', { name: '필요한 다음 일을 살펴보세요', exact: true })).toBeVisible()
  await stored(page)
  await page.reload()
  await expect(page.getByRole('heading', { name: '필요한 다음 일을 살펴보세요', exact: true })).toBeVisible()
  const restored = await stored(page)
  expect(restored.submissions.find(item => item.id === restored.activeSubmissionIds.insurance)?.payload).toEqual(payload)
  expect((await handoffs(page)).filter(call => call.command !== 'journey')).toEqual([])
  expect(await dials(page)).toEqual([])
})

test('the demo strip exists only for demo builds and stays closed until the presenter opens it', async ({ page }) => {
  await open(page, { demo: true })
  const toggle = page.locator('.host-demo-strip').getByRole('button', { name: '시연', exact: true })
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  expect(await toggle.evaluate(node => node instanceof HTMLElement ? node.offsetHeight : 0)).toBeGreaterThanOrEqual(48)
  await expect(page.getByRole('group', { name: '시연 조작' })).toHaveCount(0)
  await toggle.click()
  await page.getByRole('group', { name: '시연 조작' }).getByRole('button', { name: '시연 event: 에어백 전개 신호', exact: true }).click()
  await expect(page.getByTestId('flow-board')).toHaveAttribute('data-target', 'emergency')
  await expect(flow(page).locator('[data-cell=guide]')).toContainText('에어백 전개 신호가 왔어요')
  expect(await dials(page)).toEqual([])
})

test.describe('native bundle served under /assets/web/', () => {
  test.describe.configure({ mode: 'serial' })
  let server: PreviewServer
  let origin = ''
  test.beforeAll(async () => {
    const root = fileURLToPath(new URL('../', import.meta.url))
    await build({ root, mode: 'native', logLevel: 'silent' })
    server = await preview({ root, mode: 'native', logLevel: 'silent', preview: { host: '127.0.0.1', port: 0, strictPort: true } })
    origin = new URL(server.resolvedUrls!.local[0]).origin
  })
  test.afterAll(async () => {
    if (server) await new Promise<void>((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve()))
  })

  test('guidance audio, fonts and sample media load from the bundle base', async ({ page }) => {
    const responses: { path: string; status: number; type: string }[] = []
    page.on('response', response => {
      const url = new URL(response.url())
      if (url.protocol === 'http:' && url.origin === origin) responses.push({ path: url.pathname, status: response.status(), type: response.headers()['content-type'] ?? '' })
    })
    await installBridge(page, { demo: true, windowPx: { width: 1682, height: 1210 } })
    await page.goto(origin + '/assets/web/index.html?host=pleos-app')
    await expect(flow(page)).toHaveAttribute('data-step', '1')
    await expect(page.locator('.host-guidance [data-guidance-state=speaking]')).toBeAttached()
    const fonts = await page.evaluate(async () => { await document.fonts.ready; return [...document.fonts].filter(face => face.family.includes('Asta')).map(face => face.status) })
    expect(fonts).toContain('loaded')
    expect(fonts).not.toContain('error')
    await page.getByRole('button', { name: '시연', exact: true }).click()
    await page.getByRole('button', { name: '시연 event: 사고 자료 확보', exact: true }).click()
    await expect(flow(page).locator('[data-cell=record] [data-record=video] dd')).toContainText('2개')

    expect(responses.filter(item => item.status >= 400 || !item.path.startsWith('/assets/web/'))).toEqual([])
    expect(responses.find(item => item.path.startsWith('/assets/web/guidance-audio/'))?.type).toContain('audio/mpeg')
    expect(responses.find(item => item.path.startsWith('/assets/web/fonts/asta_'))?.type).toMatch(/font|ttf/)
    expect(responses.find(item => item.path === '/assets/web/journey-samples/front-20s.mp4')?.type).toContain('video/mp4')
  })

})
