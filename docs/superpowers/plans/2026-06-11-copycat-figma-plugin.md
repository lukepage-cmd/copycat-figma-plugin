# CopyCat Figma Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Figma plugin that translates selected text layers in-place using Claude, paired with a rate-limited Vercel proxy that holds the Anthropic API key.

**Architecture:** Two-component product. (1) A Figma plugin (`figma-plugin/`) with a sandbox script `code.ts` that uses Figma's Plugin API to read selection and write text, plus a React UI bundled by Vite. (2) A Vercel Next.js route `app/api/translate` that batches all selected strings into a single Claude Haiku 4.5 call using tool-use for structured output, with in-memory rate limiting.

**Tech Stack:** TypeScript, React 18, Vite, esbuild, Next.js 14 (Vercel), Anthropic SDK, Vitest, Figma Plugin API.

---

## File map

**New files (figma plugin):**
- `figma-plugin/manifest.json` — Figma plugin metadata
- `figma-plugin/package.json` — plugin build scripts
- `figma-plugin/tsconfig.json` — TypeScript config
- `figma-plugin/vite.config.ts` — Vite bundles the UI to a single HTML
- `figma-plugin/src/code.ts` — runs in Figma sandbox
- `figma-plugin/src/messages.ts` — typed messages between code.ts ↔ UI
- `figma-plugin/src/partition.ts` — selection partitioner (pure logic, unit-tested)
- `figma-plugin/src/partition.test.ts` — partition tests
- `figma-plugin/src/ui/index.html` — Vite entry HTML
- `figma-plugin/src/ui/main.tsx` — React entry
- `figma-plugin/src/ui/App.tsx` — root component (state machine)
- `figma-plugin/src/ui/styles.css` — minimal styles

**Rewritten files (proxy):**
- `app/api/translate/route.ts` — new request/response shape, rate limit, 50-layer cap
- `lib/anthropic.ts` — rewritten as `translate(language, strings)` using tool-use, Haiku 4.5
- `lib/translate-types.ts` — `TranslateRequest`/`TranslateResponse` shapes
- `lib/rate-limit.ts` — in-memory daily + per-IP hourly limiter
- `lib/rate-limit.test.ts` — rate-limit tests
- `lib/anthropic.test.ts` — Claude client tests (parsing only — mocked SDK)
- `.env.example` — drop FIGMA_ACCESS_TOKEN; default model becomes Haiku
- `README.md` — install + usage + design-decision notes

