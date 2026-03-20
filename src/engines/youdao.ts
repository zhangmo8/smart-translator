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

function fromYoudaoType(type?: string): string | undefined {
  if (!type) {
    return undefined;
  }

  const [source] = type.split('2');
  if (source === 'zh-CHS') {
    return 'zh';
  }

  if (source === 'zh-CHT') {
    return 'zh-TW';
  }

  return normalizeLanguageCode(source);
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
    const salt = crypto.randomUUID();
    const curtime = `${Math.floor(Date.now() / 1000)}`;
    const q = request.texts;
    const signInput = `${appKey}${truncateBatchInput(q)}${salt}${curtime}${appSecret}`;
    const params = new URLSearchParams({
      from: toYoudaoLanguage(request.sourceLanguage),
      to: toYoudaoLanguage(request.targetLanguage),
      appKey,
      salt,
      signType: 'v3',
      curtime,
      sign: await sha256Hex(signInput),
      strict: 'true',
    });

    q.forEach((text) => {
      params.append('q', text);
    });

    const response = await this.requestJson<YoudaoBatchResponse>('https://openapi.youdao.com/v2/api', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      },
      body: params.toString(),
    });

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

    return {
      translations: results.map((item) => item.translation ?? ''),
      detectedSourceLanguage: request.sourceLanguage === 'auto' ? fromYoudaoType(results[0]?.type) : undefined,
    };
  }
}
