<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'

interface ReleaseAsset {
  name: string
  browser_download_url: string
  size: number
}

interface Release {
  tag_name: string
  name: string
  published_at: string | null
  html_url: string
  assets: ReleaseAsset[]
}

interface PlatformDownload {
  name: string
  url: string
  size: string
  icon: string
}

interface CachedRelease {
  data: Release
  timestamp: number
}

const loading = ref(true)
const error = ref<string | null>(null)
const release = ref<Release | null>(null)
const downloads = ref<PlatformDownload[]>([])
const userPlatform = ref<'macos' | 'windows' | 'linux' | 'unknown'>('unknown')

const REPO_OWNER = 'xiaolai'
const REPO_NAME = 'vmark'
const CACHE_KEY = 'vmark-release-cache'
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

function formatSize(bytes: number): string {
  const mb = bytes / (1024 * 1024)
  return `${mb.toFixed(1)} MB`
}

function detectPlatform(): 'macos' | 'windows' | 'linux' | 'unknown' {
  const ua = navigator.userAgent.toLowerCase()
  if (ua.includes('mac')) return 'macos'
  if (ua.includes('win')) return 'windows'
  if (ua.includes('linux')) return 'linux'
  return 'unknown'
}

function getAssetInfo(asset: ReleaseAsset): PlatformDownload | null {
  const name = asset.name.toLowerCase()

  // macOS only - Windows and Linux binaries are available on GitHub Releases
  if (name.endsWith('.dmg')) {
    const isArm = name.includes('aarch64') || name.includes('arm64')
    const isIntel = name.includes('x64') || name.includes('x86_64')
    const isUniversal = !isArm && !isIntel

    let displayName = 'macOS'
    if (isUniversal) displayName = 'macOS (Universal)'
    else if (isArm) displayName = 'macOS (Apple Silicon)'
    else if (isIntel) displayName = 'macOS (Intel)'

    return {
      name: displayName,
      url: asset.browser_download_url,
      size: formatSize(asset.size),
      icon: 'macos'
    }
  }

  return null
}

function parseDownloads(data: Release): PlatformDownload[] {
  const platformDownloads: PlatformDownload[] = []
  for (const asset of data.assets) {
    const info = getAssetInfo(asset)
    if (info) {
      platformDownloads.push(info)
    }
  }
  // Sort: macOS first, then Windows, then Linux
  platformDownloads.sort((a, b) => {
    const order: Record<string, number> = { macos: 0, windows: 1, linux: 2 }
    return (order[a.icon] ?? 3) - (order[b.icon] ?? 3)
  })
  return platformDownloads
}

function tryLoadFromCache(): boolean {
  try {
    const cached = localStorage.getItem(CACHE_KEY)
    if (!cached) return false

    const { data, timestamp }: CachedRelease = JSON.parse(cached)
    if (Date.now() - timestamp > CACHE_TTL_MS) {
      localStorage.removeItem(CACHE_KEY)
      return false
    }

    release.value = data
    downloads.value = parseDownloads(data)
    return true
  } catch {
    localStorage.removeItem(CACHE_KEY)
    return false
  }
}

function saveToCache(data: Release): void {
  try {
    const cached: CachedRelease = { data, timestamp: Date.now() }
    localStorage.setItem(CACHE_KEY, JSON.stringify(cached))
  } catch {
    // localStorage may be unavailable or full; ignore
  }
}

