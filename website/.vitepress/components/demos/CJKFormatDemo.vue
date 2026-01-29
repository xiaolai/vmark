<script setup lang="ts">
import { ref, computed } from 'vue'
import { applyRules, defaultCJKSettings } from './cjkFormatter'

const sampleTexts = [
  {
    label: 'CJK-Latin Spacing',
    input: '共100个,价格$50元,温度25℃正常.',
    description: 'Adds spaces between CJK and numbers/letters, converts punctuation'
  },
  {
    label: 'Smart Quotes',
    input: '他说"don\'t worry"然后走了.',
    description: 'Stack-based quote pairing preserves apostrophes in contractions'
  },
  {
    label: 'Technical Protection',
    input: '访问https://example.com获取v1.2.3版本.',
    description: 'URLs, versions, decimals, and times are protected from conversion'
  },
  {
    label: 'Dash Conversion',
    input: '中文--English--中文,测试---内容.',
    description: 'Converts double/triple hyphens to em-dashes with spacing'
  },
  {
    label: 'Fullwidth',
    input: '数量１００个,(中文)内容.',
    description: 'Normalizes fullwidth numbers and parentheses'
  },
  {
    label: 'Mixed',
    input: '我买了3个iPhone15,花了$999.',
    description: 'CJK spacing + currency binding + punctuation conversion'
  }
]

const selectedSample = ref(0)
const customInput = ref('')

const inputText = computed(() => {
  return customInput.value || sampleTexts[selectedSample.value].input
})

const outputText = computed(() => {
  return applyRules(inputText.value, defaultCJKSettings)
})

const hasChanges = computed(() => inputText.value !== outputText.value)
</script>

<template>
  <div class="vmark-demo">
    <p class="vmark-demo__subtitle">See how VMark formats mixed CJK and Latin text</p>

    <div class="sample-pills">
      <button
        v-for="(sample, index) in sampleTexts"
        :key="index"
        :class="['vmark-btn vmark-btn--pill', { 'active': selectedSample === index && !customInput }]"
        @click="selectedSample = index; customInput = ''"
      >
        {{ sample.label }}
      </button>
    </div>

    <p class="description">
      {{ customInput ? 'Custom input' : sampleTexts[selectedSample].description }}
    </p>

    <div class="vmark-comparison">
      <div class="panel">
        <div class="vmark-label">Before</div>
        <textarea
          v-model="customInput"
          :placeholder="sampleTexts[selectedSample].input"
          class="vmark-textarea"
        />
      </div>
      <div class="vmark-comparison__arrow">→</div>
      <div class="panel">
        <div class="vmark-label">
          After
          <span v-if="hasChanges" class="vmark-badge vmark-badge--success">changed</span>
        </div>
        <div class="output">{{ outputText }}</div>
      </div>
    </div>

    <div v-if="hasChanges" class="diff">
      <div class="diff__title">Changes Applied:</div>
      <div class="diff__content">
        <span class="diff__old">{{ inputText }}</span>
        <span class="diff__new">{{ outputText }}</span>
      </div>
    </div>
  </div>
</template>

<style src="./vmark-ui.css"></style>
<style scoped>
.sample-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}

.description {
  font-size: 13px;
  color: var(--text-secondary);
  margin: 0 0 16px 0;
  font-style: italic;
}

.panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* Match textarea and output heights */
.vmark-textarea {
  min-height: 80px;
  padding: 12px;
  font-size: 15px;
  line-height: 1.6;
  border-radius: var(--radius-lg);
  resize: none;
}

.output {
  padding: 12px;
  font-size: 15px;
  line-height: 1.6;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  background: var(--accent-bg);
  min-height: 80px;
  box-sizing: border-box;
}

.diff {
  margin-top: 20px;
  padding: 12px;
  background: var(--subtle-bg);
  border-radius: var(--radius-md);
}

.diff__title {
  font-size: 12px;
  font-weight: 600;
  margin-bottom: 8px;
  color: var(--text-secondary);
}

.diff__content {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-family: var(--font-mono);
  font-size: 14px;
}

.diff__old {
  text-decoration: underline wavy;
  text-decoration-color: var(--error-color);
  color: var(--text-secondary);
}

.diff__new {
  color: var(--success-color);
}
</style>
