import type { TranslateResponse, TranslationSettings } from '../types';
import { isEditableElement } from '../utils/hotkeys';
import { normalizeLanguageCode } from '../utils/languages';

type SettingsGetter = () => Promise<TranslationSettings>;

const SPEAK_ICON = `
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M5 9v6h4l5 4V5L9 9H5Z" fill="currentColor"></path>
    <path d="M16.5 8.5a5 5 0 0 1 0 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path>
    <path d="M18.75 6.25a8 8 0 0 1 0 11.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path>
  </svg>
`.trim();

const STOP_ICON = `
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M7 7h10v10H7Z" fill="currentColor"></path>
  </svg>
`.trim();

const COPY_ICON = `
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <rect x="9" y="9" width="10" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"></rect>
    <path d="M15 7V6a2 2 0 0 0-2-2H6A2 2 0 0 0 4 6v7a2 2 0 0 0 2 2h1" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path>
  </svg>
`.trim();

interface TooltipAnchor {
  left: number;
  right: number;
  top: number;
  bottom: number;
  centerX: number;
}

export class SelectionTranslator {
  private tooltip: HTMLDivElement | null = null;
  private triggerButton: HTMLButtonElement | null = null;
  private speakButton: HTMLButtonElement | null = null;
  private copyButton: HTMLButtonElement | null = null;
  private titleNode: HTMLDivElement | null = null;
  private resultNode: HTMLDivElement | null = null;
  private utilityStatusNode: HTMLDivElement | null = null;
  private translateButton: HTMLButtonElement | null = null;
  private settingsButton: HTMLButtonElement | null = null;
  private anchor: TooltipAnchor | null = null;
  private activeSelectionText = '';
  private translatedText = '';
  private hideTimer: number | null = null;
  private tooltipInteractionTimer: number | null = null;
  private utilityStatusTimer: number | null = null;
  private isPointerInsideTooltip = false;
  private isPinned = false;
  private isTranslating = false;
  private ignoreSelectionUpdates = false;
  private isSpeaking = false;
  private speechSessionToken = 0;
  private currentUtterance: SpeechSynthesisUtterance | null = null;
  private lastTargetLanguage = normalizeLanguageCode(navigator.language || 'en');
  private showSelectionIcon = true;

  constructor(private readonly getSettings: SettingsGetter) {}

  mount(): void {
    document.addEventListener('selectionchange', this.handleSelectionChange);
    document.addEventListener('mouseup', this.handleSelectionChange);
    document.addEventListener('scroll', this.repositionTooltip, true);
    document.addEventListener('mousedown', this.handleDocumentMouseDown, true);
  }

  unmount(): void {
    document.removeEventListener('selectionchange', this.handleSelectionChange);
    document.removeEventListener('mouseup', this.handleSelectionChange);
    document.removeEventListener('scroll', this.repositionTooltip, true);
    document.removeEventListener('mousedown', this.handleDocumentMouseDown, true);
    this.clearHideTimer();
    this.clearTooltipInteractionTimer();
    this.clearUtilityStatusTimer();
    this.stopSpeaking(true);
  }

  updateDisplaySettings(showSelectionIcon: boolean): void {
    this.showSelectionIcon = showSelectionIcon;
    if (!showSelectionIcon && this.tooltip?.dataset.state === 'icon') {
      this.hideTooltip(true);
    }
  }

  async translateSelection(forcedText?: string): Promise<boolean> {
    const text = (forcedText ?? this.activeSelectionText) || this.getCurrentSelectionText();
    if (!text) {
      return false;
    }

    this.activeSelectionText = text;
    this.showLoadingState();
    const translated = await this.requestTranslation(text, false);
    if (!translated) {
      return false;
    }

    this.showResult(translated, false);
    return true;
  }

