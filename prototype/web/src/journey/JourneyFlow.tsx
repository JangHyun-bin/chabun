import {useReducedMotionPreference} from '@/design-system/motion'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, ArrowRight, FileText, Phone } from 'lucide-react'
import { CareAction, CareStatus } from '@/components/ui/after-care'
import { VehicleShell, type AppWindow } from '@/components/ui/after-care-layout'
import { FlowBoard } from '@/design-system/FlowBoard'
import { stageLabels, type CellId } from '@/design-system/flow-study-model'
import { VehicleDetailCell, VehicleSceneCell } from './VehicleCells'
import { vehicleNeedsAttention } from './vehicle-state'
import { activeRequest, journeyFlow, noUrgentDanger, safetyChecklist, safetyConfirmed, sceneCopy, urgentDanger, type FlowScene, type ResponseStep } from './journey-flow'
import { acknowledgeRisks, type CaseCommand, type CommitResult, type Device, type JourneyCase, type SafetyAction, type Stage } from './case'
import type { VehicleHandoff } from '@/product/vehicle-handoff'
import { VehicleHandoffPanel } from '@/product/VehicleHandoffPanel'
import { GuidanceControl, GuidanceMuteToggle } from '@/audio/GuidanceControl'
import flowVoices from '@/audio/journey-flow-guidance.json'
import { dial119, hostDemo, inPleosApp } from '@/host/pleos-host'
import { HostDemoStrip } from '@/host/HostDemoStrip'
import '@/design-system/flow-study.css'
import './journey-flow.css'

const stepVoice: Partial<Record<FlowScene, string>> = flowVoices

type DialCountdown = { kind: 'idle' | 'cancelled' | 'opened' } | { kind: 'running'; deadline: number; seconds: number }
// The guide cell already states the call scene in full; the 119 cell keeps only a short status so the same sentence is not shown twice.
const callStatus = { connecting: '전화 화면 열림', connected: '통화 중', ended: '통화 종료' }
const guideTasks: Partial<Record<FlowScene, { title: string; note: string }>> = {
  situation: { title: '괜찮으세요?', note: '충돌을 감지했어요. 다친 사람이 있거나 위험하면 119 전화 화면을 열 수 있어요.' },
  'situation-airbag': { title: '괜찮으세요?', note: '에어백 전개 신호가 왔어요. 다친 사람이 있는지 먼저 확인해 주세요.' },
  emergency: { title: '119 전화 화면을 열 수 있어요', note: '다친 사람은 억지로 움직이지 마세요. 불이나 연기가 보이면 차에서 멀리 떨어지세요.' },
  calling: { title: '119 전화 화면을 열었어요', note: '실제 발신과 구호 접수는 확인되지 않았어요.' },
  call: { title: '통화 연결 시연', note: '실제 통화나 구호 접수를 확인한 상태가 아니에요.' },
  'call-ended': { title: '통화 종료 시연', note: '도움이 더 필요하면 119 전화 화면을 다시 열 수 있어요.' },
  move: { title: '안전한 곳으로 이동하세요', note: '차가 다니지 않는 곳으로 피하세요.' },
  ready: { title: '안전한 곳에 머물러 주세요', note: '이제 기억나는 내용을 남길 수 있어요.' },
  'risk-check': { title: '주변을 다시 살펴보세요', note: '차 주변이 안전한지 확인해 주세요. 남기던 기록은 그대로 있어요.' },
  'record-empty': { title: '어떻게 부딪혔나요?', note: '말로 하거나 사진을 찍어 두세요. 지금 어려우면 나중에 해도 돼요.' },
  record: { title: '남긴 내용으로 예시 경위서를 만들어요', note: '문장에 연결된 근거를 확인하고 내용을 직접 고칠 수 있어요.' },
  sending: { title: '보험사 전송 시연 중', note: '실제 보험사에 전송하지 않아요. 승인한 자료의 시연 결과를 확인합니다.' },
  sent: { title: '시연 전송이 끝났어요', note: '실제 보험사 전송이나 접수 결과가 아니에요.' },
  received: { title: '보험 접수 시연이 끝났어요', note: '시연 접수번호를 확인한 뒤 차량 지원·정비소 안내로 이어갈 수 있어요.' },
}

