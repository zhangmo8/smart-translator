import { BaseTranslationEngine } from './base';

import { toBaseLanguage } from '../utils/languages';
import type { EngineRequest, EngineResponse } from '../types';

interface LibreTranslateResponse {
  translatedText: string;
  detectedLanguage?: {
    language: string;
  };
}

interface LibreTranslateDetection {
  confidence: number;
  language: string;
}

interface LibreTranslateLanguage {
  code: string;
  name: string;
  targets?: string[];
}

interface TextRange {
  start: number;
  end: number;
}

interface TextSegment {
  text: string;
  protected: boolean;
}

export class LibreTranslateEngine extends BaseTranslationEngine {
  readonly provider = 'libretranslate' as const;
  private readonly supportedLanguagesCache = new Map<string, Promise<LibreTranslateLanguage[]>>();

  async translate(request: EngineRequest): Promise<EngineResponse> {
    const url = request.config.apiUrl || 'https://libretranslate.com/translate';
    const source = request.sourceLanguage === 'auto' ? 'auto' : toBaseLanguage(request.sourceLanguage);
    const target = toBaseLanguage(request.targetLanguage);

    const results = await Promise.all(
      request.texts.map((text) => this.translateText(url, text, source, target, request.config.apiKey)),
    );

    return {
      translations: results.map((item) => item.translatedText),
      detectedSourceLanguage: results[0]?.detectedLanguage?.language,
    };
  }

  private async translateText(
    apiUrl: string,
    text: string,
    source: string,
    target: string,
    apiKey?: string,
  ): Promise<LibreTranslateResponse> {
    const opaqueRanges = this.collectOpaqueTokenRanges(text);
    if (opaqueRanges.length) {
      return this.translateSegmentedText(apiUrl, text, opaqueRanges, source, target, apiKey);
    }

    return this.translatePlainText(apiUrl, text, source, target, apiKey);
  }

  private async translatePlainText(
    apiUrl: string,
    text: string,
    source: string,
    target: string,
    apiKey?: string,
  ): Promise<LibreTranslateResponse> {
    if (source !== 'auto') {
      return this.requestTranslation(apiUrl, text, source, target, apiKey);
    }

    try {
      return await this.requestTranslation(apiUrl, text, source, target, apiKey);
    } catch (error: unknown) {
      const fallback = await this.retryWithSanitizedDetection(apiUrl, text, target, apiKey, error);
      if (fallback) {
        return fallback;
      }

      throw error;
    }
  }

  private async translateSegmentedText(
    apiUrl: string,
    text: string,
    opaqueRanges: TextRange[],
    source: string,
    target: string,
    apiKey?: string,
  ): Promise<LibreTranslateResponse> {
    const segments = this.splitTextByRanges(text, opaqueRanges);
    const translatedParts: string[] = [];
    let detectedLanguage = '';

    for (const segment of segments) {
      if (segment.protected) {
        translatedParts.push(segment.text);
        continue;
      }

      const sample = this.createDetectionSample(segment.text);
      if (!this.hasDetectableText(sample)) {
        translatedParts.push(segment.text);
        continue;
      }

      const response = await this.translatePlainText(apiUrl, segment.text, source, target, apiKey);
      translatedParts.push(response.translatedText);
      detectedLanguage ||= response.detectedLanguage?.language || '';
    }

    return {
      translatedText: translatedParts.join(''),
      detectedLanguage: detectedLanguage ? { language: detectedLanguage } : undefined,
    };
  }

  private async retryWithSanitizedDetection(
    apiUrl: string,
    text: string,
    target: string,
    apiKey: string | undefined,
    error: unknown,
  ): Promise<LibreTranslateResponse | null> {
    if (!this.shouldRetryAutoDetection(error)) {
      return null;
    }

    const sample = this.createDetectionSample(text);
    if (!this.hasDetectableText(sample)) {
      return {
        translatedText: text,
      };
    }

    try {
      const detections = await this.detectLanguage(apiUrl, sample, apiKey);
      const source = await this.selectFallbackSource(apiUrl, detections, target);
      if (!source) {
        return null;
      }

      if (source === target) {
        return {
          translatedText: text,
          detectedLanguage: { language: source },
        };
      }

      return this.requestTranslation(apiUrl, text, source, target, apiKey);
    } catch {
      return null;
    }
  }

