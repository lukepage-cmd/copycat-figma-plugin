# Lingo

A Figma plugin that translates selected text layers into any language via Claude. In-place. One click after selection.

Built as a take-home exercise for the ElevenLabs design team.

## What it does

1. Select text layers in Figma (cmd-click to add multiple).
2. Open `Plugins → Lingo`.
3. Type a target language ("French", "Brazilian Portuguese", "informal Japanese").
4. Click **Translate**.

The text changes in place. Cmd-Z reverts it. To translate to a different language, type a new one and click Translate again — the previous selection is preserved.

## Architecture

```
   FIGMA                                          VERCEL
   ┌──────────────────────────┐                  ┌──────────────────────────┐
   │  Lingo plugin            │                  │  /api/translate          │
   │   - code.ts (sandbox)    │                  │   - in-memory rate limit │
   │   - React UI panel       │  ──POST JSON──►  │   - max 50 layers/req    │
   │                          │  ◄──JSON array── │   - Claude Haiku 4.5     │
   │   reads + writes text    │                  │   - tool-use for shape   │
   │   via Plugin API         │                  │                          │
   └──────────────────────────┘                  └──────────────────────────┘
```

Two components, one network call per translation request. No database. No persistent storage. No Figma access tokens — the plugin runs inside Figma's sandbox and has native file access.

## Install (development plugin)

**Prerequisites:** Node 20+, Figma desktop app, an Anthropic API key.

```bash
git clone <this-repo>
cd lingo
npm install
cd figma-plugin && npm install && npm run build && cd ..

cp .env.example .env.local
# edit .env.local — set ANTHROPIC_API_KEY to your personal Anthropic key

npm run dev   # starts the translation proxy on localhost:3000
```

In Figma:

1. Open Figma desktop.
2. `Menu → Plugins → Development → Import plugin from manifest…`
3. Pick `figma-plugin/manifest.json` from this repo.
4. Run via `Menu → Plugins → Development → Lingo`.

For a Vercel-hosted version, deploy with `npx vercel` and update `PROXY_URL` in `figma-plugin/src/ui/App.tsx` to point at the deployment, then rebuild the plugin.

## Design decisions worth knowing

- **Why a Figma plugin and not a web app.** The original prototype was a Next.js wizard that called Figma's REST API. It worked beautifully for *reading* a Figma file, but Figma's REST API is read-only for text content. A web app cannot write translations back into a Figma file. The first round of design tried to render translated images client-side over the source PNG, but that approach degrades the moment artwork changes. A Figma plugin sidesteps the limit entirely — it runs in Figma's sandbox with full read/write access. Plugin-only became the design once that became clear.

- **Why Claude Haiku 4.5 instead of Sonnet or Opus.** Translation of ad copy is a bounded task. Haiku 4.5 handles it well at roughly $0.002 per ad — about a fifth of Sonnet, about a twentieth of Opus. The model is overridable via `ANTHROPIC_MODEL` if needed.

- **Why no per-user authentication.** The audience is a small known reviewer group. Per-user codes would add setup friction with no security benefit at this scale. The proxy uses in-memory rate limits (500 requests/day global, 100/hour per IP) and a hard cap configured in the Anthropic console as the real cost backstop. The trade-off is described honestly in `docs/superpowers/specs/2026-06-11-lingo-figma-plugin-design.md` §6.3.

- **Why no in-plugin review table.** The plugin panel is ~400px wide; the Figma canvas is 1080px+. Reviewing translations visually on the canvas is strictly better than reviewing them in a sidebar. The plugin reports counts and lists any skipped layers (font missing, layer locked, mixed styling); visual review happens in Figma itself. Cmd-Z is the safety net.

- **Why batch all selected layers into one Claude call.** A single batched call is faster, cheaper, and gives Claude visibility across the whole set — so a headline and CTA in the same ad get translated with consistent tone, not independently. The proxy enforces a 50-layer cap per request to keep latency reasonable.

- **Personal Anthropic account.** Calls go through my personal Anthropic account (set via `ANTHROPIC_API_KEY` locally). I deliberately didn't use my employer's key for this assessment — interview work shouldn't mix with employer resources.

## What's deferred to v2

- **Figma Variables / mode-based language switching.** A single file with one EN/FR/ES toggle instead of separate artboards per language. This is the more "professional localization tool" architecture; v1 is the "smart-replace" version.
- **Multi-language batch.** Type "French, Spanish, German" and produce three duplicates in one run.
- **Brand glossary.** Fixed translations for known terms ("voice clone" → curated French phrase).
- **Translation memory.** Re-running on the same string returns the previously-confirmed translation with override option.

## Repository layout

```
.
├── app/                              ← Next.js app (proxy only)
│   ├── api/translate/route.ts        ← the Claude proxy
│   ├── layout.tsx                    ← minimal layout
│   └── page.tsx                      ← "this is a proxy" landing page
├── lib/
│   ├── anthropic.ts                  ← Claude client (Haiku 4.5, tool-use)
│   ├── rate-limit.ts                 ← in-memory rate limiter
│   ├── translate-types.ts            ← request/response shapes
│   └── *.test.ts                     ← vitest unit tests
├── figma-plugin/                     ← the plugin
│   ├── manifest.json
│   ├── src/
│   │   ├── code.ts                   ← runs in Figma sandbox
│   │   ├── messages.ts               ← typed messages between sandbox ↔ UI
│   │   ├── partition.ts              ← selection partitioner (unit-tested)
│   │   └── ui/                       ← React UI (App.tsx + styles)
│   └── dist/                         ← build output (gitignored)
└── docs/
    └── superpowers/
        ├── specs/2026-06-11-lingo-figma-plugin-design.md
        └── plans/2026-06-11-lingo-figma-plugin.md
```

## Scripts

```bash
npm run dev               # run the proxy locally
npm test                  # vitest unit tests (rate limit, Claude client, partitioner)
npm run typecheck         # tsc on the proxy
npm run build:plugin      # build the Figma plugin
cd figma-plugin && npm run build       # same, from the plugin folder
cd figma-plugin && npm run typecheck   # tsc on the plugin
```

## Author

Luke Page.
