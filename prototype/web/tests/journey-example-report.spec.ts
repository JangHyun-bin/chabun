import { expect, test } from '@playwright/test'
import { createSession } from '../src/emergency/session'
import { createCase, evidenceForReference, LIMITS, makeSubmission, preparePayload, reduceCase, validateCase, type Evidence, type JourneyCase, type Report } from '../src/journey/case'
import { createExampleReport } from '../src/journey/example-report'

const now = '2026-11-15T09:12:00.000Z'
const fresh = () => {
  const value = createCase(createSession('SC01', 'connected'), 'example-report-case', now)
  value.fixtureId = 'partial-evidence'
  return value
}
const video: Evidence = { id: 'current-front', revision: 3, label: '현재 전방 영상', kind: 'video', origin: 'sample', availability: 'available', assetId: 'front-v3', captureTarget: null,
  metadata: { mime: 'video/mp4', bytes: 100, duration: 4.5, eventTime: 2, capturedAt: now, sourceLabel: '합성 전방 영상' } }
const photo: Evidence = { id: 'current-photo', revision: 2, label: '내 차량 사진', kind: 'photo', origin: 'user', availability: 'available', assetId: 'photo-v2', captureTarget: 'own-car',
  metadata: { mime: 'image/png', bytes: 100, duration: null, capturedAt: now, sourceLabel: '직접 촬영' } }
const audio: Evidence = { id: 'current-audio', revision: 4, label: '직접 남긴 음성', kind: 'audio', origin: 'user', availability: 'available', assetId: 'audio-v4', captureTarget: null,
  metadata: { mime: 'audio/wav', bytes: 100, duration: 2.25, capturedAt: now, sourceLabel: '직접 녹음' } }
function requiredReport(value: JourneyCase): Report {
  const report = createExampleReport(value)
  expect(report).not.toBeNull()
  if (!report) throw new Error('Expected an example report for the supplied records')
  return report
}

test('example sentences refer to current video, photo and spoken statement revisions without inventing the collision', () => {
  const value = fresh()
  value.contentRevision = 8
  value.evidence = [structuredClone(video), structuredClone(photo), structuredClone(audio)]
  value.evidenceHistory = [{ ...video, revision: 2, assetId: 'front-v2' }]
  value.statements = [{ id: 'spoken', text: '오른쪽에서 충격을 느꼈어요. 원인은 모르겠어요.', revision: 2, confirmedRevision: null, audioEvidenceIds: [audio.id] }]
  const before = structuredClone(value)
  const report = requiredReport(value)
  expect(report.basedOnRevision).toBe(8)
  expect(report.paragraphs).toHaveLength(4)
  expect(report.paragraphs[0]).toMatchObject({ kind: 'observation', references: [{ evidenceId: 'current-front', evidenceRevision: 3, start: 0, end: 4.5 }] })
  expect(report.paragraphs[0].text).toContain('현재 전방 영상')
  expect(report.paragraphs[0].text).toContain('예시 자료')
  expect(report.paragraphs[1]).toMatchObject({ kind: 'observation', references: [{ evidenceId: 'current-photo', evidenceRevision: 2, start: null, end: null }] })
  expect(report.paragraphs[1].text).toContain('내 차량 사진')
  expect(report.paragraphs[2]).toMatchObject({ text: value.statements[0].text, kind: 'statement', references: [{ evidenceId: 'current-audio', evidenceRevision: 4, start: 0, end: 2.25 }] })
  expect(report.paragraphs[3]).toMatchObject({ kind: 'unknown', references: [] })
  expect(report.paragraphs[3].text).toContain('판단하지 않았어요')
  for (const paragraph of report.paragraphs) {
    expect(paragraph.confirmedRevision).toBeNull()
    expect(paragraph.text).not.toMatch(/끼어들|과속|가해|과실\s*\d|\d+\s*km|부상 있음/)
    for (const reference of paragraph.references) expect(evidenceForReference(value, reference)).not.toBeNull()
  }
  expect(validateCase({ ...value, report })).toBe(true)
  expect(createExampleReport(value)).toEqual(report)
  expect(value).toEqual(before)
})

test('an empty or unavailable evidence set cannot manufacture an example report', () => {
  const value = fresh()
  expect(createExampleReport(value)).toBeNull()
  value.evidenceHistory = [video, photo, audio]
  value.evidence = [
    { ...video, availability: 'unavailable', assetId: null, metadata: { ...video.metadata, bytes: 0, duration: null } },
    { ...photo, availability: 'pending', assetId: null, metadata: { ...photo.metadata, bytes: 0 } },
    { ...audio, availability: 'failed', assetId: null, metadata: { ...audio.metadata, bytes: 0 } },
  ]
  value.statements = [{ id: 'empty', text: '   ', revision: 1, confirmedRevision: null, audioEvidenceIds: [] }]
  expect(createExampleReport(value)).toBeNull()
})

