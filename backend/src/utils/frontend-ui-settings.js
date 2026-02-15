import { getDatabase } from '../database/init.js'

const CONFIG_KEYS = ['frontend_font_key', 'frontend_admin_avatar_key']
const CACHE_TTL_MS = 60 * 1000

export const FRONTEND_FONT_KEYS = ['system', 'ruizi_shuizhu', 'xindi_jinzhong', 'xindi_xueshan']
const FRONTEND_FONT_KEY_SET = new Set(FRONTEND_FONT_KEYS)
export const FRONTEND_ADMIN_AVATAR_KEYS = ['default']
const FRONTEND_ADMIN_AVATAR_KEY_REGEX = /^icon_\d+$/i

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

const normalizeFontKey = (value) => {
  const normalized = String(value || '').trim().toLowerCase()
  if (!normalized) return 'system'
  return FRONTEND_FONT_KEY_SET.has(normalized) ? normalized : 'system'
}

const normalizeAvatarKey = (value) => {
  const normalized = String(value || '').trim().toLowerCase()
  if (!normalized) return 'default'
  if (normalized === 'default') return 'default'
  return FRONTEND_ADMIN_AVATAR_KEY_REGEX.test(normalized) ? normalized : 'default'
}

export const getFrontendUiSettingsFromEnv = () => ({
  fontKey: normalizeFontKey(process.env.FRONTEND_FONT_KEY || 'system'),
  adminAvatarKey: normalizeAvatarKey(process.env.FRONTEND_ADMIN_AVATAR_KEY || 'default')
})

export const invalidateFrontendUiSettingsCache = () => {
  cachedSettings = null
  cachedAt = 0
}

export async function getFrontendUiSettings(db, { forceRefresh = false } = {}) {
  const now = Date.now()
  if (!forceRefresh && cachedSettings && now - cachedAt < CACHE_TTL_MS) {
    return cachedSettings
  }

  const database = db || (await getDatabase())
  const stored = loadSystemConfigMap(database, CONFIG_KEYS)
  const env = getFrontendUiSettingsFromEnv()

  const storedFont = stored.has('frontend_font_key') ? String(stored.get('frontend_font_key') || '').trim() : null
  const fontKey = normalizeFontKey(storedFont ?? env.fontKey)
  const storedAvatar = stored.has('frontend_admin_avatar_key') ? String(stored.get('frontend_admin_avatar_key') || '').trim() : null
  const adminAvatarKey = normalizeAvatarKey(storedAvatar ?? env.adminAvatarKey)

  cachedSettings = {
    fontKey,
    adminAvatarKey,
    stored: {
      fontKey: stored.has('frontend_font_key'),
      adminAvatarKey: stored.has('frontend_admin_avatar_key')
    }
  }
  cachedAt = now
  return cachedSettings
}
