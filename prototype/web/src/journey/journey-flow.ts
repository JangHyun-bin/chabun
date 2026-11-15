import type { FlowLayout } from '@/design-system/flow-study-model'
import { riskState, type JourneyCase, type Submission } from './case'

export const safetyChecklist = [
  { id: 'hazard', label: '비상등을 켜세요', action: '켰어요', note: '뒤에서 오는 차가 알아볼 수 있게 해 주세요.' },
  { id: 'trunk', label: '트렁크를 열어 주세요', action: '열었어요', note: '안전하게 열 수 있을 때만 진행하세요. 차도로 나가지 마세요.' },
  { id: 'safe-arrival', label: '가드레일 밖으로 대피하세요', action: '대피했어요', note: '안전하게 나갈 수 있다면 휴대폰을 챙겨 차가 다니지 않는 곳으로 이동하세요.' },
] as const
export const noUrgentDanger = { id: 'situation-clear', label: '급한 위험 없음' } as const
export const urgentDanger = { id: 'situation-danger', label: '다친 사람이나 위험 있음' } as const

export type CallState = 'idle' | 'connecting' | 'connected' | 'ended'
export type ResponsePath = 'unanswered' | 'danger' | 'call' | 'clear'
export type ResponseStep = 1 | 2 | 3 | 4
type JourneyStep = ResponseStep | 5 | 6 | 7
export type FlowScene = 'situation' | 'situation-airbag' | 'situation-danger' | 'situation-call' | 'situation-clear' | 'emergency' | 'calling' | 'call' | 'call-ended' | 'move' | 'ready' | 'risk-check'
  | 'record-empty' | 'record' | 'review' | 'review-ready' | 'review-failed' | 'review-declined' | 'sending' | 'sent' | 'received' | 'sent-review'
type SceneCopy = { title: string; support: string; action: string; blocked?: true; demo?: true }

export const safetyConfirmed = (value: JourneyCase, id: string) => value.safetyActions.some(action => action.id === id && ['user-confirmed', 'device-confirmed'].includes(action.status))
export const activeRequest = (value: JourneyCase, agency: Submission['agency']) => value.submissions.find(item => item.id === value.activeSubmissionIds[agency])
export const callState = (value: JourneyCase): CallState => {
  const request = activeRequest(value, 'rescue')
  return request?.call ?? (request?.status === 'connected' ? 'connected' : request?.status === 'connection_unknown' ? 'connecting' : 'idle')
}
export const callLive = (call: CallState) => call === 'connecting' || call === 'connected'
export const airbagSignal = (value: JourneyCase) => value.observations.some(item => item.kind === 'seat-airbag-deployed' && item.confirmation === 'attention'
  && !value.observations.some(other => other.supersedes === item.id))
export const hasJourneyRecord = (value: JourneyCase) => value.statements.some(item => item.text.trim()) || value.evidence.some(item => item.availability === 'available') || !!value.diagram || !!value.report?.paragraphs.some(item => item.text.trim())
export const responsePath = (value: JourneyCase): ResponsePath => callState(value) !== 'idle' ? 'call'
  : safetyConfirmed(value, urgentDanger.id) ? 'danger' : safetyConfirmed(value, noUrgentDanger.id) ? 'clear' : 'unanswered'
export const emergencyActive = (value: JourneyCase) => callLive(callState(value)) || safetyConfirmed(value, urgentDanger.id)
  || airbagSignal(value) && !safetyConfirmed(value, noUrgentDanger.id)

const isResponseStep = (step: JourneyStep): step is ResponseStep => step <= 4
const responseSteps: Record<ResponseStep, { next: (path: ResponsePath, arrived: boolean) => ResponseStep | 'record' | null; back: (path: ResponsePath) => ResponseStep | null }> = {
  1: { next: path => path === 'call' || path === 'danger' ? 2 : path === 'clear' ? 3 : null, back: () => null },
  2: { next: (_, arrived) => arrived ? 4 : 3, back: () => 1 },
  3: { next: () => 4, back: path => path === 'call' || path === 'danger' ? 2 : 1 },
  4: { next: () => 'record', back: () => 3 },
}
const resumeStep: Record<ResponsePath, ResponseStep> = { unanswered: 1, danger: 2, call: 2, clear: 3 }
const situationScene: Record<ResponsePath, FlowScene> = { unanswered: 'situation', danger: 'situation-danger', call: 'situation-call', clear: 'situation-clear' }
const callScene: Record<CallState, FlowScene> = { idle: 'emergency', connecting: 'calling', connected: 'call', ended: 'call-ended' }
const stepLayout: Record<JourneyStep, FlowLayout> = { 1: 'detect', 2: 'emergency', 3: 'evacuate', 4: 'evacuate', 5: 'safe', 6: 'review', 7: 'calm' }

