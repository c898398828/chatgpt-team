import express from 'express'
import axios from 'axios'
import { getDatabase, saveDatabase } from '../database/init.js'
import { authenticateToken } from '../middleware/auth.js'
import { apiKeyAuth } from '../middleware/api-key-auth.js'
import { requireMenu } from '../middleware/rbac.js'
import { syncAccountUserCount, syncAccountInviteCount, fetchOpenAiAccountInfo, fetchAccountUsersList, AccountSyncError, deleteAccountUser, inviteAccountUser, deleteAccountInvite } from '../services/account-sync.js'

const router = express.Router()
const OPENAI_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'

const normalizeEmail = (value) => String(value ?? '').trim().toLowerCase()

const normalizeBoolean = (value) => {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (value === 1) return true
    if (value === 0) return false
    return null
  }
  const raw = String(value ?? '').trim().toLowerCase()
  if (!raw) return null
  if (['1', 'true', 'yes'].includes(raw)) return true
  if (['0', 'false', 'no'].includes(raw)) return false
  return null
}

const EXPIRE_AT_REGEX = /^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}$/

// ─── Codex 配额工具函数 ───────────────────────────────────────────────────────

/** 从 axios 响应头解析 Codex 配额信息（逻辑同 augment-token-mng-main 的 Rust 实现） */
const parseCodexQuotaFromHeaders = (headers) => {
  const getNum = (key) => {
    const val = headers[key]
    if (!val) return undefined
    const n = parseFloat(String(val))
    return isNaN(n) ? undefined : n
  }

  const primaryUsed    = getNum('x-codex-primary-used-percent')
  const primaryReset   = getNum('x-codex-primary-reset-after-seconds')
  const primaryWindow  = getNum('x-codex-primary-window-minutes')
  const secondaryUsed  = getNum('x-codex-secondary-used-percent')
  const secondaryReset = getNum('x-codex-secondary-reset-after-seconds')
  const secondaryWindow = getNum('x-codex-secondary-window-minutes')

  if (primaryUsed == null && secondaryUsed == null) return null

  // 根据窗口时长判断哪个是 5h，哪个是 7d
  let h5Used, h5Reset, h5Window, d7Used, d7Reset, d7Window

  if (primaryWindow != null && secondaryWindow != null) {
    if (primaryWindow <= secondaryWindow) {
      h5Used = primaryUsed;  h5Reset = primaryReset;  h5Window = primaryWindow
      d7Used = secondaryUsed; d7Reset = secondaryReset; d7Window = secondaryWindow
    } else {
      h5Used = secondaryUsed; h5Reset = secondaryReset; h5Window = secondaryWindow
      d7Used = primaryUsed;  d7Reset = primaryReset;  d7Window = primaryWindow
    }
  } else if (primaryWindow != null) {
    if (primaryWindow <= 360) {
      h5Used = primaryUsed; h5Reset = primaryReset; h5Window = primaryWindow
    } else {
      d7Used = primaryUsed; d7Reset = primaryReset; d7Window = primaryWindow
    }
  } else if (secondaryWindow != null) {
    if (secondaryWindow <= 360) {
      h5Used = secondaryUsed; h5Reset = secondaryReset; h5Window = secondaryWindow
    } else {
      d7Used = secondaryUsed; d7Reset = secondaryReset; d7Window = secondaryWindow
    }
  } else {
    // 无窗口信息时：primary → 7d，secondary → 5h（同 Rust 逻辑）
    d7Used = primaryUsed; d7Reset = primaryReset
    h5Used = secondaryUsed; h5Reset = secondaryReset
  }

  return {
    codex_5h_used_percent: h5Used,
    codex_5h_reset_after_seconds: h5Reset,
    codex_5h_window_minutes: h5Window,
    codex_7d_used_percent: d7Used,
    codex_7d_reset_after_seconds: d7Reset,
    codex_7d_window_minutes: d7Window,
    is_forbidden: false,
    quota_fetched_at: Math.floor(Date.now() / 1000)
  }
}

/** 调用 ChatGPT Codex API 获取账号配额（从响应头提取） */
const fetchCodexQuota = async (accessToken, chatgptAccountId) => {
  const CODEX_API_URL = 'https://chatgpt.com/backend-api/codex/responses'
  const requestBody = {
    model: 'gpt-5.1-codex',
    input: [{ role: 'user', content: [{ type: 'input_text', text: 'hi' }] }],
    instructions: 'You are Codex, based on GPT-5. You are running as a coding agent in the Codex CLI on a user\'s computer.',
    store: false,
    stream: true
  }
  const reqHeaders = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
    Host: 'chatgpt.com'
  }
  if (chatgptAccountId) reqHeaders['chatgpt-account-id'] = chatgptAccountId

  const response = await axios.post(CODEX_API_URL, requestBody, {
    headers: reqHeaders,
    responseType: 'stream',
    validateStatus: () => true,  // 不让 axios 对非 2xx 抛错
    timeout: 30000
  })

  // 立即销毁响应流，我们只需要响应头
  try { response.data.destroy() } catch { /* ignore */ }

  const status = response.status
  if (status === 401) throw new Error('HTTP 401: Token expired or invalid')
  if (status === 402 || status === 403) return { is_forbidden: true, quota_fetched_at: Math.floor(Date.now() / 1000) }
  if (status >= 200 && status < 300) {
    const quota = parseCodexQuotaFromHeaders(response.headers)
    return quota || { is_forbidden: false, quota_fetched_at: Math.floor(Date.now() / 1000) }
  }
  throw new Error(`HTTP ${status}`)
}

const formatExpireAt = (date) => {
  const pad = (value) => String(value).padStart(2, '0')
  try {
    const parts = new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).formatToParts(date)
    const get = (type) => parts.find(p => p.type === type)?.value || ''
    return `${get('year')}/${get('month')}/${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`
  } catch {
    return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  }
}

const normalizeExpireAt = (value) => {
  if (value == null) return null
  const raw = String(value).trim()
  if (!raw) return null
  if (EXPIRE_AT_REGEX.test(raw)) return raw

  // 支持 YYYY-MM-DD HH:mm:ss 或 YYYY/MM/DDTHH:mm:ss 格式
  const match = raw.match(/^(\d{4})[-/](\d{2})[-/](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/)
  if (match) {
    const seconds = match[6] || '00'
    return `${match[1]}/${match[2]}/${match[3]} ${match[4]}:${match[5]}:${seconds}`
  }

  const asNumber = Number(raw)
  if (Number.isFinite(asNumber) && asNumber > 0) {
    const date = new Date(asNumber)
    if (!Number.isNaN(date.getTime())) {
      return formatExpireAt(date)
    }
  }

  return null
}

const collectEmails = (payload) => {
  if (!payload) return []
  if (Array.isArray(payload)) return payload
  if (Array.isArray(payload.emails)) return payload.emails
  if (typeof payload.emails === 'string') return [payload.emails]
  if (typeof payload.email === 'string') return [payload.email]
  return []
}

const CHECK_STATUS_ALLOWED_RANGE_DAYS = new Set([7, 15, 30])
const MAX_CHECK_ACCOUNTS = 300
const CHECK_STATUS_CONCURRENCY = 3

const pad2 = (value) => String(value).padStart(2, '0')
const EXPIRE_AT_PARSE_REGEX = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/
const parseExpireAtToMs = (value) => {
  const raw = String(value ?? '').trim()
  if (!raw) return null
  const match = raw.match(EXPIRE_AT_PARSE_REGEX)
  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])
  const second = match[6] != null ? Number(match[6]) : 0

  if (![year, month, day, hour, minute, second].every(Number.isFinite)) return null
  if (month < 1 || month > 12) return null
  if (day < 1 || day > 31) return null
  if (hour < 0 || hour > 23) return null
  if (minute < 0 || minute > 59) return null
  if (second < 0 || second > 59) return null

  // NOTE: gpt_accounts.expire_at is stored as Asia/Shanghai time.
  const iso = `${match[1]}-${pad2(month)}-${pad2(day)}T${pad2(hour)}:${pad2(minute)}:${pad2(second)}+08:00`
  const parsed = Date.parse(iso)
  return Number.isNaN(parsed) ? null : parsed
}

