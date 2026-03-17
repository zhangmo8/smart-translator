import { PageTranslator } from './page-translate';

import type { TranslationSettings } from '../types';

type SettingsGetter = () => Promise<TranslationSettings>;

export class SilentTranslator {
  private hoveredElement: Element | null = null;
  private translatedParagraphs = new Set<HTMLElement>();
  private loadingIndicator: HTMLDivElement | null = null;
  private loadingParagraph: HTMLElement | null = null;
  private isTranslating = false;

  constructor(
    private readonly getSettings: SettingsGetter,
    private readonly pageTranslator: PageTranslator,
  ) {}

  setHoveredElement(element: Element | null): void {
    if (element?.closest('[data-smart-translator-ui="true"]')) {
      return;
    }

    this.hoveredElement = element;
  }

  async trigger(): Promise<void> {
    const settings = await this.getSettings();
    if (settings.silentMode === 'full-page') {
      await this.pageTranslator.togglePageTranslation(false);
      return;
    }

    if (!this.pageTranslator.isTranslated() && this.translatedParagraphs.size) {
      this.translatedParagraphs.clear();
    }

    this.pruneParagraphState();
    const paragraph = this.pageTranslator.findParagraphCandidate(this.hoveredElement);
    if (!paragraph) {
      this.pageTranslator.notifyTransient('Move your cursor over a paragraph or heading, then try silent translate again.');
      return;
    }

    if (this.translatedParagraphs.has(paragraph)) {
      this.pageTranslator.restoreElement(paragraph);
      this.pageTranslator.highlightElement(paragraph);
      this.translatedParagraphs.delete(paragraph);
      return;
    }

    if (this.isTranslating) {
      this.pageTranslator.notifyTransient('A silent translation is already in progress for the current page.');
      return;
    }

    this.isTranslating = true;
    this.showLoadingIndicator(paragraph);
    try {
      const translated = await this.pageTranslator.translateElement(paragraph, false);
      if (!translated) {
        return;
      }

      this.pageTranslator.highlightElement(paragraph);
      this.translatedParagraphs.add(paragraph);
    } finally {
      this.hideLoadingIndicator();
      this.isTranslating = false;
    }
  }

  clearParagraphState(): void {
    this.translatedParagraphs.clear();
    this.hideLoadingIndicator();
  }

  private pruneParagraphState(): void {
    this.translatedParagraphs.forEach((paragraph) => {
      if (!paragraph.isConnected) {
        this.translatedParagraphs.delete(paragraph);
      }
    });
  }

  private showLoadingIndicator(paragraph: HTMLElement): void {
    this.hideLoadingIndicator();

    const indicator = document.createElement('div');
    indicator.className = 'smart-translator-inline-loading';
    indicator.dataset.smartTranslatorUi = 'true';
    indicator.setAttribute('data-smart-translator-ui', 'true');
    indicator.innerHTML = `
      <div class="smart-translator-inline-loading__shell">
        <span class="smart-translator-inline-loading__spinner" aria-hidden="true"></span>
        <span class="smart-translator-inline-loading__label">Translating...</span>
      </div>
    `.trim();

    document.documentElement.appendChild(indicator);
    this.loadingIndicator = indicator;
    this.loadingParagraph = paragraph;
    document.addEventListener('scroll', this.repositionLoadingIndicator, true);
    window.addEventListener('resize', this.repositionLoadingIndicator);
    this.repositionLoadingIndicator();
  }

  private hideLoadingIndicator(): void {
    document.removeEventListener('scroll', this.repositionLoadingIndicator, true);
    window.removeEventListener('resize', this.repositionLoadingIndicator);
    this.loadingIndicator?.remove();
    this.loadingIndicator = null;
    this.loadingParagraph = null;
  }

  private repositionLoadingIndicator = (): void => {
    if (!this.loadingIndicator || !this.loadingParagraph) {
      return;
    }

    if (!this.loadingParagraph.isConnected) {
      this.hideLoadingIndicator();
      return;
    }

    const rect = this.loadingParagraph.getBoundingClientRect();
    const loadingRect = this.loadingIndicator.getBoundingClientRect();
    const width = loadingRect.width || 132;
    const height = loadingRect.height || 36;
    const viewportPadding = 12;
    const prefersBelow = rect.bottom + height + 10 <= window.innerHeight - viewportPadding;
    const rawTop = prefersBelow ? rect.bottom + 8 : rect.top - height - 8;
    const rawLeft = rect.right - width;
    const left = Math.min(Math.max(rawLeft, viewportPadding), Math.max(viewportPadding, window.innerWidth - width - viewportPadding));
    const top = Math.min(Math.max(rawTop, viewportPadding), Math.max(viewportPadding, window.innerHeight - height - viewportPadding));

    this.loadingIndicator.style.left = `${left}px`;
    this.loadingIndicator.style.top = `${top}px`;
  };
}
