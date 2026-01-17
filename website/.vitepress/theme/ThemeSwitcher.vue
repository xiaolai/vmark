<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'

const themes = [
  { id: 'white', name: 'White', bg: '#FFFFFF', fg: '#ccc' },
  { id: 'paper', name: 'Paper', bg: '#EEEDED', fg: '#ccc' },
  { id: 'mint', name: 'Mint', bg: '#d8eedc', fg: '#a8c9ad' },
  { id: 'sepia', name: 'Sepia', bg: '#fdf5e6', fg: '#e0d5bc' },
  { id: 'night', name: 'Night', bg: '#3a3f46', fg: '#555' },
]

const currentTheme = ref('paper')
const isOpen = ref(false)
const randomIndex = ref(0)

function pickRandomOther() {
  const others = themes.filter(t => t.id !== currentTheme.value)
  randomIndex.value = Math.floor(Math.random() * others.length)
}

const otherThemeData = computed(() => {
  const others = themes.filter(t => t.id !== currentTheme.value)
  return others[randomIndex.value % others.length]
})

function setTheme(themeId: string) {
  currentTheme.value = themeId
  document.documentElement.setAttribute('data-vmark-theme', themeId)
  localStorage.setItem('vmark-preview-theme', themeId)
  isOpen.value = false
  pickRandomOther()
}

function toggleDropdown() {
  isOpen.value = !isOpen.value
}

function closeDropdown(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (!target.closest('.theme-dropdown')) {
    isOpen.value = false
  }
}

onMounted(() => {
  const saved = localStorage.getItem('vmark-preview-theme')
  if (saved && themes.some(t => t.id === saved)) {
    currentTheme.value = saved
    document.documentElement.setAttribute('data-vmark-theme', saved)
  } else {
    currentTheme.value = 'paper'
    document.documentElement.setAttribute('data-vmark-theme', 'paper')
  }
  pickRandomOther()
  document.addEventListener('click', closeDropdown)
})
</script>

<template>
  <div class="theme-dropdown">
    <button class="theme-trigger" @click.stop="toggleDropdown" title="Switch theme">
      <span
        class="theme-dot"
        :style="{ backgroundColor: otherThemeData.bg, borderColor: otherThemeData.fg }"
      ></span>
    </button>
    <div class="theme-menu" v-show="isOpen">
      <button
        v-for="theme in themes"
        :key="theme.id"
        :class="['theme-option', { active: currentTheme === theme.id }]"
        @click="setTheme(theme.id)"
      >
        <span
          class="theme-dot"
          :style="{ backgroundColor: theme.bg, borderColor: theme.fg }"
        ></span>
        <span>{{ theme.name }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.theme-dropdown {
  position: relative;
}

.theme-trigger {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
  transition: background 0.2s ease;
}

.theme-trigger:hover {
  background: var(--vp-c-bg-soft);
}

.theme-dot {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 1px solid;
  flex-shrink: 0;
}

.theme-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  min-width: 120px;
  padding: 4px;
  border: 1px solid var(--vp-c-border);
  border-radius: 8px;
  background: var(--vp-c-bg);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  z-index: 100;
}

.theme-option {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--vp-c-text-1);
  font-size: 13px;
  cursor: pointer;
  transition: background 0.15s ease;
}

.theme-option:hover {
  background: var(--vp-c-bg-soft);
}

.theme-option.active {
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
}

.theme-option .theme-dot {
  width: 14px;
  height: 14px;
}
</style>
