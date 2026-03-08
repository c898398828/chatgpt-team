/**
 * 批量注册 API 路由
 * 提供注册控制、日志查看、配置管理、账号导入导出功能
 */
import express from 'express'
import bcrypt from 'bcryptjs'
import { getDatabase, saveDatabase } from '../database/init.js'
import { authenticateToken } from '../middleware/auth.js'
import { requireSuperAdmin } from '../middleware/rbac.js'
import { upsertSystemConfigValue } from '../utils/system-config.js'
import { getEmailDomainWhitelist, isEmailDomainAllowed } from '../utils/email-domain-whitelist.js'
import { getProxySettings } from '../utils/proxy-settings.js'
import { getRegisterSettings } from '../utils/register-settings.js'
import fs from 'fs'
import path from 'path'
import {
  startRegister,
  stopRegister,
  getStatus,
  getLogs,
  loadAccounts,
  getRegisterScriptDir,
} from '../services/batch-register.js'

const router = express.Router()
router.use(authenticateToken, requireSuperAdmin)

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const normalizeEmail = (v) => String(v || '').trim().toLowerCase()

// ==========================================
// 注册进程控制 API
// ==========================================

router.post('/start', (req, res) => {
  Promise.resolve().then(async () => {
    const db = await getDatabase()
    const proxySettings = await getProxySettings(db, { forceRefresh: true })
    const registerSettings = await getRegisterSettings(db, { forceRefresh: true })
    const { threads, once, targetCount } = req.body || {}
    const result = startRegister({
      proxy: String(proxySettings.chatgptProxyUrl || '').trim() || null,
      threads,
      once,
      targetCount,
      provider: registerSettings.emailProvider,
    })
    res.json(result)
  }).catch((error) => {
    console.error('[BatchRegister] start error:', error)
    res.status(500).json({ error: 'Internal server error' })
  })
})

router.post('/stop', (req, res) => {
  const result = stopRegister()
  res.json(result)
})

router.get('/status', (req, res) => {
  res.json(getStatus())
})

router.get('/logs', (req, res) => {
  const since = Number(req.query.since) || 0
  res.json(getLogs(since))
})

// ==========================================
// 配置管理 API
// ==========================================

router.get('/config', async (req, res) => {
  try {
    const db = await getDatabase()
    const result = db.exec(
      `SELECT config_value FROM system_config WHERE config_key = 'batch_register_config' LIMIT 1`
    )
    let config = {
      enabled: true,
      threads: 3,
      targetCount: 12,
    }
    if (result[0]?.values?.length) {
      try { config = { ...config, ...JSON.parse(result[0].values[0][0]) } } catch {}
    }
    const proxySettings = await getProxySettings(db, { forceRefresh: true })
    const registerSettings = await getRegisterSettings(db, { forceRefresh: true })
    res.json({
      config,
      system: {
        proxyUrl: String(proxySettings.chatgptProxyUrl || ''),
        emailProvider: registerSettings.emailProvider,
        emailProviderOptions: registerSettings.options,
      }
    })
  } catch (error) {
    console.error('[BatchRegister] get config error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.put('/config', async (req, res) => {
  try {
    const config = {
      enabled: Boolean(req.body.enabled ?? true),
      threads: Math.max(1, Math.min(10, Number(req.body.threads) || 3)),
      targetCount: Math.max(0, Math.min(500, Number(req.body.targetCount) || 0)),
    }
    const db = await getDatabase()
    upsertSystemConfigValue(db, 'batch_register_config', JSON.stringify(config))
    saveDatabase()
    const proxySettings = await getProxySettings(db, { forceRefresh: true })
    const registerSettings = await getRegisterSettings(db, { forceRefresh: true })
    res.json({
      config,
      system: {
        proxyUrl: String(proxySettings.chatgptProxyUrl || ''),
        emailProvider: registerSettings.emailProvider,
        emailProviderOptions: registerSettings.options,
      }
    })
  } catch (error) {
    console.error('[BatchRegister] update config error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ==========================================
// 已注册账号管理 API
// ==========================================

router.get('/accounts', (req, res) => {
  try {
    const accounts = loadAccounts()
    res.json({ accounts, total: accounts.length })
  } catch (error) {
    console.error('[BatchRegister] load accounts error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// 扫描 output 目录的 token JSON 文件，批量导入到 gpt_accounts 表
router.post('/accounts/import-to-system', async (req, res) => {
  try {
    const outputDir = path.join(getRegisterScriptDir(), 'output')
    if (!fs.existsSync(outputDir)) {
      return res.status(400).json({ error: `output 目录不存在: ${outputDir}` })
    }

    const files = fs.readdirSync(outputDir).filter(f => f.startsWith('token_') && f.endsWith('.json'))
    if (files.length === 0) {
      return res.json({ success: [], failed: [], skipped: [], total: 0, message: '没有找到 token JSON 文件' })
    }

    const db = await getDatabase()
    const results = { success: [], failed: [], skipped: [], total: files.length }

    for (const file of files) {
      const filePath = path.join(outputDir, file)
      try {
        const raw = fs.readFileSync(filePath, 'utf-8')
        const data = JSON.parse(raw)

        const email = normalizeEmail(data.email)
        const accessToken = String(data.access_token || '').trim()
        const refreshToken = String(data.refresh_token || '').trim()
        const accountId = String(data.account_id || '').trim()
        const expireAt = String(data.expired || '').trim() || null

        if (!email || !EMAIL_REGEX.test(email)) {
          results.failed.push({ file, email: data.email, error: '邮箱格式不正确' })
          continue
        }
        if (!accessToken) {
          results.failed.push({ file, email, error: '缺少 access_token' })
          continue
        }

        // 检查是否已存在（按 email 或 chatgpt_account_id 去重）
        const existsByEmail = db.exec('SELECT id FROM gpt_accounts WHERE email = ? LIMIT 1', [email])
        if (existsByEmail[0]?.values?.length) {
          // 已存在，更新 token
          const existingId = existsByEmail[0].values[0][0]
          db.run(
            `UPDATE gpt_accounts SET token = ?, refresh_token = ?, chatgpt_account_id = ?, expire_at = ?, updated_at = DATETIME('now', 'localtime') WHERE id = ?`,
            [accessToken, refreshToken, accountId, expireAt, existingId]
          )
          results.skipped.push({ file, email, id: existingId, action: '已更新 token' })
          continue
        }

        db.run(
          `INSERT INTO gpt_accounts (email, token, refresh_token, chatgpt_account_id, expire_at, is_open, user_count, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 1, 0, DATETIME('now', 'localtime'), DATETIME('now', 'localtime'))`,
          [email, accessToken, refreshToken, accountId, expireAt]
        )
        const insertedResult = db.exec('SELECT id FROM gpt_accounts WHERE email = ? LIMIT 1', [email])
        const insertedId = insertedResult[0]?.values?.[0]?.[0] ?? null
        results.success.push({ file, email, id: insertedId })
      } catch (err) {
        results.failed.push({ file, error: err.message || '解析失败' })
      }
    }
    saveDatabase()
    res.json(results)
  } catch (error) {
    console.error('[BatchRegister] import-to-system error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
