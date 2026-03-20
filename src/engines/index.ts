import { AlibabaEngine } from './alibaba';
import { BaiduEngine } from './baidu';
import { ClaudeEngine } from './claude';
import { DeepLEngine } from './deepl';
import { DeepSeekEngine } from './deepseek';
import { DoubaoEngine } from './doubao';
import { GeminiEngine } from './gemini';
import { GoogleEngine } from './google';
import { LibreTranslateEngine } from './libretranslate';
import { MicrosoftEngine } from './microsoft';
import { OpenAIEngine } from './openai';
import { TencentEngine } from './tencent';
import { YoudaoEngine } from './youdao';

import type { BaseTranslationEngine } from './base';
import type { EngineProvider } from '../types';

const engines: Record<EngineProvider, BaseTranslationEngine> = {
  baidu: new BaiduEngine(),
  tencent: new TencentEngine(),
  alibaba: new AlibabaEngine(),
  youdao: new YoudaoEngine(),
  google: new GoogleEngine(),
  microsoft: new MicrosoftEngine(),
  deepl: new DeepLEngine(),
  libretranslate: new LibreTranslateEngine(),
  openai: new OpenAIEngine(),
  claude: new ClaudeEngine(),
  gemini: new GeminiEngine(),
  doubao: new DoubaoEngine(),
  deepseek: new DeepSeekEngine(),
};

export function getEngine(provider: EngineProvider): BaseTranslationEngine {
  return engines[provider];
}
