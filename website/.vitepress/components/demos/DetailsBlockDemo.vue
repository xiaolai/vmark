<script setup lang="ts">
import { ref } from 'vue'

const examples = [
  {
    summary: 'Click to expand this section',
    content: 'This is the hidden content that appears when you click. You can put any markdown content here — paragraphs, lists, code blocks, even nested details.',
  },
  {
    summary: 'FAQ: How do I install VMark?',
    content: 'Download the latest release from our download page, then drag VMark to your Applications folder. Launch it and start writing!',
  },
  {
    summary: 'Advanced Configuration Options',
    content: 'VMark stores settings in ~/.vmark/settings.json. You can manually edit this file for advanced configuration, but most users won\'t need to.',
  },
]

const openStates = ref([true, false, false])

function toggle(index: number) {
  openStates.value[index] = !openStates.value[index]
}
</script>

<template>
  <div class="details-demo">
    <div class="details-demo__header">
      <h3 class="details-demo__title">Collapsible Blocks</h3>
      <p class="details-demo__subtitle">Expandable sections for FAQs, spoilers, and optional content</p>
    </div>

    <div class="details-demo__examples">
      <details
        v-for="(example, index) in examples"
        :key="index"
        class="details-demo__block"
        :open="openStates[index]"
      >
        <summary class="details-demo__summary" @click.prevent="toggle(index)">
          <span class="details-demo__arrow">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M4 2L8 6L4 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </span>
          <span class="details-demo__summary-text">{{ example.summary }}</span>
        </summary>
        <div class="details-demo__content">
          {{ example.content }}
        </div>
      </details>
    </div>

    <div class="details-demo__nested">
      <div class="details-demo__nested-title">Nested Example</div>
      <details class="details-demo__block" open>
        <summary class="details-demo__summary">
          <span class="details-demo__arrow">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M4 2L8 6L4 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </span>
          <span class="details-demo__summary-text">Parent Section</span>
        </summary>
        <div class="details-demo__content">
          <p>This section contains nested collapsible content:</p>
          <details class="details-demo__block details-demo__block--nested">
            <summary class="details-demo__summary">
              <span class="details-demo__arrow">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M4 2L8 6L4 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </span>
              <span class="details-demo__summary-text">Child Section A</span>
            </summary>
            <div class="details-demo__content">
              Content for the first nested section.
            </div>
          </details>
          <details class="details-demo__block details-demo__block--nested">
            <summary class="details-demo__summary">
              <span class="details-demo__arrow">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M4 2L8 6L4 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </span>
              <span class="details-demo__summary-text">Child Section B</span>
            </summary>
            <div class="details-demo__content">
              Content for the second nested section.
            </div>
          </details>
        </div>
      </details>
    </div>

    <div class="details-demo__syntax">
      <div class="details-demo__syntax-title">Markdown Syntax</div>
      <pre class="details-demo__code">&lt;details&gt;
&lt;summary&gt;Click to expand&lt;/summary&gt;

Your hidden content here.
Supports **markdown** formatting.

&lt;/details&gt;</pre>
    </div>
  </div>
</template>

<style scoped>
.details-demo {
  --demo-bg: #f8f9fa;
  --demo-border: #e1e4e8;
  --demo-text: #24292e;
  --demo-text-secondary: #586069;
  --demo-accent: #0066cc;
  --demo-radius: 8px;
  --demo-font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --demo-font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;

  font-family: var(--demo-font-sans);
  background: var(--demo-bg);
  border: 1px solid var(--demo-border);
  border-radius: var(--demo-radius);
  padding: 24px;
  margin: 24px 0;
  color: var(--demo-text);
}

.dark .details-demo {
  --demo-bg: #1e2024;
  --demo-border: #3a3f46;
  --demo-text: #d6d9de;
  --demo-text-secondary: #9aa0a6;
  --demo-accent: #5aa8ff;
}

.details-demo__header {
  margin-bottom: 20px;
}

.details-demo__title {
  margin: 0 0 4px 0;
  font-size: 18px;
  font-weight: 600;
}

.details-demo__subtitle {
  margin: 0;
  font-size: 14px;
  color: var(--demo-text-secondary);
}

.details-demo__examples {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 24px;
}

.details-demo__block {
  background: white;
  border: 1px solid var(--demo-border);
  border-radius: 6px;
  overflow: hidden;
}

.dark .details-demo__block {
  background: #23262b;
}

.details-demo__block--nested {
  margin-top: 12px;
  background: rgba(0, 0, 0, 0.02);
}

.dark .details-demo__block--nested {
  background: rgba(255, 255, 255, 0.03);
}

.details-demo__summary {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  cursor: pointer;
  user-select: none;
  font-weight: 500;
  font-size: 14px;
  list-style: none;
  transition: background 0.15s;
}

.details-demo__summary::-webkit-details-marker {
  display: none;
}

.details-demo__summary:hover {
  background: rgba(0, 0, 0, 0.02);
}

.dark .details-demo__summary:hover {
  background: rgba(255, 255, 255, 0.03);
}

.details-demo__arrow {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  color: var(--demo-text-secondary);
  transition: transform 0.2s ease;
}

.details-demo__block[open] > .details-demo__summary .details-demo__arrow {
  transform: rotate(90deg);
}

.details-demo__summary-text {
  flex: 1;
}

.details-demo__content {
  padding: 0 16px 16px 40px;
  font-size: 14px;
  line-height: 1.6;
  color: var(--demo-text-secondary);
}

.details-demo__content p {
  margin: 0 0 8px 0;
}

.details-demo__content p:last-child {
  margin-bottom: 0;
}

.details-demo__nested {
  margin-bottom: 24px;
}

.details-demo__nested-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--demo-text-secondary);
  margin-bottom: 12px;
}

.details-demo__syntax {
  background: rgba(0, 0, 0, 0.03);
  border-radius: var(--demo-radius);
  padding: 16px;
}

.dark .details-demo__syntax {
  background: rgba(255, 255, 255, 0.03);
}

.details-demo__syntax-title {
  font-size: 12px;
  font-weight: 600;
  margin-bottom: 12px;
  color: var(--demo-text-secondary);
}

.details-demo__code {
  margin: 0;
  font-family: var(--demo-font-mono);
  font-size: 13px;
  line-height: 1.5;
  white-space: pre-wrap;
  color: var(--demo-text);
}
</style>
