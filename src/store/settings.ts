import { CACHE_LIMIT, ENGINE_META, HISTORY_LIMIT, TRANSLATION_CACHE_VERSION } from '../utils/constants';
import { getBrowserLanguage, normalizeSupportedLanguageOption } from '../utils/languages';
import type { CacheEntry, EngineProvider, EngineSettings, HotkeyConfig, ThemeMode, TranslationHistoryEntry, TranslationSettings, UILanguage } from '../types';

const SETTINGS_KEY = 'settings';
const HISTORY_KEY = 'history';
const CACHE_KEY = 'translationCache';

export const DEFAULT_HOTKEYS: HotkeyConfig = {
  selection: 'Alt+T',
  silent: 'Alt+Q',
  bilingual: 'Alt+B',
  page: 'Alt+W',
  restore: 'Alt+R',
};

export function createDefaultEngineSettings(): EngineSettings {
  return {
    baidu: {},
    tencent: { region: 'ap-guangzhou' },
    alibaba: {},
    youdao: {},
    google: {},
    microsoft: {},
    deepl: { apiUrl: ENGINE_META.deepl.defaultApiUrl },
    libretranslate: { apiUrl: ENGINE_META.libretranslate.defaultApiUrl },
    openai: {
      model: ENGINE_META.openai.defaultModel,
      apiUrl: ENGINE_META.openai.defaultApiUrl,
      systemPrompt: '',
    },
    claude: {
      model: ENGINE_META.claude.defaultModel,
      systemPrompt: '',
    },
    gemini: {
      model: ENGINE_META.gemini.defaultModel,
      systemPrompt: '',
    },
    doubao: {
      model: ENGINE_META.doubao.defaultModel,
      endpoint: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
      systemPrompt: '',
    },
    deepseek: {
      model: ENGINE_META.deepseek.defaultModel,
      apiUrl: ENGINE_META.deepseek.defaultApiUrl,
      systemPrompt: '',
    },
  };
}

export function createDefaultSettings(browserLanguage = getBrowserLanguage()): TranslationSettings {
  return {
    sourceLanguage: 'auto',
    targetLanguage: normalizeSupportedLanguageOption(browserLanguage),
    defaultEngine: 'microsoft',
    theme: 'auto',
    uiLanguage: 'auto',
    cacheEnabled: true,
    showSelectionIcon: true,
    silentMode: 'paragraph',
    hotkeys: DEFAULT_HOTKEYS,
    engines: createDefaultEngineSettings(),
  };
}

function isEngineProvider(value: unknown): value is EngineProvider {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(ENGINE_META, value);
}

function normalizeTheme(value: unknown, fallback: ThemeMode): ThemeMode {
  return value === 'light' || value === 'dark' || value === 'auto' ? value : fallback;
}

function normalizeUILanguage(value: unknown, fallback: UILanguage): UILanguage {
  return value === 'en' || value === 'zh-CN' || value === 'auto' ? value : fallback;
}

