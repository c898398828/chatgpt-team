<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { adminService, authService } from '@/services/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Play, Square, RefreshCw, Upload, Network, Mail, Activity, TimerReset } from 'lucide-vue-next'

type RegisterLog = { time: string; msg: string }
type RegisteredAccount = { email: string; password?: string; refreshToken?: string }
type LogSegment = { text: string; kind: 'plain' | 'email' | 'path' | 'token' }

const ui = {
  noPermission: '\u5f53\u524d\u8d26\u53f7\u65e0\u6743\u8bbf\u95ee\u6279\u91cf\u6ce8\u518c\u529f\u80fd\u3002',
  running: '\u4efb\u52a1\u8fd0\u884c\u4e2d',
  stopped: '\u4efb\u52a1\u5df2\u505c\u6b62',
  title: '\u6279\u91cf\u6ce8\u518c\u63a7\u5236\u53f0',
  subtitle:
    '\u6ce8\u518c\u4ee3\u7406\u548c\u6ce8\u518c\u90ae\u7bb1\u6e90\u7531\u7cfb\u7edf\u914d\u7f6e\u7edf\u4e00\u63d0\u4f9b\u3002\u5f53\u524d\u9875\u9762\u53ea\u4fdd\u7559\u7ebf\u7a0b\u3001\u76ee\u6807\u6570\u91cf\u548c\u4efb\u52a1\u63a7\u5236\uff0c\u907f\u514d\u91cd\u590d\u914d\u7f6e\u3002',
  systemProxy: '\u7cfb\u7edf\u4ee3\u7406',
  emailProvider: '\u6ce8\u518c\u90ae\u7bb1\u6e90',
  successCount: '\u6210\u529f\u6ce8\u518c',
  failCount: '\u5931\u8d25\u6b21\u6570',
  threads: '\u6ce8\u518c\u7ebf\u7a0b',
  targetCount: '\u9884\u8ba1\u6ce8\u518c\u6570',
  successHelper: '\u5df2\u5199\u5165\u6ce8\u518c\u811a\u672c\u8f93\u51fa',
  failHelper: '\u6309\u65e5\u5fd7\u7ed3\u679c\u7d2f\u8ba1',
  threadsHelper: '\u5f53\u524d\u8fd0\u884c\u5e76\u53d1',
  targetHelperLimited: '\u8fbe\u5230\u76ee\u6807\u540e\u81ea\u52a8\u505c\u6b62',
  targetHelperUnlimited: '0 \u8868\u793a\u4e0d\u9650\u5236',
  taskControl: '\u4efb\u52a1\u63a7\u5236',
  taskControlDesc: '\u5f53\u524d\u72b6\u6001\u3001\u7ebf\u7a0b\u548c\u9884\u8ba1\u6ce8\u518c\u76ee\u6807\u6982\u89c8\u3002',
  runtimeStatus: '\u8fd0\u884c\u72b6\u6001',
  elapsedPrefix: '\u8017\u65f6',
  targetProgress: '\u76ee\u6807\u8fdb\u5ea6',
  targetProgressDesc: '\u6210\u529f\u6570\u8fbe\u5230\u9884\u8ba1\u6ce8\u518c\u6570\u540e\u81ea\u52a8\u505c\u6b62',
  startTask: '\u542f\u52a8\u6ce8\u518c',
  stopTask: '\u505c\u6b62\u4efb\u52a1',
  configTitle: '\u6ce8\u518c\u914d\u7f6e',
  configDesc: '\u7ebf\u7a0b\u6570\u548c\u9884\u8ba1\u6ce8\u518c\u6570\u4fdd\u5b58\u5728\u7cfb\u7edf\u914d\u7f6e\u4e2d\u3002',
  threadsHint: '\u5efa\u8bae 1-10\u3002\u7ebf\u7a0b\u8d8a\u9ad8\uff0c\u5bf9\u4ee3\u7406\u548c\u90ae\u7bb1\u6e90\u8981\u6c42\u8d8a\u9ad8\u3002',
  targetHint: '\u8bbe\u7f6e\u4e3a 0 \u8868\u793a\u4e0d\u9650\u3002\u8fbe\u5230\u76ee\u6807\u540e\u6ce8\u518c\u7ebf\u7a0b\u81ea\u52a8\u9000\u51fa\u3002',
  settingsReadonly: '\u5982\u9700\u4fee\u6539\u90ae\u7bb1\u6e90\u6216\u4ee3\u7406\uff0c\u8bf7\u524d\u5f80\u7cfb\u7edf\u914d\u7f6e\u9875\u9762\u7edf\u4e00\u7ef4\u62a4\u3002',
  saveConfig: '\u4fdd\u5b58\u914d\u7f6e',
  saving: '\u4fdd\u5b58\u4e2d...',
  accountsTitle: '\u5df2\u6ce8\u518c\u8d26\u53f7',
  accountsDesc: '\u8bfb\u53d6\u6ce8\u518c\u811a\u672c\u8f93\u51fa\u7684 `accounts.txt` \u5e76\u652f\u6301\u5bfc\u5165\u7cfb\u7edf\u3002',
  refreshAccounts: '\u5237\u65b0\u5217\u8868',
  importAccounts: '\u5bfc\u5165\u7cfb\u7edf',
  noAccounts: '\u6682\u65e0\u6ce8\u518c\u5b8c\u6210\u7684\u8d26\u53f7\u3002',
  logsTitle: '\u8fd0\u884c\u65e5\u5fd7',
  logsDesc: '\u5b9e\u65f6\u663e\u793a\u6279\u91cf\u6ce8\u518c\u811a\u672c\u8f93\u51fa\u3002',
  clearLogs: '\u6e05\u7a7a',
  noLogs: '\u6682\u65e0\u65e5\u5fd7\u3002\u542f\u52a8\u6ce8\u518c\u4efb\u52a1\u540e\uff0c\u8fd9\u91cc\u4f1a\u6301\u7eed\u8f93\u51fa\u5b9e\u65f6\u65e5\u5fd7\u3002',
  importResult: '\u5bfc\u5165\u7ed3\u679c',
  importDone: '\u5bfc\u5165\u5b8c\u6210',
  importNoAccounts: '\u6ca1\u6709\u53ef\u5bfc\u5165\u7684\u8d26\u53f7',
  loadFailed: '\u52a0\u8f7d\u6279\u91cf\u6ce8\u518c\u9875\u9762\u5931\u8d25',
  startFailed: '\u542f\u52a8\u6279\u91cf\u6ce8\u518c\u5931\u8d25',
  stopFailed: '\u505c\u6b62\u6279\u91cf\u6ce8\u518c\u5931\u8d25',
  saveFailed: '\u4fdd\u5b58\u6279\u91cf\u6ce8\u518c\u914d\u7f6e\u5931\u8d25',
  importFailed: '\u5bfc\u5165\u8d26\u53f7\u5931\u8d25',
  configSaved: '\u6279\u91cf\u6ce8\u518c\u914d\u7f6e\u5df2\u4fdd\u5b58',
  started: '\u6279\u91cf\u6ce8\u518c\u4efb\u52a1\u5df2\u542f\u52a8',
  stopSent: '\u5df2\u53d1\u9001\u505c\u6b62\u6307\u4ee4',
  currentTotalPrefix: '\u5f53\u524d\u5171',
  accountUnit: '\u4e2a\u8d26\u53f7',
  importSummaryPrefix: '\u5bfc\u5165\u5b8c\u6210\uff1a\u6210\u529f',
  importSummaryMiddle: '\uff0c\u5931\u8d25',
  unlimited: '\u672a\u8bbe\u7f6e\u4e0a\u9650',
  proxyFallback: '\u672a\u914d\u7f6e\uff0c\u4f7f\u7528\u670d\u52a1\u7aef\u9ed8\u8ba4\u7f51\u7edc\u73af\u5883',
  runtimeProviderDefault: 'Mail.tm',
} as const

