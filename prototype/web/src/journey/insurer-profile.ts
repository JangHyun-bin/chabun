// Profile the driver registered before driving. Demo values: replace with the real profile source when it exists.
// The phone must match REGISTERED_INSURER_PHONE in ChabunNative.kt, which is the only non-119 number native will dial.
export const registeredProfile = {
  insurer: { name: '내 자동차보험 (등록된 보험사)', phone: '15880000', display: '1588-0000' },
  vehicleSupport: '차량 긴급출동 지원',
} as const