function normalizeSilentMode(value: unknown, fallback: TranslationSettings['silentMode']): TranslationSettings['silentMode'] {
  return value === 'paragraph' || value === 'full-page' ? value : fallback;
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeLanguageSetting(value: unknown, fallback: string, allowAuto: boolean): string {
  if (value === 'auto') {
    return allowAuto ? 'auto' : normalizeSupportedLanguageOption(fallback);
  }

  if (typeof value !== 'string') {
    return fallback === 'auto' ? 'auto' : normalizeSupportedLanguageOption(fallback);
  }

  return normalizeSupportedLanguageOption(value, fallback === 'auto' ? 'en' : fallback);
}

function normalizeHotkeys(base: HotkeyConfig, hotkeys: Partial<HotkeyConfig> | undefined): HotkeyConfig {
  const next = { ...base };
  (Object.keys(base) as Array<keyof HotkeyConfig>).forEach((key) => {
    const value = hotkeys?.[key];
    if (typeof value === 'string') {
      next[key] = value;
    }
  });
  return next;
}

function normalizeEngineConfig(config: unknown): Partial<EngineSettings[EngineProvider]> {
  if (!config || typeof config !== 'object') {
    return {};
  }

  const next: Partial<EngineSettings[EngineProvider]> = {};
  (['apiKey', 'apiSecret', 'model', 'systemPrompt', 'region', 'apiUrl', 'endpoint'] as const).forEach((key) => {
    const value = (config as Record<string, unknown>)[key];
    if (typeof value === 'string') {
      next[key] = value;
    }
  });
  return next;
}

function normalizeEngines(base: EngineSettings, engines: Partial<EngineSettings> | undefined): EngineSettings {
  const next = { ...base };
  Object.entries(engines ?? {}).forEach(([provider, value]) => {
    if (!isEngineProvider(provider)) {
      return;
    }

    next[provider] = {
      ...base[provider],
      ...normalizeEngineConfig(value),
    };
  });
  return next;
}

export function mergeSettings(base: TranslationSettings, patch: Partial<TranslationSettings>): TranslationSettings {
  const {
    hotkeys,
    engines,
    sourceLanguage,
    targetLanguage,
    defaultEngine,
    theme,
    uiLanguage,
    cacheEnabled,
    showSelectionIcon,
    silentMode,
    // Ignore the legacy display mode once bilingual is a dedicated action.
    silentDisplayMode: _legacySilentDisplayMode,
    ...restPatch
  } = patch as Partial<TranslationSettings> & { silentDisplayMode?: unknown };

  return {
    ...base,
    ...restPatch,
    sourceLanguage: normalizeLanguageSetting(sourceLanguage, base.sourceLanguage, true),
    targetLanguage: normalizeLanguageSetting(targetLanguage, base.targetLanguage, false),
    defaultEngine: isEngineProvider(defaultEngine) ? defaultEngine : base.defaultEngine,
    theme: normalizeTheme(theme, base.theme),
    uiLanguage: normalizeUILanguage(uiLanguage, base.uiLanguage),
    cacheEnabled: normalizeBoolean(cacheEnabled, base.cacheEnabled),
    showSelectionIcon: normalizeBoolean(showSelectionIcon, base.showSelectionIcon),
    silentMode: normalizeSilentMode(silentMode, base.silentMode),
    hotkeys: normalizeHotkeys(base.hotkeys, hotkeys),
    engines: normalizeEngines(base.engines, engines),
  };
}

export async function getSettings(): Promise<TranslationSettings> {
  const stored = await chrome.storage.sync.get(SETTINGS_KEY);
  const defaults = createDefaultSettings();
  return mergeSettings(defaults, stored[SETTINGS_KEY] ?? {});
}

export async function updateSettings(patch: Partial<TranslationSettings>): Promise<TranslationSettings> {
  const current = await getSettings();
  const next = mergeSettings(current, patch);
  await chrome.storage.sync.set({ [SETTINGS_KEY]: next });
  return next;
}

export async function initializeSettings(): Promise<TranslationSettings> {
  const stored = await chrome.storage.sync.get(SETTINGS_KEY);
  if (!stored[SETTINGS_KEY]) {
    const defaults = createDefaultSettings();
    await chrome.storage.sync.set({ [SETTINGS_KEY]: defaults });
    return defaults;
  }

  return getSettings();
}

export async function getHistory(): Promise<TranslationHistoryEntry[]> {
  const stored = await chrome.storage.local.get(HISTORY_KEY);
  return stored[HISTORY_KEY] ?? [];
}

export async function addHistoryEntry(entry: TranslationHistoryEntry): Promise<void> {
  const current = await getHistory();
  const next = [entry, ...current].slice(0, HISTORY_LIMIT);
  await chrome.storage.local.set({ [HISTORY_KEY]: next });
}

export async function clearHistory(): Promise<void> {
  await chrome.storage.local.set({ [HISTORY_KEY]: [] });
}

export async function getCache(): Promise<Record<string, CacheEntry>> {
  const stored = await chrome.storage.local.get(CACHE_KEY);
  return stored[CACHE_KEY] ?? {};
}

export async function setCacheEntries(entries: CacheEntry[]): Promise<void> {
  const current = await getCache();
  const merged = { ...current };

  entries.forEach((entry) => {
    merged[entry.key] = entry;
  });

  const trimmed = Object.values(merged)
    .sort((left, right) => right.timestamp - left.timestamp)
    .slice(0, CACHE_LIMIT)
    .reduce<Record<string, CacheEntry>>((accumulator, entry) => {
      accumulator[entry.key] = entry;
      return accumulator;
    }, {});

  await chrome.storage.local.set({ [CACHE_KEY]: trimmed });
}

export async function clearCache(): Promise<void> {
  await chrome.storage.local.set({ [CACHE_KEY]: {} });
}

export function buildCacheKey(
  engine: EngineProvider,
  sourceLanguage: string,
  targetLanguage: string,
  text: string,
  model?: string,
  promptSignature = '',
): string {
  const parts = [TRANSLATION_CACHE_VERSION, engine, sourceLanguage, targetLanguage, model ?? ''];
  if (promptSignature) {
    parts.push(promptSignature);
  }
  parts.push(text);
  return parts.join('::');
}
