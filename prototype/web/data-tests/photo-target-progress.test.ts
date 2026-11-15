import { expect, test } from 'bun:test'
import { reduceCase, type CaptureTarget, type Evidence, type JourneyCase } from '../src/journey/case'
import { createProductCase } from '../src/product/product-case'
import { vehicleProgress } from '../src/product/product-progress'

const now = '2026-11-14T16:00:00.000Z'
const phone = { paired: true, online: true, lastSeenAt: now, clientId: 'phone-one' }
function photo(id: string, target: CaptureTarget, skipped = false): Evidence {
  return { id, label: target, kind: 'photo', origin: 'user', revision: 1, captureTarget: target,
    availability: skipped ? 'skipped' : 'available', assetId: skipped ? null : `asset-${id}`,
    metadata: { mime: skipped ? '' : 'image/jpeg', bytes: skipped ? 0 : 10, duration: null,
      capturedAt: skipped ? null : now, sourceLabel: skipped ? '사용자가 생략' : '사진 선택' } }
}
function put(value: JourneyCase, item: Evidence) {
  return reduceCase(value, { type: 'evidence-put', evidence: item })
}

test('the vehicle counts captured targets instead of files or skipped targets', () => {
  let value = createProductCase('progress-case', now)
  value = put(value, photo('scene-one', 'scene'))
  value = put(value, photo('scene-two', 'scene'))
  value = put(value, photo('own-one', 'own-car'))
  value = put(value, photo('other-one', 'other-car'))
  value = put(value, photo('signals-skipped', 'signals', true))
  expect(vehicleProgress(value, phone).record.photos).toBe(3)
  expect(value.evidence.filter(item => item.availability === 'available')).toHaveLength(4)
})

test('removing one of two photos preserves a target until its last photo is removed', () => {
  let value = put(put(createProductCase('progress-removal', now), photo('one', 'scene')), photo('two', 'scene'))
  value = reduceCase(value, { type: 'evidence-remove', id: 'one' })
  expect(vehicleProgress(value, phone).record.photos).toBe(1)
  value = reduceCase(value, { type: 'evidence-remove', id: 'two' })
  expect(vehicleProgress(value, phone).record.photos).toBe(0)
})
