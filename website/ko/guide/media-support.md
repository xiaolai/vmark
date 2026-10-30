# 미디어 지원

VMark는 표준 HTML5 태그를 사용하여 마크다운 문서에서 동영상, 오디오, YouTube 임베드를 지원합니다.

## 지원되는 형식

### 동영상

| 형식 | 확장자 |
|------|--------|
| MP4 | `.mp4` |
| WebM | `.webm` |
| MOV | `.mov` |
| AVI | `.avi` |
| MKV | `.mkv` |
| M4V | `.m4v` |
| OGV | `.ogv` |

### 오디오

| 형식 | 확장자 |
|------|--------|
| MP3 | `.mp3` |
| M4A | `.m4a` |
| OGG | `.ogg` |
| WAV | `.wav` |
| FLAC | `.flac` |
| AAC | `.aac` |
| Opus | `.opus` |

## 구문

### 동영상

표준 HTML5 동영상 태그를 사용합니다:

```html
<video src="path/to/video.mp4" controls></video>
```

선택적 속성 포함:

```html
<video src="video.mp4" title="Demo" poster="thumbnail.jpg" controls></video>
```

### 오디오

표준 HTML5 오디오 태그를 사용합니다:

```html
<audio src="path/to/audio.mp3" controls></audio>
```

### YouTube 임베드

프라이버시 강화 YouTube iframe을 사용합니다:

```html
<iframe src="https://www.youtube-nocookie.com/embed/VIDEO_ID" width="560" height="315" frameborder="0" allowfullscreen></iframe>
```

### Vimeo 임베드

Vimeo 플레이어 iframe을 사용합니다:

```html
<iframe src="https://player.vimeo.com/video/VIDEO_ID" width="560" height="315" frameborder="0" allowfullscreen></iframe>
```

Vimeo URL을 직접 붙여넣기(예: `https://vimeo.com/123456789`)하면 VMark가 자동으로 임베드로 변환합니다.

비공개(unlisted) Vimeo 동영상도 지원됩니다. 비공개 공유 링크(`https://vimeo.com/123456789/abcdef1234` 또는 `?h=…`가 붙은 URL)를 붙여넣으면 VMark가 임베드 재생에 필요한 비공개 해시를 보존합니다.

### Bilibili 임베드

BV ID로 Bilibili 플레이어 iframe을 사용합니다:

```html
<iframe src="https://player.bilibili.com/player.html?bvid=BV1xxxxxxxxx" width="560" height="350" frameborder="0" allowfullscreen></iframe>
```

Bilibili 동영상 URL(예: `https://bilibili.com/video/BV1xxxxxxxxx`)을 붙여넣으면 VMark가 자동으로 임베드로 변환합니다. 단축 URL(`b23.tv`)은 리디렉션 해결이 필요하므로 지원되지 않습니다.

### 이미지 구문 대체

미디어 파일 확장자와 함께 이미지 구문을 사용할 수도 있습니다 — VMark가 자동으로 올바른 미디어 타입으로 변환합니다:

```markdown
![](video.mp4)
![](audio.mp3)
```

## 미디어 삽입

### 툴바

툴바의 삽입 메뉴를 사용합니다:

- **동영상** — 동영상 파일 선택기를 열고, `.assets/`에 복사하고, `<video>` 태그를 삽입합니다
- **오디오** — 오디오 파일 선택기를 열고, `.assets/`에 복사하고, `<audio>` 태그를 삽입합니다
- **YouTube** — 클립보드에서 YouTube URL을 읽고 프라이버시 강화 임베드를 삽입합니다
- **Vimeo** 및 **Bilibili** — 에디터에 동영상 URL을 직접 붙여넣으면 VMark가 자동으로 제공자를 감지합니다

### 드래그 앤 드롭

파일 시스템에서 동영상 또는 오디오 파일을 에디터로 직접 드래그합니다. VMark는:

1. 파일을 문서의 `.assets/` 폴더에 복사합니다
2. 상대 경로와 함께 적절한 미디어 노드를 삽입합니다

### 소스 모드

소스 모드에서 HTML 태그를 직접 입력합니다. 미디어 태그는 색상 왼쪽 테두리로 강조 표시됩니다:

- **동영상** — 청록색 테두리
- **오디오** — 인디고 테두리
- **YouTube** — 빨간색 테두리
- **Vimeo** — 파란색 테두리
- **Bilibili** — 분홍색 테두리

### 소스 모드의 스마트 붙여넣기

소스 모드에 붙여넣으면 원시 텍스트를 그대로 쏟아 넣는 대신 마크다운에 맞는 처리를 합니다.

