import { useEffect, useState } from 'react';
import type {
  FromSandbox,
  SelectionItem,
  SkipDetail,
  ShrunkDetail,
  ToSandbox,
} from '../messages';

const PROXY_URL = 'https://claude-work-blush.vercel.app/api/translate';

type DoneState = {
  translated: number;
  skipped: SkipDetail[];
  shrunk: ShrunkDetail[];
  language: string;
};
type Mode =
  | { kind: 'input' }
  | { kind: 'loading' }
  | { kind: 'done'; result: DoneState }
  | { kind: 'error'; message: string };

function toParent(msg: ToSandbox): void {
  parent.postMessage({ pluginMessage: msg }, '*');
}

function findCompletion(value: string, suggestions: string[]): string | null {
  if (value.length === 0) return null;
  const lower = value.toLowerCase();
  const match = suggestions.find(
    (s) =>
      s.toLowerCase().startsWith(lower) && s.toLowerCase() !== lower,
  );
  return match ?? null;
}

// Wagner-Fischer Levenshtein distance — minimum single-character edits
// (insert / delete / substitute) to turn `a` into `b`. Used for catching
// typos in language names like "endlish" → "English".
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  let curr = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= m; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= n; j += 1) {
      curr[j] =
        a[i - 1] === b[j - 1]
          ? prev[j - 1]!
          : 1 + Math.min(prev[j - 1]!, prev[j]!, curr[j - 1]!);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n]!;
}

// If the typed language doesn't exactly match any known suggestion, look for
// a close fuzzy match (distance/length < 0.3) and substitute it. Catches
// "endlish" → "English" silently while leaving intentional non-list inputs
// like "informal Italian" alone.
function correctLanguage(typed: string, suggestions: string[]): string {
  const trimmed = typed.trim();
  if (trimmed.length < 3) return trimmed;
  const lower = trimmed.toLowerCase();
  const exact = suggestions.find((s) => s.toLowerCase() === lower);
  if (exact) return exact;
  let best: { match: string; dist: number; ratio: number } | null = null;
  for (const s of suggestions) {
    const dist = levenshtein(lower, s.toLowerCase());
    const ratio = dist / Math.max(trimmed.length, s.length);
    if (ratio < 0.3 && (!best || dist < best.dist)) {
      best = { match: s, dist, ratio };
    }
  }
  return best ? best.match : trimmed;
}

function GhostInput({
  value,
  onChange,
  suggestions,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  suggestions: string[];
  placeholder: string;
}) {
  const completion = findCompletion(value, suggestions);
  const ghost = completion ? completion.slice(value.length) : '';

  return (
    <div className="ghost-input">
      {/* Overlay renders the full predicted word as one string. The typed
          prefix is fully opaque, the suggested suffix is semi-opaque. Because
          they're a single text element, there's no positional misalignment —
          the letters flow as one word. */}
      <div className="ghost-overlay" aria-hidden="true">
        {value.length === 0 ? (
          <span className="ghost-placeholder">{placeholder}</span>
        ) : (
          <>
            <span className="ghost-typed">{value}</span>
            {ghost && <span className="ghost-tail">{ghost}</span>}
          </>
        )}
      </div>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Tab' && completion) {
            e.preventDefault();
            onChange(completion);
          }
        }}
        autoComplete="off"
        spellCheck={false}
      />
    </div>
  );
}

const LANGUAGE_SUGGESTIONS = [
  'English',
  'Spanish',
  'Spanish (Latin America)',
  'French',
  'French (Canadian)',
  'German',
  'Italian',
  'Portuguese',
  'Brazilian Portuguese',
  'Dutch',
  'Polish',
  'Czech',
  'Hungarian',
  'Romanian',
  'Greek',
  'Russian',
  'Ukrainian',
  'Turkish',
  'Arabic',
  'Hebrew',
  'Persian',
  'Hindi',
  'Bengali',
  'Tamil',
  'Telugu',
  'Urdu',
  'Japanese',
  'Korean',
  'Mandarin Chinese (Simplified)',
  'Mandarin Chinese (Traditional)',
  'Cantonese',
  'Thai',
  'Vietnamese',
  'Indonesian',
  'Malay',
  'Filipino',
  'Swahili',
  'Swedish',
  'Norwegian',
  'Danish',
  'Finnish',
  'Icelandic',
  'Catalan',
  'Welsh',
  'Irish',
  'Bulgarian',
  'Serbian',
  'Croatian',
  'Slovak',
  'Slovenian',
];

const SKIP_TEXT: Record<string, string> = {
  'mixed-styling': 'mixed styling — edit manually',
  'layer-locked': 'layer locked',
  'empty-text': 'empty text',
};

const fmtPt = (n: number) => `${Math.round(n * 10) / 10}pt`;

