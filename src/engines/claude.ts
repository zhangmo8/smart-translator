import { BaseTranslationEngine } from './base';

import type { EngineRequest, EngineResponse } from '../types';

interface ClaudeResponse {
  content: Array<{
    type: 'text';
    text: string;
  }>;
}

export class ClaudeEngine extends BaseTranslationEngine {
  readonly provider = 'claude' as const;

  async translate(request: EngineRequest): Promise<EngineResponse> {
    const apiKey = this.requireApiKey(request.config.apiKey);
    const model = request.modelOverride || request.config.model || 'claude-3-haiku-20240307';
    const { systemPrompt, userPrompt } = this.createBatchPrompt(request);
    const response = await this.requestJson<ClaudeResponse>('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: 4000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    const raw = response.content.map((item) => item.text).join('\n');
    return this.parseAiBatchResponse(raw, request.texts.length);
  }
}
