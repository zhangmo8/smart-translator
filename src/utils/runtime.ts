import type {
  RuntimeMessage,
  TranslatePayload,
  TranslateResponse,
  TranslationHistoryEntry,
  TranslationSettings,
} from '../types';

async function sendMessage<T>(message: RuntimeMessage): Promise<T> {
  const response = (await chrome.runtime.sendMessage(message)) as T & { error?: string };
  if (response && typeof response === 'object' && 'error' in response && response.error) {
    throw new Error(response.error);
  }

  return response;
}

export function getSettingsFromRuntime(): Promise<TranslationSettings> {
  return sendMessage<TranslationSettings>({ type: 'SETTINGS_GET' });
}

export function updateSettingsInRuntime(payload: Partial<TranslationSettings>): Promise<TranslationSettings> {
  return sendMessage<TranslationSettings>({ type: 'SETTINGS_UPDATE', payload });
}

export function getHistoryFromRuntime(): Promise<TranslationHistoryEntry[]> {
  return sendMessage<TranslationHistoryEntry[]>({ type: 'HISTORY_GET' });
}

export function clearHistoryInRuntime(): Promise<{ ok: boolean }> {
  return sendMessage<{ ok: boolean }>({ type: 'HISTORY_CLEAR' });
}

export function translateTextInRuntime(payload: TranslatePayload): Promise<TranslateResponse> {
  return sendMessage<TranslateResponse>({ type: 'TRANSLATE_TEXT', payload });
}

export function openOptionsInRuntime(): Promise<{ ok: boolean }> {
  return sendMessage<{ ok: boolean }>({ type: 'OPEN_OPTIONS' });
}
