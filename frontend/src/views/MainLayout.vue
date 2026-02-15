<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { authService, userService } from '@/services/api'
import { Button } from '@/components/ui/button'
import { filterAdminMenuTreeByFeatureFlags, getFallbackAdminMenuTree, normalizeAdminMenuTree, type AdminMenuNode } from '@/lib/adminMenus'
import { Menu, X, LogOut, ChevronRight, Github } from 'lucide-vue-next'
import { useBreakpoints } from '@vueuse/core'
import { useAppConfigStore } from '@/stores/appConfig'
import { useAnnouncementsStore } from '@/stores/announcements'
import AnnouncementBell from '@/components/AnnouncementBell.vue'
import { resolveFrontendAdminAvatarUrl } from '@/lib/frontendAvatars'

const router = useRouter()
const route = useRoute()
const appConfigStore = useAppConfigStore()
const announcementsStore = useAnnouncementsStore()

const currentUser = ref(authService.getCurrentUser())
// https://github.com/Kylsky/chatgpt-team-helper
const githubRepoUrl = 'https://github.com/Kylsky/chatgpt-team-helper'

let unreadPollTimer: number | null = null

const stopUnreadPolling = () => {
  if (unreadPollTimer === null) return
  clearInterval(unreadPollTimer)
  unreadPollTimer = null
}

const startUnreadPolling = () => {
  stopUnreadPolling()
  unreadPollTimer = window.setInterval(() => {
    announcementsStore.refreshUnreadCount()
  }, 60_000)
}

const syncCurrentUser = () => {
  currentUser.value = authService.getCurrentUser()
  if (!authService.isAuthenticated()) {
    announcementsStore.reset()
    stopUnreadPolling()
  }
}

onMounted(() => {
  window.addEventListener('auth-updated', syncCurrentUser)
  ;(async () => {
    try {
      const me = await userService.getMe()
      authService.setCurrentUser(me)
      await announcementsStore.refreshUnreadCount()
      startUnreadPolling()
    } catch (error: any) {
      if (error?.response?.status === 401 || error?.response?.status === 403) {
        announcementsStore.reset()
        stopUnreadPolling()
        authService.logout()
        router.push('/login')
      }
    }
  })()
})

onUnmounted(() => {
  stopUnreadPolling()
  window.removeEventListener('auth-updated', syncCurrentUser)
})

const menuTree = computed<AdminMenuNode[]>(() => {
  const user: any = currentUser.value
  const tree = normalizeAdminMenuTree(user?.adminMenus)
  const resolved = tree.length ? tree : getFallbackAdminMenuTree(user?.menus, user?.roles)
  return filterAdminMenuTreeByFeatureFlags(resolved, appConfigStore.features)
})

const findLabelByPath = (nodes: AdminMenuNode[], path: string): string | null => {
  for (const node of nodes) {
    if (node.path && node.path === path) return node.label
    if (node.children?.length) {
      const child = findLabelByPath(node.children, path)
      if (child) return child
    }
  }
  return null
}

const currentPageLabel = computed(() => {
  return findLabelByPath(menuTree.value, route.path) || 'Console'
})

const roleLabel = computed(() => {
  const user = currentUser.value
  const roles = Array.isArray(user?.roles) ? user.roles.map(String) : []
  if (roles.includes('super_admin')) return '超级管理员'
  return roles.length ? roles.join(', ') : '普通用户'
})

const breakpoints = useBreakpoints({
  laptop: 1024,
})

const isLaptop = breakpoints.greater('laptop')
const isSidebarOpen = ref(isLaptop.value)

const handleMenuClick = () => {
  if (!isLaptop.value) {
    isSidebarOpen.value = false
  }
}

const handleLogout = () => {
  announcementsStore.reset()
  stopUnreadPolling()
  authService.logout()
  router.push('/login')
}

const toggleSidebar = () => {
  isSidebarOpen.value = !isSidebarOpen.value
}

watch(() => route.path, () => {
  if (!isLaptop.value) { 
    isSidebarOpen.value = false
  }
})

