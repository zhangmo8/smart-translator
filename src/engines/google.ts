import { BaseTranslationEngine } from './base';

import { normalizeLanguageCode } from '../utils/languages';
import type { EngineRequest, EngineResponse } from '../types';

interface GoogleTranslationResponse {
  data: {
    translations: Array<{
      translatedText: string;
      detectedSourceLanguage?: string;
    }>;
  };
}

export class GoogleEngine extends BaseTranslationEngine {
  readonly provider = 'google' as const;

  async translate(request: EngineRequest): Promise<EngineResponse> {
    const apiKey = this.requireApiKey(request.config.apiKey);
    const url = `https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(apiKey)}`;
    const body: Record<string, unknown> = {
      q: request.texts,
      target: normalizeLanguageCode(request.targetLanguage),
      format: 'text',
    };

    if (request.sourceLanguage !== 'auto') {
      body.source = normalizeLanguageCode(request.sourceLanguage);
    }

    const response = await this.requestJson<GoogleTranslationResponse>(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    return {
      translations: response.data.translations.map((item) => this.decodeHtmlEntities(item.translatedText)),
      detectedSourceLanguage: response.data.translations[0]?.detectedSourceLanguage,
    };
  }
}
