import { BaseTranslationEngine } from './base';

import type { EngineRequest, EngineResponse } from '../types';

interface DoubaoResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

export class DoubaoEngine extends BaseTranslationEngine {
  readonly provider = 'doubao' as const;

  async translate(request: EngineRequest): Promise<EngineResponse> {
    const apiKey = this.requireApiKey(request.config.apiKey);
    const model = request.modelOverride || request.config.model || 'doubao-pro-4k';
    const { systemPrompt, userPrompt } = this.createBatchPrompt(request);
    const endpoint = request.config.endpoint || 'https://ark.cn-beijing.volces.com/api/v3/chat/completions';
    const response = await this.requestJson<DoubaoResponse>(endpoint, {
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
