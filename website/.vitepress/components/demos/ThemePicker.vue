<script setup lang="ts">
import { ref, computed } from 'vue'

type ThemeId = 'white' | 'paper' | 'mint' | 'sepia' | 'night'

interface ThemeColors {
  background: string
  foreground: string
  link: string
  secondary: string
  border: string
  strong: string
  emphasis: string
}

const themes: Record<ThemeId, ThemeColors> = {
  white: {
    background: '#FFFFFF',
    foreground: '#1a1a1a',
    link: '#0066cc',
    secondary: '#f8f8f8',
    border: '#eeeeee',
    strong: '#3f5663',
    emphasis: '#5b0411',
  },
  paper: {
    background: '#EEEDED',
    foreground: '#1a1a1a',
    link: '#0066cc',
    secondary: '#e5e4e4',
    border: '#d5d4d4',
    strong: '#3f5663',
    emphasis: '#5b0411',
  },
  mint: {
    background: '#CCE6D0',
    foreground: '#2d3a35',
    link: '#1a6b4a',
    secondary: '#b8d9bd',
    border: '#a8c9ad',
    strong: '#1a5c4a',
    emphasis: '#6b4423',
  },
  sepia: {
    background: '#F9F0DB',
    foreground: '#5c4b37',
    link: '#8b4513',
    secondary: '#f0e5cc',
    border: '#e0d5bc',
    strong: '#4a3728',
    emphasis: '#8b3a2f',
  },
  night: {
    background: '#23262b',
    foreground: '#d6d9de',
    link: '#5aa8ff',
    secondary: '#2a2e34',
    border: '#3a3f46',
    strong: '#6cb6ff',
    emphasis: '#d19a66',
  },
}

const themeLabels: Record<ThemeId, string> = {
  white: 'White',
  paper: 'Paper',
  mint: 'Mint',
  sepia: 'Sepia',
  night: 'Night',
}

const selectedTheme = ref<ThemeId>('paper')
const currentTheme = computed(() => themes[selectedTheme.value])
const isDark = computed(() => selectedTheme.value === 'night')
</script>

<template>
  <div class="vmark-demo">
    <div class="vmark-demo__header">
      <h3 class="vmark-demo__title">Theme Preview</h3>
      <p class="vmark-demo__subtitle">Five hand-crafted themes for comfortable writing</p>
    </div>

    <div class="theme-picker">
      <button
        v-for="(_, themeId) in themes"
        :key="themeId"
        :class="['theme-btn', { 'active': selectedTheme === themeId }]"
        @click="selectedTheme = themeId as ThemeId"
      >
        <span
          class="theme-swatch"
          :style="{ background: themes[themeId].background, borderColor: themes[themeId].border }"
        />
        <span class="theme-name">{{ themeLabels[themeId] }}</span>
      </button>
    </div>

    <div
      class="preview"
      :style="{
        '--preview-bg': currentTheme.background,
        '--preview-fg': currentTheme.foreground,
        '--preview-link': currentTheme.link,
        '--preview-secondary': currentTheme.secondary,
        '--preview-border': currentTheme.border,
        '--preview-strong': currentTheme.strong,
        '--preview-emphasis': currentTheme.emphasis,
      }"
    >
      <h2 class="preview__h1">Welcome to VMark</h2>
      <p class="preview__p">
        Write beautiful <strong>markdown</strong> with <em>style</em>.
      </p>
      <p class="preview__p">
        This is a <a href="#" class="preview__link">link</a> to somewhere interesting.
      </p>
      <blockquote class="preview__quote">
        A blockquote for emphasis.
      </blockquote>
      <p class="preview__p">
        The quick brown fox jumps over the lazy dog.
      </p>
    </div>

    <div class="colors">
      <div class="color" v-for="(color, name) in currentTheme" :key="name">
        <span class="color__swatch" :style="{ background: color }" />
        <span class="color__name">{{ name }}</span>
        <span class="color__value">{{ color }}</span>
      </div>
    </div>
  </div>
</template>

<style src="./vmark-ui.css"></style>
<style scoped>
.theme-picker {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 20px;
}

.theme-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  font-size: 13px;
  font-family: var(--font-sans);
  font-weight: 500;
  border: 2px solid var(--border-color);
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--text-color);
  cursor: pointer;
  transition: all 0.15s;
}

.theme-btn:hover {
  border-color: var(--accent-primary);
}

.theme-btn.active {
  border-color: var(--accent-primary);
  background: var(--accent-bg);
}

.theme-swatch {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 1px solid;
  flex-shrink: 0;
}

.preview {
  background: var(--preview-bg);
  color: var(--preview-fg);
  border-radius: var(--radius-lg);
  padding: 24px;
  margin-bottom: 20px;
  border: 1px solid var(--preview-border);
  transition: all 0.2s;
}

.preview__h1 {
  margin: 0 0 16px 0;
  font-size: 22px;
  font-weight: 600;
}

.preview__p {
  margin: 0 0 12px 0;
  font-size: 15px;
  line-height: 1.6;
}

.preview__p strong {
  color: var(--preview-strong);
  font-weight: 600;
}

.preview__p em {
  color: var(--preview-emphasis);
  font-style: italic;
}

.preview__link {
  color: var(--preview-link);
  text-decoration: none;
}

.preview__link:hover {
  text-decoration: underline;
}

.preview__quote {
  margin: 16px 0;
  padding: 12px 16px;
  border-left: 4px solid var(--preview-border);
  border-radius: var(--radius-md);
  font-style: italic;
  opacity: 0.9;
}

.colors {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
  gap: 10px;
}

.color {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}

.color__swatch {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 1px solid var(--border-color);
  flex-shrink: 0;
}

.color__name {
  font-weight: 500;
  text-transform: capitalize;
}

.color__value {
  font-family: var(--font-mono);
  color: var(--text-secondary);
  font-size: 10px;
}
</style>
