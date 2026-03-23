import { isHotkeyMatch } from '../utils/hotkeys';

import type { HotkeyConfig } from '../types';

interface HotkeyActions {
  selection: () => Promise<void>;
  silent: () => Promise<void>;
  bilingual: () => Promise<void>;
  page: () => Promise<void>;
  restore: () => void;
}

export class HotkeyManager {
  constructor(
    private hotkeys: HotkeyConfig,
    private readonly actions: HotkeyActions,
  ) {}

  updateHotkeys(hotkeys: HotkeyConfig): void {
    this.hotkeys = hotkeys;
  }

  handleKeydown = (event: KeyboardEvent): void => {
    const matchesSelection = isHotkeyMatch(event, this.hotkeys.selection);
    const matchesSilent = isHotkeyMatch(event, this.hotkeys.silent);
    const matchesBilingual = isHotkeyMatch(event, this.hotkeys.bilingual);
    const matchesPage = isHotkeyMatch(event, this.hotkeys.page);
    const matchesRestore = isHotkeyMatch(event, this.hotkeys.restore);

    if (matchesSelection) {
      event.preventDefault();
      void this.actions.selection();
      return;
    }

    if (matchesSilent) {
      event.preventDefault();
      void this.actions.silent();
      return;
    }

    if (matchesBilingual) {
      event.preventDefault();
      void this.actions.bilingual();
      return;
    }

    if (matchesPage) {
      event.preventDefault();
      void this.actions.page();
      return;
    }

    if (matchesRestore) {
      event.preventDefault();
      this.actions.restore();
    }
  };
}
