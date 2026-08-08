import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The 2026-08-08 security remediation (#115) added a Content-Security-Policy to
 * vercel.json with no `media-src` and no `frame-src`. Both silently fall back to
 * `default-src 'self'`, which blocked:
 *
 *   - every `<video>` in the app (creative previews and Vault items are served
 *     from Supabase Storage signed URLs and Meta's CDN — all cross-origin), and
 *   - the Meta-hosted ad preview `<iframe>` in CreativeDetailModal.
 *
 * Thumbnails kept working because `img-src` already allowed `https:`, so the
 * breakage looked like "the video won't play" rather than an obviously broken
 * page. Nothing in the suite covered the header, so CI was green.
 *
 * These tests pin the directives the app actually depends on.
 */

const repoRoot = resolve(__dirname, '../..');

interface CspDirectives {
  [directive: string]: string[];
}

function parseCsp(): CspDirectives {
  const config = JSON.parse(readFileSync(resolve(repoRoot, 'vercel.json'), 'utf8'));
  const rules = config.headers?.flatMap((h: { headers: { key: string; value: string }[] }) => h.headers) ?? [];
  const csp = rules.find((h: { key: string }) => h.key.toLowerCase() === 'content-security-policy');
  if (!csp) throw new Error('no Content-Security-Policy header configured in vercel.json');

  return Object.fromEntries(
    csp.value
      .split(';')
      .map((part: string) => part.trim())
      .filter(Boolean)
      .map((part: string) => {
        const [name, ...values] = part.split(/\s+/);
        return [name.toLowerCase(), values];
      }),
  );
}

/** A directive that isn't declared inherits default-src — usually not what we want. */
function effective(csp: CspDirectives, directive: string): string[] | undefined {
  return csp[directive];
}

describe('CSP allows the media the app actually loads', () => {
  const csp = parseCsp();

  it('still sets a restrictive default-src', () => {
    expect(csp['default-src']).toEqual(["'self'"]);
  });

  it('declares media-src explicitly rather than inheriting default-src', () => {
    // Without this, every cross-origin <video> is blocked.
    expect(effective(csp, 'media-src')).toBeDefined();
  });

  it('allows video from Supabase Storage and CDN origins', () => {
    const mediaSrc = effective(csp, 'media-src') ?? [];
    const allowsAllHttps = mediaSrc.includes('https:');
    const allowsSupabase = mediaSrc.some((s) => s.includes('supabase.co'));
    expect(allowsAllHttps || allowsSupabase).toBe(true);
  });

  it('allows blob: and data: media, which the capture flow produces locally', () => {
    const mediaSrc = effective(csp, 'media-src') ?? [];
    expect(mediaSrc).toContain('blob:');
    expect(mediaSrc).toContain('data:');
  });

  it('declares frame-src so the Meta ad preview embed can load', () => {
    const frameSrc = effective(csp, 'frame-src');
    expect(frameSrc).toBeDefined();
    // CreativeDetailModal embeds business.facebook.com/ads/api/preview_iframe.php
    expect((frameSrc ?? []).some((s) => s.includes('facebook.com'))).toBe(true);
  });

  it('keeps the protections the remediation added', () => {
    expect(csp['object-src']).toEqual(["'none'"]);
    expect(csp['frame-ancestors']).toEqual(["'none'"]);
    expect(csp['base-uri']).toEqual(["'self'"]);
    expect(csp['script-src']).toEqual(["'self'"]);
  });

  it('does not loosen frame-ancestors while opening frame-src', () => {
    // frame-src governs what we may embed; frame-ancestors governs who may embed
    // us. Widening the first must never widen the second.
    expect(csp['frame-ancestors']).not.toContain('https:');
    expect(csp['frame-ancestors']).not.toContain("'self'");
  });
});
