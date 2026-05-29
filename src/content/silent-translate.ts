import { BATCH_SIZE } from '../utils/constants';

import { PageTranslator } from './page-translate';

import type { TranslateBatchResponse, TranslationSettings } from '../types';
import { t } from '../utils/i18n';

type SettingsGetter = () => Promise<TranslationSettings>;
type SilentTranslateVariant = 'silent' | 'bilingual';
type BlockTranslationEntry = {
  element: HTMLElement;
  text: string;
};

type LoadingState = {
  indicator: HTMLDivElement;
  paragraph: HTMLElement;
  anchor: Text | HTMLElement;
};

const SKIPPED_TAGS = new Set(['script', 'style', 'noscript', 'textarea', 'input', 'select', 'option', 'code', 'pre', 'kbd', 'samp']);

export class SilentTranslator {
  private hoveredElement: Element | null = null;
  private translatedParagraphs = new Set<HTMLElement>();
  private bilingualBlocks = new Map<HTMLElement, HTMLElement>();
  private bilingualPageActive = false;
  private loadingStates = new Map<HTMLElement, LoadingState>();
  private activeParagraphTranslations = new Set<HTMLElement>();
  private paragraphStateVersion = 0;
  private isPageTranslating = false;

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

  async trigger(variant: SilentTranslateVariant = 'silent'): Promise<void> {
    const settings = await this.getSettings();
    if (settings.silentMode === 'full-page') {
      if (variant === 'bilingual') {
        await this.toggleBilingualPage(settings);
        return;
      }

      await this.toggleSilentPage();
      return;
    }

    if (variant === 'bilingual') {
      await this.toggleBilingualParagraph(settings);
      return;
    }

    await this.toggleSilentParagraph();
  }

  clearParagraphState(): void {
    this.translatedParagraphs.clear();
    this.clearBilingualState();
    this.activeParagraphTranslations.clear();
    this.paragraphStateVersion += 1;
    this.hideAllLoadingIndicators();
  }

  private async toggleSilentPage(): Promise<void> {
    if (this.activeParagraphTranslations.size) {
      this.pageTranslator.notifyTransient(t('silentParagraphsInProgress'));
      return;
    }

    this.clearBilingualState();
    await this.pageTranslator.togglePageTranslation(false);
  }

  private async toggleSilentParagraph(): Promise<void> {
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

    if (this.bilingualBlocks.has(paragraph)) {
      this.restoreBilingualBlock(paragraph, false, false);
    }

    if (this.activeParagraphTranslations.has(paragraph)) {
      this.pageTranslator.notifyTransient(t('silentBlockInProgress'));
      return;
    }

    this.activeParagraphTranslations.add(paragraph);
    const stateVersion = this.paragraphStateVersion;
    this.showLoadingIndicator(paragraph);
    try {
      if (!paragraph.isConnected) {
        return;
      }

      const originalSnapshot = await this.pageTranslator.translateElement(paragraph, false);
      if (!originalSnapshot) {
        return;
      }

      if (stateVersion !== this.paragraphStateVersion || !paragraph.isConnected) {
        this.pageTranslator.restoreElementSnapshot(originalSnapshot);
        return;
      }

      this.pageTranslator.highlightElement(paragraph);
      this.translatedParagraphs.add(paragraph);
    } finally {
      this.hideLoadingIndicator(paragraph);
      this.activeParagraphTranslations.delete(paragraph);
    }
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
      return;
    }

    if (this.bilingualBlocks.has(paragraph)) {
      this.restoreBilingualBlock(paragraph, true, false);
      return;
    }

    if (this.translatedParagraphs.has(paragraph)) {
      this.pageTranslator.restoreElement(paragraph);
      this.translatedParagraphs.delete(paragraph);
    }

    if (this.activeParagraphTranslations.has(paragraph)) {
      this.pageTranslator.notifyTransient(t('silentBlockInProgress'));
      return;
    }

    const sourceText = this.getElementText(paragraph);
    if (!sourceText) {
      this.pageTranslator.notifyTransient(t('nothingTranslatableBlock'), 'error');
      return;
    }