  async translateFocusedInput(): Promise<boolean> {
    const activeElement = document.activeElement;
    if (!isEditableElement(activeElement)) {
      return false;
    }

    if (activeElement instanceof HTMLInputElement || activeElement instanceof HTMLTextAreaElement) {
      const selectionStart = activeElement.selectionStart ?? 0;
      const selectionEnd = activeElement.selectionEnd ?? 0;
      const sourceText = selectionStart !== selectionEnd ? activeElement.value.slice(selectionStart, selectionEnd) : activeElement.value;
      if (!sourceText.trim()) {
        return false;
      }

      this.captureElementAnchor(activeElement);
      this.activeSelectionText = sourceText.trim();
      const translated = await this.requestTranslation(sourceText, false);
      if (!translated) {
        return false;
      }

      if (selectionStart !== selectionEnd) {
        activeElement.setRangeText(translated, selectionStart, selectionEnd, 'end');
      } else {
        activeElement.value = translated;
      }

      this.hideTooltip();
      this.flash(activeElement);
      return true;
    }

    const sourceText = activeElement.innerText.trim();
    if (!sourceText) {
      return false;
    }

    this.captureElementAnchor(activeElement);
    this.activeSelectionText = sourceText;
    const translated = await this.requestTranslation(sourceText, false);
    if (!translated) {
      return false;
    }

    activeElement.innerText = translated;
    this.hideTooltip();
    this.flash(activeElement);
    return true;
  }

  private requestTranslation = async (text: string, showLoading = true): Promise<string | null> => {
    if (showLoading) {
      this.showLoadingState();
    }

    try {
      const settings = await this.getSettings();
      this.lastTargetLanguage =
        settings.targetLanguage && settings.targetLanguage !== 'auto'
          ? normalizeLanguageCode(settings.targetLanguage)
          : this.lastTargetLanguage;

      const response = (await chrome.runtime.sendMessage({
        type: 'TRANSLATE_TEXT',
        payload: {
          text,
          sourceLanguage: settings.sourceLanguage,
          targetLanguage: settings.targetLanguage,
          engine: settings.defaultEngine,
        },
      })) as TranslateResponse & { error?: string };

      if (response.error) {
        this.showResult(response.error, true);
        return null;
      }

      return response.translatedText;
    } catch (error: unknown) {
      this.showResult(error instanceof Error ? error.message : 'Translation failed. Please try again.', true);
      return null;
    } finally {
      this.isTranslating = false;
      if (this.translateButton) {
        this.translateButton.disabled = false;
      }
    }
  };

  private handleSelectionChange = (): void => {
    if (this.ignoreSelectionUpdates) {
      return;
    }

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      this.handleEmptySelection();
      return;
    }

    if (this.isSelectionInsideUi(selection)) {
      return;
    }

    const text = selection.toString().trim();
    if (!text) {
      this.handleEmptySelection();
      return;
    }

    this.anchor = this.captureSelectionAnchor(selection);
    if (!this.anchor) {
      this.handleEmptySelection();
      return;
    }

    this.activeSelectionText = text;
    this.isPinned = false;
    this.clearHideTimer();
    if (!this.showSelectionIcon) {
      this.hideTooltip(true);
      return;
    }

