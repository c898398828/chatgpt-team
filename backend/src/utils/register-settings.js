import { getDatabase } from '../database/init.js'

const CONFIG_KEYS = ['register_email_provider']
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

export const REGISTER_EMAIL_PROVIDER_OPTIONS = ['mailtm']

export const invalidateRegisterSettingsCache = () => {
  cachedSettings = null
  cachedAt = 0
}

export async function getRegisterSettings(db, { forceRefresh = false } = {}) {
  const now = Date.now()
  if (!forceRefresh && cachedSettings && now - cachedAt < CACHE_TTL_MS) {
    return cachedSettings
  }

  const database = db || (await getDatabase())
  const stored = loadSystemConfigMap(database, CONFIG_KEYS)
  const provider = String(stored.get('register_email_provider') || 'mailtm').trim().toLowerCase() || 'mailtm'
  const normalizedProvider = REGISTER_EMAIL_PROVIDER_OPTIONS.includes(provider) ? provider : 'mailtm'

  cachedSettings = {
    emailProvider: normalizedProvider,
    options: REGISTER_EMAIL_PROVIDER_OPTIONS,
    stored: {
      emailProvider: stored.has('register_email_provider'),
    },
  }
  cachedAt = now
  return cachedSettings
}
