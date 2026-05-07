

export const ko = {
  label: "한국어",
  lang: "ko",
  themeConfig: {
    nav: [
      { text: "홈", link: "/ko/" },
      { text: "다운로드", link: "/ko/download" },
      { text: "가이드", link: "/ko/guide/" },
      { text: "블로그", link: "/blog/" },
    ],

    sidebar: {
      "/ko/guide/": [
        {
          text: "가이드",
          items: [
            { text: "시작하기", link: "/ko/guide/" },
            { text: "기능", link: "/ko/guide/features" },
            { text: "대용량 파일", link: "/ko/guide/large-files" },
            { text: "내보내기 및 인쇄", link: "/ko/guide/export" },
            {
              text: "키보드 단축키",
              link: "/ko/guide/shortcuts",
            },
            {
              text: "스마트 탭 내비게이션",
              link: "/ko/guide/tab-navigation",
            },
            {
              text: "멀티 커서 편집",
              link: "/ko/guide/multi-cursor",
            },
            {
              text: "인라인 팝업",
              link: "/ko/guide/popups",
            },
            {
              text: "Mermaid 다이어그램",
              link: "/ko/guide/mermaid",
            },
            {
              text: "Markmap 마인드맵",
              link: "/ko/guide/markmap",
            },
            {
              text: "GitHub Actions 워크플로 뷰어",
              link: "/ko/guide/workflow-viewer",
            },
            { text: "SVG 그래픽", link: "/ko/guide/svg" },
            {
              text: "미디어 (비디오/오디오)",
              link: "/ko/guide/media-support",
            },
            {
              text: "통합 터미널",
              link: "/ko/guide/terminal",
            },
            {
              text: "워크스페이스 관리",
              link: "/ko/guide/workspace-management",
            },
            {
              text: "CJK 서식",
              link: "/ko/guide/cjk-formatting",
            },
            { text: "AI 지니", link: "/ko/guide/ai-genies" },
            {
              text: "워크플로 지니",
              link: "/ko/guide/workflow-genies",
            },
            {
              text: "AI 제공업체",
              link: "/ko/guide/ai-providers",
            },
            { text: "MCP 설정", link: "/ko/guide/mcp-setup" },
            {
              text: "MCP 도구 참조",
              link: "/ko/guide/mcp-tools",
            },
            { text: "Markdown 린트", link: "/ko/guide/lint" },
            { text: "링크 검사", link: "/ko/guide/link-check" },
            { text: "설정", link: "/ko/guide/settings" },
            { text: "문제 해결", link: "/ko/guide/troubleshooting" },
            { text: "개인정보 보호", link: "/ko/guide/privacy" },
            { text: "라이선스", link: "/ko/guide/license" },
          ],
        },
        {
          text: "개발자로서의 사용자",
          items: [
            {
              text: "개요",
              link: "/ko/guide/users-as-developers/",
            },
            {
              text: "VMark를 만든 이유",
              link: "/ko/guide/users-as-developers/why-i-built-vmark",
            },
            {
              text: "AI가 대체할 수 없는 5가지 기술",
              link: "/ko/guide/users-as-developers/what-are-indispensable",
            },
            {
              text: "비싼 모델이 더 저렴한 이유",
              link: "/ko/guide/users-as-developers/why-expensive-models-are-cheaper",
            },
            {
              text: "구독 vs API 요금",
              link: "/ko/guide/users-as-developers/subscription-vs-api",
            },
            {
              text: "영어 프롬프트가 더 효과적인 이유",
              link: "/ko/guide/users-as-developers/prompt-refinement",
            },
            {
              text: "교차 모델 검증",
              link: "/ko/guide/users-as-developers/cross-model-verification",
            },
            {
              text: "PR이 아닌 Issue를 올리는 이유",
              link: "/ko/guide/users-as-developers/why-issues-not-prs",
            },
            {
              text: "비용 및 공수 평가",
              link: "/ko/guide/users-as-developers/cost-evaluation",
            },
            {
              text: "인프라로서의 플러그인",
              link: "/ko/guide/users-as-developers/plugins-as-infrastructure",
            },
          ],
        },
      ],
    },

    footer: {
      copyright:
        'Copyright © 2026 VMark · <a href="/ko/guide/license">ISC 라이선스</a>',
    },

    lastUpdated: {
      text: "마지막 업데이트",
      formatOptions: {
        dateStyle: "medium" as const,
        timeStyle: "short" as const,
      },
    },

    outline: {
      label: "이 페이지 목차",
    },

    docFooter: {
      prev: "이전 페이지",
      next: "다음 페이지",
    },

    sidebarMenuLabel: "메뉴",
    returnToTopLabel: "맨 위로",

    search: {
      provider: "local" as const,
      options: {
        locales: {
          ko: {
            translations: {
              button: {
                buttonText: "검색",
                buttonAriaLabel: "문서 검색",
              },
              modal: {
                noResultsText: "결과를 찾을 수 없습니다",
                resetButtonTitle: "검색 초기화",
                displayDetails: "상세 보기",
                footer: {
                  selectText: "선택",
                  navigateText: "이동",
                  closeText: "닫기",
                },
              },
            },
          },
        },
      },
    },
  },
};
