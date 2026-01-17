import DefaultTheme from 'vitepress/theme'
import type { Theme } from 'vitepress'
import { h } from 'vue'
import ThemeSwitcher from './ThemeSwitcher.vue'
import GitHubLink from './GitHubLink.vue'
import './style.css'

export default {
  extends: DefaultTheme,
  Layout() {
    return h(DefaultTheme.Layout, null, {
      'nav-bar-content-after': () => h('div', { class: 'nav-icons' }, [
        h(GitHubLink),
        h(ThemeSwitcher),
      ]),
    })
  },
} satisfies Theme
