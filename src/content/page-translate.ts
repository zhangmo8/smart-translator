import type { TranslateBatchResponse, TranslationSettings } from '../types';

interface NodeRecord {
  original: string;
  translated: string;
}

type SettingsGetter = () => Promise<TranslationSettings>;

const BLOCK_TAGS = new Set(['ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DD', 'DIV', 'DT', 'FIGCAPTION', 'FOOTER', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'LI', 'MAIN', 'NAV', 'P', 'SECTION', 'TD', 'TH']);

export class PageTranslator {
  private records = new Map<Text, NodeRecord>();
  private bar: HTMLDivElement | null = null;
  private statusLabel: HTMLDivElement | null = null;
  private toggleOriginalButton: HTMLButtonElement | null = null;
  private translated = false;
  private showingOriginal = false;

  constructor(private readonly getSettings: SettingsGetter) {}

  isTranslated(): boolean {
    return this.translated;
  }

  async togglePageTranslation(showBar = true): Promise<void> {
    if (this.translated) {
      this.restoreOriginalPage(true);
      return;
    }

    await this.translatePage(showBar);
  }

  async translatePage(showBar = true): Promise<boolean> {
    if (showBar) {
      this.ensureBar();
    }

    const nodes = this.collectTextNodes(document.body);
    if (!nodes.length) {
      this.setStatus('Nothing translatable found on this page.');
      return false;
    }

    this.setStatus(`Scanning ${nodes.length} text fragments...`);
    try {
      await this.translateNodes(nodes, (done, total) => {
        this.setStatus(`Translated ${done} / ${total} fragments`);
      });
    } catch (error: unknown) {
      this.translated = false;
      this.showingOriginal = false;
      this.ensureBar();
      this.updateBarButtons();
      this.setStatus(this.formatError(error), 'error');
      return false;
    }

    this.translated = true;
    this.showingOriginal = false;
    this.updateBarButtons();
    this.setStatus('Page translated. Toggle original anytime.', 'success');
    return true;
  }

  async translateElement(element: HTMLElement): Promise<boolean> {
    const nodes = this.collectTextNodes(element);
    if (!nodes.length) {
      return false;
    }

    try {
      await this.translateNodes(nodes);
      this.translated = true;
      this.showingOriginal = false;
      this.ensureBar();
      this.updateBarButtons();
      this.setStatus('Block translated. Press the shortcut again to restore it.', 'success');
      return true;
    } catch (error: unknown) {
      this.ensureBar();
      this.setStatus(this.formatError(error), 'error');
      return false;
    }
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
      this.setStatus('Original text restored for the highlighted block.');
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
    this.setStatus('Original page restored.');
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
    this.setStatus(this.showingOriginal ? 'Showing original page text.' : 'Showing translated page text.');
  }

  highlightElement(element: HTMLElement): void {
    element.classList.remove('smart-translator-flash');
    void element.offsetWidth;
    element.classList.add('smart-translator-flash');
    window.setTimeout(() => element.classList.remove('smart-translator-flash'), 900);
  }

  findParagraphCandidate(target: Element | null): HTMLElement | null {
    let current: Element | null = target;
    while (current && current !== document.body) {
      if (current instanceof HTMLElement) {
        if (current.closest('[data-smart-translator-ui="true"]')) {
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

  private async translateNodes(nodes: Text[], onProgress?: (done: number, total: number) => void): Promise<void> {
    const settings = await this.getSettings();
    const texts = nodes.map((node) => node.nodeValue ?? '').filter((text) => text.trim().length > 0);
    if (!texts.length) {
      return;
    }

    const chunkSize = settings.defaultEngine === 'libretranslate' ? 8 : 24;
    const translatedTexts: string[] = [];
    let detectedSourceLanguage = '';

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

      translatedTexts.push(...response.translations);
      detectedSourceLanguage ||= response.detectedSourceLanguage || '';
      onProgress?.(Math.min(index + slice.length, texts.length), texts.length);
    }

    nodes.forEach((node, index) => {
      const original = node.nodeValue ?? '';
      const translated = translatedTexts[index] ?? original;
      this.records.set(node, { original, translated });
      node.nodeValue = translated;
    });

    if (detectedSourceLanguage) {
      this.setStatus(`Detected ${detectedSourceLanguage} → ${settings.targetLanguage}`);
    }
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

        if (parent.closest('[data-smart-translator-ui="true"]')) {
          return NodeFilter.FILTER_REJECT;
        }

        if (parent.isContentEditable) {
          return NodeFilter.FILTER_REJECT;
        }

        const tag = parent.tagName.toLowerCase();
        if (['script', 'style', 'noscript', 'textarea', 'input', 'select', 'option', 'code', 'pre', 'kbd', 'samp'].includes(tag)) {
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

  private ensureBar(): void {
    if (this.bar) {
      return;
    }

    const bar = document.createElement('div');
    bar.className = 'smart-translator-bar';
    bar.dataset.smartTranslatorUi = 'true';
    bar.setAttribute('data-smart-translator-ui', 'true');

    bar.innerHTML = `
      <div class="smart-translator-bar__shell">
        <div class="smart-translator-bar__brand">
          <span class="smart-translator-bar__dot"></span>
          <div>
            <div class="smart-translator-bar__title">smart-translator</div>
            <div class="smart-translator-bar__status">Ready to translate</div>
          </div>
        </div>
        <div class="smart-translator-bar__actions">
          <button class="smart-translator-button smart-translator-button--ghost" data-action="settings">Settings</button>
          <button class="smart-translator-button smart-translator-button--ghost" data-action="toggle-original">Show original</button>
          <button class="smart-translator-button smart-translator-button--ghost" data-action="restore">Restore</button>
          <button class="smart-translator-button" data-action="close">Close</button>
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
    this.statusLabel = bar.querySelector('.smart-translator-bar__status');
    this.toggleOriginalButton = bar.querySelector('[data-action="toggle-original"]');
    this.updateBarButtons();
  }

  private removeBar(): void {
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
      this.toggleOriginalButton.textContent = this.showingOriginal ? 'Show translation' : 'Show original';
      this.toggleOriginalButton.disabled = !this.translated;
    }
  }

  private formatError(error: unknown): string {
    if (error instanceof Error && error.message.trim()) {
      return error.message;
    }

    return 'Translation failed. Please try again.';
  }
}
