<script setup lang="ts">
import { ref, onMounted } from 'vue'

interface ReleaseAsset {
  name: string
  browser_download_url: string
  size: number
}

interface Release {
  tag_name: string
  name: string
  published_at: string
  html_url: string
  assets: ReleaseAsset[]
}

interface PlatformDownload {
  name: string
  url: string
  size: string
  icon: string
}

const loading = ref(true)
const error = ref<string | null>(null)
const release = ref<Release | null>(null)
const downloads = ref<PlatformDownload[]>([])

const REPO_OWNER = 'xiaolai'
const REPO_NAME = 'vmark'

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

  // macOS
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
      icon: '🍎'
    }
  }

  // Windows
  if (name.endsWith('.msi') || name.endsWith('.exe')) {
    const isSetup = name.includes('setup') || name.endsWith('.msi')
    return {
      name: isSetup ? 'Windows (Installer)' : 'Windows (Portable)',
      url: asset.browser_download_url,
      size: formatSize(asset.size),
      icon: '🪟'
    }
  }

  // Linux
  if (name.endsWith('.appimage')) {
    return {
      name: 'Linux (AppImage)',
      url: asset.browser_download_url,
      size: formatSize(asset.size),
      icon: '🐧'
    }
  }

  if (name.endsWith('.deb')) {
    return {
      name: 'Linux (Debian/Ubuntu)',
      url: asset.browser_download_url,
      size: formatSize(asset.size),
      icon: '🐧'
    }
  }

  if (name.endsWith('.rpm')) {
    return {
      name: 'Linux (Fedora/RHEL)',
      url: asset.browser_download_url,
      size: formatSize(asset.size),
      icon: '🐧'
    }
  }

  return null
}

async function fetchRelease() {
  try {
    loading.value = true
    error.value = null

    const response = await fetch(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`
    )

    if (!response.ok) {
      if (response.status === 404) {
        error.value = 'No releases available yet.'
        return
      }
      throw new Error(`Failed to fetch release: ${response.statusText}`)
    }

    const data: Release = await response.json()
    release.value = data

    // Parse assets
    const platformDownloads: PlatformDownload[] = []
    for (const asset of data.assets) {
      const info = getAssetInfo(asset)
      if (info) {
        platformDownloads.push(info)
      }
    }

    // Sort: macOS first, then Windows, then Linux
    platformDownloads.sort((a, b) => {
      const order = { '🍎': 0, '🪟': 1, '🐧': 2 }
      return (order[a.icon as keyof typeof order] ?? 3) - (order[b.icon as keyof typeof order] ?? 3)
    })

    downloads.value = platformDownloads
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to fetch release'
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  fetchRelease()
})

const userPlatform = ref<string>('unknown')
onMounted(() => {
  userPlatform.value = detectPlatform()
})
</script>

<template>
  <div class="download-section">
    <!-- Loading state -->
    <div v-if="loading" class="loading">
      Loading release information...
    </div>

    <!-- Error state -->
    <div v-else-if="error" class="error">
      <p>{{ error }}</p>
      <p class="error-hint">
        Check the
        <a :href="`https://github.com/${REPO_OWNER}/${REPO_NAME}/releases`" target="_blank">
          GitHub Releases page
        </a>
        for all downloads.
      </p>
    </div>

    <!-- Downloads -->
    <template v-else-if="release">
      <div class="version-info">
        <span class="version">{{ release.tag_name }}</span>
        <span class="date">
          Released {{ new Date(release.published_at).toLocaleDateString() }}
        </span>
      </div>

      <div class="download-buttons" v-if="downloads.length > 0">
        <a
          v-for="download in downloads"
          :key="download.url"
          :href="download.url"
          class="download-button"
          :class="{ primary: download.icon === '🍎' && userPlatform === 'macos' ||
                            download.icon === '🪟' && userPlatform === 'windows' ||
                            download.icon === '🐧' && userPlatform === 'linux' }"
        >
          <span class="icon">{{ download.icon }}</span>
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

.error {
  padding: 1.5rem;
  border-radius: 8px;
  background: var(--vp-c-danger-soft);
  color: var(--vp-c-danger-1);
}

.error-hint {
  margin-top: 0.5rem;
  font-size: 0.875rem;
}

.error-hint a {
  color: var(--vp-c-brand-1);
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
  font-size: 1.5rem;
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
