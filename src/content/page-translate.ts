import { BATCH_SIZE } from '../utils/constants';
import type { TranslateBatchResponse, TranslationSettings } from '../types';
import { t } from '../utils/i18n';

interface NodeRecord {
  original: string;
  translated: string;
}

interface NodeTranslationEntry {
  node: Text;
  text: string;
}

interface TranslationApplyStats {
  totalNodes: number;
  appliedCount: number;
  detachedCount: number;
  unchangedCount: number;
  detectedSourceLanguage?: string;
}

type SettingsGetter = () => Promise<TranslationSettings>;

const BLOCK_TAGS = new Set(['ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DD', 'DIV', 'DT', 'FIGCAPTION', 'FOOTER', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'LI', 'MAIN', 'NAV', 'P', 'SECTION', 'TD', 'TH']);
const SKIPPED_TAGS = new Set(['script', 'style', 'noscript', 'textarea', 'input', 'select', 'option', 'code', 'pre', 'kbd', 'samp']);

export class PageTranslator {
  private records = new Map<Text, NodeRecord>();
  private bar: HTMLDivElement | null = null;
  private statusLabel: HTMLDivElement | null = null;
  private toggleOriginalButton: HTMLButtonElement | null = null;
  private statusHideTimer: number | null = null;
  private translated = false;
  private showingOriginal = false;

  constructor(private readonly getSettings: SettingsGetter) {}

  isTranslated(): boolean {
    return this.translated;
  }

  async togglePageTranslation(showBar = true): Promise<void> {
    if (!showBar) {
      this.removeBar();
    }

    if (this.translated) {
      this.restoreOriginalPage(true);
      return;
    }

    await this.translatePage(showBar);
  }

  async translatePage(showBar = true): Promise<boolean> {
    if (showBar) {
      this.ensureBar();
    } else {
      this.removeBar();
    }

    const nodes = this.collectTextNodes(document.body);
    if (!nodes.length) {
      this.reportStatus(showBar, t('nothingTranslatablePage'));
      return false;
    }

    if (showBar) {
      this.setStatus(t('scanningFragments', [nodes.length.toString()]));
    }

    let stats: TranslationApplyStats;
    try {
      stats = await this.translateNodes(nodes, (done, total) => {
        if (showBar) {
          this.setStatus(t('translatedFragments', [done.toString(), total.toString()]));
        }
      });
    } catch (error: unknown) {
      this.translated = false;
      this.showingOriginal = false;
      this.updateBarButtons();
      this.reportStatus(showBar, this.formatError(error), 'error');
      return false;
    }

    this.translated = this.records.size > 0;
    this.showingOriginal = false;
    this.updateBarButtons();
    if (!stats.appliedCount) {
      this.reportStatus(showBar, this.formatNoVisibleChangeMessage('page', stats), 'error');
      return false;
    }

    if (showBar) {
      const partialStatus = stats.detachedCount
        ? t('pageTranslatedPartial', [stats.appliedCount.toString(), stats.detachedCount.toString(), stats.detachedCount === 1 ? '' : 's'])
        : t('pageTranslatedComplete');
      this.setStatus(partialStatus, 'success');
    }
    return true;
  }

  async translateElement(element: HTMLElement, showBar = true): Promise<Map<Text, NodeRecord> | null> {
    if (!showBar) {
      this.removeBar();
    }

    const existingRecords = new Map<Text, NodeRecord>();
    this.records.forEach((record, node) => {
      if (element.contains(node)) {
        existingRecords.set(node, { ...record });
      }
    });

    const nodes = this.collectTextNodes(element);
    if (!nodes.length) {
      this.reportStatus(showBar, t('nothingTranslatableBlock'));
      return null;
    }

    let stats: TranslationApplyStats;
    try {
      stats = await this.translateNodes(nodes);
      this.translated = this.records.size > 0;
      this.showingOriginal = false;
      this.updateBarButtons();

      if (!stats.appliedCount) {
        this.reportStatus(showBar, this.formatNoVisibleChangeMessage('block', stats), 'error');
        return null;
      }

      if (showBar) {
        this.ensureBar();
        const partialStatus = stats.detachedCount
          ? t('blockTranslatedPartial', [stats.detachedCount.toString(), stats.detachedCount === 1 ? '' : 's'])
          : t('blockTranslatedComplete');
        this.setStatus(partialStatus, 'success');
      }
      return existingRecords;
    } catch (error: unknown) {
      this.reportStatus(showBar, this.formatError(error), 'error');
      return null;
    }
  }

  restoreElementSnapshot(snapshot: Map<Text, NodeRecord>): void {
    snapshot.forEach((record, node) => {
      if (node.isConnected) {
        node.nodeValue = record.original;
        this.records.set(node, record);
      }
    });

    this.translated = this.records.size > 0;
    this.showingOriginal = false;
    this.updateBarButtons();
  }

