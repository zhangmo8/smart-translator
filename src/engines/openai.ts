import { BaseTranslationEngine } from './base';
import { ENGINE_META } from '../utils/constants';

import type { EngineRequest, EngineResponse } from '../types';

interface OpenAIResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

export class OpenAIEngine extends BaseTranslationEngine {
  readonly provider = 'openai' as const;

  async translate(request: EngineRequest): Promise<EngineResponse> {
    const apiKey = this.requireApiKey(request.config.apiKey);
    const model = request.modelOverride || request.config.model || 'gpt-4o-mini';
    const { systemPrompt, userPrompt } = this.createBatchPrompt(request);
    const response = await this.requestJson<OpenAIResponse>(request.config.apiUrl || ENGINE_META.openai.defaultApiUrl || 'https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    });

    return this.parseAiBatchResponse(response.choices[0]?.message?.content ?? '', request.texts.length);
  }
}
