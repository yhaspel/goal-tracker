import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { en } from '../web/src/i18n/en';
import { SPA_ROUTES } from '../worker/src/index';

/**
 * Installing the app: the web app manifest, its icons and the theme colours, each read back
 * through the front Worker exactly as a browser receives it. There is deliberately no service
 * worker — Chrome no longer needs one to offer installation — and AGENTS.md records the rule any
 * future one must keep.
 *
 * The manifest, the two `theme-color` tags and the icon files carry literal colours, because the
 * browser and the operating system read them and CSS never does. Every one of them is a copy of a
 * design token, so each is compared here with the stylesheet that actually ships — deviation 13
 * in `docs/design-system.md`.
 */

const fetchRoute = (path: string, init?: RequestInit) => SELF.fetch(new Request(`https://example.com${path}`, init));

type ManifestIcon = { src: string; sizes: string; type: string; purpose?: string };
type Manifest = {
  id?: string;
  name?: string;
  short_name?: string;
  start_url?: string;
  scope?: string;
  display?: string;
  background_color?: string;
  theme_color?: string;
  prefer_related_applications?: boolean;
  icons?: ManifestIcon[];
};

let builtStylesheet: Promise<string> | undefined;

function stylesheet(): Promise<string> {
  builtStylesheet ??= (async () => {
    const shell = await (await fetchRoute('/')).text();
    const href = shell.match(/href="(\/assets\/[^"]+\.css)"/)?.[1];
    if (!href) throw new Error('The shell does not link its stylesheet.');
    return (await fetchRoute(href)).text();
  })();
  return builtStylesheet;
}

/** A colour token's value in each theme. Each is declared twice, in order: light, then dark. */
async function token(name: string): Promise<{ light: string; dark: string }> {
  const css = await stylesheet();
  const values = [...css.matchAll(new RegExp(`--gt-${name}:\\s*([^;}\\s]+)`, 'g'))].map(match =>
    (match[1] ?? '').toLowerCase()
  );
  expect(values, `--gt-${name} is declared once per theme`).toHaveLength(2);
  return { light: values[0]!, dark: values[1]! };
}

async function manifest(): Promise<Manifest> {
  return (await (await fetchRoute('/manifest.webmanifest')).json()) as Manifest;
}

/** A PNG's size and its first pixel, which is enough to check the size and the tile colour. */
async function readPng(bytes: Uint8Array<ArrayBuffer>): Promise<{ size: string; firstPixel: string }> {
  expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let size = '';
  let colourType = -1;
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  for (let offset = 8; offset + 8 <= bytes.byteLength; ) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      size = `${view.getUint32(offset + 8)}x${view.getUint32(offset + 12)}`;
      colourType = data[9] ?? -1;
    }
    if (type === 'IDAT') chunks.push(data);
    if (type === 'IEND') break;
    offset += 12 + length;
  }
  // Truecolour, with or without alpha, so a pixel starts red, green, blue.
  expect([2, 6]).toContain(colourType);
  const compressed = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0));
  let at = 0;
  for (const chunk of chunks) {
    compressed.set(chunk, at);
    at += chunk.byteLength;
  }
  const stream = new Response(compressed).body!.pipeThrough(new DecompressionStream('deflate'));
  const pixels = new Uint8Array(await new Response(stream).arrayBuffer());
  // Byte 0 is the first row's filter type. Every PNG filter predicts the first pixel of the first
  // row from zeros, so that pixel is stored as-is whichever filter the encoder chose.
  const firstPixel = `#${[...pixels.subarray(1, 4)].map(byte => byte.toString(16).padStart(2, '0')).join('')}`;
  return { size, firstPixel };
}