**Files retired (deleted):**
- `app/page.tsx`
- `components/` (entire directory)
- `app/api/figma/` (entire directory)
- `app/api/languages/route.ts`
- `lib/figma.ts`
- `lib/fonts.ts`
- `lib/languages.ts`
- Most of `lib/formatting.ts` (keep only `isAllCaps`)
- Most of `lib/types.ts` (delete all REST-related types; keep nothing — the plugin uses Figma's own types)
- `vercel.ts`

---

## Task 1: Project hygiene — install Vitest, retire old code, init git

**Files:**
- Modify: `package.json`
- Delete: `app/page.tsx`, `components/`, `app/api/figma/`, `app/api/languages/`, `lib/figma.ts`, `lib/fonts.ts`, `lib/languages.ts`, `lib/types.ts`, `vercel.ts`
- Create: `.gitignore` additions if needed

- [ ] **Step 1: Install Vitest as a dev dependency**

```bash
cd ~/Desktop/claude-work
npm install -D vitest @types/node
```

Expected: vitest appears in `package.json` devDependencies.

- [ ] **Step 2: Add test/build scripts to package.json**

In `package.json`, modify the `"scripts"` block to:

```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "next lint",
  "typecheck": "tsc --noEmit",
  "test": "vitest run",
  "test:watch": "vitest",
  "build:plugin": "cd figma-plugin && npm run build"
}
```

- [ ] **Step 3: Delete retired Next.js web-app files**

```bash
cd ~/Desktop/claude-work
rm -rf app/page.tsx components/ app/api/figma app/api/languages
rm lib/figma.ts lib/fonts.ts lib/languages.ts lib/types.ts lib/formatting.ts vercel.ts
```

Expected: those paths no longer exist. (All-caps preservation, which `isAllCaps` previously enforced client-side, is now Claude's job — handled via the system prompt rule in Task 4. REST types in `types.ts` are no longer referenced since the plugin uses Figma's native types.)

- [ ] **Step 4: Update .gitignore for the new plugin folder**

Append to `.gitignore`:

```
# Figma plugin build artifacts
figma-plugin/dist/
figma-plugin/node_modules/
```

- [ ] **Step 5: Replace app/layout.tsx with a minimal layout**

Since `app/page.tsx` was deleted, the layout is now serving nothing. Replace with a tiny "this is the CopyCat translation proxy" placeholder:

```tsx
// app/layout.tsx
export const metadata = { title: 'CopyCat Proxy' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui', padding: 24, color: '#222' }}>
        {children}
      </body>
    </html>
  );
}
```

And create a tiny `app/page.tsx`:

```tsx
// app/page.tsx
export default function Page() {
  return (
    <main>
      <h1>CopyCat Translation Proxy</h1>
      <p>This service powers the CopyCat Figma plugin. The translation API lives at <code>/api/translate</code>.</p>
    </main>
  );
}
```

- [ ] **Step 6: Initialise git and make a baseline commit**

```bash
cd ~/Desktop/claude-work
git init
git add -A
git commit -m "chore: retire web-app scaffolding before plugin rewrite"
```

Expected: clean commit, working tree empty afterwards.

- [ ] **Step 7: Verify typecheck still passes**

```bash
npm run typecheck
```

Expected: no errors. If errors reference deleted files, fix the dangling imports.

---

## Task 2: Define the proxy's request/response types

**Files:**
- Create: `lib/translate-types.ts`

- [ ] **Step 1: Write the types file**

```ts
// lib/translate-types.ts
export type TranslateRequest = {
  language: string;
  strings: { id: string; text: string }[];
};

export type TranslateResponse = {
  translations: { id: string; text: string }[];
  skipped?: { id: string; reason: string }[];
};

export type TranslateError = {
  error: string;
};
```

- [ ] **Step 2: Commit**

```bash
git add lib/translate-types.ts
git commit -m "feat: add translate request/response types"
```

---

## Task 3: Build the rate limiter (TDD)

**Files:**
- Create: `lib/rate-limit.ts`
- Test: `lib/rate-limit.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// lib/rate-limit.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { checkRateLimit, _resetRateLimit } from './rate-limit';

describe('checkRateLimit', () => {
  beforeEach(() => _resetRateLimit());

  it('allows the first request from a new IP', () => {
    const r = checkRateLimit('1.2.3.4', 1000);
    expect(r.ok).toBe(true);
  });

  it('blocks a per-IP request after 100 in one hour', () => {
    for (let i = 0; i < 100; i++) checkRateLimit('1.2.3.4', 1000);
    const r = checkRateLimit('1.2.3.4', 1000);
    expect(r).toEqual({ ok: false, reason: 'per-ip' });
  });

  it('resets the per-IP counter after one hour', () => {
    for (let i = 0; i < 100; i++) checkRateLimit('1.2.3.4', 1000);
    const HOUR = 60 * 60 * 1000;
    const r = checkRateLimit('1.2.3.4', 1000 + HOUR + 1);
    expect(r.ok).toBe(true);
  });

  it('blocks the global daily request after 500 across all IPs', () => {
    for (let i = 0; i < 500; i++) {
      checkRateLimit(`ip-${i}`, 1000);
    }
    const r = checkRateLimit('new-ip', 1000);
    expect(r).toEqual({ ok: false, reason: 'global' });
  });

  it('treats per-IP and global as independent counters', () => {
    // 99 from one IP — should still be allowed
    for (let i = 0; i < 99; i++) checkRateLimit('1.2.3.4', 1000);
    // Different IP, single request — should also be allowed
    const r = checkRateLimit('5.6.7.8', 1000);
    expect(r.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests and verify they fail**

```bash
npm test -- lib/rate-limit.test.ts
```

Expected: FAIL — `rate-limit.ts` doesn't exist yet.

- [ ] **Step 3: Implement the rate limiter**

```ts
// lib/rate-limit.ts
type Bucket = { count: number; resetAt: number };

const DAILY_MS = 24 * 60 * 60 * 1000;
const HOURLY_MS = 60 * 60 * 1000;
const GLOBAL_DAILY_LIMIT = 500;
const PER_IP_HOURLY_LIMIT = 100;

const globalBucket: Bucket = { count: 0, resetAt: 0 };
const ipBuckets = new Map<string, Bucket>();

export type RateLimitResult =
  | { ok: true }
  | { ok: false; reason: 'global' | 'per-ip' };

export function checkRateLimit(ip: string, now: number = Date.now()): RateLimitResult {
  // Roll over global bucket if expired.
  if (globalBucket.resetAt <= now) {
    globalBucket.count = 0;
    globalBucket.resetAt = now + DAILY_MS;
  }
  if (globalBucket.count >= GLOBAL_DAILY_LIMIT) {
    return { ok: false, reason: 'global' };
  }

  // Roll over per-IP bucket if expired.
  const ipBucket = ipBuckets.get(ip);
  if (!ipBucket || ipBucket.resetAt <= now) {
    ipBuckets.set(ip, { count: 1, resetAt: now + HOURLY_MS });
  } else {
    if (ipBucket.count >= PER_IP_HOURLY_LIMIT) {
      return { ok: false, reason: 'per-ip' };
    }
    ipBucket.count += 1;
  }

  globalBucket.count += 1;
  return { ok: true };
}

/** Test-only: reset all in-memory state. */
export function _resetRateLimit(): void {
  globalBucket.count = 0;
  globalBucket.resetAt = 0;
  ipBuckets.clear();
}
```

- [ ] **Step 4: Run tests and verify they pass**

```bash
npm test -- lib/rate-limit.test.ts
```

Expected: PASS (all 5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/rate-limit.ts lib/rate-limit.test.ts
git commit -m "feat: add in-memory rate limiter with global+per-IP buckets"
```

---

## Task 4: Rewrite the Claude client (TDD for parsing)

**Files:**
- Modify: `lib/anthropic.ts` (rewrite entirely)
- Test: `lib/anthropic.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// lib/anthropic.test.ts
import { describe, it, expect, vi } from 'vitest';
import { translate } from './anthropic';

describe('translate', () => {
  it('returns translations from a tool_use response', async () => {
    const fakeClient = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{
            type: 'tool_use',
            name: 'submit_translations',
            input: {
              translations: [
                { id: 'a', text: 'Bonjour' },
                { id: 'b', text: 'Monde' },
              ],
            },
          }],
        }),
      },
    };

    const result = await translate(
      'French',
      [{ id: 'a', text: 'Hello' }, { id: 'b', text: 'World' }],
      fakeClient as never,
    );

    expect(result.translations).toEqual([
      { id: 'a', text: 'Bonjour' },
      { id: 'b', text: 'Monde' },
    ]);
    expect(result.skipped).toEqual([]);
  });

  it('marks strings as skipped if Claude omits their id', async () => {
    const fakeClient = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{
            type: 'tool_use',
            name: 'submit_translations',
            input: { translations: [{ id: 'a', text: 'Bonjour' }] },
          }],
        }),
      },
    };

    const result = await translate(
      'French',
      [{ id: 'a', text: 'Hello' }, { id: 'b', text: 'World' }],
      fakeClient as never,
    );

    expect(result.translations).toEqual([{ id: 'a', text: 'Bonjour' }]);
    expect(result.skipped).toEqual([{ id: 'b', reason: 'translation failed' }]);
  });

  it('skips everything if there is no tool_use block', async () => {
    const fakeClient = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: 'text', text: 'I refuse to translate.' }],
        }),
      },
    };

    const result = await translate(
      'French',
      [{ id: 'a', text: 'Hello' }],
      fakeClient as never,
    );

    expect(result.translations).toEqual([]);
    expect(result.skipped).toEqual([{ id: 'a', reason: 'translation failed' }]);
  });
});
```

- [ ] **Step 2: Run tests and verify they fail**

```bash
npm test -- lib/anthropic.test.ts
```

Expected: FAIL — `translate` does not yet match the new signature.

- [ ] **Step 3: Rewrite lib/anthropic.ts**

Replace the entire file contents with:

```ts
// lib/anthropic.ts
import Anthropic from '@anthropic-ai/sdk';

const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';

let cached: Anthropic | null = null;
function defaultClient(): Anthropic {
  if (cached) return cached;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured.');
  cached = new Anthropic({ apiKey });
  return cached;
}

const BRAND_CONTEXT =
  'ElevenLabs brand tone: confident, clean, direct, tech-forward, creator-focused. ' +
  'Avoid formal or corporate language. Keep translations punchy and natural in the ' +
  'target language — never literal.';

type Input = { id: string; text: string };
type Output = { translations: Input[]; skipped: { id: string; reason: string }[] };

export async function translate(
  language: string,
  strings: Input[],
  client: Anthropic = defaultClient(),
): Promise<Output> {
  if (strings.length === 0) return { translations: [], skipped: [] };

  const response = await client.messages.create({
    model: DEFAULT_MODEL,
    max_tokens: 4096,
    system: [
      BRAND_CONTEXT,
      '',
      `You translate ad copy into ${language}.`,
      'Rules:',
      '- Translate only the value of each "text" field; never the "id".',
      '- Preserve numbers, punctuation, currency symbols, and brand names.',
      '- Match the source\'s capitalisation style (ALL CAPS stays ALL CAPS).',
      '- Keep the tone punchy and natural; favour idiomatic over literal.',
      '- Do NOT add line breaks; layout handles reflow.',
      '- Return every input id. If you cannot translate one, omit it.',
    ].join('\n'),
    tools: [{
      name: 'submit_translations',
      description: 'Return the translated strings for each input id.',
      input_schema: {
        type: 'object',
        properties: {
          translations: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                text: { type: 'string' },
              },
              required: ['id', 'text'],
            },
          },
        },
        required: ['translations'],
      },
    }],
    tool_choice: { type: 'tool', name: 'submit_translations' },
    messages: [{
      role: 'user',
      content: `Translate to ${language}:\n\n${JSON.stringify(strings, null, 2)}`,
    }],
  });

  const toolUse = response.content.find((c) => c.type === 'tool_use');
  if (!toolUse || toolUse.type !== 'tool_use') {
    return {
      translations: [],
      skipped: strings.map((s) => ({ id: s.id, reason: 'translation failed' })),
    };
  }

  const input = toolUse.input as { translations: Input[] };
  const returnedIds = new Set(input.translations.map((t) => t.id));
  const skipped = strings
    .filter((s) => !returnedIds.has(s.id))
    .map((s) => ({ id: s.id, reason: 'translation failed' }));

  return { translations: input.translations, skipped };
}
```

- [ ] **Step 4: Run tests and verify they pass**

```bash
npm test -- lib/anthropic.test.ts
```

Expected: PASS (all 3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/anthropic.ts lib/anthropic.test.ts
git commit -m "feat: rewrite Claude client to use Haiku 4.5 + tool-use"
```

---

## Task 5: Rewrite the API route

**Files:**
- Modify: `app/api/translate/route.ts` (rewrite entirely)
- Modify: `.env.example`

- [ ] **Step 1: Replace the route**

```ts
// app/api/translate/route.ts
import { NextResponse } from 'next/server';
import { translate } from '@/lib/anthropic';
import { checkRateLimit } from '@/lib/rate-limit';
import type { TranslateRequest, TranslateResponse } from '@/lib/translate-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_LAYERS = 50;

// Figma plugin UI iframes use `null` as their origin, which means every fetch
// from the plugin is a cross-origin request. Allow `*` so the browser doesn't
// block the response. (Acceptable here because the endpoint has no auth and
// no cookies — its sole protection is server-side rate limiting.)
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: CORS_HEADERS });
}

function getIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0]!.trim();
  return req.headers.get('x-real-ip') ?? 'unknown';
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: Request) {
  const ip = getIp(req);

  const rate = checkRateLimit(ip);
  if (!rate.ok) {
    return json(
      {
        error: rate.reason === 'global'
          ? 'Daily translation limit reached. Try again tomorrow.'
          : 'Too many requests from this address. Try again in an hour.',
      },
      429,
    );
  }

  let body: TranslateRequest;
  try {
    body = (await req.json()) as TranslateRequest;
  } catch {
    return json({ error: 'Invalid JSON.' }, 400);
  }

  if (!body.language?.trim()) {
    return json({ error: 'language is required.' }, 400);
  }
  if (!Array.isArray(body.strings) || body.strings.length === 0) {
    return json({ error: 'strings must be a non-empty array.' }, 400);
  }
  if (body.strings.length > MAX_LAYERS) {
    return json({ error: `Up to ${MAX_LAYERS} layers per request.` }, 400);
  }

  try {
    const result = await translate(body.language.trim(), body.strings);
    const payload: TranslateResponse = {
      translations: result.translations,
      ...(result.skipped.length > 0 ? { skipped: result.skipped } : {}),
    };
    return json(payload, 200);
  } catch (e) {
    return json(
      { error: e instanceof Error ? e.message : 'Translation failed.' },
      500,
    );
  }
}
```

- [ ] **Step 2: Update .env.example**

```
# Anthropic API key for Claude translation.
# Create one at https://console.anthropic.com/settings/keys
ANTHROPIC_API_KEY=

