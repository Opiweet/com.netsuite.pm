<template>
  <div class="app-shell">
    <!-- Sidebar -->
    <aside class="sidebar" :class="{ collapsed: isCollapsed }">
      <!-- Logo -->
      <div class="sidebar-logo" :class="{ expanded: !isCollapsed }">
        <transition name="logo-mini">
          <div v-if="isCollapsed" class="logo-mark logo-mini">
            <img
              class="logo-img"
              src="https://11980272.app.netsuite.com/c.11980272/suiteapp/com.netsuite.pm/project-phase/dist/franklin-bio-labs-logo-small.png"
              alt="Franklin Bio Labs"
            />
          </div>
        </transition>
        <transition name="logo-big">
          <div v-if="!isCollapsed" class="logo-stack">
            <div class="logo-mark big">
              <img class="logo-img" :src="logoLargeSrc" alt="Franklin Bio Labs" />
            </div>
            <div class="logo-label">
              <div class="logo-sub">PROJECT & REVENUE MANAGEMENT</div>
            </div>
          </div>
        </transition>
      </div>

      <!-- Toggle button -->
      <button class="toggle-btn" @click="toggleSidebarCollapsed">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <polyline v-if="isCollapsed" points="9 18 15 12 9 6" />
          <polyline v-else points="15 18 9 12 15 6" />
        </svg>
      </button>

      <!-- Nav -->
      <nav class="sidebar-nav">
        <RouterLink
          v-for="item in navItems"
          :key="item.label"
          :to="item.to"
          class="nav-item"
          :class="{ active: isActive(item) }"
        >
          <span class="nav-icon">
            <component :is="item.icon" class="nav-icon-svg" aria-hidden="true" />
          </span>
          <transition name="fade">
            <span v-if="!isCollapsed" class="nav-label">{{ item.label }}</span>
          </transition>
          <span v-if="isCollapsed" class="nav-tooltip">{{ item.label }}</span>
          <transition name="fade">
            <span v-if="!isCollapsed && item.children" class="nav-chevron">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                width="14"
                height="14"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </span>
          </transition>
        </RouterLink>
      </nav>

      <!-- Bottom -->
      <div class="sidebar-bottom">
        <!-- <button
          type="button"
          class="theme-toggle"
          :class="{ 'theme-toggle--on': theme.isDark, 'theme-toggle--collapsed': isCollapsed }"
          @click="theme.toggle()"
          :aria-pressed="theme.isDark"
          aria-label="Toggle night mode"
        >
          <span class="theme-toggle-icon" aria-hidden="true">
            <i
              class="mdi"
              :class="theme.isDark ? 'mdi-weather-night' : 'mdi-white-balance-sunny'"
            ></i>
          </span>
          <transition name="fade"> </transition>
          <span v-if="!isCollapsed" class="theme-toggle-switch" aria-hidden="true">
            <span class="theme-toggle-knob"></span>
          </span>
        </button> -->

        <div class="user-row">
          <button
            type="button"
            class="user-avatar user-trigger"
            aria-label="User details"
            @click="toggleUserPopover"
          >
            {{ userInitials }}
          </button>
          <transition name="fade">
            <button
              v-if="!isCollapsed"
              type="button"
              class="user-name user-trigger"
              aria-label="User details"
              @click="toggleUserPopover"
            >
              {{ userProfile.name }}
            </button>
          </transition>
          <!-- Theme toggle: inline, fades away when sidebar collapses -->
          <div class="power-wrap" :class="{ 'power-wrap--ghost': isCollapsed }">
            <button
              class="power-btn"
              type="button"
              aria-label="Toggle theme"
              @click="theme.toggle()"
            >
              <i
                class="mdi"
                :class="theme.isDark ? 'mdi-white-balance-sunny' : 'mdi-weather-night'"
              ></i>
            </button>
            <span class="power-tooltip" role="tooltip">
              {{ theme.isDark ? 'Light mode' : 'Dark mode' }}
            </span>
          </div>
        </div>
        <!-- Theme toggle: below avatar, fades in when sidebar collapses -->
        <div class="power-below" :class="{ 'power-below--visible': isCollapsed }">
          <div class="power-wrap">
            <button
              class="power-btn"
              type="button"
              aria-label="Toggle theme"
              @click="theme.toggle()"
            >
              <i
                class="mdi"
                :class="theme.isDark ? 'mdi-white-balance-sunny' : 'mdi-weather-night'"
              ></i>
            </button>
            <span class="power-tooltip power-tooltip--above" role="tooltip">
              {{ theme.isDark ? 'Light mode' : 'Dark mode' }}
            </span>
          </div>
        </div>
        <transition name="user-pop">
          <div
            v-if="userPopoverOpen"
            ref="userPopoverEl"
            class="user-popover"
            role="dialog"
            aria-label="User details"
          >
            <div class="user-popover-avatar" aria-hidden="true">{{ userInitials }}</div>
            <div class="user-popover-name">{{ userProfile.name }}</div>
            <div class="user-popover-email">{{ userProfile.email }}</div>
            <div class="user-popover-pill">Role: {{ userProfile.role }}</div>
          </div>
        </transition>
      </div>

      <div class="sidebar-backhome">
        <button
          type="button"
          class="nav-item nav-item--backhome nav-item--backhome-btn"
          @click="handleBackToNetSuiteClick"
        >
          <span class="nav-icon" aria-hidden="true">
            <HomeIcon class="nav-icon-svg" />
          </span>
          <transition name="fade">
            <span v-if="!isCollapsed" class="nav-label">Back to NetSuite</span>
          </transition>
          <span v-if="isCollapsed" class="nav-tooltip">Back to NetSuite</span>
        </button>
      </div>
    </aside>

    <!-- Main -->
    <div class="main-wrap" @click="handleMainWrapClick">
      <!-- Topbar -->
      <header class="topbar">
        <button
          v-if="backRouteName"
          class="topbar-back"
          type="button"
          @click="goBack"
          aria-label="Back"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.2"
            stroke-linecap="round"
            stroke-linejoin="round"
            width="18"
            height="18"
            aria-hidden="true"
          >
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="11 18 5 12 11 6" />
          </svg>
        </button>
        <div class="topbar-titles">
          <div class="topbar-title">{{ pageTitle }}</div>
          <div v-if="pageSubtitle" class="topbar-subtitle">{{ pageSubtitle }}</div>
        </div>
        <div class="topbar-actions">
          <button
            v-for="action in topbar.actions"
            :key="action.key"
            type="button"
            class="topbar-action-btn"
            :class="`topbar-action-btn--${action.variant || 'secondary'}`"
            :disabled="action.loading"
            @click="action.onClick && action.onClick()"
          >
            <span v-if="action.loading" class="topbar-spinner" aria-hidden="true"></span>
            <component v-else-if="action.icon" :is="action.icon" class="topbar-action-icon" />
            <span class="topbar-action-label">{{ action.label }}</span>
          </button>
        </div>
      </header>

      <!-- Page content slot -->
      <main class="page-content">
        <slot />
      </main>
    </div>

    <AppModal
      v-model="backToNetSuiteConfirmOpen"
      title="Leave portal?"
      subtitle="This will leave the Project & Revenue Management portal and return you to NetSuite."
      variant="warning"
      icon="home"
      :actions="[
        { label: 'Cancel', variant: 'ghost', onClick: closeBackToNetSuiteConfirm },
        { label: 'Back to NetSuite', variant: 'primary', onClick: confirmBackToNetSuite },
      ]"
    />

    <AppToast />
  </div>
