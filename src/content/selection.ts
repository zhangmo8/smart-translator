import type { TranslateResponse, TranslationSettings } from '../types';
import { isEditableElement } from '../utils/hotkeys';

type SettingsGetter = () => Promise<TranslationSettings>;

export class SelectionTranslator {
  private tooltip: HTMLDivElement | null = null;
  private resultPanel: HTMLDivElement | null = null;
  private translateButton: HTMLButtonElement | null = null;
  private selectionRect: DOMRect | null = null;

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
  }

  async translateSelection(forcedText?: string): Promise<boolean> {
    const text = forcedText ?? this.getCurrentSelectionText();
    if (!text) {
      return false;
    }

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
      this.showResult(`Error: ${response.error}`, true);
      return false;
    }

    this.showResult(response.translatedText, false);
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

      const translated = await this.requestTranslation(sourceText);
      if (!translated) {
        return false;
      }

      if (selectionStart !== selectionEnd) {
        activeElement.setRangeText(translated, selectionStart, selectionEnd, 'end');
      } else {
        activeElement.value = translated;
      }

      this.flash(activeElement);
      return true;
    }

    const sourceText = activeElement.innerText.trim();
    if (!sourceText) {
      return false;
    }

    const translated = await this.requestTranslation(sourceText);
    if (!translated) {
      return false;
    }

    activeElement.innerText = translated;
    this.flash(activeElement);
    return true;
  }

  private requestTranslation = async (text: string): Promise<string | null> => {
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
      this.showResult(`Error: ${response.error}`, true);
      return null;
    }

    return response.translatedText;
  };

  private handleSelectionChange = (): void => {
    const text = this.getCurrentSelectionText();
    if (!text) {
      this.hideTooltip();
      return;
    }

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      this.hideTooltip();
      return;
    }

    this.selectionRect = selection.getRangeAt(0).getBoundingClientRect();
    this.ensureTooltip();
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

  private ensureTooltip(): void {
    if (this.tooltip) {
      return;
    }

    const tooltip = document.createElement('div');
    tooltip.className = 'smart-translator-tooltip';
    tooltip.setAttribute('data-smart-translator-ui', 'true');
    tooltip.dataset.smartTranslatorUi = 'true';
    tooltip.innerHTML = `
      <button class="smart-translator-button" data-role="translate">Translate</button>
      <div class="smart-translator-tooltip__panel" data-role="panel" hidden>
        <div class="smart-translator-tooltip__label">Translation</div>
        <div class="smart-translator-tooltip__text" data-role="result"></div>
      </div>
    `;

    tooltip.addEventListener('click', (event) => {
      const target = event.target as HTMLElement | null;
      if (target?.dataset.role === 'translate') {
        void this.translateSelection();
      }
    });

    document.documentElement.appendChild(tooltip);
    this.tooltip = tooltip;
    this.translateButton = tooltip.querySelector('[data-role="translate"]');
    this.resultPanel = tooltip.querySelector('[data-role="panel"]');
  }

  private repositionTooltip = (): void => {
    if (!this.tooltip || !this.selectionRect) {
      return;
    }

    const top = Math.max(8, this.selectionRect.top + window.scrollY - 52);
    const left = Math.max(8, this.selectionRect.left + window.scrollX + this.selectionRect.width / 2 - 70);
    this.tooltip.style.top = `${top}px`;
    this.tooltip.style.left = `${left}px`;
  };

  private showResult(text: string, isError: boolean): void {
    this.ensureTooltip();
    if (!this.tooltip || !this.resultPanel) {
      return;
    }

    const resultNode = this.tooltip.querySelector('[data-role="result"]');
    if (resultNode) {
      resultNode.textContent = text;
      resultNode.classList.toggle('smart-translator-tooltip__text--error', isError);
    }

    this.resultPanel.hidden = false;
    this.translateButton?.classList.add('smart-translator-button--ghost');
    if (!this.selectionRect && this.tooltip) {
      this.tooltip.style.top = `${window.scrollY + 24}px`;
      this.tooltip.style.left = `${window.scrollX + 24}px`;
    }
    this.repositionTooltip();
  }

  private hideTooltip(): void {
    this.tooltip?.remove();
    this.tooltip = null;
    this.resultPanel = null;
    this.translateButton = null;
    this.selectionRect = null;
  }

  private flash(element: HTMLElement): void {
    element.classList.remove('smart-translator-flash');
    void element.offsetWidth;
    element.classList.add('smart-translator-flash');
    window.setTimeout(() => element.classList.remove('smart-translator-flash'), 900);
  }
}
