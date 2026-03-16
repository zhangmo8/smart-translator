# smart-translator

`smart-translator` is a Manifest V3 browser extension for fast translation across selected text, input fields, silent keyboard workflows, and full-page DOM translation. It uses a background service worker for all network requests, stores synced preferences in `chrome.storage.sync`, and keeps history/cache in `chrome.storage.local`.

## Highlights

- React + TypeScript popup and options UI, bundled with Vite + CRXJS
- Tailwind-powered extension surfaces with light / dark / auto themes
- Selection translation with a floating translate tooltip
- Full-page translation bar with original/translated toggle and restore support
- Silent translation mode for paragraph-under-cursor or full page, triggered by keyboard shortcut only
- Focused input / textarea translation in-place
- Popup quick translate with engine category tabs, language pair selector, swap button, and local history
- Context menu actions for translating a selection, translating the current page, and switching silent mode
- Background-only API traffic for CORS-safe translation requests
- Local caching + rate limiting across all providers

## Supported engines

### Standard APIs

- Google Translate API
- Microsoft Azure Translator
- DeepL API
- LibreTranslate (public or self-hosted endpoint)

### AI translation

- OpenAI / ChatGPT (`gpt-4o-mini` default)
- Claude / Anthropic (`claude-3-haiku-20240307` default)
- Google Gemini (`gemini-1.5-flash` default)
- Doubao / ByteDance (`doubao-pro-4k` default)
- DeepSeek (`deepseek-chat` default)

Each AI provider supports a custom model name and system prompt. Standard providers expose the required credential fields, plus custom endpoint options where relevant.

## Default behavior

- Source language: `Auto-detect`
- Target language: browser UI language (`navigator.language` / `chrome.i18n.getUILanguage()`)
- Default engine: `Microsoft Azure Translator`
- Cache: enabled
- Silent mode: `Paragraph under cursor`

## Hotkeys

These defaults are declared in `manifest.json` and mirrored by the content-script listener using values stored in sync storage.

- `Alt+T` — translate current selection or focused input in-place
- `Alt+Q` — silent translate using paragraph/full-page mode from settings
- `Alt+W` — translate or restore the full page
- `Alt+R` — restore original page text immediately

Note: browser-level command shortcuts can also be customized in the browser’s extension shortcut management UI. The options page controls the in-page listener hotkeys.

## Project structure

```text
smart-translator/
├── manifest.json
├── popup.html
├── options.html
├── public/icons/
├── src/
│   ├── background/
│   ├── content/
│   ├── engines/
│   ├── options/
│   ├── popup/
│   ├── store/
│   ├── types/
│   └── utils/
├── package.json
├── tailwind.config.ts
├── tsconfig.json
├── vite.config.ts
└── README.md
```

## Installation

### 1. Install dependencies

```bash
npm install
```

### 2. Build the extension

Chrome / Edge:

```bash
npm run build
```

Firefox-targeted build output:

```bash
npm run build:firefox
```

### 3. Load into the browser

#### Chrome / Edge

1. Open `chrome://extensions` or `edge://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Choose the generated `dist/` directory

#### Firefox

1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on**
3. Choose a file inside `dist-firefox/` such as `manifest.json`

## API key setup

Open the extension options page and fill the provider card for the engine you want to use:

- Google: API key
- Microsoft: API key + Azure region
- DeepL: API key (+ optional custom API URL)
- LibreTranslate: optional API key + endpoint URL
- OpenAI / Claude / Gemini / Doubao / DeepSeek: API key + optional model + system prompt

Doubao also supports a custom Ark-compatible endpoint field.

## How features work

### Selection translate

Select text on a page to reveal a floating translate button. Click it or press `Alt+T`.

### Input box translate

Focus an `input`, `textarea`, or contenteditable field and press `Alt+T`. Selected text is replaced in-place; if no selection exists, the whole field is translated.

### Full page translate

Press `Alt+W` or use the context menu. The content script walks translatable text nodes, skips scripts/styles/code blocks/extension UI, and swaps in translated text. The top bar lets you show the original text again or restore the page.

### Silent translate

Press `Alt+Q`.

- `Paragraph` mode translates the nearest block under the cursor and briefly highlights it
- `Full page` mode runs the same translation flow as page translate without needing a click

Pressing the shortcut again toggles the paragraph/full-page translation back off.

### Popup translate

Open the extension popup to translate ad hoc text, switch between standard vs AI providers, swap languages, and reuse recent history.

## Storage model

- `chrome.storage.sync`
  - source / target language
  - default engine
  - engine credentials and model settings
  - theme
  - hotkeys
  - cache toggle
  - silent mode
- `chrome.storage.local`
  - recent translation history (last 10)
  - translation cache

## Architecture notes

- All translation requests route through `src/background/index.ts`
- Providers live in `src/engines/`
- Content-side DOM translation lives in `src/content/`
- Popup and options are independent React applications
- A lightweight per-provider rate limiter serializes requests and adds spacing between calls

## Development notes

- `npm run dev` starts the Vite development server used by CRXJS
- `npm run typecheck` runs `tsc --noEmit`
- `npm run build` creates the production Chrome/Edge package in `dist/`
- `npm run build:firefox` creates a Firefox-targeted package in `dist-firefox/`
