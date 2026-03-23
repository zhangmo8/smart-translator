import { BATCH_SIZE } from '../utils/constants';

import { PageTranslator } from './page-translate';

import type { TranslateBatchResponse, TranslationSettings } from '../types';
import { t } from '../utils/i18n';

type SettingsGetter = () => Promise<TranslationSettings>;
type BlockTranslationEntry = {
  element: HTMLElement;
  text: string;
};

const SKIPPED_TAGS = new Set(['script', 'style', 'noscript', 'textarea', 'input', 'select', 'option', 'code', 'pre', 'kbd', 'samp']);

export class SilentTranslator {
  private hoveredElement: Element | null = null;
  private translatedParagraphs = new Set<HTMLElement>();
  private bilingualBlocks = new Map<HTMLElement, HTMLElement>();
  private bilingualPageActive = false;
  private loadingIndicator: HTMLDivElement | null = null;
  private loadingParagraph: HTMLElement | null = null;
  private isTranslating = false;

  constructor(
    private readonly getSettings: SettingsGetter,
    private readonly pageTranslator: PageTranslator,
  ) {}

  setHoveredElement(element: Element | null): void {
    if (element?.closest('[data-silence-translator-ui="true"]')) {
      return;
    }

    this.hoveredElement = element;
  }

  async trigger(): Promise<void> {
    const settings = await this.getSettings();
    if (settings.silentMode === 'full-page') {
      if (settings.silentDisplayMode === 'bilingual') {
        await this.toggleBilingualPage(settings);
        return;
      }

      await this.pageTranslator.togglePageTranslation(false);
      return;
    }

    if (settings.silentDisplayMode === 'bilingual') {
      await this.toggleBilingualParagraph(settings);
      return;
    }

    if (!this.pageTranslator.isTranslated() && this.translatedParagraphs.size) {
      this.translatedParagraphs.clear();
    }

    this.pruneParagraphState();
    const paragraph = this.pageTranslator.findParagraphCandidate(this.hoveredElement);
    if (!paragraph) {
      this.pageTranslator.notifyTransient(t('moveCursorForSilent'));
      return;
    }

    if (this.translatedParagraphs.has(paragraph)) {
      this.pageTranslator.restoreElement(paragraph);
      this.pageTranslator.highlightElement(paragraph);
      this.translatedParagraphs.delete(paragraph);
      return;
    }

    if (this.isTranslating) {
      this.pageTranslator.notifyTransient(t('silentInProgress'));
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

  isHoveredParagraphTranslated(): boolean {
    this.pruneParagraphState();
    const paragraph = this.pageTranslator.findParagraphCandidate(this.hoveredElement);
    return Boolean(paragraph && (this.translatedParagraphs.has(paragraph) || this.bilingualBlocks.has(paragraph)));
  }

  hasBilingualPageTranslation(): boolean {
    this.pruneParagraphState();
    return this.bilingualPageActive && this.bilingualBlocks.size > 0;
  }

  clearParagraphState(): void {
    this.translatedParagraphs.clear();
    this.clearBilingualState();
    this.hideLoadingIndicator();
  }

  private pruneParagraphState(): void {
    this.translatedParagraphs.forEach((paragraph) => {
      if (!paragraph.isConnected) {
        this.translatedParagraphs.delete(paragraph);
      }
    });

    this.bilingualBlocks.forEach((container, paragraph) => {
      if (!paragraph.isConnected || !container.isConnected) {
        container.remove();
        this.bilingualBlocks.delete(paragraph);
      }
    });

    if (!this.bilingualBlocks.size) {
      this.bilingualPageActive = false;
    }
  }

  private async toggleBilingualParagraph(settings: TranslationSettings): Promise<void> {
    this.pruneParagraphState();
    const paragraph = this.pageTranslator.findParagraphCandidate(this.hoveredElement);
    if (!paragraph) {
      this.pageTranslator.notifyTransient(t('moveCursorForSilent'));
      return;
    }

    if (this.bilingualBlocks.has(paragraph)) {
      this.restoreBilingualBlock(paragraph, true);
      return;
    }

    if (this.isTranslating) {
      this.pageTranslator.notifyTransient(t('silentInProgress'));
      return;
    }

    const sourceText = this.getElementText(paragraph);
    if (!sourceText) {
      this.pageTranslator.notifyTransient(t('nothingTranslatableBlock'), 'error');
      return;
    }

    this.isTranslating = true;
    this.showLoadingIndicator(paragraph);
    try {
      const translatedText = await this.translateText(sourceText, settings);
      if (!translatedText || translatedText === sourceText) {
        this.pageTranslator.notifyTransient(t('translatedMatchedOriginalBlock'), 'error');
        return;
      }

      this.attachBilingualBlock(paragraph, translatedText, settings.targetLanguage);
      this.pageTranslator.highlightElement(paragraph);
      this.pageTranslator.notifyTransient(t('bilingualBlockTranslated'), 'success');
    } catch (error: unknown) {
      this.pageTranslator.notifyTransient(this.formatError(error), 'error');
    } finally {
      this.hideLoadingIndicator();
      this.isTranslating = false;
    }
  }

  private async toggleBilingualPage(settings: TranslationSettings): Promise<void> {
    this.pruneParagraphState();

    if (this.bilingualPageActive) {
      this.clearBilingualState();
      this.pageTranslator.notifyTransient(t('bilingualPageRestored'), 'success');
      return;
    }

    if (this.isTranslating) {
      this.pageTranslator.notifyTransient(t('silentInProgress'));
      return;
    }

    const entries = this.collectPageTranslationEntries();
    if (!entries.length) {
      this.pageTranslator.notifyTransient(t('nothingTranslatablePage'), 'error');
      return;
    }

    this.isTranslating = true;
    try {
      const translatedTexts = await this.translateTexts(
        entries.map((entry) => entry.text),
        settings,
      );

      let appliedCount = 0;

      entries.forEach((entry, index) => {
        if (!entry.element.isConnected) {
          return;
        }

        const translatedText = translatedTexts[index]?.trim();
        if (!translatedText || translatedText === entry.text) {
          return;
        }

        this.attachBilingualBlock(entry.element, translatedText, settings.targetLanguage);
        appliedCount += 1;
      });

      this.bilingualPageActive = appliedCount > 0;
      if (!appliedCount) {
        this.pageTranslator.notifyTransient(t('noBilingualBlocks'), 'error');
        return;
      }

      this.pageTranslator.notifyTransient(t('bilingualPageTranslated', [appliedCount.toString(), appliedCount === 1 ? '' : 's']), 'success');
    } catch (error: unknown) {
      this.pageTranslator.notifyTransient(this.formatError(error), 'error');
    } finally {
      this.isTranslating = false;
    }
  }

  private restoreBilingualBlock(paragraph: HTMLElement, highlight = false, notify = true): void {
    const container = this.bilingualBlocks.get(paragraph);
    if (!container) {
      return;
    }

    container.remove();
    this.bilingualBlocks.delete(paragraph);
    this.bilingualPageActive = this.bilingualPageActive && this.bilingualBlocks.size > 0;
    if (highlight) {
      this.pageTranslator.highlightElement(paragraph);
    }
    if (notify) {
      this.pageTranslator.notifyTransient(t('bilingualBlockRestored'), 'success');
    }
  }

  private attachBilingualBlock(paragraph: HTMLElement, translatedText: string, targetLanguage: string): void {
    this.restoreBilingualBlock(paragraph, false, false);

    const container = document.createElement('span');
    container.className = 'silence-translator-bilingual-block';
    container.dataset.silenceTranslatorUi = 'true';
    container.setAttribute('data-silence-translator-ui', 'true');
    container.lang = targetLanguage;
    container.textContent = translatedText;

    paragraph.appendChild(container);
    this.bilingualBlocks.set(paragraph, container);
  }

  private clearBilingualState(): void {
    this.bilingualBlocks.forEach((container) => container.remove());
    this.bilingualBlocks.clear();
    this.bilingualPageActive = false;
  }

  private collectPageTranslationEntries(): BlockTranslationEntry[] {
    const candidates = new Set<HTMLElement>();

    this.collectVisibleTextNodes(document.body).forEach((node) => {
      const paragraph = this.pageTranslator.findParagraphCandidate(node.parentElement);
      if (paragraph) {
        candidates.add(paragraph);
      }
    });

    return Array.from(candidates)
      .map((element) => ({
        element,
        text: this.getElementText(element),
      }))
      .filter((entry) => entry.text.length > 0);
  }

  private collectVisibleTextNodes(root: ParentNode): Text[] {
    const nodes: Text[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        const text = node.nodeValue?.trim();
        if (!text) {
          return NodeFilter.FILTER_REJECT;
        }

        const parent = node.parentElement;
        if (!parent) {
          return NodeFilter.FILTER_REJECT;
        }

        if (parent.closest('[data-silence-translator-ui="true"]')) {
          return NodeFilter.FILTER_REJECT;
        }

        if (parent.isContentEditable) {
          return NodeFilter.FILTER_REJECT;
        }

        if (SKIPPED_TAGS.has(parent.tagName.toLowerCase())) {
          return NodeFilter.FILTER_REJECT;
        }

        const style = window.getComputedStyle(parent);
        if (style.display === 'none' || style.visibility === 'hidden') {
          return NodeFilter.FILTER_REJECT;
        }

        if (text.length < 2) {
          return NodeFilter.FILTER_REJECT;
        }

        return NodeFilter.FILTER_ACCEPT;
      },
    });

    let current = walker.nextNode();
    while (current) {
      nodes.push(current as Text);
      current = walker.nextNode();
    }

    return nodes;
  }

