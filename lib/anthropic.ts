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
      "- Match the source's capitalisation style (ALL CAPS stays ALL CAPS).",
      '- Keep the tone punchy and natural; favour idiomatic over literal.',
      '- Do NOT add line breaks; layout handles reflow.',
      '- Return every input id. If you cannot translate one, omit it.',
    ].join('\n'),
    tools: [
      {
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
      },
    ],
    tool_choice: { type: 'tool', name: 'submit_translations' },
    messages: [
      {
        role: 'user',
        content: `Translate to ${language}:\n\n${JSON.stringify(strings, null, 2)}`,
      },
    ],
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