  restoreElement(element: HTMLElement): void {
    const targetNodes = this.collectTextNodes(element).filter((node) => this.records.has(node));
    targetNodes.forEach((node) => {
      const record = this.records.get(node);
      if (!record) {
        return;
      }

      node.nodeValue = record.original;
      this.records.delete(node);
    });

    if (!this.records.size) {
      this.translated = false;
      this.showingOriginal = false;
      this.removeBar();
    } else {
      this.updateBarButtons();
      this.setStatus(t('originalBlockRestored'));
    }
  }

  restoreOriginalPage(removeBar = false): void {
    this.records.forEach((record, node) => {
      if (node.isConnected) {
        node.nodeValue = record.original;
      }
    });

    this.records.clear();
    this.translated = false;
    this.showingOriginal = false;

    if (removeBar) {
      this.removeBar();
      return;
    }

    this.ensureBar();
    this.updateBarButtons();
    this.setStatus(t('originalPageRestored'));
  }

  toggleOriginalVisibility(): void {
    if (!this.translated) {
      return;
    }

    this.records.forEach((record, node) => {
      if (!node.isConnected) {
        return;
      }

      node.nodeValue = this.showingOriginal ? record.translated : record.original;
    });

    this.showingOriginal = !this.showingOriginal;
    this.updateBarButtons();
    this.setStatus(this.showingOriginal ? t('showingOriginal') : t('showingTranslated'));
  }

  highlightElement(element: HTMLElement): void {
    element.classList.remove('silence-translator-flash');
    void element.offsetWidth;
    element.classList.add('silence-translator-flash');
    window.setTimeout(() => element.classList.remove('silence-translator-flash'), 900);
  }

  findParagraphCandidate(target: Element | null): HTMLElement | null {
    let current: Element | null = target;
    while (current && current !== document.body) {
      if (current instanceof HTMLElement) {
        if (current.closest('[data-silence-translator-ui="true"]')) {
          return null;
        }

        if (BLOCK_TAGS.has(current.tagName)) {
          const textLength = current.innerText.trim().length;
          if (textLength >= 10) {
            return current;
          }
        }
      }
      current = current.parentElement;
    }

    return null;
  }

  notifyTransient(text: string, tone: 'default' | 'success' | 'error' = 'default'): void {
    this.showTransientStatus(text, tone);
  }

