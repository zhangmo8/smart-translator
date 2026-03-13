import { useEffect, useMemo, useState } from 'react';

import { DEFAULT_HOTKEYS, createDefaultSettings } from '../store/settings';
import { ENGINE_META, PROVIDER_ORDER } from '../utils/constants';
import { eventToHotkey, normalizeHotkey } from '../utils/hotkeys';
import { AUTO_LANGUAGE_OPTION, LANGUAGE_OPTIONS } from '../utils/languages';
import { getSettingsFromRuntime, updateSettingsInRuntime } from '../utils/runtime';
import { applyTheme } from '../utils/theme';
import type { EngineCategory, EngineProvider, HotkeyConfig, TranslationSettings } from '../types';

function cloneSettings(settings: TranslationSettings): TranslationSettings {
  return JSON.parse(JSON.stringify(settings)) as TranslationSettings;
}

function HotkeyInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label className="soft-label">{label}</label>
      <input
        className="field"
        value={value}
        onChange={(event) => onChange(normalizeHotkey(event.target.value))}
        onKeyDown={(event) => {
          if (event.key === 'Tab') {
            return;
          }

          if (event.key === 'Backspace' || event.key === 'Delete') {
            event.preventDefault();
            onChange('');
            return;
          }

          event.preventDefault();
          const hotkey = eventToHotkey(event.nativeEvent);
          if (hotkey) {
            onChange(hotkey);
          }
        }}
      />
    </div>
  );
}

function ProviderCard({
  provider,
  settings,
  onProviderChange,
}: {
  provider: EngineProvider;
  settings: TranslationSettings;
  onProviderChange: (provider: EngineProvider, field: string, value: string) => void;
}) {
  const meta = ENGINE_META[provider];
  const config = settings.engines[provider];

  return (
    <article className="glass-card flex flex-col gap-4 p-5">
      <div>
        <div className="metric-chip inline-flex">{meta.category}</div>
        <h3 className="mt-3 text-lg font-semibold text-white">{meta.label}</h3>
        <p className="mt-1 text-sm text-slate-400">{meta.docsHint}</p>
      </div>

      <div className="grid gap-4">
        <div>
          <label className="soft-label">API Key</label>
          <input
            className="field"
            type="password"
            placeholder={meta.requiresApiKey ? 'Required' : 'Optional'}
            value={config.apiKey ?? ''}
            onChange={(event) => onProviderChange(provider, 'apiKey', event.target.value)}
          />
        </div>

        {meta.requiresRegion ? (
          <div>
            <label className="soft-label">Region</label>
            <input
              className="field"
              placeholder="eastus"
              value={config.region ?? ''}
              onChange={(event) => onProviderChange(provider, 'region', event.target.value)}
            />
          </div>
        ) : null}

        {provider === 'deepl' || provider === 'libretranslate' ? (
          <div>
            <label className="soft-label">API URL</label>
            <input
              className="field"
              placeholder={meta.defaultApiUrl ?? 'https://example.com/translate'}
              value={config.apiUrl ?? ''}
              onChange={(event) => onProviderChange(provider, 'apiUrl', event.target.value)}
            />
          </div>
        ) : null}

        {provider === 'doubao' ? (
          <div>
            <label className="soft-label">Endpoint</label>
            <input
              className="field"
              placeholder="https://ark.cn-beijing.volces.com/api/v3/chat/completions"
              value={config.endpoint ?? ''}
              onChange={(event) => onProviderChange(provider, 'endpoint', event.target.value)}
            />
          </div>
        ) : null}

        {meta.category === 'ai' ? (
          <>
            <div>
              <label className="soft-label">Model</label>
              <input
                className="field"
                placeholder={meta.defaultModel ?? 'Model name'}
                value={config.model ?? ''}
                onChange={(event) => onProviderChange(provider, 'model', event.target.value)}
              />
            </div>

            <div>
              <label className="soft-label">System Prompt</label>
              <textarea
                className="field min-h-[116px] resize-y"
                placeholder="Optional provider-specific translation system prompt"
                value={config.systemPrompt ?? ''}
                onChange={(event) => onProviderChange(provider, 'systemPrompt', event.target.value)}
              />
            </div>
          </>
        ) : null}
      </div>
    </article>
  );
}