async function fetchRelease() {
  try {
    loading.value = true
    error.value = null

    // Try cache first
    if (tryLoadFromCache()) {
      loading.value = false
      return
    }

    const response = await fetch(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`
    )

    // Handle rate limiting
    const remaining = response.headers.get('X-RateLimit-Remaining')
    if (remaining && parseInt(remaining, 10) === 0) {
      const resetHeader = response.headers.get('X-RateLimit-Reset')
      if (resetHeader) {
        const resetTime = new Date(parseInt(resetHeader, 10) * 1000)
        error.value = `GitHub API rate limit reached. Try again after ${resetTime.toLocaleTimeString()}.`
      } else {
        error.value = 'GitHub API rate limit reached. Please try again later.'
      }
      return
    }

    if (!response.ok) {
      if (response.status === 404) {
        error.value = 'No releases available yet.'
        return
      }
      if (response.status === 403) {
        error.value = 'GitHub API rate limit reached. Please try again later.'
        return
      }
      throw new Error(`Failed to fetch release: ${response.statusText}`)
    }

    const data: Release = await response.json()
    release.value = data
    downloads.value = parseDownloads(data)
    saveToCache(data)
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to fetch release'
  } finally {
    loading.value = false
  }
}

const formattedDate = computed(() => {
  if (!release.value?.published_at) return null
  try {
    return new Date(release.value.published_at).toLocaleDateString()
  } catch {
    return null
  }
})

onMounted(() => {
  userPlatform.value = detectPlatform()
  fetchRelease()
})
</script>

<template>
  <div class="download-section">
    <!-- Loading state -->
    <div v-if="loading" class="loading">
      Loading release information...
    </div>

    <!-- Error state - show fallback without alarming message -->
    <div v-else-if="error" class="fallback">
      <a :href="`https://github.com/${REPO_OWNER}/${REPO_NAME}/releases`" target="_blank" class="fallback-button">
        View Downloads on GitHub →
      </a>
    </div>

    <!-- Downloads -->
    <template v-else-if="release">
      <div class="version-info">
        <span class="version">{{ release.tag_name }}</span>
        <span v-if="formattedDate" class="date">
          Released {{ formattedDate }}
        </span>
      </div>

      <div class="download-buttons" v-if="downloads.length > 0">
        <a
          v-for="download in downloads"
          :key="download.url"
          :href="download.url"
          class="download-button"
          :class="{ primary: download.icon === userPlatform }"
        >
          <span class="icon">
            <!-- macOS -->
            <svg v-if="download.icon === 'macos'" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/></svg>
          </span>
          <span class="info">
            <span class="name">{{ download.name }}</span>
            <span class="size">{{ download.size }}</span>
          </span>
        </a>
      </div>

      <div v-else class="no-downloads">
        <p>No downloadable binaries found in this release.</p>
      </div>

      <p class="all-releases">
        <a :href="`https://github.com/${REPO_OWNER}/${REPO_NAME}/releases`" target="_blank">
          View all releases on GitHub →
        </a>
      </p>
    </template>
  </div>
</template>

<style scoped>
.download-section {
  margin: 2rem 0;
}

.loading {
  padding: 2rem;
  text-align: center;
  color: var(--vp-c-text-2);
}

.fallback {
  text-align: center;
  padding: 2rem;
}

.fallback-button {
  display: inline-block;
  padding: 0.75rem 1.5rem;
  border-radius: 8px;
  background: var(--vp-c-brand-1);
  color: var(--vp-c-white);
  font-weight: 500;
  text-decoration: none;
  transition: opacity 0.2s ease;
}

.fallback-button:hover {
  opacity: 0.9;
  text-decoration: none;
}

.version-info {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-bottom: 1.5rem;
}

.version {
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--vp-c-brand-1);
}

.date {
  color: var(--vp-c-text-2);
  font-size: 0.875rem;
}

.download-buttons {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 1rem;
}

.download-button {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 1rem 1.25rem;
  border-radius: 8px;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  text-decoration: none;
  transition: all 0.2s ease;
}

.download-button:hover {
  border-color: var(--vp-c-brand-1);
  background: var(--vp-c-bg-soft);
  text-decoration: none;
}

.download-button.primary {
  border-color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
}

.download-button .icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  color: var(--vp-c-text-2);
}

.download-button .icon svg {
  width: 24px;
  height: 24px;
}

.download-button.primary .icon {
  color: var(--vp-c-brand-1);
}

.download-button .info {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
}

.download-button .name {
  font-weight: 500;
  color: var(--vp-c-text-1);
}

.download-button .size {
  font-size: 0.75rem;
  color: var(--vp-c-text-2);
}

.no-downloads {
  padding: 1.5rem;
  text-align: center;
  background: var(--vp-c-bg-soft);
  border-radius: 8px;
  color: var(--vp-c-text-2);
}

.all-releases {
  margin-top: 1.5rem;
  text-align: center;
}

.all-releases a {
  color: var(--vp-c-brand-1);
  font-size: 0.875rem;
}
</style>
