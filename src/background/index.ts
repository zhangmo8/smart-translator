import { md5Hex } from '../utils/crypto';
import { getEngine } from '../engines';
import { normalizeSupportedLanguageOption } from '../utils/languages';
import {
  addHistoryEntry,
  buildCacheKey,
  clearHistory,
  getCache,
  getHistory,
  getSettings,
  initializeSettings,
  setCacheEntries,
  updateSettings,
} from '../store/settings';
import type {
  CacheEntry,
  CommandName,
  ContentMessage,
  EngineConfig,
  EngineProvider,
  RuntimeMessage,
  TranslateBatchPayload,
  TranslateBatchResponse,
  TranslatePayload,
  TranslateResponse,
} from '../types';
import { BATCH_SIZE, ENGINE_META, RATE_LIMIT_MS, REQUEST_CONCURRENCY } from '../utils/constants';
import { getUILanguage, setUILanguagePreference, t } from '../utils/i18n';

const MENU_TRANSLATE_SELECTION = 'silence-translator:translate-selection';
const MENU_TRANSLATE_PAGE = 'silence-translator:translate-page';
const MENU_SILENT_PARENT = 'silence-translator:silent-parent';
const MENU_SILENT_PARAGRAPH = 'silence-translator:silent-paragraph';
const MENU_SILENT_FULL_PAGE = 'silence-translator:silent-full-page';
const MENU_OPEN_OPTIONS = 'silence-translator:open-options';
const COMMANDS = new Set<CommandName>(['translate-selection', 'silent-translate', 'bilingual-translate', 'toggle-page-translate', 'restore-original']);

interface EngineGate {
  active: number;
  lastStart: number;
  waiters: Array<() => void>;
}

const engineGates = new Map<EngineProvider, EngineGate>();

function sleep(duration: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, duration));
}

function uniqueId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function joinLabels(labels: string[]): string {
  if (labels.length <= 1) {
    return labels[0] ?? '';
  }

  return new Intl.ListFormat(getUILanguage(), {
    style: 'long',
    type: 'conjunction',
  }).format(labels);
}

function assertEngineConfigured(provider: EngineProvider, config: EngineConfig): void {
  const meta = ENGINE_META[provider];
  const missing: string[] = [];

  if (meta.requiresApiKey && !config.apiKey?.trim()) {
    missing.push(meta.apiKeyLabel ?? t('apiKeyDefault'));
  }

  if (meta.requiresApiSecret && !config.apiSecret?.trim()) {
    missing.push(meta.apiSecretLabel ?? t('apiSecretDefault'));
  }

  if (meta.requiresRegion && !config.region?.trim()) {
    missing.push(meta.regionLabel ?? t('regionDefault'));
  }

  if (!missing.length) {
    return;
  }

  throw new Error(t('engineNotConfigured', [meta.label, joinLabels(missing)]));
}

async function withRateLimit<T>(provider: EngineProvider, task: () => Promise<T>): Promise<T> {
  const gate = engineGates.get(provider) ?? { active: 0, lastStart: 0, waiters: [] };
  engineGates.set(provider, gate);

  const limit = Math.max(1, REQUEST_CONCURRENCY[provider] ?? 1);
  const minGap = RATE_LIMIT_MS[provider] ?? 0;

  if (gate.active >= limit) {
    await new Promise<void>((resolve) => gate.waiters.push(resolve));
  }

  gate.active += 1;

  try {
    const waitMs = Math.max(0, gate.lastStart + minGap - Date.now());
    if (waitMs > 0) {
      await sleep(waitMs);
    }

    gate.lastStart = Date.now();
    return await task();
  } finally {
    gate.active -= 1;
    gate.waiters.shift()?.();
  }
}

function getPromptSignature(config: EngineConfig, promptOverride?: string): string {
  const prompt = [config.systemPrompt, promptOverride].filter(Boolean).join('\n\n');
  return prompt ? md5Hex(prompt) : '';
}

function isEngineProvider(value: unknown): value is EngineProvider {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(ENGINE_META, value);
}

function normalizeRequestLanguage(value: string, fallback: string, allowAuto: boolean): string {
  if (value === 'auto') {
    return allowAuto ? 'auto' : normalizeSupportedLanguageOption(fallback || 'en');
  }

  return normalizeSupportedLanguageOption(value || fallback || 'en', fallback === 'auto' ? 'en' : fallback || 'en');
}