</template>

<script setup>
import { ref, computed, markRaw, onMounted, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useTopbarStore } from '@/stores/topbar'
import { useThemeStore } from '@/stores/theme'
import { useUiStore } from '@/stores/ui'
import { useProjectsStore } from '@/stores/projects'
import AppModal from '@/components/AppModal.vue'
import AppToast from '@/components/AppToast.vue'
import BriefcaseIcon from '@/components/icons/BriefcaseIcon.vue'
import TableIcon from '@/components/icons/TableIcon.vue'
import HomeIcon from '@/components/icons/HomeIcon.vue'
import UploadIcon from '@/components/icons/UploadIcon.vue'
import LockIcon from '@/components/icons/LockIcon.vue'

const route = useRoute()
const router = useRouter()
const topbar = useTopbarStore()
const theme = useThemeStore()
theme.init()
const ui = useUiStore()
ui.init()
const projectsStore = useProjectsStore()

const isCollapsed = computed(() => ui.sidebarCollapsed)

const logoLargeSrc = computed(() =>
  theme.isDark
    ? 'https://11980272.app.netsuite.com/c.11980272/suiteapp/com.netsuite.pm/project-phase/dist/franklin-bio-labs-logo-light.webp'
    : 'https://11980272.app.netsuite.com/c.11980272/suiteapp/com.netsuite.pm/project-phase/dist/franklin-bio-labs-logo.webp',
)