const isSuperAdmin = computed(() => {
  const user = authService.getCurrentUser()
  return Array.isArray(user?.roles) && user.roles.includes('super_admin')
})

const teleportReady = ref(false)
const running = ref(false)
const loading = ref(false)
const configLoading = ref(false)
const importLoading = ref(false)

const successCount = ref(0)
const failCount = ref(0)
const elapsed = ref(0)
const runtimeThreads = ref(3)
const runtimeTargetCount = ref(12)
const runtimeProvider = ref('mailtm')
const runtimeProxy = ref('')

const configThreads = ref('3')
const configTargetCount = ref('12')
const systemProxyUrl = ref('')
const systemEmailProvider = ref('mailtm')

const logs = ref<RegisterLog[]>([])
const logTotal = ref(0)
const registeredAccounts = ref<RegisteredAccount[]>([])
const importResults = ref<{ success?: any[]; failed?: any[]; skipped?: any[] } | null>(null)
const error = ref('')
const success = ref('')
const pollingTimer = ref<ReturnType<typeof setInterval> | null>(null)
const logContainerRef = ref<HTMLDivElement | null>(null)

const elapsedText = computed(() => {
  const total = elapsed.value
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  if (hours > 0) return `${hours}\u5c0f\u65f6 ${minutes}\u5206\u949f`
  if (minutes > 0) return `${minutes}\u5206\u949f ${seconds}\u79d2`
  return `${seconds}\u79d2`
})