test('unknown or zero media lengths never create invented playback ranges', () => {
  for (const duration of [null, 0]) {
    const value = fresh()
    value.evidence = [{ ...video, metadata: { ...video.metadata, duration, eventTime: null } }]
    expect(createExampleReport(value)).toBeNull()
  }
  const value = fresh()
  value.evidence = [{ ...video, metadata: { ...video.metadata, duration: 0.125, eventTime: 0 } }]
  expect(requiredReport(value).paragraphs[0].references).toEqual([{ evidenceId: 'current-front', evidenceRevision: 3, start: 0, end: 0.125 }])
})

test('text-only statements remain attributed statements when their recording is unavailable', () => {
  const value = fresh()
  value.evidence = [{ ...audio, availability: 'unavailable', assetId: null, metadata: { ...audio.metadata, bytes: 0 } }]
  value.statements = [{ id: 'text-only', text: '정확한 이동 경로는 기억나지 않아요.', audioEvidenceIds: [audio.id], revision: 3, confirmedRevision: null }]
  const report = requiredReport(value)
  expect(report.paragraphs).toHaveLength(2)
  expect(report.paragraphs[0]).toMatchObject({ kind: 'statement', text: value.statements[0].text, references: [], confirmedRevision: null })
  expect(validateCase({ ...value, report })).toBe(true)
})

test('an audio-only record is linked to its exact available revision instead of transcribed by invention', () => {
  const value = fresh()
  value.evidence = [audio]
  const report = requiredReport(value)
  expect(report.paragraphs[0]).toMatchObject({ kind: 'observation', references: [{ evidenceId: 'current-audio', evidenceRevision: 4, start: 0, end: 2.25 }] })
  expect(report.paragraphs[0].text).toContain('직접 남긴 음성')
  expect(report.paragraphs[0].text).not.toContain('충돌')
})

test('generated reports respect the existing paragraph limit and disclose a partial example', () => {
  const value = fresh()
  value.statements = Array.from({ length: LIMITS.reportParagraphs + 1 }, (_, index) => ({ id: `statement-${index}`, text: `직접 남긴 내용 ${index}`, revision: 1, confirmedRevision: null, audioEvidenceIds: [] }))
  const report = requiredReport(value)
  expect(report.paragraphs).toHaveLength(LIMITS.reportParagraphs)
  expect(report.paragraphs.at(-1)?.text).toContain('일부 자료만 연결')
  expect(validateCase({ ...value, report })).toBe(true)
})

test('an example stays unapproved, edits require reconfirmation, and later examples cannot replace an edited report', () => {
  let value = fresh()
  value.evidence = [video]
  const report = requiredReport(value)
  value = reduceCase(value, { type: 'report-result', report })
  const selection = { observationIds: [], statementIds: [], evidenceIds: [video.id], includeDiagram: false, includeReport: true }
  expect(preparePayload(value, selection)).toMatchObject({ ok: false, reason: 'unreviewed-content' })
  for (const paragraph of report.paragraphs) value = reduceCase(value, { type: 'paragraph-confirm', id: paragraph.id, revision: paragraph.revision })
  expect(preparePayload(value, { ...selection, evidenceIds: [] })).toMatchObject({ ok: false, reason: 'missing-evidence' })
  const approved = makeSubmission(value, { recipient: '시연 보험사', agency: 'insurance', id: 'approved-example', now, selection })
  expect(approved.ok).toBe(true)
  if (!approved.ok) throw new Error(approved.reason)
  value = approved.value
  const snapshot = structuredClone(value.submissions.at(-1)?.payload)
  value = reduceCase(value, { type: 'paragraph-edit', id: report.paragraphs[0].id, text: '이 문장은 내가 직접 수정했어요.', references: report.paragraphs[0].references })
  const edited = structuredClone(value.report)
  expect(preparePayload(value, selection)).toMatchObject({ ok: false, reason: 'unreviewed-content' })
  value = reduceCase(value, { type: 'report-result', report: requiredReport(value) })
  expect(value.report).toEqual(edited)
  expect(value.pendingReport).not.toBeNull()
  expect(value.submissions.at(-1)?.payload).toEqual(snapshot)
})
