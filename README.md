# Lingo

> Automated Figma ad localisation for ElevenLabs.
> Translate static ads into any language while preserving the original design — powered by the Figma REST API and Anthropic Claude.

Lingo is an internal tool that takes a Figma artboard, extracts every text node, translates the non-protected nodes through Claude with ElevenLabs brand context, auto-fits the new copy back into the original bounding boxes, and exports the localised artboard via the Figma image API.

## Features

- **Figma URL → Artboard picker** — paste a file URL, get a searchable list of every frame in the file.
- **Smart text extraction** — every text node is sorted into **Protected** (anything containing "ElevenLabs") and **Translating** (everything else). One-click move between buckets.
- **Brand-aware translation** — Claude is given the ElevenLabs brand voice rubric and instructions to preserve numbers, punctuation, ALL CAPS, and avoid forced line breaks.
- **Searchable language picker** — 70+ languages with regional variants (Portuguese (Brazil) vs (Portugal), Spanish (LatAm) vs (Spain), etc.). Hard warning when an RTL language is selected.
- **Auto-formatting pipeline** —
  - Proportional font-size shrink/grow to fit the original bounding box.
  - 8px minimum-font-size threshold → red flag for manual intervention.
  - Y-position recentre to preserve the visual centre after scaling.
  - 20px proximity check between text nodes → amber overlap warning.
  - Auto-resize text nodes detected and skipped (translation written, flagged for review).
  - Source-font script coverage check → automatic Noto Sans fallback with amber flag.
- **Per-node tweak controls** — 1px Y nudges, 1pt size nudges, per-node undo, live thumbnail preview after each sync.
- **Export** — PNG/JPEG at 1x / 2x / 3x via the Figma image API, with smart filenames (`<artboard>_<lang>.<ext>`).
- **Run summary** — counts of auto-formatted, manually-adjusted, and flagged nodes.

## Quick start

```bash
# 1. Install dependencies
npm install

# 2. Configure environment variables
cp .env.example .env.local
# then edit .env.local and fill in:
#   FIGMA_ACCESS_TOKEN   — https://www.figma.com/developers/api#access-tokens
#   ANTHROPIC_API_KEY    — https://console.anthropic.com/settings/keys

# 3. Run the dev server
npm run dev
# → open http://localhost:3000
```

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `FIGMA_ACCESS_TOKEN` | yes | Personal access token. Needs `file_read`. The push-to-Figma step also needs `file_dev_resources:write` / `file_content:write` on workspaces that have it enabled. |
| `ANTHROPIC_API_KEY` | yes | Claude API key for translation. |
| `ANTHROPIC_MODEL` | no | Defaults to `claude-opus-4-7`. |

All variables are **server-only** — they are read inside `app/api/*` route handlers and are never sent to the browser.

## Deploy to Vercel

```bash
# from the project root
vercel deploy
```

Then add the env vars in the Vercel dashboard (Project → Settings → Environment Variables) **or** via the CLI:

```bash
vercel env add FIGMA_ACCESS_TOKEN
vercel env add ANTHROPIC_API_KEY
vercel env pull        # pulls remote env into .env.local for next dev run
```

For production:

```bash
vercel deploy --prod
```

The project uses Vercel's default Next.js detection — no `vercel.json` required. A typed `vercel.ts` is included for future configuration (cron jobs, headers, etc.).

## How it works

```
URL  ─►  /api/figma/frames      list FRAME / COMPONENT nodes
ID   ─►  /api/figma/nodes       walk text nodes, sort Protected vs Translating
text ─►  /api/translate         Claude — batched, brand-aware
out  ─►  lib/formatting.ts      client-side: font fit, recentre Y, overlap detect
sync ─►  /api/figma/update      PATCH text nodes (degrades to "staged" if unsupported)
PNG  ─►  /api/figma/export      Figma image API → presigned URL → browser download
```

### A note on Figma writes

Figma's public REST API is read-heavy. Lingo calls the file/node read endpoints and the image export endpoint (both well-supported), and attempts a `PATCH /v1/files/:key/nodes` for text-node writes. **If your workspace doesn't have write access through REST**, Lingo will surface a notice and stage the translation payload locally — you can still tweak in the UI and export via the image API, but the source file won't be mutated. For full read/write parity, pair Lingo with a thin Figma plugin that consumes the same JSON payload shape that `/api/figma/update` posts.

### Font-fit math

We can't measure actual rendered glyph widths from a Node server, so Lingo uses a script-aware heuristic (Latin ≈ 0.52em, CJK ≈ 1.0em, Arabic ≈ 0.55em, etc.) tuned against common UI sans-serifs (Inter, GT America, SF Pro). The math is in `lib/formatting.ts` and is intentionally conservative — the per-node nudge controls exist to let a human fine-tune anything the heuristic gets wrong. ElevenLabs's custom display face is listed as latin-only in `lib/fonts.ts`, so it will trigger a Noto Sans fallback when targeting non-Latin scripts.

## Project layout

```
app/
  layout.tsx                root shell + dark theme
  page.tsx                  orchestrator client component (full state machine)
  globals.css               Tailwind + design tokens
  api/
    figma/validate/         GET — token healthcheck
    figma/frames/           POST — list frames in file
    figma/nodes/            POST — extract text nodes from a frame
    figma/image/            POST — fetch a single image URL
    figma/export/           POST — PNG/JPEG export with smart filename
    figma/update/           POST — push text + font + position updates
    figma/clone/            POST — clone-stub helper (see Figma-writes note)
    translate/              POST — batch translate via Claude
    languages/              GET  — searchable language catalogue
components/
  Header.tsx                wordmark + token status indicator
  Footer.tsx                future-development note
  StepIndicator.tsx         7-step horizontal breadcrumb
  FileInput.tsx             step 1 — paste URL
  FrameSelector.tsx         step 2 — pick artboard
  NodeReview.tsx            step 3 — Protected / Translating buckets
  LanguagePicker.tsx        step 4 — searchable language input + RTL warning
  TranslationReview.tsx     step 5 — review + inline edit translations
  TweakPanel.tsx            step 6 — per-node nudge controls + live preview
  ExportPanel.tsx           step 7 — format/scale picker + summary
lib/
  types.ts                  shared types (Frame, TextNode, FormattedNode, ...)
  figma.ts                  Figma REST client + URL parser + node walker
  anthropic.ts              Claude batch translation + brand prompt
  languages.ts              language catalogue + search ranker + isRTL()
  fonts.ts                  font-script-coverage detector + Noto fallback rules
  formatting.ts             font-fit, recentre-Y, overlap detection, ALL-CAPS
vercel.ts                   typed Vercel config (optional)
```

## Scripts

```bash
npm run dev        # dev server at http://localhost:3000
npm run build      # production build
npm run start      # production server (after build)
npm run typecheck  # tsc --noEmit
npm run lint       # next lint
```

## Roadmap

Per the footer of the app:

- Automatic layout reformatting across aspect ratios (1:1 → 4:5 → 16:9).
- Saved language preferences per project.
- Job history with diffs against the source artboard.
- Simultaneous multi-language processing (one Figma file → N localised exports in a single run).

## License

Internal tool. Not for redistribution.
