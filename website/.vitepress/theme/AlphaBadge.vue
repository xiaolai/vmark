<script setup lang="ts">
// Alpha badge for VMark site title
// Minimal outlined design with subtle pulse indicator
</script>

<template>
  <span class="alpha-badge" title="Alpha Release - Features may change">
    <span class="alpha-dot"></span>
    <span class="alpha-text">alpha</span>
  </span>
</template>

<style scoped>
.alpha-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-left: 10px;
  padding: 2px 8px 2px 6px;
  font-size: 10px;
  font-weight: 500;
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  letter-spacing: 0.5px;
  text-transform: lowercase;
  border-radius: 100px;
  border: 1px solid var(--vp-c-brand-1);
  background: transparent;
  color: var(--vp-c-brand-1);
  cursor: help;
  user-select: none;
  vertical-align: middle;
  position: relative;
  top: -1px;
  transition: all 0.2s ease;
}

.alpha-badge:hover {
  background: var(--vp-c-brand-soft);
  border-color: var(--vp-c-brand-2);
}

/* Pulsing dot indicator */
.alpha-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--vp-c-brand-1);
  position: relative;
  flex-shrink: 0;
}

.alpha-dot::before {
  content: '';
  position: absolute;
  inset: -2px;
  border-radius: 50%;
  background: var(--vp-c-brand-1);
  opacity: 0.4;
  animation: alpha-pulse 2s ease-in-out infinite;
}

.alpha-text {
  line-height: 1;
}

@keyframes alpha-pulse {
  0%, 100% {
    transform: scale(1);
    opacity: 0.4;
  }
  50% {
    transform: scale(1.8);
    opacity: 0;
  }
}

/* Theme adjustments */
[data-vmark-theme="night"] .alpha-badge,
.dark .alpha-badge {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
}

[data-vmark-theme="night"] .alpha-dot,
.dark .alpha-dot {
  background: var(--vp-c-brand-1);
}

[data-vmark-theme="night"] .alpha-dot::before,
.dark .alpha-dot::before {
  background: var(--vp-c-brand-1);
}

/* Reduce motion for accessibility */
@media (prefers-reduced-motion: reduce) {
  .alpha-dot::before {
    animation: none;
    opacity: 0.3;
    transform: scale(1.5);
  }
}
</style>