const mapWithConcurrency = async (items, concurrency, fn) => {
  const list = Array.isArray(items) ? items : []
  const limit = Math.max(1, Number(concurrency) || 1)
  if (!list.length) return []

  const results = new Array(list.length)
  let cursor = 0

  const workers = Array.from({ length: Math.min(limit, list.length) }).map(async () => {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const index = cursor++
      if (index >= list.length) break
      results[index] = await fn(list[index], index)
    }
  })

  await Promise.all(workers)
  return results
}

const eachWithConcurrency = async (items, concurrency, fn) => {
  const list = Array.isArray(items) ? items : []
  const limit = Math.max(1, Number(concurrency) || 1)
  if (!list.length) return

  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, list.length) }).map(async () => {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const index = cursor++
      if (index >= list.length) break
      await fn(list[index], index)
    }
  })

  await Promise.all(workers)
}

const refreshAccessTokenWithRefreshToken = async (refreshToken) => {
  const normalized = String(refreshToken || '').trim()
  if (!normalized) {
    throw new AccountSyncError('该账号未配置 refresh token', 400)
  }

  const requestData = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: OPENAI_CLIENT_ID,
    refresh_token: normalized,
    scope: 'openid profile email'
  }).toString()

  const requestOptions = {
    method: 'POST',
    url: 'https://auth.openai.com/oauth/token',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': requestData.length
    },
    data: requestData,
    timeout: 60000
  }

  try {
    const response = await axios(requestOptions)
    if (response.status !== 200 || !response.data?.access_token) {
      throw new AccountSyncError('刷新 token 失败，未返回有效凭证', 502)
    }

    const resultData = response.data
    return {
      accessToken: resultData.access_token,
      refreshToken: resultData.refresh_token || normalized,
      idToken: resultData.id_token,
      expiresIn: resultData.expires_in || 3600
    }
  } catch (error) {
    if (error?.response) {
      const message =
        error.response.data?.error?.message ||
        error.response.data?.error_description ||
        error.response.data?.error ||
        '刷新 token 失败'

      throw new AccountSyncError(message, 502)
    }

    throw new AccountSyncError(error?.message || '刷新 token 网络错误', 503)
  }
}

const persistAccountTokens = async (db, accountId, tokens) => {
  if (!tokens?.accessToken) return null
  const nextRefreshToken = tokens.refreshToken ? String(tokens.refreshToken).trim() : ''

  db.run(
    `UPDATE gpt_accounts SET token = ?, refresh_token = ?, updated_at = DATETIME('now', 'localtime') WHERE id = ?`,
    [tokens.accessToken, nextRefreshToken || null, accountId]
  )
  await saveDatabase()
  return { accessToken: tokens.accessToken, refreshToken: nextRefreshToken || null }
}

const loadAccountsForStatusCheck = async (db, { threshold }) => {
  const countResult = db.exec(
    `SELECT COUNT(*) FROM gpt_accounts WHERE created_at >= DATETIME('now', 'localtime', ?) AND COALESCE(is_banned, 0) = 0`,
    [threshold]
  )
  const totalEligible = Number(countResult[0]?.values?.[0]?.[0] || 0)

  const dataResult = db.exec(
    `
      SELECT id,
             email,
             token,
             refresh_token,
             user_count,
             invite_count,
             chatgpt_account_id,
             oai_device_id,
             expire_at,
             is_open,
             COALESCE(is_banned, 0) AS is_banned,
             created_at,
             updated_at,
             plan_type
      FROM gpt_accounts
      WHERE created_at >= DATETIME('now', 'localtime', ?)
        AND COALESCE(is_banned, 0) = 0
      ORDER BY created_at DESC
      LIMIT ?
    `,
    [threshold, MAX_CHECK_ACCOUNTS]
  )

  const rows = dataResult[0]?.values || []
  const accounts = rows.map(row => ({
    id: Number(row[0]),
    email: String(row[1] || ''),
    token: row[2] || '',
    refreshToken: row[3] || null,
    userCount: Number(row[4] || 0),
    inviteCount: Number(row[5] || 0),
    chatgptAccountId: row[6] || '',
    oaiDeviceId: row[7] || '',
    expireAt: row[8] || null,
    isOpen: Boolean(row[9]),
    isDemoted: false,
    isBanned: Boolean(row[10]),
    createdAt: row[11],
    updatedAt: row[12],
    planType: row[13] || null
  }))

  const truncated = totalEligible > accounts.length
  const skipped = truncated ? Math.max(0, totalEligible - accounts.length) : 0

  return {
    totalEligible,
    accounts,
    truncated,
    skipped
  }
}

// 通过 check/v4 API 验证 token 并识别账号类型
const verifyAndDetectPlanType = async (token) => {
  const allAccounts = await fetchOpenAiAccountInfo(token)
  if (allAccounts.length === 0) return null

  // 优先返回 team 类型账号，其次 plus，最后 free
  const sorted = [...allAccounts].sort((a, b) => {
    const priority = { team: 0, plus: 1, free: 2 }
    return (priority[a.planType] ?? 3) - (priority[b.planType] ?? 3)
  })
  return sorted
}

// 同步检查结果到数据库：plan_type、chatgpt_account_id
const persistCheckResult = (db, accountId, info) => {
  if (!info) return
  const updates = ['plan_type = ?', 'updated_at = DATETIME(\'now\', \'localtime\')']
  const params = [info.planType || null]
  if (info.accountId) {
    updates.push('chatgpt_account_id = ?')
    params.push(info.accountId)
  }
  params.push(accountId)
  db.run(`UPDATE gpt_accounts SET ${updates.join(', ')} WHERE id = ?`, params)
}

