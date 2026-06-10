import { NextResponse } from 'next/server';
import { translate } from '@/lib/anthropic';
import { checkRateLimit } from '@/lib/rate-limit';
import type { TranslateRequest, TranslateResponse } from '@/lib/translate-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_LAYERS = 50;

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
        error:
          rate.reason === 'global'
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
