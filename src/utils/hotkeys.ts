const MODIFIER_KEYS = ['Ctrl', 'Alt', 'Shift', 'Meta'] as const;

export function normalizeHotkey(raw: string): string {
  if (!raw) {
    return '';
  }

  const parts = raw
    .split('+')
    .map((token) => token.trim())
    .filter(Boolean);

  const modifiers = new Set<string>();
  let key = '';

  parts.forEach((part) => {
    const normalized = part.toLowerCase();
    if (normalized === 'ctrl' || normalized === 'control') {
      modifiers.add('Ctrl');
    } else if (normalized === 'alt' || normalized === 'option') {
      modifiers.add('Alt');
    } else if (normalized === 'shift') {
      modifiers.add('Shift');
    } else if (normalized === 'meta' || normalized === 'cmd' || normalized === 'command') {
      modifiers.add('Meta');
    } else {
      key = part.length === 1 ? part.toUpperCase() : `${part[0].toUpperCase()}${part.slice(1)}`;
    }
  });

  const ordered = MODIFIER_KEYS.filter((modifier) => modifiers.has(modifier));
  return [...ordered, key].filter(Boolean).join('+');
}

export function eventToHotkey(event: KeyboardEvent): string {
  const tokens: string[] = [];
  if (event.ctrlKey) {
    tokens.push('Ctrl');
  }
  if (event.altKey) {
    tokens.push('Alt');
  }
  if (event.shiftKey) {
    tokens.push('Shift');
  }
  if (event.metaKey) {
    tokens.push('Meta');
  }

  const key = formatKey(event.key);
  if (key) {
    tokens.push(key);
  }

  return normalizeHotkey(tokens.join('+'));
}

function formatKey(rawKey: string): string {
  if (!rawKey) {
    return '';
  }

  const normalized = rawKey.toLowerCase();
  if (['control', 'shift', 'alt', 'meta'].includes(normalized)) {
    return '';
  }

  if (normalized === ' ') {
    return 'Space';
  }

  return rawKey.length === 1 ? rawKey.toUpperCase() : `${rawKey[0].toUpperCase()}${rawKey.slice(1)}`;
}

export function isHotkeyMatch(event: KeyboardEvent, hotkey: string): boolean {
  return eventToHotkey(event) === normalizeHotkey(hotkey);
}

export function isEditableElement(element: Element | null): element is HTMLElement {
  if (!(element instanceof HTMLElement)) {
    return false;
  }

  const tagName = element.tagName.toLowerCase();
  return element.isContentEditable || tagName === 'textarea' || (tagName === 'input' && element.getAttribute('type') !== 'checkbox');
}
