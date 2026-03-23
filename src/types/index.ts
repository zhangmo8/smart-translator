export type EngineProvider =
  | 'baidu'
  | 'tencent'
  | 'alibaba'
  | 'youdao'
  | 'google'
  | 'microsoft'
  | 'deepl'
  | 'libretranslate'
  | 'openai'
  | 'claude'
  | 'gemini'
  | 'doubao'
  | 'deepseek';

export type EngineCategory = 'standard' | 'ai';
export type ThemeMode = 'light' | 'dark' | 'auto';
export type UILanguage = 'auto' | 'en' | 'zh-CN';
export type SilentMode = 'paragraph' | 'full-page';
export type SilentDisplayMode = 'translate-only' | 'bilingual';
export type CommandName = 'translate-selection' | 'silent-translate' | 'toggle-page-translate' | 'restore-original';

export interface HotkeyConfig {
  selection: string;
  silent: string;
  page: string;
  restore: string;
}

export interface EngineConfig {
  apiKey?: string;
  apiSecret?: string;
  model?: string;
  systemPrompt?: string;
  region?: string;
  apiUrl?: string;
  endpoint?: string;
}

export type EngineSettings = Record<EngineProvider, EngineConfig>;

export interface TranslationSettings {
  sourceLanguage: string;
  targetLanguage: string;
  defaultEngine: EngineProvider;
  theme: ThemeMode;
  uiLanguage: UILanguage;
  cacheEnabled: boolean;
  showSelectionIcon: boolean;
  silentMode: SilentMode;
  silentDisplayMode: SilentDisplayMode;
  hotkeys: HotkeyConfig;
  engines: EngineSettings;
}

export interface TranslationHistoryEntry {
  id: string;
  text: string;
  translatedText: string;
  sourceLanguage: string;
  targetLanguage: string;
  engine: EngineProvider;
  timestamp: number;
}

export interface CacheEntry {
  key: string;
  translatedText: string;
  detectedSourceLanguage?: string;
  engine: EngineProvider;
  timestamp: number;
}

export interface TranslatePayload {
  text: string;
  sourceLanguage: string;
  targetLanguage: string;
  engine?: EngineProvider;
  modelOverride?: string;
  promptOverride?: string;
}

export interface TranslateBatchPayload {
  texts: string[];
  sourceLanguage: string;
  targetLanguage: string;
  engine?: EngineProvider;
  modelOverride?: string;
  promptOverride?: string;
}

export interface TranslateResponse {
  translatedText: string;
  detectedSourceLanguage?: string;
  engine: EngineProvider;
  cached?: boolean;
}

export interface TranslateBatchResponse {
  translations: string[];
  detectedSourceLanguage?: string;
  engine: EngineProvider;
  cachedCount?: number;
}

export interface EngineRequest {
  texts: string[];
  sourceLanguage: string;
  targetLanguage: string;
  config: EngineConfig;
  modelOverride?: string;
  promptOverride?: string;
}

export interface EngineResponse {
  translations: string[];
  detectedSourceLanguage?: string;
}

export type RuntimeMessage =
  | { type: 'SETTINGS_GET' }
  | { type: 'SETTINGS_UPDATE'; payload: Partial<TranslationSettings> }
  | { type: 'TRANSLATE_TEXT'; payload: TranslatePayload }
  | { type: 'TRANSLATE_BATCH'; payload: TranslateBatchPayload }
  | { type: 'HISTORY_GET' }
  | { type: 'HISTORY_CLEAR' }
  | { type: 'COMMAND_TRIGGER'; payload: { command: CommandName } }
  | { type: 'OPEN_OPTIONS' };

export type ContentMessage =
  | { type: 'RUN_COMMAND'; payload: { command: CommandName } }
  | { type: 'CONTEXT_TRANSLATE_SELECTION'; payload?: { selectedText?: string } }
  | { type: 'CONTEXT_TRANSLATE_PAGE' }
  | { type: 'PING' };

export interface EngineMeta {
  provider: EngineProvider;
  label: string;
  category: EngineCategory;
  defaultModel?: string;
  defaultApiUrl?: string;
  requiresApiKey: boolean;
  requiresApiSecret?: boolean;
  requiresRegion?: boolean;
  supportsSystemPrompt?: boolean;
  apiKeyLabel?: string;
  apiSecretLabel?: string;
  regionLabel?: string;
  regionPlaceholder?: string;
  docsHint: string;
}

declare global {
  const __APP_VERSION__: string;
}
