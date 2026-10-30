# 개인 정보 보호

VMark는 로컬 우선 에디터입니다. 문서는 디스크에 있는 파일이고, 렌더링은 여러분의 컴퓨터에서 이루어지며, 계정도 원격 측정도 충돌 보고도 없습니다. 이 페이지는 VMark가 네트워크에 접근하는 모든 경로와 각 경로가 무엇을 전송하는지, 그리고 이를 끄는 방법을 나열하고, VMark가 디스크에서 무엇을 읽을 수 있는지도 설명합니다.

## VMark가 만드는 모든 네트워크 연결

| 시점 | 연결 대상 | 전송 내용 | 중지 방법 |
|------|---------------|--------------|----------------|
| 업데이트 확인 — 기본적으로 실행 시 | `log.vmark.app`, 실패 시 대체로 GitHub Releases | 플랫폼, 아키텍처, 앱 버전, 익명 기기 해시 — [아래 상세 설명](#업데이트-확인-상세) | **설정 → 정보 → 확인 주기 → 수동만**, 또는 `log.vmark.app` 차단 |
| **REST 제공자**로 AI 지니 실행 | 구성한 엔드포인트 — Anthropic, OpenAI, OpenAI 호환 호스트, Google AI 또는 Ollama 호스트 | 채워진 프롬프트(선택한 텍스트, 블록 또는 문서와 지니가 요청한 주변 컨텍스트)와 API 키. **테스트** 버튼과 모델 새로 고침 버튼도 엔드포인트에 접속합니다 | 제공자를 구성하지 않거나 로컬 Ollama 사용 |
| **CLI 제공자**로 AI 지니 실행 | VMark 자체에서는 아무 곳에도 연결하지 않음 — 설치한 `claude`, `codex` 또는 `gemini` CLI가 자체 계정으로 자체 공급업체와 통신 | VMark는 여러분의 컴퓨터에 있는 CLI로 프롬프트를 파이프로 전달합니다 | 위와 같음 |
| HTML 내보내기 | jsDelivr(대체로 cdnjs)와 Google Fonts | 전송 없음 — 내장하기 위한 다운로드만 합니다. 문서에 수식이 있으면 KaTeX 수식 글꼴, 그리고 설정에서 선택한 웹 글꼴 | 연결 없이 내보내기. 내보내기는 시스템 글꼴로 대체됩니다 |
| 내보낸 `index.html` 열기 | jsDelivr | 전송 없음 — 수식이 있는 문서를 위해 KaTeX 스타일시트를 다운로드합니다 | 이를 인라인으로 포함하는 `standalone.html` 사용 |
| GitHub Actions 워크플로 편집 | `raw.githubusercontent.com` | 각 `uses:` 단계의 `owner/repo@ref`. 해당 `action.yml`을 가져오기 위함(24시간 캐시) | **설정 → 고급 → 액션 메타데이터 가져오기** 끄기 |
| 내장 브라우저 | 여러분이 — 또는 여러분의 승인 아래 AI 어시스턴트가 — 여는 모든 사이트 | 웹 브라우저입니다. AI 정책, 샌드박스 세션, 대상 정책은 [브라우저 가이드](/ko/guide/browser)를 참고하세요 | **설정 → 고급 → 내장 브라우저** 끄기 |
| 웹을 참조하는 문서 | 문서에 명시된 호스트 | 원격 이미지와 YouTube / Vimeo / Bilibili 임베드는 에디터나 내보낸 HTML에서 렌더링될 때 해당 호스트에서 로드됩니다 | 이미지를 로컬에 보관 |

네트워크 서비스처럼 보이지만 루프백 전용이어서 컴퓨터 밖으로 나가지 않는 것이 두 가지 있습니다.

- **MCP 서버** — AI 어시스턴트는 `127.0.0.1`에 바인딩된 WebSocket 브리지를 통해 연결하며, VMark가 앱 데이터 디렉터리에 보관하는 토큰으로 인증합니다. 어시스턴트 자체(Claude Desktop, Claude Code, Codex CLI 등)는 자체 공급업체와 통신하고, VMark는 도구 호출에 응답만 합니다. [AI 통합](/ko/guide/mcp-setup)을 참고하세요.
- **지식 베이스와 Slidev 미리보기** — 세션별 토큰을 사용하는, `127.0.0.1`에 바인딩된 로컬 서버입니다. 격리 방식은 [지식 베이스 가이드](/ko/guide/knowledge-base#개인정보-및-보안)에 설명되어 있습니다.

통합 터미널은 여러분 자신의 셸을 실행합니다. 터미널이 연결하는 모든 것은 VMark가 아니라 여러분의 명령입니다.

## VMark가 전송하지 않는 것

- 문서나 그 내용(지니를 실행할 때 구성한 AI 제공자로 보내는 경우 제외)
- 파일명 또는 경로
- 사용 패턴이나 기능 분석
- 어떤 종류의 개인 정보도 없음
- 충돌 보고서
- 키 입력 또는 편집 데이터
- 역추적 가능한 하드웨어 식별자 또는 지문

## 업데이트 확인 상세

VMark의 **자동 업데이트 확인기**는 새 버전이 있는지 확인하기 위해 서버에 접속합니다. 각 확인은 정확히 다음 필드만 전송합니다 — 그 이상은 없습니다.

| 데이터 | 예시 | 목적 |
|--------|------|------|
| IP 주소 | `203.0.113.42` | HTTP 요청에 내재된 것 — 수신하지 않을 수 없습니다 |
| OS | `darwin`, `windows`, `linux` | 올바른 업데이트 패키지를 제공하기 위해 |
| 아키텍처 | `aarch64`, `x86_64` | 올바른 업데이트 패키지를 제공하기 위해 |
| 앱 버전 | `0.5.10` | 업데이트가 있는지 확인하기 위해 |
| 기기 해시 | `a3f8c2...` (64자 16진수) | 익명 기기 카운터 — 호스트명 + OS + 아키텍처의 SHA-256. 역추적 불가 |

전체 URL은 다음과 같습니다.

```text
GET https://log.vmark.app/update/latest.json?target=darwin&arch=aarch64&version=0.5.10
X-Machine-Id: a3f8c2b1d4e5f6078a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1
```

이 서버에 연결할 수 없으면 업데이터는 GitHub Releases(`github.com/xiaolai/vmark/releases/latest/download/latest.json`)에서 같은 매니페스트를 시도합니다. 업데이트 자체는 설치 전에 minisign 서명으로 검증됩니다.

직접 확인할 수 있습니다 — 엔드포인트는 [`tauri.conf.json`](https://github.com/xiaolai/vmark/blob/main/src-tauri/tauri.conf.json)(`"endpoints"` 검색)에 있고, 해시는 [`app_setup.rs`](https://github.com/xiaolai/vmark/blob/main/src-tauri/src/app_setup.rs)(`machine_id_hash` 검색)에 있습니다.

### 데이터 사용 방법

업데이트 확인 로그를 집계하여 [홈페이지](/)에 표시된 라이브 통계를 생성합니다.

| 지표 | 계산 방법 |
|------|---------|
| **고유 기기** | 일/주/월당 고유 기기 해시 수 |
| **고유 IP** | 일/주/월당 고유 IP 주소 수 |
| **핑** | 업데이트 확인 요청의 총 수 |
| **플랫폼** | OS + 아키텍처 조합별 핑 수 |
| **버전** | 앱 버전별 핑 수 |

이 수치들은 [`log.vmark.app/api/stats`](https://log.vmark.app/api/stats)에서 공개적으로 발표됩니다. 숨겨진 것이 없습니다.

**중요한 주의 사항:**
- 고유 IP는 실제 사용자 수를 과소 계산합니다 — 동일한 라우터/VPN 뒤에 있는 여러 사람이 하나로 계산됩니다
- 고유 기기는 더 정확한 수치를 제공하지만 호스트명 변경이나 새 OS 설치는 새 해시를 생성합니다
- 핑은 실제 사용자 수를 과다 계산합니다 — 한 사람이 하루에 여러 번 확인할 수 있습니다

### 데이터 보존

- 로그는 표준 접근 로그 형식으로 서버에 저장됩니다
- 로그 파일은 1 MB에서 순환되고 최근 3개 파일만 유지됩니다
- 로그는 누구와도 공유되지 않습니다
- 계정 시스템이 없습니다 — VMark는 여러분이 누구인지 모릅니다
- 기기 해시는 어떤 계정, 이메일, IP 주소와도 연결되지 않습니다 — 가명 기기 카운터일 뿐입니다
- 추적 쿠키, 지문 수집, 분석 SDK를 사용하지 않습니다

### 업데이트 확인 비활성화

**설정 → 정보 → 확인 주기**를 **수동만**으로 설정하면 VMark는 스스로 업데이트 서버에 접속하지 않습니다. 원할 때는 **지금 확인**이 계속 작동합니다. 네트워크 수준에서 확실히 하려면 `log.vmark.app`을 차단하세요(방화벽, `/etc/hosts` 또는 DNS). VMark는 없어도 정상적으로 계속 작동합니다 — 업데이트 알림만 받지 못합니다.

## API 키 저장 위치

REST AI 제공자의 API 키는 운영 체제의 자격 증명 저장소 — macOS 키체인, Windows 자격 증명 관리자 또는 Linux Secret Service — 에 서비스 이름 `app.vmark.secrets`로 저장됩니다. VMark의 설정 파일이나 `localStorage`에는 절대 기록되지 않으며, 앱이 저장하는 제공자 설정에도 키는 포함되지 않습니다. 키는 지니를 실행하거나 **테스트**를 누를 때 구성한 제공자 엔드포인트로만 전송됩니다. 자세한 내용은 [AI 제공자](/ko/guide/ai-providers#api-키-저장-위치)를 참고하세요.

## AI 어시스턴트가 접근할 수 있는 범위

MCP로 연결된 어시스턴트는 여러분이 이미 연 범위 안에서만 동작합니다. 파일 작업은 열린 워크스페이스 루트와 VMark에 열려 있는 문서의 폴더로 제한되며, 그 경계 밖의 요청은 거부됩니다. 문서를 **새** 경로에 저장하려면 **새 위치로 저장 및 지니 결과 자동 승인** 설정(기본값 꺼짐)이 필요합니다. 그렇지 않으면 호출이 거부되고 VMark가 해당 파일 이름을 표시하는 토스트를 보여 줍니다. 이 설정을 켜더라도 어시스턴트는 이 방법으로 다른 기존 파일을 덮어쓸 수 없습니다. 어시스턴트가 지정한 워크스페이스를 열 때는 먼저 여러분에게 묻습니다. 문서에 대한 모든 AI 쓰기는 먼저 편집 기록에 기록되므로 이전 내용을 복원할 수 있습니다([편집 체크포인트](/ko/guide/mcp-setup#편집-체크포인트)). 내장 브라우저에는 별도의 승인 모델이 있으며, [브라우저 가이드](/ko/guide/browser)에 설명되어 있습니다.

## VMark가 디스크에서 읽을 수 있는 범위

VMark의 파일 접근은 디스크 전체가 아니라 좁게 제한된 권한 범위입니다.

- **정적 범위**: 홈 폴더(`$HOME/**`)와 마운트된 볼륨 — macOS에서는 `/Volumes/**`, Linux에서는 `/mnt/**`와 `/media/**`. Windows에서는 `C:\`부터 `F:\`까지의 드라이브도 포함되므로, 런타임 허가가 필요한 것은 `G:\` 이후의 드라이브와 네트워크 공유뿐입니다. macOS와 Linux에서는 숨김 폴더(이름이 `.`으로 시작하는 폴더) 안에 있는 것은 모두 정적 범위 밖입니다.
- **런타임 허가**: 명시적으로 연 파일 — Finder나 탐색기, `vmark` 명령줄, 파일 대화상자에서 연 파일 — 은 그 파일 하나에 대해서만 허가를 받습니다. **폴더**는 사용자가 직접 선택했다는 것을 VMark가 알 수 있을 때만 허가됩니다. 즉 VMark의 폴더 선택 대화상자에서 골랐거나 Finder에서 연 경우입니다. VMark는 이런 폴더 목록(앱 데이터 폴더의 `workspace-grants.json`)을 보관하고 실행할 때마다 다시 허가하므로, 복원된 세션과 **최근 항목 열기**가 계속 작동합니다. 이 목록에 없고 정적 범위에도 포함되지 않는 최근 워크스페이스를 열면, 해당 폴더를 연 상태로 폴더 선택 대화상자가 나타납니다 — 그 폴더를 선택해 확인하세요. AI 어시스턴트가 그런 폴더를 열려고 할 때도, 요청을 승인한 뒤 같은 과정을 거칩니다.
- **이미지와 미디어**: 로컬 이미지, 동영상, 오디오는 VMark의 에셋 프로토콜로 표시되며, 이 프로토콜이 닿는 곳도 같습니다 — 정적 범위와 위의 런타임 허가입니다. 미디어 뷰어는 보여 주는 파일 하나에 대해서만, 그리고 미디어 확장자를 가진 파일에 한해서만 허가를 추가합니다. 다른 경로에 대한 요청은 범위를 넓히지 않고 거부됩니다. 이 범위 밖의 이미지 — 예를 들어 정적 범위 밖에서 단독으로 연 문서 옆에 있는 이미지 — 는 그 폴더를 워크스페이스로 열 때까지 표시되지 않습니다.

여기서 어떤 것도 외부로 전송되지 않습니다. 범위는 앱 자체가 무엇을 읽을 수 있는지를 결정합니다.

## 오픈 소스 투명성

VMark는 완전한 오픈 소스입니다. 여기서 설명한 모든 것을 확인할 수 있습니다.

- 업데이트 엔드포인트 구성: [`src-tauri/tauri.conf.json`](https://github.com/xiaolai/vmark/blob/main/src-tauri/tauri.conf.json)
- 기기 해시 생성: [`src-tauri/src/app_setup.rs`](https://github.com/xiaolai/vmark/blob/main/src-tauri/src/app_setup.rs) — `machine_id_hash` 검색
- 파일 시스템 및 에셋 범위: [`src-tauri/capabilities/default.json`](https://github.com/xiaolai/vmark/blob/main/src-tauri/capabilities/default.json), [`src-tauri/tauri.conf.json`](https://github.com/xiaolai/vmark/blob/main/src-tauri/tauri.conf.json)의 `assetProtocol` 항목, [`src-tauri/src/fs_scope.rs`](https://github.com/xiaolai/vmark/blob/main/src-tauri/src/fs_scope.rs), [`src-tauri/src/workspace/grants/`](https://github.com/xiaolai/vmark/tree/main/src-tauri/src/workspace/grants)
- 키체인 저장소: [`src-tauri/src/secure_store.rs`](https://github.com/xiaolai/vmark/blob/main/src-tauri/src/secure_store.rs)
- 서버 측 통계 집계: [`scripts/vmark-stats-json`](https://github.com/xiaolai/vmark/blob/main/scripts/vmark-stats-json) — [공개 통계](https://log.vmark.app/api/stats)를 생성하기 위해 서버에서 실행되는 정확한 스크립트
- 네트워크 호출 위치는 위에 나열된 것이 전부입니다 — 저장소에서 `reqwest`(Rust)와 `fetch(`(TypeScript)를 검색해 직접 확인해 보세요

## 보안 문제 신고

VMark에서 취약점(예: MCP 브리지, 내장 브라우저, 업데이터, 파일 처리)을 발견했다면 공개 이슈를 만들지 말고 [GitHub의 비공개 취약점 신고](https://github.com/xiaolai/vmark/security/advisories/new)로 알려 주세요. 신고 대상 범위와 이후 절차는 [보안 정책](https://github.com/xiaolai/vmark/blob/main/SECURITY.md)에 나와 있습니다.
