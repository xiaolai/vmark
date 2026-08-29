/**
 * VMark Reader - Interactive controls for exported HTML
 *
 * Features:
 * - Font size adjustment
 * - Line height adjustment
 * - Content width adjustment
 * - Light/Dark theme toggle
 * - CJK letter spacing toggle
 * - Expand all details toggle
 * - Settings persistence via localStorage
 */

(function() {
  'use strict';

  // Font stacks (matching VMark editor fonts)
  const FONT_STACKS = {
    latin: {
      system: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
      athelas: "Athelas, Georgia, serif",
      palatino: "Palatino, 'Palatino Linotype', serif",
      georgia: "Georgia, 'Times New Roman', serif",
      charter: "Charter, Georgia, serif",
      literata: "Literata, Georgia, serif"
    },
    cjk: {
      system: '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
      pingfang: '"PingFang SC", "PingFang TC", sans-serif',
      songti: '"Songti SC", "STSong", "SimSun", serif',
      kaiti: '"Kaiti SC", "STKaiti", "KaiTi", serif',
      notoserif: '"Noto Serif CJK SC", "Source Han Serif SC", serif',
      sourcehans: '"Source Han Sans SC", "Noto Sans CJK SC", sans-serif'
    }
  };

  // Font options for UI
  const FONT_OPTIONS = {
    latin: [
      { value: 'system', label: 'System' },
      { value: 'athelas', label: 'Athelas' },
      { value: 'palatino', label: 'Palatino' },
      { value: 'georgia', label: 'Georgia' },
      { value: 'charter', label: 'Charter' },
      { value: 'literata', label: 'Literata' }
    ],
    cjk: [
      { value: 'system', label: 'System' },
      { value: 'pingfang', label: 'PingFang' },
      { value: 'songti', label: 'Songti' },
      { value: 'kaiti', label: 'Kaiti' },
      { value: 'notoserif', label: 'Noto Serif' },
      { value: 'sourcehans', label: 'Source Han' }
    ]
  };

  // Theme definitions (matching VMark editor themes)
  const THEMES = {
    white: {
      background: '#FFFFFF',
      foreground: '#1a1a1a',
      secondary: '#f8f8f8',
      border: '#eeeeee',
      link: '#0066cc',
      isDark: false
    },
    paper: {
      background: '#EEEDED',
      foreground: '#1a1a1a',
      secondary: '#e5e4e4',
      border: '#d5d4d4',
      link: '#0066cc',
      isDark: false
    },
    mint: {
      background: '#CCE6D0',
      foreground: '#2d3a35',
      secondary: '#b8d9bd',
      border: '#a8c9ad',
      link: '#1a6b4a',
      isDark: false
    },
    sepia: {
      background: '#F9F0DB',
      foreground: '#5c4b37',
      secondary: '#f0e5cc',
      border: '#e0d5bc',
      link: '#8b4513',
      isDark: false
    },
    night: {
      background: '#23262b',
      foreground: '#d6d9de',
      secondary: '#2a2e34',
      border: '#3a3f46',
      link: '#5aa8ff',
      isDark: true
    }
  };

  // Default settings
  const DEFAULTS = {
    fontSize: 18,
    lineHeight: 1.6,
    contentWidth: 50,
    latinFont: 'system',
    cjkFont: 'system',
    cjkLetterSpacing: 0.05,
    theme: 'paper',
    cjkLatinSpacing: true,
    expandDetails: false,
    showToc: false
  };

  // Settings bounds
  const BOUNDS = {
    fontSize: { min: 12, max: 28, step: 1 },
    lineHeight: { min: 1.2, max: 2.4, step: 0.1 },
    contentWidth: { min: 30, max: 80, step: 5 },
    cjkLetterSpacing: { min: 0.02, max: 0.12, step: 0.01 }
  };

  // Storage key
  const STORAGE_KEY = 'vmark-reader-settings';

  // State
  let settings = { ...DEFAULTS };
  let panel = null;
  let isOpen = false;

  /**
   * Load settings from localStorage
   */
  function loadSettings() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        settings = { ...DEFAULTS, ...parsed };
      }
    } catch (e) {
      console.warn('[VMark Reader] Failed to load settings:', e);
    }
  }

  /**
   * Save settings to localStorage
   */
  function saveSettings() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch (e) {
      console.warn('[VMark Reader] Failed to save settings:', e);
    }
  }

  /**
   * Apply current settings to the document
   */
  function applySettings() {
    const root = document.documentElement;
    const surface = document.querySelector('.export-surface');
    const editor = document.querySelector('.export-surface-editor');

    // Font size
    root.style.setProperty('--editor-font-size', `${settings.fontSize}px`);
    root.style.setProperty('--editor-font-size-mono', `${settings.fontSize * 0.85}px`);

    // Line height
    root.style.setProperty('--editor-line-height', settings.lineHeight);
    root.style.setProperty('--editor-line-height-px', `${settings.fontSize * settings.lineHeight}px`);

    // Fonts
    const latinStack = FONT_STACKS.latin[settings.latinFont] || FONT_STACKS.latin.system;
    const cjkStack = FONT_STACKS.cjk[settings.cjkFont] || FONT_STACKS.cjk.system;
    root.style.setProperty('--font-sans', `${latinStack}, ${cjkStack}`);

    // Content width
    if (surface) {
      surface.style.maxWidth = `${settings.contentWidth}em`;
    }

    // CJK letter spacing (applied dynamically to text)
    applyCjkLetterSpacing();

    // Theme
    applyTheme(settings.theme);

    // CJK spacing (handles both apply and remove based on setting)
    applyCjkSpacing();

    // Expand details
    applyExpandDetails();

    // Table of Contents
    applyToc();

    // Code block buttons (copy, line numbers toggle)
    applyCodeBlockButtons();

    // Update UI if panel exists
    updatePanelUI();
  }

  /**
   * Apply theme colors to the document
   */
  function applyTheme(themeId) {
    const theme = THEMES[themeId] || THEMES.paper;
    const root = document.documentElement;

    // Apply theme colors as CSS variables
    root.style.setProperty('--bg-color', theme.background);
    root.style.setProperty('--text-color', theme.foreground);
    root.style.setProperty('--bg-secondary', theme.secondary);
    root.style.setProperty('--border-color', theme.border);
    root.style.setProperty('--primary-color', theme.link);

    // Code block colors
    root.style.setProperty('--code-bg-color', theme.secondary);
    root.style.setProperty('--code-text-color', theme.foreground);
    root.style.setProperty('--code-border-color', theme.border);

    // Text secondary (slightly muted)
    if (theme.isDark) {
      root.style.setProperty('--text-secondary', '#858585');
      root.style.setProperty('--text-tertiary', '#6b7078');
      root.style.setProperty('--hover-bg', 'rgba(255, 255, 255, 0.06)');
      document.documentElement.classList.add('dark-theme');
    } else {
      root.style.setProperty('--text-secondary', '#666666');
      root.style.setProperty('--text-tertiary', '#999999');
      root.style.setProperty('--hover-bg', 'rgba(0, 0, 0, 0.04)');
      document.documentElement.classList.remove('dark-theme');
    }

    // Update body background
    document.body.style.backgroundColor = theme.background;
  }

  // Store original text for CJK spacing toggle
  const originalTexts = new WeakMap();
  const THIN_SPACE = '\u2009';

  /**
   * Apply or remove CJK-Latin spacing
   */
  function applyCjkSpacing() {
    const editor = document.querySelector('.export-surface-editor');
    if (!editor) return;

    const isApplied = editor.dataset.cjkApplied === 'true';

    if (settings.cjkLatinSpacing && !isApplied) {
      // Apply spacing
      addCjkSpacing(editor);
      editor.dataset.cjkApplied = 'true';
    } else if (!settings.cjkLatinSpacing && isApplied) {
      // Remove spacing
      removeCjkSpacing(editor);
      editor.dataset.cjkApplied = 'false';
    }
  }

  function addCjkSpacing(editor) {
    const CJK_RANGE = /[\u4e00-\u9fff\u3400-\u4dbf\u3000-\u303f\uff00-\uffef\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/;
    const LATIN_RANGE = /[a-zA-Z0-9]/;

    const walker = document.createTreeWalker(
      editor,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: function(node) {
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          const tag = parent.tagName.toLowerCase();
          if (['script', 'style', 'code', 'pre', 'kbd', 'samp'].includes(tag)) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    const textNodes = [];
    let node;
    while (node = walker.nextNode()) {
      textNodes.push(node);
    }

    textNodes.forEach(textNode => {
      const text = textNode.textContent;
      if (!text || text.length < 2) return;

      // Store original
      if (!originalTexts.has(textNode)) {
        originalTexts.set(textNode, text);
      }

      let result = '';
      for (let i = 0; i < text.length; i++) {
        result += text[i];
        if (i < text.length - 1) {
          const curr = text[i];
          const next = text[i + 1];
          const currIsCjk = CJK_RANGE.test(curr);
          const nextIsCjk = CJK_RANGE.test(next);
          const currIsLatin = LATIN_RANGE.test(curr);
          const nextIsLatin = LATIN_RANGE.test(next);

          if ((currIsCjk && nextIsLatin) || (currIsLatin && nextIsCjk)) {
            if (curr !== ' ' && curr !== THIN_SPACE && next !== ' ' && next !== THIN_SPACE) {
              result += THIN_SPACE;
            }
          }
        }
      }

      if (result !== text) {
        textNode.textContent = result;
      }
    });
  }

  function removeCjkSpacing(editor) {
    const walker = document.createTreeWalker(
      editor,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: function(node) {
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          const tag = parent.tagName.toLowerCase();
          if (['script', 'style', 'code', 'pre', 'kbd', 'samp'].includes(tag)) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    const textNodes = [];
    let node;
    while (node = walker.nextNode()) {
      textNodes.push(node);
    }

    textNodes.forEach(textNode => {
      // Restore original or remove thin spaces
      const original = originalTexts.get(textNode);
      if (original) {
        textNode.textContent = original;
      } else {
        // Fallback: remove all thin spaces
        textNode.textContent = textNode.textContent.replace(/\u2009/g, '');
      }
    });
  }

  /**
   * Apply CJK letter spacing by wrapping CJK text in spans
   */
  function applyCjkLetterSpacing() {
    const editor = document.querySelector('.export-surface-editor');
    if (!editor) return;

    const spacing = settings.cjkLetterSpacing;
    const spacingValue = spacing === 0 ? '0' : `${spacing}em`;

    // Update existing cjk-spacing spans
    editor.querySelectorAll('.cjk-letter-spacing').forEach(span => {
      span.style.letterSpacing = spacingValue;
    });

    // If already processed, just update values
    if (editor.dataset.cjkLetterSpacingApplied === 'true') {
      return;
    }

    // CJK Unicode ranges
    const CJK_REGEX = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af\u3100-\u312f]+/g;

    const walker = document.createTreeWalker(
      editor,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: function(node) {
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          const tag = parent.tagName.toLowerCase();
          // Skip code, pre, and already-processed spans
          if (['script', 'style', 'code', 'pre', 'kbd', 'samp'].includes(tag)) {
            return NodeFilter.FILTER_REJECT;
          }
          if (parent.classList.contains('cjk-letter-spacing')) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    const textNodes = [];
    let node;
    while (node = walker.nextNode()) {
      textNodes.push(node);
    }

    textNodes.forEach(textNode => {
      const text = textNode.textContent;
      if (!text) return;

      CJK_REGEX.lastIndex = 0;
      const matches = [];
      let match;
      while ((match = CJK_REGEX.exec(text)) !== null) {
        matches.push({ start: match.index, end: match.index + match[0].length, text: match[0] });
      }

      if (matches.length === 0) return;

      // Create document fragment with wrapped CJK runs
      const fragment = document.createDocumentFragment();
      let lastIndex = 0;

      matches.forEach(m => {
        // Add text before match
        if (m.start > lastIndex) {
          fragment.appendChild(document.createTextNode(text.slice(lastIndex, m.start)));
        }
        // Add wrapped CJK text
        const span = document.createElement('span');
        span.className = 'cjk-letter-spacing';
        span.style.letterSpacing = spacingValue;
        span.textContent = m.text;
        fragment.appendChild(span);
        lastIndex = m.end;
      });

      // Add remaining text
      if (lastIndex < text.length) {
        fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
      }

      // Replace text node with fragment
      textNode.parentNode.replaceChild(fragment, textNode);
    });

    editor.dataset.cjkLetterSpacingApplied = 'true';
  }

  /**
   * Apply expand/collapse all details
   */
  function applyExpandDetails() {
    const details = document.querySelectorAll('details');
    details.forEach(el => {
      if (settings.expandDetails) {
        el.setAttribute('open', '');
      } else {
        el.removeAttribute('open');
      }
    });
  }

  /**
   * Apply code block buttons (copy, line numbers toggle)
   */
  function applyCodeBlockButtons() {
    const editor = document.querySelector('.export-surface-editor');
    if (!editor) return;

    // Only add buttons once
    if (editor.dataset.codeButtonsApplied === 'true') return;

    // Exclude preview-only blocks (mermaid, math) which show rendered output
    const codeBlocks = editor.querySelectorAll('.code-block-wrapper:not(.code-block-preview-only)');
    codeBlocks.forEach(wrapper => {
      // Create button container
      const btnContainer = document.createElement('div');
      btnContainer.className = 'vmark-code-btn-group';

      // Line numbers toggle button (only if block has line numbers)
      const lineNumbers = wrapper.querySelector('.code-line-numbers');
      if (lineNumbers) {
        // Hide line numbers by default
        lineNumbers.style.display = 'none';

        const lineNumBtn = document.createElement('button');
        lineNumBtn.className = 'vmark-code-btn';
        lineNumBtn.title = 'Show line numbers';
        lineNumBtn.setAttribute('aria-label', 'Show line numbers');
        lineNumBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="4" y1="6" x2="4" y2="6.01"></line>
          <line x1="4" y1="12" x2="4" y2="12.01"></line>
          <line x1="4" y1="18" x2="4" y2="18.01"></line>
          <line x1="9" y1="6" x2="20" y2="6"></line>
          <line x1="9" y1="12" x2="20" y2="12"></line>
          <line x1="9" y1="18" x2="20" y2="18"></line>
        </svg>`;

        lineNumBtn.addEventListener('click', () => {
          const isHidden = lineNumbers.style.display === 'none';
          lineNumbers.style.display = isHidden ? 'flex' : 'none';
          const label = isHidden ? 'Hide line numbers' : 'Show line numbers';
          lineNumBtn.title = label;
          lineNumBtn.setAttribute('aria-label', label);
        });

        btnContainer.appendChild(lineNumBtn);
      }

      // Copy button
      const copyBtn = document.createElement('button');
      copyBtn.className = 'vmark-code-btn';
      copyBtn.title = 'Copy code';
      copyBtn.setAttribute('aria-label', 'Copy code');
      copyBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
      </svg>`;

      copyBtn.addEventListener('click', () => {
        const pre = wrapper.querySelector('pre');
        if (!pre) return;

        const code = pre.textContent || '';
        navigator.clipboard.writeText(code).then(() => {
          // Show success feedback
          copyBtn.classList.add('copied');
          copyBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>`;

          setTimeout(() => {
            copyBtn.classList.remove('copied');
            copyBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>`;
          }, 2000);
        }).catch(err => {
          console.warn('[VMark Reader] Copy failed:', err);
        });
      });

      btnContainer.appendChild(copyBtn);
      wrapper.appendChild(btnContainer);
    });

    editor.dataset.codeButtonsApplied = 'true';
  }

  // TOC state
  let tocSidebar = null;
  let tocBackdrop = null;
  let tocToggleTab = null;
  let tocHeadings = [];
  let scrollSpyActive = false;

  /**
   * Toggle TOC visibility
   */
  function toggleToc() {
    settings.showToc = !settings.showToc;
    saveSettings();
    applyToc();
    updatePanelUI();
  }

  /**
   * Create TOC toggle tab (always visible on left edge)
   */
  function createTocToggleTab() {
    if (tocToggleTab) return;

    tocToggleTab = document.createElement('button');
    tocToggleTab.className = 'vmark-toc-toggle-tab';
    tocToggleTab.setAttribute('aria-label', 'Toggle Table of Contents');
    tocToggleTab.title = 'Table of Contents (T)';

    // Create chevron SVG using DOM methods (avoid innerHTML for security hygiene)
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('fill', 'currentColor');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z');
    svg.appendChild(path);
    tocToggleTab.appendChild(svg);

    tocToggleTab.addEventListener('click', toggleToc);
    document.body.appendChild(tocToggleTab);
  }

  /**
   * Update TOC toggle tab appearance
   */
  function updateTocToggleTab() {
    if (!tocToggleTab) return;
    tocToggleTab.classList.toggle('expanded', settings.showToc);
  }

  /**
   * Generate and apply Table of Contents sidebar
   */
  function applyToc() {
    const editor = document.querySelector('.export-surface-editor');
    const surface = document.querySelector('.export-surface');
    if (!editor || !surface) return;

    // Create toggle tab if headings exist (check once)
    if (!tocToggleTab) {
      const headings = editor.querySelectorAll('h1, h2, h3');
      if (headings.length > 0) {
        createTocToggleTab();
      }
    }

    if (!settings.showToc) {
      // Hide TOC sidebar
      if (tocSidebar) {
        tocSidebar.classList.remove('visible');
        document.body.classList.remove('vmark-toc-open');
      }
      if (tocBackdrop) {
        tocBackdrop.classList.remove('visible');
      }
      updateTocToggleTab();
      disableScrollSpy();
      return;
    }

    // Show existing sidebar or create new one
    if (tocSidebar) {
      tocSidebar.classList.add('visible');
      document.body.classList.add('vmark-toc-open');
      if (tocBackdrop && window.innerWidth < 768) {
        tocBackdrop.classList.add('visible');
      }
      updateTocToggleTab();
      enableScrollSpy();
      return;
    }

    // Extract headings (h1-h3)
    const headings = editor.querySelectorAll('h1, h2, h3');
    if (headings.length === 0) return;

    // Build TOC items and ensure IDs
    tocHeadings = [];
    let idCounter = 0;

    headings.forEach(heading => {
      if (!heading.id) {
        heading.id = `heading-${++idCounter}`;
      }

      tocHeadings.push({
        id: heading.id,
        level: parseInt(heading.tagName[1], 10),
        text: heading.textContent.trim(),
        element: heading
      });
    });

    // Create sidebar
    tocSidebar = document.createElement('aside');
    tocSidebar.className = 'vmark-toc-sidebar visible';

    // Header with close button (for mobile only)
    const header = document.createElement('div');
    header.className = 'vmark-toc-header';
    header.innerHTML = `<button class="vmark-toc-close" title="Close">&times;</button>`;
    tocSidebar.appendChild(header);

    // Navigation
    const nav = document.createElement('nav');
    nav.className = 'vmark-toc-nav';

    tocHeadings.forEach((item, index) => {
      const link = document.createElement('a');
      link.href = `#${item.id}`;
      link.className = `vmark-toc-item vmark-toc-level-${item.level}`;
      link.dataset.index = index;
      link.textContent = item.text;

      link.addEventListener('click', (e) => {
        e.preventDefault();
        const target = document.getElementById(item.id);
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
          history.pushState(null, '', `#${item.id}`);
          // On mobile, close sidebar after click
          if (window.innerWidth < 768) {
            settings.showToc = false;
            saveSettings();
            applyToc();
            updatePanelUI();
          }
        }
      });

      nav.appendChild(link);
    });

    tocSidebar.appendChild(nav);

    // Close button handler
    const closeToc = () => {
      settings.showToc = false;
      saveSettings();
      applyToc();
      updatePanelUI();
    };

    tocSidebar.querySelector('.vmark-toc-close').addEventListener('click', closeToc);

    // Create backdrop for mobile
    tocBackdrop = document.createElement('div');
    tocBackdrop.className = 'vmark-toc-backdrop';
    tocBackdrop.addEventListener('click', closeToc);
    document.body.appendChild(tocBackdrop);

    // Insert sidebar
    document.body.appendChild(tocSidebar);
    document.body.classList.add('vmark-toc-open');

    // Show backdrop on mobile
    if (window.innerWidth < 768) {
      tocBackdrop.classList.add('visible');
    }

    // Enable scroll spy
    enableScrollSpy();

    // Update toggle tab state
    updateTocToggleTab();
  }

  /**
   * Enable scroll spy to highlight current section
   */
  function enableScrollSpy() {
    if (scrollSpyActive || tocHeadings.length === 0) return;
    scrollSpyActive = true;
    window.addEventListener('scroll', handleScrollSpy, { passive: true });
    handleScrollSpy(); // Initial highlight
  }

  /**
   * Disable scroll spy
   */
  function disableScrollSpy() {
    if (!scrollSpyActive) return;
    scrollSpyActive = false;
    window.removeEventListener('scroll', handleScrollSpy);
  }

  /**
   * Handle scroll spy - highlight current section in TOC
   */
  function handleScrollSpy() {
    if (!tocSidebar || tocHeadings.length === 0) return;

    const scrollTop = window.scrollY;
    const offset = 100; // Offset from top to trigger highlight

    // Find current heading
    let currentIndex = 0;
    for (let i = tocHeadings.length - 1; i >= 0; i--) {
      const heading = tocHeadings[i].element;
      if (heading.offsetTop <= scrollTop + offset) {
        currentIndex = i;
        break;
      }
    }

    // Update active state
    const links = tocSidebar.querySelectorAll('.vmark-toc-item');
    links.forEach((link, index) => {
      link.classList.toggle('active', index === currentIndex);
    });

    // Scroll TOC to keep active item visible
    const activeLink = tocSidebar.querySelector('.vmark-toc-item.active');
    if (activeLink) {
      const nav = tocSidebar.querySelector('.vmark-toc-nav');
      const linkRect = activeLink.getBoundingClientRect();
      const navRect = nav.getBoundingClientRect();

      if (linkRect.top < navRect.top || linkRect.bottom > navRect.bottom) {
        activeLink.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
  }

  /**
   * Create the settings panel
   */
  function createPanel() {
    // Create toggle button
    const toggle = document.createElement('button');
    toggle.className = 'vmark-reader-toggle';
    toggle.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="12" cy="12" r="3"/>
      <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
    </svg>`;
    toggle.title = 'Reader Settings';
    toggle.addEventListener('click', togglePanel);

    // Create panel
    panel = document.createElement('div');
    panel.className = 'vmark-reader-panel';
    panel.innerHTML = `
      <div class="vmark-reader-header">
        <span>Reader Settings</span>
        <button class="vmark-reader-close" title="Close">&times;</button>
      </div>
      <div class="vmark-reader-content">
        <div class="vmark-reader-group">
          <label>Font Size</label>
          <div class="vmark-reader-range-row">
            <button class="vmark-reader-btn" data-action="fontSize" data-dir="-1">−</button>
            <span class="vmark-reader-value" data-value="fontSize">${settings.fontSize}px</span>
            <button class="vmark-reader-btn" data-action="fontSize" data-dir="1">+</button>
          </div>
        </div>
        <div class="vmark-reader-group">
          <label>Line Height</label>
          <div class="vmark-reader-range-row">
            <button class="vmark-reader-btn" data-action="lineHeight" data-dir="-1">−</button>
            <span class="vmark-reader-value" data-value="lineHeight">${settings.lineHeight}</span>
            <button class="vmark-reader-btn" data-action="lineHeight" data-dir="1">+</button>
          </div>
        </div>
        <div class="vmark-reader-group">
          <label>Content Width</label>
          <div class="vmark-reader-range-row">
            <button class="vmark-reader-btn" data-action="contentWidth" data-dir="-1">−</button>
            <span class="vmark-reader-value" data-value="contentWidth">${settings.contentWidth}em</span>
            <button class="vmark-reader-btn" data-action="contentWidth" data-dir="1">+</button>
          </div>
        </div>
        <div class="vmark-reader-group">
          <label>Latin Font</label>
          <select class="vmark-reader-select" data-setting="latinFont">
            ${FONT_OPTIONS.latin.map(o => `<option value="${o.value}" ${settings.latinFont === o.value ? 'selected' : ''}>${o.label}</option>`).join('')}
          </select>
        </div>
        <div class="vmark-reader-group">
          <label>CJK Font</label>
          <select class="vmark-reader-select" data-setting="cjkFont">
            ${FONT_OPTIONS.cjk.map(o => `<option value="${o.value}" ${settings.cjkFont === o.value ? 'selected' : ''}>${o.label}</option>`).join('')}
          </select>
        </div>
        <div class="vmark-reader-group">
          <label>Theme</label>
          <div class="vmark-reader-theme-row">
            <button class="vmark-reader-theme-circle ${settings.theme === 'white' ? 'active' : ''}" data-theme="white" title="White" style="background: ${THEMES.white.background}"></button>
            <button class="vmark-reader-theme-circle ${settings.theme === 'paper' ? 'active' : ''}" data-theme="paper" title="Paper" style="background: ${THEMES.paper.background}"></button>
            <button class="vmark-reader-theme-circle ${settings.theme === 'mint' ? 'active' : ''}" data-theme="mint" title="Mint" style="background: ${THEMES.mint.background}"></button>
            <button class="vmark-reader-theme-circle ${settings.theme === 'sepia' ? 'active' : ''}" data-theme="sepia" title="Sepia" style="background: ${THEMES.sepia.background}"></button>
            <button class="vmark-reader-theme-circle theme-night ${settings.theme === 'night' ? 'active' : ''}" data-theme="night" title="Night" style="background: ${THEMES.night.background}"></button>
          </div>
        </div>
        <div class="vmark-reader-group">
          <label>CJK Letter Spacing</label>
          <div class="vmark-reader-range-row">
            <button class="vmark-reader-btn" data-action="cjkLetterSpacing" data-dir="-1">−</button>
            <span class="vmark-reader-value" data-value="cjkLetterSpacing">${settings.cjkLetterSpacing}em</span>
            <button class="vmark-reader-btn" data-action="cjkLetterSpacing" data-dir="1">+</button>
          </div>
        </div>
        <div class="vmark-reader-group">
          <label class="vmark-reader-checkbox-label">
            <input type="checkbox" ${settings.cjkLatinSpacing ? 'checked' : ''} data-setting="cjkLatinSpacing">
            <span>CJK-Latin Spacing</span>
          </label>
        </div>
        <div class="vmark-reader-group">
          <label class="vmark-reader-checkbox-label">
            <input type="checkbox" ${settings.showToc ? 'checked' : ''} data-setting="showToc">
            <span>Table of Contents</span>
          </label>
        </div>
        <div class="vmark-reader-group">
          <label class="vmark-reader-checkbox-label">
            <input type="checkbox" ${settings.expandDetails ? 'checked' : ''} data-setting="expandDetails">
            <span>Expand All Sections</span>
          </label>
        </div>
        <div class="vmark-reader-group vmark-reader-reset">
          <button class="vmark-reader-reset-btn" data-action="reset">Reset to Defaults</button>
        </div>
      </div>
    `;

    // Event listeners
    panel.querySelector('.vmark-reader-close').addEventListener('click', togglePanel);

    panel.querySelectorAll('.vmark-reader-btn').forEach(btn => {
      btn.addEventListener('click', handleRangeClick);
    });

    panel.querySelectorAll('.vmark-reader-theme-circle').forEach(btn => {
      btn.addEventListener('click', handleThemeClick);
    });

    panel.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
      checkbox.addEventListener('change', handleCheckboxChange);
    });

    panel.querySelectorAll('.vmark-reader-select').forEach(select => {
      select.addEventListener('change', handleSelectChange);
    });

    panel.querySelector('.vmark-reader-reset-btn').addEventListener('click', handleReset);

    // Append to document
    document.body.appendChild(toggle);
    document.body.appendChild(panel);
  }

  /**
   * Toggle panel visibility
   */
  function togglePanel() {
    isOpen = !isOpen;
    panel.classList.toggle('open', isOpen);
    document.body.classList.toggle('vmark-panel-open', isOpen);
  }

  /**
   * Handle range button clicks (+/-)
   */
  function handleRangeClick(e) {
    const btn = e.currentTarget;
    const action = btn.dataset.action;
    const dir = parseInt(btn.dataset.dir, 10);
    adjustSetting(action, dir);
  }

  /**
   * Handle theme button clicks
   */
  function handleThemeClick(e) {
    const theme = e.target.dataset.theme;
    settings.theme = theme;
    saveSettings();
    applySettings();
  }

  /**
   * Handle checkbox changes
   */
  function handleCheckboxChange(e) {
    const setting = e.target.dataset.setting;
    settings[setting] = e.target.checked;
    saveSettings();
    applySettings();
  }

  /**
   * Handle select changes
   */
  function handleSelectChange(e) {
    const setting = e.target.dataset.setting;
    settings[setting] = e.target.value;
    saveSettings();
    applySettings();
  }

  /**
   * Handle reset button
   */
  function handleReset() {
    // First remove CJK spacing if applied
    const editor = document.querySelector('.export-surface-editor');
    if (editor && editor.dataset.cjkApplied === 'true') {
      removeCjkSpacing(editor);
      editor.dataset.cjkApplied = 'false';
    }

    settings = { ...DEFAULTS };
    saveSettings();
    applySettings();
  }

  /**
   * Update panel UI to reflect current settings
   */
  function updatePanelUI() {
    if (!panel) return;

    // Update value displays
    panel.querySelector('[data-value="fontSize"]').textContent = `${settings.fontSize}px`;
    panel.querySelector('[data-value="lineHeight"]').textContent = settings.lineHeight;
    panel.querySelector('[data-value="contentWidth"]').textContent = `${settings.contentWidth}em`;
    panel.querySelector('[data-value="cjkLetterSpacing"]').textContent = `${settings.cjkLetterSpacing}em`;

    // Update theme circles
    panel.querySelectorAll('.vmark-reader-theme-circle').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.theme === settings.theme);
    });

    // Update checkboxes
    panel.querySelector('[data-setting="showToc"]').checked = settings.showToc;
    panel.querySelector('[data-setting="cjkLatinSpacing"]').checked = settings.cjkLatinSpacing;
    panel.querySelector('[data-setting="expandDetails"]').checked = settings.expandDetails;

    // Update selects
    panel.querySelector('[data-setting="latinFont"]').value = settings.latinFont;
    panel.querySelector('[data-setting="cjkFont"]').value = settings.cjkFont;
  }

  // ============================================
  // Keyboard Shortcuts
  // ============================================

  /**
   * Setup keyboard shortcuts
   */
  function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      // Ignore if typing in input
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      switch (e.key) {
        case 'Escape':
          if (isOpen) {
            togglePanel();
          }
          if (lightbox && lightbox.classList.contains('visible')) {
            closeLightbox();
          }
          break;
        case 't':
        case 'T':
          if (!e.metaKey && !e.ctrlKey) {
            settings.showToc = !settings.showToc;
            saveSettings();
            applySettings();
          }
          break;
        case '=':
        case '+':
          if (!e.metaKey && !e.ctrlKey) {
            e.preventDefault();
            adjustSetting('fontSize', 1);
          }
          break;
        case '-':
          if (!e.metaKey && !e.ctrlKey) {
            e.preventDefault();
            adjustSetting('fontSize', -1);
          }
          break;
      }
    });
  }

  /**
   * Adjust a setting by direction
   */
  function adjustSetting(action, dir) {
    const bounds = BOUNDS[action];
    if (!bounds) return;

    let value = settings[action] + (dir * bounds.step);
    value = Math.max(bounds.min, Math.min(bounds.max, value));
    const precision = bounds.step < 0.1 ? 100 : 10;
    value = Math.round(value * precision) / precision;

    settings[action] = value;
    saveSettings();
    applySettings();
  }

  // ============================================
  // Back to Top Button
  // ============================================

  let backToTopBtn = null;

  /**
   * Create back to top button
   */
  function createBackToTop() {
    backToTopBtn = document.createElement('button');
    backToTopBtn.className = 'vmark-back-to-top';
    backToTopBtn.setAttribute('aria-label', 'Back to top');
    backToTopBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="18 15 12 9 6 15"></polyline>
    </svg>`;

    backToTopBtn.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    document.body.appendChild(backToTopBtn);

    // Show/hide based on scroll position
    window.addEventListener('scroll', updateBackToTop, { passive: true });
    updateBackToTop();
  }

  function updateBackToTop() {
    if (!backToTopBtn) return;
    const show = window.scrollY > 300;
    backToTopBtn.classList.toggle('visible', show);
  }

  // ============================================
  // Reading Progress Indicator
  // ============================================

  let progressBar = null;

  /**
   * Create reading progress bar
   */
  function createProgressBar() {
    progressBar = document.createElement('div');
    progressBar.className = 'vmark-progress-bar';
    progressBar.setAttribute('role', 'progressbar');
    progressBar.setAttribute('aria-label', 'Reading progress');

    const progressFill = document.createElement('div');
    progressFill.className = 'vmark-progress-fill';
    progressBar.appendChild(progressFill);

    document.body.appendChild(progressBar);

    window.addEventListener('scroll', updateProgress, { passive: true });
    updateProgress();
  }

  function updateProgress() {
    if (!progressBar) return;
    const fill = progressBar.querySelector('.vmark-progress-fill');
    const scrollTop = window.scrollY;
    const docHeight = document.documentElement.scrollHeight - window.innerHeight;
    const progress = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0;
    fill.style.width = `${progress}%`;
    progressBar.setAttribute('aria-valuenow', Math.round(progress));
  }

  // ============================================
  // Image Lightbox
  // ============================================

  let lightbox = null;

  /**
   * Setup image lightbox
   */
  function setupImageLightbox() {
    // Create lightbox container
    lightbox = document.createElement('div');
    lightbox.className = 'vmark-lightbox';
    lightbox.setAttribute('role', 'dialog');
    lightbox.setAttribute('aria-label', 'Image preview');
    lightbox.innerHTML = `
      <button class="vmark-lightbox-close" aria-label="Close">&times;</button>
      <img class="vmark-lightbox-img" src="" alt="">
    `;

    lightbox.addEventListener('click', (e) => {
      if (e.target === lightbox || e.target.classList.contains('vmark-lightbox-close')) {
        closeLightbox();
      }
    });

    document.body.appendChild(lightbox);

    // Add click handlers to images
    const editor = document.querySelector('.export-surface-editor');
    if (editor) {
      editor.querySelectorAll('img').forEach(img => {
        // Skip broken images and tiny images (use naturalWidth for accurate check)
        if (img.classList.contains('broken-image') ||
            (img.complete && img.naturalWidth < 50)) return;

        img.style.cursor = 'zoom-in';
        img.setAttribute('tabindex', '0');
        img.setAttribute('role', 'button');
        img.setAttribute('aria-label', 'Click to enlarge image');

        img.addEventListener('click', () => openLightbox(img.src, img.alt));
        img.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openLightbox(img.src, img.alt);
          }
        });
      });
    }
  }

  function openLightbox(src, alt) {
    if (!lightbox) return;
    const img = lightbox.querySelector('.vmark-lightbox-img');
    img.src = src;
    img.alt = alt || '';
    lightbox.classList.add('visible');
    document.body.style.overflow = 'hidden';
    lightbox.querySelector('.vmark-lightbox-close').focus();
  }

  function closeLightbox() {
    if (!lightbox) return;
    lightbox.classList.remove('visible');
    document.body.style.overflow = '';
  }

  // ============================================
  // Footnote Navigation
  // ============================================

  /**
   * Setup footnote navigation
   */
  function setupFootnoteNavigation() {
    const editor = document.querySelector('.export-surface-editor');
    if (!editor) return;

    // Find footnote references and definitions
    const refs = editor.querySelectorAll('.footnote-ref, [data-type="footnote_reference"]');
    const defs = editor.querySelectorAll('.footnote-def, [data-type="footnote_definition"]');

    // Create ID mappings if not present
    refs.forEach((ref, i) => {
      if (!ref.id) ref.id = `fnref-${i + 1}`;
      const noteId = ref.dataset.noteId || (i + 1);

      ref.style.cursor = 'pointer';
      ref.setAttribute('role', 'link');
      ref.setAttribute('aria-label', `Go to footnote ${noteId}`);

      ref.addEventListener('click', (e) => {
        e.preventDefault();
        const def = editor.querySelector(`#fndef-${noteId}, .footnote-def[data-note-id="${noteId}"], [data-type="footnote_definition"][data-note-id="${noteId}"]`);
        if (def) {
          def.scrollIntoView({ behavior: 'smooth', block: 'center' });
          def.classList.add('vmark-highlight');
          setTimeout(() => def.classList.remove('vmark-highlight'), 2000);
        }
      });
    });

    // Setup backlinks in definitions
    defs.forEach((def, i) => {
      if (!def.id) def.id = `fndef-${i + 1}`;
      const noteId = def.dataset.noteId || (i + 1);

      // Find or create backref
      let backref = def.querySelector('.footnote-backref');
      if (!backref) {
        backref = document.createElement('a');
        backref.className = 'footnote-backref';
        backref.innerHTML = '↩';
        backref.href = `#fnref-${noteId}`;
        const content = def.querySelector('.footnote-def-content, dd');
        if (content) content.appendChild(backref);
      }

      backref.setAttribute('aria-label', `Back to reference ${noteId}`);
      backref.addEventListener('click', (e) => {
        e.preventDefault();
        const ref = editor.querySelector(`#fnref-${noteId}, .footnote-ref[data-note-id="${noteId}"]`);
        if (ref) {
          ref.scrollIntoView({ behavior: 'smooth', block: 'center' });
          ref.classList.add('vmark-highlight');
          setTimeout(() => ref.classList.remove('vmark-highlight'), 2000);
        }
      });
    });
  }

  // ============================================
  // Accessibility Improvements
  // ============================================

  /**
   * Improve accessibility of reader controls
   */
  function improveAccessibility() {
    // Add aria labels to toggle button
    const toggle = document.querySelector('.vmark-reader-toggle');
    if (toggle) {
      toggle.setAttribute('aria-label', 'Open reader settings');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-controls', 'vmark-reader-panel');
    }

    // Add id and role to panel
    if (panel) {
      panel.id = 'vmark-reader-panel';
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-label', 'Reader settings');
    }

    // Update aria-expanded when panel toggles
    const originalToggle = togglePanel;
    togglePanel = function() {
      originalToggle();
      const toggle = document.querySelector('.vmark-reader-toggle');
      if (toggle) {
        toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        toggle.setAttribute('aria-label', isOpen ? 'Close reader settings' : 'Open reader settings');
      }
    };
  }

  /**
   * Initialize reader
   */
  function init() {
    // Wait for DOM
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
      return;
    }

    loadSettings();
    createPanel();
    applySettings();

    // Additional features
    setupKeyboardShortcuts();
    createBackToTop();
    createProgressBar();
    setupImageLightbox();
    setupFootnoteNavigation();
    improveAccessibility();
  }

  // Start
  init();
})();