const targetProgressText = computed(() => {
  if (!runtimeTargetCount.value || runtimeTargetCount.value <= 0) return ui.unlimited
  return `${successCount.value} / ${runtimeTargetCount.value}`
})

const systemProxyText = computed(() => systemProxyUrl.value || ui.proxyFallback)
const providerText = computed(() => {
  if (systemEmailProvider.value === 'mailtm') return ui.runtimeProviderDefault
  return systemEmailProvider.value || ui.runtimeProviderDefault
})

const dashboardStats = computed(() => [
  {
    key: 'success',
    label: ui.successCount,
    value: String(successCount.value),
    helper: ui.successHelper,
    tone: 'text-emerald-600',
    surface: 'from-emerald-50 via-white to-emerald-100/80',
  },
  {
    key: 'failed',
    label: ui.failCount,
    value: String(failCount.value),
    helper: ui.failHelper,
    tone: 'text-rose-600',
    surface: 'from-rose-50 via-white to-rose-100/80',
  },
  {
    key: 'threads',
    label: ui.threads,
    value: String(runtimeThreads.value || Number(configThreads.value) || 3),
    helper: ui.threadsHelper,
    tone: 'text-sky-600',
    surface: 'from-sky-50 via-white to-sky-100/80',
  },
  {
    key: 'target',
    label: ui.targetCount,
    value: String(runtimeTargetCount.value || Number(configTargetCount.value) || 0),
    helper: runtimeTargetCount.value > 0 ? ui.targetHelperLimited : ui.targetHelperUnlimited,
    tone: 'text-violet-600',
    surface: 'from-violet-50 via-white to-violet-100/80',
  },
])

type LogLevel = 'success' | 'error' | 'system' | 'info'

function getLogLevel(message: string): LogLevel {
  if (
    message.includes('\u6210\u529f') ||
    message.includes('[OK]') ||
    message.includes('\u5b8c\u6210') ||
    message.includes('token_')
  ) {
    return 'success'
  }
  if (
    message.includes('\u5931\u8d25') ||
    message.includes('Error') ||
    message.includes('[FAIL]') ||
    message.includes('[stderr]')
  ) {
    return 'error'
  }
  if (message.includes('[\u7cfb\u7edf]')) return 'system'
  return 'info'
}

function getLogRowClass(message: string) {
  const level = getLogLevel(message)
  if (level === 'success') return 'border-emerald-400/14 bg-emerald-400/[0.035]'
  if (level === 'error') return 'border-rose-400/16 bg-rose-400/[0.035]'
  if (level === 'system') return 'border-amber-300/18 bg-amber-300/[0.04]'
  return 'border-slate-800/70 bg-slate-950/20'
}

function getLogDotClass(message: string) {
  const level = getLogLevel(message)
  if (level === 'success') return 'bg-emerald-400 shadow-[0_0_18px_rgba(52,211,153,0.65)]'
  if (level === 'error') return 'bg-rose-400 shadow-[0_0_18px_rgba(251,113,133,0.65)]'
  if (level === 'system') return 'bg-amber-300 shadow-[0_0_18px_rgba(252,211,77,0.55)]'
  return 'bg-slate-500'
}

