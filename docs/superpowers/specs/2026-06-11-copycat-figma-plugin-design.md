# CopyCat Figma Plugin — Design

**Author:** Luke Page
**Date:** 2026-06-11
**Status:** Approved (pending Luke's final read)
**Project:** ElevenLabs take-home interview — Figma ad localisation tool

---

## 1. Overview

**CopyCat** is a Figma plugin that lets a designer translate selected text layers into any language via Claude, in-place, without leaving Figma. It exists as a take-home exercise for the ElevenLabs design team to assess; the design optimises for "the reviewer can install it and translate something in under a minute."

The product is a Figma plugin paired with a small Vercel-hosted Anthropic proxy. The plugin runs natively inside Figma (reading and writing text nodes via the Plugin API); the proxy holds the Anthropic API key safely server-side.

There is no separate web app, no Figma personal-access-token to provision, no URL paste, no artboard duplication, and no per-user authentication. The whole product is one Figma panel with one input and one button.

## 2. Goals and non-goals

**Goals**

- Translate selected text layers in Figma to any language, in place, in one user-visible step.
- Zero setup beyond a one-time plugin install for the reviewer.
- Preserve artwork integrity — only text strings change, never gradients, photos, vector strokes, fonts, or layout.
- Bound the worst-case Anthropic cost via rate-limits in the proxy.
- Be a credible interview deliverable: small, clean, explainable.

**Non-goals (deliberately out of scope for v1)**

- Figma Variables / multi-mode language switching.
- Multi-language batch (translating to French, Spanish, German in one run).
- Translation memory or glossary management.
- Per-node "protect from translation" toggles inside the plugin (the designer simply doesn't select what they don't want translated).
- Source/translation review table inside the plugin (Figma's canvas is the review surface).
- Per-user invite codes or sign-in (rate limits handle cost-bounding).
- Publishing to Figma Community (dev plugin install only).

## 3. User flow

```
                          FIGMA
   ┌──────────────────────────────────────────┐
   │  1. Plugins → CopyCat                      │
   │                                          │
   │  ┌────────────────────────────────┐     │
   │  │  CopyCat                         │     │
   │  │  Select text layers to begin.  │  ◄── empty state
   │  └────────────────────────────────┘     │
   │                                          │
   │  2. Cmd-click text layers in Figma.      │
   │     Panel updates live:                  │
   │                                          │
   │  ┌────────────────────────────────┐     │
   │  │  5 text layers selected        │     │
   │  │  Translate to: [           ]   │     │
   │  │        [ Translate ]           │     │
   │  └────────────────────────────────┘     │
   │                                          │
   │  3. Type language → button enables       │
   │     → click → spinner.                   │
   │                                          │
   │  4. Done:                                │
   │  ┌────────────────────────────────┐     │
   │  │  ✓ Translated 4 layers.        │     │
   │  │  ⚠ 1 skipped: mixed styling.   │     │
   │  │  [ Translate more ]            │     │
   │  └────────────────────────────────┘     │
   │                                          │
   │  5. Designer reviews on the artboard.    │
   │     Edits in Figma if needed. Cmd-Z      │
   │     to undo.                             │
   └──────────────────────────────────────────┘
```

Selection-order is flexible: the designer can select before opening the plugin, or open first and select after. The panel re-renders on Figma's `selectionchange` event either way.

The **Translate** button is disabled until two conditions are met:
- At least one text layer is in the current Figma selection.
- The language input contains non-whitespace text.

## 4. Architecture

```
   FIGMA                                          VERCEL
   ┌──────────────────────────┐                  ┌──────────────────────────┐
   │  CopyCat plugin            │                  │  /api/translate          │
   │  ─────────────           │                  │  ─────────────           │
   │  code.ts                 │                  │  - rate limit (global    │
   │  (Plugin API: read       │                  │    + per-IP)             │
   │   selection, write       │                  │  - max 50 layers/request │
   │   characters)            │  ───POST JSON──► │  - calls Anthropic       │
   │                          │                  │    Claude Haiku 4.5      │
   │  ui.tsx                  │  ◄──JSON array── │  - returns translations  │
   │  (React panel:           │                  │                          │
   │   language input,        │                  │  Env: ANTHROPIC_API_KEY  │
   │   translate button,      │                  └──────────────────────────┘
   │   status display)        │
   └──────────────────────────┘
```

Two components, one network call per translation request. No persistent storage. No database. No background jobs.

### 4.1 The plugin (Figma side)

Two files run inside Figma:

- **`code.ts`** — runs in Figma's plugin sandbox. Has access to the Plugin API (`figma.currentPage.selection`, `node.characters = ...`, font loading, etc.). Communicates with the UI via `figma.ui.postMessage` and `figma.ui.onmessage`.
- **`ui.tsx`** — renders inside an iframe Figma provides. This is where the React UI lives. It cannot read or write the Figma file directly; it talks to `code.ts` via `parent.postMessage`. It can make `fetch` calls to the proxy (Figma plugins are allowed network access to allowed domains declared in `manifest.json`).

Build: Vite bundles `ui.tsx` into a single self-contained HTML file; `code.ts` compiles to a single JS bundle. Figma's plugin manifest points at both.

### 4.2 The proxy (Vercel side)

One Next.js API route: `POST /api/translate`.

- Receives: `{ language: string, strings: { id: string, text: string }[] }` where `id` is the Figma node ID.
- Rate-limits: 500 requests/day total; 100/hour per IP. Implementation: in-memory `Map<string, { count, resetAt }>` in the route module. See §6.3 for the honest trade-off this implies.
- Validates: max 50 strings per request. Reject if more.
- Calls Anthropic: one Claude Haiku 4.5 request, prompted to return a JSON array `[{ id, text }]` in the requested language. System prompt keeps tone matched to ad copy.
- Returns: same shape — `{ translations: { id, text }[], skipped?: { id, reason }[] }`.

The route already exists at `app/api/translate/route.ts` and will be reused with updates to (a) the request/response shape, (b) the model, (c) the new rate-limit middleware.

## 5. Plugin behaviour, in detail

### 5.1 Selection handling

On every `selectionchange` event in Figma:
1. `code.ts` walks the current selection, filtering to nodes where `node.type === 'TEXT'`. Children of selected frames are NOT auto-included — selection means selection. (A future refinement could add a "include all text in selected frames" toggle.)
2. `code.ts` posts the filtered list to the UI: `{ type: 'selection', nodes: [{ id, characters, fontName, hasMixedFills, hasMixedFontName }] }`.
3. UI updates the count and enables/disables the Translate button.

### 5.2 Translate flow

When the designer clicks Translate:
1. UI posts to `code.ts`: `{ type: 'translate-request' }`.
2. `code.ts` re-reads the current selection (in case it changed since the last `selectionchange` event), filters to text nodes, and partitions them:
   - **Translatable:** plain text nodes with a single uniform style.
   - **Skipped:** nodes with mixed styling (`node.fontName === figma.mixed`, `node.fills === figma.mixed`, `node.fontSize === figma.mixed`).
3. `code.ts` sends the translatable list to the UI: `{ type: 'will-translate', items: [{ id, text }], skipped: [{ id, reason }] }`.
4. UI calls the proxy: `POST /api/translate` with `{ language, strings }`.
5. UI receives translations and posts to `code.ts`: `{ type: 'apply', translations: [{ id, text }] }`.
6. `code.ts` walks each translation:
   - Loads the node's font: `await figma.loadFontAsync(node.fontName)`. If this fails (font not installed in this Figma instance), add to skipped list with reason "font not loaded".
   - Sets `node.characters = translation.text`.
7. `code.ts` reports back the final result counts: `{ type: 'apply-result', translated: N, skipped: [{ id, name, reason }] }`.
8. UI switches to the "done" screen.

### 5.3 Done screen

Shows:
- `✓ Translated N layers.` (always shown)
- A `⚠ X skipped:` block listing each skipped layer with its reason and Figma node name. Reasons include: "mixed styling", "font not loaded: <FontName>", "layer locked", "translation failed".
- `[ Translate more ]` button — clears the form, returns to the input screen. The previous selection persists (Figma's selection is unchanged), so the designer can immediately type a different language and translate again.

### 5.4 Empty / error states

- **No text layers selected:** "Select text layers to begin." (Empty state; happens at plugin open or when selection is cleared.)
- **Selection includes non-text:** non-text layers are silently ignored. The count reflects text layers only.
- **Proxy unreachable / network error:** "Couldn't reach CopyCat's translation service. Check your connection and try again."
- **Proxy returns 429 (rate limit hit):** "Daily translation limit reached. Try again tomorrow." (Should be very rare for the reviewer audience.)
- **Proxy returns 400 (too many layers):** "CopyCat can translate up to 50 layers at a time. Please select fewer and try again."
- **Anthropic returns an error / nonsense:** the entire batch goes into "skipped: translation failed". The designer can re-try.

## 6. Proxy behaviour, in detail

### 6.1 Request and response

```jsonc
// POST /api/translate
{
  "language": "French",
  "strings": [
    { "id": "1:2481", "text": "Create a voice clone of yourself from your phone" },
    { "id": "1:2482", "text": "Get a voice that sounds like you..." }
  ]
}

// 200 OK
{
  "translations": [
    { "id": "1:2481", "text": "Clonez votre voix depuis votre téléphone" },
    { "id": "1:2482", "text": "Obtenez une voix qui vous ressemble..." }
  ]
}

// 200 OK with partial skip (Claude couldn't translate a specific string)
{
  "translations": [{ "id": "1:2481", "text": "..." }],
  "skipped": [{ "id": "1:2482", "reason": "translation failed" }]
}
```

### 6.2 Anthropic call

- Model: `claude-haiku-4-5-20251001`.
- System prompt (sketch): "You are translating ad copy. The user will give you a JSON array of source strings and a target language. Return ONLY a JSON array with the same `id`s and translated `text`. Preserve tone (marketing/ad), formatting (capitalisation, punctuation), and any brand names. Do not add or remove strings."
- Uses tool-use with a `submit_translations` tool whose JSON Schema requires `{ translations: [{ id, text }] }` — forces structured output and prevents Claude from returning prose around the JSON.

### 6.3 Rate limiting

Global daily limit (500/day) and per-IP hourly limit (100/hr) implemented as an in-memory `Map` in the API route module.

**Honest limitation:** Vercel functions cold-start. When a cold instance spins up, the in-memory counter resets to zero. This means a sufficiently determined attacker could exceed the stated rate limits by triggering cold starts (e.g. spacing requests apart). For the actual audience (a handful of ElevenLabs reviewers) this risk is functionally zero — the limit's job is to prevent accidental runaway requests from a single reviewer's session, not to defeat a motivated attacker.

**The real cost backstop is the $50 hard cap set in the Anthropic console**, not the in-memory rate limit. The rate limit is the soft guard; the Anthropic cap is the hard one. If a bug or unexpected behaviour somehow burned through the rate limit, Anthropic itself stops billing at $50.

Upgrade path: if CopyCat ever needs to defend the rate limit hard, replace the in-memory `Map` with Vercel KV (the route stays otherwise identical). Out of scope for v1.

### 6.4 What gets retired from the existing codebase

These files in `~/Desktop/claude-work` are no longer needed and will be removed in implementation:

- `app/page.tsx` and `components/` — the entire web wizard.
- `app/api/figma/*` (frames, validate, nodes, image, export, update, clone) — Figma REST calls are gone.
- `lib/figma.ts` — REST client, no longer needed.

These are kept:
- `lib/types.ts` — text-node-related types stay useful.
- `lib/formatting.ts` — has utility logic that may be useful (e.g. wordmark detection if we ever bring back protected-node UI).
- `app/api/translate/route.ts` — rewritten with the new request/response shape, model, and rate limiting.

## 7. Repository layout

```
~/Desktop/claude-work/                    ← existing repo, repurposed
├── figma-plugin/                         ← NEW
│   ├── manifest.json                     ← Figma plugin manifest
│   ├── src/
│   │   ├── code.ts                       ← runs inside Figma sandbox
│   │   ├── ui/
│   │   │   ├── App.tsx                   ← root React component
│   │   │   ├── Panel.tsx                 ← input + button + status states
│   │   │   ├── styles.css                ← minimal styling
│   │   │   └── index.html                ← Vite entry
│   │   └── messages.ts                   ← typed message shapes between code.ts ↔ ui
│   ├── package.json
│   ├── vite.config.ts                    ← builds ui to single inline HTML
│   └── tsconfig.json
├── app/api/translate/route.ts            ← KEEP — rewritten as the proxy
├── lib/types.ts                          ← KEEP
├── lib/formatting.ts                     ← KEEP
├── README.md                             ← rewritten — install + invite-free use
└── docs/superpowers/specs/2026-06-11-copycat-figma-plugin-design.md  ← this file
```

## 8. README and distribution

The README is part of the deliverable. It should include:

1. **What CopyCat does** — one paragraph, one screenshot.
2. **Install** — step-by-step: clone the repo, `npm install`, `npm run build:plugin`, then in Figma: `Plugins → Development → Import plugin from manifest`, point at `figma-plugin/manifest.json`.
3. **Use** — three lines: select text layers, type a language, click Translate.
4. **How it works** — short architecture diagram (the one in §4 above).
5. **Design decisions worth calling out** — three bullets:
   - Why a Figma plugin and not a web app (Figma REST is read-only for text content).
   - Why Claude Haiku 4.5 (cost/quality balance for translation).
   - Why no per-user auth (audience is bounded; rate-limiting handles cost-guard).
6. **What I'd do in v2** — Figma Variables for native language switching, glossary support, translation memory.
7. **Cost & infrastructure note** — Anthropic calls go through Luke's personal account (not Intercom's), with a $50 hard cap and proxy-side rate limits.

## 9. Error handling and edge cases — summary table

| Scenario | Behaviour |
|---|---|
| Selection has 0 text layers | Empty state: "Select text layers to begin." |
| Selection has non-text + text nodes | Silently filter to text; show count of text layers only. |
| Text node has mixed styling | Skip; report on done screen: "mixed styling — edit manually". |
| Font not installed in Figma | Skip; report: "font not loaded: <FontName>". |
| Layer locked | Skip; report: "layer locked". |
| > 50 layers selected | UI catches this before sending: "Up to 50 layers at a time." |
| Network failure to proxy | Toast: "Couldn't reach CopyCat's translation service. Try again." |
| Proxy returns 429 | "Daily translation limit reached. Try again tomorrow." |
| Claude returns malformed JSON | Tool-use schema prevents this; if it still happens, surface as full-batch failure with retry. |
| Claude can't translate a specific string | Server includes it in `skipped` with reason "translation failed". |
| User clicks Translate while a previous request is in flight | Button disabled during in-flight; second click ignored. |

## 10. Testing approach

Pure-logic units that can be tested without Figma:
- The Claude prompt construction (given a language + strings, produce a request body).
- The Claude response parser (given a tool-use response, extract translations).
- The selection partitioner (given a list of Figma node descriptors, return translatable + skipped).

Manual testing:
- The Figma plugin itself: load it in Figma's dev-plugin mode, run through the user flows.
- Rate-limit boundaries: verify the proxy rejects requests past 50 layers.

## 11. What's deferred to v2

These are listed so the README can credibly describe a roadmap, not because they need building now:

- **Figma Variables / mode-based language switching.** Set up a Variable per text node; populate values across language modes; designer toggles the file between EN/FR/ES without re-running anything.
- **Multi-language batch.** Type "French, Spanish, German" → plugin creates the same translations for all three languages in one Claude call (cheaper) and applies them as duplicated artboards.
- **Translation memory.** Re-running on the same string returns the previously-confirmed translation (with override option).
- **Brand glossary.** Designer (or Luke) maintains a list of "ElevenLabs" → "ElevenLabs" (don't translate), "voice clone" → "clone vocal" (use this French specifically).
- **Source/translation review table.** If reviewer feedback says "I want to see the result before applying," add this back as a togglable preview step.
- **Auth.** If the tool ever ships beyond the assessment audience, layer per-user invite codes or OAuth on top of the existing proxy.

---

**Approval status:** brainstorming complete, awaiting Luke's final read on this doc before moving to the implementation plan.
