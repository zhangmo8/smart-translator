import { DEFAULT_SYSTEM_PROMPT } from '../utils/constants';
import type { EngineRequest, EngineResponse, EngineProvider } from '../types';

export abstract class BaseTranslationEngine {
  abstract readonly provider: EngineProvider;

  abstract translate(request: EngineRequest): Promise<EngineResponse>;

  protected requireApiKey(apiKey: string | undefined, label = 'API key'): string {
    if (!apiKey) {
      throw new Error(`${label} is required for ${this.provider}.`);
    }

    return apiKey;
  }

  protected async requestJson<T>(url: string, init: RequestInit): Promise<T> {
    const response = await fetch(url, init);
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`${this.provider} request failed (${response.status}): ${errorText.slice(0, 240)}`);
    }

    return (await response.json()) as T;
  }

  protected async requestText(url: string, init: RequestInit): Promise<string> {
    const response = await fetch(url, init);
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`${this.provider} request failed (${response.status}): ${errorText.slice(0, 240)}`);
    }

    return response.text();
  }

  protected createBatchPrompt(request: EngineRequest): { systemPrompt: string; userPrompt: string } {
    const baseInstruction = `${DEFAULT_SYSTEM_PROMPT}\nTranslate from ${
      request.sourceLanguage === 'auto' ? 'the detected source language' : request.sourceLanguage
    } into ${request.targetLanguage}. Return strict JSON with this exact shape: {"translations":["..."]}. Do not wrap in markdown.`;

    const systemPrompt = [baseInstruction, request.config.systemPrompt, request.promptOverride].filter(Boolean).join('\n\n');
    const userPrompt = `Translate this JSON array of strings:\n${JSON.stringify(request.texts)}`;
    return { systemPrompt, userPrompt };
  }

  protected parseAiBatchResponse(raw: string, fallbackLength: number): EngineResponse {
    const cleaned = raw.trim();

    try {
      const jsonStart = cleaned.indexOf('{');
      const jsonEnd = cleaned.lastIndexOf('}');
      const candidate = jsonStart >= 0 && jsonEnd >= jsonStart ? cleaned.slice(jsonStart, jsonEnd + 1) : cleaned;
      const parsed = JSON.parse(candidate) as { translations?: string[] };
      if (Array.isArray(parsed.translations) && parsed.translations.length === fallbackLength) {
        return { translations: parsed.translations.map((item) => `${item}`) };
      }
    } catch {
      // Fallback below.
    }

    if (fallbackLength === 1) {
      return { translations: [cleaned] };
    }

    throw new Error(`Unable to parse translation response from ${this.provider}.`);
  }

  protected decodeHtmlEntities(value: string): string {
    return value
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');
  }
}
