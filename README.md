# CopyCat

A Figma plugin that translates selected text layers into any language via Claude. In-place. One click after selection.

Built as a take-home exercise for the ElevenLabs design team.

## What it does

1. Select text layers in Figma (cmd-click to add multiple).
2. Open `Plugins → CopyCat`.
3. Type a target language ("French", "Brazilian Portuguese", "informal Japanese").
4. Click **Translate**.

The text changes in place. Cmd-Z reverts it. To translate to a different language, type a new one and click Translate again — the previous selection is preserved.

## Architecture

```
   FIGMA                                          VERCEL
   ┌──────────────────────────┐                  ┌──────────────────────────┐
   │  CopyCat plugin            │                  │  /api/translate          │
   │   - code.ts (sandbox)    │                  │   - in-memory rate limit │
   │   - React UI panel       │  ──POST JSON──►  │   - max 50 layers/req    │
   │                          │  ◄──JSON array── │   - Claude Haiku 4.5     │
   │   reads + writes text    │                  │   - tool-use for shape   │
   │   via Plugin API         │                  │                          │
   └──────────────────────────┘                  └──────────────────────────┘
```

Two components, one network call per translation request. No database. No persistent storage. No Figma access tokens — the plugin runs inside Figma's sandbox and has native file access.

## Install — recommended (30 seconds, no command line)