describe('installing the app', () => {
  it('links the manifest, the icons and a theme colour per scheme from every shell route', async () => {
    const raised = await token('raised');
    for (const path of SPA_ROUTES) {
      const shell = await (await fetchRoute(path, { headers: { 'Sec-Fetch-Mode': 'navigate' } })).text();
      expect(shell, path).toMatch(/<link rel="manifest" href="\/manifest\.webmanifest"\s*\/?>/);
      expect(shell, path).toMatch(/<link rel="icon" href="\/favicon\.ico" sizes="16x16 32x32 48x48"\s*\/?>/);
      expect(shell, path).toMatch(/<link rel="icon" href="\/icons\/icon\.svg" type="image\/svg\+xml"\s*\/?>/);
      expect(shell, path).toMatch(/<link rel="apple-touch-icon" href="\/apple-touch-icon\.png"\s*\/?>/);
      // The title bar of an installed window runs straight into the header, in either theme.
      expect(shell, path).toContain(
        `<meta name="theme-color" content="${raised.light}" media="(prefers-color-scheme: light)"`
      );
      expect(shell, path).toContain(
        `<meta name="theme-color" content="${raised.dark}" media="(prefers-color-scheme: dark)"`
      );
    }
  });

  it('serves a manifest Chrome will install from', async () => {
    const response = await fetchRoute('/manifest.webmanifest');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type') ?? '').toMatch(/json/);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    const app = (await response.json()) as Manifest;

    // The product name is the dictionary's, which is Latin in every locale (deviation 4).
    expect(app.name).toBe(en['app.name']);
    expect(app.short_name).toBe(en['app.name']);
    // A fixed id keeps an installed copy the same app if `start_url` ever moves.
    expect(app.id).toBe('/');
    expect(app.scope).toBe('/');
    expect(app.display).toBe('standalone');
    expect(app.prefer_related_applications).not.toBe(true);
    // The window opens on a route the Worker serves the shell for; a guest is sent on to sign in.
    expect(SPA_ROUTES.has(app.start_url ?? '')).toBe(true);

    expect(app.theme_color).toBe((await token('raised')).light);
    expect(app.background_color).toBe((await token('surface')).light);

    // Chrome requires a 192px and a 512px icon. The maskable one is what Android crops to shape.
    const icons = app.icons ?? [];
    const has = (sizes: string, purpose: string) =>
      icons.some(icon => icon.sizes === sizes && icon.type === 'image/png' && (icon.purpose ?? 'any').split(' ').includes(purpose));
    expect(has('192x192', 'any')).toBe(true);
    expect(has('512x512', 'any')).toBe(true);
    expect(has('512x512', 'maskable')).toBe(true);
  });

  it('serves every icon at its declared size, cut from the steel tile', async () => {
    const steel = (await token('steel')).light;
    const onSteel = (await token('on-steel')).light;
    const pngs: Array<readonly [string, string]> = [
      ...((await manifest()).icons ?? []).map(icon => [icon.src, icon.sizes] as const),
      ['/apple-touch-icon.png', '180x180']
    ];
    for (const [src, sizes] of pngs) {
      const response = await fetchRoute(src);
      expect(response.status, src).toBe(200);
      expect(response.headers.get('content-type'), src).toBe('image/png');
      const png = await readPng(new Uint8Array(await response.arrayBuffer()));
      expect(png.size, src).toBe(sizes);
      expect(png.firstPixel, src).toBe(steel);
    }

    const favicon = await fetchRoute('/favicon.ico');
    expect(favicon.status).toBe(200);
    // An ICO header: reserved, type 1, and three images — 16, 32 and 48px.
    expect([...new Uint8Array(await favicon.arrayBuffer()).subarray(0, 6)]).toEqual([0, 0, 1, 0, 3, 0]);

    const svg = await fetchRoute('/icons/icon.svg');
    expect(svg.status).toBe(200);
    expect(svg.headers.get('content-type') ?? '').toContain('image/svg+xml');
    const markup = await svg.text();
    expect(markup).toContain(`fill="${steel}"`);
    expect(markup).toContain(`stroke="${onSteel}"`);
  });
});
