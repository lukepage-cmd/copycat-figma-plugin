import { describe, it, expect, vi } from 'vitest';
import { translate } from './anthropic';

describe('translate', () => {
  it('returns translations from a tool_use response', async () => {
    const fakeClient = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [
            {
              type: 'tool_use',
              name: 'submit_translations',
              input: {
                translations: [
                  { id: 'a', text: 'Bonjour' },
                  { id: 'b', text: 'Monde' },
                ],
              },
            },
          ],
        }),
      },
    };

    const result = await translate(
      'French',
      [
        { id: 'a', text: 'Hello' },
        { id: 'b', text: 'World' },
      ],
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
          content: [
            {
              type: 'tool_use',
              name: 'submit_translations',
              input: { translations: [{ id: 'a', text: 'Bonjour' }] },
            },
          ],
        }),
      },
    };

    const result = await translate(
      'French',
      [
        { id: 'a', text: 'Hello' },
        { id: 'b', text: 'World' },
      ],
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
    expect(result.skipped).toEqual([
      { id: 'a', reason: 'translation failed: model did not call the tool' },
    ]);
  });

  it('skips everything if tool input.translations is not an array', async () => {
    const fakeClient = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [
            {
              type: 'tool_use',
              name: 'submit_translations',
              input: { translations: null },
            },
          ],
        }),
      },
    };

    const result = await translate(
      'French',
      [{ id: 'a', text: 'Hello' }],
      fakeClient as never,
    );

    expect(result.translations).toEqual([]);
    expect(result.skipped).toEqual([
      { id: 'a', reason: 'translation failed: malformed response' },
    ]);
  });
});
