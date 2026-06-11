import { useEffect, useState } from 'react';
import type {
  FromSandbox,
  SelectionItem,
  SkipDetail,
  ShrunkDetail,
  ToSandbox,
} from '../messages';

const PROXY_URL = 'https://claude-work-blush.vercel.app/api/translate';

type DoneState = { translated: number; skipped: SkipDetail[]; shrunk: ShrunkDetail[] };
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

const fmtPt = (n: number) => `${Math.round(n * 10) / 10}pt`;

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
        setMode({
          kind: 'done',
          result: {
            translated: msg.translated,
            skipped: msg.skipped,
            shrunk: msg.shrunk,
          },
        });
      }
      if (msg.type === 'apply-error') {
        setMode({ kind: 'error', message: msg.message });
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const translatable = items.filter((i) => i.skipReason === null);
  const preSkipped = items.filter((i) => i.skipReason !== null);
  const canTranslate =
    translatable.length > 0 && language.trim().length > 0 && mode.kind === 'input';

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
          {mode.result.translated === 1 ? '' : 's'}.
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