  private shouldRetryAutoDetection(error: unknown): boolean {
    const message = error instanceof Error ? error.message : `${error}`;
    return message.includes('libretranslate request failed (400)');
  }

  private createDetectionSample(text: string): string {
    return this.stripOpaqueTokens(text)
      .replace(/[\u200B-\u200D\uFEFF\uFE0E\uFE0F]/gu, ' ')
      .replace(/\p{Extended_Pictographic}/gu, ' ')
      .replace(/[^\p{L}\p{M}\p{N}\s.,!?'"“”‘’\-_/():;]/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();
  }

  private hasDetectableText(text: string): boolean {
    return (text.match(/[\p{L}\p{M}]/gu) ?? []).length >= 2;
  }

  private async detectLanguage(apiUrl: string, text: string, apiKey?: string): Promise<LibreTranslateDetection[]> {
    const url = this.buildEndpoint(apiUrl, 'detect');
    return this.requestJson<LibreTranslateDetection[]>(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        q: text,
        api_key: apiKey || undefined,
      }),
    });
  }

  private async selectFallbackSource(apiUrl: string, detections: LibreTranslateDetection[], target: string): Promise<string | null> {
    const candidates = detections
      .map((item) => toBaseLanguage(item.language))
      .filter((language, index, items) => Boolean(language) && items.indexOf(language) === index);

    if (!candidates.length) {
      return null;
    }

    const targetBase = toBaseLanguage(target);
    const supportedLanguages = await this.getSupportedLanguages(apiUrl).catch(() => []);
    const supportMap = new Map(
      supportedLanguages.map((language) => [
        toBaseLanguage(language.code),
        new Set((language.targets ?? []).map((targetLanguage) => toBaseLanguage(targetLanguage))),
      ]),
    );

    for (const candidate of candidates) {
      if (candidate === targetBase) {
        continue;
      }

      const supportedTargets = supportMap.get(candidate);
      if (!supportedTargets || !supportedTargets.size || supportedTargets.has(targetBase)) {
        return candidate;
      }
    }

    if (candidates.includes(targetBase)) {
      return targetBase;
    }

    return candidates[0] ?? null;
  }

  private async getSupportedLanguages(apiUrl: string): Promise<LibreTranslateLanguage[]> {
    const url = this.buildEndpoint(apiUrl, 'languages');
    let cached = this.supportedLanguagesCache.get(url);
    if (!cached) {
      cached = this.requestJson<LibreTranslateLanguage[]>(url, {
        method: 'GET',
      });
      this.supportedLanguagesCache.set(url, cached);
    }

    return cached;
  }

  private buildEndpoint(apiUrl: string, endpoint: 'translate' | 'detect' | 'languages'): string {
    const url = new URL(apiUrl);
    if (/\/translate\/?$/u.test(url.pathname)) {
      url.pathname = url.pathname.replace(/\/translate\/?$/u, `/${endpoint}`);
      return url.toString();
    }

    url.pathname = `${url.pathname.replace(/\/+$/u, '')}/${endpoint}`;
    return url.toString();
  }

  private requestTranslation(apiUrl: string, text: string, source: string, target: string, apiKey?: string): Promise<LibreTranslateResponse> {
    return this.requestJson<LibreTranslateResponse>(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        q: text,
        source,
        target,
        format: 'text',
        api_key: apiKey || undefined,
      }),
    });
  }

  private stripOpaqueTokens(text: string): string {
    const ranges = this.collectOpaqueTokenRanges(text);
    if (!ranges.length) {
      return text;
    }

    let stripped = text;
    ranges
      .slice()
      .sort((left, right) => right.start - left.start)
      .forEach((range) => {
        stripped = `${stripped.slice(0, range.start)} ${stripped.slice(range.end)}`;
      });
    return stripped;
  }

  private collectOpaqueTokenRanges(text: string): TextRange[] {
    const ranges: TextRange[] = [];
    this.collectRegexRanges(text, /\p{Extended_Pictographic}(?:[\uFE0E\uFE0F\u200D\p{Extended_Pictographic}]*)/gu, ranges);
    this.collectRegexRanges(text, /`[^`]+`/gu, ranges);
    this.collectRegexRanges(text, /\b[A-Za-z][A-Za-z0-9]*(?:[._/+:-][A-Za-z0-9]+)+\b/gu, ranges);
    this.collectRegexRanges(text, /\b(?:[A-Z]{2,}[A-Za-z0-9]*|[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]+)+)\b/gu, ranges);
    this.collectTechnicalListRanges(text, ranges);
    return this.mergeRanges(ranges);
  }

  private collectRegexRanges(text: string, pattern: RegExp, ranges: TextRange[]): void {
    let match = pattern.exec(text);
    while (match) {
      const value = match[0];
      if (typeof match.index === 'number' && value) {
        ranges.push({
          start: match.index,
          end: match.index + value.length,
        });
      }
      match = pattern.exec(text);
    }
  }

  private collectTechnicalListRanges(text: string, ranges: TextRange[]): void {
    const listPattern = /([A-Za-z][A-Za-z0-9.+_-]{1,31}(?:\s*,\s*[A-Za-z][A-Za-z0-9.+_-]{1,31}){1,})/gu;
    let listMatch = listPattern.exec(text);
    while (listMatch) {
      const listText = listMatch[0];
      const listIndex = listMatch.index ?? -1;
      if (listIndex >= 0) {
        const tokenPattern = /[A-Za-z][A-Za-z0-9.+_-]{1,31}/gu;
        const tokens = Array.from(listText.matchAll(tokenPattern));
        if (tokens.length >= 2) {
          tokens.forEach((token) => {
            const value = token[0];
            const tokenIndex = token.index ?? -1;
            if (tokenIndex >= 0 && this.shouldProtectTechnicalListToken(value)) {
              ranges.push({
                start: listIndex + tokenIndex,
                end: listIndex + tokenIndex + value.length,
              });
            }
          });
        }
      }
      listMatch = listPattern.exec(text);
    }
  }

  private shouldProtectTechnicalListToken(token: string): boolean {
    const normalized = token.toLowerCase();
    const commonWords = new Set([
      'a',
      'an',
      'and',
      'are',
      'as',
      'at',
      'by',
      'for',
      'from',
      'in',
      'is',
      'multiple',
      'of',
      'on',
      'or',
      'runtime',
      'runtimes',
      'supports',
      'the',
      'to',
      'with',
    ]);

    if (commonWords.has(normalized)) {
      return false;
    }

    if (/[._/+:-]/u.test(token) || /\d/u.test(token)) {
      return true;
    }

    if (/^[A-Z]{2,}[A-Za-z0-9]*$/u.test(token)) {
      return true;
    }

    if (/^[A-Z][a-z0-9]{1,31}$/u.test(token)) {
      return true;
    }

    return /^[a-z][a-z0-9]{1,10}$/u.test(token);
  }

  private mergeRanges(ranges: TextRange[]): TextRange[] {
    if (!ranges.length) {
      return [];
    }

    const sorted = ranges
      .slice()
      .sort((left, right) => left.start - right.start || left.end - right.end);
    const merged: TextRange[] = [sorted[0]];

    for (let index = 1; index < sorted.length; index += 1) {
      const current = sorted[index];
      const previous = merged[merged.length - 1];
      if (current.start <= previous.end) {
        previous.end = Math.max(previous.end, current.end);
        continue;
      }

      merged.push({ ...current });
    }

    return merged;
  }

  private splitTextByRanges(text: string, ranges: TextRange[]): TextSegment[] {
    if (!ranges.length) {
      return [{ text, protected: false }];
    }

    const segments: TextSegment[] = [];
    let cursor = 0;

    ranges.forEach((range) => {
      if (cursor < range.start) {
        segments.push({
          text: text.slice(cursor, range.start),
          protected: false,
        });
      }

      segments.push({
        text: text.slice(range.start, range.end),
        protected: true,
      });
      cursor = range.end;
    });

    if (cursor < text.length) {
      segments.push({
        text: text.slice(cursor),
        protected: false,
      });
    }

    return segments.filter((segment) => segment.text.length > 0);
  }
}