# Optional: pin the Claude model. Defaults to claude-haiku-4-5-20251001 if unset.
ANTHROPIC_MODEL=claude-haiku-4-5-20251001
```

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add app/api/translate/route.ts .env.example
git commit -m "feat: rewrite /api/translate with rate limits and 50-layer cap"
```

---

## Task 6: Smoke-test the proxy against real Claude

**Files:** none modified

- [ ] **Step 1: Start the dev server**

```bash
npm run dev
```

Expected: server listens on http://localhost:3000.

- [ ] **Step 2: POST a sample payload**

In a separate terminal:

```bash
curl -s -X POST http://localhost:3000/api/translate \
  -H "Content-Type: application/json" \
  -d '{"language":"French","strings":[{"id":"a","text":"Create a voice clone of yourself from your phone"},{"id":"b","text":"Download the free app"}]}' \
  | python3 -m json.tool
```

Expected output (translations will vary):

```json
{
  "translations": [
    { "id": "a", "text": "Clonez votre voix depuis votre téléphone" },
    { "id": "b", "text": "Téléchargez l'application gratuite" }
  ]
}
```

- [ ] **Step 3: Verify the 50-layer cap**

```bash
curl -s -X POST http://localhost:3000/api/translate \
  -H "Content-Type: application/json" \
  -d "$(node -e "console.log(JSON.stringify({language:'French', strings: Array.from({length: 51}, (_, i) => ({id: 'n' + i, text: 'Hello ' + i}))}))")" \
  | python3 -m json.tool
```

Expected:

```json
{ "error": "Up to 50 layers per request." }
```

(HTTP status 400 — confirm with `-w "%{http_code}"` if needed.)

- [ ] **Step 4: Stop the dev server (Ctrl-C)**

- [ ] **Step 5: Commit if any final fixes were needed**

(If the smoke test passed without changes, skip the commit.)

---

## Task 7: Plugin scaffold — manifest, package.json, Vite config

**Files:**
- Create: `figma-plugin/manifest.json`
- Create: `figma-plugin/package.json`
- Create: `figma-plugin/tsconfig.json`
- Create: `figma-plugin/vite.config.ts`
- Create: `figma-plugin/src/ui/index.html`

- [ ] **Step 1: Create the manifest**

```json
{
  "name": "CopyCat",
  "id": "com.lukepage.copycat",
  "api": "1.0.0",
  "main": "dist/code.js",
  "ui": "dist/index.html",
  "editorType": ["figma"],
  "networkAccess": {
    "allowedDomains": [
      "http://localhost:3000",
      "https://*.vercel.app"
    ],
    "reasoning": "Calls the CopyCat translation proxy hosted on Vercel."
  }
}
```

(Note: `dist/index.html` rather than `dist/ui.html` — Vite's `viteSingleFile` plugin emits the bundled UI as `index.html` based on the input filename. Don't change this without also updating Vite's output config.)

- [ ] **Step 2: Create the plugin package.json**

```json
{
  "name": "copycat-figma-plugin",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "build": "npm run build:code && npm run build:ui",
    "build:code": "esbuild src/code.ts --bundle --outfile=dist/code.js --target=es2017 --format=iife --log-level=info",
    "build:ui": "vite build",
    "watch": "npm run build && (esbuild src/code.ts --bundle --outfile=dist/code.js --target=es2017 --format=iife --watch & vite build --watch)"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@figma/plugin-typings": "^1.100.0",
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.4",
    "esbuild": "^0.24.0",
    "typescript": "^5.6.3",
    "vite": "^5.4.0",
    "vite-plugin-singlefile": "^2.0.3"
  }
}
```

- [ ] **Step 3: Install the plugin's deps**

```bash
cd figma-plugin
npm install
```

- [ ] **Step 4: Create the plugin tsconfig**

```json
{
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["ES2017", "DOM"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "jsx": "react-jsx",
    "types": ["@figma/plugin-typings"],
    "noEmit": true,
    "isolatedModules": true
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 5: Create the Vite config**

```ts
// figma-plugin/vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react(), viteSingleFile()],
  root: 'src/ui',
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: false,
    rollupOptions: {
      input: resolve(__dirname, 'src/ui/index.html'),
      output: { entryFileNames: 'ui.js' },
    },
  },
});
```

- [ ] **Step 6: Create the UI HTML entry**

```html
<!-- figma-plugin/src/ui/index.html -->
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>CopyCat</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 7: Commit**

