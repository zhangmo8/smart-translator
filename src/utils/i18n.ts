import enMessages from '../../_locales/en/messages.json';
import zhCnMessages from '../../_locales/zh_CN/messages.json';

import { getBrowserLanguage, normalizeLanguageCode } from './languages';
import type { TranslationSettings, UILanguage } from '../types';

type MessageDefinition = {
  message: string;
  placeholders?: Record<string, { content: string }>;
};

type MessageCatalog = Record<string, MessageDefinition>;
type SupportedUILanguage = Exclude<UILanguage, 'auto'>;

export interface UILanguageOption {
  value: TranslationSettings['uiLanguage'];
  labelKey: string;
}

const MESSAGE_CATALOGS: Record<SupportedUILanguage, MessageCatalog> = {
  en: enMessages as MessageCatalog,
  'zh-CN': zhCnMessages as MessageCatalog,
};

export const UI_LANGUAGE_OPTIONS: UILanguageOption[] = [
  { value: 'auto', labelKey: 'uiLanguageAuto' },
  { value: 'en', labelKey: 'uiLanguageEnglish' },
  { value: 'zh-CN', labelKey: 'uiLanguageChineseSimplified' },
];

let uiLanguagePreference: TranslationSettings['uiLanguage'] = 'auto';
let activeUILanguage: SupportedUILanguage = getBrowserUILanguage();

function normalizeSupportedUILanguage(code: string): SupportedUILanguage {
  const normalized = normalizeLanguageCode(code);
  return normalized.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
}

function normalizeUILanguagePreference(code?: string): TranslationSettings['uiLanguage'] {
  if (!code || code === 'auto') {
    return 'auto';
  }

  return normalizeSupportedUILanguage(code);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function applySubstitutions(
  template: string,
  placeholders?: MessageDefinition['placeholders'],
  substitutions?: string | string[],
): string {
  const values = Array.isArray(substitutions) ? substitutions : substitutions === undefined ? [] : [substitutions];
  let message = template;

  Object.entries(placeholders ?? {}).forEach(([name, definition]) => {
    const match = definition.content.match(/\$(\d+)/);
    if (!match) {
      return;
    }

    const index = Number(match[1]) - 1;
    const replacement = values[index] ?? '';
    message = message.replace(new RegExp(`\\$${escapeRegExp(name)}\\$`, 'gi'), replacement);
  });

  values.forEach((value, index) => {
    message = message.replace(new RegExp(`\\$${index + 1}`, 'g'), value);
  });

  return message.replace(/\$\$/g, '$');
}

export function getBrowserUILanguage(): SupportedUILanguage {
  return normalizeSupportedUILanguage(getBrowserLanguage());
}

export function getUILanguage(): SupportedUILanguage {
  return activeUILanguage;
}

export function getUILanguagePreference(): TranslationSettings['uiLanguage'] {
  return uiLanguagePreference;
}

export function setUILanguagePreference(preference?: TranslationSettings['uiLanguage']): SupportedUILanguage {
  uiLanguagePreference = normalizeUILanguagePreference(preference);
  activeUILanguage = uiLanguagePreference === 'auto' ? getBrowserUILanguage() : normalizeSupportedUILanguage(uiLanguagePreference);
  return activeUILanguage;
}

export function t(key: string, substitutions?: string | string[]): string {
  const definition = MESSAGE_CATALOGS[activeUILanguage][key] ?? MESSAGE_CATALOGS.en[key];
  if (!definition) {
    return key;
  }

  return applySubstitutions(definition.message, definition.placeholders, substitutions);
}

export function useI18n() {
  return { t, getUILanguage, getUILanguagePreference, setUILanguagePreference };
}
