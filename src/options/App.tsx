import { memo, useCallback, useEffect, useMemo, useState } from 'react';

import { DEFAULT_HOTKEYS, createDefaultSettings } from '../store/settings';
import { ENGINE_META, PROVIDER_ORDER } from '../utils/constants';
import { eventToHotkey, normalizeHotkey } from '../utils/hotkeys';
import { AUTO_LANGUAGE_OPTION, LANGUAGE_OPTIONS } from '../utils/languages';
import { getSettingsFromRuntime, updateSettingsInRuntime } from '../utils/runtime';
import { applyTheme } from '../utils/theme';
import type { EngineCategory, EngineProvider, EngineSettings, HotkeyConfig, TranslationSettings } from '../types';

function cloneSettings(settings: TranslationSettings): TranslationSettings {
  return JSON.parse(JSON.stringify(settings)) as TranslationSettings;
}

const behaviorNotes = [
  {
    hotkey: 'Alt+T',
    text: 'translates the current selection or the focused input and writes the result back in place.',
  },
  {
    hotkey: 'Alt+Q',
    text: 'runs silent translation in paragraph-under-cursor mode or full-page mode, depending on your current preference.',
  },
  {
    hotkey: 'Alt+W',
    text: 'starts a full-page DOM translation with the floating action bar attached to the page.',
  },
  {
    hotkey: 'Alt+R',
    text: 'restores the original page immediately when you want to back out.',
  },
];

const sectionLabels: Record<EngineCategory, string> = {
  standard: 'Standard translation engines',
  ai: 'AI translation engines',
};

const sectionDescriptions: Record<EngineCategory, string> = {
  standard: 'Credential-driven APIs and hosted translation endpoints for stable throughput.',
  ai: 'Promptable translation models when you need tone control, custom models, or provider-specific behavior.',
};

const HotkeyInput = memo(function HotkeyInput({
  label,
  field,
  value,
  onChange,
}: {
  label: string;
  field: keyof HotkeyConfig;
  value: string;
  onChange: (field: keyof HotkeyConfig, value: string) => void;
}) {
  return (
    <div className="settings-field-stack">
      <label className="soft-label">{label}</label>
      <input
        className="field"
        value={value}
        onChange={(event) => onChange(field, normalizeHotkey(event.target.value))}
        onKeyDown={(event) => {
          if (event.key === 'Tab') {
            return;
          }

          if (event.key === 'Backspace' || event.key === 'Delete') {
            event.preventDefault();
            onChange(field, '');
            return;
          }

          event.preventDefault();
          const hotkey = eventToHotkey(event.nativeEvent);
          if (hotkey) {
            onChange(field, hotkey);
          }
        }}
      />
    </div>
  );
});