    this.ensureTooltip();
    this.showIconState();
    this.repositionTooltip();
  };

  private handleDocumentMouseDown = (event: MouseEvent): void => {
    const target = event.target as Node | null;
    if (!this.tooltip || (target && this.tooltip.contains(target))) {
      return;
    }

    if (!this.isTranslating) {
      this.hideTooltip();
    }
  };

  private getCurrentSelectionText(): string {
    return window.getSelection()?.toString().trim() ?? '';
  }

  private handleEmptySelection(): void {
    if (this.isPointerInsideTooltip || this.isPinned || this.isTranslating) {
      return;
    }

    this.scheduleHide(120);
  }

  private isSelectionInsideUi(selection: Selection): boolean {
    const anchorParent = selection.anchorNode instanceof Element ? selection.anchorNode : selection.anchorNode?.parentElement;
    const focusParent = selection.focusNode instanceof Element ? selection.focusNode : selection.focusNode?.parentElement;
    return Boolean(anchorParent?.closest('[data-smart-translator-ui="true"]') || focusParent?.closest('[data-smart-translator-ui="true"]'));
  }

  private captureElementAnchor(element: HTMLElement): void {
    const rect = element.getBoundingClientRect();
    this.anchor = this.createAnchor(rect);
  }

  private captureSelectionAnchor(selection: Selection): TooltipAnchor | null {
    if (selection.rangeCount === 0) {
      return null;
    }

    const range = selection.getRangeAt(0);
    const boundsRect = range.getBoundingClientRect();
    const clientRects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 || rect.height > 0);
    const focusRect = clientRects.at(-1) ?? boundsRect;

    if (!focusRect.width && !focusRect.height) {
      return null;
    }

    return this.createAnchor(boundsRect, focusRect);
  }

  private createAnchor(boundsRect: DOMRect | DOMRectReadOnly, focusRect: DOMRect | DOMRectReadOnly = boundsRect): TooltipAnchor {
    return {
      left: boundsRect.left + window.scrollX,
      right: focusRect.right + window.scrollX,
      top: focusRect.top + window.scrollY,
      bottom: focusRect.bottom + window.scrollY,
      centerX: boundsRect.left + boundsRect.width / 2 + window.scrollX,
    };
  }

  private ensureTooltip(): void {
    if (this.tooltip) {
      return;
    }

    const iconUrl = chrome.runtime.getURL('icons/icon-32.png');
    const tooltip = document.createElement('div');
    tooltip.className = 'smart-translator-tooltip';
    tooltip.setAttribute('data-smart-translator-ui', 'true');
    tooltip.dataset.smartTranslatorUi = 'true';
    tooltip.dataset.state = 'icon';
    tooltip.dataset.tone = 'default';
    tooltip.innerHTML = `
      <button class="smart-translator-selection-trigger" type="button" data-role="trigger" aria-label="Translate selection">
        <img class="smart-translator-selection-trigger__logo" src="${iconUrl}" alt="" draggable="false" />
      </button>
      <div class="smart-translator-tooltip__shell">
        <div class="smart-translator-tooltip__header">
          <div>
            <div class="smart-translator-tooltip__eyebrow">Selection translator</div>
            <div class="smart-translator-tooltip__title" data-role="title">Ready to translate</div>
          </div>
          <div class="smart-translator-tooltip__header-actions">
            <button class="smart-translator-icon-button smart-translator-tooltip__action" type="button" data-role="speak" aria-label="Read translation aloud" title="Read translation aloud">
              ${SPEAK_ICON}
            </button>
            <button class="smart-translator-icon-button smart-translator-tooltip__action" type="button" data-role="copy" aria-label="Copy translation" title="Copy translation">
              ${COPY_ICON}
            </button>
            <button class="smart-translator-icon-button" type="button" data-role="close" aria-label="Close" title="Close">x</button>
          </div>
        </div>
        <div class="smart-translator-tooltip__body">
          <div class="smart-translator-tooltip__text" data-role="result">
            Keep the selection, then translate it inline.
          </div>
        </div>
        <div class="smart-translator-tooltip__status" data-role="utility-status" aria-live="polite" hidden></div>
        <div class="smart-translator-tooltip__footer">
          <button class="smart-translator-button" type="button" data-role="translate">Translate selection</button>
          <button class="smart-translator-button smart-translator-button--ghost" type="button" data-role="settings" hidden>Open settings</button>
        </div>
      </div>
    `.trim();

    tooltip.addEventListener('pointerenter', () => {
      this.isPointerInsideTooltip = true;
      this.clearHideTimer();
    });

    tooltip.addEventListener('pointerleave', () => {
      this.isPointerInsideTooltip = false;
      if (!this.getCurrentSelectionText() && !this.isPinned && !this.isTranslating) {
        this.scheduleHide(120);
      }
    });

    tooltip.addEventListener('pointerdown', (event) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest('button')) {
        return;
      }

      this.beginTooltipButtonInteraction();
      event.preventDefault();
    });

    document.documentElement.appendChild(tooltip);
    this.tooltip = tooltip;
    this.triggerButton = tooltip.querySelector('[data-role="trigger"]');
    this.speakButton = tooltip.querySelector('[data-role="speak"]');
    this.copyButton = tooltip.querySelector('[data-role="copy"]');
    this.translateButton = tooltip.querySelector('[data-role="translate"]');
    this.settingsButton = tooltip.querySelector('[data-role="settings"]');
    this.titleNode = tooltip.querySelector('[data-role="title"]');
    this.resultNode = tooltip.querySelector('[data-role="result"]');
    this.utilityStatusNode = tooltip.querySelector('[data-role="utility-status"]');
    const closeButton = tooltip.querySelector<HTMLButtonElement>('[data-role="close"]');

    this.triggerButton?.addEventListener('click', () => {
      void this.translateSelection(this.activeSelectionText);
      this.endTooltipButtonInteraction();
    });

    this.translateButton?.addEventListener('click', () => {
      void this.translateSelection(this.activeSelectionText);
      this.endTooltipButtonInteraction();
    });

    this.speakButton?.addEventListener('click', () => {
      void this.toggleSpeechPlayback();
      this.endTooltipButtonInteraction();
    });

    this.copyButton?.addEventListener('click', () => {
      void this.copyTranslatedText();
      this.endTooltipButtonInteraction();
    });

    this.settingsButton?.addEventListener('click', () => {
      void chrome.runtime.sendMessage({ type: 'OPEN_OPTIONS' });
      this.endTooltipButtonInteraction();
    });

    closeButton?.addEventListener('click', () => {
      this.hideTooltip();
      this.endTooltipButtonInteraction();
    });

    this.updateUtilityButtons();
  }

  private repositionTooltip = (): void => {
    if (!this.tooltip || !this.anchor) {
      return;
    }

    const tooltipRect = this.tooltip.getBoundingClientRect();
    const tooltipWidth = tooltipRect.width || 360;
    const tooltipHeight = tooltipRect.height || 180;
    const viewportPadding = 12;
    const anchorLeft = this.anchor.left - window.scrollX;
    const anchorRight = this.anchor.right - window.scrollX;
    const anchorTop = this.anchor.top - window.scrollY;
    const anchorBottom = this.anchor.bottom - window.scrollY;
    const anchorCenterX = this.anchor.centerX - window.scrollX;
    const minLeft = viewportPadding;
    const maxLeft = window.innerWidth - tooltipWidth - viewportPadding;
    const isIconState = this.tooltip.dataset.state === 'icon';
    const rawLeft = isIconState
      ? anchorRight - tooltipWidth / 2
      : anchorCenterX - tooltipWidth / 2;
    const left = Math.min(Math.max(rawLeft, minLeft), Math.max(minLeft, maxLeft));
    const prefersAbove = anchorTop > tooltipHeight + 24;
    const rawTop = prefersAbove ? anchorTop - tooltipHeight - (isIconState ? 10 : 16) : anchorBottom + (isIconState ? 8 : 16);
    const minTop = viewportPadding;
    const maxTop = window.innerHeight - tooltipHeight - viewportPadding;
    const top = Math.min(Math.max(rawTop, minTop), Math.max(minTop, maxTop));
    this.tooltip.style.top = `${top}px`;
    this.tooltip.style.left = `${left}px`;
  };

  private showIconState(): void {
    this.ensureTooltip();
    if (!this.tooltip || !this.resultNode || !this.titleNode || !this.translateButton) {
      return;
    }

    this.translatedText = '';
    this.stopSpeaking(true);
    this.clearUtilityStatus();
    this.tooltip.dataset.state = 'icon';
    this.tooltip.dataset.tone = 'default';
    this.titleNode.textContent = 'Selection ready';
    this.resultNode.textContent = 'Click the icon to translate this selection.';
    this.resultNode.classList.remove('smart-translator-tooltip__text--error');
    this.translateButton.textContent = 'Translate again';
    this.translateButton.disabled = false;
    if (this.settingsButton) {
      this.settingsButton.hidden = true;
    }
    this.updateUtilityButtons();
  }

  private showLoadingState(): void {
    this.ensureTooltip();
    if (!this.tooltip || !this.resultNode || !this.titleNode || !this.translateButton) {
      return;
    }

    this.clearHideTimer();
    this.translatedText = '';
    this.stopSpeaking(true);
    this.clearUtilityStatus();
    this.isPinned = true;
    this.isTranslating = true;
    this.tooltip.dataset.state = 'loading';
    this.tooltip.dataset.tone = 'default';
    this.titleNode.textContent = 'Translating selection';
    this.resultNode.textContent = 'Sending your text to the current engine.';
    this.resultNode.classList.remove('smart-translator-tooltip__text--error');
    this.translateButton.textContent = 'Translating...';
    this.translateButton.disabled = true;
    if (this.settingsButton) {
      this.settingsButton.hidden = true;
    }
    this.updateUtilityButtons();
    this.scheduleReposition();
  }

  private showResult(text: string, isError: boolean): void {
    this.ensureTooltip();
    if (!this.tooltip || !this.resultNode || !this.titleNode || !this.translateButton) {
      return;
    }

    this.clearHideTimer();
    this.stopSpeaking(true);
    this.clearUtilityStatus();
    this.isPinned = true;
    this.translatedText = isError ? '' : text;
    this.tooltip.dataset.state = isError ? 'error' : 'result';
    this.tooltip.dataset.tone = isError ? 'error' : 'success';
    this.titleNode.textContent = isError ? 'Translation needs attention' : 'Translation ready';
    this.resultNode.textContent = text;
    this.resultNode.classList.toggle('smart-translator-tooltip__text--error', isError);
    this.translateButton.textContent = isError ? 'Try again' : 'Translate again';
    this.translateButton.disabled = false;

    if (this.settingsButton) {
      this.settingsButton.hidden = !isError;
    }

    if (!this.anchor && this.tooltip) {
      this.tooltip.style.top = '24px';
      this.tooltip.style.left = '24px';
    }

    this.updateUtilityButtons();
    this.scheduleReposition();
  }

  private updateUtilityButtons(): void {
    const hasResult = this.tooltip?.dataset.state === 'result' && Boolean(this.getResultText());
    if (this.speakButton) {
      const canSpeak = this.isSpeaking || hasResult;
      this.speakButton.disabled = !canSpeak;
      this.speakButton.dataset.state = this.isSpeaking ? 'active' : 'idle';
      this.speakButton.innerHTML = this.isSpeaking ? STOP_ICON : SPEAK_ICON;
      this.speakButton.setAttribute('aria-label', this.isSpeaking ? 'Stop reading aloud' : 'Read translation aloud');
      this.speakButton.title = this.isSpeaking ? 'Stop reading aloud' : 'Read translation aloud';
    }

    if (this.copyButton) {
      this.copyButton.disabled = !hasResult;
      this.copyButton.innerHTML = COPY_ICON;
      this.copyButton.setAttribute('aria-label', 'Copy translation');
      this.copyButton.title = 'Copy translation';
    }
  }

  private toggleSpeechPlayback = async (): Promise<void> => {
    if (this.isSpeaking) {
      this.stopSpeaking();
      return;
    }

    if (this.tooltip?.dataset.state !== 'result') {
      this.showUtilityStatus('No translated text to read yet.', true);
      return;
    }

    const textToSpeak = this.getResultText();
    if (!textToSpeak) {
      this.showUtilityStatus('No translated text to read yet.', true);
      return;
    }

    if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
      this.showUtilityStatus('Browser speech playback is not available on this page.', true);
      return;
    }

    const speechSessionToken = this.speechSessionToken + 1;
    this.speechSessionToken = speechSessionToken;
    this.isSpeaking = true;
    this.updateUtilityButtons();

    try {
      const utterance = new SpeechSynthesisUtterance(textToSpeak);
      const speechLanguage = this.getSpeechLanguage();
      if (speechLanguage) {
        utterance.lang = speechLanguage;
      }
      const voice = this.pickSpeechVoice(speechLanguage);
      if (voice) {
        utterance.voice = voice;
        utterance.lang = voice.lang;
      }

      this.currentUtterance = utterance;

      utterance.onstart = () => {
        if (speechSessionToken !== this.speechSessionToken) {
          return;
        }

        this.showUtilityStatus('Reading aloud.');
      };

      utterance.onend = () => {
        if (speechSessionToken !== this.speechSessionToken) {
          return;
        }

        this.currentUtterance = null;
        this.isSpeaking = false;
        this.updateUtilityButtons();
        this.showUtilityStatus('Finished reading.');
      };

      utterance.onerror = () => {
        if (speechSessionToken !== this.speechSessionToken) {
          return;
        }

        this.currentUtterance = null;
        this.isSpeaking = false;
        this.updateUtilityButtons();
        this.showUtilityStatus('Voice playback failed. Try another page or browser voice.', true);
      };

      window.speechSynthesis.cancel();
      if (speechSessionToken !== this.speechSessionToken) {
        return;
      }

      window.speechSynthesis.speak(utterance);
    } catch (error: unknown) {
      if (speechSessionToken !== this.speechSessionToken) {
        return;
      }

      this.currentUtterance = null;
      this.isSpeaking = false;
      this.updateUtilityButtons();
      this.showUtilityStatus(error instanceof Error ? error.message : 'Voice playback failed. Please try again.', true);
    }
  };

  private stopSpeaking(silent = false): void {
    this.speechSessionToken += 1;
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }

    this.currentUtterance = null;
    this.isSpeaking = false;
    this.updateUtilityButtons();
    if (!silent) {
      this.showUtilityStatus('Reading stopped.');
    }
  }

  private copyTranslatedText = async (): Promise<void> => {
    if (this.tooltip?.dataset.state !== 'result') {
      this.showUtilityStatus('No translated text to copy yet.', true);
      return;
    }

    const textToCopy = this.getResultText();
    if (!textToCopy) {
      this.showUtilityStatus('No translated text to copy yet.', true);
      return;
    }

    try {
      await this.copyText(textToCopy);
      this.showUtilityStatus('Copied to clipboard.');
    } catch (error: unknown) {
      this.showUtilityStatus(error instanceof Error ? error.message : 'Copy failed. Please try again.', true);
    }
  };

  private copyText = async (text: string): Promise<void> => {
    if (this.copyWithExecCommand(text)) {
      return;
    }

    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }

    throw new Error('Copy failed. Clipboard access was rejected.');
  };

  private copyWithExecCommand(text: string): boolean {
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', 'true');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      textarea.style.pointerEvents = 'none';
      textarea.style.top = '0';
      textarea.style.left = '0';
      document.documentElement.appendChild(textarea);
      textarea.focus();
      textarea.select();
      textarea.setSelectionRange(0, textarea.value.length);

      const copied = document.execCommand('copy');
      textarea.remove();
      return copied;
    } catch {
      return false;
    }
  }

  private getResultText(): string {
    return this.translatedText || this.resultNode?.textContent?.trim() || '';
  }

  private beginTooltipButtonInteraction(): void {
    this.ignoreSelectionUpdates = true;
    this.clearTooltipInteractionTimer();
    this.tooltipInteractionTimer = window.setTimeout(() => {
      this.ignoreSelectionUpdates = false;
      this.tooltipInteractionTimer = null;
    }, 400);
  }

  private endTooltipButtonInteraction(): void {
    this.clearTooltipInteractionTimer();
    this.tooltipInteractionTimer = window.setTimeout(() => {
      this.ignoreSelectionUpdates = false;
      this.tooltipInteractionTimer = null;
    }, 0);
  }

  private clearTooltipInteractionTimer(): void {
    if (this.tooltipInteractionTimer !== null) {
      window.clearTimeout(this.tooltipInteractionTimer);
      this.tooltipInteractionTimer = null;
    }
  }

  private getSpeechLanguage(): string | undefined {
    if (this.lastTargetLanguage && this.lastTargetLanguage !== 'auto') {
      return this.lastTargetLanguage;
    }

    const pageLanguage = document.documentElement.lang.trim();
    return pageLanguage ? normalizeLanguageCode(pageLanguage) : normalizeLanguageCode(navigator.language || 'en');
  }

  private pickSpeechVoice(language?: string): SpeechSynthesisVoice | undefined {
    if (!('speechSynthesis' in window)) {
      return undefined;
    }

    const voices = window.speechSynthesis.getVoices();
    if (!voices.length) {
      return undefined;
    }

    const preferredLanguage = normalizeLanguageCode(language || this.lastTargetLanguage || navigator.language || 'en');
    const preferredBaseLanguage = preferredLanguage.split('-')[0];
    const browserLanguage = normalizeLanguageCode(navigator.language || 'en');
    const browserBaseLanguage = browserLanguage.split('-')[0];
    const normalizedVoiceLanguage = (voice: SpeechSynthesisVoice) => normalizeLanguageCode(voice.lang || '');

    return (
      voices.find((voice) => normalizedVoiceLanguage(voice) === preferredLanguage && voice.default) ??
      voices.find((voice) => normalizedVoiceLanguage(voice) === preferredLanguage) ??
      voices.find((voice) => normalizedVoiceLanguage(voice).startsWith(`${preferredBaseLanguage}-`) && voice.default) ??
      voices.find((voice) => normalizedVoiceLanguage(voice) === preferredBaseLanguage) ??
      voices.find((voice) => normalizedVoiceLanguage(voice).startsWith(`${preferredBaseLanguage}-`)) ??
      voices.find((voice) => normalizedVoiceLanguage(voice) === browserLanguage && voice.default) ??
      voices.find((voice) => normalizedVoiceLanguage(voice) === browserLanguage) ??
      voices.find((voice) => normalizedVoiceLanguage(voice).startsWith(`${browserBaseLanguage}-`)) ??
      voices.find((voice) => voice.default) ??
      voices[0]
    );
  }

  private showUtilityStatus(message: string, isError = false, duration = isError ? 2800 : 1800): void {
    if (!this.utilityStatusNode) {
      return;
    }

    this.clearUtilityStatusTimer();
    this.utilityStatusNode.hidden = false;
    this.utilityStatusNode.dataset.tone = isError ? 'error' : 'default';
    this.utilityStatusNode.textContent = message;
    this.utilityStatusTimer = window.setTimeout(() => this.clearUtilityStatus(), duration);
  }

  private clearUtilityStatus(): void {
    this.clearUtilityStatusTimer();
    if (!this.utilityStatusNode) {
      return;
    }

    this.utilityStatusNode.hidden = true;
    this.utilityStatusNode.dataset.tone = 'default';
    this.utilityStatusNode.textContent = '';
  }

  private clearUtilityStatusTimer(): void {
    if (this.utilityStatusTimer !== null) {
      window.clearTimeout(this.utilityStatusTimer);
      this.utilityStatusTimer = null;
    }
  }

  private scheduleReposition(): void {
    window.requestAnimationFrame(() => this.repositionTooltip());
  }

  private scheduleHide(delay: number): void {
    this.clearHideTimer();
    this.hideTimer = window.setTimeout(() => {
      if (this.isPointerInsideTooltip || this.isPinned || this.isTranslating) {
        return;
      }

      this.hideTooltip();
    }, delay);
  }

  private clearHideTimer(): void {
    if (this.hideTimer !== null) {
      window.clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
  }

  private hideTooltip(preserveSelectionText = false): void {
    this.clearHideTimer();
    this.clearTooltipInteractionTimer();
    this.clearUtilityStatus();
    this.stopSpeaking(true);
    this.tooltip?.remove();
    this.tooltip = null;
    this.triggerButton = null;
    this.speakButton = null;
    this.copyButton = null;
    this.titleNode = null;
    this.resultNode = null;
    this.utilityStatusNode = null;
    this.translateButton = null;
    this.settingsButton = null;
    this.anchor = null;
    this.translatedText = '';
    if (!preserveSelectionText) {
      this.activeSelectionText = '';
    }
    this.ignoreSelectionUpdates = false;
    this.isPointerInsideTooltip = false;
    this.isPinned = false;
    this.isTranslating = false;
  }

  private flash(element: HTMLElement): void {
    element.classList.remove('smart-translator-flash');
    void element.offsetWidth;
    element.classList.add('smart-translator-flash');
    window.setTimeout(() => element.classList.remove('smart-translator-flash'), 900);
  }
}
