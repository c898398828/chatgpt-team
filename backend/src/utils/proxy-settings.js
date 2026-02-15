import { getDatabase } from '../database/init.js'
import { parseProxyConfig } from './proxy.js'

const CONFIG_KEYS = ['chatgpt_proxy_url']
const CACHE_TTL_MS = 60 * 1000

let cachedSettings = null
let cachedAt = 0

const loadSystemConfigMap = (database, keys) => {
  if (!database) return new Map()
  const list = Array.isArray(keys) && keys.length ? keys : CONFIG_KEYS
  const placeholders = list.map(() => '?').join(',')
  const result = database.exec(
    `SELECT config_key, config_value FROM system_config WHERE config_key IN (${placeholders})`,
    list
  )
  const map = new Map()
  const rows = result[0]?.values || []
  for (const row of rows) {
    map.set(String(row?.[0] ?? ''), String(row?.[1] ?? ''))
  }
  return map
}

const getValidProxyFromEnv = () => {
  const candidates = [
    process.env.CHATGPT_PROXY_URL,
    process.env.CHATGPT_PROXY,
    process.env.ALL_PROXY,
    process.env.all_proxy,
    process.env.HTTPS_PROXY,
    process.env.https_proxy,
    process.env.HTTP_PROXY,
    process.env.http_proxy
  ]

  for (const candidate of candidates) {
    const normalized = String(candidate || '').trim()
    if (!normalized) continue
    if (parseProxyConfig(normalized)) return normalized
  }

  return ''
}

export const getProxySettingsFromEnv = () => ({
  chatgptProxyUrl: getValidProxyFromEnv()
})

export const invalidateProxySettingsCache = () => {
  cachedSettings = null
  cachedAt = 0
}

export async function getProxySettings(db, { forceRefresh = false } = {}) {
  const now = Date.now()
  if (!forceRefresh && cachedSettings && now - cachedAt < CACHE_TTL_MS) {
    return cachedSettings
  }

  const database = db || (await getDatabase())
  const stored = loadSystemConfigMap(database, CONFIG_KEYS)
  const env = getProxySettingsFromEnv()

  const chatgptProxyUrl = stored.has('chatgpt_proxy_url')
    ? String(stored.get('chatgpt_proxy_url') ?? '').trim()
    : String(env.chatgptProxyUrl || '').trim()

  cachedSettings = {
    chatgptProxyUrl,
    stored: {
      chatgptProxyUrl: stored.has('chatgpt_proxy_url')
    }
  }
  cachedAt = now
  return cachedSettings
}