```bash
cd ~/Desktop/claude-work
git add figma-plugin/
git commit -m "feat: scaffold Figma plugin with Vite + esbuild build pipeline"
```

---

## Task 8: Define typed messages between code.ts and UI

**Files:**
- Create: `figma-plugin/src/messages.ts`

- [ ] **Step 1: Write the messages module**

```ts
// figma-plugin/src/messages.ts

/** Item descriptor sent from the sandbox to the UI for each selected text node. */
export type SelectionItem = {
  id: string;
  name: string;
  characters: string;
  /** Reason this node was filtered out and cannot be translated. Null if translatable. */
  skipReason: SkipReason | null;
};

export type SkipReason =
  | 'mixed-styling'
  | 'layer-locked'
  | 'empty-text';

export type SkipDetail = { id: string; name: string; reason: string };

/** Messages: UI ← code.ts (sandbox). */
export type FromSandbox =
  | { type: 'selection'; items: SelectionItem[] }
  | { type: 'apply-result'; translated: number; skipped: SkipDetail[] }
  | { type: 'apply-error'; message: string };

/** Messages: code.ts (sandbox) ← UI. */
export type ToSandbox =
  | { type: 'apply'; translations: { id: string; text: string }[] }
  | { type: 'close' };

/** Sandbox-side helper: post a typed message to UI. */
export function postToUI(msg: FromSandbox): void {
  figma.ui.postMessage(msg);
}
```

- [ ] **Step 2: Commit**

```bash
git add figma-plugin/src/messages.ts
git commit -m "feat: define typed plugin↔ui message shapes"
```

---

## Task 9: Build the selection partitioner (TDD)

**Files:**
- Create: `figma-plugin/src/partition.ts`
- Test: `figma-plugin/src/partition.test.ts`

This module is **pure logic** — it takes a generic node-like object and returns the partition. The actual Figma `node` is converted to this generic shape in `code.ts`. That separation makes unit testing easy.

- [ ] **Step 1: Write the failing tests**

```ts
// figma-plugin/src/partition.test.ts
import { describe, it, expect } from 'vitest';
import { partitionSelection, type RawNode } from './partition';

const base = (over: Partial<RawNode>): RawNode => ({
  id: 'x', name: 'x', characters: 'hello',
  locked: false, hasMixedFontName: false, hasMixedFills: false, hasMixedFontSize: false,
  ...over,
});

describe('partitionSelection', () => {
  it('marks a plain text node as translatable', () => {
    const result = partitionSelection([base({ id: '1', characters: 'Hello' })]);
    expect(result).toEqual([
      { id: '1', name: 'x', characters: 'Hello', skipReason: null },
    ]);
  });

  it('marks a locked layer as skipped', () => {
    const result = partitionSelection([base({ id: '1', locked: true })]);
    expect(result[0]!.skipReason).toBe('layer-locked');
  });

  it('marks mixed-font nodes as skipped', () => {
    const result = partitionSelection([base({ id: '1', hasMixedFontName: true })]);
    expect(result[0]!.skipReason).toBe('mixed-styling');
  });

  it('marks mixed-fills as skipped (style includes colour)', () => {
    const result = partitionSelection([base({ id: '1', hasMixedFills: true })]);
    expect(result[0]!.skipReason).toBe('mixed-styling');
  });

  it('marks mixed-size as skipped', () => {
    const result = partitionSelection([base({ id: '1', hasMixedFontSize: true })]);
    expect(result[0]!.skipReason).toBe('mixed-styling');
  });

  it('marks empty text as skipped', () => {
    const result = partitionSelection([base({ id: '1', characters: '   ' })]);
    expect(result[0]!.skipReason).toBe('empty-text');
  });

  it('locked beats mixed-styling in the reason field', () => {
    const result = partitionSelection([base({
      id: '1', locked: true, hasMixedFontName: true,
    })]);
    expect(result[0]!.skipReason).toBe('layer-locked');
  });
});
```

- [ ] **Step 2: Run tests and verify they fail**

```bash
cd ~/Desktop/claude-work
npm test -- figma-plugin/src/partition.test.ts
```

Expected: FAIL — `partition.ts` doesn't exist.

- [ ] **Step 3: Implement the partitioner**

```ts
// figma-plugin/src/partition.ts
import type { SelectionItem, SkipReason } from './messages';

/** Subset of Figma TextNode fields we care about. Generic so unit-testable. */
export type RawNode = {
  id: string;
  name: string;
  characters: string;
  locked: boolean;
  hasMixedFontName: boolean;
  hasMixedFills: boolean;
  hasMixedFontSize: boolean;
};

export function partitionSelection(nodes: RawNode[]): SelectionItem[] {
  return nodes.map(toItem);
}

function toItem(node: RawNode): SelectionItem {
  return {
    id: node.id,
    name: node.name,
    characters: node.characters,
    skipReason: detectSkip(node),
  };
}

function detectSkip(node: RawNode): SkipReason | null {
  if (node.locked) return 'layer-locked';
  if (node.hasMixedFontName || node.hasMixedFills || node.hasMixedFontSize) {
    return 'mixed-styling';
  }
  if (node.characters.trim().length === 0) return 'empty-text';
  return null;
}
```

- [ ] **Step 4: Run tests and verify they pass**