  private getElementText(element: HTMLElement): string {
    return element.innerText.replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  private async translateText(text: string, settings: TranslationSettings): Promise<string> {
    const translations = await this.translateTexts([text], settings);
    return translations[0]?.trim() ?? '';
  }

  private async translateTexts(texts: string[], settings: TranslationSettings): Promise<string[]> {
    const chunkSize = BATCH_SIZE[settings.defaultEngine];
    const translatedTexts: string[] = [];

    for (let index = 0; index < texts.length; index += chunkSize) {
      const slice = texts.slice(index, index + chunkSize);
      const response = (await chrome.runtime.sendMessage({
        type: 'TRANSLATE_BATCH',
        payload: {
          texts: slice,
          sourceLanguage: settings.sourceLanguage,
          targetLanguage: settings.targetLanguage,
          engine: settings.defaultEngine,
        },
      })) as TranslateBatchResponse & { error?: string };

      if (response.error) {
        throw new Error(response.error);
      }

      if (response.translations.length !== slice.length) {
        throw new Error(
          t('engineReturnedMismatchBlock', [
            settings.defaultEngine,
            response.translations.length.toString(),
            response.translations.length === 1 ? '' : 's',
            slice.length.toString(),
            slice.length === 1 ? '' : 's'
          ])
        );
      }

      translatedTexts.push(...response.translations.map((text) => text.trim()));
    }

    return translatedTexts;
  }

  private formatError(error: unknown): string {
    if (error instanceof Error && error.message.trim()) {
      return error.message;
    }

    return t('translationFailedGeneric');
  }

  private showLoadingIndicator(paragraph: HTMLElement): void {
    this.hideLoadingIndicator();

    const indicator = document.createElement('div');
    indicator.className = 'silence-translator-inline-loading';
    indicator.dataset.smartTranslatorUi = 'true';
    indicator.setAttribute('data-silence-translator-ui', 'true');
    indicator.innerHTML = `
      <div class="silence-translator-inline-loading__shell">
        <span class="silence-translator-inline-loading__spinner" aria-hidden="true"></span>
        <span class="silence-translator-inline-loading__label">${t('translatingInline')}</span>
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