async function translateMany(payload: TranslateBatchPayload): Promise<TranslateBatchResponse> {
  const settings = await getSettings();
  setUILanguagePreference(settings.uiLanguage);
  const requestedProvider = payload.engine ?? settings.defaultEngine;
  const provider = isEngineProvider(requestedProvider) ? requestedProvider : settings.defaultEngine;
  const sourceLanguage = normalizeRequestLanguage(payload.sourceLanguage, settings.sourceLanguage, true);
  const targetLanguage = normalizeRequestLanguage(payload.targetLanguage, settings.targetLanguage, false);
  const config = settings.engines[provider];
  assertEngineConfigured(provider, config);
  const engine = getEngine(provider);
  const hasText = payload.texts.some((text) => text.trim().length > 0);

  if (!hasText) {
    return { translations: payload.texts.map(() => ''), engine: provider, cachedCount: 0 };
  }

  const model = payload.modelOverride || config.model;
  const promptSignature = getPromptSignature(config, payload.promptOverride);
  const cache = settings.cacheEnabled ? await getCache() : {};
  const results = new Array<string>(payload.texts.length);
  let detectedSourceLanguage = '';
  let cachedCount = 0;

  const uncached = new Map<string, { key: string; text: string; indexes: number[] }>();
  payload.texts.forEach((text, index) => {
    if (!text.trim()) {
      results[index] = '';
      return;
    }

    const key = buildCacheKey(provider, sourceLanguage, targetLanguage, text, model, promptSignature);
    const cached = cache[key];
    if (cached) {
      results[index] = cached.translatedText;
      detectedSourceLanguage ||= cached.detectedSourceLanguage || '';
      cachedCount += 1;
      return;
    }

    if (!uncached.has(key)) {
      uncached.set(key, { key, text, indexes: [index] });
      return;
    }

    uncached.get(key)?.indexes.push(index);
  });

  const cacheEntries: CacheEntry[] = [];
  const workItems = Array.from(uncached.values());
  const chunkSize = BATCH_SIZE[provider];
  for (const workChunk of chunk(workItems, chunkSize)) {
    const response = await withRateLimit(provider, () =>
      engine.translate({
        texts: workChunk.map((item) => item.text),
        sourceLanguage,
        targetLanguage,
        config,
        modelOverride: payload.modelOverride,
        promptOverride: payload.promptOverride,
      }),
    );

    if (response.translations.length !== workChunk.length) {
      throw new Error(
        `${ENGINE_META[provider].label} returned ${response.translations.length} result${response.translations.length === 1 ? '' : 's'} for ${
          workChunk.length
        } text fragment${workChunk.length === 1 ? '' : 's'}.`,
      );
    }

    response.translations.forEach((translation, index) => {
      const item = workChunk[index];
      item.indexes.forEach((resultIndex) => {
        results[resultIndex] = translation;
      });

      cacheEntries.push({
        key: item.key,
        translatedText: translation,
        detectedSourceLanguage: response.detectedSourceLanguage,
        engine: provider,
        timestamp: Date.now(),
      });
    });

    detectedSourceLanguage ||= response.detectedSourceLanguage || '';
  }

  let missingCount = 0;
  for (let index = 0; index < results.length; index += 1) {
    if (typeof results[index] !== 'string') {
      missingCount += 1;
    }
  }

  if (missingCount > 0) {
    throw new Error(
      `${ENGINE_META[provider].label} did not return ${missingCount} translated fragment${missingCount === 1 ? '' : 's'}. The page was left unchanged.`,
    );
  }

  if (settings.cacheEnabled && cacheEntries.length > 0) {
    await setCacheEntries(cacheEntries);
  }

  return {
    translations: results,
    detectedSourceLanguage: detectedSourceLanguage || undefined,
    engine: provider,
    cachedCount,
  };
}

async function translateSingle(payload: TranslatePayload): Promise<TranslateResponse> {
  const settings = await getSettings();
  setUILanguagePreference(settings.uiLanguage);
  const sourceLanguage = normalizeRequestLanguage(payload.sourceLanguage, settings.sourceLanguage, true);
  const targetLanguage = normalizeRequestLanguage(payload.targetLanguage, settings.targetLanguage, false);
  const response = await translateMany({
    texts: [payload.text],
    sourceLanguage,
    targetLanguage,
    engine: payload.engine,
    modelOverride: payload.modelOverride,
    promptOverride: payload.promptOverride,
  });

  const translatedText = response.translations[0] ?? '';
  await addHistoryEntry({
    id: uniqueId(),
    text: payload.text,
    translatedText,
    sourceLanguage,
    targetLanguage,
    engine: response.engine,
    timestamp: Date.now(),
  });

  return {
    translatedText,
    detectedSourceLanguage: response.detectedSourceLanguage,
    engine: response.engine,
    cached: Boolean(response.cachedCount),
  };
}

function removeAllContextMenus(): Promise<void> {
  return new Promise((resolve) => chrome.contextMenus.removeAll(() => resolve()));
}

