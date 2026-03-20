# AGENTS.md

This file gives repository-specific guidance to coding agents working in `silence-translator`.

## Project Overview

- Project type: browser extension
- Stack: Vite + CRXJS + React + TypeScript
- Manifest: `manifest.json`
- Main surfaces:
  - popup UI: `src/popup/`
  - options UI: `src/options/`
  - background worker: `src/background/`
  - content scripts: `src/content/`
  - translation engines: `src/engines/`

## Architecture Rules

- Keep all network translation requests in the background layer. Do not move provider calls into popup or content scripts.
- Content scripts are responsible for page interaction, selection handling, silent translation, and DOM updates.
- Popup and options are independent React apps. Keep shared behavior in `src/utils/`, `src/store/`, or `src/types/`.
- Provider-specific logic belongs in `src/engines/`. Do not scatter engine conditionals across unrelated files unless there is a strong reason.

## Working Style

- Prefer small, targeted edits that preserve the current architecture.
- Respect existing user changes in the worktree. Never revert unrelated modifications.
- Use `rg` for searching and `apply_patch` for manual file edits.
- Default to ASCII when editing files unless the file already uses non-ASCII and there is a clear reason.
- Keep comments concise and only add them when they help explain non-obvious logic.

## Validation Rules

- Do not run `npm run typecheck`.
- Do not run `npm run build`.
- Only run validation commands if the user explicitly asks for them.
- If you do not run validation, say so clearly in your final response.

## UX Rules

- Avoid silent failures. If an operation can fail in-page, prefer surfacing a visible status or error message.
- If translation succeeds but no visible DOM update happens, help the user understand why instead of pretending it succeeded.
- Preserve the current extension visual language unless the user asks for a redesign.

## Repo-Specific Notes

- Selection tooltip logic lives in `src/content/selection.ts`.
- Silent translation logic lives in `src/content/silent-translate.ts`.
- Page translation and in-page status bar logic live in `src/content/page-translate.ts`.
- Settings and persistence live in `src/store/settings.ts`.
- Shared language normalization helpers live in `src/utils/languages.ts`.
- LibreTranslate can be sensitive to auto-detection on text containing emoji or heavy symbol noise. If touching that path, preserve or improve the fallback behavior instead of simplifying it away.

## Preferred Change Patterns

- For UI bugs:
  - trace the event flow first
  - identify the owning surface
  - patch logic and styles together when needed
- For translation bugs:
  - check input normalization
  - check background request shaping
  - check provider response validation
  - check DOM write-back behavior
- For browser-extension issues:
  - prefer fixes that work after reloading the extension and refreshing the page

## Final Response Expectations

- Keep responses concise and practical.
- Mention the files changed.
- Mention whether validation was skipped.
- If browser testing is relevant, remind the user to reload the extension and refresh the page.