const checkSingleAccountStatus = async (db, account, nowMs) => {
  const base = {
    id: account.id,
    email: account.email,
    createdAt: account.createdAt,
    expireAt: account.expireAt || null,
    planType: account.planType || null,
    refreshed: false
  }

  if (account.isBanned) {
    return { ...base, status: 'banned', reason: null }
  }

  const expireAtMs = parseExpireAtToMs(account.expireAt)
  if (expireAtMs != null && expireAtMs < nowMs) {
    return { ...base, status: 'expired', reason: 'expireAt 已过期' }
  }

  // 统一验证流程：check/v4 检测 token 有效性 + 识别账号类型
  const verifyAccount = async (acct) => {
    const accountInfoList = await verifyAndDetectPlanType(acct.token)
    if (!accountInfoList || accountInfoList.length === 0) {
      throw new Error('未找到关联的 ChatGPT 账号')
    }

    // 匹配当前账号的 chatgptAccountId（如果有）
    const currentChatgptId = String(acct.chatgptAccountId || '').trim()
    let matched = currentChatgptId
      ? accountInfoList.find(a => a.accountId === currentChatgptId)
      : null

    // 没匹配到，取优先级最高的
    if (!matched) matched = accountInfoList[0]

    // 保存到数据库
    persistCheckResult(db, acct.id, matched)
    base.planType = matched.planType

    // Team 账号额外验证用户列表是否可访问
    if (matched.planType === 'team' && matched.accountId) {
      const verifyAcct = { ...acct, chatgptAccountId: matched.accountId }
      try {
        await fetchAccountUsersList(acct.id, {
          accountRecord: verifyAcct,
          userListParams: { offset: 0, limit: 1, query: '' }
        })
      } catch (teamErr) {
        // Team 用户列表访问失败不影响整体判断，仅记录原因
        const msg = teamErr?.message || ''
        if (msg.includes('account_deactivated') || msg.includes('已自动标记为封号')) {
          throw teamErr
        }
        // 其他 team 错误（如权限不足）仅作为提示，不改变状态
      }
    }

    return matched
  }

  try {
    await verifyAccount(account)
    return { ...base, status: 'normal', reason: null }
  } catch (error) {
    const message = error?.message ? String(error.message) : String(error || '')
    const status = Number(error?.status || 0)

    if (message.includes('account_deactivated') || message.includes('已自动标记为封号')) {
      return { ...base, status: 'banned', reason: message || null }
    }

    if (status === 401) {
      const storedRefreshToken = String(account.refreshToken || '').trim()
      if (!storedRefreshToken) {
        return { ...base, status: 'expired', reason: message || 'Token 已过期或无效（未配置 refresh token）' }
      }

      // 尝试刷新 token 后重新检查
      try {
        const refreshedTokens = await refreshAccessTokenWithRefreshToken(storedRefreshToken)
        const persisted = await persistAccountTokens(db, account.id, refreshedTokens)

        const nextAccount = {
          ...account,
          token: persisted?.accessToken || account.token,
          refreshToken: persisted?.refreshToken || account.refreshToken
        }

        try {
          await verifyAccount(nextAccount)
          return { ...base, status: 'normal', refreshed: true, reason: 'Token 已自动刷新' }
        } catch (recheckError) {
          const reMsg = recheckError?.message ? String(recheckError.message) : String(recheckError || '')
          const reStatus = Number(recheckError?.status || 0)

          if (reMsg.includes('account_deactivated') || reMsg.includes('已自动标记为封号')) {
            return { ...base, status: 'banned', refreshed: true, reason: reMsg || null }
          }
          if (reStatus === 401) {
            return { ...base, status: 'expired', refreshed: true, reason: '刷新后仍无效' }
          }
          return { ...base, status: 'failed', refreshed: true, reason: reMsg || '刷新后校验失败' }
        }
      } catch (refreshError) {
        const refreshMsg = refreshError?.message ? String(refreshError.message) : String(refreshError || '')
        return { ...base, status: 'expired', reason: `refresh token 刷新失败：${refreshMsg}` }
      }
    }

    return { ...base, status: 'failed', reason: message || '检查失败' }
  }
}

