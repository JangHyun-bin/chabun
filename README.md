<p align="center"><img src="docs/readme-header.svg" alt="차분 · 사고 후 대처와 기록을 위한 Pleos 앱" width="100%"></p>

# 차분

사고 직후 운전자에게 안전 확인부터 기록, 보험사에 보낼 내용 확인까지 한 번에 하나씩 안내하는 Pleos 차량용 앱입니다.

## APK

- 저장소: [`apk/장희빈_차분_release.apk`](apk/장희빈_차분_release.apk)
- GitHub Release: [v1.0.0](https://github.com/JangHyun-bin/chabun/releases/tag/v1.0.0) (같은 APK, 시연 영상, [SHA256SUMS](https://github.com/JangHyun-bin/chabun/releases/download/v1.0.0/SHA256SUMS))

## 실행 방법

1. 아래 테스트 환경의 Pleos Connect Emulator를 실행합니다.
2. 저장소 루트에서 APK를 설치하고 실행합니다. 런처의 **차분** 아이콘으로 실행해도 됩니다.

   ```sh
   adb devices
   ANDROID_USER=$(adb shell am get-current-user | tr -d '\r')
   adb install --user "$ANDROID_USER" -r "apk/장희빈_차분_release.apk"
   adb shell am start --user "$ANDROID_USER" -n com.chabun.vehicle/com.example.accidentpoc.MainActivity
   ```

3. 앱은 충돌이 감지된 상황(고속도로 측면 충돌 예시)에서 시작합니다. 아래 순서로 전체 흐름을 볼 수 있습니다.

   | 단계 | 화면에서 누를 것 |
   | --- | --- |
   | 상황 확인 | **다친 사람이 있어요** 또는 **괜찮아요** |
   | 119 | 10초 카운트다운 중 **지금 연결**(전화 화면만 열림, 발신 버튼은 누르지 않음) → 앱으로 돌아와 **대피 안내 보기** |
   | 안전 확인 | 비상등 **켰어요** → 트렁크 **열었어요** → **대피했어요** |
   | 기록 | **기록 시작** → **직접 입력**으로 진술 입력 → **기록 저장** |
   | 경위서 | **예시 경위서 만들기** → 문장마다 **문장 확인** |
   | 전송 검토 | **보낼 내용 확인** → **선택한 내용 미리보기** → **이 내용으로 요청** |
   | 이후 안내 | **차량 지원·정비소 안내 보기** |

4. 처음부터 다시 보려면 앱 데이터를 지웁니다: `adb shell pm clear --user "$ANDROID_USER" com.chabun.vehicle`

앱 창 오른쪽 가장자리의 **시연** 손잡이는 발표자용 조작(다음 결과 진행, 안내 음성 끄기)입니다.

## 테스트 환경 및 필요한 설정

- 공식 Pleos Connect Emulator에서 실행합니다. 일반 Google APIs 이미지에는 Pleos 차량 서비스가 없습니다. 설치는 [Pleos 공식 안내](https://document.pleos.ai/en/docs/connect/guide/getting-started/application-development/setup-connect-sdk-emulator)를 따릅니다.
- 서버, 네트워크, 로그인 없이 APK 하나로 실행됩니다.
- 안내 음성을 들으려면 에뮬레이터 오디오 출력을 켭니다(`-no-audio`로 실행하면 음성이 나오지 않습니다).
- 마이크 권한은 **말로 기록하기**를 처음 누를 때만 요청합니다. 거부해도 **직접 입력**으로 진행할 수 있습니다.
- 충돌 장면, 예시 경위서, 보험사 접수 결과는 시연용 예시입니다. 실제 보험사·119·차량 지원 연동은 없으며, 결과 화면에 **예시 결과 · 실제 접수 아님**이 함께 표시됩니다.
- 휴대폰으로 이어 기록하는 기능은 HTTPS 서버와 연결 빌드가 필요해 이 APK에는 포함되지 않습니다.
- 직접 빌드하려면 Node.js 22.12 이상, JDK 21, Android SDK 35, Build Tools 36.0.0이 필요합니다. [빌드·설치 방법](docs/build.md)을 참고해주세요.

## Pleos Connect 에뮬레이터 버전과 화면 규격

| 항목 | 값 |
| --- | --- |
| 에뮬레이터 | 공식 Pleos Connect Emulator, Pleos Connect v2.1.0 시스템 이미지 (Android API 34) |
| 화면 | 2560×1440, 160dpi |
| 앱 창 | 1682×1210 |
| 앱 | `com.chabun.vehicle`, minSdk 28, targetSdk 35 |

## 문서와 라이선스

- [심사 시나리오와 제한](docs/submission.md) · [검증 기록](docs/verification.md) · [빌드·설치 방법](docs/build.md)
- 라이브러리·폰트·UI 구성 요소의 라이선스는 [제3자 고지](THIRD_PARTY.md)를 참고해주세요. 자체 소스에는 별도의 재사용 라이선스를 부여하지 않습니다.
