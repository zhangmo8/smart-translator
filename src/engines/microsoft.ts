import { BaseTranslationEngine } from './base';

import { normalizeLanguageCode } from '../utils/languages';
import type { EngineRequest, EngineResponse } from '../types';

interface MicrosoftTranslationResponse {
  detectedLanguage?: {
    language: string;
  };
  translations: Array<{
    text: string;
    to: string;
  }>;
}

function toMicrosoftLanguage(code: string): string {
  const normalized = normalizeLanguageCode(code);
  const map: Record<string, string> = {
    'zh-CN': 'zh-Hans',
    'zh-TW': 'zh-Hant',
  };
  return map[normalized] ?? normalized;
}

export class MicrosoftEngine extends BaseTranslationEngine {
  readonly provider = 'microsoft' as const;

  async translate(request: EngineRequest): Promise<EngineResponse> {
    const apiKey = this.requireApiKey(request.config.apiKey);
    if (!request.config.region) {
      throw new Error('Azure Translator region is required for microsoft.');
    }

    const target = toMicrosoftLanguage(request.targetLanguage);
    const query = new URLSearchParams({
      'api-version': '3.0',
      to: target,
    });

    if (request.sourceLanguage !== 'auto') {
      query.set('from', toMicrosoftLanguage(request.sourceLanguage));
    }

    const url = `https://api.cognitive.microsofttranslator.com/translate?${query.toString()}`;
    const response = await this.requestJson<MicrosoftTranslationResponse[]>(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Ocp-Apim-Subscription-Key': apiKey,
        'Ocp-Apim-Subscription-Region': request.config.region,
      },
      body: JSON.stringify(request.texts.map((text) => ({ Text: text }))),
    });

    const translations = response.map((item) => item.translations[0]?.text ?? '');
    this.assertTranslationCount(translations, request.texts.length);

    return {
      translations,
      detectedSourceLanguage: response[0]?.detectedLanguage?.language,
    };
  }
}