// 使用系统设置中的 API 密钥（x-api-key）标记账号为“封号”
router.post('/ban', apiKeyAuth, async (req, res) => {
  try {
    const rawEmails = collectEmails(req.body)
    const emails = [...new Set(rawEmails.map(normalizeEmail).filter(Boolean))]

    if (emails.length === 0) {
      return res.status(400).json({ error: 'emails is required' })
    }
    if (emails.length > 500) {
      return res.status(400).json({ error: 'emails is too large (max 500)' })
    }

    const db = await getDatabase()
    const placeholders = emails.map(() => '?').join(',')

    const existing = db.exec(
      `
        SELECT id, email
        FROM gpt_accounts
        WHERE LOWER(email) IN (${placeholders})
      `,
      emails
    )

    const matched = (existing[0]?.values || [])
      .map(row => ({
        id: Number(row[0]),
        email: String(row[1] || '')
      }))
      .filter(item => Number.isFinite(item.id) && item.email)

    const matchedSet = new Set(matched.map(item => normalizeEmail(item.email)))
    const notFound = emails.filter(email => !matchedSet.has(email))

    if (matched.length > 0) {
      db.run(
        `
          UPDATE gpt_accounts
          SET is_open = 0,
              is_banned = 1,
              updated_at = DATETIME('now', 'localtime')
          WHERE LOWER(email) IN (${placeholders})
        `,
        emails
      )
      saveDatabase()
    }

    return res.json({
      message: 'ok',
      updated: matched.length,
      matched,
      notFound
    })
  } catch (error) {
    console.error('Ban GPT accounts by email error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

router.use(authenticateToken, requireMenu('accounts'))

// 校验 access token，并返回可用的 Team 账号列表（用于新建账号时选择 chatgptAccountId）
router.post('/check-token', async (req, res) => {
  try {
    const { token, proxy } = req.body || {}
    const normalizedToken = String(token ?? '').trim()
    if (!normalizedToken) {
      return res.status(400).json({ error: 'token is required' })
    }

    const accounts = await fetchOpenAiAccountInfo(normalizedToken, proxy ?? null)
    return res.json({ accounts })
  } catch (error) {
    console.error('Check GPT token error:', error)

    if (error instanceof AccountSyncError || error?.status) {
      return res.status(error.status || 500).json({ error: error.message })
    }

    return res.status(500).json({ error: '内部服务器错误' })
  }
})

// 通过 Refresh Token 快速添加账号（自动获取 email 和 plan type）
router.post('/login-by-refresh-token', async (req, res) => {
  try {
    const { refreshToken } = req.body || {}
    const normalized = String(refreshToken || '').trim()
    if (!normalized) {
      return res.status(400).json({ error: 'refreshToken is required' })
    }

    // 1. 换取 access token + id_token
    const tokens = await refreshAccessTokenWithRefreshToken(normalized)
    const { accessToken, refreshToken: newRefreshToken, idToken } = tokens

    // 2. 从 id_token (JWT) 的 payload 中解析 email
    let email = null
    if (idToken) {
      try {
        const parts = idToken.split('.')
        if (parts.length >= 2) {
          const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf-8'))
          email = payload.email || null
        }
      } catch {
        // 忽略解码错误
      }
    }

    if (!email) {
      return res.status(400).json({ error: '无法从 token 中提取邮箱，请使用手动添加模式填写账号信息' })
    }
    const normalizedEmail = normalizeEmail(email)

    // 3. 通过 check/v4 API 获取 plan type 和 chatgptAccountId
    let planType = null
    let chatgptAccountId = null
    try {
      const accountInfoList = await verifyAndDetectPlanType(accessToken)
      if (accountInfoList && accountInfoList.length > 0) {
        planType = accountInfoList[0].planType || null
        chatgptAccountId = accountInfoList[0].accountId || null
      }
    } catch {
      // 获取 plan type 失败不影响账号创建
    }

    const db = await getDatabase()
    const SELECT_FIELDS = `id, email, token, refresh_token, user_count, invite_count, chatgpt_account_id, oai_device_id, expire_at, is_open,
           COALESCE(is_banned, 0) AS is_banned, created_at, updated_at, plan_type`

    const mapRow = (row) => ({
      id: row[0],
      email: row[1],
      token: row[2],
      refreshToken: row[3],
      userCount: row[4],
      inviteCount: row[5],
      chatgptAccountId: row[6],
      oaiDeviceId: row[7],
      expireAt: row[8] || null,
      isOpen: Boolean(row[9]),
      isDemoted: false,
      isBanned: Boolean(row[10]),
      createdAt: row[11],
      updatedAt: row[12],
      planType: row[13] || null
    })

    // 4. 检查账号是否已存在（按邮箱查重）
    const existing = db.exec(`SELECT id FROM gpt_accounts WHERE LOWER(email) = ?`, [normalizedEmail])
    const existingId = existing[0]?.values?.[0]?.[0]

    if (existingId) {
      // 更新已有账号的 token 信息
      db.run(
        `UPDATE gpt_accounts
         SET token = ?, refresh_token = ?, plan_type = ?,
             chatgpt_account_id = COALESCE(NULLIF(?, ''), chatgpt_account_id),
             updated_at = DATETIME('now', 'localtime')
         WHERE id = ?`,
        [accessToken, newRefreshToken || null, planType, chatgptAccountId || '', existingId]
      )
      await saveDatabase()
      const r = db.exec(`SELECT ${SELECT_FIELDS} FROM gpt_accounts WHERE id = ?`, [existingId])
      return res.json({ account: mapRow(r[0].values[0]), updated: true, message: '账号 token 已更新' })
    } else {
      // 创建新账号
      db.run(
        `INSERT INTO gpt_accounts (email, token, refresh_token, user_count, plan_type, chatgpt_account_id, created_at, updated_at)
         VALUES (?, ?, ?, 1, ?, ?, DATETIME('now', 'localtime'), DATETIME('now', 'localtime'))`,
        [normalizedEmail, accessToken, newRefreshToken || null, planType, chatgptAccountId || null]
      )
      await saveDatabase()
      const r = db.exec(`SELECT ${SELECT_FIELDS} FROM gpt_accounts WHERE id = last_insert_rowid()`)
      return res.json({ account: mapRow(r[0].values[0]), updated: false, message: '账号创建成功' })
    }
  } catch (error) {
    console.error('Login by refresh token error:', error)
    if (error instanceof AccountSyncError || error?.status) {
      return res.status(error.status || 500).json({ error: error.message })
    }
    return res.status(500).json({ error: '内部服务器错误' })
  }
})

// 批量检查指定时间范围内创建的账号状态（封号 / 过期 / 正常 / 失败）
router.post('/check-status', async (req, res) => {
  try {
    const rangeDays = Number.parseInt(String(req.body?.rangeDays ?? ''), 10)
    if (!CHECK_STATUS_ALLOWED_RANGE_DAYS.has(rangeDays)) {
      return res.status(400).json({ error: 'rangeDays must be one of 7, 15, 30' })
    }

    const threshold = `-${rangeDays} days`
    const db = await getDatabase()

    const { totalEligible, accounts, truncated, skipped } = await loadAccountsForStatusCheck(db, { threshold })
    const nowMs = Date.now()
    const items = await mapWithConcurrency(accounts, CHECK_STATUS_CONCURRENCY, async (account) => {
      return await checkSingleAccountStatus(db, account, nowMs)
    })

    const summary = { normal: 0, expired: 0, banned: 0, failed: 0 }
    let refreshedCount = 0
    for (const item of items) {
      if (!item || typeof item.status !== 'string') continue
      if (Object.prototype.hasOwnProperty.call(summary, item.status)) {
        summary[item.status] += 1
      }
      if (item.refreshed) {
        refreshedCount += 1
      }
    }

    return res.json({
      message: 'ok',
      rangeDays,
      checkedTotal: items.length,
      summary,
      refreshedCount,
      items,
      truncated,
      skipped
    })
  } catch (error) {
    console.error('Check GPT account status error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

// SSE: 批量检查账号状态，并实时推送进度（text/event-stream）
router.get('/check-status/stream', async (req, res) => {
  try {
    const rangeDays = Number.parseInt(String(req.query?.rangeDays ?? ''), 10)
    if (!CHECK_STATUS_ALLOWED_RANGE_DAYS.has(rangeDays)) {
      return res.status(400).json({ error: 'rangeDays must be one of 7, 15, 30' })
    }

    const threshold = `-${rangeDays} days`
    const db = await getDatabase()
    const { accounts, truncated, skipped } = await loadAccountsForStatusCheck(db, { threshold })

    res.status(200)
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, private')
    res.setHeader('Connection', 'keep-alive')
    // Hint Nginx not to buffer (best-effort).
    res.setHeader('X-Accel-Buffering', 'no')
    res.flushHeaders?.()

    const sendEvent = (event, payload) => {
      if (res.writableEnded) return
      const data = payload == null ? '' : JSON.stringify(payload)
      res.write(`event: ${event}\n`)
      if (data) {
        res.write(`data: ${data}\n`)
      } else {
        res.write('data: {}\n')
      }
      res.write('\n')
    }

    let closed = false
    req.on('close', () => {
      closed = true
    })

    // Keep the connection active behind proxies (default read timeout is often ~60s).
    const keepAliveTimer = setInterval(() => {
      if (closed || res.writableEnded) return
      try {
        res.write(': ping\n\n')
      } catch {
        // ignore
      }
    }, 15000)

    const total = accounts.length
    sendEvent('meta', { rangeDays, total, truncated, skipped })
    sendEvent('progress', { processed: 0, total, percent: total ? 0 : 100 })

    const nowMs = Date.now()
    const summary = { normal: 0, expired: 0, banned: 0, failed: 0 }
    let refreshedCount = 0
    let processed = 0

    try {
      await eachWithConcurrency(accounts, CHECK_STATUS_CONCURRENCY, async (account) => {
        if (closed) return

        const item = await checkSingleAccountStatus(db, account, nowMs)

        processed += 1
        if (Object.prototype.hasOwnProperty.call(summary, item.status)) {
          summary[item.status] += 1
        }
        if (item.refreshed) {
          refreshedCount += 1
        }

        const percent = total ? Math.round((processed / total) * 100) : 100
        sendEvent('item', item)
        sendEvent('progress', { processed, total, percent })
      })

      if (!closed) {
        sendEvent('done', {
          message: 'ok',
          rangeDays,
          checkedTotal: processed,
          summary,
          refreshedCount,
          truncated,
          skipped
        })
      }
    } catch (error) {
      if (!closed) {
        const message = error?.message ? String(error.message) : 'Internal server error'
        sendEvent('error', { error: message })
      }
    } finally {
      clearInterval(keepAliveTimer)
      try {
        res.end()
      } catch {
        // ignore
      }
    }
  } catch (error) {
    console.error('Check GPT account status (SSE) error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

// 获取账号列表（支持分页、搜索、筛选）
router.get('/', async (req, res) => {
  try {
    const db = await getDatabase()
    const page = Math.max(1, Number(req.query.page) || 1)
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 10))
    const search = (req.query.search || '').trim().toLowerCase()
    const openStatus = req.query.openStatus // 'open' | 'closed' | undefined
    const planType = req.query.planType // 'team' | 'plus' | 'free' | undefined
    const accountStatus = req.query.accountStatus // 'normal' | 'expired' | 'banned' | undefined

    // 构建 WHERE 条件
    const conditions = []
    const params = []

    if (search) {
      conditions.push(`(LOWER(email) LIKE ? OR LOWER(token) LIKE ? OR LOWER(refresh_token) LIKE ? OR LOWER(chatgpt_account_id) LIKE ?)`)
      const searchPattern = `%${search}%`
      params.push(searchPattern, searchPattern, searchPattern, searchPattern)
    }

    if (openStatus === 'open') {
      conditions.push('is_open = 1')
    } else if (openStatus === 'closed') {
      conditions.push('(is_open = 0 OR is_open IS NULL)')
    }

    if (planType === 'free') {
      conditions.push(`(plan_type = 'free' OR (plan_type IS NULL AND (chatgpt_account_id IS NULL OR chatgpt_account_id = '')))`)
    } else if (planType) {
      conditions.push('plan_type = ?')
      params.push(planType)
    }

    if (accountStatus === 'banned') {
      conditions.push('COALESCE(is_banned, 0) = 1')
    } else if (accountStatus === 'expired') {
      conditions.push(`COALESCE(is_banned, 0) = 0 AND expire_at IS NOT NULL AND TRIM(expire_at) != '' AND DATETIME(REPLACE(expire_at, '/', '-')) < DATETIME('now', 'localtime')`)
    } else if (accountStatus === 'normal') {
      conditions.push(`COALESCE(is_banned, 0) = 0 AND (expire_at IS NULL OR TRIM(expire_at) = '' OR DATETIME(REPLACE(expire_at, '/', '-')) IS NULL OR DATETIME(REPLACE(expire_at, '/', '-')) >= DATETIME('now', 'localtime'))`)
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    // 查询总数
    const countResult = db.exec(`SELECT COUNT(*) FROM gpt_accounts ${whereClause}`, params)
    const total = countResult[0]?.values?.[0]?.[0] || 0

	    // 查询分页数据
	    const offset = (page - 1) * pageSize
	    const dataResult = db.exec(`
	      SELECT id, email, token, refresh_token, user_count, invite_count, chatgpt_account_id, oai_device_id, expire_at, is_open,
	             COALESCE(is_banned, 0) AS is_banned,
	             created_at, updated_at, plan_type, quota_json
	      FROM gpt_accounts
	      ${whereClause}
	      ORDER BY created_at DESC
	      LIMIT ? OFFSET ?
	    `, [...params, pageSize, offset])

	    const accounts = (dataResult[0]?.values || []).map(row => ({
	      id: row[0],
	      email: row[1],
	      token: row[2],
	      refreshToken: row[3],
	      userCount: row[4],
	      inviteCount: row[5],
	      chatgptAccountId: row[6],
	      oaiDeviceId: row[7],
	      expireAt: row[8] || null,
	      isOpen: Boolean(row[9]),
	      isDemoted: false,
	      isBanned: Boolean(row[10]),
	      createdAt: row[11],
	      updatedAt: row[12],
	      planType: row[13] || null,
	      quota: row[14] ? (() => { try { return JSON.parse(row[14]) } catch { return null } })() : null
	    }))

    res.json({
      accounts,
      pagination: { page, pageSize, total }
    })
  } catch (error) {
    console.error('Get GPT accounts error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Get a single GPT account
router.get('/:id', async (req, res) => {
  try {
	    const db = await getDatabase()
	    const result = db.exec(`
	      SELECT id, email, token, refresh_token, user_count, invite_count, chatgpt_account_id, oai_device_id, expire_at, is_open,
	             COALESCE(is_banned, 0) AS is_banned,
	             created_at, updated_at, plan_type, quota_json
	      FROM gpt_accounts
	      WHERE id = ?
	    `, [req.params.id])

    if (result.length === 0 || result[0].values.length === 0) {
      return res.status(404).json({ error: 'Account not found' })
    }

    const row = result[0].values[0]
	    const account = {
	      id: row[0],
	      email: row[1],
	      token: row[2],
	      refreshToken: row[3],
	      userCount: row[4],
		      inviteCount: row[5],
		      chatgptAccountId: row[6],
		      oaiDeviceId: row[7],
		      expireAt: row[8] || null,
		      isOpen: Boolean(row[9]),
		      isDemoted: false,
		      isBanned: Boolean(row[10]),
		      createdAt: row[11],
		      updatedAt: row[12],
		      planType: row[13] || null,
		      quota: row[14] ? (() => { try { return JSON.parse(row[14]) } catch { return null } })() : null
		    }

    res.json(account)
  } catch (error) {
    console.error('Get GPT account error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Create a new GPT account
router.post('/', async (req, res) => {
  try {
    const body = req.body || {}
    const { email, token, refreshToken, userCount, chatgptAccountId, oaiDeviceId, expireAt } = body

    // isDemoted/is_demoted: deprecated (ignored).

    const hasIsBanned = Object.prototype.hasOwnProperty.call(body, 'isBanned') || Object.prototype.hasOwnProperty.call(body, 'is_banned')
    const isBannedInput = Object.prototype.hasOwnProperty.call(body, 'isBanned') ? body.isBanned : body.is_banned
    const normalizedIsBanned = hasIsBanned ? normalizeBoolean(isBannedInput) : null
    if (hasIsBanned && normalizedIsBanned === null) {
      return res.status(400).json({ error: 'Invalid isBanned format' })
    }
    const isBannedValue = normalizedIsBanned ? 1 : 0

    const normalizedChatgptAccountId = String(chatgptAccountId ?? '').trim()
    const normalizedOaiDeviceId = String(oaiDeviceId ?? '').trim()
    const normalizedExpireAt = normalizeExpireAt(expireAt)

    if (!email || !token) {
      return res.status(400).json({ error: 'Email and token are required' })
    }

    if (expireAt != null && String(expireAt).trim() && !normalizedExpireAt) {
      return res.status(400).json({
        error: 'Invalid expireAt format',
        message: 'expireAt 格式错误，请使用 YYYY/MM/DD HH:mm'
      })
    }

    const normalizedEmail = normalizeEmail(email)

    const db = await getDatabase()

    // 设置默认人数为1而不是0
    const finalUserCount = userCount !== undefined ? userCount : 1

    db.run(
      `INSERT INTO gpt_accounts (email, token, refresh_token, user_count, chatgpt_account_id, oai_device_id, expire_at, is_banned, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, DATETIME('now', 'localtime'), DATETIME('now', 'localtime'))`,
      [normalizedEmail, token, refreshToken || null, finalUserCount, normalizedChatgptAccountId, normalizedOaiDeviceId || null, normalizedExpireAt, isBannedValue]
    )

		    // 获取新创建账号的ID
		    const accountResult = db.exec(`
		      SELECT id, email, token, refresh_token, user_count, invite_count, chatgpt_account_id, oai_device_id, expire_at, is_open,
		             COALESCE(is_banned, 0) AS is_banned,
		             created_at, updated_at, plan_type
		      FROM gpt_accounts
		      WHERE id = last_insert_rowid()
		    `)
    const row = accountResult[0].values[0]
	    const account = {
	      id: row[0],
	      email: row[1],
	      token: row[2],
	      refreshToken: row[3],
	      userCount: row[4],
		      inviteCount: row[5],
		      chatgptAccountId: row[6],
		      oaiDeviceId: row[7],
		      expireAt: row[8] || null,
		      isOpen: Boolean(row[9]),
		      isDemoted: false,
		      isBanned: Boolean(row[10]),
		      createdAt: row[11],
		      updatedAt: row[12],
		      planType: row[13] || null
		    }

    // 生成随机兑换码的辅助函数
    function generateRedemptionCode(length = 12) {
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // 排除容易混淆的字符
      let code = ''
      for (let i = 0; i < length; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length))
        // 每4位添加一个分隔符
        if ((i + 1) % 4 === 0 && i < length - 1) {
          code += '-'
        }
      }
      return code
    }

    // 自动生成兑换码并绑定到该账号
    // Team 账号默认总容量 5，新建账号默认人数按 1 计算，所以默认生成 4 个兑换码
    const totalCapacity = 5
    const currentUserCountForCodes = Math.max(1, Number(finalUserCount) || 1)
    const codesToGenerate = Math.max(0, totalCapacity - currentUserCountForCodes)

    const generatedCodes = []
    for (let i = 0; i < codesToGenerate; i++) {
      let code = generateRedemptionCode()
      let attempts = 0
      let success = false

      // 尝试生成唯一的兑换码（最多重试5次）
      while (attempts < 5 && !success) {
        try {
          db.run(
            `INSERT INTO redemption_codes (code, account_email, created_at, updated_at) VALUES (?, ?, DATETIME('now', 'localtime'), DATETIME('now', 'localtime'))`,
            [code, normalizedEmail]
          )
          generatedCodes.push(code)
          success = true
        } catch (err) {
          if (err.message.includes('UNIQUE')) {
            // 如果重复，重新生成
            code = generateRedemptionCode()
            attempts++
          } else {
            throw err
          }
        }
      }
    }

    saveDatabase()

    // 获取生成的兑换码信息
    const codesResult = db.exec(`
      SELECT code FROM redemption_codes
      WHERE account_email = ?
      ORDER BY created_at DESC
    `, [normalizedEmail])

    const codes = codesResult[0]?.values.map(row => row[0]) || []

    res.status(201).json({
      account,
      generatedCodes: codes,
      message: `账号创建成功，已自动生成${codes.length}个兑换码`
    })
  } catch (error) {
    console.error('Create GPT account error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Update a GPT account
router.put('/:id', async (req, res) => {
  try {
    const body = req.body || {}
    const { email, token, refreshToken, userCount, chatgptAccountId, oaiDeviceId, expireAt } = body

    const normalizedChatgptAccountId = String(chatgptAccountId ?? '').trim()
    const normalizedOaiDeviceId = String(oaiDeviceId ?? '').trim()
    const hasExpireAt = Object.prototype.hasOwnProperty.call(body, 'expireAt')
    const normalizedExpireAt = hasExpireAt ? normalizeExpireAt(expireAt) : null

    // isDemoted/is_demoted: deprecated (ignored).

    const hasIsBanned = Object.prototype.hasOwnProperty.call(body, 'isBanned') || Object.prototype.hasOwnProperty.call(body, 'is_banned')
    const isBannedInput = Object.prototype.hasOwnProperty.call(body, 'isBanned') ? body.isBanned : body.is_banned
    const normalizedIsBanned = hasIsBanned ? normalizeBoolean(isBannedInput) : null
    if (hasIsBanned && normalizedIsBanned === null) {
      return res.status(400).json({ error: 'Invalid isBanned format' })
    }
    const shouldUpdateIsBanned = hasIsBanned
    const isBannedValue = normalizedIsBanned ? 1 : 0
    const shouldApplyBanSideEffects = shouldUpdateIsBanned && isBannedValue === 1

    if (!email || !token) {
      return res.status(400).json({ error: 'Email and token are required' })
    }

    if (hasExpireAt && expireAt != null && String(expireAt).trim() && !normalizedExpireAt) {
      return res.status(400).json({
        error: 'Invalid expireAt format',
        message: 'expireAt 格式错误，请使用 YYYY/MM/DD HH:mm'
      })
    }

    const db = await getDatabase()

    // Check if account exists
    const checkResult = db.exec('SELECT id, email FROM gpt_accounts WHERE id = ?', [req.params.id])
    if (checkResult.length === 0 || checkResult[0].values.length === 0) {
      return res.status(404).json({ error: 'Account not found' })
    }

    const existingEmail = checkResult[0].values[0][1]

    db.run(
      `UPDATE gpt_accounts
       SET email = ?,
           token = ?,
           refresh_token = ?,
           user_count = ?,
           chatgpt_account_id = ?,
           oai_device_id = ?,
           expire_at = CASE WHEN ? = 1 THEN ? ELSE expire_at END,
           is_banned = CASE WHEN ? = 1 THEN ? ELSE is_banned END,
           is_open = CASE WHEN ? = 1 THEN 0 ELSE is_open END,
           ban_processed = CASE WHEN ? = 1 THEN 0 ELSE ban_processed END,
           updated_at = DATETIME('now', 'localtime')
       WHERE id = ?`,
      [
        email,
        token,
        refreshToken || null,
        userCount || 0,
        normalizedChatgptAccountId,
        normalizedOaiDeviceId || null,
        hasExpireAt ? 1 : 0,
        normalizedExpireAt,
        shouldUpdateIsBanned ? 1 : 0,
        isBannedValue,
        shouldApplyBanSideEffects ? 1 : 0,
        shouldApplyBanSideEffects ? 1 : 0,
        req.params.id
      ]
    )

    if (existingEmail && existingEmail !== email) {
      db.run(
        `UPDATE redemption_codes SET account_email = ?, updated_at = DATETIME('now', 'localtime') WHERE account_email = ?`,
        [email, existingEmail]
      )
    }
    saveDatabase()

		    // Get the updated account
		    const result = db.exec(`
		      SELECT id, email, token, refresh_token, user_count, invite_count, chatgpt_account_id, oai_device_id, expire_at, is_open,
		             COALESCE(is_banned, 0) AS is_banned,
		             created_at, updated_at, plan_type
		      FROM gpt_accounts
		      WHERE id = ?
		    `, [req.params.id])
    const row = result[0].values[0]
	    const account = {
	      id: row[0],
	      email: row[1],
	      token: row[2],
	      refreshToken: row[3],
	      userCount: row[4],
		      inviteCount: row[5],
		      chatgptAccountId: row[6],
		      oaiDeviceId: row[7],
		      expireAt: row[8] || null,
		      isOpen: Boolean(row[9]),
		      isDemoted: false,
		      isBanned: Boolean(row[10]),
		      createdAt: row[11],
		      updatedAt: row[12],
		      planType: row[13] || null
		    }

    res.json(account)
  } catch (error) {
    console.error('Update GPT account error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// 设置账号是否开放展示
router.patch('/:id/open', async (req, res) => {
  try {
    const { isOpen } = req.body || {}
    if (typeof isOpen !== 'boolean') {
      return res.status(400).json({ error: 'isOpen must be a boolean' })
    }

	    const db = await getDatabase()

	    const checkResult = db.exec('SELECT id, COALESCE(is_banned, 0) AS is_banned FROM gpt_accounts WHERE id = ?', [req.params.id])
	    if (checkResult.length === 0 || checkResult[0].values.length === 0) {
	      return res.status(404).json({ error: 'Account not found' })
	    }

	    const isBanned = Boolean(checkResult[0].values[0][1])
	    if (isOpen && isBanned) {
	      return res.status(400).json({ error: '账号已封号，不能设置为开放账号' })
	    }

	    db.run(
	      `UPDATE gpt_accounts SET is_open = ?, updated_at = DATETIME('now', 'localtime') WHERE id = ?`,
	      [isOpen ? 1 : 0, req.params.id]
	    )
	    saveDatabase()

		    const result = db.exec(
		      `
		        SELECT id, email, token, refresh_token, user_count, invite_count, chatgpt_account_id, oai_device_id, expire_at, is_open,
		               COALESCE(is_banned, 0) AS is_banned,
		               created_at, updated_at
		        FROM gpt_accounts
		        WHERE id = ?
		      `,
		      [req.params.id]
		    )
	    const row = result[0].values[0]
	    const account = {
	      id: row[0],
	      email: row[1],
	      token: row[2],
	      refreshToken: row[3],
	      userCount: row[4],
		      inviteCount: row[5],
		      chatgptAccountId: row[6],
		      oaiDeviceId: row[7],
		      expireAt: row[8] || null,
		      isOpen: Boolean(row[9]),
		      isDemoted: false,
		      isBanned: Boolean(row[10]),
		      createdAt: row[11],
		      updatedAt: row[12]
		    }

    res.json(account)
  } catch (error) {
    console.error('Update GPT account open status error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// 标记账号为封号（后台手动操作）
router.patch('/:id/ban', async (req, res) => {
  try {
    const accountId = Number(req.params.id)
    if (!Number.isFinite(accountId)) {
      return res.status(400).json({ error: 'Invalid account id' })
    }

    const db = await getDatabase()
    const checkResult = db.exec('SELECT id FROM gpt_accounts WHERE id = ?', [accountId])
    if (checkResult.length === 0 || checkResult[0].values.length === 0) {
      return res.status(404).json({ error: 'Account not found' })
    }

    db.run(
      `
        UPDATE gpt_accounts
        SET is_open = 0,
            is_banned = 1,
            ban_processed = 0,
            updated_at = DATETIME('now', 'localtime')
        WHERE id = ?
      `,
      [accountId]
    )
    saveDatabase()

    const result = db.exec(
      `
        SELECT id, email, token, refresh_token, user_count, invite_count, chatgpt_account_id, oai_device_id, expire_at, is_open,
               COALESCE(is_banned, 0) AS is_banned,
               created_at, updated_at
        FROM gpt_accounts
        WHERE id = ?
      `,
      [accountId]
    )
    const row = result[0].values[0]
    const account = {
      id: row[0],
      email: row[1],
      token: row[2],
      refreshToken: row[3],
      userCount: row[4],
      inviteCount: row[5],
      chatgptAccountId: row[6],
      oaiDeviceId: row[7],
      expireAt: row[8] || null,
      isOpen: Boolean(row[9]),
      isDemoted: false,
      isBanned: Boolean(row[10]),
      createdAt: row[11],
      updatedAt: row[12]
    }

    res.json(account)
  } catch (error) {
    console.error('Ban GPT account error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Delete a GPT account
router.delete('/:id', async (req, res) => {
  try {
    const db = await getDatabase()

    // Check if account exists
    const checkResult = db.exec('SELECT id FROM gpt_accounts WHERE id = ?', [req.params.id])
    if (checkResult.length === 0 || checkResult[0].values.length === 0) {
      return res.status(404).json({ error: 'Account not found' })
    }

    db.run('DELETE FROM gpt_accounts WHERE id = ?', [req.params.id])
    saveDatabase()

    res.json({ message: 'Account deleted successfully' })
  } catch (error) {
    console.error('Delete GPT account error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// 批量删除账号
router.post('/batch-delete', async (req, res) => {
  try {
    const { ids } = req.body
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: '请提供要删除的账号 ID 列表' })
    }

    const db = await getDatabase()
    const placeholders = ids.map(() => '?').join(',')
    const countResult = db.exec(`SELECT COUNT(*) FROM gpt_accounts WHERE id IN (${placeholders})`, ids)
    const found = countResult[0]?.values?.[0]?.[0] || 0

    db.run(`DELETE FROM gpt_accounts WHERE id IN (${placeholders})`, ids)
    saveDatabase()

    res.json({ message: `已删除 ${found} 个账号`, deleted: found })
  } catch (error) {
    console.error('Batch delete GPT accounts error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// 同步账号用户数量
router.post('/:id/sync-user-count', async (req, res) => {
  try {
    const accountId = Number(req.params.id)
    const userSync = await syncAccountUserCount(accountId)
    const inviteSync = await syncAccountInviteCount(accountId, {
      accountRecord: userSync.account,
      inviteListParams: { offset: 0, limit: 1, query: '' }
    })
    res.json({
      message: '账号同步成功',
      account: inviteSync.account,
      syncedUserCount: userSync.syncedUserCount,
      inviteCount: inviteSync.inviteCount,
      users: userSync.users
    })
  } catch (error) {
    console.error('同步账号人数错误:', error)

    if (error instanceof AccountSyncError || error.status) {
      return res.status(error.status || 500).json({ error: error.message })
    }

    res.status(500).json({ error: '内部服务器错误' })
  }
})

router.delete('/:id/users/:userId', async (req, res) => {
  try {
    const { account, syncedUserCount, users } = await deleteAccountUser(Number(req.params.id), req.params.userId)
    res.json({
      message: '成员删除成功',
      account,
      syncedUserCount,
      users
    })
  } catch (error) {
    console.error('删除成员失败:', error)

    if (error instanceof AccountSyncError || error.status) {
      return res.status(error.status || 500).json({ error: error.message })
    }

    res.status(500).json({ error: '内部服务器错误' })
  }
})

router.post('/:id/invite-user', async (req, res) => {
  try {
    const { email } = req.body || {}
    if (!email) {
      return res.status(400).json({ error: '请提供邀请邮箱地址' })
    }
    const result = await inviteAccountUser(Number(req.params.id), email)
    let inviteCount = null
    try {
      const synced = await syncAccountInviteCount(Number(req.params.id), {
        inviteListParams: { offset: 0, limit: 1, query: '' }
      })
      inviteCount = synced.inviteCount
    } catch (syncError) {
      console.warn('邀请发送成功，但同步邀请数失败:', syncError?.message || syncError)
    }

    res.json({
      ...result,
      inviteCount
    })
  } catch (error) {
    console.error('邀请成员失败:', error)

    if (error instanceof AccountSyncError || error.status) {
      return res.status(error.status || 500).json({ error: error.message })
    }

    res.status(500).json({ error: '内部服务器错误' })
  }
})

// 查询已邀请列表（用于统计待加入人数）
router.get('/:id/invites', async (req, res) => {
  try {
    const { invites } = await syncAccountInviteCount(Number(req.params.id), {
      inviteListParams: req.query || {}
    })
    res.json(invites)
  } catch (error) {
    console.error('获取邀请列表失败:', error)

    if (error instanceof AccountSyncError || error.status) {
      return res.status(error.status || 500).json({ error: error.message })
    }

    res.status(500).json({ error: '内部服务器错误' })
  }
})

// 撤回邀请
router.delete('/:id/invites', async (req, res) => {
  try {
    const emailAddress = req.body?.email_address || req.body?.emailAddress || req.body?.email
    if (!emailAddress) {
      return res.status(400).json({ error: '请提供邀请邮箱地址' })
    }

    const result = await deleteAccountInvite(Number(req.params.id), emailAddress)
    res.json(result)
  } catch (error) {
    console.error('撤回邀请失败:', error)

    if (error instanceof AccountSyncError || error.status) {
      return res.status(error.status || 500).json({ error: error.message })
    }

    res.status(500).json({ error: '内部服务器错误' })
  }
})

// 获取账号的 Codex 配额（5h/7d 使用率），并保存到数据库
router.post('/:id/fetch-quota', async (req, res) => {
  try {
    const db = await getDatabase()
    const result = db.exec(
      'SELECT id, token, chatgpt_account_id FROM gpt_accounts WHERE id = ?',
      [req.params.id]
    )
    if (result.length === 0 || result[0].values.length === 0) {
      return res.status(404).json({ error: 'Account not found' })
    }
    const [id, token, chatgptAccountId] = result[0].values[0]
    if (!token) {
      return res.status(400).json({ error: '账号 token 为空，无法获取配额' })
    }

    const quota = await fetchCodexQuota(token, chatgptAccountId || null)
    const quotaJson = JSON.stringify(quota)

    db.run(
      `UPDATE gpt_accounts SET quota_json = ?, updated_at = DATETIME('now', 'localtime') WHERE id = ?`,
      [quotaJson, id]
    )
    await saveDatabase()
    return res.json({ quota })
  } catch (error) {
    console.error('Fetch quota error:', error)
    const msg = error?.message || '内部服务器错误'
    const status = msg.includes('401') ? 401 : 500
    return res.status(status).json({ error: msg })
  }
})

// 刷新账号的 access token
router.post('/:id/refresh-token', async (req, res) => {
  try {
    const db = await getDatabase()

	    const result = db.exec(
	      'SELECT id, email, token, refresh_token, user_count, invite_count, chatgpt_account_id, oai_device_id, expire_at, is_open, COALESCE(is_banned, 0) AS is_banned, created_at, updated_at FROM gpt_accounts WHERE id = ?',
	      [req.params.id]
	    )

    if (result.length === 0 || result[0].values.length === 0) {
      return res.status(404).json({ error: '账号不存在' })
    }

    const row = result[0].values[0]
    const refreshToken = row[3]

    if (!refreshToken) {
      return res.status(400).json({ error: '该账号未配置 refresh token' })
    }

    const requestData = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: OPENAI_CLIENT_ID,
      refresh_token: refreshToken,
      scope: 'openid profile email'
    }).toString()

    const requestOptions = {
      method: 'POST',
      url: 'https://auth.openai.com/oauth/token',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': requestData.length
      },
      data: requestData,
      timeout: 60000
    }

    const response = await axios(requestOptions)

    if (response.status !== 200 || !response.data?.access_token) {
      return res.status(500).json({ error: '刷新 token 失败，未返回有效凭证' })
    }

    const resultData = response.data

    db.run(
      `UPDATE gpt_accounts SET token = ?, refresh_token = ?, updated_at = DATETIME('now', 'localtime') WHERE id = ?`,
      [resultData.access_token, resultData.refresh_token || refreshToken, req.params.id]
    )
    saveDatabase()

	    const updatedResult = db.exec(
	      'SELECT id, email, token, refresh_token, user_count, invite_count, chatgpt_account_id, oai_device_id, expire_at, is_open, COALESCE(is_banned, 0) AS is_banned, created_at, updated_at, plan_type FROM gpt_accounts WHERE id = ?',
	      [req.params.id]
	    )
    const updatedRow = updatedResult[0].values[0]
	    const account = {
	      id: updatedRow[0],
	      email: updatedRow[1],
	      token: updatedRow[2],
	      refreshToken: updatedRow[3],
	      userCount: updatedRow[4],
	      inviteCount: updatedRow[5],
	      chatgptAccountId: updatedRow[6],
	      oaiDeviceId: updatedRow[7],
	      expireAt: updatedRow[8] || null,
	      isOpen: Boolean(updatedRow[9]),
	      isDemoted: false,
	      isBanned: Boolean(updatedRow[10]),
	      createdAt: updatedRow[11],
	      updatedAt: updatedRow[12],
	      planType: updatedRow[13] || null
	    }

    res.json({
      message: 'Token 刷新成功',
      account,
      accessToken: resultData.access_token,
      idToken: resultData.id_token,
      refreshToken: resultData.refresh_token || refreshToken,
      expiresIn: resultData.expires_in || 3600
    })
  } catch (error) {
    console.error('刷新 token 错误:', error?.response?.data || error.message || error)

    if (error.response) {
      const message =
        error.response.data?.error?.message ||
        error.response.data?.error_description ||
        error.response.data?.error ||
        '刷新 token 失败'

      // 不直接透传 OpenAI 的状态码，统一返回 502 表示上游服务错误
      return res.status(502).json({
        error: message,
        upstream_status: error.response.status
      })
    }

    res.status(500).json({ error: '刷新 token 时发生内部错误' })
  }
})

export default router
