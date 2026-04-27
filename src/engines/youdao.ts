import { BaseTranslationEngine } from './base';

import { sha256Hex } from '../utils/crypto';
import { normalizeLanguageCode } from '../utils/languages';
import type { EngineRequest, EngineResponse } from '../types';

interface YoudaoBatchResult {
  query?: string;
  translation?: string;
  type?: string;
}

interface YoudaoBatchResponse {
  errorCode?: string;
  errorIndex?: number[];
  translateResults?: YoudaoBatchResult[];
}

interface YoudaoDetectResponse {
  errorCode?: string;
  errorMessage?: string;
  data?: Array<{
    language?: string;
    confidence?: number;
  }>;
}

function toYoudaoLanguage(code: string): string {
  const normalized = normalizeLanguageCode(code);
  if (normalized === 'auto') {
    return 'auto';
  }

  const map: Record<string, string> = {
    zh: 'zh-CHS',
    'zh-CN': 'zh-CHS',
    'zh-TW': 'zh-CHT',
  };

  return map[normalized] ?? normalized.split('-')[0];
}

function fromYoudaoLanguage(code?: string): string | undefined {
  if (!code) {
    return undefined;
  }

  if (code === 'zh-CHS') {
    return 'zh';
  }

  if (code === 'zh-CHT') {
    return 'zh-TW';
  }

  return normalizeLanguageCode(code);
}

function fromYoudaoType(type?: string): string | undefined {
  if (!type) {
    return undefined;
  }

  const [source] = type.split('2');
  return fromYoudaoLanguage(source);
}

function truncateBatchInput(values: string[]): string {
  const joined = values.join('');
  return joined.length <= 20 ? joined : `${joined.slice(0, 10)}${joined.length}${joined.slice(-10)}`;
}

export class YoudaoEngine extends BaseTranslationEngine {
  readonly provider = 'youdao' as const;

  async translate(request: EngineRequest): Promise<EngineResponse> {
    const appKey = this.requireApiKey(request.config.apiKey, 'App key');
    const appSecret = this.requireApiSecret(request.config.apiSecret, 'App secret');
    const targetLanguage = toYoudaoLanguage(request.targetLanguage);
    let sourceLanguage = toYoudaoLanguage(request.sourceLanguage);
    let detectedSourceLanguage = '';

    if (request.sourceLanguage === 'auto') {
      const detectedLanguage = await this.detectLanguage(request.texts.join('\n'), appKey, appSecret);
      if (detectedLanguage) {
        detectedSourceLanguage = detectedLanguage;
        sourceLanguage = toYoudaoLanguage(detectedLanguage);
      }
    }

    if (sourceLanguage !== 'auto' && sourceLanguage === targetLanguage) {
      return {
        translations: request.texts,
        detectedSourceLanguage: detectedSourceLanguage || undefined,
      };
    }

    const response = await this.requestBatchTranslation(request.texts, sourceLanguage, targetLanguage, appKey, appSecret);

    if (response.errorCode && response.errorCode !== '0') {
      throw new Error(`youdao request failed (${response.errorCode}).`);
    }

    if (response.errorIndex?.length) {
      throw new Error(`youdao request failed for ${response.errorIndex.length} text fragment${response.errorIndex.length === 1 ? '' : 's'}.`);
    }

    const results = response.translateResults ?? [];
    if (results.length !== request.texts.length) {
      throw new Error(`youdao request failed: expected ${request.texts.length} translations but received ${results.length}.`);
    }

    detectedSourceLanguage ||= request.sourceLanguage === 'auto' ? fromYoudaoType(results[0]?.type) ?? '' : '';

    return {
      translations: results.map((item) => item.translation ?? ''),
      detectedSourceLanguage: detectedSourceLanguage || undefined,
    };
  }

  private async detectLanguage(text: string, appKey: string, appSecret: string): Promise<string | undefined> {
    const sample = text.slice(0, 5000);
    const salt = crypto.randomUUID();
    const curtime = `${Math.floor(Date.now() / 1000)}`;
    const params = new URLSearchParams({
      appKey,
      salt,
      signType: 'v3',
      curtime,
      q: sample,
      sign: await sha256Hex(`${appKey}${truncateBatchInput([sample])}${salt}${curtime}${appSecret}`),
    });

    try {
      const response = await this.requestJson<YoudaoDetectResponse>('https://openapi.youdao.com/v1/detect', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        },
        body: params.toString(),
      });

      if (response.errorCode && response.errorCode !== '0') {
        return undefined;
      }

      const detection = (response.data ?? [])
        .filter((item) => item.language)
        .sort((left, right) => (right.confidence ?? 0) - (left.confidence ?? 0))[0];

      return fromYoudaoLanguage(detection?.language);
    } catch {
      return undefined;
    }
  }

  private async requestBatchTranslation(
    texts: string[],
    sourceLanguage: string,
    targetLanguage: string,
    appKey: string,
    appSecret: string,
  ): Promise<YoudaoBatchResponse> {
    const salt = crypto.randomUUID();
    const curtime = `${Math.floor(Date.now() / 1000)}`;
    const signInput = `${appKey}${truncateBatchInput(texts)}${salt}${curtime}${appSecret}`;
    const params = new URLSearchParams({
      from: sourceLanguage,
      to: targetLanguage,
      appKey,
      salt,
      signType: 'v3',
      curtime,
      sign: await sha256Hex(signInput),
      strict: 'true',
    });

    texts.forEach((text) => {
      params.append('q', text);
    });

    return this.requestJson<YoudaoBatchResponse>('https://openapi.youdao.com/v2/api', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      },
      body: params.toString(),
    });
  }
}
