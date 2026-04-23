<script setup>
import { ref, computed, onMounted } from 'vue'

const stats = ref(null)
const error = ref(false)

const platformLabels = {
  'darwin-aarch64': 'macOS (Apple Silicon)',
  'darwin-x86_64': 'macOS (Intel)',
  'windows-x86_64': 'Windows',
  'linux-x86_64': 'Linux',
  'linux-aarch64': 'Linux (ARM)',
}

function label(key) {
  return platformLabels[key] || key
}

function fmt(n) {
  return typeof n === 'number' ? n.toLocaleString('en-US') : n
}

const hasPlatforms = computed(() => {
  return stats.value && stats.value.platforms && Object.keys(stats.value.platforms).length > 0
})

const hasVersions = computed(() => {
  return stats.value && stats.value.versions && Object.keys(stats.value.versions).length > 0
})

const versionRows = computed(() => {
  if (!hasVersions.value) return []
  const entries = Object.entries(stats.value.versions)
  entries.sort(([a], [b]) => b.localeCompare(a, undefined, { numeric: true }))
  const rows = entries.slice(0, 3).map(([v, c]) => ({ label: `v${v}`, count: c }))
  if (entries.length > 3) {
    const olderSum = entries.slice(3).reduce((sum, [, c]) => sum + c, 0)
    rows.push({ label: 'Older', count: olderSum })
  }
  return rows
})

const platformOrder = [
  'darwin-aarch64',
  'darwin-x86_64',
  'windows-x86_64',
  'linux-x86_64',
  'linux-aarch64',
]

const detailRows = computed(() => {
  const platforms = hasPlatforms.value
    ? Object.entries(stats.value.platforms)
        .sort(([a], [b]) => {
          const ai = platformOrder.indexOf(a)
          const bi = platformOrder.indexOf(b)
          return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi)
        })
        .map(([k, v]) => ({ label: label(k), count: v }))
    : []
  const versions = versionRows.value
  const len = Math.max(platforms.length, versions.length)
  const rows = []
  for (let i = 0; i < len; i++) {
    rows.push({
      platform: platforms[i] || null,
      version: versions[i] || null,
    })
  }
  return rows
})

onMounted(async () => {
  try {
    const res = await fetch('https://log.vmark.app/api/stats')
    stats.value = await res.json()
  } catch {
    error.value = true
  }
})
</script>

<template>
  <div v-if="stats && stats.total && stats.total.pings > 0" class="user-stats">
    <div class="table-wrapper">
      <div class="stats-grid">
        <div class="stat-header">
          <span class="header-spacer"></span>
          <span v-for="h in ['Today', 'This Week', 'This Month', 'All Time']" :key="h" class="header-label">{{ h }}</span>
        </div>
        <div class="stat-row" v-if="stats.today.devices != null">
          <span class="row-label">Unique Devices</span>
          <span class="stat-number">{{ fmt(stats.today.devices) }}</span>
          <span class="stat-number">{{ fmt(stats.week.devices) }}</span>
          <span class="stat-number">{{ fmt(stats.month.devices) }}</span>
          <span class="stat-number">{{ fmt(stats.total.devices) }}</span>
        </div>
        <div class="stat-row">
          <span class="row-label">Unique IPs</span>
          <span :class="stats.today.devices != null ? 'stat-sub' : 'stat-number'">{{ fmt(stats.today.ips) }}</span>
          <span :class="stats.today.devices != null ? 'stat-sub' : 'stat-number'">{{ fmt(stats.week.ips) }}</span>
          <span :class="stats.today.devices != null ? 'stat-sub' : 'stat-number'">{{ fmt(stats.month.ips) }}</span>
          <span :class="stats.today.devices != null ? 'stat-sub' : 'stat-number'">{{ fmt(stats.total.ips) }}</span>
        </div>
        <div class="stat-row">
          <span class="row-label">Update Pings</span>
          <span class="stat-sub">{{ fmt(stats.today.pings) }}</span>
          <span class="stat-sub">{{ fmt(stats.week.pings) }}</span>
          <span class="stat-sub">{{ fmt(stats.month.pings) }}</span>
          <span class="stat-sub">{{ fmt(stats.total.pings) }}</span>
        </div>
      </div>
    </div>

    <div v-if="hasPlatforms || hasVersions" class="table-wrapper">
      <div class="details-grid">
        <span class="details-header" v-if="hasPlatforms">Platforms</span>
        <span class="details-header" v-if="hasVersions">Versions</span>
        <template v-for="(row, i) in detailRows" :key="i">
          <template v-if="hasPlatforms">
            <span class="details-label">{{ row.platform?.label ?? '' }}</span>
            <span class="details-value">{{ row.platform ? fmt(row.platform.count) : '' }}</span>
          </template>
          <template v-if="hasVersions">
            <span class="details-label">{{ row.version?.label ?? '' }}</span>
            <span class="details-value">{{ row.version ? fmt(row.version.count) : '' }}</span>
          </template>
        </template>
      </div>
    </div>

    <p class="stats-note">
      Anonymous device counts and unique IPs from update check pings.
      <a href="/guide/privacy">Privacy →</a>
    </p>
  </div>
</template>

<style scoped>
.user-stats {
  margin: 1.5rem 0;
}

.table-wrapper {
  display: flex;
  justify-content: center;
  margin-bottom: 1.25rem;
}

/* Main stats table */
.stats-grid {
  display: grid;
  grid-template-columns: auto auto auto auto auto;
  gap: 0.25rem 1.5rem;
  justify-items: center;
}

.stat-header,
.stat-row {
  display: contents;
}

.header-spacer {
  /* empty first column */
}

.header-label {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--vp-c-text-3);
  text-transform: uppercase;
  letter-spacing: 0.03em;
  padding-bottom: 0.25rem;
}

.row-label {
  font-size: 0.875rem;
  color: var(--vp-c-text-2);
  justify-self: end;
  padding: 0.35rem 0;
}

.stat-number {
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--vp-c-brand-1);
  line-height: 1.2;
  padding: 0.35rem 0;
}

.stat-sub {
  font-size: 1.25rem;
  color: var(--vp-c-text-2);
  padding: 0.35rem 0;
}

/* Details table (platforms + versions) */
.details-grid {
  display: grid;
  grid-template-columns: auto auto auto auto;
  gap: 0.15rem 1.5rem;
  justify-items: center;
}

.details-header {
  grid-column: span 2;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--vp-c-text-3);
  text-transform: uppercase;
  letter-spacing: 0.03em;
  padding-bottom: 0.25rem;
}

.details-label {
  font-size: 0.875rem;
  color: var(--vp-c-text-2);
  justify-self: end;
  padding: 0.2rem 0;
}

.details-value {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--vp-c-brand-1);
  justify-self: start;
  padding: 0.2rem 0;
}

.stats-note {
  text-align: center;
  font-size: 0.8rem;
  color: var(--vp-c-text-3);
  margin-top: 0;
}

.stats-note a {
  color: var(--vp-c-brand-1);
  text-decoration: none;
}

.stats-note a:hover {
  text-decoration: underline;
}
</style>
