import { BaseTranslationEngine } from './base';

import type { EngineRequest, EngineResponse } from '../types';

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
}

export class GeminiEngine extends BaseTranslationEngine {
  readonly provider = 'gemini' as const;

  async translate(request: EngineRequest): Promise<EngineResponse> {
    const apiKey = this.requireApiKey(request.config.apiKey);
    const model = request.modelOverride || request.config.model || 'gemini-1.5-flash';
    const { systemPrompt, userPrompt } = this.createBatchPrompt(request);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const response = await this.requestJson<GeminiResponse>(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: systemPrompt }],
        },
        contents: [
          {
            role: 'user',
            parts: [{ text: userPrompt }],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: 'application/json',
        },
      }),
    });

    const raw = response.candidates?.[0]?.content?.parts?.map((item) => item.text ?? '').join('\n') ?? '';
    return this.parseAiBatchResponse(raw, request.texts.length);
  }
}
