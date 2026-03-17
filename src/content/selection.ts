import type { TranslateResponse, TranslationSettings } from '../types';
import { isEditableElement } from '../utils/hotkeys';

type SettingsGetter = () => Promise<TranslationSettings>;

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
  private titleNode: HTMLDivElement | null = null;
  private resultNode: HTMLDivElement | null = null;
  private translateButton: HTMLButtonElement | null = null;
  private settingsButton: HTMLButtonElement | null = null;
  private anchor: TooltipAnchor | null = null;
  private activeSelectionText = '';
  private hideTimer: number | null = null;
  private isPointerInsideTooltip = false;
  private isPinned = false;
  private isTranslating = false;
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
    if (target && this.tooltip?.contains(target)) {
      return;
    }

    if (!window.getSelection()?.toString().trim()) {
      this.hideTooltip();
    }
  };

  private getCurrentSelectionText(): string {
    return window.getSelection()?.toString().trim() ?? '';
  }

  private handleEmptySelection(): void {
    if (this.isPointerInsideTooltip || this.isPinned || this.isTranslating || Boolean(this.activeSelectionText)) {
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
          <button class="smart-translator-icon-button" type="button" data-role="close" aria-label="Close">x</button>
        </div>
        <div class="smart-translator-tooltip__body">
          <div class="smart-translator-tooltip__text" data-role="result">
            Keep the selection, then translate it inline.
          </div>
        </div>
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
      if (!this.getCurrentSelectionText() && !this.activeSelectionText && !this.isPinned && !this.isTranslating) {
        this.scheduleHide(120);
      }
    });

    tooltip.addEventListener('mousedown', (event) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('button')) {
        event.preventDefault();
      }
    });

    tooltip.addEventListener('click', (event) => {
      const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-role]');
      if (!target?.dataset.role) {
        return;
      }

      if (target.dataset.role === 'trigger') {
        void this.translateSelection(this.activeSelectionText);
      }

      if (target.dataset.role === 'translate') {
        void this.translateSelection(this.activeSelectionText);
      }

      if (target.dataset.role === 'settings') {
        void chrome.runtime.sendMessage({ type: 'OPEN_OPTIONS' });
      }

      if (target.dataset.role === 'close') {
        this.hideTooltip();
      }
    });

    document.documentElement.appendChild(tooltip);
    this.tooltip = tooltip;
    this.triggerButton = tooltip.querySelector('[data-role="trigger"]');
    this.translateButton = tooltip.querySelector('[data-role="translate"]');
    this.settingsButton = tooltip.querySelector('[data-role="settings"]');
    this.titleNode = tooltip.querySelector('[data-role="title"]');
    this.resultNode = tooltip.querySelector('[data-role="result"]');
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
  }

  private showLoadingState(): void {
    this.ensureTooltip();
    if (!this.tooltip || !this.resultNode || !this.titleNode || !this.translateButton) {
      return;
    }

    this.clearHideTimer();
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
    this.scheduleReposition();
  }

  private showResult(text: string, isError: boolean): void {
    this.ensureTooltip();
    if (!this.tooltip || !this.resultNode || !this.titleNode || !this.translateButton) {
      return;
    }

    this.clearHideTimer();
    this.isPinned = true;
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

    this.scheduleReposition();
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
    this.tooltip?.remove();
    this.tooltip = null;
    this.triggerButton = null;
    this.titleNode = null;
    this.resultNode = null;
    this.translateButton = null;
    this.settingsButton = null;
    this.anchor = null;
    if (!preserveSelectionText) {
      this.activeSelectionText = '';
    }
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
