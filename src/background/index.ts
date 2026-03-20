import { getEngine } from '../engines';
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
import { BATCH_SIZE, ENGINE_META, RATE_LIMIT_MS } from '../utils/constants';

const MENU_TRANSLATE_SELECTION = 'silence-translator:translate-selection';
const MENU_TRANSLATE_PAGE = 'silence-translator:translate-page';
const MENU_SILENT_PARENT = 'silence-translator:silent-parent';
const MENU_SILENT_PARAGRAPH = 'silence-translator:silent-paragraph';
const MENU_SILENT_FULL_PAGE = 'silence-translator:silent-full-page';
const MENU_OPEN_OPTIONS = 'silence-translator:open-options';

const engineQueues = new Map<EngineProvider, Promise<unknown>>();
const lastExecution = new Map<EngineProvider, number>();

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

  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

function assertEngineConfigured(provider: EngineProvider, config: EngineConfig): void {
  const meta = ENGINE_META[provider];
  const missing: string[] = [];

  if (meta.requiresApiKey && !config.apiKey?.trim()) {
    missing.push(meta.apiKeyLabel ?? 'API key');
  }

  if (meta.requiresApiSecret && !config.apiSecret?.trim()) {
    missing.push(meta.apiSecretLabel ?? 'API secret');
  }

  if (meta.requiresRegion && !config.region?.trim()) {
    missing.push(meta.regionLabel ?? 'Region');
  }

  if (!missing.length) {
    return;
  }

  throw new Error(`${meta.label} is not configured yet. Add ${joinLabels(missing)} in Settings, then try again.`);
}

async function withRateLimit<T>(provider: EngineProvider, task: () => Promise<T>): Promise<T> {
  const previous = engineQueues.get(provider) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(async () => {
    const waitMs = Math.max(0, (lastExecution.get(provider) ?? 0) + RATE_LIMIT_MS[provider] - Date.now());
    if (waitMs > 0) {
      await sleep(waitMs);
    }

    try {
      return await task();
    } finally {
      lastExecution.set(provider, Date.now());
    }
  });

  engineQueues.set(provider, run.then(() => undefined, () => undefined));
  return run;
}

async function translateMany(payload: TranslateBatchPayload): Promise<TranslateBatchResponse> {
  const settings = await getSettings();
  const provider = payload.engine ?? settings.defaultEngine;
  const config = settings.engines[provider];
  assertEngineConfigured(provider, config);
  const engine = getEngine(provider);
  const texts = payload.texts.filter((text) => text.trim().length > 0);

  if (!texts.length) {
    return { translations: [], engine: provider, cachedCount: 0 };
  }

  const model = payload.modelOverride || config.model;
  const cache = settings.cacheEnabled ? await getCache() : {};
  const results = new Array<string>(texts.length);
  let detectedSourceLanguage = '';
  let cachedCount = 0;

  const uncached = new Map<string, { key: string; text: string; indexes: number[] }>();
  texts.forEach((text, index) => {
    const key = buildCacheKey(provider, payload.sourceLanguage, payload.targetLanguage, text, model);
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
        sourceLanguage: payload.sourceLanguage,
        targetLanguage: payload.targetLanguage,
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
  const response = await translateMany({
    texts: [payload.text],
    sourceLanguage: payload.sourceLanguage,
    targetLanguage: payload.targetLanguage,
    engine: payload.engine,
    modelOverride: payload.modelOverride,
    promptOverride: payload.promptOverride,
  });

  const translatedText = response.translations[0] ?? '';
  await addHistoryEntry({
    id: uniqueId(),
    text: payload.text,
    translatedText,
    sourceLanguage: payload.sourceLanguage,
    targetLanguage: payload.targetLanguage,
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
  await removeAllContextMenus();

  await createContextMenu({
    id: MENU_TRANSLATE_SELECTION,
    title: 'Translate selection',
    contexts: ['selection'],
  });

  await createContextMenu({
    id: MENU_TRANSLATE_PAGE,
    title: 'Translate full page',
    contexts: ['page', 'selection'],
  });

  await createContextMenu({
    id: MENU_SILENT_PARENT,
    title: 'Silent translate mode',
    contexts: ['action', 'page', 'selection'],
  });

  await createContextMenu({
    id: MENU_SILENT_PARAGRAPH,
    parentId: MENU_SILENT_PARENT,
    title: 'Paragraph under cursor',
    type: 'radio',
    checked: settings.silentMode === 'paragraph',
    contexts: ['action', 'page', 'selection'],
  });

  await createContextMenu({
    id: MENU_SILENT_FULL_PAGE,
    parentId: MENU_SILENT_PARENT,
    title: 'Full page',
    type: 'radio',
    checked: settings.silentMode === 'full-page',
    contexts: ['action', 'page', 'selection'],
  });

  await createContextMenu({
    id: MENU_OPEN_OPTIONS,
    title: 'Open silence-translator settings',
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

async function routeCommand(command: CommandName): Promise<void> {
  await sendToActiveTab({ type: 'RUN_COMMAND', payload: { command } });
}

chrome.runtime.onInstalled.addListener(() => {
  void initializeSettings().then(rebuildContextMenus);
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'sync' && changes.settings) {
    void rebuildContextMenus();
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
  const safeCommand = command as CommandName;
  void routeCommand(safeCommand);
});

chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
  void (async () => {
    switch (message.type) {
      case 'SETTINGS_GET': {
        sendResponse(await getSettings());
        return;
      }
      case 'SETTINGS_UPDATE': {
        const updated = await updateSettings(message.payload);
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
