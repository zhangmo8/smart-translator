import type { EngineMeta, EngineProvider } from '../types';

export const PROVIDER_ORDER: EngineProvider[] = [
  'microsoft',
  'deepl',
  'google',
  'libretranslate',
  'openai',
  'claude',
  'gemini',
  'doubao',
  'deepseek',
];

export const ENGINE_META: Record<EngineProvider, EngineMeta> = {
  google: {
    provider: 'google',
    label: 'Google Translate API',
    category: 'standard',
    requiresApiKey: true,
    docsHint: 'Cloud Translation API key',
  },
  microsoft: {
    provider: 'microsoft',
    label: 'Microsoft Azure Translator',
    category: 'standard',
    requiresApiKey: true,
    requiresRegion: true,
    docsHint: 'Translator key + Azure region',
  },
  deepl: {
    provider: 'deepl',
    label: 'DeepL API',
    category: 'standard',
    requiresApiKey: true,
    defaultApiUrl: 'https://api-free.deepl.com/v2/translate',
    docsHint: 'DeepL API key',
  },
  libretranslate: {
    provider: 'libretranslate',
    label: 'LibreTranslate',
    category: 'standard',
    requiresApiKey: false,
    defaultApiUrl: 'https://libretranslate.com/translate',
    docsHint: 'Public or self-hosted endpoint',
  },
  openai: {
    provider: 'openai',
    label: 'OpenAI / ChatGPT',
    category: 'ai',
    requiresApiKey: true,
    defaultModel: 'gpt-4o-mini',
    supportsSystemPrompt: true,
    docsHint: 'OpenAI API key + optional custom model',
  },
  claude: {
    provider: 'claude',
    label: 'Claude / Anthropic',
    category: 'ai',
    requiresApiKey: true,
    defaultModel: 'claude-3-haiku-20240307',
    supportsSystemPrompt: true,
    docsHint: 'Anthropic key + model',
  },
  gemini: {
    provider: 'gemini',
    label: 'Google Gemini',
    category: 'ai',
    requiresApiKey: true,
    defaultModel: 'gemini-1.5-flash',
    supportsSystemPrompt: true,
    docsHint: 'Gemini key + model',
  },
  doubao: {
    provider: 'doubao',
    label: 'Doubao / ByteDance',
    category: 'ai',
    requiresApiKey: true,
    defaultModel: 'doubao-pro-4k',
    supportsSystemPrompt: true,
    docsHint: 'Volcengine Ark key + optional endpoint',
  },
  deepseek: {
    provider: 'deepseek',
    label: 'DeepSeek',
    category: 'ai',
    requiresApiKey: true,
    defaultModel: 'deepseek-chat',
    supportsSystemPrompt: true,
    docsHint: 'DeepSeek key + model',
  },
};

export const DEFAULT_SYSTEM_PROMPT =
  'You are a professional translator. Preserve tone, meaning, formatting, punctuation, lists, line breaks, and code snippets. Return only the translation.';

export const HISTORY_LIMIT = 10;
export const CACHE_LIMIT = 300;

export const RATE_LIMIT_MS: Record<EngineProvider, number> = {
  google: 180,
  microsoft: 180,
  deepl: 220,
  libretranslate: 250,
  openai: 900,
  claude: 950,
  gemini: 850,
  doubao: 900,
  deepseek: 850,
};

export const BATCH_SIZE: Record<EngineProvider, number> = {
  google: 32,
  microsoft: 32,
  deepl: 24,
  libretranslate: 8,
  openai: 8,
  claude: 8,
  gemini: 8,
  doubao: 8,
  deepseek: 8,
};