export default function App() {
  const [settings, setSettings] = useState<TranslationSettings | null>(null);
  const [draft, setDraft] = useState<TranslationSettings | null>(null);
  const [status, setStatus] = useState('Loading settings…');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      const loaded = await getSettingsFromRuntime();
      setSettings(loaded);
      setDraft(cloneSettings(loaded));
      applyTheme(loaded.theme);
      setStatus('Settings loaded.');
    })().catch((error: unknown) => {
      setStatus(error instanceof Error ? error.message : 'Failed to load settings.');
    });
  }, []);

  const groupedProviders = useMemo(
    () => ({
      standard: PROVIDER_ORDER.filter((provider) => ENGINE_META[provider].category === 'standard'),
      ai: PROVIDER_ORDER.filter((provider) => ENGINE_META[provider].category === 'ai'),
    }),
    [],
  );

  if (!draft) {
    return <main className="min-h-screen p-10 text-sm text-slate-300">Loading smart-translator options…</main>;
  }

  const updateHotkey = (field: keyof HotkeyConfig, value: string): void => {
    setDraft({
      ...draft,
      hotkeys: {
        ...draft.hotkeys,
        [field]: value,
      },
    });
  };

  const updateProvider = (provider: EngineProvider, field: string, value: string): void => {
    setDraft({
      ...draft,
      engines: {
        ...draft.engines,
        [provider]: {
          ...draft.engines[provider],
          [field]: value,
        },
      },
    });
  };

  const save = async (): Promise<void> => {
    setSaving(true);
    setStatus('Saving preferences…');
    try {
      const saved = await updateSettingsInRuntime(draft);
      setSettings(saved);
      setDraft(cloneSettings(saved));
      applyTheme(saved.theme);
      setStatus('Saved to chrome.storage.sync.');
    } catch (error: unknown) {
      setStatus(error instanceof Error ? error.message : 'Failed to save settings.');
    } finally {
      setSaving(false);
    }
  };

  const resetDefaults = (): void => {
    const defaults = createDefaultSettings();
    defaults.hotkeys = DEFAULT_HOTKEYS;
    setDraft(defaults);
    applyTheme(defaults.theme);
    setStatus('Reset draft to defaults. Save to apply.');
  };

  return (
    <main className="smart-ui min-h-screen px-6 py-8 text-slate-100 md:px-10 lg:px-12">
      <div className="mx-auto max-w-7xl space-y-6">
        <section className="glass-card relative overflow-hidden px-6 py-8 md:px-8">
          <div className="absolute inset-0 bg-noise opacity-80" />
          <div className="relative flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
            <div className="max-w-3xl">
              <div className="metric-chip inline-flex">smart-translator · v{__APP_VERSION__}</div>
              <h1 className="mt-4 font-display text-4xl leading-tight text-white md:text-5xl">A browser-native translation suite with real range.</h1>
              <p className="mt-4 max-w-2xl text-base leading-7 text-slate-300">
                Tune language defaults, API engines, AI prompts, silent translation modes, and page-level hotkeys in one place. Syncs through
                <span className="mx-1 text-teal-200">chrome.storage.sync</span>
                and uses the background service worker for every translation request.
              </p>
            </div>

            <div className="space-y-3 md:text-right">
              <div className="text-sm text-slate-300">{status}</div>
              <div className="flex flex-wrap gap-3 md:justify-end">
                <button className="ghost-button" onClick={resetDefaults}>
                  Reset draft
                </button>
                <button className="pill-button" disabled={saving} onClick={() => void save()}>
                  {saving ? 'Saving…' : 'Save preferences'}
                </button>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
          <div className="space-y-6">
            <div className="glass-card p-6">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="soft-label">Language settings</div>
                  <h2 className="text-2xl font-semibold text-white">Default translation direction</h2>
                </div>
                <div className="metric-chip">Source → Target</div>
              </div>

              <div className="mt-6 grid gap-4 md:grid-cols-2">
                <div>
                  <label className="soft-label">Source language</label>
                  <select className="field" value={draft.sourceLanguage} onChange={(event) => setDraft({ ...draft, sourceLanguage: event.target.value })}>
                    {[AUTO_LANGUAGE_OPTION, ...LANGUAGE_OPTIONS].map((language) => (
                      <option key={language.value} value={language.value}>
                        {language.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="soft-label">Target language</label>
                  <select className="field" value={draft.targetLanguage} onChange={(event) => setDraft({ ...draft, targetLanguage: event.target.value })}>
                    {LANGUAGE_OPTIONS.map((language) => (
                      <option key={language.value} value={language.value}>
                        {language.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <div>
                  <label className="soft-label">Default engine</label>
                  <select className="field" value={draft.defaultEngine} onChange={(event) => setDraft({ ...draft, defaultEngine: event.target.value as EngineProvider })}>
                    {PROVIDER_ORDER.map((provider) => (
                      <option key={provider} value={provider}>
                        {ENGINE_META[provider].label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="soft-label">Theme</label>
                  <select
                    className="field"
                    value={draft.theme}
                    onChange={(event) => {
                      const nextTheme = event.target.value as TranslationSettings['theme'];
                      setDraft({ ...draft, theme: nextTheme });
                      applyTheme(nextTheme);
                    }}
                  >
                    <option value="auto">Auto</option>
                    <option value="dark">Dark</option>
                    <option value="light">Light</option>
                  </select>
                </div>
                <div>
                  <label className="soft-label">Silent translation</label>
                  <select className="field" value={draft.silentMode} onChange={(event) => setDraft({ ...draft, silentMode: event.target.value as TranslationSettings['silentMode'] })}>
                    <option value="paragraph">Paragraph under cursor</option>
                    <option value="full-page">Full page</option>
                  </select>
                </div>
                <label className="glass-card flex items-center justify-between gap-4 rounded-[22px] border-white/5 bg-slate-950/25 px-4 py-3">
                  <div>
                    <div className="soft-label mb-1">Translation cache</div>
                    <div className="text-sm text-slate-300">Use `chrome.storage.local` for cached responses.</div>
                  </div>
                  <input
                    className="h-5 w-5 accent-teal-300"
                    checked={draft.cacheEnabled}
                    onChange={(event) => setDraft({ ...draft, cacheEnabled: event.target.checked })}
                    type="checkbox"
                  />
                </label>
              </div>
            </div>

            <div className="glass-card p-6">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="soft-label">Hotkeys</div>
                  <h2 className="text-2xl font-semibold text-white">In-page shortcuts</h2>
                </div>
                <div className="metric-chip">Sync + commands</div>
              </div>

              <p className="mt-4 text-sm leading-6 text-slate-300">
                These combinations are stored in sync storage and used by the content script listener. Manifest command defaults are also declared,
                so browser-level shortcuts still work when configured on the extension shortcuts page.
              </p>

              <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <HotkeyInput label="Selection / input" value={draft.hotkeys.selection} onChange={(value) => updateHotkey('selection', value)} />
                <HotkeyInput label="Silent translate" value={draft.hotkeys.silent} onChange={(value) => updateHotkey('silent', value)} />
                <HotkeyInput label="Full page toggle" value={draft.hotkeys.page} onChange={(value) => updateHotkey('page', value)} />
                <HotkeyInput label="Restore original" value={draft.hotkeys.restore} onChange={(value) => updateHotkey('restore', value)} />
              </div>
            </div>
          </div>

          <div className="glass-card p-6">
            <div className="soft-label">Behavior summary</div>
            <h2 className="text-2xl font-semibold text-white">What ships by default</h2>
            <div className="mt-5 space-y-4 text-sm leading-6 text-slate-300">
              <p>
                <span className="font-semibold text-teal-200">Alt+T</span> translates the current selection or the focused input/textarea in-place.
              </p>
              <p>
                <span className="font-semibold text-teal-200">Alt+Q</span> runs silent translation using either paragraph-under-cursor mode or full-page mode.
              </p>
              <p>
                <span className="font-semibold text-teal-200">Alt+W</span> toggles a full DOM walk translation with a floating translation bar.
              </p>
              <p>
                <span className="font-semibold text-teal-200">Alt+R</span> restores the original page instantly.
              </p>
              <p>
                History and translation cache stay in <span className="text-white">chrome.storage.local</span>, while settings and credentials stay in
                <span className="text-white"> chrome.storage.sync</span>.
              </p>
            </div>
          </div>
        </section>

        {(['standard', 'ai'] as EngineCategory[]).map((category) => (
          <section key={category} className="space-y-4">
            <div className="flex items-end justify-between gap-4">
              <div>
                <div className="soft-label">{category}</div>
                <h2 className="text-2xl font-semibold text-white">{category === 'standard' ? 'Standard translation engines' : 'AI translation engines'}</h2>
              </div>
              <div className="metric-chip">{groupedProviders[category].length} providers</div>
            </div>

            <div className="grid gap-5 lg:grid-cols-2 xl:grid-cols-3">
              {groupedProviders[category].map((provider) => (
                <ProviderCard key={provider} provider={provider} settings={draft} onProviderChange={updateProvider} />
              ))}
            </div>
          </section>
        ))}

        <footer className="pb-6 text-sm text-slate-400">
          Current default engine: <span className="text-slate-100">{ENGINE_META[(settings ?? draft).defaultEngine].label}</span>
        </footer>
      </div>
    </main>
  );
}
