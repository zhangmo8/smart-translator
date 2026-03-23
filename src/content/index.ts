import './styles.css';

import { PageTranslator } from './page-translate';
import { SelectionTranslator } from './selection';
import { SilentTranslator } from './silent-translate';
import { HotkeyManager } from './hotkeys';

import { getSettings } from '../store/settings';
import { setUILanguagePreference, t } from '../utils/i18n';
import type { ContentMessage, TranslationSettings } from '../types';

let currentSettings: TranslationSettings;

const settingsGetter = async (): Promise<TranslationSettings> => {
  if (!currentSettings) {
    currentSettings = await getSettings();
  }
  return currentSettings;
};

async function initialize(): Promise<void> {
  currentSettings = await getSettings();
  setUILanguagePreference(currentSettings.uiLanguage);

  const pageTranslator = new PageTranslator(settingsGetter);
  const selectionTranslator = new SelectionTranslator(settingsGetter);
  const silentTranslator = new SilentTranslator(settingsGetter, pageTranslator);
  selectionTranslator.updateDisplaySettings(currentSettings.showSelectionIcon);
  const hotkeys = new HotkeyManager(currentSettings.hotkeys, {
    selection: async () => {
      const handledInput = await selectionTranslator.translateFocusedInput();
      if (handledInput) {
        return;
      }

      await selectionTranslator.translateSelection();
    },
    silent: async () => {
      await silentTranslator.trigger('silent');
    },
    bilingual: async () => {
      await silentTranslator.trigger('bilingual');
    },
    page: async () => {
      await pageTranslator.togglePageTranslation(true);
    },
    restore: () => {
      pageTranslator.restoreOriginalPage(true);
      silentTranslator.clearParagraphState();
    },
  });

  selectionTranslator.mount();

  document.addEventListener('mousemove', (event) => {
    silentTranslator.setHoveredElement(event.target instanceof Element ? event.target : null);
  });

  document.addEventListener('keydown', hotkeys.handleKeydown, true);

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'sync' || !changes.settings?.newValue) {
      return;
    }

    currentSettings = changes.settings.newValue as TranslationSettings;
    setUILanguagePreference(currentSettings.uiLanguage);
    hotkeys.updateHotkeys(currentSettings.hotkeys);
    selectionTranslator.updateDisplaySettings(currentSettings.showSelectionIcon);
  });

  chrome.runtime.onMessage.addListener((message: ContentMessage, _sender, sendResponse) => {
    void (async () => {
      switch (message.type) {
        case 'RUN_COMMAND': {
          if (message.payload.command === 'translate-selection') {
            const handledInput = await selectionTranslator.translateFocusedInput();
            if (!handledInput) {
              await selectionTranslator.translateSelection();
            }
          }

          if (message.payload.command === 'silent-translate') {
            await silentTranslator.trigger('silent');
          }

          if (message.payload.command === 'bilingual-translate') {
            await silentTranslator.trigger('bilingual');
          }

          if (message.payload.command === 'toggle-page-translate') {
            await pageTranslator.togglePageTranslation(true);
          }

          if (message.payload.command === 'restore-original') {
            pageTranslator.restoreOriginalPage(true);
            silentTranslator.clearParagraphState();
          }

          sendResponse({ ok: true });
          return;
        }
        case 'CONTEXT_TRANSLATE_SELECTION': {
          await selectionTranslator.translateSelection(message.payload?.selectedText);
          sendResponse({ ok: true });
          return;
        }
        case 'CONTEXT_TRANSLATE_PAGE': {
          await pageTranslator.translatePage(true);
          sendResponse({ ok: true });
          return;
        }
        case 'PING': {
          sendResponse({ ok: true });
          return;
        }
      }
    })().catch((error: unknown) => {
      sendResponse({ error: error instanceof Error ? error.message : t('unknownError') });
    });

    return true;
  });
}

void initialize();
