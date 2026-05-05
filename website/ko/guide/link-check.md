# 링크 검사

VMark는 마크다운의 로컬 링크와 이미지 대상이 디스크에 실제로 존재하는지 확인합니다. [마크다운 린트 엔진](/ko/guide/lint)과 함께 `Cmd-Shift-L` 또는 **도구 → Markdown 검사** 에서 실행됩니다.

## 검사 대상

문서의 모든 로컬 링크와 이미지에 대해:

- `[text](./other.md)` — 파일 `./other.md`가 해석되고 존재함
- `![alt](./image.png)` — 이미지 파일이 존재함
- `[text](./other.md#section)` — 파일이 존재함 (앵커 검사는 [`linkFragments` 규칙](/ko/guide/lint#%EA%B7%9C%EC%B9%99-%EC%B0%B8%EC%A1%B0)에서 처리)

대상이 누락되면 링크 텍스트에 빨간 물결선 밑줄이 그어지고, 린트 배지 / F2 탐색에 항목이 나타납니다.

## 건너뛰는 대상

- **프래그먼트 전용 링크** (`#anchor`) — 현재 문서의 제목에 대해 검사하는 `linkFragments` 규칙이 처리
- **외부 URL** — `http://`, `https://`, `ftp://`, `mailto:`, `tel:`, `data:`, `file:`
- **제목 없는 문서** — 저장된 파일 경로가 없으면 상대 URL을 어떤 디렉터리 기준으로도 해석할 수 없음

## 해석 작동 방식

링크 검사는 소스 파일의 디렉터리를 기준으로 경로를 해석합니다:

| `/repo/docs/intro.md`의 링크 | 해석 결과 |
|---|---|
| `[a](./other.md)` | `/repo/docs/other.md` |
| `[a](../shared.md)` | `/repo/shared.md` |
| `[a](images/logo.png)` | `/repo/docs/images/logo.png` |
| `[a](/docs/intro.md)` | `/repo/docs/docs/intro.md` (파일 디렉터리 기준 상대 경로로 처리) |

파일 조회 전에 프래그먼트는 제거됩니다 — `[a](./other.md#section)`은 `./other.md`만 검사합니다.

## 성능

- **비동기** — 동기 규칙과 병렬로 실행되며, 결과는 준비되는 대로 병합됨
- **중복 제거** — 여러 번 링크되어도 각 고유한 해석된 경로는 실행당 한 번만 검사됨
- **키 입력 트리거 없음** — 모든 키 입력에서 fs.exists를 호출하면 부담이 크므로, 명시적 린트 트리거에서만 실행됨
- **운영 오류 허용** — `fs.exists`가 예외를 던지면 (권한 거부, 기능 범위 문제 등) 결과는 `error` (건너뜀)이지 `missing`이 아님. 잘못된 것보다 조용한 편이 낫음.

## 진단 코드

| 코드 | 심각도 | 트리거 |
|------|--------|--------|
| **M001** | Error | 해석된 로컬 경로에서 이미지 파일을 찾을 수 없음 |
| **M002** | Error | 해석된 로컬 경로에서 링크된 파일을 찾을 수 없음 |

## 참고 항목

- [Markdown 린트](/ko/guide/lint) — 전체 규칙 참조
- [설정 → 마크다운 → 린트](/ko/guide/settings#lint)