const situation = { title: '괜찮으세요?', support: '충돌을 감지했어요. 다친 사람이 있거나 위험하면 119 전화 화면을 열 수 있어요.' }
const recording = { title: '기억나는 내용을 남겨주세요', support: '말, 사진, 직접 입력 중 편한 방법을 고르세요.' }
const reviewing = { title: '보험사에 보낼 내용을 확인하세요', support: '받는 곳과 보낼 자료는 직접 골라요.' }
export const sceneCopy: Record<FlowScene, SceneCopy> = {
  situation: { ...situation, action: '상황을 고르면 다음으로 넘어가요', blocked: true },
  'situation-airbag': { title: '괜찮으세요?', support: '에어백 전개 신호가 왔어요. 다친 사람이 있는지 먼저 확인해 주세요.', action: '상황을 고르면 다음으로 넘어가요', blocked: true },
  'situation-danger': { ...situation, action: '119 연결 보기' },
  'situation-call': { ...situation, action: '119 전화 화면 상태 보기' },
  'situation-clear': { ...situation, action: '대피 안내 보기' },
  emergency: { title: '119 전화 화면을 열 수 있어요', support: '다친 사람은 억지로 움직이지 마세요. 불이나 연기가 보이면 차에서 멀리 떨어지세요.', action: '대피 안내 보기' },
  calling: { title: '119 전화 화면을 열었어요', support: '실제 발신과 구호 접수는 확인되지 않았어요. 전화 앱에서 직접 연결해 주세요.', action: '대피 안내 보기' },
  call: { title: '통화 연결 시연', support: '실제 통화나 구호 접수를 확인한 상태가 아니에요.', action: '대피 안내 보기' },
  'call-ended': { title: '통화 종료 시연', support: '도움이 더 필요하면 119 전화 화면을 다시 열 수 있어요.', action: '대피 안내 보기' },
  move: { title: '안전한 곳으로 이동하세요', support: '할 수 있는 것부터 하나씩 해 주세요.', action: '안전한 곳에 있어요' },
  ready: { title: '기억나는 내용을 남겨 둘까요?', support: '말이나 사진으로 편하게 남길 수 있어요.', action: '기록 시작' },
  'risk-check': { title: '주변을 다시 살펴보세요', support: '새로운 위험이 감지됐어요. 남기던 기록은 그대로 있어요.', action: '주변을 확인하면 이어서 진행해요', blocked: true },
  'record-empty': { ...recording, action: '기록을 저장하면 다음으로 넘어가요', blocked: true },
  record: { ...recording, action: '남긴 내용 확인' },
  review: { ...reviewing, action: '받는 곳과 보낼 자료 고르기' },
  'review-ready': { ...reviewing, action: '승인한 내용 보내기' },
  'review-failed': { title: '보내지 못했어요', support: '기록은 그대로 있어요. 승인한 내용 그대로 다시 보낼 수 있어요.', action: '다시 보내기' },
  'review-declined': { title: '보험사에 보내지 않기로 했어요', support: '남긴 기록은 이 기기에 그대로 있어요. 마음이 바뀌면 다시 보낼 수 있어요.', action: '다음 할 일 보기' },
  sending: { title: '보험사에 보내는 중이에요', support: '승인한 자료만 보내요.', action: '시연 전송 완료', demo: true },
  sent: { title: '보험사에 보냈어요', support: '접수 결과는 아직 확인 중이에요.', action: '차량 지원·정비소 안내 보기' },
  received: { title: '보험사에 접수됐어요', support: '접수번호를 확인한 뒤 다음 할 일을 살펴보세요.', action: '차량 지원·정비소 안내 보기' },
  'sent-review': { title: '보낸 내용을 확인하세요', support: '보낸 기록과 공유 내역을 볼 수 있어요.', action: '완료 화면으로' },
}

export function journeyFlow(value: JourneyCase, responseView: ResponseStep | null = null) {
  const request = activeRequest(value, 'insurance')
  const call = callState(value)
  const path = responsePath(value)
  const arrived = safetyConfirmed(value, 'safe-arrival')
  const emergency = emergencyActive(value)
  const sending = request?.transport === 'sending'
  const sent = request?.transport === 'sent' || !request?.transport && ['sent', 'received'].includes(request?.status ?? '')
  const step: JourneyStep = value.stage === 'record' ? 5 : value.stage === 'review' || value.stage === 'follow-up' ? sent ? 7 : 6
    : responseView ?? (arrived ? 4 : resumeStep[path])
  const response = isResponseStep(step) ? responseSteps[step] : null
  const scene: FlowScene = value.stage === 'response' && riskState(value)?.acknowledged === false ? 'risk-check'
    : sending && step >= 4 ? 'sending'
    : step === 1 ? path === 'unanswered' && airbagSignal(value) ? 'situation-airbag' : situationScene[path]
    : step === 2 ? callScene[call] : step === 3 ? 'move' : step === 4 ? 'ready'
    : step === 5 ? hasJourneyRecord(value) ? 'record' : 'record-empty'
    : step === 6 ? request?.transport === 'failed' ? 'review-failed' : request?.transport === 'approved' ? 'review-ready'
      : value.emergency.requests.insurance === 'declined' ? 'review-declined' : 'review'
    : request?.status === 'received' ? 'received' : 'sent'
  const layout: FlowLayout = scene === 'sending' || step === 7 && callLive(call) ? 'sending' : scene === 'situation-airbag' ? 'emergency' : stepLayout[step]
  return { step, scene, layout, emergency, path, call, arrived, request, sending,
    next: response?.next(path, arrived) ?? null, back: response?.back(path) ?? null }
}
