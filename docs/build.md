# 빌드와 실행

## 차량 단독 Release

Node.js 22.12 이상과 npm, JDK 21, Android SDK platform 35, Build Tools 36.0.0, platform-tools를 준비합니다. `JAVA_HOME`과 `ANDROID_HOME`을 해당 설치 경로로 설정합니다. 최초 빌드는 의존성 다운로드가 필요하지만 standalone APK 실행에는 서버가 필요하지 않습니다.

Pleos SDK와 시스템 이미지는 [공식 안내](https://document.pleos.ai/en/docs/connect/guide/getting-started/application-development/setup-connect-sdk-emulator)에 따라 별도로 설치하고 해당 약관에 동의합니다. 소스는 Maven 좌표만 포함하며 SDK JAR·AAR·시스템 이미지를 제공하지 않습니다. 녹음 예시는 제공자 조건에 따라 생성한 David 음성이고, 재배포 권한이 미확인인 OS 화면 이미지는 포함하지 않습니다.

```sh
(cd prototype/web && npm ci && npm run build:native)
./prototype/android/release.sh "$SIGNING_ENV" standalone "$OUTPUT_APK"
```

저장소 밖의 `SIGNING_ENV`에 다음 환경변수를 설정합니다. 파일은 shell로 실행되므로 신뢰하는 파일만 전달합니다. 키·설정 파일은 비공개로 보관하고 내용을 로그에 출력하지 않습니다.

- `CHABUN_RELEASE_STORE_FILE`은 저장소 밖 keystore의 절대 경로입니다.
- `CHABUN_RELEASE_STORE_PASSWORD`와 `CHABUN_RELEASE_KEY_PASSWORD`는 서명 비밀번호입니다.
- `CHABUN_RELEASE_KEY_ALIAS`는 debug가 아닌 release alias입니다.
- `CHABUN_RELEASE_CERT_SHA256`은 예상 release 인증서의 공개 SHA-256 fingerprint입니다.

`release.sh`는 외부 키와 예상 단일 signer를 확인하고 APK 및 `.sha256` 파일을 새 출력 경로에 만듭니다. 앱 ID는 `com.chabun.vehicle`, minSdk는 28, compileSdk·targetSdk는 35입니다. Kotlin package는 `com.example.accidentpoc`을 유지합니다.

`CHABUN_VEHICLE_ENVIRONMENT=emulator`는 SDK 값을 시뮬레이션으로 표시합니다. 기본 `auto`도 에뮬레이터를 감지합니다. 대회용 앱은 `CHABUN_DEMO_CONTROLS=true`를 사용합니다. 이 설정은 실제 센서·기관 처리 기능을 추가하지 않습니다.

## 설치

공식 Pleos Connect Emulator API 34를 사용합니다. 일반 Google APIs 이미지에는 Pleos 차량 서비스가 없습니다. 특정 기존 기기를 자동으로 선택하거나 초기화하지 않습니다.

```sh
adb devices
adb -s "$ANDROID_SERIAL" shell getprop ro.build.version.sdk
ANDROID_USER=$(adb -s "$ANDROID_SERIAL" shell am get-current-user | tr -d '\r')
adb -s "$ANDROID_SERIAL" install --user "$ANDROID_USER" -r "$OUTPUT_APK"
adb -s "$ANDROID_SERIAL" shell am start --user "$ANDROID_USER" -n com.chabun.vehicle/com.example.accidentpoc.MainActivity
```

기존 설치와 서명이 다르면 데이터를 지우지 말고 별도 AVD를 준비합니다. WebView는 APK 내부 `assets/web`를 사용합니다. 웹을 고친 뒤에는 native 번들과 APK를 모두 다시 빌드합니다.

## 웹과 별도 휴대폰 시연

```sh
cd prototype/web
npm ci
npm run dev
```

개발 화면은 `http://127.0.0.1:5173/`입니다. 휴대폰 시연에는 Bun과 같은 origin의 HTTPS 서버가 추가로 필요합니다. `prototype/web`에서 `npx vite build`를 실행하고, 저장소 루트에서 서버를 시작합니다. 기존 서버를 임의로 종료하지 않습니다.

```sh
CHABUN_ORIGIN="$HTTPS_ORIGIN" bun prototype/web/server/index.ts
./prototype/android/release.sh "$SIGNING_ENV" "$HTTPS_ORIGIN" "$OUTPUT_APK"
```

HTTPS reverse proxy나 터널 뒤에서는 서버 설정에 `CHABUN_TRUST_PROXY=true`가 필요합니다. origin에는 경로·query·fragment·인증정보를 넣지 않습니다. 서버 주소가 바뀌면 연결 APK를 다시 빌드합니다. 개인 기록 DB와 pairing credential은 공개 소스에 포함하지 않습니다.

## 검사 명령

아래는 재현용 명령이며 이 문서의 작성이나 소스 내보내기가 검사 통과를 뜻하지 않습니다. 설치한 Chrome을 사용하는 Playwright 구성과 Bun 환경을 확인합니다.

```sh
(cd prototype/web && npm run check && npm run test:ui)
(cd prototype/web && bun test server-tests data-tests)
node --test specs/emergency-experience/manifest.test.mjs
node --test prototype/web/scripts/generate-guidance-audio.test.mjs prototype/web/scripts/guidance-recording.test.mjs
(cd prototype/android && ANDROID_SERIAL="$TEST_ANDROID_SERIAL" ./gradlew connectedDebugAndroidTest)
```

Android instrumentation은 앱 설치 상태를 바꿀 수 있으므로 별도 테스트 AVD에서 실행합니다. 과거 evidence와 로컬 빌드 결과는 소스 snapshot에 포함하지 않습니다. 최종 APK의 오프라인 실행·재시작·테마와 실제 MP4는 발행자가 따로 확인합니다.
