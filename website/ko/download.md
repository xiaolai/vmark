# VMark 다운로드

<script setup>
import DownloadButton from '../.vitepress/components/DownloadButton.vue'
</script>

<DownloadButton />

## 시스템 요구 사항

- macOS 13.4 (Ventura) 이상
- Apple Silicon (M1/M2/M3) 또는 Intel 프로세서
- 200MB 디스크 공간

::: info 왜 macOS 13.4인가요?
VMark는 macOS에 기본 포함된 WebKit 엔진으로 화면을 그립니다. 따라서 사용할 수 있는 웹 기능은 macOS 버전이 결정합니다. 현재 빌드를 실행할 수 있는 WebKit을 내장한 가장 오래된 릴리스가 macOS 13.4입니다.

이 페이지는 이전에 10.15라고 적혀 있었지만 정확한 값이 아니었습니다. 아무도 확인하지 않은 기본값이 남아 있었고, 오래된 시스템에서 VMark는 실행을 거부하는 대신 빈 창을 띄웠습니다. 13.4 미만에서는 이제 macOS가 직접 VMark 실행을 거부하고 그 이유를 알려줍니다. 빈 창만 남는 일은 더 이상 없습니다.
:::

## 설치

**Homebrew (권장)**

```bash
brew install xiaolai/tap/vmark
```

Mac에 맞는 버전 (Apple Silicon 또는 Intel)을 자동으로 선택하여 VMark를 설치합니다.

**업그레이드**

```bash
brew update && brew upgrade vmark
```

**수동 설치**

1. `.dmg` 파일을 다운로드합니다
2. 다운로드한 파일을 엽니다
3. VMark를 응용 프로그램 폴더로 드래그합니다
4. 첫 실행 시 앱을 마우스 오른쪽 버튼으로 클릭하고 "열기"를 선택하여 Gatekeeper를 우회합니다

## Windows 및 Linux

VMark는 크로스 플랫폼 컴파일을 지원하는 Tauri로 구축되었습니다. 그러나 **현재 활성 개발 및 테스트는 macOS에 집중** 되어 있습니다. 리소스 제약으로 인해 Windows 및 Linux 지원은 당분간 제한적입니다.

Windows 또는 Linux에서 VMark를 실행하려면:

- **사전 빌드된 바이너리** 는 [GitHub Releases](https://github.com/xiaolai/vmark/releases)에서 제공됩니다 (보장된 지원 없이 있는 그대로 제공)
- 아래 지침에 따라 **소스에서 직접 빌드** 합니다

## 다운로드 검증

모든 릴리스는 GitHub Actions를 통해 자동으로 빌드됩니다. [GitHub Releases 페이지](https://github.com/xiaolai/vmark/releases)에서 릴리스를 확인하여 진위 여부를 검증할 수 있습니다.

## 소스에서 빌드

소스에서 VMark를 빌드하려는 개발자를 위해:

```bash
# 저장소 복제
git clone https://github.com/xiaolai/vmark.git
cd vmark

# 의존성 설치
pnpm install

# 프로덕션 빌드
pnpm tauri build
```

자세한 빌드 지침 및 필수 구성 요소는 [README](https://github.com/xiaolai/vmark#readme)를 참조하세요.