const isActive = (path: string) => {
  return route.path === path
}

const isNodeActive = (node: AdminMenuNode): boolean => {
  if (node.path && isActive(node.path)) return true
  return Boolean(node.children?.some(isNodeActive))
}

const expandedGroups = ref<Record<string, boolean>>({})

const ensureGroupKeys = (nodes: AdminMenuNode[]) => {
  const next = { ...expandedGroups.value }
  const walk = (list: AdminMenuNode[]) => {
    for (const node of list) {
      if (node.children?.length) {
        if (next[node.key] === undefined) next[node.key] = true
        walk(node.children)
      }
    }
  }
  walk(nodes)
  expandedGroups.value = next
}

const expandActiveGroups = (nodes: AdminMenuNode[]) => {
  const next = { ...expandedGroups.value }
  const walk = (node: AdminMenuNode): boolean => {
    const active = isNodeActive(node)
    if (node.children?.length) {
      const childActive = node.children.some(walk)
      if (active || childActive) next[node.key] = true
      return active || childActive
    }
    return active
  }
  for (const node of nodes) walk(node)
  expandedGroups.value = next
}

watch(menuTree, (nodes) => {
  ensureGroupKeys(nodes)
  expandActiveGroups(nodes)
}, { immediate: true })

watch(() => route.path, () => {
  expandActiveGroups(menuTree.value)
})

const toggleGroup = (key: string) => {
  expandedGroups.value = {
    ...expandedGroups.value,
    [key]: !expandedGroups.value[key],
  }
}

const isGroupExpanded = (key: string) => {
  const value = expandedGroups.value[key]
  return value === undefined ? true : value
}

const userInitial = computed(() => {
  const username = String(currentUser.value?.username || 'A').trim()
  return (username.charAt(0) || 'A').toUpperCase()
})

const adminAvatarUrl = computed(() => resolveFrontendAdminAvatarUrl(appConfigStore.frontendAdminAvatarKey))
</script>