    this.activeParagraphTranslations.add(paragraph);
    const stateVersion = this.paragraphStateVersion;
    this.showLoadingIndicator(paragraph);
    try {
      if (!paragraph.isConnected) {
        return;
      }

      const translatedText = await this.translateText(sourceText, settings);
      if (!translatedText || translatedText === sourceText) {
        this.pageTranslator.notifyTransient(t('translatedMatchedOriginalBlock'), 'error');
        return;
      }

      if (stateVersion !== this.paragraphStateVersion || !paragraph.isConnected) {
        return;
      }

      this.attachBilingualBlock(paragraph, translatedText, settings.targetLanguage);
      this.pageTranslator.highlightElement(paragraph);
    } catch (error: unknown) {
      this.pageTranslator.notifyTransient(this.formatError(error), 'error');
    } finally {
      this.hideLoadingIndicator(paragraph);
      this.activeParagraphTranslations.delete(paragraph);
    }
  }

  private async toggleBilingualPage(settings: TranslationSettings): Promise<void> {
    this.pruneParagraphState();

    if (this.isPageTranslating) {
      this.pageTranslator.notifyTransient(t('silentInProgress'));
      return;
    }

    if (this.activeParagraphTranslations.size) {
      this.pageTranslator.notifyTransient(t('silentParagraphsInProgress'));
      return;
    }

    if (this.bilingualPageActive) {
      this.clearBilingualState();
      return;
    }

    if (this.bilingualBlocks.size) {
      this.clearBilingualState();
    }

    if (this.pageTranslator.isTranslated()) {
      this.pageTranslator.restoreOriginalPage(true);
      this.translatedParagraphs.clear();
    }

    const entries = this.collectPageTranslationEntries();
    if (!entries.length) {
      this.pageTranslator.notifyTransient(t('nothingTranslatablePage'), 'error');
      return;
    }

    this.isPageTranslating = true;
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
    } catch (error: unknown) {
      this.pageTranslator.notifyTransient(this.formatError(error), 'error');
    } finally {
      this.isPageTranslating = false;
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

        if (this.isHiddenByAncestor(parent)) {
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

  private isHiddenByAncestor(element: HTMLElement): boolean {
    let current: HTMLElement | null = element;
    while (current && current !== document.body) {
      if (current.hidden || current.getAttribute('aria-hidden') === 'true') {
        return true;
      }

      const style = window.getComputedStyle(current);
      if (style.display === 'none' || style.visibility === 'hidden') {
        return true;
      }

      current = current.parentElement;
    }

    return false;
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
    this.hideLoadingIndicator(paragraph);

    const indicator = document.createElement('div');
    indicator.className = 'silence-translator-inline-loading';
    indicator.dataset.smartTranslatorUi = 'true';
    indicator.setAttribute('data-silence-translator-ui', 'true');
    indicator.setAttribute('aria-label', t('translatingInline'));
    indicator.innerHTML = `
      <div class="silence-translator-inline-loading__shell">
        <span class="silence-translator-inline-loading__spinner" aria-hidden="true"></span>
        <span class="silence-translator-inline-loading__label">${t('translatingInline')}</span>
      </div>
    `.trim();

    document.documentElement.appendChild(indicator);
    this.loadingStates.set(paragraph, {
      indicator,
      paragraph,
      anchor: this.findLoadingAnchor(paragraph),
    });
    this.ensureLoadingListeners();
    this.repositionLoadingIndicator(paragraph);
  }

  private findLoadingAnchor(paragraph: HTMLElement): Text | HTMLElement {
    const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        const text = node.nodeValue?.trim();
        if (!text || text.length < 2) {
          return NodeFilter.FILTER_REJECT;
        }

        const parent = node.parentElement;
        if (!parent || parent.closest('[data-silence-translator-ui="true"]') || this.isHiddenByAncestor(parent)) {
          return NodeFilter.FILTER_REJECT;
        }

        return NodeFilter.FILTER_ACCEPT;
      },
    });

    return (walker.nextNode() as Text | null) ?? paragraph;
  }

  private getAnchorRect(anchor: Text | HTMLElement): DOMRect | null {
    if (anchor instanceof Text) {
      const range = document.createRange();
      range.selectNodeContents(anchor);
      const rect = Array.from(range.getClientRects()).find((item) => item.width > 0 && item.height > 0) ?? null;
      range.detach();
      return rect;
    }

    const rect = anchor.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 ? rect : null;
  }

  private hideLoadingIndicator(paragraph: HTMLElement): void {
    const state = this.loadingStates.get(paragraph);
    if (!state) {
      return;
    }

    state.indicator.remove();
    this.loadingStates.delete(paragraph);
    this.removeLoadingListenersIfIdle();
  }

  private hideAllLoadingIndicators(): void {
    this.loadingStates.forEach((state) => state.indicator.remove());
    this.loadingStates.clear();
    this.removeLoadingListenersIfIdle();
  }

  private ensureLoadingListeners(): void {
    if (this.loadingStates.size !== 1) {
      return;
    }

    document.addEventListener('scroll', this.repositionLoadingIndicators, true);
    window.addEventListener('resize', this.repositionLoadingIndicators);
  }

  private removeLoadingListenersIfIdle(): void {
    if (this.loadingStates.size) {
      return;
    }

    document.removeEventListener('scroll', this.repositionLoadingIndicators, true);
    window.removeEventListener('resize', this.repositionLoadingIndicators);
  }

  private repositionLoadingIndicators = (): void => {
    Array.from(this.loadingStates.keys()).forEach((paragraph) => this.repositionLoadingIndicator(paragraph));
  };

  private repositionLoadingIndicator(paragraph: HTMLElement): void {
    const state = this.loadingStates.get(paragraph);
    if (!state) {
      return;
    }

    if (!state.paragraph.isConnected) {
      this.hideLoadingIndicator(paragraph);
      this.activeParagraphTranslations.delete(paragraph);
      return;
    }

    const anchorRect = this.getAnchorRect(state.anchor) ?? state.paragraph.getBoundingClientRect();
    const loadingRect = state.indicator.getBoundingClientRect();
    const width = loadingRect.width || 26;
    const height = loadingRect.height || 26;
    const viewportPadding = 8;
    const gap = 6;
    const canPlaceLeft = anchorRect.left - width - gap >= viewportPadding;
    const rawLeft = canPlaceLeft ? anchorRect.left - width - gap : anchorRect.left;
    const rawTop = anchorRect.top + Math.max(0, (Math.min(anchorRect.height, height) - height) / 2);
    const left = Math.min(Math.max(rawLeft, viewportPadding), Math.max(viewportPadding, window.innerWidth - width - viewportPadding));
    const top = Math.min(Math.max(rawTop, viewportPadding), Math.max(viewportPadding, window.innerHeight - height - viewportPadding));

    state.indicator.style.left = `${left}px`;
    state.indicator.style.top = `${top}px`;
  }
}