  private async translateNodes(nodes: Text[], onProgress?: (done: number, total: number) => void): Promise<TranslationApplyStats> {
    const settings = await this.getSettings();
    const entries: NodeTranslationEntry[] = nodes
      .map((node) => ({
        node,
        text: node.nodeValue ?? '',
      }))
      .filter((entry) => entry.text.trim().length > 0);

    if (!entries.length) {
      return {
        totalNodes: 0,
        appliedCount: 0,
        detachedCount: 0,
        unchangedCount: 0,
      };
    }

    const chunkSize = BATCH_SIZE[settings.defaultEngine];
    const translatedTexts: string[] = [];
    let detectedSourceLanguage = '';

    for (let index = 0; index < entries.length; index += chunkSize) {
      const slice = entries.slice(index, index + chunkSize);
      const response = (await chrome.runtime.sendMessage({
        type: 'TRANSLATE_BATCH',
        payload: {
          texts: slice.map((entry) => entry.text),
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
          t('engineReturnedMismatch', [
            settings.defaultEngine,
            response.translations.length.toString(),
            response.translations.length === 1 ? '' : 's',
            slice.length.toString(),
            slice.length === 1 ? '' : 's'
          ])
        );
      }

      translatedTexts.push(...response.translations);
      detectedSourceLanguage ||= response.detectedSourceLanguage || '';
      onProgress?.(Math.min(index + slice.length, entries.length), entries.length);
    }

    if (translatedTexts.length !== entries.length) {
      throw new Error(
        t('receivedMismatchNode', [
          translatedTexts.length.toString(),
          translatedTexts.length === 1 ? '' : 's',
          entries.length.toString(),
          entries.length === 1 ? '' : 's'
        ])
      );
    }

    let appliedCount = 0;
    let detachedCount = 0;
    let unchangedCount = 0;

    entries.forEach((entry, index) => {
      const { node, text: sourceText } = entry;
      const currentText = node.nodeValue ?? '';
      const translated = translatedTexts[index];
      if (typeof translated !== 'string') {
        throw new Error(t('missingTranslatedFragment', [(index + 1).toString()]));
      }

      if (!node.isConnected) {
        detachedCount += 1;
        return;
      }

      if (currentText !== sourceText) {
        detachedCount += 1;
        return;
      }

      if (translated === currentText) {
        unchangedCount += 1;
        return;
      }

      const existing = this.records.get(node);
      const original = existing?.original ?? currentText;
      this.records.set(node, { original, translated });
      node.nodeValue = translated;
      appliedCount += 1;
    });

    if (detectedSourceLanguage) {
      this.setStatus(t('detectedLanguages', [detectedSourceLanguage, settings.targetLanguage]));
    }

    return {
      totalNodes: entries.length,
      appliedCount,
      detachedCount,
      unchangedCount,
      detectedSourceLanguage: detectedSourceLanguage || undefined,
    };
  }

  private collectTextNodes(root: ParentNode): Text[] {
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

        const tag = parent.tagName.toLowerCase();
        if (SKIPPED_TAGS.has(tag)) {
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

  private ensureBar(): void {
    this.clearStatusHideTimer();
    if (this.bar) {
      delete this.bar.dataset.transient;
      return;
    }

    const bar = document.createElement('div');
    bar.className = 'silence-translator-bar';
    bar.dataset.smartTranslatorUi = 'true';
    bar.setAttribute('data-silence-translator-ui', 'true');

    bar.innerHTML = `
      <div class="silence-translator-bar__shell">
        <div class="silence-translator-bar__brand">
          <span class="silence-translator-bar__dot"></span>
          <div>
            <div class="silence-translator-bar__title">${t('silenceTranslatorBar')}</div>
            <div class="silence-translator-bar__status">${t('barReady')}</div>
          </div>
        </div>
        <div class="silence-translator-bar__actions">
          <button class="silence-translator-button silence-translator-button--ghost" data-action="settings">${t('settings')}</button>
          <button class="silence-translator-button silence-translator-button--ghost" data-action="toggle-original">${t('barShowOriginal')}</button>
          <button class="silence-translator-button silence-translator-button--ghost" data-action="restore">${t('barRestore')}</button>
          <button class="silence-translator-button" data-action="close">${t('close')}</button>
        </div>
      </div>
    `;

    bar.addEventListener('click', (event) => {
      const target = event.target as HTMLElement | null;
      const action = target?.dataset.action;
      if (!action) {
        return;
      }

      if (action === 'toggle-original') {
        this.toggleOriginalVisibility();
      }

      if (action === 'settings') {
        void chrome.runtime.sendMessage({ type: 'OPEN_OPTIONS' });
      }

      if (action === 'restore') {
        this.restoreOriginalPage();
      }

      if (action === 'close') {
        this.restoreOriginalPage(true);
      }
    });

    document.documentElement.appendChild(bar);
    this.bar = bar;
    this.statusLabel = bar.querySelector('.silence-translator-bar__status');
    this.toggleOriginalButton = bar.querySelector('[data-action="toggle-original"]');
    this.updateBarButtons();
  }

  private removeBar(): void {
    this.clearStatusHideTimer();
    this.bar?.remove();
    this.bar = null;
    this.statusLabel = null;
    this.toggleOriginalButton = null;
  }

  private setStatus(text: string, tone: 'default' | 'success' | 'error' = 'default'): void {
    if (this.bar) {
      this.bar.dataset.tone = tone;
    }

    if (this.statusLabel) {
      this.statusLabel.textContent = text;
    }
  }

  private updateBarButtons(): void {
    if (this.toggleOriginalButton) {
      this.toggleOriginalButton.textContent = this.showingOriginal ? t('barShowTranslation') : t('barShowOriginal');
      this.toggleOriginalButton.disabled = !this.translated;
    }
  }

  private reportStatus(showBar: boolean, text: string, tone: 'default' | 'success' | 'error' = 'default'): void {
    if (showBar) {
      this.ensureBar();
      this.setStatus(text, tone);
      return;
    }

    this.showTransientStatus(text, tone);
  }

  private showTransientStatus(text: string, tone: 'default' | 'success' | 'error' = 'default', duration = tone === 'error' ? 5200 : 3200): void {
    this.ensureBar();
    if (!this.bar) {
      return;
    }

    this.bar.dataset.transient = 'true';
    this.setStatus(text, tone);
    this.clearStatusHideTimer();
    this.statusHideTimer = window.setTimeout(() => {
      if (this.bar?.dataset.transient === 'true') {
        this.removeBar();
      }
    }, duration);
  }

  private clearStatusHideTimer(): void {
    if (this.statusHideTimer !== null) {
      window.clearTimeout(this.statusHideTimer);
      this.statusHideTimer = null;
    }
  }

  private formatNoVisibleChangeMessage(scope: 'page' | 'block', stats: TranslationApplyStats): string {
    const subject = scope === 'page' ? 'page' : 'block';
    if (stats.detachedCount === stats.totalNodes && stats.totalNodes > 0) {
      return t('updatedBeforeWriteback', [subject]);
    }

    if (stats.detachedCount + stats.unchangedCount === stats.totalNodes && stats.unchangedCount > 0) {
      return t('translatedMatchedOriginal', [scope === 'page' ? 'page text' : 'block text']);
    }

    return t('noVisibleUpdate', [subject]);
  }

  private formatError(error: unknown): string {
    if (error instanceof Error && error.message.trim()) {
      return error.message;
    }

    return t('translationFailedGeneric');
  }
}