export function App() {
  const [items, setItems] = useState<SelectionItem[]>([]);
  const [language, setLanguage] = useState('');
  const [mode, setMode] = useState<Mode>({ kind: 'input' });
  const [lastLanguage, setLastLanguage] = useState('');

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const msg = event.data.pluginMessage as FromSandbox | undefined;
      if (!msg) return;
      if (msg.type === 'selection') setItems(msg.items);
      if (msg.type === 'apply-result') {
        setMode((prev) => ({
          kind: 'done',
          result: {
            translated: msg.translated,
            skipped: msg.skipped,
            shrunk: msg.shrunk,
            language: prev.kind === 'done' ? prev.result.language : lastLanguage,
          },
        }));
      }
      if (msg.type === 'apply-error') {
        setMode({ kind: 'error', message: msg.message });
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
    // lastLanguage in deps so the handler closes over the current value when
    // apply-result arrives — without this, the done screen reads a stale ""
    // and the "Translated N layers to <Language>." label is silently missing.
  }, [lastLanguage]);

  // Resize the plugin window to fit content. Figma supports dynamic resizing
  // via figma.ui.resize(); we just measure the rendered root and pass the
  // height to the sandbox, which clamps and applies.
  useEffect(() => {
    const root = document.getElementById('root');
    if (!root) return;
    const post = () => {
      toParent({ type: 'resize', height: root.scrollHeight });
    };
    post();
    const ro = new ResizeObserver(post);
    ro.observe(root);
    return () => ro.disconnect();
  }, [items.length, mode.kind]);

  const translatable = items.filter((i) => i.skipReason === null);
  const preSkipped = items.filter((i) => i.skipReason !== null);
  const canTranslate =
    translatable.length > 0 && language.trim().length > 0 && mode.kind === 'input';

  async function onTranslate() {
    if (!canTranslate) return;
    // If the user typed a short prefix that has a visible ghost suggestion
    // and clicked Translate without pressing Tab, auto-accept the ghost.
    // Otherwise we'd ship "g" as the target language and Claude would shrug.
    const completion = findCompletion(language, LANGUAGE_SUGGESTIONS);
    const effectiveLanguage = completion ?? language;
    const resolvedLanguage = correctLanguage(effectiveLanguage, LANGUAGE_SUGGESTIONS);
    setLastLanguage(resolvedLanguage);
    setMode({ kind: 'loading' });
    try {
      const res = await fetch(PROXY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          language: resolvedLanguage,
          strings: translatable.map((i) => ({ id: i.id, text: i.characters })),
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setMode({
          kind: 'error',
          message: body.error || `Request failed (${res.status})`,
        });
        return;
      }
      const body = (await res.json()) as {
        translations: { id: string; text: string }[];
        skipped?: { id: string; reason: string }[];
      };
      toParent({ type: 'apply', translations: body.translations });
    } catch (e) {
      setMode({
        kind: 'error',
        message: e instanceof Error ? e.message : 'Network error',
      });
    }
  }

  function reset() {
    setMode({ kind: 'input' });
    setLanguage('');
  }

  if (items.length === 0) {
    return (
      <main className="panel">
        <p className="hint">Select one or more text layers to begin translating copy</p>
      </main>
    );
  }

  if (mode.kind === 'loading') {
    return (
      <main className="panel">
        <p>
          Translating {translatable.length} layer
          {translatable.length === 1 ? '' : 's'}…
        </p>
      </main>
    );
  }

  if (mode.kind === 'done') {
    return (
      <main className="panel">
        <p className="ok">
          ✓ Translated {mode.result.translated} layer
          {mode.result.translated === 1 ? '' : 's'}
          {mode.result.language ? ` to ${mode.result.language}` : ''}.
        </p>
        {mode.result.shrunk.length > 0 && (
          <div className="info">
            <p>
              ↘ {mode.result.shrunk.length} shrunk to fit:
            </p>
            <ul>
              {mode.result.shrunk.map((s) => (
                <li key={s.id}>
                  <strong>{s.name}</strong> — {fmtPt(s.from)} → {fmtPt(s.to)}
                </li>
              ))}
            </ul>
          </div>
        )}
        {mode.result.skipped.length > 0 && (
          <div className="skipped">
            <p className="warn">⚠ {mode.result.skipped.length} skipped:</p>
            <ul>
              {mode.result.skipped.map((s) => (
                <li key={s.id}>
                  <strong>{s.name}</strong> — {s.reason}
                </li>
              ))}
            </ul>
          </div>
        )}
        <button className="primary" onClick={reset}>
          Translate more
        </button>
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
        {translatable.length} text layer
        {translatable.length === 1 ? '' : 's'} selected
        {preSkipped.length > 0 && ` (${preSkipped.length} will be skipped)`}
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onTranslate();
        }}
      >
        <div className="field">
          <GhostInput
            value={language}
            onChange={setLanguage}
            suggestions={LANGUAGE_SUGGESTIONS}
            placeholder="Type language here"
          />
        </div>
        <button
          type="submit"
          className="primary"
          disabled={!canTranslate}
        >
          Translate
        </button>
      </form>
      {preSkipped.length > 0 && (
        <details className="skipped">
          <summary>{preSkipped.length} will be skipped</summary>
          <ul>
            {preSkipped.map((s) => (
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