function createContextMenu(options: chrome.contextMenus.CreateProperties): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.contextMenus.create(options, () => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

async function rebuildContextMenus(): Promise<void> {
  const settings = await getSettings();
  setUILanguagePreference(settings.uiLanguage);
  await removeAllContextMenus();

  await createContextMenu({
    id: MENU_TRANSLATE_SELECTION,
    title: t('contextMenuTranslateSelection'),
    contexts: ['selection'],
  });

  await createContextMenu({
    id: MENU_TRANSLATE_PAGE,
    title: t('contextMenuTranslatePage'),
    contexts: ['page', 'selection'],
  });

  await createContextMenu({
    id: MENU_SILENT_PARENT,
    title: t('contextMenuSilentMode'),
    contexts: ['action', 'page', 'selection'],
  });

  await createContextMenu({
    id: MENU_SILENT_PARAGRAPH,
    parentId: MENU_SILENT_PARENT,
    title: t('contextMenuSilentParagraph'),
    type: 'radio',
    checked: settings.silentMode === 'paragraph',
    contexts: ['action', 'page', 'selection'],
  });

  await createContextMenu({
    id: MENU_SILENT_FULL_PAGE,
    parentId: MENU_SILENT_PARENT,
    title: t('contextMenuSilentFullPage'),
    type: 'radio',
    checked: settings.silentMode === 'full-page',
    contexts: ['action', 'page', 'selection'],
  });

  await createContextMenu({
    id: MENU_OPEN_OPTIONS,
    title: t('contextMenuOpenSettings'),
    contexts: ['action'],
  });
}

async function getActiveTabId(): Promise<number | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id ?? null;
}

async function sendToActiveTab(message: ContentMessage): Promise<void> {
  const tabId = await getActiveTabId();
  if (!tabId) {
    return;
  }

  try {
    await chrome.tabs.sendMessage(tabId, message);
  } catch {
    // Unsupported pages like the browser store or internal pages can reject.
  }
}

function isCommandName(value: unknown): value is CommandName {
  return typeof value === 'string' && COMMANDS.has(value as CommandName);
}

async function routeCommand(command: CommandName): Promise<void> {
  await sendToActiveTab({ type: 'RUN_COMMAND', payload: { command } });
}

let contextMenuRebuildQueue: Promise<void> = Promise.resolve();

function queueContextMenuRebuild(): void {
  contextMenuRebuildQueue = contextMenuRebuildQueue
    .catch(() => undefined)
    .then(rebuildContextMenus)
    .catch((error: unknown) => {
      console.warn('Failed to rebuild silence-translator context menus:', error);
    });
}

chrome.runtime.onInstalled.addListener(() => {
  void initializeSettings().then(() => queueContextMenuRebuild());
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'sync' && changes.settings) {
    queueContextMenuRebuild();
  }
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === MENU_TRANSLATE_SELECTION) {
    void sendToActiveTab({
      type: 'CONTEXT_TRANSLATE_SELECTION',
      payload: { selectedText: info.selectionText },
    });
    return;
  }

  if (info.menuItemId === MENU_TRANSLATE_PAGE) {
    void sendToActiveTab({ type: 'CONTEXT_TRANSLATE_PAGE' });
    return;
  }

  if (info.menuItemId === MENU_SILENT_PARAGRAPH) {
    void updateSettings({ silentMode: 'paragraph' });
    return;
  }

  if (info.menuItemId === MENU_SILENT_FULL_PAGE) {
    void updateSettings({ silentMode: 'full-page' });
    return;
  }

  if (info.menuItemId === MENU_OPEN_OPTIONS) {
    void chrome.runtime.openOptionsPage();
  }
});

chrome.commands.onCommand.addListener((command) => {
  if (!isCommandName(command)) {
    return;
  }

  void routeCommand(command);
});

chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
  void (async () => {
    switch (message.type) {
      case 'SETTINGS_GET': {
        const settings = await getSettings();
        setUILanguagePreference(settings.uiLanguage);
        sendResponse(settings);
        return;
      }
      case 'SETTINGS_UPDATE': {
        const updated = await updateSettings(message.payload);
        setUILanguagePreference(updated.uiLanguage);
        sendResponse(updated);
        return;
      }
      case 'TRANSLATE_TEXT': {
        sendResponse(await translateSingle(message.payload));
        return;
      }
      case 'TRANSLATE_BATCH': {
        sendResponse(await translateMany(message.payload));
        return;
      }
      case 'HISTORY_GET': {
        sendResponse(await getHistory());
        return;
      }
      case 'HISTORY_CLEAR': {
        await clearHistory();
        sendResponse({ ok: true });
        return;
      }
      case 'COMMAND_TRIGGER': {
        if (!isCommandName(message.payload.command)) {
          sendResponse({ error: 'Unknown command.' });
          return;
        }

        await routeCommand(message.payload.command);
        sendResponse({ ok: true });
        return;
      }
      case 'OPEN_OPTIONS': {
        await chrome.runtime.openOptionsPage();
        sendResponse({ ok: true });
        return;
      }
      default: {
        sendResponse({ ok: false });
      }
    }
  })().catch((error: unknown) => {
    const messageText = error instanceof Error ? error.message : 'Unknown error';
    sendResponse({ error: messageText });
  });

  return true;
});