```bash
npm test -- figma-plugin/src/partition.test.ts
```

Expected: PASS (all 7 tests).

- [ ] **Step 5: Commit**

```bash
git add figma-plugin/src/partition.ts figma-plugin/src/partition.test.ts
git commit -m "feat: add selection partitioner with skip-reason detection"
```

---

## Task 10: Build the Figma sandbox script (code.ts)

**Files:**
- Create: `figma-plugin/src/code.ts`

This file runs inside Figma's plugin sandbox. It has access to the Figma Plugin API. It cannot be unit-tested in isolation — it integrates with Figma. Logic-heavy bits are factored into `partition.ts` (already tested).

- [ ] **Step 1: Write code.ts**

```ts
// figma-plugin/src/code.ts
import { partitionSelection, type RawNode } from './partition';
import type { FromSandbox, ToSandbox, SkipDetail } from './messages';

figma.showUI(__html__, { width: 360, height: 420, themeColors: true });

const REASON_TEXT: Record<string, string> = {
  'layer-locked': 'layer locked',
  'mixed-styling': 'mixed styling — edit manually',
  'empty-text': 'empty text',
};

function postSelection(): void {
  const textNodes = figma.currentPage.selection.filter(
    (n): n is TextNode => n.type === 'TEXT',
  );
  const raws: RawNode[] = textNodes.map((n) => ({
    id: n.id,
    name: n.name,
    characters: n.characters,
    locked: n.locked,
    hasMixedFontName: n.fontName === figma.mixed,
    hasMixedFills: n.fills === figma.mixed,
    hasMixedFontSize: n.fontSize === figma.mixed,
  }));
  const items = partitionSelection(raws);
  const msg: FromSandbox = { type: 'selection', items };
  figma.ui.postMessage(msg);
}

// Initial state on plugin open + listen for selection changes.
postSelection();
figma.on('selectionchange', postSelection);

figma.ui.onmessage = async (msg: ToSandbox) => {
  if (msg.type === 'close') {
    figma.closePlugin();
    return;
  }
  if (msg.type !== 'apply') return;

  const skipped: SkipDetail[] = [];
  let translated = 0;

  for (const t of msg.translations) {
    const node = figma.getNodeById(t.id);
    if (!node || node.type !== 'TEXT') {
      skipped.push({ id: t.id, name: '<missing>', reason: 'node not found' });
      continue;
    }
    if (node.locked) {
      skipped.push({ id: t.id, name: node.name, reason: REASON_TEXT['layer-locked']! });
      continue;
    }
    const font = node.fontName;
    if (font === figma.mixed) {
      skipped.push({ id: t.id, name: node.name, reason: REASON_TEXT['mixed-styling']! });
      continue;
    }
    try {
      await figma.loadFontAsync(font);
    } catch {
      skipped.push({
        id: t.id, name: node.name,
        reason: `font not loaded: ${font.family} ${font.style}`,
      });
      continue;
    }
    try {
      node.characters = t.text;
      translated += 1;
    } catch (e) {
      skipped.push({
        id: t.id, name: node.name,
        reason: e instanceof Error ? e.message : 'apply failed',
      });
    }
  }

  const result: FromSandbox = { type: 'apply-result', translated, skipped };
  figma.ui.postMessage(result);
};
```

- [ ] **Step 2: Build the plugin to confirm code.ts compiles**

```bash
cd ~/Desktop/claude-work/figma-plugin
npm run build:code
```

Expected: `dist/code.js` is created.

- [ ] **Step 3: Commit**

```bash
cd ~/Desktop/claude-work
git add figma-plugin/src/code.ts
git commit -m "feat: wire code.ts to read selection and apply translations"
```

---

## Task 11: Build the React UI App

**Files:**
- Create: `figma-plugin/src/ui/main.tsx`
- Create: `figma-plugin/src/ui/App.tsx`
- Create: `figma-plugin/src/ui/styles.css`

- [ ] **Step 1: Write main.tsx**

```tsx
// figma-plugin/src/ui/main.tsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(<App />);
```

- [ ] **Step 2: Write App.tsx**

