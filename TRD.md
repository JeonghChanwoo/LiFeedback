# LiFeedback 기술 설계 문서 (TRD)

## 1. 문서 목적

이 문서는 현재 저장소의 `daily-planner.html`, `ai-proxy/server.js`, Node 설정과 Azure 배포 파일을 기준으로 한 기술 설계 문서(Source of Truth)다. 구현되지 않은 서비스나 기능을 전제로 하지 않는다.

## 2. 시스템 구성

```text
브라우저
  ├─ daily-planner.html
  ├─ planner-config.js
  └─ localStorage
          │ HTTPS JSON fetch
          ▼
Azure App Service
  └─ Node.js ai-proxy/server.js
       ├─ 정적 HTML/config 제공
       └─ @github/copilot-sdk
              │
              ▼
       GitHub Copilot 서비스
```

GitHub Pages를 사용할 때는 정적 HTML이 GitHub Pages origin에서 제공되고, `planner-config.js`의 Azure URL로 프록시를 호출한다. Azure App Service에서 HTML을 제공할 때는 빈 base URL을 사용해 same-origin API를 호출할 수 있다.

## 3. 클라이언트 설계

### 파일

- `daily-planner.html`: 스타일, 화면 마크업, 모든 브라우저 로직을 포함하는 단일 페이지 애플리케이션
- `planner-config.js`: 환경별 `window.PLANNER_CONFIG.apiBaseUrl` 설정
- `README.md`: 실행·배포 보조 문서

### API 주소 결정 순서

1. URL의 `apiBaseUrl` query parameter
2. `window.PLANNER_CONFIG.apiBaseUrl`
3. `file:` 프로토콜일 때 `http://localhost:8787`
4. 그 밖에는 빈 문자열을 사용해 현재 origin

모든 AI 요청은 `proxyFetch()`를 통해 상대 경로 또는 설정된 base URL로 전송한다.

### 클라이언트 저장

주요 상태는 `plannerProfile`, `plannerDay:<YYYY-MM-DD>`, `plannerWeekly`, 질문·프리셋 관련 localStorage 키에 저장된다. 서버 세션이나 쿠키 기반 사용자 계정은 사용하지 않는다.

## 4. 프록시 설계

### 런타임

- Node.js CommonJS
- 내장 `http`, `fs`, `path`, `url` 모듈
- `@github/copilot-sdk`
- 실행 명령: `npm start`

서버는 `HOST` 기본값 `0.0.0.0`, `PORT` 기본값 `8787`을 사용한다. Azure에서는 App Service가 제공하는 포트 설정을 사용한다.

### 정적 파일

다음 경로를 서버가 직접 제공한다.

| 경로 | 파일 |
| --- | --- |
| `/` | `daily-planner.html` |
| `/daily-planner.html` | `daily-planner.html` |
| `/planner-config.js` | `planner-config.js` |

### API 엔드포인트

| 메서드 | 경로 | 입력 | 출력 |
| --- | --- | --- | --- |
| `POST` | `/generate` | profile, situation, date, dayOfWeek, presets | `{ plans }` |
| `POST` | `/longplan` | profile, presets | plan, weekly |
| `POST` | `/updateplan` | profile, history, presets | analysis, plan, weekly |
| `POST` | `/feedback` | profile, schedule, date, comments | score, summary, causes, improvements |
| `GET` | `/health` | 없음 | liveness와 token 설정 여부 |
| `GET` | `/ready` | 없음 | token 설정 시 200, 아니면 503 |

AI 응답은 프롬프트가 요구한 JSON을 추출하고, 각 기능의 최소 응답 구조를 검증한다. 실패한 AI 요청은 클라이언트에 일반화된 오류를 반환하고 서버 로그에는 상태와 경로만 기록한다.

## 5. 인증과 비밀 관리

