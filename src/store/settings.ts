import { CACHE_LIMIT, ENGINE_META, HISTORY_LIMIT, TRANSLATION_CACHE_VERSION } from '../utils/constants';
import { getBrowserLanguage, normalizeLanguageCode } from '../utils/languages';
import type { CacheEntry, EngineProvider, EngineSettings, HotkeyConfig, TranslationHistoryEntry, TranslationSettings } from '../types';

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
      systemPrompt: '',
    },
  };
}

export function createDefaultSettings(browserLanguage = getBrowserLanguage()): TranslationSettings {
  return {
    sourceLanguage: 'auto',
    targetLanguage: normalizeLanguageCode(browserLanguage),
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

export function mergeSettings(base: TranslationSettings, patch: Partial<TranslationSettings>): TranslationSettings {
  const {
    hotkeys,
    engines,
    // Ignore the legacy display mode once bilingual is a dedicated action.
    silentDisplayMode: _legacySilentDisplayMode,
    ...restPatch
  } = patch as Partial<TranslationSettings> & { silentDisplayMode?: unknown };

  return {
    ...base,
    ...restPatch,
    hotkeys: {
      ...base.hotkeys,
      ...(hotkeys ?? {}),
    },
    engines: {
      ...base.engines,
      ...Object.fromEntries(
        Object.entries(engines ?? {}).map(([provider, value]) => [
          provider,
          {
            ...base.engines[provider as EngineProvider],
            ...value,
          },
        ]),
      ),
    },
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

export function buildCacheKey(engine: EngineProvider, sourceLanguage: string, targetLanguage: string, text: string, model?: string): string {
  return [TRANSLATION_CACHE_VERSION, engine, sourceLanguage, targetLanguage, model ?? '', text].join('::');
}
