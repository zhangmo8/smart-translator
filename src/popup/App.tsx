import { useEffect, useMemo, useState } from 'react';

import { clearHistoryInRuntime, getHistoryFromRuntime, getSettingsFromRuntime, openOptionsInRuntime, translateTextInRuntime, updateSettingsInRuntime } from '../utils/runtime';
import { applyTheme } from '../utils/theme';
import { AUTO_LANGUAGE_OPTION, LANGUAGE_OPTIONS, humanizeLanguage } from '../utils/languages';
import { ENGINE_META, PROVIDER_ORDER } from '../utils/constants';
import type { EngineCategory, EngineProvider, TranslationHistoryEntry, TranslationSettings } from '../types';

const categoryLabels: Record<EngineCategory, string> = {
  standard: 'Standard',
  ai: 'AI',
};

const emptyResult = 'Translation output appears here. Use your current default engine or switch tabs to jump between standard APIs and AI providers.';

export default function App() {
  const [settings, setSettings] = useState<TranslationSettings | null>(null);
  const [engineCategory, setEngineCategory] = useState<EngineCategory>('standard');
  const [engine, setEngine] = useState<EngineProvider>('microsoft');
  const [sourceLanguage, setSourceLanguage] = useState('auto');
  const [targetLanguage, setTargetLanguage] = useState('en');
  const [input, setInput] = useState('');
  const [result, setResult] = useState(emptyResult);
  const [history, setHistory] = useState<TranslationHistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void (async () => {
      const [loadedSettings, loadedHistory] = await Promise.all([getSettingsFromRuntime(), getHistoryFromRuntime()]);
      setSettings(loadedSettings);
      setEngine(loadedSettings.defaultEngine);
      setEngineCategory(ENGINE_META[loadedSettings.defaultEngine].category);
      setSourceLanguage(loadedSettings.sourceLanguage);
      setTargetLanguage(loadedSettings.targetLanguage);
      setHistory(loadedHistory);
      applyTheme(loadedSettings.theme);
    })().catch((runtimeError: unknown) => {
      setError(runtimeError instanceof Error ? runtimeError.message : 'Failed to load extension state.');
    });
  }, []);

  const engines = useMemo(
    () => PROVIDER_ORDER.filter((provider) => ENGINE_META[provider].category === engineCategory),
    [engineCategory],
  );

  useEffect(() => {
    if (!engines.includes(engine)) {
      setEngine(engines[0] ?? 'microsoft');
    }
  }, [engines, engine]);

  const handleTranslate = async (): Promise<void> => {
    if (!input.trim()) {
      return;
    }

    setLoading(true);
    setError('');
    setCopied(false);

    try {
      const response = await translateTextInRuntime({
        text: input,
        sourceLanguage,
        targetLanguage,
        engine,
      });
      setResult(response.translatedText);
      setHistory(await getHistoryFromRuntime());
    } catch (runtimeError) {
      setError(runtimeError instanceof Error ? runtimeError.message : 'Translation failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleSwap = (): void => {
    if (sourceLanguage === 'auto') {
      return;
    }

    setSourceLanguage(targetLanguage);
    setTargetLanguage(sourceLanguage);
  };

  const handleCopy = async (): Promise<void> => {
    await navigator.clipboard.writeText(result);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  const handleClearHistory = async (): Promise<void> => {
    await clearHistoryInRuntime();
    setHistory([]);
  };

  const handleEngineChange = async (nextEngine: EngineProvider): Promise<void> => {
    setEngine(nextEngine);
    setSettings((current) => (current ? { ...current, defaultEngine: nextEngine } : current));

    try {
      await updateSettingsInRuntime({ defaultEngine: nextEngine });
    } catch (runtimeError) {
      setError(runtimeError instanceof Error ? runtimeError.message : 'Failed to update default engine.');
    }
  };

  return (
    <main className="smart-ui w-[400px] min-h-[620px] p-4 text-slate-100">
      <div className="glass-card relative overflow-hidden p-5">
        <div className="absolute inset-0 bg-noise opacity-70" />
        <div className="relative space-y-5">
          <header className="flex items-start justify-between gap-4">
            <div>
              <div className="metric-chip inline-flex">silence-translator</div>
              <h1 className="mt-3 font-display text-[28px] leading-none text-white">Translate with a single spark.</h1>
              <p className="mt-2 max-w-[28ch] text-sm text-slate-300">
                Quick input, engine switching, and synced language preferences inside one polished cockpit.
              </p>
            </div>
            <button className="ghost-button shrink-0" onClick={() => void openOptionsInRuntime()}>
              Settings
            </button>
          </header>

          <div className="flex gap-2">
            {(Object.keys(categoryLabels) as EngineCategory[]).map((category) => (
              <button
                key={category}
                className="tab-chip"
                data-active={engineCategory === category}
                onClick={() => setEngineCategory(category)}
              >
                {categoryLabels[category]}
              </button>
            ))}
          </div>

          <section className="grid grid-cols-[1fr_auto_1fr] gap-3">
            <div>
              <label className="soft-label">Source</label>
              <select className="field" value={sourceLanguage} onChange={(event) => setSourceLanguage(event.target.value)}>
                {[AUTO_LANGUAGE_OPTION, ...LANGUAGE_OPTIONS].map((language) => (
                  <option key={language.value} value={language.value}>
                    {language.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-end justify-center">
              <button className="ghost-button h-[50px] px-3" disabled={sourceLanguage === 'auto'} onClick={handleSwap}>
                ⇄
              </button>
            </div>
            <div>
              <label className="soft-label">Target</label>
              <select className="field" value={targetLanguage} onChange={(event) => setTargetLanguage(event.target.value)}>
                {LANGUAGE_OPTIONS.map((language) => (
                  <option key={language.value} value={language.value}>
                    {language.label}
                  </option>
                ))}
              </select>
            </div>
          </section>

          <section className="grid gap-3">
            <div>
              <label className="soft-label">Engine</label>
              <select className="field" value={engine} onChange={(event) => void handleEngineChange(event.target.value as EngineProvider)}>
                {engines.map((provider) => (
                  <option key={provider} value={provider}>
                    {ENGINE_META[provider].label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="soft-label">Quick translate</label>
              <textarea
                className="field min-h-[132px] resize-none"
                placeholder="Paste or type anything — article snippet, chat, comment, or draft paragraph."
                value={input}
                onChange={(event) => setInput(event.target.value)}
              />
            </div>

            <div className="flex items-center justify-between gap-3">
              <div className="text-xs text-slate-400">
                {settings ? `Default theme: ${settings.theme}. Popup tab: ${ENGINE_META[engine].label}.` : 'Loading preferences…'}
              </div>
              <button className="pill-button" disabled={loading || !input.trim()} onClick={() => void handleTranslate()}>
                {loading ? 'Translating…' : 'Translate'}
              </button>
            </div>
          </section>

          <section className="glass-card border-white/5 bg-slate-950/35 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="soft-label">Output</div>
                <div className="text-xs text-slate-400">
                  {humanizeLanguage(sourceLanguage)} → {humanizeLanguage(targetLanguage)}
                </div>
              </div>
              <button className="ghost-button px-3 py-1.5 text-xs" disabled={result === emptyResult} onClick={() => void handleCopy()}>
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <div className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-100">{result}</div>
            {error ? <div className="mt-3 text-sm text-rose-300">{error}</div> : null}
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="soft-label">Recent history</div>
                <div className="text-xs text-slate-400">Last 10 translations stored locally.</div>
              </div>
              <button className="ghost-button px-3 py-1.5 text-xs" onClick={() => void handleClearHistory()}>
                Clear
              </button>
            </div>

            <div className="space-y-2">
              {history.length ? (
                history.map((entry) => (
                  <button
                    key={entry.id}
                    className="glass-card flex w-full flex-col items-start gap-2 rounded-[22px] p-3 text-left transition hover:border-teal-200/20"
                    onClick={() => {
                      setInput(entry.text);
                      setResult(entry.translatedText);
                      setSourceLanguage(entry.sourceLanguage);
                      setTargetLanguage(entry.targetLanguage);
                      setEngine(entry.engine);
                      setEngineCategory(ENGINE_META[entry.engine].category);
                    }}
                  >
                    <div className="flex w-full items-center justify-between gap-3 text-[11px] uppercase tracking-[0.18em] text-slate-400">
                      <span>{ENGINE_META[entry.engine].label}</span>
                      <span>{new Date(entry.timestamp).toLocaleTimeString()}</span>
                    </div>
                    <div className="max-h-10 overflow-hidden text-sm text-white/90">{entry.text}</div>
                    <div className="max-h-10 overflow-hidden text-sm text-teal-200">{entry.translatedText}</div>
                  </button>
                ))
              ) : (
                <div className="glass-card rounded-[22px] p-4 text-sm text-slate-400">No translations yet. Your newest 10 results land here automatically.</div>
              )}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
