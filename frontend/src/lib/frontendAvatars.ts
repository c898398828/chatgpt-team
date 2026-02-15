export type FrontendAdminAvatarKey = 'default' | `icon_${number}`

const avatarModules = import.meta.glob('../assets/icon/*.{png,jpg,jpeg,webp,avif,gif,svg}', {
  eager: true,
  import: 'default',
}) as Record<string, string>

const avatarEntries = Object.entries(avatarModules).sort(([a], [b]) =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }),
)

const avatarOptions = avatarEntries.map(([path, url], index) => {
  const fileName = path.split('/').pop() || `头像 ${index + 1}`
  return {
    key: `icon_${index + 1}` as FrontendAdminAvatarKey,
    label: `头像 ${index + 1} · ${fileName}`,
    url,
  }
})

export const FRONTEND_ADMIN_AVATAR_OPTIONS: Array<{ key: FrontendAdminAvatarKey; label: string; url: string }> = [
  { key: 'default', label: '默认字母头像', url: '' },
  ...avatarOptions,
]

const AVATAR_KEY_SET = new Set(FRONTEND_ADMIN_AVATAR_OPTIONS.map(item => item.key))
const AVATAR_KEY_REGEX = /^icon_\d+$/i

export const normalizeFrontendAdminAvatarKey = (value: unknown): FrontendAdminAvatarKey => {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'default') return 'default'
  if (AVATAR_KEY_SET.has(normalized as FrontendAdminAvatarKey)) return normalized as FrontendAdminAvatarKey
  if (AVATAR_KEY_REGEX.test(normalized)) return normalized as FrontendAdminAvatarKey
  return 'default'
}

export const resolveFrontendAdminAvatarUrl = (key: unknown): string => {
  const normalized = normalizeFrontendAdminAvatarKey(key)
  const found = FRONTEND_ADMIN_AVATAR_OPTIONS.find(item => item.key === normalized)
  return found?.url || ''
}
