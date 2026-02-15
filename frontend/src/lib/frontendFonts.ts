export type FrontendFontKey = 'system' | 'ruizi_shuizhu' | 'xindi_jinzhong' | 'xindi_xueshan'

export const FRONTEND_FONT_OPTIONS: Array<{ key: FrontendFontKey; label: string; family: string }> = [
  {
    key: 'system',
    label: '系统默认',
    family: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
  },
  {
    key: 'ruizi_shuizhu',
    label: '锐字云字库水柱体',
    family: '"RuiziShuizhu", "PingFang SC", "Microsoft YaHei", sans-serif',
  },
  {
    key: 'xindi_jinzhong',
    label: '新蒂金钟体',
    family: '"XindiJinzhong", "PingFang SC", "Microsoft YaHei", sans-serif',
  },
  {
    key: 'xindi_xueshan',
    label: '新蒂雪山体',
    family: '"XindiXueshan", "PingFang SC", "Microsoft YaHei", sans-serif',
  },
]

const FONT_KEY_SET = new Set(FRONTEND_FONT_OPTIONS.map(item => item.key))

export const normalizeFrontendFontKey = (value: unknown): FrontendFontKey => {
  const normalized = String(value || '').trim().toLowerCase() as FrontendFontKey
  return FONT_KEY_SET.has(normalized) ? normalized : 'system'
}

export const resolveFrontendFontFamily = (key: unknown): string => {
  const normalized = normalizeFrontendFontKey(key)
  const found = FRONTEND_FONT_OPTIONS.find(item => item.key === normalized)
  return found?.family || FRONTEND_FONT_OPTIONS[0].family
}
