import { isHotkeyMatch } from '../utils/hotkeys';

import type { HotkeyConfig } from '../types';

interface HotkeyActions {
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
    if (isHotkeyMatch(event, this.hotkeys.selection)) {
      event.preventDefault();
      void this.actions.selection();
      return;
    }

    if (isHotkeyMatch(event, this.hotkeys.silent)) {
      event.preventDefault();
      void this.actions.silent();
      return;
    }

    if (isHotkeyMatch(event, this.hotkeys.page)) {
      event.preventDefault();
      void this.actions.page();
      return;
    }

    if (isHotkeyMatch(event, this.hotkeys.restore)) {
      event.preventDefault();
      this.actions.restore();
    }
  };
}
