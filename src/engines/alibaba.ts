import { BaseTranslationEngine } from './base';

import { hmacSha1Base64 } from '../utils/crypto';
import { normalizeLanguageCode } from '../utils/languages';
import type { EngineRequest, EngineResponse } from '../types';

interface AlibabaTranslationResponse {
  Code?: number;
  Message?: string;
  RequestId?: string;
  Data?: {
    Translated?: string;
    DetectedLanguage?: string;
  };
}

function percentEncode(value: string): string {
  return encodeURIComponent(value).replace(/\+/g, '%20').replace(/\*/g, '%2A').replace(/%7E/g, '~');
}

function toAlibabaLanguage(code: string): string {
  const normalized = normalizeLanguageCode(code);
  if (normalized === 'auto') {
    return 'auto';
  }

  const map: Record<string, string> = {
    zh: 'zh',
    'zh-CN': 'zh',
    'zh-TW': 'zh-tw',
  };

  return map[normalized] ?? normalized.split('-')[0].toLowerCase();
}

function fromAlibabaLanguage(code?: string): string | undefined {
  if (!code) {
    return undefined;
  }

  if (code === 'zh') {
    return 'zh';
  }

  if (code === 'zh-tw') {
    return 'zh-TW';
  }

  return normalizeLanguageCode(code);
}

function toIso8601Timestamp(value: Date): string {
  return value.toISOString().replace(/\.\d{3}Z$/u, 'Z');
}

export class AlibabaEngine extends BaseTranslationEngine {
  readonly provider = 'alibaba' as const;

  async translate(request: EngineRequest): Promise<EngineResponse> {
    const accessKeyId = this.requireApiKey(request.config.apiKey, 'AccessKey ID');
    const accessKeySecret = this.requireApiSecret(request.config.apiSecret, 'AccessKey Secret');
    const translations: string[] = [];
    let detectedSourceLanguage = '';

    for (const text of request.texts) {
      const response = await this.requestSignedTranslation({
        accessKeyId,
        accessKeySecret,
        sourceLanguage: toAlibabaLanguage(request.sourceLanguage),
        targetLanguage: toAlibabaLanguage(request.targetLanguage),
        text,
      });

      if (response.Code !== 200) {
        throw new Error(`alibaba request failed (${response.Code ?? 'unknown'}): ${response.Message ?? 'Unknown error'}`);
      }

      const translated = response.Data?.Translated;
      if (typeof translated !== 'string') {
        throw new Error('alibaba request failed: missing translated text.');
      }

      translations.push(translated);
      if (request.sourceLanguage === 'auto') {
        detectedSourceLanguage ||= fromAlibabaLanguage(response.Data?.DetectedLanguage) ?? '';
      }
    }

    return {
      translations,
      detectedSourceLanguage: detectedSourceLanguage || undefined,
    };
  }

  private async requestSignedTranslation({
    accessKeyId,
    accessKeySecret,
    sourceLanguage,
    targetLanguage,
    text,
  }: {
    accessKeyId: string;
    accessKeySecret: string;
    sourceLanguage: string;
    targetLanguage: string;
    text: string;
  }): Promise<AlibabaTranslationResponse> {
    const params: Record<string, string> = {
      Action: 'TranslateGeneral',
      Format: 'JSON',
      FormatType: 'text',
      AccessKeyId: accessKeyId,
      SignatureMethod: 'HMAC-SHA1',
      SignatureNonce: crypto.randomUUID(),
      SignatureVersion: '1.0',
      SourceLanguage: sourceLanguage,
      TargetLanguage: targetLanguage,
      SourceText: text,
      Scene: 'general',
      Timestamp: toIso8601Timestamp(new Date()),
      Version: '2018-10-12',
    };

    const canonicalizedQueryString = Object.entries(params)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${percentEncode(key)}=${percentEncode(value)}`)
      .join('&');
    const stringToSign = `POST&%2F&${percentEncode(canonicalizedQueryString)}`;
    const signature = await hmacSha1Base64(`${accessKeySecret}&`, stringToSign);
    const body = new URLSearchParams({
      ...params,
      Signature: signature,
    });

    return this.requestJson<AlibabaTranslationResponse>('https://mt.cn-hangzhou.aliyuncs.com/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      },
      body: body.toString(),
    });
  }
}
