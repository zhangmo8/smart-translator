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

interface AlibabaLanguageDetectResponse {
  Code?: number | string;
  Message?: string;
  RequestId?: string;
  DetectedLanguage?: string;
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
    const requestedSourceLanguage = toAlibabaLanguage(request.sourceLanguage);
    const targetLanguage = toAlibabaLanguage(request.targetLanguage);

    for (const text of request.texts) {
      let sourceLanguage = requestedSourceLanguage;

      if (request.sourceLanguage === 'auto') {
        const detectedLanguage = await this.detectLanguage(text, accessKeyId, accessKeySecret);
        if (detectedLanguage) {
          detectedSourceLanguage ||= detectedLanguage;
          sourceLanguage = toAlibabaLanguage(detectedLanguage);
        }
      }

      if (sourceLanguage !== 'auto' && sourceLanguage === targetLanguage) {
        translations.push(text);
        continue;
      }

      const response = await this.requestSignedTranslation({
        accessKeyId,
        accessKeySecret,
        sourceLanguage,
        targetLanguage,
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

  private async detectLanguage(text: string, accessKeyId: string, accessKeySecret: string): Promise<string | undefined> {
    try {
      const response = await this.requestSignedAction<AlibabaLanguageDetectResponse>(accessKeyId, accessKeySecret, {
        Action: 'GetDetectLanguage',
        Format: 'JSON',
        AccessKeyId: accessKeyId,
        SignatureMethod: 'HMAC-SHA1',
        SignatureNonce: crypto.randomUUID(),
        SignatureVersion: '1.0',
        SourceText: text.slice(0, 5000),
        Timestamp: toIso8601Timestamp(new Date()),
        Version: '2018-10-12',
      });

      if (response.Code && `${response.Code}` !== '200') {
        return undefined;
      }

      return fromAlibabaLanguage(response.DetectedLanguage);
    } catch {
      return undefined;
    }
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
    return this.requestSignedAction<AlibabaTranslationResponse>(accessKeyId, accessKeySecret, {
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
    });
  }

  private async requestSignedAction<T>(
    accessKeyId: string,
    accessKeySecret: string,
    params: Record<string, string>,
  ): Promise<T> {
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

    return this.requestJson<T>('https://mt.cn-hangzhou.aliyuncs.com/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      },
      body: body.toString(),
    });
  }
}
