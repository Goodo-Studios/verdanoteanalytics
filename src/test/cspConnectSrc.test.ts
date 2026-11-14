import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * connect-src used to allow https://*.supabase.co and wss://*.supabase.co, which lets script
 * running in the page send data to any Supabase project, not only ours. vercel.json is shared by
 * the production and the staging Vercel projects and the site reads its project from
 * VITE_SUPABASE_URL at build time, so the header lists the two exact project hosts.
 *
 * The browser talks to one backend (the Supabase client, edge functions and signed storage URLs
 * all live on the project host) plus Sentry. Meta ad media, fonts and frames are other directives.
 */

const PRODUCTION_HOST = 'gwyxaqoaldnaavkjqquv.supabase.co';
const STAGING_HOST = 'mnvcksbhbvypuiwozvct.supabase.co';

const repoRoot = resolve(__dirname, '../..');

function connectSrc(): string[] {
  const config = JSON.parse(readFileSync(resolve(repoRoot, 'vercel.json'), 'utf8'));
  const rules = config.headers?.flatMap((h: { headers: { key: string; value: string }[] }) => h.headers) ?? [];
  const csp = rules.find((h: { key: string }) => h.key.toLowerCase() === 'content-security-policy');
  if (!csp) throw new Error('no Content-Security-Policy header configured in vercel.json');
  const directive = csp.value
    .split(';')
    .map((part: string) => part.trim())
    .find((part: string) => part.toLowerCase().startsWith('connect-src '));
  if (!directive) throw new Error('no connect-src directive in the Content-Security-Policy');
  return directive.split(/\s+/).slice(1);
}

describe('CSP connect-src is scoped to the project hosts', () => {
  const sources = connectSrc();

  it('allows https and wss for the production project host', () => {
    expect(sources).toContain(`https://${PRODUCTION_HOST}`);
    expect(sources).toContain(`wss://${PRODUCTION_HOST}`);
  });

  it('allows https and wss for the staging project host', () => {
    expect(sources).toContain(`https://${STAGING_HOST}`);
    expect(sources).toContain(`wss://${STAGING_HOST}`);
  });

  it('has no wildcard Supabase host and no bare scheme', () => {
    for (const source of sources) {
      expect(source, `wildcard Supabase source ${source}`).not.toMatch(/\*\.supabase\./);
      expect(['https:', 'wss:', 'http:', 'ws:', '*']).not.toContain(source);
    }
  });

  it('lists no other Supabase project than the two', () => {
    const supabaseHosts = sources
      .filter((s) => /supabase\.(co|in|net)$/i.test(s))
      .map((s) => s.replace(/^[a-z]+:\/\//, ''));
    expect([...new Set(supabaseHosts)].sort()).toEqual([PRODUCTION_HOST, STAGING_HOST].sort());
  });

  it('keeps self and Sentry', () => {
    expect(sources).toContain("'self'");
    expect(sources.some((s) => s.includes('sentry.io'))).toBe(true);
  });
});
