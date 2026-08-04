import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from '../locales/en/translation.json'
import zh from '../locales/zh/translation.json'

export const SUPPORTED_LANGUAGES = ['zh', 'en'] as const
export type Language = (typeof SUPPORTED_LANGUAGES)[number]

export const i18n = i18next.createInstance()

// initImmediate: true (default) means init() runs synchronously — no async gap.
// All resources are bundled JSON, no network requests needed.
void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    zh: { translation: zh },
  },
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnNull: false,
})

/** switch the UI language and remember the preference */
export function setLanguage(lang: Language): void {
  window.localStorage.setItem('pulsedeck.lang', lang)
  void i18n.changeLanguage(lang)
}