export function JourneyFlow({ value, device, active, saved, onCommand, onSave, onNavigate, onReview, onPrepareReport, onHandoff, recordWorkspace, reviewWorkspace, previewHeight, controls, handoff, appWindow }: {
  recordWorkspace:ReactNode;reviewWorkspace:ReactNode;previewHeight?:number;controls?:ReactNode;handoff?:VehicleHandoff;appWindow?:AppWindow
  value: JourneyCase; device: Device; active:boolean; saved:boolean; onCommand: (command: CaseCommand) => void
  onSave: (command: CaseCommand) => Promise<CommitResult>
  onNavigate: (stage: Stage) => Promise<boolean>; onReview: () => void; onPrepareReport: () => Promise<boolean>; onHandoff: () => void
}) {
  const [responseView, setResponseView] = useState<ResponseStep | null>(null)
  const [showSentReview, setShowSentReview] = useState(false)
  const [pendingEditor, setPendingEditor] = useState<'record' | 'review' | 'response' | null>(null)
  const [dialFailed, setDialFailed] = useState(false)
  const [countdown, setCountdown] = useState<DialCountdown>({ kind: 'idle' })
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const countdownTimer = useRef<number | undefined>(undefined)
  const dialAttempted = useRef(false)
  const flow = useRef<HTMLElement>(null)
  const composing = useRef(false)
  const deferredAction = useRef<(() => void) | null>(null)
  const revealFromController = useRef(false)
  const reduced = !!useReducedMotionPreference()
  const { step: actualStep, scene: caseScene, layout, emergency, call, arrived, request, sending, next: nextView, back: previousView } = journeyFlow(value, responseView)
  const rescue = activeRequest(value, 'rescue')
  const safetyResolved = (id: string) => safetyConfirmed(value, id) || id !== 'safe-arrival' && value.safetyActions.some(action => action.id === id && action.status === 'unavailable')
  const checks = safetyChecklist.filter(item => safetyResolved(item.id)).length
  const safetyStep = safetyChecklist.find(item => !safetyResolved(item.id)) ?? safetyChecklist[safetyChecklist.length - 1]
  const receipt = request?.status === 'received'
  const inspectingSent = actualStep === 7 && showSentReview
  const step = inspectingSent ? 6 : actualStep
  const scene: FlowScene = inspectingSent ? 'sent-review' : caseScene
  const copy = sceneCopy[scene]
  const phoneProgress = handoff?.state.kind === 'connected' ? handoff.state.progress.record : null
  const phoneRecord = !!phoneProgress && (phoneProgress.photos + phoneProgress.audio + phoneProgress.video > 0 || phoneProgress.statement !== 'empty' || phoneProgress.report !== 'empty')
  const blocked = busy || copy.blocked && !(scene === 'record-empty' && phoneRecord)
  const reviewVisible = step === 6 && !sending || inspectingSent
  function stopCountdown() {
    clearInterval(countdownTimer.current)
    countdownTimer.current = undefined
  }
  function cancelCountdown() {
    stopCountdown()
    setCountdown(current => current.kind === 'running' ? { kind: 'cancelled' } : current)
  }
  useEffect(() => {
    if (!active || value.stage !== 'response' || !emergency || call !== 'idle') {
      cancelCountdown()
      return
    }
    if (saved && countdown.kind === 'idle') setCountdown({ kind: 'running', deadline: Date.now() + 10_000, seconds: 10 })
  }, [active, value.stage, emergency, call, saved, countdown.kind])
  const deadline = countdown.kind === 'running' ? countdown.deadline : null
  useEffect(() => {
    if (deadline === null) return
    const timer = window.setInterval(() => {
      const seconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000))
      if (seconds === 0) {
        clearInterval(timer)
        countdownTimer.current = undefined
        setCountdown({ kind: 'opened' })
        void startCall()
      } else setCountdown(current => current.kind === 'running' ? { ...current, seconds } : current)
    }, 100)
    countdownTimer.current = timer
    return () => { clearInterval(timer); if (countdownTimer.current === timer) countdownTimer.current = undefined }
  }, [deadline])
  useEffect(() => {
    setPendingEditor(active ? value.stage === 'record' ? 'record' : reviewVisible ? 'review' : 'response' : null)
    if (!active || value.stage === 'response') {
      composing.current=false
      deferredAction.current=null
      if(flow.current)flow.current.dataset.composing='false'
    }
  }, [active, value.stage, reviewVisible, step])
  async function next() {
    revealFromController.current=!!flow.current?.querySelector('.journey-flow-actions button:focus')
    if (busy) return
    if (inspectingSent) setShowSentReview(false)
    else if (scene === 'sending') result('sent')
    else if (scene === 'move') await confirmSafety()
    else if (nextView === 'record') await onNavigate('record')
    else if (nextView) {
      setResponseView(nextView)
    }
    else if (step === 5) {
      setBusy(true)
      try { await onPrepareReport() } finally { setBusy(false) }
    }
    else if (request && (scene === 'review-ready' || scene === 'review-failed')) onCommand({ type: 'transport-start', caseId: value.id, submissionId: request.id, retryId: request.transport === 'failed' ? crypto.randomUUID() : undefined, now: new Date().toISOString() })
    else if (scene === 'review-declined') await onNavigate('follow-up')
    else if (step === 6) { onReview(); setPendingEditor('review') }
    else if (step === 7) await onNavigate('follow-up')
  }
  async function back() {
    revealFromController.current=!!flow.current?.querySelector('.journey-flow-actions button:focus')
    if(actualStep===7&&!inspectingSent){showSent();return}
    setShowSentReview(false)
    setPendingEditor(null)
    if (step > 5) await onNavigate('record')
    else if (step === 5) { if (await onNavigate('response')) setResponseView(4) }
    else if (previousView) setResponseView(previousView)
  }
  async function startCall() {
    cancelCountdown()
    if (dialAttempted.current || call !== 'idle' && call !== 'ended') return
    dialAttempted.current = true
    const dialed = dial119()
    setDialFailed(dialed !== 'opened')
    if (dialed !== 'opened') { dialAttempted.current = false; return }
    setCountdown({ kind: 'opened' })
    if (value.stage !== 'response') await onNavigate('response')
    await onSave({ type: 'contact-start', now: new Date().toISOString() })
    setResponseView(2)
  }
  async function answerSituation(answer: typeof noUrgentDanger | typeof urgentDanger, injured = false) {
    if (busy) return
    cancelCountdown(); setBusy(true); setNotice('')
    const now = new Date().toISOString(), other = answer === urgentDanger ? noUrgentDanger : urgentDanger
    const saveAction = (id: string, label: string, status: SafetyAction['status']) => onSave({ type: 'safety-action', action: { id, label, status, source: 'user', confirmedAt: status === 'user-confirmed' ? now : null } })
    try {
      if (value.stage !== 'response' && !await onNavigate('response')) return
      if (safetyConfirmed(value, other.id) && !(await saveAction(other.id, other.label, 'unknown')).ok) return
      if (injured && !(await saveAction('injury-reported', '부상 있음 · 운전자 응답', 'user-confirmed')).ok) return
      if (answer === noUrgentDanger && safetyConfirmed(value, 'injury-reported') && !(await saveAction('injury-reported', '부상 있음 · 운전자 응답', 'unknown')).ok) return
      if (!(await saveAction(answer.id, answer.label, 'user-confirmed')).ok) { setNotice('상황 확인을 저장하지 못했어요. 다시 확인해 주세요.'); return }
      setResponseView(answer === urgentDanger ? 2 : arrived ? 4 : 3)
    } finally { setBusy(false) }
  }
  async function confirmSafety(unavailable = false) {
    if (busy) return
    setBusy(true); setNotice('')
    try {
      const result = await onSave({ type: 'safety-action', action: { id: safetyStep.id, label: safetyStep.label, status: unavailable ? 'unavailable' : 'user-confirmed', source: 'user', confirmedAt: new Date().toISOString() } })
      if (!result.ok) { setNotice('확인 내용을 저장하지 못했어요. 현재 단계에서 다시 시도해 주세요.'); return }
      if (safetyStep.id === 'safe-arrival') setResponseView(4)
    } finally { setBusy(false) }
  }
  function showSent() {
    setShowSentReview(true)
    onReview()
    setPendingEditor('review')
  }
  const result = (status: 'sent' | 'failed') => request && onCommand({ type: 'transport-result', caseId: value.id, submissionId: request.id, status, now: new Date().toISOString() })
  function afterComposition(action:()=>void) {
    if(composing.current)deferredAction.current=action
    else action()
  }
  function revealEditor() {
    if (!pendingEditor || composing.current) return
    const editor = flow.current?.querySelector<HTMLElement>(pendingEditor==='response' ? '.fs-step-copy' : `#journey-${pendingEditor}-editor`)
    if (!editor?.getClientRects().length || editor.closest('[hidden], [inert]')) return
    const heading = [...editor.querySelectorAll<HTMLElement>('h1')].find(node => node.getClientRects().length && !node.closest('[hidden], [inert]'))
    if (!heading) return
    if (!editor.contains(document.activeElement)) heading.focus({ preventScroll: true })
    const bounds=heading.getBoundingClientRect()
    if(revealFromController.current&&pendingEditor!=='response'&&(bounds.top<0||bounds.bottom>innerHeight))heading.scrollIntoView({block:'nearest',inline:'nearest'})
    revealFromController.current=false
    setPendingEditor(null)
  }

  const act = (label: string, action: () => void, secondary = false, disabled = false) => <CareAction secondary={secondary} disabled={disabled} onClick={() => afterComposition(action)}>{label}</CareAction>
  function guideTask(compact: boolean): ReactNode {
    const airbag = scene === 'situation-airbag'
    const task = scene === 'move' ? { title: safetyStep.label, note: safetyStep.note } : guideTasks[scene.startsWith('situation') && !airbag ? 'situation' : scene]
    const evacuate = () => setResponseView(arrived ? 4 : 3)
    const actions: { label: string; run: () => void; secondary?: boolean; disabled?: boolean }[] = scene.startsWith('situation')
      ? [{ label: '다친 사람이 있어요', run: () => void answerSituation(urgentDanger, true) }, { label: '괜찮아요', run: () => void answerSituation(noUrgentDanger), secondary: true }]
      : scene === 'emergency' ? [{ label: '안전한 곳으로 이동할게요', run: evacuate, secondary: true }]
      : scene === 'calling' || scene === 'call' || scene === 'call-ended' ? [{ label: '대피 안내 보기', run: evacuate, secondary: true }]
      : scene === 'move' ? [{ label: safetyStep.action, run: () => void confirmSafety() }, ...(safetyStep.id === 'safe-arrival' ? [{ label: '대피가 어려워요', run: () => void answerSituation(urgentDanger), secondary: true }] : [{ label: '지금 할 수 없어요', run: () => void confirmSafety(true), secondary: true }])]
      : scene === 'ready' ? [{ label: '기록 시작', run: () => void next() }]
      : scene === 'risk-check' ? [{ label: '주변을 확인했어요', run: () => acknowledgeRisks(value, new Date().toISOString()).forEach(onCommand) },
        ...emergency ? [] : [{ label: '다친 사람이 있거나 위험해요', run: () => answerSituation(urgentDanger), secondary: true }]]
      : step === 5 ? [...handoff ? [{ label: '휴대폰으로 이어가기', run: onHandoff }] : [], ...blocked ? [{ label: '나중에 기록할게요', run: () => void onNavigate('follow-up'), secondary: true }] : [], { label: busy ? '예시 경위서 준비 중' : '예시 경위서 만들기', run: () => void next(), disabled: blocked }]
      : scene === 'sent' || scene === 'received' ? [{ label: '차량 지원·정비소 안내 보기', run: () => void next() }, { label: '보낸 내용 보기', run: showSent, secondary: true }]
      : []
    const label = <div className="fs-cell-label"><span>{step === 3 || step === 4 ? '안전 확보' : stageLabels[step - 1]}</span>{(step === 3 || step === 4) && <span>{Math.min(checks + (step === 3 ? 1 : 0), 3)} / 3</span>}</div>
    if (compact) return <div className="journey-cell-compact">
      <div>{label}<p className="journey-cell-summary">{task?.title ?? copy.title}</p></div>
      {actions[0] && act(actions[0].label, actions[0].run, actions[0].secondary, actions[0].disabled)}
    </div>
    return <>
      {label}
      {(step === 3 || step === 4) && <div className="fs-check-track" aria-hidden="true">{safetyChecklist.map(item => <i key={item.id} data-done={safetyResolved(item.id)} />)}</div>}
      {task && <div className="journey-guide-copy" role={scene === 'risk-check' ? 'alert' : undefined}><h2>{task.title}</h2><p className="fs-cell-muted">{task.note}</p></div>}
      {scene === 'move' && value.safetyActions.find(action => action.id === safetyStep.id)?.status === 'device-confirmed' && <CareStatus tone="confirmed">차량 신호 확인</CareStatus>}
      {scene === 'sending' && <CareStatus tone="pending">보내는 중</CareStatus>}
      {(scene === 'sent' || scene === 'received') && <CareStatus tone="unknown">{receipt ? '보험 접수 시연 · 실제 접수 아님' : '시연 전송 · 실제 전송 아님'}</CareStatus>}
      {notice && <p role="alert" className="journey-supporting">{notice}</p>}
      {actions.length > 0 && <div className="journey-cell-choices">{actions.map(action => <CareAction key={action.label} secondary={action.secondary} disabled={busy || action.disabled} onClick={() => afterComposition(action.run)}>{action.label}</CareAction>)}</div>}
      {!emergency && scene !== 'risk-check' && (scene.startsWith('situation') || step === 3 || step === 4 || step === 5 || step === 7) && <button type="button" className="journey-text-action journey-escalate" onClick={() => afterComposition(() => void answerSituation(urgentDanger))}>{scene.startsWith('situation') ? '불이나 연기 등 위험이 있어요' : '다친 사람이 있거나 위험해요'}</button>}
    </>
  }
  function recordSummary(compact: boolean): ReactNode {
    const available = value.evidence.filter(item => item.availability === 'available')
    const count = (kind: string) => available.filter(item => item.kind === kind).length
    const statements = value.statements.filter(item => item.text.trim())
    const samples = available.some(item => item.origin === 'sample')
    const saved = statements.length + available.length + (value.diagram ? 1 : 0)
    const label = <div className="fs-cell-label"><span>사고 내용 기록 중</span><FileText aria-hidden="true" /></div>
    if (compact) {
      const phone = handoff?.state.kind === 'connected' ? handoff.state.progress.phone.online ? '휴대폰 연결됨' : '휴대폰 응답 없음' : handoff?.state.kind === 'pairing' ? '휴대폰 연결 대기' : null
      return <div className="journey-cell-compact"><div>{label}<p className="journey-cell-summary">{[saved ? `남긴 기록 ${saved}건` : '아직 남긴 기록이 없어요', phone].filter(Boolean).join(' · ')}</p></div></div>
    }
    const rows = [
      { id: 'statements', label: '말로 남긴 이야기', value: statements.length ? `${statements.length}개` : '없음' },
      { id: 'photos', label: '사진', value: count('photo') ? `${count('photo')}장` : '없음' },
      { id: 'audio', label: '음성', value: count('audio') ? `${count('audio')}개` : '없음' },
      ...count('video') ? [{ id: 'video', label: '영상', value: `${count('video')}개${samples ? ' · 시연 자료' : ''}` }] : [],
      ...value.diagram ? [{ id: 'diagram', label: '사고 도식', value: value.diagram.origin === 'fixture' ? '시연 자료' : '있음' }] : [],
    ]
    const own = statements[0]?.text
    return <>
      {label}
      <h2>{saved || phoneRecord ? '남긴 기록이 있어요' : '아직 남긴 기록이 없어요'}</h2>
      <dl className="journey-record-rows" aria-label="저장된 기록">{rows.map(row => <div key={row.id} data-record={row.id}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl>
      {handoff && <VehicleHandoffPanel handoff={handoff} compact />}
      {own && <div className="journey-record-own"><small>직접 남긴 내용</small><p>{own}</p></div>}
      {step === 6 && !sending && !inspectingSent && act('기록 더 남기기', () => void onNavigate('record'), true)}
    </>
  }
  function renderCell(id: CellId, compact: boolean): ReactNode {
    if (id === 'emergency') return <div className="fs-call-core">
      <div className="fs-cell-label"><span>119 도움 요청</span><Phone aria-hidden="true" /></div>
      {call === 'idle' ? <>
        {countdown.kind === 'running' && <>
          <output className="journey-countdown" aria-label="119 전화 화면 열기까지">{countdown.seconds}초</output>
          <p className="fs-cell-muted">응답이 없으면 전화 화면을 열어요. 실제 발신은 직접 해야 해요.</p>
        </>}
        {countdown.kind === 'cancelled' && <CareStatus tone="unknown">입력하여 자동 진행을 멈췄어요</CareStatus>}
        {act('지금 연결', () => void startCall())}
        {emergency && act('괜찮아요', () => void answerSituation(noUrgentDanger), true)}
      </> : <>
        <CareStatus tone="unknown">{callStatus[call]} · 실제 통화·구호 접수 미확인</CareStatus>
        {call === 'ended' && act('119 전화 화면 다시 열기', () => { dialAttempted.current = false; void startCall() }, true)}
      </>}
      {dialFailed && <div role="alert"><CareStatus tone="failed">차에서 전화 화면을 열 수 없어요. 휴대폰에서 119를 눌러 주세요.</CareStatus></div>}
    </div>
    if (id === 'guide') return <>
      <div id="journey-review-editor" className="journey-flow-workspace" data-flow-content hidden={!reviewVisible || compact}>{reviewWorkspace}</div>
      {reviewVisible && !compact && scene !== 'review' && <div className="journey-cell-choices">{act(copy.action, () => void next())}</div>}
      <div className="journey-guide-task" hidden={reviewVisible && !compact}>{guideTask(compact)}</div>
    </>
    if (id === 'record') return <>
      <div id="journey-record-editor" className="journey-flow-workspace" data-flow-content hidden={step !== 5 || compact}>{recordWorkspace}</div>
      <div className="journey-record-summary" hidden={step === 5 && !compact}>{recordSummary(compact)}</div>
    </>
    if (id === 'scene') return <VehicleSceneCell value={value} compact={compact} active={active} />
    return <VehicleDetailCell value={value} compact={compact} />
  }

  const guidanceText = scene === 'move' ? flowVoices[safetyStep.id] : stepVoice[scene]
  const guidance = active && guidanceText && <GuidanceControl text={guidanceText} contextKey={`journey-flow/${value.id}/${scene}/${scene === 'move' ? safetyStep.id : ''}`} />
  const flowEvents = <section className="journey-flow-events" aria-label="대표 흐름 결과 시연"><span>결과 시연 · 실제 전화·전송 없음</span><span>주변 경로·사고 재생은 합성 시연. 저장된 사고 영상과 별개예요.</span>
    {rescue && (call === 'connecting' || call === 'connected') && <button aria-label="시연 event: 통화 종료 확인" onClick={() => onCommand({ type: 'call-end', caseId:value.id, submissionId:rescue.id, now: new Date().toISOString() })}>통화 종료 확인</button>}
    {sending && <button aria-label="시연 event: 보험사 전송 실패" onClick={() => result('failed')}>보험사 전송 실패</button>}
    {actualStep === 7 && <button onClick={() => { if (showSentReview) setShowSentReview(false); else showSent() }}>{inspectingSent ? '완료 화면으로' : '전송 내역과 공유 보기'}</button>}
  </section>
  const controller=<div className="journey-flow-header">
    <ol className="fs-stages" aria-label="사고 대응 진행">{stageLabels.map((label, index) => <li key={label} aria-current={step === index + 1 ? 'step' : undefined} data-done={index + 1 < step && !(index === 1 && !emergency && call === 'idle')}><span>{String(index + 1).padStart(2, '0')}</span>{label}</li>)}</ol>
    <div className="fs-action-bar"><div className="fs-step-copy" aria-live="polite"><span className="fs-step-label">{step} / 7 · {stageLabels[step - 1]}</span><h1 tabIndex={-1}>{copy.title}</h1><p>{copy.support}</p>{guidance}</div><section className="journey-flow-actions" aria-label="여정 조작">
      <CareAction secondary aria-label="이전 단계" disabled={step === 1 || scene === 'sending'} onClick={() => afterComposition(()=>void back())}><ArrowLeft aria-hidden="true" />이전</CareAction>
      <CareAction data-testid="journey-primary" aria-label={copy.demo ? `다음 · 시연 event: ${copy.action}` : '다음 단계'} aria-describedby="journey-next-action" disabled={blocked} onClick={() => afterComposition(()=>void next())}>다음<ArrowRight aria-hidden="true" /></CareAction>
      <span id="journey-next-action" className="journey-next-action">{copy.demo ? `시연: ${copy.action}` : copy.action}</span>
      <details className="journey-flow-options" onKeyDown={event=>{if(event.key==='Escape'){event.currentTarget.open=false;event.currentTarget.querySelector('summary')?.focus()}}}><summary>시연 설정</summary><div className="journey-flow-options-panel" onClick={event=>{if(event.target instanceof Element&&event.target.closest('button')){const focused=event.currentTarget.contains(document.activeElement),details=event.currentTarget.closest('details')!;details.open=false;if(focused)details.querySelector('summary')?.focus({preventScroll:true})}}}>
        <p className="journey-display-reference">Connect Standard · 2560 × 1440 · 앱 화면 1682 × 1210</p>
        <GuidanceMuteToggle />
        {controls}
        {flowEvents}
      </div></details>
    </section></div>
  </div>

  return <section ref={flow} className="journey-flow" data-testid="journey-flow" data-step={step} data-call={call} data-emergency={emergency} data-transfer={request?.transport ?? request?.status ?? 'idle'} onPointerDownCapture={stopCountdown} onClickCapture={cancelCountdown} onPointerCancelCapture={cancelCountdown} onKeyDownCapture={cancelCountdown}
    onCompositionStartCapture={()=>{composing.current=true;if(flow.current)flow.current.dataset.composing='true'}}
    onCompositionEndCapture={()=>{composing.current=false;if(flow.current)flow.current.dataset.composing='false';const action=deferredAction.current;deferredAction.current=null;if(action)queueMicrotask(action)}}>
    <VehicleShell device={device} presentation="bounded" controls={controller} previewHeight={previewHeight} appWindow={appWindow}><div className="fs-dashboard journey-flow-dashboard">
      <FlowBoard layout={inspectingSent ? 'review' : layout} emergencyActive={emergency} attention={vehicleNeedsAttention(value) ? ['vehicle'] : []} notificationKey={[step, call, emergency, request?.transport, receipt, checks, arrived, inspectingSent, scene === 'risk-check'].join('/')} reduced={reduced||!active} readout={false} onSettled={revealEditor} renderCell={renderCell} />
      {inPleosApp && <div className="host-guidance">{guidance}</div>}
    </div></VehicleShell>
    {inPleosApp && hostDemo && <HostDemoStrip>
      {copy.demo && <button type="button" aria-label={`시연 event: ${copy.action}`} onClick={() => afterComposition(() => void next())}>{copy.action}</button>}
      <GuidanceMuteToggle />
      {controls}
      {flowEvents}
    </HostDemoStrip>}
  </section>
}
