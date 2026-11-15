# 제3자 고지

자체 소스에 별도의 재사용 라이선스를 부여하지 않습니다. 아래 구성요소에는 각각의 이용 조건이 적용됩니다.

| 구성 | 고지 |
| --- | --- |
| Cult UI, Motion Primitives, shadcn | `prototype/web/third-party/`의 MIT 원문과 변경 출처 |
| Asta Sans | 같은 폴더의 OFL-1.1과 Android `third-party/asta-sans/OFL.txt` |
| Paperlogy | README 머리 이미지(`docs/readme-header.svg`)의 문구를 글자 윤곽선으로 바꿔 썼습니다. 폰트 파일은 포함하지 않습니다. [SIL OFL-1.1](https://github.com/Freesentation/paperlogy/blob/main/OFL%20license.txt) |
| npm 의존성 | `third-party/npm/`의 원문, `third-party/npm-packages.json`의 고정 버전과 출처 |
| GSAP | Standard “No Charge” License. MIT가 아닙니다. 원문을 보존합니다. |
| Gradle wrapper | `third-party/gradle-wrapper-LICENSE.txt`의 Apache-2.0 |
| Pleos SDK | 공식 Maven 의존성으로 가져옵니다. SDK JAR·AAR·시스템 이미지는 소스에 재배포하지 않습니다. |
| 음성 | 직접 작성한 문장을 ElevenLabs David로 합성했습니다. 원고·생성시각·해시를 보존합니다. 녹음 예시는 실제 사용자 녹음이나 음성 인식 결과가 아닙니다. |
| 사진·영상 예시 | 저장소 스크립트로 만든 합성 자료입니다. 실제 사고·사람·번호판 자료가 아닙니다. |

`prototype/web/public/licenses.txt`에는 패키지에 포함할 고지 원문을 모았습니다. 웹 빌드와 APK의 `assets/web`에도 들어갑니다. npm 패키지에서 빠진 고지는 같은 프로젝트·버전 또는 공개 upstream 원문으로 보완하고 출처를 기록했습니다. wasm-util은 발표 gitHead에 접근할 수 없어, npm의 MIT 선언과 현재 upstream 고지를 구분해 기록했습니다.

재배포 권한이 미확인인 Pleos 화면 캡처와 Figma 이미지는 포함하지 않습니다. 웹에서는 OS 경계만 표시하고, 차량 OS는 실제 Pleos 에뮬레이터로 확인합니다.

## 제공자 조건

- [Pleos SDK License](https://nexus-playground.pleos.ai/repository/raw-releases/connect-avd/2.x/crp-arm64-sys-img.xml): 호환 CRP 앱 개발·배포의 조건과 SDK 자체 재배포 제한을 구분합니다. 필수 고지를 보존합니다.
- [ElevenLabs 공개 이용 안내](https://elevenlabs.io/docs/help-center/legal/can-i-publish-the-content-i-generate-on-the-platform): 유료 기간 생성물의 상업·무기한 이용을 허용하며 Beta Services는 제외합니다. 생성 당시 Creator active와 Eleven v4 등록·Beta 표기 부재를 확인했습니다. API에 명시적 Beta 필드는 없었으므로 이를 별도 보증으로 바꾸지 않습니다.
- [GSAP Standard License](https://gsap.com/standard-license/): 허용 용도와 고지 보존 조건을 따릅니다.
