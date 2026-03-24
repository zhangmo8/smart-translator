const MODIFIER_KEYS = ['Ctrl', 'Alt', 'Shift', 'Meta'] as const;
const MODIFIER_NAMES = ['control', 'shift', 'alt', 'meta'] as const;

const KEY_ALIASES: Record<string, string> = {
  esc: 'Escape',
  escape: 'Escape',
  return: 'Enter',
  enter: 'Enter',
  space: 'Space',
  spacebar: 'Space',
  up: 'ArrowUp',
  arrowup: 'ArrowUp',
  down: 'ArrowDown',
  arrowdown: 'ArrowDown',
  left: 'ArrowLeft',
  arrowleft: 'ArrowLeft',
  right: 'ArrowRight',
  arrowright: 'ArrowRight',
  del: 'Delete',
  delete: 'Delete',
  ins: 'Insert',
  insert: 'Insert',
  pgup: 'PageUp',
  pageup: 'PageUp',
  pgdn: 'PageDown',
  pagedown: 'PageDown',
};

const CODE_KEY_MAP: Record<string, string> = {
  Space: 'Space',
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  IntlBackslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
};

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
      key = normalizeKeyToken(part);
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

  const key = formatKey(event);
  if (key) {
    tokens.push(key);
  }

  return normalizeHotkey(tokens.join('+'));
}

function formatKey(event: KeyboardEvent): string {
  const rawKey = event.key;
  if (!rawKey) {
    return '';
  }

  const normalized = rawKey.toLowerCase();
  if (MODIFIER_NAMES.includes(normalized as (typeof MODIFIER_NAMES)[number])) {
    return '';
  }

  if (normalized === ' ') {
    return 'Space';
  }

  const codeKey = formatCodeKey(event.code);
  if (event.altKey && codeKey) {
    return codeKey;
  }

  return normalizeKeyToken(rawKey);
}

function normalizeKeyToken(rawKey: string): string {
  if (!rawKey) {
    return '';
  }

  const alias = KEY_ALIASES[rawKey.toLowerCase()];
  if (alias) {
    return alias;
  }

  const codeKey = formatCodeKey(rawKey);
  if (codeKey) {
    return codeKey;
  }

  if (/^Key[A-Z]$/.test(rawKey)) {
    return rawKey.slice(3);
  }

  if (/^Digit[0-9]$/.test(rawKey)) {
    return rawKey.slice(5);
  }

  if (/^Numpad[0-9]$/.test(rawKey)) {
    return rawKey;
  }

  if (/^F\d{1,2}$/i.test(rawKey)) {
    return rawKey.toUpperCase();
  }

  return rawKey.length === 1 ? rawKey.toUpperCase() : `${rawKey[0].toUpperCase()}${rawKey.slice(1)}`;
}

function formatCodeKey(rawCode: string): string {
  if (!rawCode) {
    return '';
  }

  if (/^Key[A-Z]$/.test(rawCode)) {
    return rawCode.slice(3);
  }

  if (/^Digit[0-9]$/.test(rawCode)) {
    return rawCode.slice(5);
  }

  if (/^Numpad[0-9]$/.test(rawCode)) {
    return rawCode;
  }

  return CODE_KEY_MAP[rawCode] ?? '';
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
