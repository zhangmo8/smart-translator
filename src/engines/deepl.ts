import { BaseTranslationEngine } from './base';

import { normalizeLanguageCode, toBaseLanguage } from '../utils/languages';
import type { EngineRequest, EngineResponse } from '../types';

interface DeepLResponse {
  translations: Array<{
    text: string;
    detected_source_language?: string;
  }>;
}

function toDeepLLanguage(code: string): string {
  const normalized = normalizeLanguageCode(code);
  const map: Record<string, string> = {
    en: 'EN',
    pt: 'PT-PT',
    'zh-CN': 'ZH',
    'zh-TW': 'ZH',
  };

  return map[normalized] ?? map[toBaseLanguage(normalized)] ?? normalized.toUpperCase();
}

export class DeepLEngine extends BaseTranslationEngine {
  readonly provider = 'deepl' as const;

  async translate(request: EngineRequest): Promise<EngineResponse> {
    const apiKey = this.requireApiKey(request.config.apiKey);
    const url = request.config.apiUrl || 'https://api-free.deepl.com/v2/translate';
    const body = new URLSearchParams();
    request.texts.forEach((text) => body.append('text', text));
    body.set('target_lang', toDeepLLanguage(request.targetLanguage));

    if (request.sourceLanguage !== 'auto') {
      body.set('source_lang', toDeepLLanguage(request.sourceLanguage));
    }

    const response = await this.requestJson<DeepLResponse>(url, {
      method: 'POST',
      headers: {
        Authorization: `DeepL-Auth-Key ${apiKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    const translations = response.translations.map((item) => item.text);
    this.assertTranslationCount(translations, request.texts.length);

    return {
      translations,
      detectedSourceLanguage: response.translations[0]?.detected_source_language,
    };
  }
}
