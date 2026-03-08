import { spawn } from 'child_process'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const REGISTER_SCRIPT_CANDIDATES = [
  process.env.CODEX_REGISTER_DIR,
  path.resolve(__dirname, '../../../Codex_register'),
  path.resolve(__dirname, '../../../../Codex_register'),
  path.resolve(process.cwd(), '../Codex_register'),
  path.resolve(process.cwd(), '../../Codex_register'),
  path.resolve('E:/26年项目/03_month/Codex_register'),
].filter(Boolean)

function resolveRegisterScriptDir() {
  for (const candidate of REGISTER_SCRIPT_CANDIDATES) {
    const scriptPath = path.join(candidate, 'openai_register3.py')
    if (fs.existsSync(scriptPath)) return candidate
  }
  return path.resolve(__dirname, '../../../Codex_register')
}

const REGISTER_SCRIPT_DIR = resolveRegisterScriptDir()
const REGISTER_SCRIPT = path.join(REGISTER_SCRIPT_DIR, 'openai_register3.py')
const ACCOUNTS_FILE = path.join(REGISTER_SCRIPT_DIR, 'output', 'accounts.txt')
const MAX_LOGS = 500

const state = {
  running: false,
  process: null,
  logs: [],
  successCount: 0,
  failCount: 0,
  accountsBaseline: 0,
  startTime: null,
  threads: 3,
  targetCount: 0,
  provider: 'mailtm',
  proxy: '',
}

function countExportedAccounts() {
  if (!fs.existsSync(ACCOUNTS_FILE)) return 0
  const content = fs.readFileSync(ACCOUNTS_FILE, 'utf-8')
  return content
    .split('\n')
    .map((line) => String(line || '').trim())
    .filter(Boolean).length
}

function refreshSuccessCountFromFile() {
  const currentCount = countExportedAccounts()
  state.successCount = Math.max(0, currentCount - state.accountsBaseline)
}

function addLog(msg) {
  const entry = {
    time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
    msg: String(msg || '').trim(),
  }
  if (!entry.msg) return

  state.logs.push(entry)
  if (state.logs.length > MAX_LOGS) {
    state.logs = state.logs.slice(-MAX_LOGS)
  }

  if (
    entry.msg.includes('[FAIL]') ||
    entry.msg.includes('失败') ||
    entry.msg.includes('Error') ||
    entry.msg.includes('[stderr]')
  ) {
    state.failCount += 1
  }
}

export function startRegister({ proxy, threads = 3, once = false, provider = 'mailtm', targetCount = 0 } = {}) {
  if (state.running) {
    return { ok: false, msg: '注册任务已在运行中' }
  }

  if (!fs.existsSync(REGISTER_SCRIPT)) {
    return { ok: false, msg: `注册脚本不存在: ${REGISTER_SCRIPT}` }
  }

  state.running = true
  state.process = null
  state.logs = []
  state.successCount = 0
  state.failCount = 0
  state.accountsBaseline = countExportedAccounts()
  state.startTime = Date.now()
  state.threads = Math.max(1, Math.min(10, Number(threads) || 3))
  state.targetCount = Math.max(0, Number(targetCount) || 0)
  state.provider = String(provider || 'mailtm').trim() || 'mailtm'
  state.proxy = String(proxy || '').trim()

  const args = [REGISTER_SCRIPT]
  if (state.proxy) args.push('--proxy', state.proxy)
  if (once) args.push('--once')
  args.push('--threads', String(state.threads))
  args.push('--provider', state.provider)
  if (state.targetCount > 0) args.push('--target-count', String(state.targetCount))

  addLog(
    `[SYSTEM] 启动注册任务，线程数: ${state.threads}，预计注册数: ${state.targetCount || '不限'}，邮箱源: ${state.provider}，代理: ${state.proxy || '系统直连'}`
  )

  try {
    const proc = spawn('python', args, {
      cwd: REGISTER_SCRIPT_DIR,
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8',
        PYTHONLEGACYWINDOWSSTDIO: '0',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    state.process = proc

    proc.stdout.on('data', (data) => {
      const lines = String(data || '').split('\n')
      for (const line of lines) {
        if (String(line || '').trim()) addLog(line)
      }
      refreshSuccessCountFromFile()
    })

    proc.stderr.on('data', (data) => {
      const lines = String(data || '').split('\n')
      for (const line of lines) {
        if (String(line || '').trim()) addLog(`[stderr] ${line}`)
      }
    })

    proc.on('close', (code) => {
      refreshSuccessCountFromFile()
      state.running = false
      state.process = null
      addLog(`[SYSTEM] 注册进程已结束，退出码: ${code}`)
    })

    proc.on('error', (err) => {
      state.running = false
      state.process = null
      addLog(`[SYSTEM] 注册进程启动失败: ${err.message}`)
    })

    return { ok: true }
  } catch (err) {
    state.running = false
    state.process = null
    return { ok: false, msg: `启动失败: ${err.message}` }
  }
}

export function stopRegister() {
  if (!state.running || !state.process) {
    return { ok: false, msg: '没有正在运行的注册任务' }
  }

  try {
    state.process.kill('SIGTERM')
    addLog('[SYSTEM] 已发送停止信号')

    setTimeout(() => {
      if (state.process && state.running) {
        state.process.kill('SIGKILL')
        state.running = false
        state.process = null
        addLog('[SYSTEM] 已强制终止注册进程')
      }
    }, 5000)

    return { ok: true }
  } catch (err) {
    return { ok: false, msg: `停止失败: ${err.message}` }
  }
}

export function getStatus() {
  refreshSuccessCountFromFile()
  return {
    running: state.running,
    successCount: state.successCount,
    failCount: state.failCount,
    startTime: state.startTime,
    elapsed: state.startTime ? Math.floor((Date.now() - state.startTime) / 1000) : 0,
    threads: state.threads,
    targetCount: state.targetCount,
    provider: state.provider,
    proxy: state.proxy,
  }
}

export function getLogs(since = 0) {
  return {
    logs: state.logs.slice(Math.max(0, Number(since) || 0)),
    total: state.logs.length,
  }
}

export function loadAccounts() {
  const accounts = []
  if (!fs.existsSync(ACCOUNTS_FILE)) return accounts

  const content = fs.readFileSync(ACCOUNTS_FILE, 'utf-8')
  for (const line of content.split('\n')) {
    const trimmed = String(line || '').trim()
    if (!trimmed) continue
    const parts = trimmed.split('----')
    if (parts.length >= 3) {
      accounts.push({ email: parts[0], password: parts[1], refreshToken: parts[2] })
    } else if (parts.length === 2) {
      accounts.push({ email: parts[0], password: parts[1], refreshToken: '' })
    }
  }
  return accounts
}

export function getRegisterScriptDir() {
  return REGISTER_SCRIPT_DIR
}