function getLogMetaClass(message: string) {
  const level = getLogLevel(message)
  if (level === 'success') return 'text-emerald-200/80'
  if (level === 'error') return 'text-rose-200/80'
  if (level === 'system') return 'text-amber-100/80'
  return 'text-slate-500'
}

function getLogTextClass(message: string) {
  const level = getLogLevel(message)
  if (level === 'success') return 'text-emerald-300'
  if (level === 'error') return 'text-rose-300'
  if (level === 'system') return 'text-amber-100'
  return 'text-slate-100'
}

function getLogSegments(message: string): LogSegment[] {
  const pattern = /output\/token_[^\s,，]+|accounts\.txt|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|token_[^\s,，]+/g
  const segments: LogSegment[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(message)) !== null) {
    const start = match.index
    const end = start + match[0].length
    if (start > lastIndex) {
      segments.push({ text: message.slice(lastIndex, start), kind: 'plain' })
    }

    const value = match[0]
    let kind: LogSegment['kind'] = 'plain'
    if (value.includes('@')) kind = 'email'
    else if (value.startsWith('output/') || value === 'accounts.txt') kind = 'path'
    else if (value.startsWith('token_')) kind = 'token'

    segments.push({ text: value, kind })
    lastIndex = end
  }

  if (lastIndex < message.length) {
    segments.push({ text: message.slice(lastIndex), kind: 'plain' })
  }

  return segments.length ? segments : [{ text: message, kind: 'plain' }]
}

function getLogSegmentClass(kind: LogSegment['kind']) {
  if (kind === 'email') return 'rounded-md bg-emerald-400/10 px-1.5 py-0.5 text-emerald-200 ring-1 ring-emerald-400/20'
  if (kind === 'path') return 'rounded-md bg-sky-400/10 px-1.5 py-0.5 text-sky-200 ring-1 ring-sky-400/20'
  if (kind === 'token') return 'rounded-md bg-violet-400/10 px-1.5 py-0.5 text-violet-200 ring-1 ring-violet-400/20'
  return ''
}

function setFlashMessage(target: typeof success | typeof error, value: string, delay = 3000) {
  target.value = value
  if (!value) return
  setTimeout(() => {
    if (target.value === value) target.value = ''
  }, delay)
}

async function scrollLogsToBottom() {
  await nextTick()
  if (logContainerRef.value) {
    logContainerRef.value.scrollTop = logContainerRef.value.scrollHeight
  }
}

async function loadConfig() {
  const response = await adminService.getBatchRegisterConfig()
  const config = response.config || {}
  const system = response.system || {}
  configThreads.value = String(config.threads || 3)
  configTargetCount.value = String(config.targetCount || 12)
  runtimeThreads.value = Number(config.threads || 3)
  runtimeTargetCount.value = Number(config.targetCount || 12)
  systemProxyUrl.value = String(system.proxyUrl || '')
  systemEmailProvider.value = String(system.emailProvider || 'mailtm')
}

async function saveConfig() {
  configLoading.value = true
  error.value = ''
  try {
    const response = await adminService.updateBatchRegisterConfig({
      enabled: true,
      threads: Math.max(1, Math.min(10, Number(configThreads.value) || 3)),
      targetCount: Math.max(0, Math.min(500, Number(configTargetCount.value) || 0)),
    })
    const config = response.config || {}
    const system = response.system || {}
    configThreads.value = String(config.threads || 3)
    configTargetCount.value = String(config.targetCount || 12)
    runtimeThreads.value = Number(config.threads || 3)
    runtimeTargetCount.value = Number(config.targetCount || 12)
    systemProxyUrl.value = String(system.proxyUrl || '')
    systemEmailProvider.value = String(system.emailProvider || 'mailtm')
    setFlashMessage(success, ui.configSaved)
  } catch (err: any) {
    error.value = err.response?.data?.error || ui.saveFailed
  } finally {
    configLoading.value = false
  }
}

