export interface LanguageOption {
  value: string;
  label: string;
}

export const AUTO_LANGUAGE_OPTION: LanguageOption = {
  value: 'auto',
  label: 'Auto-detect',
};

export const LANGUAGE_OPTIONS: LanguageOption[] = [
  { value: 'ar', label: 'Arabic' },
  { value: 'bg', label: 'Bulgarian' },
  { value: 'cs', label: 'Czech' },
  { value: 'da', label: 'Danish' },
  { value: 'de', label: 'German' },
  { value: 'el', label: 'Greek' },
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Spanish' },
  { value: 'et', label: 'Estonian' },
  { value: 'fi', label: 'Finnish' },
  { value: 'fr', label: 'French' },
  { value: 'he', label: 'Hebrew' },
  { value: 'hi', label: 'Hindi' },
  { value: 'hu', label: 'Hungarian' },
  { value: 'id', label: 'Indonesian' },
  { value: 'it', label: 'Italian' },
  { value: 'ja', label: 'Japanese' },
  { value: 'ko', label: 'Korean' },
  { value: 'lt', label: 'Lithuanian' },
  { value: 'lv', label: 'Latvian' },
  { value: 'ms', label: 'Malay' },
  { value: 'nl', label: 'Dutch' },
  { value: 'no', label: 'Norwegian' },
  { value: 'pl', label: 'Polish' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'ro', label: 'Romanian' },
  { value: 'ru', label: 'Russian' },
  { value: 'sk', label: 'Slovak' },
  { value: 'sl', label: 'Slovenian' },
  { value: 'sv', label: 'Swedish' },
  { value: 'th', label: 'Thai' },
  { value: 'tr', label: 'Turkish' },
  { value: 'uk', label: 'Ukrainian' },
  { value: 'vi', label: 'Vietnamese' },
  { value: 'zh', label: 'Chinese' },
  { value: 'zh-CN', label: 'Chinese (Simplified)' },
  { value: 'zh-TW', label: 'Chinese (Traditional)' },
];

const labelMap = new Map(LANGUAGE_OPTIONS.map((entry) => [entry.value.toLowerCase(), entry.label]));
const supportedLanguageValues = new Set(LANGUAGE_OPTIONS.map((entry) => entry.value));

export function normalizeLanguageCode(code: string): string {
  if (!code) {
    return 'en';
  }

  if (code === 'auto') {
    return code;
  }

  const trimmed = code.trim();
  if (!trimmed) {
    return 'en';
  }

  if (trimmed.toLowerCase() === 'zh-cn' || trimmed.toLowerCase() === 'zh-sg') {
    return 'zh-CN';
  }

  if (trimmed.toLowerCase() === 'zh-tw' || trimmed.toLowerCase() === 'zh-hk') {
    return 'zh-TW';
  }

  const [base, region] = trimmed.split(/[-_]/);
  return region ? `${base.toLowerCase()}-${region.toUpperCase()}` : base.toLowerCase();
}

export function humanizeLanguage(code: string): string {
  if (code === 'auto') {
    return AUTO_LANGUAGE_OPTION.label;
  }

  const normalized = normalizeLanguageCode(code).toLowerCase();
  return labelMap.get(normalized) ?? code;
}

export function getLanguageOptionLabel(code: string, locale = navigator.language || 'en'): string {
  const normalized = normalizeLanguageCode(code);
  if (normalized === 'auto') {
    return AUTO_LANGUAGE_OPTION.label;
  }

  const fallback = labelMap.get(normalized.toLowerCase()) ?? code;

  try {
    return new Intl.DisplayNames([locale], { type: 'language' }).of(normalized) ?? fallback;
  } catch {
    return fallback;
  }
}

export function normalizeSupportedLanguageOption(code: string, fallback = 'en'): string {
  const normalized = normalizeLanguageCode(code);
  if (normalized === 'auto' || supportedLanguageValues.has(normalized)) {
    return normalized;
  }

  const baseLanguage = toBaseLanguage(normalized);
  if (supportedLanguageValues.has(baseLanguage)) {
    return baseLanguage;
  }

  return supportedLanguageValues.has(fallback) ? fallback : 'en';
}

export function getBrowserLanguage(): string {
  const fromChrome = typeof chrome !== 'undefined' && chrome.i18n?.getUILanguage ? chrome.i18n.getUILanguage() : '';
  return normalizeLanguageCode(fromChrome || navigator.language || 'en');
}

export function toBaseLanguage(code: string): string {
  const normalized = normalizeLanguageCode(code);
  return normalized === 'auto' ? 'auto' : normalized.split('-')[0];
}
