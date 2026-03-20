import { isHotkeyMatch } from '../utils/hotkeys';

import type { HotkeyConfig } from '../types';

interface HotkeyActions {
  canRestore: () => boolean;
  selection: () => Promise<void>;
  silent: () => Promise<void>;
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
    const matchesPage = isHotkeyMatch(event, this.hotkeys.page);
    const matchesRestore = isHotkeyMatch(event, this.hotkeys.restore);

    if (matchesSilent && matchesRestore && this.actions.canRestore()) {
      event.preventDefault();
      void this.actions.silent();
      return;
    }

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