async function refreshStatus() {
  const status = await adminService.getBatchRegisterStatus()
  running.value = Boolean(status.running)
  successCount.value = Number(status.successCount || 0)
  failCount.value = Number(status.failCount || 0)
  elapsed.value = Number(status.elapsed || 0)
  runtimeThreads.value = Number(status.threads || runtimeThreads.value || 3)
  runtimeTargetCount.value = Number(status.targetCount ?? runtimeTargetCount.value ?? 0)
  runtimeProvider.value = String(status.provider || runtimeProvider.value || systemEmailProvider.value || 'mailtm')
  runtimeProxy.value = String(status.proxy || '')
}

async function refreshLogs() {
  const response = await adminService.getBatchRegisterLogs(logTotal.value)
  if (!response.logs?.length) return
  logs.value.push(...response.logs)
  if (logs.value.length > 500) logs.value = logs.value.slice(-500)
  logTotal.value = response.total
  await scrollLogsToBottom()
}

async function loadAccounts() {
  const response = await adminService.getBatchRegisterAccounts()
  registeredAccounts.value = response.accounts || []
}

async function startTask() {
  loading.value = true
  error.value = ''
  try {
    const response = await adminService.startBatchRegister({
      threads: Math.max(1, Math.min(10, Number(configThreads.value) || 3)),
      targetCount: Math.max(0, Math.min(500, Number(configTargetCount.value) || 0)),
    })
    if (!response.ok) {
      error.value = response.msg || ui.startFailed
      return
    }
    logs.value = []
    logTotal.value = 0
    running.value = true
    await refreshStatus()
    setFlashMessage(success, ui.started)
  } catch (err: any) {
    error.value = err.response?.data?.error || ui.startFailed
  } finally {
    loading.value = false
  }
}

async function stopTask() {
  loading.value = true
  error.value = ''
  try {
    const response = await adminService.stopBatchRegister()
    if (!response.ok) {
      error.value = response.msg || ui.stopFailed
      return
    }
    setFlashMessage(success, ui.stopSent)
    await refreshStatus()
  } catch (err: any) {
    error.value = err.response?.data?.error || ui.stopFailed
  } finally {
    loading.value = false
  }
}

async function importToSystem() {
  if (!registeredAccounts.value.length) {
    error.value = ui.importNoAccounts
    return
  }
  importLoading.value = true
  error.value = ''
  try {
    const response = await adminService.importAccountsToSystem({ accounts: registeredAccounts.value })
    importResults.value = response
    setFlashMessage(
      success,
      `${ui.importSummaryPrefix} ${response.success?.length || 0}${ui.importSummaryMiddle} ${response.failed?.length || 0}`,
      5000
    )
  } catch (err: any) {
    error.value = err.response?.data?.error || ui.importFailed
  } finally {
    importLoading.value = false
  }
}

async function bootstrap() {
  try {
    await Promise.all([loadConfig(), refreshStatus(), refreshLogs(), loadAccounts()])
  } catch (err: any) {
    error.value = err.response?.data?.error || ui.loadFailed
  }
}

onMounted(async () => {
  await nextTick()
  teleportReady.value = Boolean(document.getElementById('header-actions'))
  if (!isSuperAdmin.value) return
  await bootstrap()
  pollingTimer.value = setInterval(() => {
    refreshStatus().catch(() => {})
    refreshLogs().catch(() => {})
  }, 2000)
})

onUnmounted(() => {
  teleportReady.value = false
  if (pollingTimer.value) clearInterval(pollingTimer.value)
})
</script>

