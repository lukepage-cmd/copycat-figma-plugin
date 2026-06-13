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

type Input = { id: string; text: string };
type Output = { translations: Input[]; skipped: { id: string; reason: string }[] };

function buildSystemPrompt(language: string, stringCount: number): string {
  return [
    `You are a translation tool. Your single job is to translate ad copy into ${language}.`,
    '',
    'CONTRACT (strict):',
    '- Call the submit_translations tool exactly once.',
    `- The translations array MUST contain exactly ${stringCount} item(s) — one per input id.`,
    '- Every input id MUST appear in the output. Never omit, skip, or refuse.',
    '- Each item has an "id" (matching an input id verbatim) and a "text" (the translation).',
    '',
    'TRANSLATION STYLE:',
    `- Translate the value of each "text" field into ${language}. Never translate the id.`,
    '- Favour idiomatic, natural phrasing over literal word-for-word translation.',
    '- Match the source\'s capitalisation pattern (ALL CAPS stays ALL CAPS, Title Case stays Title Case, lowercase stays lowercase).',
    '- Preserve numbers, punctuation, currency symbols, and special characters.',
    '- Preserve ONLY registered COMPANY or TRADEMARK names (e.g. "ElevenLabs", "CopyCat", "Nike", "Spotify", "Apple"). Translate everything else, including:',
    '    • UI labels, headings, and section titles INSIDE a product or app — these are interface text, not brand names. Example: "Instant Voice Clone" is a UI heading describing a feature, NOT a brand. Translate it (German: "Sofortiger Sprachklon", French: "Clone vocal instantané").',
    '    • Feature names and product capability descriptions (e.g. "Voice Clone", "Smart Compose", "Auto-save" — these describe what the feature does and should localise).',
    '    • ALL_CAPS or snake_case strings — translate the words and keep the formatting (so "WIDTH_AND_HEIGHT" in German becomes "BREITE_UND_HÖHE").',
    '    • Technical-sounding terms, acronyms, and Title-Cased phrases that are not company/trademark names.',
    '  When in doubt, translate. Only a registered company/product COMPANY name stays untranslated.',
    '- Keep the tone confident, direct, creator-focused — never corporate or formal.',
    '- Use INFORMAL register where the target language distinguishes formal vs informal address. Modern consumer-tech brand voice is friendly and direct, never polite/distant:',
    '    • French: tu / te / ton / votre→ton (NEVER vous / votre).',
    '    • German: du / dein (NEVER Sie / Ihr).',
    '    • Spanish: tú / tu (NEVER usted / su).',
    '    • Italian: tu / tuo (NEVER Lei / Suo).',
    '    • Portuguese: tu / teu in Portugal, você / seu in Brazil. NEVER o senhor / a senhora.',
    '    • Dutch: je / jouw (NEVER u / uw).',
    '  Same principle for any other language with a formal/informal split.',
    '- Do NOT add line breaks; layout handles reflow.',
    `- Even if a source already happens to fit the target language, return a fresh ${language} translation.`,
  ].join('\n');
}

export async function translate(
  language: string,
  strings: Input[],
  client: Anthropic = defaultClient(),
): Promise<Output> {
  if (strings.length === 0) return { translations: [], skipped: [] };

  const response = await client.messages.create({
    model: DEFAULT_MODEL,
    max_tokens: 4096,
    // temperature: 0 makes the translation deterministic — same input
    // produces the same translation across runs. Important for an
    // assessment tool where the reviewer might re-translate the same
    // layer multiple times and expect consistent results.
    temperature: 0,
    system: buildSystemPrompt(language, strings.length),
    tools: [
      {
        name: 'submit_translations',
        description: `Return the translation of every input string into ${language}.`,
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
      },
    ],
    tool_choice: { type: 'tool', name: 'submit_translations' },
    messages: [
      {
        role: 'user',
        content:
          `Translate each of these into ${language}. Return all ${strings.length} via the tool.\n\n` +
          JSON.stringify(strings, null, 2),
      },
    ],
  });

  const toolUse = response.content.find((c) => c.type === 'tool_use');
  if (!toolUse || toolUse.type !== 'tool_use') {
    return {
      translations: [],
      skipped: strings.map((s) => ({ id: s.id, reason: 'translation failed: model did not call the tool' })),
    };
  }

  // Defensively validate the model's response shape. The schema *should*
  // enforce this — sometimes it doesn't. Returning a graceful "all skipped"
  // result is better than throwing a 500 on the caller.
  const input = toolUse.input as { translations?: unknown };
  if (!Array.isArray(input?.translations)) {
    return {
      translations: [],
      skipped: strings.map((s) => ({ id: s.id, reason: 'translation failed: malformed response' })),
    };
  }

  const validTranslations: Input[] = input.translations.filter(
    (t): t is Input =>
      t !== null &&
      typeof t === 'object' &&
      typeof (t as Input).id === 'string' &&
      typeof (t as Input).text === 'string',
  );

  const returnedIds = new Set(validTranslations.map((t) => t.id));
  const skipped = strings
    .filter((s) => !returnedIds.has(s.id))
    .map((s) => ({ id: s.id, reason: 'translation failed' }));

  return { translations: validTranslations, skipped };
}
