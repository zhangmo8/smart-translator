import { BaseTranslationEngine } from './base';

import type { EngineRequest, EngineResponse } from '../types';

interface DeepSeekResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

export class DeepSeekEngine extends BaseTranslationEngine {
  readonly provider = 'deepseek' as const;

  async translate(request: EngineRequest): Promise<EngineResponse> {
    const apiKey = this.requireApiKey(request.config.apiKey);
    const model = request.modelOverride || request.config.model || 'deepseek-chat';
    const { systemPrompt, userPrompt } = this.createBatchPrompt(request);
    const response = await this.requestJson<DeepSeekResponse>('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    });

    return this.parseAiBatchResponse(response.choices[0]?.message?.content ?? '', request.texts.length);
  }
}