<template>
  <div class="space-y-6">
    <div
      v-if="!isSuperAdmin"
      class="rounded-[28px] border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm"
    >
      {{ ui.noPermission }}
    </div>

    <template v-else>
      <Teleport v-if="teleportReady" to="#header-actions">
        <div class="flex flex-wrap items-center justify-end gap-3">
          <Button
            type="button"
            variant="outline"
            class="h-11 rounded-2xl border-slate-200 bg-white px-4 text-slate-700"
            @click="loadAccounts"
          >
            <RefreshCw class="mr-2 h-4 w-4" />
            {{ ui.refreshAccounts }}
          </Button>
        </div>
      </Teleport>

      <section class="relative overflow-hidden rounded-[32px] border border-slate-200/80 bg-white px-6 py-6 shadow-[0_24px_80px_-48px_rgba(15,23,42,0.45)] sm:px-8">
        <div class="absolute inset-x-0 top-0 h-28 bg-[radial-gradient(circle_at_top_left,_rgba(59,130,246,0.14),_transparent_52%),radial-gradient(circle_at_top_right,_rgba(16,185,129,0.12),_transparent_42%)]" />
        <div class="relative flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div class="space-y-3">
            <div class="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50/90 px-3 py-1 text-xs font-medium text-slate-600">
              <span class="h-2 w-2 rounded-full" :class="running ? 'bg-emerald-500 animate-pulse' : 'bg-slate-300'" />
              {{ running ? ui.running : ui.stopped }}
            </div>
            <div>
              <h2 class="text-2xl font-semibold tracking-tight text-slate-950">{{ ui.title }}</h2>
              <p class="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
                {{ ui.subtitle }}
              </p>
            </div>
          </div>
          <div class="grid gap-3 sm:grid-cols-2 xl:min-w-[420px] xl:max-w-[520px]">
            <div class="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
              <div class="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-slate-400">
                <Network class="h-3.5 w-3.5" />
                {{ ui.systemProxy }}
              </div>
              <div class="mt-3 break-all text-sm font-medium text-slate-700">{{ systemProxyText }}</div>
            </div>
            <div class="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
              <div class="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-slate-400">
                <Mail class="h-3.5 w-3.5" />
                {{ ui.emailProvider }}
              </div>
              <div class="mt-3 text-sm font-medium text-slate-700">{{ providerText }}</div>
            </div>
          </div>
        </div>
      </section>

      <section class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card
          v-for="stat in dashboardStats"
          :key="stat.key"
          class="overflow-hidden rounded-[28px] border border-slate-200/80 bg-gradient-to-br shadow-sm"
          :class="stat.surface"
        >
          <CardContent class="p-5">
            <div class="text-xs font-medium uppercase tracking-[0.22em] text-slate-400">{{ stat.label }}</div>
            <div class="mt-4 text-3xl font-semibold tracking-tight" :class="stat.tone">{{ stat.value }}</div>
            <div class="mt-2 text-sm text-slate-500">{{ stat.helper }}</div>
          </CardContent>
        </Card>
      </section>

      <div class="grid gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
        <div class="space-y-6">
          <Card class="overflow-hidden rounded-[28px] border border-slate-200/80 bg-white shadow-sm">
            <CardHeader class="border-b border-slate-100 bg-slate-50/70">
              <CardTitle class="text-lg text-slate-950">{{ ui.taskControl }}</CardTitle>
              <CardDescription class="text-slate-500">{{ ui.taskControlDesc }}</CardDescription>
            </CardHeader>
            <CardContent class="space-y-5 p-6">
              <div class="grid gap-3 sm:grid-cols-2">
                <div class="rounded-2xl border border-emerald-100 bg-emerald-50/80 p-4">
                  <div class="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-emerald-600">
                    <Activity class="h-3.5 w-3.5" />
                    {{ ui.runtimeStatus }}
                  </div>
                  <div class="mt-3 text-lg font-semibold text-emerald-700">{{ running ? ui.running : ui.stopped }}</div>
                  <div class="mt-1 text-xs text-emerald-600/80">{{ ui.elapsedPrefix }} {{ elapsedText }}</div>
                </div>
                <div class="rounded-2xl border border-violet-100 bg-violet-50/80 p-4">
                  <div class="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-violet-600">
                    <TimerReset class="h-3.5 w-3.5" />
                    {{ ui.targetProgress }}
                  </div>
                  <div class="mt-3 text-lg font-semibold text-violet-700">{{ targetProgressText }}</div>
                  <div class="mt-1 text-xs text-violet-600/80">{{ ui.targetProgressDesc }}</div>
                </div>
              </div>

              <div class="grid gap-3 sm:grid-cols-2">
                <div class="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                  <div class="text-xs font-medium uppercase tracking-[0.18em] text-slate-400">{{ ui.threads }}</div>
                  <div class="mt-2 text-2xl font-semibold text-slate-900">{{ runtimeThreads }}</div>
                </div>
                <div class="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                  <div class="text-xs font-medium uppercase tracking-[0.18em] text-slate-400">{{ ui.targetCount }}</div>
                  <div class="mt-2 text-2xl font-semibold text-slate-900">{{ runtimeTargetCount || 0 }}</div>
                </div>
              </div>

              <div class="flex gap-3">
                <Button
                  v-if="!running"
                  type="button"
                  class="h-11 flex-1 rounded-2xl bg-emerald-600 text-white hover:bg-emerald-700"
                  :disabled="loading"
                  @click="startTask"
                >
                  <Play class="mr-2 h-4 w-4" />
                  {{ ui.startTask }}
                </Button>
                <Button
                  v-else
                  type="button"
                  class="h-11 flex-1 rounded-2xl bg-rose-600 text-white hover:bg-rose-700"
                  :disabled="loading"
                  @click="stopTask"
                >
                  <Square class="mr-2 h-4 w-4" />
                  {{ ui.stopTask }}
                </Button>
              </div>

              <div v-if="error" class="rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-600">
                {{ error }}
              </div>
              <div v-if="success" class="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-600">
                {{ success }}
              </div>
            </CardContent>
          </Card>

          <Card class="overflow-hidden rounded-[28px] border border-slate-200/80 bg-white shadow-sm">
            <CardHeader class="border-b border-slate-100 bg-slate-50/70">
              <CardTitle class="text-lg text-slate-950">{{ ui.configTitle }}</CardTitle>
              <CardDescription class="text-slate-500">{{ ui.configDesc }}</CardDescription>
            </CardHeader>
            <CardContent class="space-y-5 p-6">
              <div class="space-y-2">
                <Label for="register-threads" class="text-sm font-medium text-slate-600">{{ ui.threads }}</Label>
                <Input
                  id="register-threads"
                  v-model="configThreads"
                  type="number"
                  min="1"
                  max="10"
                  class="h-11 rounded-2xl border-slate-200 bg-slate-50"
                />
                <p class="text-xs text-slate-500">{{ ui.threadsHint }}</p>
              </div>
              <div class="space-y-2">
                <Label for="register-target" class="text-sm font-medium text-slate-600">{{ ui.targetCount }}</Label>
                <Input
                  id="register-target"
                  v-model="configTargetCount"
                  type="number"
                  min="0"
                  max="500"
                  class="h-11 rounded-2xl border-slate-200 bg-slate-50"
                />
                <p class="text-xs text-slate-500">{{ ui.targetHint }}</p>
              </div>

              <div class="rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 p-4 text-sm text-slate-600">
                <div>{{ ui.emailProvider }}：<span class="font-medium text-slate-900">{{ providerText }}</span></div>
                <div class="mt-1">{{ ui.systemProxy }}：<span class="font-medium text-slate-900">{{ systemProxyText }}</span></div>
                <div class="mt-3 text-xs text-slate-500">{{ ui.settingsReadonly }}</div>
              </div>

              <Button
                type="button"
                class="h-11 w-full rounded-2xl bg-slate-950 text-white hover:bg-slate-800"
                :disabled="configLoading"
                @click="saveConfig"
              >
                {{ configLoading ? ui.saving : ui.saveConfig }}
              </Button>
            </CardContent>
          </Card>

          <Card class="overflow-hidden rounded-[28px] border border-slate-200/80 bg-white shadow-sm">
            <CardHeader class="border-b border-slate-100 bg-slate-50/70">
              <CardTitle class="text-lg text-slate-950">{{ ui.accountsTitle }}</CardTitle>
              <CardDescription class="text-slate-500">{{ ui.accountsDesc }}</CardDescription>
            </CardHeader>
            <CardContent class="space-y-4 p-6">
              <div class="flex gap-3">
                <Button type="button" variant="outline" class="h-10 flex-1 rounded-2xl" @click="loadAccounts">
                  <RefreshCw class="mr-2 h-4 w-4" />
                  {{ ui.refreshAccounts }}
                </Button>
                <Button
                  type="button"
                  class="h-10 flex-1 rounded-2xl bg-sky-600 text-white hover:bg-sky-700"
                  :disabled="importLoading || !registeredAccounts.length"
                  @click="importToSystem"
                >
                  <Upload class="mr-2 h-4 w-4" />
                  {{ ui.importAccounts }}
                </Button>
              </div>
              <div class="text-sm text-slate-500">{{ ui.currentTotalPrefix }} {{ registeredAccounts.length }} {{ ui.accountUnit }}</div>
              <div v-if="registeredAccounts.length" class="max-h-64 space-y-2 overflow-y-auto pr-1">
                <div
                  v-for="(account, index) in registeredAccounts"
                  :key="`${account.email}-${index}`"
                  class="rounded-2xl border border-slate-200 bg-slate-50/80 px-3 py-2 text-sm text-slate-700"
                >
                  <div class="truncate font-mono">{{ account.email }}</div>
                </div>
              </div>
              <div v-else class="rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 px-4 py-6 text-center text-sm text-slate-500">
                {{ ui.noAccounts }}
              </div>

              <div v-if="importResults" class="rounded-2xl border border-sky-100 bg-sky-50/80 p-4 text-sm text-sky-700">
                <div>{{ ui.importResult }}：{{ ui.successCount }} {{ importResults.success?.length || 0 }}，{{ ui.failCount }} {{ importResults.failed?.length || 0 }}，跳过 {{ importResults.skipped?.length || 0 }}</div>
                <div v-if="importResults.failed?.length" class="mt-3 max-h-24 space-y-1 overflow-y-auto text-xs text-rose-600">
                  <div v-for="(item, index) in importResults.failed" :key="`failed-${index}`">{{ item.email }}：{{ item.error }}</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card class="overflow-hidden rounded-[28px] border border-slate-200/80 bg-white shadow-sm">
          <CardHeader class="flex flex-row items-center justify-between border-b border-slate-100 bg-slate-50/70">
            <div>
              <CardTitle class="text-lg text-slate-950">{{ ui.logsTitle }}</CardTitle>
              <CardDescription class="text-slate-500">{{ ui.logsDesc }}</CardDescription>
            </div>
            <Button type="button" variant="ghost" size="sm" class="rounded-xl text-slate-500" @click="logs = []; logTotal = 0">
              {{ ui.clearLogs }}
            </Button>
          </CardHeader>
          <CardContent class="p-6">
            <div
              ref="logContainerRef"
              class="h-[calc(100vh-240px)] min-h-[560px] overflow-y-auto rounded-[26px] border border-slate-800/80 bg-[radial-gradient(circle_at_top,_rgba(37,99,235,0.08),_transparent_28%),linear-gradient(180deg,#06101f_0%,#030712_100%)] p-5 text-slate-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
              style="font-family: 'JetBrains Mono', 'Cascadia Code', 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;"
            >
              <div v-if="!logs.length" class="flex h-full min-h-[480px] items-center justify-center text-center text-slate-500">
                {{ ui.noLogs }}
              </div>
              <div v-for="(log, index) in logs" :key="`${log.time}-${index}`" class="mb-2.5 last:mb-0">
                <div
                  class="rounded-[20px] border px-4 py-3.5 transition-colors duration-200"
                  :class="getLogRowClass(log.msg)"
                >
                  <div class="flex items-start gap-3.5">
                    <div class="flex w-[108px] shrink-0 items-center gap-3 pt-0.5">
                      <span class="h-2.5 w-2.5 rounded-full" :class="getLogDotClass(log.msg)" />
                      <span class="text-[11px] tracking-[0.2em]" :class="getLogMetaClass(log.msg)">
                        {{ log.time }}
                      </span>
                    </div>
                    <div class="min-w-0 flex-1">
                      <div
                        class="whitespace-pre-wrap break-words pt-0.5 text-[13px] font-medium leading-7 antialiased"
                        :class="getLogTextClass(log.msg)"
                      >
                        <template v-for="(segment, segmentIndex) in getLogSegments(log.msg)" :key="`${index}-${segmentIndex}`">
                          <span :class="getLogSegmentClass(segment.kind)">{{ segment.text }}</span>
                        </template>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </template>
  </div>
</template>
