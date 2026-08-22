# 하루 일과표 (Daily Planner)

드래그로 일과를 기록하고 AI 피드백을 받는 단일 HTML 일과표 앱입니다.

## 온라인 사용

현재 Azure 배포 주소: https://planner-ai-proxy-20260822-r0355.azurewebsites.net/

배포된 페이지는 같은 주소의 AI 프록시를 사용합니다. GitHub 저장소에는 토큰을 저장하지 않으며, `GITHUB_TOKEN`은 Azure App Service 설정에서만 주입됩니다.

GitHub의 `blob` 파일 보기에서는 HTML이 실행되지 않습니다. 저장소 HTML을 온라인에서 실행하려면 GitHub Pages 주소(활성화된 경우)를 사용하거나 위 Azure 주소를 사용하세요. `planner-config.js`는 GitHub Pages에서 Azure 프록시를 호출하도록 설정되어 있습니다.

## 기능
- 24시간 × 10분 단위 드래그 일과 기록, 활동별 색상 범례
- 과거/미래 날짜 조회 (◀▶, 캘린더 이동)
- 미래 날짜: 하루 계획표 + Todo 작성
- 프로필(이름·생년월일·직업·목표·현재 상황·계획) 및 온보딩 페이지
- ✨ AI 장기 계획 생성 / 🔄 행동 패턴 기반 계획 업데이트
- 제출 시 계획 대비 일치도 점수·원인 분석·개선 방안 AI 피드백
- 한눈에 보기: 월간 캘린더에 일치도 점수 표시
- 설정: 질문(의견란 타이틀), 자주 쓰는 일과 프리셋

## 실행 방법
### 로컬 개발

GitHub Copilot 구독과 Copilot SDK 인증 토큰이 필요합니다. 토큰은 파일에 저장하거나 코드에 넣지 말고 현재 셸의 환경변수로만 주입하세요.

PowerShell:
```powershell
$env:GITHUB_TOKEN = '<your-github-token>'
cd planner
npm install
npm start
```

또는 프록시 폴더에서 실행할 수 있습니다.
```powershell
cd planner/ai-proxy
npm install
node server.js
```

1. `planner/daily-planner.html`을 브라우저에서 열기
2. 프록시 상태 확인: `http://localhost:8787/health`

`file://`로 HTML을 열면 AI 호출은 자동으로 `http://localhost:8787`을 사용합니다. HTML을 `http://localhost:8000` 같은 별도 정적 서버에서 제공한다면 프록시를 실행하기 전에 `ALLOWED_ORIGINS=http://localhost:8000`을 설정하세요. `GH_TOKEN`도 SDK 호환 로컬 대체 변수로 지원합니다.

### 온라인 운영 (Azure App Service)

프록시가 HTML도 함께 제공하므로 App Service URL 하나만 사용하면 됩니다. `planner-config.js`의 `apiBaseUrl`을 비워 두면 배포된 페이지의 same-origin API(`/generate`, `/longplan`, `/updateplan`, `/feedback`)를 사용합니다. 별도 정적 호스팅을 사용할 때만 배포별 주소를 설정하세요.

필요한 값은 리소스 그룹, 전역적으로 고유한 App Service 이름, Azure 리전, 그리고 현재 셸의 `GITHUB_TOKEN`입니다. 토큰은 Azure App Service 설정에만 저장되며 저장소나 파일에는 기록되지 않습니다.

PowerShell:
```powershell
$env:AZURE_RESOURCE_GROUP = 'my-planner-rg'
$env:AZURE_APP_NAME = 'my-planner-proxy-unique'
$env:AZURE_LOCATION = 'koreacentral'
$env:GITHUB_TOKEN = '<your-github-token>'

.\azure\deploy.ps1
```

`AZURE_SUBSCRIPTION_ID`를 설정하면 해당 구독을 선택합니다. 외부 정적 사이트를 허용해야 하면 `AZURE_ALLOWED_ORIGINS`에 쉼표로 구분한 정확한 origin(예: `https://planner.example.com`)을 설정하세요. 예시 운영 설정은 `azure/appsettings.example.json`에 있습니다.

배포 후:
```text
https://<app-name>.azurewebsites.net/
https://<app-name>.azurewebsites.net/health
https://<app-name>.azurewebsites.net/ready
```

`/health`는 liveness 확인용이고 `/ready`는 `GITHUB_TOKEN` 설정 여부를 확인합니다. App Service는 `PORT`를 주입하며 서버는 `0.0.0.0`에 바인딩합니다. 요청 본문은 기본 128 KiB로 제한되고, AI 동시 요청 수와 IP별 rate limit도 제한됩니다.

수동 배포가 필요하면 App Service의 시작 명령을 `npm start`로 지정하고 저장소 루트를 배포하세요. Azure 설정에서 `GITHUB_TOKEN`, `NODE_ENV=production`, `ALLOW_NULL_ORIGIN=false`, `ALLOWED_ORIGINS=https://<app-name>.azurewebsites.net`을 반드시 설정하세요.

데이터는 브라우저 localStorage에 저장되며, AI 기능은 환경별 프록시 주소를 사용합니다. `planner-config.js` 또는 URL의 `?apiBaseUrl=https://...`로 별도 프록시 주소를 지정할 수 있고, 설정이 없고 HTML을 로컬 파일로 열었을 때만 localhost fallback이 적용됩니다.

## 처음 사용하는 방법
1. 처음 열면 도움말이 표시됩니다. 설정에서 이름·직업·목표와 현재 상황을 입력하고 일과표를 시작하세요.
2. 오늘 날짜의 시간표를 시작 칸부터 끝 칸까지 드래그한 뒤 활동명을 입력합니다. 여러 활동을 반복해서 기록할 수 있습니다.
3. 기록이 끝나면 `제출하기`를 눌러 계획 대비 일치도와 AI 피드백을 확인하세요.
4. 상단 날짜의 ◀ ▶로 과거와 미래를 이동할 수 있습니다. 미래 날짜에는 계획과 Todo를 미리 작성할 수 있습니다.
5. `📅 한눈에 보기`에서 날짜별 기록을 확인하고, 설정에서 프로필·자주 쓰는 일과·질문을 수정합니다.

도움말은 상단 `? 도움말` 버튼으로 언제든 다시 열 수 있습니다. `다음부터 다시 보지 않기`를 선택하면 이 브라우저에서 안내를 숨깁니다. 기록은 브라우저 localStorage에 저장되고, AI 생성·피드백·계획 업데이트에는 설정된 AI 프록시가 필요합니다.