The plugin is published as a downloadable zip under [Releases](https://github.com/lukepage-cmd/copycat-figma-plugin/releases). It points at a hosted translation proxy (https://claude-work-blush.vercel.app/api/translate), so reviewers don't need to run anything locally.

1. Download [`copycat-figma-plugin-v0.1.0.zip`](https://github.com/lukepage-cmd/copycat-figma-plugin/releases/latest) from the latest release.
2. Unzip it anywhere on your machine.
3. Open Figma desktop. (Plugin development isn't supported in the browser version.)
4. Open the **Plugins & widgets** panel — bottom-right toolbar icon, or `Cmd+Alt+P`.
5. Switch the dropdown on the right to **Development**.
6. Click **Import from manifest…** and pick `copycat-figma-plugin/manifest.json` from the unzipped folder.
7. Run via `Plugins & widgets → Development → CopyCat`.

## Install — from source (for code review)

If you'd rather build from the source:

**Prerequisites:** Node 20+, Figma desktop, optionally an Anthropic API key (only if you want to run the proxy locally instead of the hosted one).

```bash
git clone https://github.com/lukepage-cmd/copycat-figma-plugin
cd copycat-figma-plugin
npm install
cd figma-plugin && npm install && npm run build && cd ..
```

Then `Plugins → Development → Import plugin from manifest…` and pick `figma-plugin/manifest.json`. Built-in source already points at the hosted proxy.

To run the proxy yourself locally instead:

```bash
cp .env.example .env.local
# edit .env.local — set ANTHROPIC_API_KEY to your personal Anthropic key
npm run dev   # starts the proxy on localhost:3000
```

Then edit `PROXY_URL` in `figma-plugin/src/ui/App.tsx` to `http://localhost:3000/api/translate` and rebuild the plugin.

For a Vercel-hosted version, deploy with `npx vercel` and update `PROXY_URL` in `figma-plugin/src/ui/App.tsx` to point at the deployment, then rebuild the plugin.

## Design decisions worth knowing

- **Why a Figma plugin and not a web app.** The original prototype was a Next.js wizard that called Figma's REST API. It worked beautifully for *reading* a Figma file, but Figma's REST API is read-only for text content. A web app cannot write translations back into a Figma file. The first round of design tried to render translated images client-side over the source PNG, but that approach degrades the moment artwork changes. A Figma plugin sidesteps the limit entirely — it runs in Figma's sandbox with full read/write access. Plugin-only became the design once that became clear.

- **Why Claude Haiku 4.5 instead of Sonnet or Opus.** Translation of ad copy is a bounded task. Haiku 4.5 handles it well at roughly $0.002 per ad — about a fifth of Sonnet, about a twentieth of Opus. The model is overridable via `ANTHROPIC_MODEL` if needed.

- **Why no per-user authentication.** The audience is a small known reviewer group. Per-user codes would add setup friction with no security benefit at this scale. The proxy uses in-memory rate limits (500 requests/day global, 100/hour per IP) and a hard cap configured in the Anthropic console as the real cost backstop. The trade-off is described honestly in `docs/superpowers/specs/2026-06-11-copycat-figma-plugin-design.md` §6.3.

- **Why no in-plugin review table.** The plugin panel is ~400px wide; the Figma canvas is 1080px+. Reviewing translations visually on the canvas is strictly better than reviewing them in a sidebar. The plugin reports counts and lists any skipped layers (font missing, layer locked, mixed styling); visual review happens in Figma itself. Cmd-Z is the safety net.

- **Why batch all selected layers into one Claude call.** A single batched call is faster, cheaper, and gives Claude visibility across the whole set — so a headline and CTA in the same ad get translated with consistent tone, not independently. The proxy enforces a 50-layer cap per request to keep latency reasonable.

- **Personal Anthropic account.** Calls go through my personal Anthropic account (set via `ANTHROPIC_API_KEY` locally). I deliberately didn't use my employer's key for this assessment — interview work shouldn't mix with employer resources.

## Usage caveats

When you use CopyCat for the first time, these are the small frictions worth knowing up-front.

### Multi-select behaviour

- **Multi-select translates layers as a *visual group*.** All selected layers scale together so they remain visually consistent (e.g. three bullet items all shrink by the same proportion, not independently).
- **Multi-select works best when the selected layers have similar font sizes.** A row of bullets, a paragraph of body copy, a set of equal-weight headings — these are siblings. The plugin clusters them automatically (layers within ~15% of each other's font size go in one bucket).
- **For *mixed* font sizes (e.g. title + tagline), translate one layer at a time.** The clustering algorithm tries to handle mixed sizes by grouping similar-size layers separately, but for crisp results on a hierarchy, individual translation is best.

### Manual touch-ups will sometimes be needed

- **Box dimensions are sacred; font flexes.** The plugin will never grow a text box (that would cascade-shift surrounding layout). If a translation truly needs more space than the original box allows, the font shrinks. Designer reviews and decides whether to widen the box manually.
- **Tight source boxes + expansion-heavy languages produce visibly small font.** A trust badge sized to 3 lines of English ("TRUSTED BY 1M+ LEADING CREATORS AND ENTERPRISES") becomes 4-5 lines in French ("DE CONFIANCE POUR PLUS DE 1M..."). To fit inside the original box height, the font shrinks ~40% (e.g. 14pt → 8.4pt). Legible but tight. *Designer fix in Figma: widen the badge, or accept the smaller font.*
- **Button labels with tight hug-content boxes face the same issue.** A "Continue" button sized exactly to the English word's width can't accommodate "Continuer" at the same font size. Result: small font (sometimes hitting the absolute floor at ~9.6pt). *Designer fix: widen the button, or use a shorter translation like "Suivant" or "OK".*

### Auto-layout containers

- **Translated layers inside an auto-layout frame are hard to nudge manually** — Figma's auto-layout repositions children automatically. Two ways to fine-tune:
  - Right-click the layer → **"Set position to absolute"** to free it from the auto-layout, then drag freely.
  - Or adjust the *parent* auto-layout's gap/spacing for consistent results across all your localised artboards.

### Font availability

- **Brand fonts not installed on your machine are flagged and skipped** rather than substituted. The done screen tells you which layers were skipped and why. Install the brand font (or temporarily change to a system font) before re-running for those layers.

### Multi-translation workflow on the same layer

- **Each translation uses the layer's *current* text as the source.** To translate the same English layer into multiple languages, **cmd-Z back to English between cycles**, or duplicate the layer per language. (A v2 feature would persist the original source text in metadata to eliminate this.)

### Style register (formality)

- **CopyCat translates in the *informal* register by default** (French *tu*, German *du*, Spanish *tú*, Italian *tu*) — the modern consumer-tech brand voice. If your campaign needs *formal* register, edit the translated text manually after the plugin completes its run.

### Reproducibility

- **The same English source + same target language = the same translation, every run.** The plugin pins `temperature: 0` so Claude's output is deterministic.
- **Mixed-styling text nodes are skipped.** A text node with bold-in-the-middle would lose styling on a single `node.characters = ...` write. Preserving styled segments via `setRangeFills` etc. is a real feature, deferred to v2.

## What's deferred to v2

- **Transcreation mode for tight slot text.** For buttons, badges, and other compact UI elements, ask Claude for the *shortest equivalent* rather than the most literal translation. "Continue" → "OK" / "Suivant" instead of "Continuer"; "TRUSTED BY 1M+ LEADING CREATORS AND ENTERPRISES" → "1M+ CRÉATEURS DE CONFIANCE" instead of the full literal. This is what professional localizers actually do (it has a name: *transcreation*). The plugin would detect short + tight + ALL CAPS as a signal and pass a "brevity mode" flag to the proxy, which uses a different prompt asking for compact equivalents.
- **Figma Variables / mode-based language switching.** A single file with one EN/FR/ES toggle instead of separate artboards per language. This is the more "professional localization tool" architecture; v1 is the "smart-replace" version.
- **Multi-language batch.** Type "French, Spanish, German" and produce three duplicates in one run.
- **Brand glossary.** Fixed translations for known terms ("voice clone" → curated French phrase).
- **Translation memory.** Re-running on the same string returns the previously-confirmed translation with override option.
- **Persisted original source text.** Eliminate multi-translation drift by storing the *first translation*'s source text in pluginData and always retranslating from there.

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
        ├── specs/2026-06-11-copycat-figma-plugin-design.md
        └── plans/2026-06-11-copycat-figma-plugin.md
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