<template>
  <div class="relative min-h-screen overflow-hidden bg-[linear-gradient(180deg,#dff3ff_0%,#f4f7fc_38%,#f7f7f9_100%)]">
    <div class="pointer-events-none absolute -top-24 -left-20 h-80 w-80 rounded-full bg-[radial-gradient(circle_at_center,rgba(56,189,248,0.28),rgba(56,189,248,0))] blur-2xl float-slow" />
    <div class="pointer-events-none absolute top-1/3 -right-20 h-96 w-96 rounded-full bg-[radial-gradient(circle_at_center,rgba(14,165,233,0.2),rgba(14,165,233,0))] blur-2xl float-slower" />
    <div class="pointer-events-none absolute bottom-0 left-1/3 h-64 w-64 rounded-full bg-[radial-gradient(circle_at_center,rgba(250,204,21,0.16),rgba(250,204,21,0))] blur-2xl float-slow" />
    
    <!-- 绉诲姩绔伄缃?-->
    <div
      v-if="isSidebarOpen"
      class="fixed inset-0 z-30 bg-black/20 backdrop-blur-[2px] lg:hidden"
      @click="isSidebarOpen = false"
    />

    <!-- 渚ц竟鏍?-->
    <aside
      class="fixed inset-y-0 left-0 z-40 w-[280px] bg-white/75 backdrop-blur-2xl border-r border-white/80 shadow-[0_0_0_1px_rgba(255,255,255,0.65),0_18px_45px_rgba(15,23,42,0.08)] flex flex-col transition-transform duration-500 cubic-bezier(0.32, 0.72, 0, 1)"
      :class="isSidebarOpen ? 'translate-x-0' : '-translate-x-full'"
    >
      <!-- Logo 鍖哄煙 -->
      <div class="px-8 pt-8 pb-6">
        <div class="flex items-center gap-3 mb-2">
          <a
            :href="githubRepoUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="w-8 h-8 rounded-lg bg-gradient-to-br from-sky-500 to-cyan-400 flex items-center justify-center shadow-lg shadow-sky-500/30 transition-all hover:scale-105"
            aria-label="Open GitHub repository"
            title="GitHub"
            @click="handleMenuClick"
          >
            <Github class="w-5 h-5 text-white" />
          </a>
          <router-link to="/admin" class="text-xl font-semibold tracking-tight text-gray-900" @click="handleMenuClick">
            GPT Team Helper
          </router-link>
          <span class="inline-flex items-center rounded-full bg-sky-50 text-sky-700 border border-sky-100 px-2 py-0.5 text-[10px] font-semibold tracking-wide">
            Admin
          </span>
        </div>
        <p class="text-xs font-medium text-slate-400 pl-11">Management Console</p>
      </div>

      <!-- 瀵艰埅鑿滃崟 -->
      <nav class="flex-1 px-4 space-y-1 overflow-y-auto py-4 admin-scrollbar">
        <template v-for="item in menuTree" :key="item.key">
          <!-- Group -->
          <div v-if="item.children?.length" class="space-y-1">
            <div
              class="relative group flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-300"
              :class="isNodeActive(item)
                ? 'bg-white shadow-[0_8px_24px_rgba(15,23,42,0.12)] text-sky-600'
                : 'text-slate-500 hover:bg-white/90 hover:text-slate-900'"
            >
              <div
                class="absolute left-1 top-1/2 -translate-y-1/2 h-6 w-1 rounded-full transition-all duration-300"
                :class="isNodeActive(item) ? 'bg-sky-500 opacity-100' : 'bg-transparent opacity-0'"
              />
              <component
                :is="item.icon"
                class="w-5 h-5 transition-colors duration-300"
                :class="isNodeActive(item) ? 'text-sky-600' : 'text-slate-400 group-hover:text-slate-600'"
                :strokeWidth="3"
              />

              <router-link
                v-if="item.path"
                :to="item.path"
                class="flex-1 font-medium text-[15px]"
                :aria-current="isActive(item.path) ? 'page' : undefined"
                @click="handleMenuClick"
              >
                {{ item.label }}
              </router-link>
              <button
                v-else
                type="button"
                class="flex-1 text-left font-medium text-[15px]"
                @click="toggleGroup(item.key)"
              >
                {{ item.label }}
              </button>

              <button
                type="button"
                class="ml-auto p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/40 transition"
                @click.stop="toggleGroup(item.key)"
                aria-label="Toggle group"
              >
                <ChevronRight
                  class="w-4 h-4 transition-transform duration-300"
                  :class="isGroupExpanded(item.key) ? 'rotate-90' : ''"
                />
              </button>

              <div
                v-if="isNodeActive(item)"
                class="absolute right-3 w-1.5 h-1.5 rounded-full bg-sky-500"
              />
            </div>

            <div v-show="isGroupExpanded(item.key)" class="pl-6 space-y-1">
              <template v-for="child in item.children" :key="child.key">
                <router-link
                  v-if="child.path"
                  :to="child.path"
                  class="relative group flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all duration-300"
                  :class="isActive(child.path)
                    ? 'bg-white shadow-[0_8px_24px_rgba(15,23,42,0.12)] text-sky-600'
                    : 'text-slate-500 hover:bg-white/90 hover:text-slate-900'"
                  :aria-current="isActive(child.path) ? 'page' : undefined"
                  @click="handleMenuClick"
                >
                  <div
                    class="absolute left-1 top-1/2 -translate-y-1/2 h-5 w-1 rounded-full transition-all duration-300"
                    :class="isActive(child.path) ? 'bg-sky-500 opacity-100' : 'bg-transparent opacity-0'"
                  />
                  <component
                    :is="child.icon"
                    class="w-5 h-5 transition-colors duration-300"
                    :class="isActive(child.path) ? 'text-sky-600' : 'text-slate-400 group-hover:text-slate-600'"
                    :strokeWidth="3"
                  />
                  <span class="font-medium text-[14px]">{{ child.label }}</span>

                  <div
                    v-if="isActive(child.path)"
                    class="absolute right-3 w-1.5 h-1.5 rounded-full bg-sky-500"
                  />
                </router-link>

                <div
                  v-else
                  class="relative flex items-center gap-3 px-4 py-2.5 rounded-xl text-slate-400 bg-white/45 cursor-not-allowed"
                  title="Route not configured">
                  <component :is="child.icon" class="w-5 h-5" :strokeWidth="3" />
                  <span class="font-medium text-[14px]">{{ child.label }}</span>
                </div>
              </template>
            </div>
          </div>

          <!-- Leaf -->
          <template v-else>
            <router-link
              v-if="item.path"
              :to="item.path"
              class="relative group flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-300"
              :class="isActive(item.path)
                ? 'bg-white shadow-[0_8px_24px_rgba(15,23,42,0.12)] text-sky-600'
                : 'text-slate-500 hover:bg-white/90 hover:text-slate-900'"
              :aria-current="isActive(item.path) ? 'page' : undefined"
              @click="handleMenuClick"
            >
              <div
                class="absolute left-1 top-1/2 -translate-y-1/2 h-6 w-1 rounded-full transition-all duration-300"
                :class="isActive(item.path) ? 'bg-sky-500 opacity-100' : 'bg-transparent opacity-0'"
              />
              <component
                :is="item.icon"
                class="w-5 h-5 transition-colors duration-300"
                :class="isActive(item.path) ? 'text-sky-600' : 'text-slate-400 group-hover:text-slate-600'"
                :strokeWidth="3"
              />
              <span class="font-medium text-[15px]">{{ item.label }}</span>

              <div
                v-if="isActive(item.path)"
                class="absolute right-3 w-1.5 h-1.5 rounded-full bg-sky-500"
              />
            </router-link>

            <div
              v-else
              class="relative flex items-center gap-3 px-4 py-3 rounded-xl text-slate-400 bg-white/45 cursor-not-allowed"
              title="Route not configured">
              <component :is="item.icon" class="w-5 h-5" :strokeWidth="3" />
              <span class="font-medium text-[15px]">{{ item.label }}</span>
            </div>
          </template>
        </template>
      </nav>

      <!-- 搴曢儴鐢ㄦ埛鍖哄煙 -->
      <div class="p-4 m-4 bg-white/80 rounded-2xl border border-white/80 shadow-[0_10px_30px_rgba(15,23,42,0.08)] backdrop-blur">
        <div class="flex items-center gap-3 mb-3">
          <div class="w-10 h-10 rounded-full overflow-hidden bg-gradient-to-br from-sky-100 to-cyan-100 flex items-center justify-center text-sky-700 font-semibold text-lg border border-sky-200">
            <img
              v-if="adminAvatarUrl"
              :src="adminAvatarUrl"
              alt="管理员头像"
              class="h-full w-full object-cover"
            />
            <template v-else>{{ userInitial }}</template>
          </div>
          <div class="flex-1 min-w-0">
            <p class="text-sm font-semibold text-gray-900 truncate">
              {{ currentUser?.username || 'Administrator' }}
            </p>
            <p class="text-xs text-slate-500 truncate">{{ roleLabel }}</p>
          </div>
          <AnnouncementBell />
        </div>
        <Button
          variant="ghost"
          class="w-full justify-start text-red-500 hover:text-red-600 hover:bg-red-50/50 h-9 px-2 font-medium"
          @click="handleLogout"
        >
          <LogOut class="w-4 h-4 mr-2" />
          退出登录
        </Button>
      </div>
    </aside>

    <!-- 涓诲唴瀹瑰尯鍩?-->
    <div 
      class="flex flex-col min-h-screen transition-all duration-500 cubic-bezier(0.32, 0.72, 0, 1)"
      :class="[isSidebarOpen ? 'lg:pl-[280px]' : 'lg:pl-0']"
    >
      <!-- 椤堕儴鏍?(浠呯Щ鍔ㄧ鎴栭渶瑕侀潰鍖呭睉鏃舵樉绀? -->
      <header class="flex-none h-16 px-6 flex items-center justify-between lg:hidden bg-white/60 backdrop-blur-md z-20 sticky top-0 border-b border-white/70">
         <div class="flex items-center gap-3">
            <button
              class="p-2 -ml-2 rounded-lg hover:bg-gray-200/50 text-gray-600 transition-colors"
              @click="toggleSidebar"
            >
              <Menu v-if="!isSidebarOpen" class="w-6 h-6" />
              <X v-else class="w-6 h-6" />
            </button>
            <span class="font-semibold text-gray-900">{{ currentPageLabel }}</span>
         </div>
      </header>

      <!-- 婊氬姩鍐呭鍖?-->
      <main class="relative z-10 flex-1 overflow-auto p-4 lg:p-8 scroll-smooth admin-scrollbar">
        <div class="max-w-[1600px] mx-auto space-y-8 animate-fade-in-up">
          
          <!-- 椤甸潰鏍囬涓庨潰鍖呭睉 -->
          <div class="sticky top-3 z-10 flex flex-col lg:flex-row items-start lg:items-center justify-between mb-6 lg:mb-8 gap-4 rounded-[22px] border border-white/80 bg-white/75 backdrop-blur-xl px-5 py-4 shadow-[0_10px_30px_rgba(15,23,42,0.08)]">
            <div class="hidden lg:block">
              <h2 class="text-3xl font-bold text-gray-900 tracking-tight">
                {{ currentPageLabel || 'Dashboard' }}
              </h2>
              <div class="flex items-center gap-2 mt-2 text-sm text-gray-500 font-medium">
                <span>Control Center</span>
                <ChevronRight class="w-4 h-4 text-gray-400" />
                <span class="text-gray-900">{{ currentPageLabel || 'Home' }}</span>
              </div>
            </div>

            <div class="hidden lg:flex items-center gap-2 rounded-full border border-white/80 bg-white/70 px-3 py-1.5 text-xs text-gray-600 shadow-sm">
              <span class="inline-block h-2 w-2 rounded-full bg-emerald-500"></span>
              <span class="font-medium">{{ roleLabel }}</span>
            </div>
            
            <!-- 椤堕儴鎿嶄綔鏍忓崰浣?-->
            <div id="header-actions" class="w-full lg:w-auto flex justify-end"></div>
          </div>

          <router-view v-slot="{ Component }">
            <transition name="admin-page-fade" mode="out-in">
              <component :is="Component" />
            </transition>
          </router-view>
        </div>
      </main>
    </div>
  </div>
</template>

<style scoped>
/* 鑷畾涔夌紦鍔ㄥ姩鐢?*/
.cubic-bezier {
  transition-timing-function: cubic-bezier(0.32, 0.72, 0, 1);
}

/* 鍐呭杩涘叆鍔ㄧ敾 */
@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.animate-fade-in-up {
  animation: fadeInUp 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}

/* 闅愯棌婊氬姩鏉′絾淇濈暀鍔熻兘 (鍙€? */
::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}
::-webkit-scrollbar-track {
  background: transparent;
}
::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.1);
  border-radius: 4px;
}
::-webkit-scrollbar-thumb:hover {
  background: rgba(0, 0, 0, 0.2);
}

@keyframes floatY {
  0%, 100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-14px);
  }
}

.float-slow {
  animation: floatY 10s ease-in-out infinite;
}

.float-slower {
  animation: floatY 14s ease-in-out infinite;
}

.admin-scrollbar::-webkit-scrollbar {
  width: 8px;
}

.admin-scrollbar::-webkit-scrollbar-thumb {
  background: rgba(148, 163, 184, 0.45);
  border-radius: 9999px;
}

.admin-scrollbar::-webkit-scrollbar-thumb:hover {
  background: rgba(100, 116, 139, 0.55);
}

.admin-page-fade-enter-active,
.admin-page-fade-leave-active {
  transition: opacity 0.22s ease, transform 0.22s ease;
}

.admin-page-fade-enter-from,
.admin-page-fade-leave-to {
  opacity: 0;
  transform: translateY(6px);
}

.admin-page-fade-enter-to,
.admin-page-fade-leave-from {
  opacity: 1;
  transform: translateY(0);
}
</style>

