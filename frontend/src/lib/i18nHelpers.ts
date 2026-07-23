import i18n from '../i18n';

/**
 * Three-way language helper.
 * Usage: tr('English', '繁體中文', '简体中文')
 * - If current language is 'en' → returns en
 * - If current language is 'zh-Hans' → returns zhHans
 * - Otherwise (zh-Hant or any fallback) → returns zhHant
 *
 * Works reactively because components already call useTranslation()
 * which triggers re-render on language change. The i18n.language
 * singleton is always up to date.
 */
export function tr(en: string, zhHant: string, zhHans: string): string {
  const lang = i18n.language;
  if (lang === 'en') return en;
  if (lang === 'zh-Hans') return zhHans;
  return zhHant; // zh-Hant is the default/fallback
}