프록시는 `GITHUB_TOKEN`을 우선 사용하고 로컬 호환용으로 `GH_TOKEN`을 허용한다. 토큰은 다음 위치에만 주입한다.

- 로컬: 현재 셸의 환경변수
- Azure: App Service Application Settings의 `GITHUB_TOKEN`

토큰은 HTML, JavaScript, README, GitHub 저장소, 배포 스크립트 출력에 포함하지 않는다. `/health`와 `/ready`는 토큰의 존재 여부만 반환하며 값이나 길이를 반환하지 않는다.

## 6. CORS와 요청 보호

- same-origin 요청은 허용한다.
- `ALLOWED_ORIGINS`를 쉼표로 분리한 정확한 origin 목록으로 사용한다.
- 개발 환경에서는 설정이 없을 때 `null` origin을 허용할 수 있다.
- 운영 환경은 `ALLOW_NULL_ORIGIN=false`와 명시적인 `ALLOWED_ORIGINS`를 사용한다.
- JSON Content-Type이 아닌 POST 요청은 415를 반환한다.
- 요청 본문 기본 최대 크기는 128 KiB이며 초과 시 413을 반환한다.
- 기본 동시 AI 요청 수는 2개이며 초과 시 503을 반환한다.
- 기본 IP별 rate limit은 5분당 20회이며 초과 시 429와 `Retry-After`를 반환한다.
- 응답에 `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`를 설정한다.
- Azure App Service는 HTTPS-only로 설정한다.

## 7. Azure 배포

### 리소스

- 서비스: Azure App Service Linux
- 런타임: Node 22 LTS
- SKU: B1
- 위치: `koreacentral`
- 시작 명령: `npm start`
- 배포 스크립트: `azure/deploy.ps1`

`azure/deploy.ps1`는 현재 셸의 Azure 로그인 컨텍스트를 사용해 App Service를 만들거나 갱신하고, 토큰을 App Service 설정에 전달한다. 토큰은 파일에 쓰지 않는다.

### 주요 설정

| 설정 | 기본/운영 값 |
| --- | --- |
| `PORT` | Azure가 제공하는 포트, 배포 설정 예시는 8080 |
| `NODE_ENV` | `production` |
| `GITHUB_TOKEN` | Azure secret application setting |
| `ALLOW_NULL_ORIGIN` | `false` |
| `ALLOWED_ORIGINS` | Azure origin 및 외부 정적 호스팅 origin |
| `MAX_BODY_BYTES` | `131072` |
| `MAX_CONCURRENT_REQUESTS` | `2` |
| `RATE_LIMIT_MAX` | `20` |
| `RATE_LIMIT_WINDOW_MS` | `300000` |

### 운영 확인

- `/health`: 프로세스가 HTTP 응답 가능한지 확인
- `/ready`: Copilot 인증 환경변수가 설정됐는지 확인
- `/`: 정적 planner 페이지 확인
- GitHub Pages에서 호출할 경우 Azure `ALLOWED_ORIGINS`에 `https://jeonghchanwoo.github.io`를 포함

## 8. 배포 및 소스 구조

루트 `package.json`은 `npm start`로 `ai-proxy/server.js`를 실행하고 `npm test`로 프록시 문법 검사를 호출한다. `ai-proxy/package.json`은 프록시 단독 실행과 문법 검사를 제공한다. `.azureignore`와 `.gitignore`는 `node_modules`, `.env`, 로그 파일을 배포·커밋 대상에서 제외한다.

## 9. 알려진 제약

- 브라우저 localStorage 데이터는 브라우저·origin별로 분리된다.
- 서버에는 사용자별 인증이나 영구 기록 저장소가 없다.
- 인메모리 rate limit은 App Service 인스턴스별로 동작하며 다중 인스턴스 전역 제한은 제공하지 않는다.
- Copilot SDK 가용성, 토큰 권한과 선택 모델의 응답 형식에 따라 AI 요청 성공 여부가 달라질 수 있다.
