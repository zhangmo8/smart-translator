import { BaseTranslationEngine } from './base';

import { toBaseLanguage } from '../utils/languages';
import type { EngineRequest, EngineResponse } from '../types';

interface LibreTranslateResponse {
  translatedText: string;
  detectedLanguage?: {
    language: string;
  };
}

export class LibreTranslateEngine extends BaseTranslationEngine {
  readonly provider = 'libretranslate' as const;

  async translate(request: EngineRequest): Promise<EngineResponse> {
    const url = request.config.apiUrl || 'https://libretranslate.com/translate';
    const source = request.sourceLanguage === 'auto' ? 'auto' : toBaseLanguage(request.sourceLanguage);
    const target = toBaseLanguage(request.targetLanguage);

    const results = await Promise.all(
      request.texts.map((text) =>
        this.requestJson<LibreTranslateResponse>(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            q: text,
            source,
            target,
            format: 'text',
            api_key: request.config.apiKey || undefined,
          }),
        }),
      ),
    );

    return {
      translations: results.map((item) => item.translatedText),
      detectedSourceLanguage: results[0]?.detectedLanguage?.language,
    };
  }
}