- **이미지 경로** — 또는 Finder나 탐색기에서 여러 파일을 복사한 경우 여러 경로 — 는 검증된 뒤 문서의 에셋 폴더로 복사되고 `![](relative-path)`로 삽입됩니다. 붙여넣기가 모호하면 작은 확인 토스트가 먼저 묻습니다
- **스크린샷이나 복사한 이미지**(클립보드의 바이너리 이미지 데이터)는 에셋 폴더에 저장되고 같은 방식으로 삽입됩니다
- **선택한 텍스트 위에 붙여넣은 URL**은 링크가 됩니다: `[selected text](https://…)`
- **다른 앱에서 복사한 HTML 또는 Markdown**은 들어오기 전에 변환되고 정리됩니다 — 단, 펜스 코드 블록 안에서는 붙여넣은 텍스트가 그대로 유지됩니다
- **Finder나 탐색기에서 소스 에디터로 끌어온 이미지 파일**도 복사되어 삽입됩니다

변환은 **설정 → Markdown → 클립보드 붙여넣기 처리**를 따르며(`스마트`가 기본값이고, 다른 모드는 이를 사용하지 않음), 파일은 **설정 → 파일 및 이미지 → 에셋 폴더에 복사**가 켜져 있는 동안(기본값) 에셋 폴더로 복사됩니다.

## 미디어 편집

WYSIWYG 모드에서 미디어 요소를 더블클릭하면 미디어 팝업이 열립니다:

- **소스 경로** — 파일 경로 또는 URL 편집
- **제목** — 선택적 제목 속성
- **포스터** (동영상만) — 썸네일 이미지 경로
- **제거** — 미디어 요소 삭제

`Escape`를 눌러 팝업을 닫고 에디터로 돌아갑니다.

## 경로 해결

VMark는 세 가지 유형의 미디어 경로를 지원합니다:

| 경로 타입 | 예시 | 동작 |
|----------|------|------|
| 상대 경로 | `./assets/video.mp4` | 문서 디렉터리를 기준으로 해결 |
| 상위 기준 상대 경로 | `../images/photo.png` | 문서 디렉터리를 기준으로, 경로가 요구하는 만큼 상위 단계로 올라가며 해결 |
| 절대 경로 | `/Users/me/video.mp4` | Tauri 에셋 프로토콜을 통해 직접 사용 |
| 외부 URL | `https://example.com/video.mp4` | 웹에서 직접 로드 |

상대 경로가 권장됩니다 — 여러 기기에서 문서를 이식 가능하게 유지합니다.

노트 옆의 공유 에셋 폴더도 쓴 그대로 작동합니다 — `notes/report.md`는 `../images/photo.png`를 참조할 수 있습니다. (0.9.79 이전에는 깨진 자리 표시자로 렌더링되었습니다.)

## 보안

- 미디어 경로에는 URI 스킴(`javascript:`, `file:` 또는 사용자 정의 스킴)을 넣을 수 없습니다. 그런 소스는 로드되지 않고 거부됩니다
- 디렉터리를 가리키는 상대 경로(`.`, `..`, `assets/`)는 로드되지 않습니다. 동영상/오디오 블록은 이를 바로 거부합니다. 인라인 이미지는 경로를 그대로 돌려주고 웹뷰가 이를 앱 오리진 기준으로 해석하므로, 디스크에 닿지 않습니다. 홈 기준 경로(`~/…`)도 같은 방식으로 처리됩니다
- 절대 경로는 경로 규칙으로 제한되지 않습니다. 에셋 범위 안의 절대 경로는 모두 표시됩니다: 홈 폴더, `/Volumes`, `/mnt`, `/media`(Windows에서는 `C:`–`F:` 드라이브도), 그리고 실행 중에 허용된 폴더입니다. 따라서 문서는 전체 경로를 쓰기만 하면 이 위치에 있는 읽을 수 있는 이미지를 무엇이든 보여 줄 수 있습니다. **에셋 폴더에 복사** 를 끈 채 이미지를 붙여 넣으면 이런 절대 경로가 기록됩니다. 상대 경로에 `..`를 쓸 수 있는 것도 이 때문입니다: 절대 경로로 이미 닿을 수 없는 곳에는 닿지 않습니다
- 동영상 임베드는 세 호스트에서만 로드됩니다: `www.youtube-nocookie.com`(YouTube의 개인정보 보호 강화 플레이어), `player.vimeo.com`, `player.bilibili.com`. YouTube 링크나 `youtube.com`으로 작성된 iframe은 개인정보 보호 강화 호스트를 통해 임베드됩니다. VMark의 콘텐츠 보안 정책은 이 호스트들의 프레임만 허용하며 다른 사이트의 프레임은 로드하지 않습니다
- 다른 iframe 소스는 새니타이저에 의해 제거됩니다