```tsx
// figma-plugin/src/ui/App.tsx
import { useEffect, useState } from 'react';
import type { FromSandbox, SelectionItem, SkipDetail, ToSandbox } from '../messages';

const PROXY_URL =
  // In dev: http://localhost:3000/api/translate
  // In production: replace with your Vercel deployment URL.
  'http://localhost:3000/api/translate';

type DoneState = { translated: number; skipped: SkipDetail[] };
type Mode =
  | { kind: 'input' }
  | { kind: 'loading' }
  | { kind: 'done'; result: DoneState }
  | { kind: 'error'; message: string };

function toParent(msg: ToSandbox): void {
  parent.postMessage({ pluginMessage: msg }, '*');
}

const SKIP_TEXT: Record<string, string> = {
  'mixed-styling': 'mixed styling — edit manually',
  'layer-locked': 'layer locked',
  'empty-text': 'empty text',
};

export function App() {
  const [items, setItems] = useState<SelectionItem[]>([]);
  const [language, setLanguage] = useState('');
  const [mode, setMode] = useState<Mode>({ kind: 'input' });

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const msg = event.data.pluginMessage as FromSandbox | undefined;
      if (!msg) return;
      if (msg.type === 'selection') setItems(msg.items);
      if (msg.type === 'apply-result') {
        setMode({ kind: 'done', result: { translated: msg.translated, skipped: msg.skipped } });
      }
      if (msg.type === 'apply-error') {
        setMode({ kind: 'error', message: msg.message });
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const translatable = items.filter((i) => i.skipReason === null);
  const pre_skipped = items.filter((i) => i.skipReason !== null);
  const canTranslate = translatable.length > 0 && language.trim().length > 0 && mode.kind === 'input';

  async function onTranslate() {
    if (!canTranslate) return;
    setMode({ kind: 'loading' });
    try {
      const res = await fetch(PROXY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          language: language.trim(),
          strings: translatable.map((i) => ({ id: i.id, text: i.characters })),
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setMode({ kind: 'error', message: body.error || `Request failed (${res.status})` });
        return;
      }
      const body = (await res.json()) as {
        translations: { id: string; text: string }[];
        skipped?: { id: string; reason: string }[];
      };
      toParent({ type: 'apply', translations: body.translations });
      // Apply-result will set mode via the sandbox response handler.
    } catch (e) {
      setMode({ kind: 'error', message: e instanceof Error ? e.message : 'Network error' });
    }
  }

  function reset() {
    setMode({ kind: 'input' });
  }

  if (items.length === 0) {
    return (
      <main className="panel">
        <p className="hint">Select text layers in Figma to begin.</p>
      </main>
    );
  }

  if (mode.kind === 'loading') {
    return (
      <main className="panel">
        <p>Translating {translatable.length} layer{translatable.length === 1 ? '' : 's'}…</p>
      </main>
    );
  }

  if (mode.kind === 'done') {
    return (
      <main className="panel">
        <p className="ok">✓ Translated {mode.result.translated} layer{mode.result.translated === 1 ? '' : 's'}.</p>
        {mode.result.skipped.length > 0 && (
          <div className="skipped">
            <p className="warn">⚠ {mode.result.skipped.length} skipped:</p>
            <ul>
              {mode.result.skipped.map((s) => (
                <li key={s.id}><strong>{s.name}</strong> — {s.reason}</li>
              ))}
            </ul>
          </div>
        )}
        <button className="primary" onClick={reset}>Translate more</button>
      </main>
    );
  }

  if (mode.kind === 'error') {
    return (
      <main className="panel">
        <p className="warn">{mode.message}</p>
        <button onClick={reset}>Back</button>
      </main>
    );
  }

  return (
    <main className="panel">
      <p className="count">
        {translatable.length} text layer{translatable.length === 1 ? '' : 's'} selected
        {pre_skipped.length > 0 && ` (${pre_skipped.length} will be skipped)`}
      </p>
      <label className="field">
        <span>Translate to</span>
        <input
          autoFocus
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          placeholder="French"
        />
      </label>
      <button className="primary" disabled={!canTranslate} onClick={onTranslate}>
        Translate
      </button>
      {pre_skipped.length > 0 && (
        <details className="skipped">
          <summary>{pre_skipped.length} will be skipped</summary>
          <ul>
            {pre_skipped.map((s) => (
              <li key={s.id}>
                <strong>{s.name}</strong> — {SKIP_TEXT[s.skipReason!] ?? s.skipReason}
              </li>
            ))}
          </ul>
        </details>
      )}
    </main>
  );
}
```

- [ ] **Step 3: Write styles.css**

```css
/* figma-plugin/src/ui/styles.css */
* { box-sizing: border-box; }
body, html { margin: 0; padding: 0; font: 12px/1.5 -apple-system, sans-serif; color: #222; }
.panel { padding: 16px; display: flex; flex-direction: column; gap: 12px; }
.hint { color: #888; }
.count { color: #444; font-weight: 500; }
.field { display: flex; flex-direction: column; gap: 4px; }
.field span { color: #666; font-size: 11px; }
.field input { padding: 8px 10px; border: 1px solid #ddd; border-radius: 6px; font: inherit; }
.field input:focus { outline: 2px solid #18a0fb; border-color: #18a0fb; }
button { padding: 8px 14px; border: 1px solid #ddd; border-radius: 6px; background: #fff; cursor: pointer; font: inherit; }
button:hover:not(:disabled) { background: #f5f5f5; }
button:disabled { opacity: 0.5; cursor: not-allowed; }
button.primary { background: #18a0fb; color: white; border-color: #18a0fb; }
button.primary:hover:not(:disabled) { background: #0d8de4; }
.ok { color: #14a96f; font-weight: 500; }
.warn { color: #c08300; }
.skipped { background: #fff7e6; border: 1px solid #ffd58a; border-radius: 6px; padding: 10px 12px; }
.skipped ul { margin: 6px 0 0; padding-left: 20px; }
.skipped summary { cursor: pointer; color: #c08300; }
```

- [ ] **Step 4: Build the UI to confirm it compiles**

```bash
cd ~/Desktop/claude-work/figma-plugin
npm run build:ui
```

Expected: `dist/ui.html` is created and is a self-contained file (HTML + inlined JS + inlined CSS).

- [ ] **Step 5: Commit**

```bash
cd ~/Desktop/claude-work
git add figma-plugin/src/ui/
git commit -m "feat: build React UI with input/loading/done/error states"
```

---

## Task 12: End-to-end manual test in Figma

**Files:** none modified

- [ ] **Step 1: Build the full plugin**

```bash
cd ~/Desktop/claude-work/figma-plugin
npm run build
```

Expected: `dist/code.js` and `dist/ui.html` both exist.

- [ ] **Step 2: Start the Next.js dev server (the proxy)**

In a separate terminal:

```bash
cd ~/Desktop/claude-work
npm run dev
```