const netsuiteHomeUrl = computed(() => {
  const fromInit = projectsStore.initData?.links?.netsuiteHomeUrl
  if (typeof fromInit === 'string' && fromInit.trim()) return fromInit.trim()
  return 'https://11980272.app.netsuite.com/app/center/card.nl?sc='
})

onMounted(() => {
  if (!projectsStore.initData?.fetchedAt && !projectsStore.initDataInFlight) {
    projectsStore.fetchInitData().catch(() => {})
  }
})

const userProfile = computed(() => {
  const user = projectsStore.initData?.user || null
  return {
    name: user?.name || '—',
    email: user?.email || '',
    role: user?.roleName || '—',
  }
})
const userPopoverOpen = ref(false)
const userPopoverEl = ref(null)
const backToNetSuiteConfirmOpen = ref(false)

const userInitials = computed(() => {
  const parts = String(userProfile.value.name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  const initials = parts
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
  return initials.toUpperCase() || '—'
})

const navItems = computed(() => {
  const items = [
    {
      label: 'Projects',
      to: '/',
      icon: markRaw(BriefcaseIcon),
    },
    {
      label: 'Revenue Management',
      to: '/revenue-management',
      icon: markRaw(TableIcon),
    },
    {
      label: 'Bulk Upload',
      to: '/projects/bulk-upload',
      icon: markRaw(UploadIcon),
    },
  ]
  const globalCaps = Array.isArray(projectsStore.initData?.authz?.capabilities)
    ? projectsStore.initData.authz.capabilities.map(String)
    : []
  if (globalCaps.includes('rbac.manage')) {
    items.push({
      label: 'RBAC Admin',
      to: '/admin/rbac',
      icon: markRaw(LockIcon),
    })
  }
  return items
})

function isProjectsNavActive(path) {
  if (path === '/') return true
  return path.startsWith('/projects/') && !path.startsWith('/projects/bulk-upload')
}

const activeItem = computed(() =>
  navItems.value.find((i) => {
    if (i.to === '/') return isProjectsNavActive(route.path)
    return route.path === i.to || route.path.startsWith(`${i.to}/`)
  }),
)

const pageTitle = computed(
  () => topbar.title || route.meta?.title || activeItem.value?.label || 'Dashboard',
)
const pageSubtitle = computed(() => topbar.subtitle || route.meta?.subtitle || '')
const backRouteName = computed(() => topbar.backRouteName || null)

function goBack() {
  if (backRouteName.value) router.push({ name: backRouteName.value })
}

function isActive(item) {
  if (item.to === '/') return isProjectsNavActive(route.path)
  return route.path === item.to || route.path.startsWith(`${item.to}/`)
}

function toggleUserPopover() {
  userPopoverOpen.value = !userPopoverOpen.value
}

function closeUserPopover() {
  userPopoverOpen.value = false
}

function toggleSidebarCollapsed() {
  ui.toggleSidebarCollapsed()
  closeUserPopover()
}

function handleMainWrapClick() {
  if (isCollapsed.value) return
  ui.setSidebarCollapsed(true)
  closeUserPopover()
}

function handleBackToNetSuiteClick() {
  backToNetSuiteConfirmOpen.value = true
  closeUserPopover()
}

function closeBackToNetSuiteConfirm() {
  backToNetSuiteConfirmOpen.value = false
}

function confirmBackToNetSuite() {
  closeBackToNetSuiteConfirm()
  window.location.href = netsuiteHomeUrl.value
}

function handleDocPointerDown(event) {
  if (!userPopoverOpen.value) return
  const target = event.target
  if (!(target instanceof Node)) return
  const popover = userPopoverEl.value
  if (popover && popover.contains(target)) return
  const trigger = target.closest?.('.user-trigger')
  if (trigger) return
  closeUserPopover()
}

function handleDocKeyDown(event) {
  if (event.key !== 'Escape') return
  if (backToNetSuiteConfirmOpen.value) closeBackToNetSuiteConfirm()
  if (userPopoverOpen.value) closeUserPopover()
}

onMounted(() => {
  document.addEventListener('pointerdown', handleDocPointerDown)
  document.addEventListener('keydown', handleDocKeyDown)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', handleDocPointerDown)
  document.removeEventListener('keydown', handleDocKeyDown)
})
</script>

<style scoped>
.app-shell {
  display: flex;
  height: 100vh;
  width: 100vw;
  background: var(--shell-bg, #f7faf4);
  font-family: 'Outfit', sans-serif;
  overflow: hidden;
}

/* ── Sidebar ── */
.sidebar {
  width: 240px;
  min-width: 240px;
  display: flex;
  flex-direction: column;
  position: relative;
  background: var(--sidebar-bg, transparent);
  transition:
    width 0.28s cubic-bezier(0.4, 0, 0.2, 1),
    min-width 0.28s cubic-bezier(0.4, 0, 0.2, 1);
  z-index: 10;
}
.sidebar.collapsed {
  width: 64px;
  min-width: 64px;
}

/* Logo */
.sidebar-logo {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 16px;
  border-bottom: 1px solid var(--sidebar-divider, #e1e6dc);
  min-height: 90px;
  overflow: hidden;
  position: relative;
}
.sidebar-logo.expanded {
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
}
.logo-stack {
  position: absolute;
  left: 16px;
  right: 16px;
  top: 16px;
  bottom: 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: start;
  justify-content: flex-start;
  transform-origin: left center;
  will-change: transform, opacity;
}
.logo-mini {
  /* position: absolute; */
  left: 16px;
  right: 16px;
  top: 16px;
  bottom: 16px;
  border: 1px solid #00a36b;
  padding: 0.3rem;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  transform-origin: left center;
  will-change: transform, opacity;
}
.logo-mark {
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  /* background: #ffffff;
  border: 1px solid #e1e6dc; */
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: start;
}
.logo-mark.big {
  width: 100%;
  height: 40px;
  border-radius: 12px;
  background: transparent;
  border: none;
}
.logo-img {
  /* width: 100%; */
  height: 100%;
  object-fit: contain;
  /* border-radius: 6px; */
}
.logo-label {
  line-height: normal;
  overflow: hidden;
  white-space: nowrap;
}
.logo-title {
  font-size: 14px;
  font-weight: 700;
  color: #2f3b2f;
  letter-spacing: 0.05em;
}
.logo-sub {
  font-size: 9px;
  font-weight: 500;
  color: #7b8a7b;
  letter-spacing: 0.12em;
  margin-top: 1px;
}

/* Toggle */
.toggle-btn {
  position: absolute;
  top: 75px;
  right: -12px;
  width: 28px;
  height: 28px;
  background: var(--toggle-bg, var(--dark));
  border: 1px solid var(--toggle-border, rgba(255, 255, 255, 0.16));
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: var(--toggle-fg, #ffffff);
  z-index: 20;
  box-shadow: var(--toggle-shadow, none);
  transition:
    background 0.2s,
    border-color 0.2s,
    box-shadow 0.2s,
    transform 0.2s;
}
.toggle-btn:hover {
  background: var(--toggle-hover-bg, var(--accent));
  border-color: rgba(0, 165, 106, 0.45);
  box-shadow: 0 10px 22px rgba(0, 165, 106, 0.28);
  filter: brightness(0.95);
}
.toggle-btn:active {
  transform: translateY(1px);
}
.toggle-btn:focus-visible {
  outline: 2px solid rgba(0, 165, 106, 0.55);
  outline-offset: 2px;
}
.toggle-btn svg {
  width: 12px;
  height: 12px;
}

/* Nav */
.sidebar-nav {
  flex: 1;
  padding: 32px 8px 16px;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  overflow: hidden;
}
.sidebar.collapsed .sidebar-nav {
  overflow: visible;
}
.nav-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 10px;
  border-radius: 8px;
  text-decoration: none;
  color: var(--sidebar-text, #6c7a6c);
  transition:
    background 0.15s,
    color 0.15s;
  white-space: nowrap;
  overflow: hidden;
  min-height: 30px;
  position: relative;
}
.theme-toggle {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 5px;
  border-radius: 14px;
  border: 1px solid var(--border-strong, rgba(255, 255, 255, 0.12));
  background: var(--surface-2, rgba(255, 255, 255, 0.06));
  color: var(--sidebar-text-strong, #1f2b1f);
  cursor: pointer;
  font: inherit;
  position: relative;
  transition:
    background 0.15s,
    border-color 0.15s,
    transform 0.15s,
    width 0.15s,
    box-shadow 0.15s;
}
.theme-toggle:hover {
  background: var(--surface-3, rgba(255, 255, 255, 0.1));
  border-color: rgba(0, 165, 106, 0.35);
}
.theme-toggle:active {
  transform: translateY(1px);
}
.theme-toggle:focus-visible {
  outline: 2px solid rgba(0, 165, 106, 0.55);
  outline-offset: 2px;
}
.theme-toggle-icon {
  width: 36px;
  height: 36px;
  border-radius: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--sidebar-icon-bg, rgba(255, 255, 255, 0.08));
  color: var(--sidebar-icon-fg, #2e2e2e);
  flex-shrink: 0;
}
.theme-toggle-icon .mdi {
  font-size: 18px;
}
.theme-toggle-label {
  font-size: 13.5px;
  font-weight: 600;
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.theme-toggle-switch {
  width: 44px;
  height: 24px;
  border-radius: 999px;
  border: 1px solid var(--border-strong, rgba(255, 255, 255, 0.14));
  background: rgba(0, 0, 0, 0.12);
  display: inline-flex;
  align-items: center;
  padding: 2px;
  flex-shrink: 0;
  transition:
    background 0.15s,
    border-color 0.15s;
}
.theme-toggle-knob {
  width: 18px;
  height: 18px;
  border-radius: 999px;
  background: var(--surface-1, #ffffff);
  box-shadow: 0 6px 14px rgba(0, 0, 0, 0.22);
  transform: translateX(0);
  transition: transform 0.18s ease;
}
.theme-toggle--on {
  background: rgba(0, 165, 106, 0.12);
  border-color: rgba(0, 165, 106, 0.35);
}
.theme-toggle--on .theme-toggle-icon {
  background: rgba(0, 165, 106, 0.18);
  color: var(--accent);
}
.theme-toggle--on .theme-toggle-switch {
  background: rgba(0, 165, 106, 0.28);
  border-color: rgba(0, 165, 106, 0.4);
}
.theme-toggle--on .theme-toggle-knob {
  transform: translateX(20px);
}
.theme-toggle--collapsed {
  width: 48px;
  /* height: 48px; */
  border-radius: 16px;
}
.theme-toggle--collapsed .theme-toggle-label,
.theme-toggle--collapsed .theme-toggle-switch {
  display: none;
}
.theme-toggle--collapsed .theme-toggle-icon {
  width: 36px;
  height: 36px;
}
.sidebar.collapsed .nav-item {
  overflow: visible;
}
.nav-item:hover {
  background: var(--sidebar-item-hover-bg, #e9efe4);
  color: var(--sidebar-text-strong, #3a4b3a);
}
.nav-item.active {
  background: var(--sidebar-item-active-bg, #dfe8d9);
  color: var(--sidebar-text-strong, #1f2b1f);
}
.nav-icon {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  font-size: 1.4rem;
  /* border: 1px solid #e2e2e2; */
  border-radius: 5px;
  background: var(--sidebar-icon-bg, #dfdfdf);
  color: var(--sidebar-icon-fg, #2e2e2e);
}
.nav-icon-svg {
  width: 20px;
  height: 20px;
}
.nav-tooltip {
  position: absolute;
  left: 52px;
  top: 50%;
  transform: translateY(-50%) translateX(-6px);
  background: var(--tooltip-bg, var(--sidebar-tooltip-bg, #1f2b1f));
  color: var(--tooltip-fg, #ffffff);
  border: 1px solid var(--tooltip-border, rgba(255, 255, 255, 0.08));
  padding: 6px 10px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.01em;
  white-space: nowrap;
  opacity: 0;
  pointer-events: none;
  z-index: 999;
  box-shadow: var(--tooltip-shadow, 0 8px 18px rgba(15, 23, 42, 0.18));
  transition:
    opacity 0.12s ease,
    transform 0.12s ease;
}
.sidebar.collapsed .nav-item:hover .nav-tooltip {
  opacity: 1;
  transform: translateY(-50%) translateX(0);
}
.nav-item.active .nav-icon {
  color: #ffffff;
  background: var(--accent);
}

.nav-item.active .nav-label {
  color: var(--accent);
}

.nav-label {
  font-size: 13.5px;
  font-weight: 500;
  text-align: start;
  flex: 1;
}
.nav-chevron {
  margin-left: auto;
  opacity: 0.5;
  display: flex;
  align-items: center;
}

/* Bottom */
.sidebar-bottom {
  padding: 12px 8px 12px;
  border-top: 1px solid var(--sidebar-divider, #e1e6dc);
  position: relative;
  overflow: visible;
  display: flex;
  flex-direction: column;
  align-items: stretch;
}
.user-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 8px;
  border-radius: 8px;
  overflow: visible;
}
.user-trigger {
  cursor: pointer;
}
.user-avatar {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--sidebar-item-hover-bg, #e9efe4);
  color: var(--sidebar-user-fg, #516251);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.05em;
}
.user-name {
  font-size: 12.5px;
  font-weight: 500;
  color: var(--sidebar-user-fg, #516251);
  white-space: nowrap;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
}
.user-avatar,
.user-name {
  border: none;
  padding: 0;
  background: transparent;
  text-align: left;
}
.user-avatar {
  background: var(--sidebar-item-hover-bg, #e9efe4);
}
.user-avatar:focus-visible,
.user-name:focus-visible {
  outline: 2px solid rgba(0, 165, 106, 0.45);
  outline-offset: 2px;
  border-radius: 10px;
}

.user-pop-enter-active,
.user-pop-leave-active {
  transition:
    opacity 0.16s ease,
    transform 0.16s ease;
}
.user-pop-enter-from,
.user-pop-leave-to {
  opacity: 0;
  transform: translateY(6px);
}
.user-pop-enter-to,
.user-pop-leave-from {
  opacity: 1;
  transform: translateY(0);
}
.user-popover {
  position: absolute;
  left: 10px;
  right: 10px;
  bottom: 64px;
  background: var(--surface-1, #ffffff);
  border: 1px solid var(--sidebar-divider, #e1e6dc);
  border-radius: 14px;
  padding: 15px 12px;
  box-shadow: 0 18px 40px rgba(15, 23, 42, 0.16);
  z-index: 30;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  min-width: 245px;
}
.sidebar.collapsed .user-popover {
  left: 10px;
  width: 240px;
}
.user-popover-avatar {
  width: 48px;
  height: 48px;
  border-radius: 999px;
  /* background: #075e45; */
  /* color: #ffffff; */
  display: grid;
  place-items: center;
  font-weight: 800;
  letter-spacing: 0.06em;
  font-size: 18px;
  background: #e9efe4;
  color: #516251;
  /* box-shadow: 0 12px 22px rgba(15, 23, 42, 0.12); */
}
.user-popover-name {
  margin-top: 14px;
  font-size: 16px;
  font-weight: 600;
  color: var(--sidebar-text-strong, #1f2b1f);
  line-height: 1.15;
}
.user-popover-email {
  /* margin-top: 6px; */
  font-size: 12px;
  color: var(--sidebar-text, #6b7768);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}
.user-popover-pill {
  margin-top: 15px;
  height: 25px;
  display: inline-flex;
  align-items: center;
  padding: 0 14px;
  border-radius: 999px;
  background: var(--surface-3, rgba(15, 23, 42, 0.06));
  border: 1px solid var(--border-strong, rgba(15, 23, 42, 0.08));
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--sidebar-text, rgba(15, 23, 42, 0.55));
}
.power-btn {
  background: none;
  border: none;
  color: var(--sidebar-icon-fg, #3d5c3d);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  width: 100%;
  height: 100%;
  flex-shrink: 0;
  transition: color 0.15s;
}
.power-btn .mdi {
  font-size: 15px;
  line-height: 1;
}
.power-btn:hover {
  color: var(--accent, #00a56a);
}
.power-wrap {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  background: var(--sidebar-item-hover-bg, #e9efe4);
  border: 1px solid rgba(0, 0, 0, 0.07);
  color: var(--sidebar-icon-fg, #3d5c3d);
  flex-shrink: 0;
  transition:
    opacity 0.22s ease,
    width 0.28s cubic-bezier(0.4, 0, 0.2, 1),
    background 0.15s ease;
}
.power-wrap:hover {
  background: var(--sidebar-item-active-bg, #dce8d5);
  border-color: rgba(0, 0, 0, 0.1);
}
:root[data-theme='dark'] .power-wrap {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.06);
}
:root[data-theme='dark'] .power-wrap:hover {
  background: rgba(255, 255, 255, 0.13);
}
:root[data-theme='dark'] .power-btn {
  color: #a8c5a0;
}
/* Ghost: inline instance collapses away when sidebar collapses */
.power-wrap--ghost {
  opacity: 0;
  width: 0;
  pointer-events: none;
  overflow: hidden;
}
/* Container for the below-avatar instance */
.power-below {
  display: flex;
  justify-content: center;
  overflow: hidden;
  max-height: 0;
  opacity: 0;
  pointer-events: none;
  transition:
    max-height 0.28s cubic-bezier(0.4, 0, 0.2, 1),
    opacity 0.22s ease;
}
.power-below--visible {
  max-height: 44px;
  opacity: 1;
  pointer-events: auto;
}
.power-tooltip {
  position: absolute;
  right: 0;
  bottom: calc(100% + 8px);
  transform: translateY(4px);
  opacity: 0;
  pointer-events: none;
  background: var(--tooltip-bg, var(--sidebar-tooltip-bg, #1f2b1f));
  color: var(--tooltip-fg, #ffffff);
  border: 1px solid var(--tooltip-border, rgba(255, 255, 255, 0.08));
  padding: 6px 10px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.01em;
  white-space: nowrap;
  z-index: 10001;
  box-shadow: var(--tooltip-shadow, 0 8px 18px rgba(15, 23, 42, 0.18));
  transition:
    opacity 0.12s ease,
    transform 0.12s ease;
}
.power-wrap:hover .power-tooltip,
.power-btn:focus-visible + .power-tooltip {
  opacity: 1;
  transform: translateY(0);
}
/* Tooltip for below-avatar instance: show above the button */
.power-tooltip--above {
  right: auto;
  left: 50%;
  transform: translate(-50%, 4px);
  bottom: calc(100% + 8px);
}
.power-wrap:hover .power-tooltip--above,
.power-btn:focus-visible + .power-tooltip--above {
  transform: translate(-50%, 0);
}

.sidebar-backhome {
  padding: 12px 14px 16px;
  border-top: 1px solid var(--sidebar-divider, #e1e6dc);
}
.sidebar-backhome .nav-icon {
  padding-bottom: 3px;
  background: transparent;
  width: 16px;
  height: 16px;
}

.sidebar-backhome .nav-label {
  font-size: 12px;
  font-weight: 500;
  line-height: normal;
}

.nav-item--backhome {
  width: 100%;
  justify-content: center;
  gap: 7px;
}
.nav-item--backhome-btn {
  border: 0;
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.nav-item--backhome .nav-label {
  flex: 0 0 auto;
  text-align: center;
}
.nav-item--backhome:focus-visible {
  outline: 2px solid rgba(0, 165, 106, 0.55);
  outline-offset: 2px;
}

/* ── Main ── */
.main-wrap {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: var(--surface-1, #ffffff);
  border-radius: 12px;
  overflow: hidden;
  margin: 8px 8px 8px 0;
  border: 1px solid var(--surface-border, #dcdcdc);
  /* box-shadow: -4px 0 32px rgba(0,0,0,0.2); */
}

/* Topbar */
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 28px;
  min-height: 80px;
  background: var(--topbar-bg, #fff);
  border-bottom: 1px solid var(--topbar-border, #e2e8f0);
  flex-shrink: 0;
  gap: 16px;
  margin-bottom: 1.5rem;
}
.topbar-back {
  width: 34px;
  height: 34px;
  border-radius: 8px;
  border: 1px solid var(--sidebar-divider, #e1e6dc);
  background: var(--surface-1, #ffffff);
  color: var(--sidebar-text-strong, #2f3b2f);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition:
    background 0.15s,
    color 0.15s,
    border-color 0.15s;
  flex-shrink: 0;
}
.topbar-back:hover {
  background: var(--sidebar-item-hover-bg, #f4f8f1);
  border-color: var(--sidebar-item-active-bg, #cfd8c8);
}
.topbar-back svg {
  width: 18px;
  height: 18px;
}
.topbar-titles {
  display: flex;
  flex-direction: column;
  align-items: start;
  flex: 1;
  gap: 2px;
}
.topbar-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}
.topbar-action-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 40px;
  padding: 0 12px;
  border-radius: 10px;
  border: 1px solid var(--topbar-action-border, var(--border-strong, #e1e6dc));
  background: var(--topbar-action-bg, var(--surface-1, #ffffff));
  color: var(--topbar-action-fg, var(--text-h, #243224));
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}
.topbar-action-btn:hover {
  transform: translateY(-1px);
}
.topbar-action-btn:not(.topbar-action-btn--primary):not(.topbar-action-btn--error):hover {
  background: var(--topbar-action-hover-bg, var(--surface-3, #eef2ec));
}
.topbar-action-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.topbar-action-btn--primary {
  background: var(--topbar-primary-bg, var(--dark));
  color: #ffffff;
  border-color: transparent;
}
.topbar-action-btn--primary:hover {
  background:
    linear-gradient(rgba(255, 255, 255, 0.14), rgba(255, 255, 255, 0.14)),
    var(--topbar-primary-bg, var(--dark));
}
.topbar-action-btn--ghost {
  background: transparent;
  border-color: transparent;
  color: var(--topbar-action-fg, var(--text-h, #2f3b2f));
}
.topbar-action-btn--ghost:hover {
  background: var(--topbar-action-hover-bg, #eef2ec);
  box-shadow: none;
}
.topbar-action-btn--outline {
  background: transparent;
  border-color: var(--topbar-outline-border, var(--text-h, #111827));
  color: var(--topbar-outline-fg, var(--text-h, #111827));
}
.topbar-action-btn--outline:hover {
  background: var(--topbar-outline-hover-bg, rgba(17, 24, 39, 0.06));
  box-shadow: none;
}
.topbar-action-btn--warning {
  background: transparent;
  border-color: var(--orange);
  color: var(--orange);
}
.topbar-action-btn--warning:hover {
  background: rgba(233, 118, 43, 0.12);
  box-shadow: none;
}
.topbar-action-btn--error {
  background: #dc2626;
  color: #ffffff;
  border-color: transparent;
}
.topbar-action-btn--error:hover {
  background: linear-gradient(rgba(255, 255, 255, 0.14), rgba(255, 255, 255, 0.14)), #dc2626;
}
.topbar-action-icon {
  width: 16px;
  height: 16px;
}
.topbar-spinner {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 2px solid var(--border-strong, #cfd8c8);
  border-top-color: var(--topbar-action-fg, #243224);
  animation: topbar-spin 0.8s linear infinite;
}
.topbar-action-btn--primary .topbar-spinner,
.topbar-action-btn--error .topbar-spinner {
  border-color: rgba(255, 255, 255, 0.45);
  border-top-color: #ffffff;
}
@keyframes topbar-spin {
  to {
    transform: rotate(360deg);
  }
}
.topbar-title {
  font-size: 20px;
  font-weight: 600;
  color: var(--topbar-title-fg, var(--text-h, #243224));
}
.topbar-subtitle {
  text-align: start;
  line-height: normal;
  font-size: 14px;
  color: var(--topbar-subtitle-fg, var(--text, #929c92));
}
.topbar-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}
.notif-btn {
  position: relative;
  background: none;
  border: none;
  color: #64748b;
  cursor: pointer;
  display: flex;
  align-items: center;
  padding: 4px;
  transition: color 0.15s;
}
.notif-btn:hover {
  color: #1e293b;
}
.notif-badge {
  position: absolute;
  top: 0;
  right: 0;
  width: 16px;
  height: 16px;
  background: #2dd4bf;
  color: #0f172a;
  border-radius: 50%;
  font-size: 9px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* Page content */
.page-content {
  overflow-y: auto;
  padding: 0 24px;
  width: 100%;
  max-width: 1920px;
  margin: 0 auto;
  box-sizing: border-box;
}

/* Transition */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.18s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/* Logo swap animation */
.logo-big-enter-active,
.logo-big-leave-active,
.logo-mini-enter-active,
.logo-mini-leave-active {
  transition:
    opacity 0.28s cubic-bezier(0.22, 1, 0.36, 1),
    transform 0.28s cubic-bezier(0.22, 1, 0.36, 1);
}
.logo-big-enter-from,
.logo-big-leave-to {
  opacity: 0;
  transform: scale(0.92) translateZ(0);
}
.logo-mini-enter-from,
.logo-mini-leave-to {
  opacity: 0;
  transform: scale(0.85) translateZ(0);
}
</style>
