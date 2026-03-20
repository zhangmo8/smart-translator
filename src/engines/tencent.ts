import { BaseTranslationEngine } from './base';

import { hmacSha256Bytes, hmacSha256Hex, sha256Hex } from '../utils/crypto';
import { normalizeLanguageCode } from '../utils/languages';
import type { EngineRequest, EngineResponse } from '../types';

interface TencentTextTranslateResponse {
  Response: {
    TargetText?: string;
    Source?: string;
    Error?: {
      Code: string;
      Message: string;
    };
  };
}

function toTencentLanguage(code: string): string {
  const normalized = normalizeLanguageCode(code);
  if (normalized === 'auto') {
    return 'auto';
  }

  const map: Record<string, string> = {
    zh: 'zh',
    'zh-CN': 'zh',
    'zh-TW': 'zh-TW',
  };

  return map[normalized] ?? normalized.split('-')[0];
}

function fromTencentLanguage(code?: string): string | undefined {
  if (!code) {
    return undefined;
  }

  if (code === 'zh') {
    return 'zh';
  }

  if (code === 'zh-TW') {
    return 'zh-TW';
  }

  return normalizeLanguageCode(code);
}

export class TencentEngine extends BaseTranslationEngine {
  readonly provider = 'tencent' as const;

  async translate(request: EngineRequest): Promise<EngineResponse> {
    const secretId = this.requireApiKey(request.config.apiKey, 'SecretId');
    const secretKey = this.requireApiSecret(request.config.apiSecret, 'SecretKey');
    const region = request.config.region?.trim();

    if (!region) {
      throw new Error('Region is required for tencent.');
    }

    const translations: string[] = [];
    let detectedSourceLanguage = '';

    for (const text of request.texts) {
      const response = await this.requestSignedTranslation({
        text,
        sourceLanguage: toTencentLanguage(request.sourceLanguage),
        targetLanguage: toTencentLanguage(request.targetLanguage),
        secretId,
        secretKey,
        region,
      });

      if (response.Response.Error) {
        throw new Error(`tencent request failed (${response.Response.Error.Code}): ${response.Response.Error.Message}`);
      }

      const translated = response.Response.TargetText;
      if (typeof translated !== 'string') {
        throw new Error('tencent request failed: missing translated text.');
      }

      translations.push(translated);
      if (request.sourceLanguage === 'auto') {
        detectedSourceLanguage ||= fromTencentLanguage(response.Response.Source) ?? '';
      }
    }

    return {
      translations,
      detectedSourceLanguage: detectedSourceLanguage || undefined,
    };
  }

  private async requestSignedTranslation({
    text,
    sourceLanguage,
    targetLanguage,
    secretId,
    secretKey,
    region,
  }: {
    text: string;
    sourceLanguage: string;
    targetLanguage: string;
    secretId: string;
    secretKey: string;
    region: string;
  }): Promise<TencentTextTranslateResponse> {
    const service = 'tmt';
    const host = 'tmt.tencentcloudapi.com';
    const action = 'TextTranslate';
    const version = '2018-03-21';
    const timestamp = Math.floor(Date.now() / 1000);
    const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
    const payload = JSON.stringify({
      SourceText: text,
      Source: sourceLanguage,
      Target: targetLanguage,
      ProjectId: 0,
    });
    const contentType = 'application/json; charset=utf-8';
    const canonicalHeaders = `content-type:${contentType}\nhost:${host}\nx-tc-action:${action.toLowerCase()}\n`;
    const signedHeaders = 'content-type;host;x-tc-action';
    const canonicalRequest = `POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${await sha256Hex(payload)}`;
    const credentialScope = `${date}/${service}/tc3_request`;
    const stringToSign = `TC3-HMAC-SHA256\n${timestamp}\n${credentialScope}\n${await sha256Hex(canonicalRequest)}`;
    const secretDate = await hmacSha256Bytes(`TC3${secretKey}`, date);
    const secretService = await hmacSha256Bytes(secretDate, service);
    const secretSigning = await hmacSha256Bytes(secretService, 'tc3_request');
    const signature = await hmacSha256Hex(secretSigning, stringToSign);
    const authorization = `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    return this.requestJson<TencentTextTranslateResponse>(`https://${host}/`, {
      method: 'POST',
      headers: {
        Authorization: authorization,
        'Content-Type': contentType,
        'X-TC-Action': action,
        'X-TC-Region': region,
        'X-TC-Timestamp': `${timestamp}`,
        'X-TC-Version': version,
      },
      body: payload,
    });
  }
}
