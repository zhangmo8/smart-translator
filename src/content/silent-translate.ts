import { PageTranslator } from './page-translate';

import type { TranslationSettings } from '../types';

type SettingsGetter = () => Promise<TranslationSettings>;

export class SilentTranslator {
  private hoveredElement: Element | null = null;
  private activeParagraph: HTMLElement | null = null;

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

    if (this.activeParagraph?.isConnected) {
      this.pageTranslator.restoreElement(this.activeParagraph);
      this.pageTranslator.highlightElement(this.activeParagraph);
      this.activeParagraph = null;
      return;
    }

    const paragraph = this.pageTranslator.findParagraphCandidate(this.hoveredElement);
    if (!paragraph) {
      return;
    }

    const translated = await this.pageTranslator.translateElement(paragraph, false);
    if (!translated) {
      return;
    }

    this.pageTranslator.highlightElement(paragraph);
    this.activeParagraph = paragraph;
  }

  clearParagraphState(): void {
    this.activeParagraph = null;
  }
}
