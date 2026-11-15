// Example insurer shown until a real registered-profile source exists; the name says it is an example.
// The phone must match REGISTERED_INSURER_PHONE in ChabunNative.kt, which is the only non-119 number native will dial.
export const registeredProfile = {
  insurer: { name: '가온손해보험 (예시)', phone: '15880000', display: '1588-0000' },
  vehicleSupport: '차량 긴급출동 지원',
} as const
