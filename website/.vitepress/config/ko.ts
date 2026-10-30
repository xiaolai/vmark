import { guideSidebar } from "./guideSidebar";

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
      "/ko/guide/": guideSidebar("/ko", {
        sections: { guide: "가이드", usersAsDevelopers: "개발자로서의 사용자" },
        pages: {
          "": "시작하기",
          "formats": "지원 형식",
          "features": "기능",
          "large-files": "대용량 파일",
          "export": "내보내기 및 인쇄",
          "shortcuts": "키보드 단축키",
          "tab-navigation": "스마트 탭 내비게이션",
          "multi-cursor": "멀티 커서 편집",
          "popups": "인라인 팝업",
          "mermaid": "Mermaid 다이어그램",
          "graphviz": "Graphviz 다이어그램",
          "markmap": "Markmap 마인드맵",
          "workflow-viewer": "GitHub Actions 워크플로 뷰어",
          "svg": "SVG 그래픽",
          "media-support": "미디어 (비디오/오디오)",
          "cloud-images": "클라우드 호스팅 이미지",
          "terminal": "통합 터미널",
          "browser": "내장 브라우저",
          "knowledge-base": "지식 베이스 및 Slidev",
          "workspace-management": "워크스페이스 관리",
          "workspace-rail": "워크스페이스 레일",
          "cjk-formatting": "CJK 서식",
          "ai-genies": "AI 지니",
          "coherence": "정합성 내역",
          "workflows": "지니 워크플로",
          "workflow-genies": "워크플로 지니",
          "ai-providers": "AI 제공업체",
          "mcp-setup": "MCP 설정",
          "mcp-tools": "MCP 도구 참조",
          "edit-history-git": "Git으로 편집 기록 내보내기",
          "lint": "Markdown 린트",
          "link-check": "링크 검사",
          "settings": "설정",
          "troubleshooting": "문제 해결",
          "privacy": "개인정보 보호",
          "license": "라이선스",
          "users-as-developers/": "개요",
          "users-as-developers/why-i-built-vmark": "VMark를 만든 이유",
          "users-as-developers/what-are-indispensable": "AI가 대체할 수 없는 5가지 기술",
          "users-as-developers/why-expensive-models-are-cheaper": "비싼 모델이 더 저렴한 이유",
          "users-as-developers/subscription-vs-api": "구독 vs API 요금",
          "users-as-developers/prompt-refinement": "영어 프롬프트가 더 효과적인 이유",
          "users-as-developers/cross-model-verification": "교차 모델 검증",
          "users-as-developers/why-issues-not-prs": "PR이 아닌 Issue를 올리는 이유",
          "users-as-developers/cost-evaluation": "비용 및 공수 평가",
          "users-as-developers/plugins-as-infrastructure": "인프라로서의 플러그인",
        },
      }),
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
