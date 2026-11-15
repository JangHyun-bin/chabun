import { LIMITS, type Evidence, type EvidenceReference, type JourneyCase, type Report, type ReportParagraph } from './case'

const mediaLabels = { video: '영상', photo: '사진', audio: '음성' }
const exampleParagraphPrefix = 'example-'

export function isExampleReport(report: Report | null): boolean {
  return report?.paragraphs.some(paragraph => paragraph.id.startsWith(exampleParagraphPrefix)) ?? false
}

function referenceFor(evidence: Evidence): EvidenceReference | null {
  if (evidence.availability !== 'available' || !evidence.assetId || evidence.metadata.bytes <= 0) return null
  const duration = evidence.metadata.duration
  if (evidence.kind !== 'photo' && (duration === null || !Number.isFinite(duration) || duration <= 0)) return null
  return { evidenceId: evidence.id, evidenceRevision: evidence.revision,
    start: evidence.kind === 'photo' ? null : 0, end: evidence.kind === 'photo' ? null : duration }
}

export function createExampleReport(value: JourneyCase): Report | null {
  const evidence = value.evidence.flatMap(item => {
    const reference = referenceFor(item)
    return reference ? [{ item, reference }] : []
  })
  const paragraphs: ReportParagraph[] = evidence.filter(({ item }) => item.kind !== 'audio' ||
    !value.statements.some(statement => statement.text.trim() && statement.audioEvidenceIds.includes(item.id)))
    .map(({ item, reference }, index) => ({
      id: `${exampleParagraphPrefix}media-${index + 1}`, kind: 'observation', revision: 1, confirmedRevision: null,
      text: item.kind === 'photo'
        ? `사진 자료 "${item.label}"을 경위 확인 자료로 남겼어요.${item.origin === 'sample' ? ' 예시 자료예요.' : ''}`
        : `${mediaLabels[item.kind]} 자료 "${item.label}"의 ${reference.start}초부터 ${reference.end}초까지를 경위 확인 자료로 연결했어요.${item.origin === 'sample' ? ' 예시 자료예요.' : ''}`,
      references: [reference],
    }))
  for (const [index, statement] of value.statements.entries()) {
    if (!statement.text.trim()) continue
    paragraphs.push({ id: `${exampleParagraphPrefix}statement-${index + 1}`, text: statement.text, kind: 'statement', revision: 1, confirmedRevision: null,
      references: evidence.filter(({ item }) => item.kind === 'audio' && statement.audioEvidenceIds.includes(item.id)).map(({ reference }) => ({ ...reference })) })
  }
  if (!paragraphs.length) return null
  const included = paragraphs.slice(0, LIMITS.reportParagraphs - 1)
  included.push({ id: `${exampleParagraphPrefix}unconfirmed`, kind: 'unknown', revision: 1, confirmedRevision: null, references: [],
    text: `${included.length < paragraphs.length ? '문장 한도로 일부 자료만 연결했어요. ' : ''}사고 원인·주행 속도·과실 비율은 이 예시 경위서에서 판단하지 않았어요. 자료와 진술을 확인한 뒤 문장을 직접 수정해주세요.` })
  return { revision: 1, basedOnRevision: value.contentRevision, paragraphs: included }
}