const ProviderCard = memo(function ProviderCard({
  provider,
  config,
  onProviderChange,
}: {
  provider: EngineProvider;
  config: EngineSettings[EngineProvider];
  onProviderChange: (provider: EngineProvider, field: string, value: string) => void;
}) {
  const meta = ENGINE_META[provider];
  const fieldClassName = (fullWidth = false): string => `settings-field-stack provider-field${fullWidth ? ' provider-field--full' : ''}`;

  return (
    <article className="glass-card provider-card flex flex-col p-5 md:p-5 xl:p-6">
      <header className="provider-card__header">
        <div className="provider-card__meta">
          <div className="metric-chip inline-flex">{meta.category}</div>
          <div className="settings-provider-badge">{meta.requiresApiKey ? 'Credential required' : 'Ready by default'}</div>
        </div>
        <div className="space-y-2">
          <h3 className="settings-provider-title">{meta.label}</h3>
          <p className="text-sm leading-6 text-slate-400">{meta.docsHint}</p>
        </div>
      </header>

      <div className="provider-fields-grid">
        <div className={fieldClassName()}>
          <label className="soft-label">{meta.apiKeyLabel ?? 'API key'}</label>
          <input
            className="field"
            type="password"
            placeholder={meta.requiresApiKey ? 'Required' : 'Optional'}
            value={config.apiKey ?? ''}
            onChange={(event) => onProviderChange(provider, 'apiKey', event.target.value)}
          />
        </div>

        {meta.requiresApiSecret ? (
          <div className={fieldClassName()}>
            <label className="soft-label">{meta.apiSecretLabel ?? 'API secret'}</label>
            <input
              className="field"
              type="password"
              placeholder="Required"
              value={config.apiSecret ?? ''}
              onChange={(event) => onProviderChange(provider, 'apiSecret', event.target.value)}
            />
          </div>
        ) : null}

        {meta.requiresRegion ? (
          <div className={fieldClassName(provider === 'tencent')}>
            <label className="soft-label">{meta.regionLabel ?? 'Region'}</label>
            <input
              className="field"
              placeholder={meta.regionPlaceholder ?? 'Region'}
              value={config.region ?? ''}
              onChange={(event) => onProviderChange(provider, 'region', event.target.value)}
            />
          </div>
        ) : null}

        {provider === 'deepl' || provider === 'libretranslate' ? (
          <div className={fieldClassName(true)}>
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
          <div className={fieldClassName(true)}>
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
            <div className={fieldClassName()}>
              <label className="soft-label">Model</label>
              <input
                className="field"
                placeholder={meta.defaultModel ?? 'Model name'}
                value={config.model ?? ''}
                onChange={(event) => onProviderChange(provider, 'model', event.target.value)}
              />
            </div>

            <div className={fieldClassName(true)}>
              <label className="soft-label">System prompt</label>
              <textarea
                className="field min-h-[140px] resize-y"
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
});

export default function App() {
  const [settings, setSettings] = useState<TranslationSettings | null>(null);
  const [draft, setDraft] = useState<TranslationSettings | null>(null);
  const [status, setStatus] = useState('Loading settings...');
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

  const updateHotkey = useCallback((field: keyof HotkeyConfig, value: string): void => {
    setDraft((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        hotkeys: {
          ...current.hotkeys,
          [field]: value,
        },
      };
    });
  }, []);

  const updateProvider = useCallback((provider: EngineProvider, field: string, value: string): void => {
    setDraft((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        engines: {
          ...current.engines,
          [provider]: {
            ...current.engines[provider],
            [field]: value,
          },
        },
      };
    });
  }, []);

  const updateTopLevelField = useCallback(<K extends keyof TranslationSettings>(field: K, value: TranslationSettings[K]): void => {
    setDraft((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        [field]: value,
      };
    });
  }, []);

  const handleThemeChange = useCallback(
    (theme: TranslationSettings['theme']): void => {
      updateTopLevelField('theme', theme);
      applyTheme(theme);
    },
    [updateTopLevelField],
  );

  const handleCacheToggle = useCallback((): void => {
    setDraft((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        cacheEnabled: !current.cacheEnabled,
      };
    });
  }, []);

  const save = async (): Promise<void> => {
    if (!draft) {
      return;
    }

    setSaving(true);
    setStatus('Saving preferences...');

    try {
      const saved = await updateSettingsInRuntime(draft);
      setSettings(saved);
      setDraft(cloneSettings(saved));
      applyTheme(saved.theme);
      setStatus('Preferences synced to chrome.storage.sync.');
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
    setStatus('Draft reset to defaults. Save when you want to apply it.');
  };

  if (!draft) {
    return <main className="min-h-screen p-10 text-sm text-slate-300">Loading silence-translator options...</main>;
  }

  const statusTone = saving ? 'saving' : status.toLowerCase().includes('failed') ? 'error' : 'ready';
  const currentEngineLabel = ENGINE_META[(settings ?? draft).defaultEngine].label;

  return (
    <main className="smart-ui smart-ui--options min-h-screen px-4 py-5 text-slate-100 md:px-7 md:py-7 xl:px-10">
      <div className="settings-page mx-auto max-w-[1680px] space-y-6">
        <section className="glass-card settings-hero relative overflow-hidden px-5 py-6 md:px-8 md:py-8">
          <div className="settings-hero__glow" />
          <div className="relative grid gap-8 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.55fr)] xl:items-end">
            <div className="max-w-4xl">
              <div className="metric-chip inline-flex">silence-translator · v{__APP_VERSION__}</div>
              <h1 className="settings-hero__title mt-5">Shape how translation feels before you ever trigger it.</h1>
              <p className="settings-hero__copy mt-5 max-w-3xl">
                Dial in language defaults, engine credentials, AI prompts, silent mode, and keyboard behavior from one faster control surface. The
                page is tuned for sync storage, background-only requests, and quick provider-by-provider edits without the UI dragging behind you.
              </p>
            </div>

            <div className="settings-hero__actions">
              <div className="settings-status" data-tone={statusTone}>
                {status}
              </div>
              <div className="flex flex-wrap gap-3 xl:justify-end">
                <button className="ghost-button" onClick={resetDefaults}>
                  Reset draft
                </button>
                <button className="pill-button" disabled={saving} onClick={() => void save()}>
                  {saving ? 'Saving...' : 'Save preferences'}
                </button>
              </div>
            </div>
          </div>
        </section>

        <section className="settings-main-grid">
          <div className="space-y-6 min-w-0">
            <section className="glass-card settings-panel px-5 py-6 md:px-6">
              <div className="settings-panel__header">
                <div>
                  <div className="soft-label">Language settings</div>
                  <h2 className="text-2xl font-semibold text-white">Default translation direction</h2>
                </div>
                <div className="metric-chip">Source → Target</div>
              </div>

              <div className="settings-direction-grid mt-6">
                <div className="settings-field-stack">
                  <label className="soft-label">Source language</label>
                  <select className="field" value={draft.sourceLanguage} onChange={(event) => updateTopLevelField('sourceLanguage', event.target.value)}>
                    {[AUTO_LANGUAGE_OPTION, ...LANGUAGE_OPTIONS].map((language) => (
                      <option key={language.value} value={language.value}>
                        {language.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="settings-field-stack">
                  <label className="soft-label">Target language</label>
                  <select className="field" value={draft.targetLanguage} onChange={(event) => updateTopLevelField('targetLanguage', event.target.value)}>
                    {LANGUAGE_OPTIONS.map((language) => (
                      <option key={language.value} value={language.value}>
                        {language.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="settings-pref-grid mt-6">
                <div className="settings-field-stack">
                  <label className="soft-label">Default engine</label>
                  <select className="field" value={draft.defaultEngine} onChange={(event) => updateTopLevelField('defaultEngine', event.target.value as EngineProvider)}>
                    {PROVIDER_ORDER.map((provider) => (
                      <option key={provider} value={provider}>
                        {ENGINE_META[provider].label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="settings-field-stack">
                  <label className="soft-label">Theme</label>
                  <select className="field" value={draft.theme} onChange={(event) => handleThemeChange(event.target.value as TranslationSettings['theme'])}>
                    <option value="auto">Auto</option>
                    <option value="dark">Dark</option>
                    <option value="light">Light</option>
                  </select>
                </div>

                <div className="settings-field-stack">
                  <label className="soft-label">Silent translation</label>
                  <select className="field" value={draft.silentMode} onChange={(event) => updateTopLevelField('silentMode', event.target.value as TranslationSettings['silentMode'])}>
                    <option value="paragraph">Paragraph under cursor</option>
                    <option value="full-page">Full page</option>
                  </select>
                </div>

                <div className="settings-field-stack">
                  <label className="soft-label">Silent output</label>
                  <select
                    className="field"
                    value={draft.silentDisplayMode}
                    onChange={(event) => updateTopLevelField('silentDisplayMode', event.target.value as TranslationSettings['silentDisplayMode'])}
                  >
                    <option value="translate-only">Silent translate</option>
                    <option value="bilingual">Bilingual comparison</option>
                  </select>
                </div>
              </div>

              <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-400">
                Silent output controls whether the page text is replaced in place or kept visible with a translated companion block directly below it.
              </p>

              <div className="settings-toggle-grid mt-6">
                <div className="settings-toggle-card">
                  <div className="min-w-0">
                    <div className="soft-label mb-2">Translation cache</div>
                    <div className="settings-toggle-card__title">Store repeated translations locally for faster follow-up requests.</div>
                    <p className="mt-2 text-sm leading-6 text-slate-400">
                      Uses <span className="text-slate-100">chrome.storage.local</span> so repeated phrases and page fragments feel instant when the same
                      engine, languages, and model are reused.
                    </p>
                  </div>

                  <button
                    aria-checked={draft.cacheEnabled}
                    className="settings-toggle"
                    data-checked={draft.cacheEnabled}
                    onClick={handleCacheToggle}
                    role="switch"
                    type="button"
                  >
                    <span className="settings-toggle__track">
                      <span className="settings-toggle__thumb" />
                    </span>
                    <span className="settings-toggle__label">{draft.cacheEnabled ? 'Enabled' : 'Disabled'}</span>
                  </button>
                </div>

                <div className="settings-toggle-card">
                  <div className="min-w-0">
                    <div className="soft-label mb-2">Selection icon</div>
                    <div className="settings-toggle-card__title">Show a small translate icon after selecting text on the page.</div>
                    <p className="mt-2 text-sm leading-6 text-slate-400">
                      Keep this on for click-to-translate. Turn it off if you prefer using only the <span className="text-slate-100">Alt+T</span> shortcut.
                    </p>
                  </div>

                  <button
                    aria-checked={draft.showSelectionIcon}
                    className="settings-toggle"
                    data-checked={draft.showSelectionIcon}
                    onClick={() => updateTopLevelField('showSelectionIcon', !draft.showSelectionIcon)}
                    role="switch"
                    type="button"
                  >
                    <span className="settings-toggle__track">
                      <span className="settings-toggle__thumb" />
                    </span>
                    <span className="settings-toggle__label">{draft.showSelectionIcon ? 'Enabled' : 'Disabled'}</span>
                  </button>
                </div>
              </div>
            </section>

            <section className="glass-card settings-panel px-5 py-6 md:px-6">
              <div className="settings-panel__header">
                <div>
                  <div className="soft-label">Hotkeys</div>
                  <h2 className="text-2xl font-semibold text-white">In-page shortcuts</h2>
                </div>
                <div className="metric-chip">Sync + commands</div>
              </div>

              <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-300">
                These combinations live in sync storage and are mirrored by the content script listener. Browser-level command defaults still exist,
                so extension shortcut management keeps working when you rebind commands at the browser level.
              </p>

              <div className="settings-hotkey-grid mt-6">
                <HotkeyInput field="selection" label="Selection / input" onChange={updateHotkey} value={draft.hotkeys.selection} />
                <HotkeyInput field="silent" label="Silent translate" onChange={updateHotkey} value={draft.hotkeys.silent} />
                <HotkeyInput field="page" label="Full page toggle" onChange={updateHotkey} value={draft.hotkeys.page} />
                <HotkeyInput field="restore" label="Restore original" onChange={updateHotkey} value={draft.hotkeys.restore} />
              </div>

              <p className="mt-4 text-sm leading-6 text-slate-400">
                Reusing the same shortcut is allowed. In paragraph silent mode, the action now follows the paragraph under your cursor: a new block
                translates, and the same translated block restores.
              </p>
            </section>
          </div>

          <aside className="settings-aside">
            <section className="glass-card settings-aside-card px-5 py-6 md:px-6">
              <div className="soft-label">Behavior summary</div>
              <h2 className="text-2xl font-semibold text-white">What ships by default</h2>

              <div className="mt-6 space-y-4">
                {behaviorNotes.map((note) => (
                  <div key={note.hotkey} className="settings-note">
                    <div className="settings-note__key">{note.hotkey}</div>
                    <p className="text-sm leading-7 text-slate-300">{note.text}</p>
                  </div>
                ))}
              </div>

              <div className="settings-storage-card mt-6">
                <div className="soft-label mb-2">Storage model</div>
                <p className="text-sm leading-7 text-slate-300">
                  History and cache stay in <span className="text-white">chrome.storage.local</span>. Settings, credentials, and hotkeys stay in
                  <span className="text-white"> chrome.storage.sync</span>.
                </p>
              </div>
            </section>
          </aside>
        </section>

        {(['standard', 'ai'] as EngineCategory[]).map((category) => (
          <section key={category} className="space-y-4">
            <div className="settings-panel__header">
              <div>
                <div className="soft-label">{category}</div>
                <h2 className="text-2xl font-semibold text-white">{sectionLabels[category]}</h2>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">{sectionDescriptions[category]}</p>
              </div>
              <div className="metric-chip">{groupedProviders[category].length} providers</div>
            </div>

            <div className="settings-provider-grid">
              {groupedProviders[category].map((provider) => (
                <ProviderCard config={draft.engines[provider]} key={provider} onProviderChange={updateProvider} provider={provider} />
              ))}
            </div>
          </section>
        ))}

        <footer className="pb-8 text-sm text-slate-400">
          Current default engine: <span className="text-slate-100">{currentEngineLabel}</span>
        </footer>
      </div>
    </main>
  );
}