Expected: server on http://localhost:3000.

- [ ] **Step 3: Load the plugin in Figma**

In Figma:
1. Open any file (or create a test file with a few text layers).
2. Menu → `Plugins → Development → Import plugin from manifest…`
3. Pick `~/Desktop/claude-work/figma-plugin/manifest.json`
4. Menu → `Plugins → Development → CopyCat`

Expected: the plugin panel opens.

- [ ] **Step 4: Verify the empty state**

With nothing selected: panel shows "Select text layers in Figma to begin."

- [ ] **Step 5: Verify the selection state**

Click one text layer in Figma. Panel updates to "1 text layer selected" and shows the language input.

- [ ] **Step 6: Translate to French**

Type "French" into the input → click Translate. Panel shows "Translating 1 layer…", then "✓ Translated 1 layer." with "Translate more" button. The Figma canvas now shows the French translation.

- [ ] **Step 7: Verify multi-select**

Cmd-click 3 text layers in Figma. Panel updates to "3 text layers selected". Translate to Spanish. All three should change to Spanish.

- [ ] **Step 8: Verify the skipped UX**

Lock a text layer in Figma (right-click → Lock). Select it + an unlocked text layer. Translate. Done screen should show "✓ Translated 1 layer." and "⚠ 1 skipped: <name> — layer locked".

- [ ] **Step 9: Verify cmd-Z undo**

Press cmd-Z. The translated text reverts to English. (Figma's native undo, not plugin-driven.)

- [ ] **Step 10: Commit any tweaks made during testing**

If any styling or logic fixes were needed, commit them:

```bash
git add -A
git commit -m "fix: small adjustments from end-to-end testing"
```

---

## Task 13: Write the README

**Files:**
- Modify: `README.md` (overwrite the existing one)

- [ ] **Step 1: Replace README.md**

```markdown
# CopyCat

A Figma plugin that translates selected text layers into any language via Claude. In-place. One click after selection.

## What it does

1. Select text layers in Figma (cmd-click multiple).
2. Open `Plugins → CopyCat`.
3. Type a target language ("French", "Brazilian Portuguese", "informal Japanese").
4. Click Translate.

The text changes in place. Cmd-Z reverts it.

## Architecture at a glance

```
   FIGMA                                          VERCEL
   ┌──────────────────────────┐                  ┌──────────────────────────┐
   │  CopyCat plugin            │                  │  /api/translate          │
   │   - code.ts (sandbox)    │                  │   - rate limit           │
   │   - React UI panel       │  ──POST JSON──►  │   - max 50 layers/req    │
   │                          │  ◄──JSON array── │   - Claude Haiku 4.5     │
   │                          │                  │   - tool-use for shape   │
   └──────────────────────────┘                  └──────────────────────────┘
```

## Install (development plugin)

Prerequisites: Node 20+, Figma desktop app, Anthropic API key.

```bash
git clone <this-repo>
cd copycat-figma-plugin
npm install
cd figma-plugin && npm install && npm run build && cd ..

cp .env.example .env.local
# edit .env.local — set ANTHROPIC_API_KEY

npm run dev  # starts the translation proxy on localhost:3000
```

In Figma:
1. `Plugins → Development → Import plugin from manifest…`
2. Pick `figma-plugin/manifest.json` from this repo.
3. Run via `Plugins → Development → CopyCat`.

## Design decisions worth knowing

- **Why a Figma plugin and not a web app:** Figma's REST API is read-only for text content. Writing translations back to a Figma file requires the Plugin API, which only runs inside Figma. A web-app prototype confirmed this hard limit before the pivot.
- **Why Claude Haiku 4.5 instead of Sonnet/Opus:** translation is a bounded task and Haiku handles it well at a fraction of the cost (~$0.002 per ad). Cost matters because Anthropic billing goes through a personal account for this assessment, not an employer's.
- **Why no per-user authentication:** the audience is a small known reviewer group. Per-user codes would add setup friction for no security benefit at this scale. The proxy uses in-memory rate limits (500/day global, 100/hr per IP) and a $50 hard cap in the Anthropic console as the real cost backstop.
- **Why no in-plugin review table:** Figma's canvas is a better review surface than a 400px-wide plugin panel. The plugin reports counts and any skipped layers; visual review happens in Figma. Cmd-Z is the safety net.

## What's deferred to v2

- Figma Variables / multi-language mode switching (a single file with EN/FR/ES toggle).
- Multi-language batch ("French, Spanish, German" in one run).
- Brand glossary support ("voice clone" → fixed term in each language).
- Translation memory across runs.

## Author

Built as a take-home exercise for ElevenLabs by Luke Page.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: rewrite README for plugin-first product"
```

---

## Task 14: Final typecheck, test, and tag the build

**Files:** none modified

- [ ] **Step 1: Run the full test suite**

```bash
cd ~/Desktop/claude-work
npm test
```

Expected: all tests in `lib/rate-limit.test.ts`, `lib/anthropic.test.ts`, and `figma-plugin/src/partition.test.ts` pass.

- [ ] **Step 2: Run typecheck on both packages**

```bash
npm run typecheck
cd figma-plugin && npx tsc --noEmit && cd ..
```

Expected: no errors.

- [ ] **Step 3: Tag the v1 build**

```bash
git tag v0.1.0 -m "CopyCat v0.1.0 — initial assessment build"
```

- [ ] **Step 4: Confirm everything is committed**

```bash
git status
```

Expected: "nothing to commit, working tree clean".
