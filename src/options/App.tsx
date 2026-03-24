import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { DEFAULT_HOTKEYS, createDefaultSettings } from '../store/settings';
import { ENGINE_META, PROVIDER_ORDER } from '../utils/constants';
import { eventToHotkey, normalizeHotkey } from '../utils/hotkeys';
import { UI_LANGUAGE_OPTIONS, setUILanguagePreference, t } from '../utils/i18n';
import { AUTO_LANGUAGE_OPTION, LANGUAGE_OPTIONS } from '../utils/languages';
import { getSettingsFromRuntime, updateSettingsInRuntime } from '../utils/runtime';
import { applyTheme } from '../utils/theme';
import type { EngineCategory, EngineProvider, EngineSettings, HotkeyConfig, TranslationSettings } from '../types';

function cloneSettings(settings: TranslationSettings): TranslationSettings {
  return JSON.parse(JSON.stringify(settings)) as TranslationSettings;
}

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
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [recording, setRecording] = useState(false);
  const [pendingValue, setPendingValue] = useState(value);
  const [hasPendingChange, setHasPendingChange] = useState(false);

  useEffect(() => {
    if (!recording) {
      setPendingValue(value);
      setHasPendingChange(false);
    }
  }, [recording, value]);

  useEffect(() => {
    if (recording) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [recording]);

  const recorderState = recording ? (hasPendingChange ? 'pending' : 'recording') : 'saved';
  const displayValue = recording ? pendingValue : value;
  const helperText =
    recorderState === 'recording'
      ? t('hotkeyRecorderRecording')
      : recorderState === 'pending'
        ? t('hotkeyRecorderPending')
        : t('hotkeyRecorderSaved');

  const startRecording = useCallback(() => {
    setPendingValue(value);
    setHasPendingChange(false);
    setRecording(true);
  }, [value]);

  const cancelRecording = useCallback(() => {
    setPendingValue(value);
    setHasPendingChange(false);
    setRecording(false);
  }, [value]);

  const commitRecording = useCallback(() => {
    onChange(field, normalizeHotkey(pendingValue));
    setRecording(false);
    setHasPendingChange(false);
  }, [field, onChange, pendingValue]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>): void => {
      if (!recording) {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          startRecording();
        }

        return;
      }

      if (event.key === 'Enter') {
        event.preventDefault();
        commitRecording();
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        cancelRecording();
        return;
      }

      if (event.key === 'Backspace' || event.key === 'Delete') {
        event.preventDefault();
        setPendingValue('');
        setHasPendingChange(true);
        return;
      }

      if (event.key === 'Tab') {
        cancelRecording();
        return;
      }

      event.preventDefault();
      const hotkey = eventToHotkey(event.nativeEvent);
      if (!hotkey) {
        return;
      }

      setPendingValue(hotkey);
      setHasPendingChange(true);
    },
    [cancelRecording, commitRecording, recording, startRecording],
  );

  return (
    <div className="settings-field-stack">
      <label className="soft-label">{label}</label>
      <div className="settings-hotkey-control" data-state={recorderState}>
        <input
          className="field settings-hotkey-input"
          placeholder={t('hotkeyEmpty')}
          readOnly
          ref={inputRef}
          value={displayValue}
          onBlur={() => {
            if (recording) {
              cancelRecording();
            }
          }}
          onKeyDown={handleKeyDown}
        />
        <button
          aria-label={recording ? t('hotkeyCancelRecording') : t('hotkeyStartRecording')}
          className="settings-hotkey-action"
          onClick={() => {
            if (recording) {
              cancelRecording();
              return;
            }

            startRecording();
          }}
          onMouseDown={(event) => event.preventDefault()}
          title={recording ? t('hotkeyCancelRecording') : t('hotkeyStartRecording')}
          type="button"
        >
          {recording ? (
            <svg aria-hidden="true" className="settings-hotkey-action__icon" viewBox="0 0 20 20">
              <path d="M6 6L14 14M14 6L6 14" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
            </svg>
          ) : (
            <svg aria-hidden="true" className="settings-hotkey-action__icon" viewBox="0 0 20 20">
              <path
                d="M11.95 5.15a1.5 1.5 0 0 1 2.12 0l.78.78a1.5 1.5 0 0 1 0 2.12l-5.9 5.9-3.02.62.62-3.02 5.4-5.4Z"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.55"
              />
              <path
                d="M11.1 6l2.9 2.9"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.55"
              />
            </svg>
          )}
        </button>
      </div>
      <p className="settings-hotkey-hint" data-state={recorderState}>
        {helperText}
      </p>
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
        <div className="flex items-center gap-2 mb-3">
          <h3 className="settings-provider-title">{meta.label}</h3>
          <div className="settings-provider-badge">{meta.requiresApiKey ? t('credentialRequired') : t('credentialOptional')}</div>
        </div>
      </header>

      <div className="provider-fields-grid">
        <div className={fieldClassName()}>
          <label className="soft-label">{meta.apiKeyLabel ?? t('apiKey')}</label>
          <input
            className="field"
            type="password"
            placeholder={meta.requiresApiKey ? t('fieldRequired') : t('fieldOptional')}
            value={config.apiKey ?? ''}
            onChange={(event) => onProviderChange(provider, 'apiKey', event.target.value)}
          />
        </div>

        {meta.requiresApiSecret ? (
          <div className={fieldClassName()}>
            <label className="soft-label">{meta.apiSecretLabel ?? t('apiSecret')}</label>
            <input
              className="field"
              type="password"
              placeholder={t('fieldRequired')}
              value={config.apiSecret ?? ''}
              onChange={(event) => onProviderChange(provider, 'apiSecret', event.target.value)}
            />
          </div>
        ) : null}

        {meta.requiresRegion ? (
          <div className={fieldClassName(provider === 'tencent')}>
            <label className="soft-label">{meta.regionLabel ?? t('region')}</label>
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
            <label className="soft-label">{t('apiUrl')}</label>
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
            <label className="soft-label">{t('endpoint')}</label>
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
              <label className="soft-label">{t('model')}</label>
              <input
                className="field"
                placeholder={meta.defaultModel ?? 'Model name'}
                value={config.model ?? ''}
                onChange={(event) => onProviderChange(provider, 'model', event.target.value)}
              />
            </div>

            <div className={fieldClassName(true)}>
              <label className="soft-label">{t('systemPrompt')}</label>
              <textarea
                className="field min-h-[140px] resize-y"
                placeholder={t('systemPromptPlaceholder')}
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
  const [status, setStatus] = useState(t('loadingSettings'));
  const [statusTone, setStatusTone] = useState<'ready' | 'saving' | 'error'>('ready');
  const [saving, setSaving] = useState(false);

  const sectionLabels: Record<EngineCategory, string> = {
    standard: t('standardEngines'),
    ai: t('aiEngines'),
  };

  useEffect(() => {
    void (async () => {
      const loaded = await getSettingsFromRuntime();
      setUILanguagePreference(loaded.uiLanguage);
      setSettings(loaded);
      setDraft(cloneSettings(loaded));
      applyTheme(loaded.theme);
      setStatus(t('settingsLoaded'));
      setStatusTone('ready');
    })().catch((error: unknown) => {
      setStatus(error instanceof Error ? error.message : t('loadingError'));
      setStatusTone('error');
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

  const handleUILanguageChange = useCallback(
    (uiLanguage: TranslationSettings['uiLanguage']): void => {
      updateTopLevelField('uiLanguage', uiLanguage);
      setUILanguagePreference(uiLanguage);
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
    setStatus(t('savingPreferences'));
    setStatusTone('saving');

    try {
      const saved = await updateSettingsInRuntime(draft);
      setUILanguagePreference(saved.uiLanguage);
      setSettings(saved);
      setDraft(cloneSettings(saved));
      applyTheme(saved.theme);
      setStatus(t('preferencesSynced'));
      setStatusTone('ready');
    } catch (error: unknown) {
      setStatus(error instanceof Error ? error.message : t('loadingError'));
      setStatusTone('error');
    } finally {
      setSaving(false);
    }
  };

  const resetDefaults = (): void => {
    const defaults = createDefaultSettings();
    defaults.hotkeys = DEFAULT_HOTKEYS;
    setUILanguagePreference(defaults.uiLanguage);
    setDraft(defaults);
    applyTheme(defaults.theme);
    setStatus(t('draftResetPendingSave'));
    setStatusTone('ready');
  };

  if (!draft) {
    return <main className="min-h-screen p-10 text-sm text-slate-300">{t('loadingSettings')}</main>;
  }

  return (
    <main className="smart-ui smart-ui--options min-h-screen px-4 py-5 text-slate-100 md:px-7 md:py-7 xl:px-10">
      <div className="settings-page mx-auto max-w-[1280px] space-y-6">
        <section className="glass-card relative overflow-hidden px-5 py-5 md:px-6 md:py-6">
          <div className="settings-hero__glow" />
          <div className="relative flex items-center justify-between gap-6">
            <div>
              <h1 className="text-2xl font-semibold text-white">{t('settingsTitle')}</h1>
              <div className="mt-1 text-sm text-slate-400">{t('extName')} v{__APP_VERSION__}</div>
            </div>

            <div className="flex items-center gap-3">
              <div className="settings-status" data-tone={statusTone}>
                {status}
              </div>
              <button className="ghost-button" onClick={resetDefaults}>
                {t('reset')}
              </button>
              <button className="pill-button" disabled={saving} onClick={() => void save()}>
                {saving ? t('saving') : t('save')}
              </button>
            </div>
          </div>
        </section>

        <section className="space-y-6">
          <div className="glass-card settings-panel px-5 py-6 md:px-6">
            <h2 className="text-xl font-semibold text-white mb-6">{t('languageBehavior')}</h2>

              <div className="settings-direction-grid mt-6">
                <div className="settings-field-stack">
                  <label className="soft-label">{t('sourceLanguage')}</label>
                  <select className="field" value={draft.sourceLanguage} onChange={(event) => updateTopLevelField('sourceLanguage', event.target.value)}>
                    {[AUTO_LANGUAGE_OPTION, ...LANGUAGE_OPTIONS].map((language) => (
                      <option key={language.value} value={language.value}>
                        {language.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="settings-field-stack">
                  <label className="soft-label">{t('targetLanguage')}</label>
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
                  <label className="soft-label">{t('defaultEngine')}</label>
                  <select className="field" value={draft.defaultEngine} onChange={(event) => updateTopLevelField('defaultEngine', event.target.value as EngineProvider)}>
                    {PROVIDER_ORDER.map((provider) => (
                      <option key={provider} value={provider}>
                        {ENGINE_META[provider].label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="settings-field-stack">
                  <label className="soft-label">{t('theme')}</label>
                  <select className="field" value={draft.theme} onChange={(event) => handleThemeChange(event.target.value as TranslationSettings['theme'])}>
                    <option value="auto">{t('themeAuto')}</option>
                    <option value="dark">{t('themeDark')}</option>
                    <option value="light">{t('themeLight')}</option>
                  </select>
                </div>

                <div className="settings-field-stack">
                  <label className="soft-label">{t('uiLanguage')}</label>
                  <select className="field" value={draft.uiLanguage} onChange={(event) => handleUILanguageChange(event.target.value as TranslationSettings['uiLanguage'])}>
                    {UI_LANGUAGE_OPTIONS.map((language) => (
                      <option key={language.value} value={language.value}>
                        {t(language.labelKey)}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="settings-field-stack">
                  <label className="soft-label">{t('silentTranslation')}</label>
                  <select className="field" value={draft.silentMode} onChange={(event) => updateTopLevelField('silentMode', event.target.value as TranslationSettings['silentMode'])}>
                    <option value="paragraph">{t('silentModeParagraph')}</option>
                    <option value="full-page">{t('silentModeFullPage')}</option>
                  </select>
                </div>
              </div>

              <div className="settings-toggle-grid mt-6 grid gap-4 sm:grid-cols-2">
                <div className="settings-toggle-card">
                  <div className="min-w-0">
                    <div className="settings-toggle-card__title">{t('translationCache')}</div>
                    <p className="mt-1 text-sm text-slate-400">{t('cacheDescription')}</p>
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
                    <span className="settings-toggle__label">{draft.cacheEnabled ? t('toggleOn') : t('toggleOff')}</span>
                  </button>
                </div>

                <div className="settings-toggle-card">
                  <div className="min-w-0">
                    <div className="settings-toggle-card__title">{t('selectionIcon')}</div>
                    <p className="mt-1 text-sm text-slate-400">{t('selectionIconDescription')}</p>
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
                    <span className="settings-toggle__label">{draft.showSelectionIcon ? t('toggleOn') : t('toggleOff')}</span>
                  </button>
                </div>
              </div>
            </div>

          <div className="glass-card settings-panel px-5 py-6 md:px-6">
            <h2 className="text-xl font-semibold text-white mb-6">{t('keyboardShortcuts')}</h2>

            <div className="settings-hotkey-grid mt-6">
              <HotkeyInput field="selection" label={t('hotkeySelection')} onChange={updateHotkey} value={draft.hotkeys.selection} />
              <HotkeyInput field="silent" label={t('hotkeySilent')} onChange={updateHotkey} value={draft.hotkeys.silent} />
              <HotkeyInput field="bilingual" label={t('hotkeyBilingual')} onChange={updateHotkey} value={draft.hotkeys.bilingual} />
              <HotkeyInput field="page" label={t('hotkeyPage')} onChange={updateHotkey} value={draft.hotkeys.page} />
              <HotkeyInput field="restore" label={t('hotkeyRestore')} onChange={updateHotkey} value={draft.hotkeys.restore} />
            </div>
          </div>
        </section>

        {(['standard', 'ai'] as EngineCategory[]).map((category) => (
          <section key={category} className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold text-white">{sectionLabels[category]}</h2>
              <div className="text-sm text-slate-400">{t('providersCount', String(groupedProviders[category].length))}</div>
            </div>

            <div className="settings-provider-grid">
              {groupedProviders[category].map((provider) => (
                <ProviderCard config={draft.engines[provider]} key={provider} onProviderChange={updateProvider} provider={provider} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
