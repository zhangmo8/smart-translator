import { BaseTranslationEngine } from './base';

import { md5Hex } from '../utils/crypto';
import { normalizeLanguageCode } from '../utils/languages';
import type { EngineRequest, EngineResponse } from '../types';

interface BaiduTranslationResponse {
  error_code?: string;
  error_msg?: string;
  from?: string;
  to?: string;
  trans_result?: Array<{
    src: string;
    dst: string;
  }>;
}

function toBaiduLanguage(code: string): string {
  const normalized = normalizeLanguageCode(code);
  if (normalized === 'auto') {
    return 'auto';
  }

  const map: Record<string, string> = {
    zh: 'zh',
    'zh-CN': 'zh',
    'zh-TW': 'cht',
    ja: 'jp',
    ko: 'kor',
    fr: 'fra',
    es: 'spa',
    ar: 'ara',
    bg: 'bul',
    et: 'est',
    da: 'dan',
    fi: 'fin',
    ro: 'rom',
    sk: 'slo',
    sv: 'swe',
    vi: 'vie',
  };

  return map[normalized] ?? normalized.split('-')[0];
}

function fromBaiduLanguage(code?: string): string | undefined {
  if (!code) {
    return undefined;
  }

  const map: Record<string, string> = {
    zh: 'zh',
    cht: 'zh-TW',
    jp: 'ja',
    kor: 'ko',
    fra: 'fr',
    spa: 'es',
    ara: 'ar',
    bul: 'bg',
    est: 'et',
    dan: 'da',
    fin: 'fi',
    rom: 'ro',
    slo: 'sk',
    swe: 'sv',
    vie: 'vi',
  };

  return map[code] ?? normalizeLanguageCode(code);
}

export class BaiduEngine extends BaseTranslationEngine {
  readonly provider = 'baidu' as const;

  async translate(request: EngineRequest): Promise<EngineResponse> {
    const appId = this.requireApiKey(request.config.apiKey, 'APP ID');
    const secretKey = this.requireApiSecret(request.config.apiSecret, 'Secret key');
    const source = toBaiduLanguage(request.sourceLanguage);
    const target = toBaiduLanguage(request.targetLanguage);
    const translations: string[] = [];
    let detectedSourceLanguage = '';

    for (const text of request.texts) {
      const salt = crypto.randomUUID();
      const params = new URLSearchParams({
        q: text,
        from: source,
        to: target,
        appid: appId,
        salt,
        sign: md5Hex(`${appId}${text}${salt}${secretKey}`),
      });

      const response = await this.requestJson<BaiduTranslationResponse>('https://fanyi-api.baidu.com/api/trans/vip/translate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        },
        body: params.toString(),
      });

      if (response.error_code) {
        throw new Error(`baidu request failed (${response.error_code}): ${response.error_msg ?? 'Unknown error'}`);
      }

      const translated = response.trans_result?.[0]?.dst;
      if (typeof translated !== 'string') {
        throw new Error('baidu request failed: missing translated text.');
      }

      translations.push(translated);
      if (request.sourceLanguage === 'auto') {
        detectedSourceLanguage ||= fromBaiduLanguage(response.from) ?? '';
      }
    }

    return {
      translations,
      detectedSourceLanguage: detectedSourceLanguage || undefined,
    };
  }
}
