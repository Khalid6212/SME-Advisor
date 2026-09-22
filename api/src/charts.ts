/**
 * Chart images for the exported business plan. The docx package (see
 * docx.ts's header comment) has no native chart support, so a real image is
 * rendered server-side: a small hand-built SVG — the shapes needed here
 * (bars, a line series) are simple enough not to justify a charting library
 * dependency — rasterized to PNG via @resvg/resvg-wasm, a pure WebAssembly
 * renderer with no native addon to break across platforms. Chosen over
 * `sharp` or the native `resvg-js` specifically to avoid a native-binary
 * build risk on the alpine-based API image (see api/Dockerfile) — a wasm
 * module has nothing platform-specific to fail to compile or fail to find a
 * prebuilt binary for.
 *
 * resvg-wasm cannot see the container's fonts (WASM has no filesystem
 * access to scan for them) — `loadSystemFonts` is accepted by its types but
 * not actually wired through (see its own index.js). Text only renders at
 * all if a font is handed to it directly as bytes, hence bundling
 * dejavu-fonts-ttf (a small, permissively-licensed, pure-data npm package —
 * no native code either) and loading it once into every render call.
 */

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { Resvg, initWasm } from "@resvg/resvg-wasm";

const require = createRequire(import.meta.url);
const FONT_FAMILY = "DejaVu Sans";

let wasmReady: Promise<void> | null = null;
function ensureWasm(): Promise<void> {
  wasmReady ??= initWasm(readFileSync(require.resolve("@resvg/resvg-wasm/index_bg.wasm")));
  return wasmReady;
}

let fontBuffers: Uint8Array[] | null = null;
function loadFontBuffers(): Uint8Array[] {
  fontBuffers ??= [
    new Uint8Array(readFileSync(require.resolve("dejavu-fonts-ttf/ttf/DejaVuSans.ttf"))),
    new Uint8Array(readFileSync(require.resolve("dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf"))),
  ];
  return fontBuffers;
}

export async function svgToPng(svg: string, widthPx: number): Promise<{ buffer: Buffer; width: number; height: number }> {
  await ensureWasm();
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: widthPx },
    font: { fontBuffers: loadFontBuffers(), loadSystemFonts: false, defaultFontFamily: FONT_FAMILY },
  });
  const rendered = resvg.render();
  return { buffer: Buffer.from(rendered.asPng()), width: rendered.width, height: rendered.height };
}

const LABEL_COLOR = "#333333";
const AXIS_COLOR = "#999999";
const DEFAULT_COLOR = "#2B3A55";

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export interface BarDatum {
  label: string;
  value: number;
  color?: string;
}

/** A small vertical bar chart — 2 to 5 categories, e.g. the scenario
 *  comparison (Downside / Base / Growth). */
export function barChartSvg(
  title: string,
  data: BarDatum[],
  opts: { width?: number; height?: number; valueFormat?: (n: number) => string } = {},
): string {
  const width = opts.width ?? 640;
  const height = opts.height ?? 320;
  const fmt = opts.valueFormat ?? ((n: number) => n.toLocaleString("en-US"));
  const padding = { top: 44, right: 24, bottom: 44, left: 24 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;
  const maxAbs = Math.max(1, ...data.map((d) => Math.abs(d.value)));
  const gap = plotW / data.length;
  const barW = Math.min(90, gap * 0.55);
  const zeroY = padding.top + plotH;

  const bars = data
    .map((d, i) => {
      const x = padding.left + i * gap + (gap - barW) / 2;
      const barH = Math.max(2, (Math.abs(d.value) / maxAbs) * (plotH - 26));
      const y = zeroY - barH;
      const color = d.color ?? DEFAULT_COLOR;
      return `
        <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${barH.toFixed(1)}" fill="${color}" rx="3" />
        <text x="${(x + barW / 2).toFixed(1)}" y="${(y - 8).toFixed(1)}" text-anchor="middle" font-family="${FONT_FAMILY}" font-size="14" fill="${LABEL_COLOR}" font-weight="bold">${escapeXml(fmt(d.value))}</text>
        <text x="${(x + barW / 2).toFixed(1)}" y="${(zeroY + 20).toFixed(1)}" text-anchor="middle" font-family="${FONT_FAMILY}" font-size="13" fill="${LABEL_COLOR}">${escapeXml(d.label)}</text>
      `;
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect width="${width}" height="${height}" fill="#ffffff" />
    <text x="${width / 2}" y="22" text-anchor="middle" font-family="${FONT_FAMILY}" font-size="15" fill="${LABEL_COLOR}" font-weight="bold">${escapeXml(title)}</text>
    <line x1="${padding.left}" y1="${zeroY}" x2="${width - padding.right}" y2="${zeroY}" stroke="${AXIS_COLOR}" stroke-width="1" />
    ${bars}
  </svg>`;
}

export interface Series {
  name: string;
  color: string;
  points: number[]; // one value per category, same length and order as `categories`
}

/** A small multi-series line chart — the multi-year revenue/EBITDA trend. */
export function lineChartSvg(
  title: string,
  categories: string[],
  series: Series[],
  opts: { width?: number; height?: number; valueFormat?: (n: number) => string } = {},
): string {
  const width = opts.width ?? 640;
  const height = opts.height ?? 340;
  const fmt = opts.valueFormat ?? ((n: number) => n.toLocaleString("en-US"));
  // Right padding leaves room for each series' end-of-line value label; left
  // padding keeps the first category's x-axis label from clipping against
  // the edge, since it's centered on x = padding.left.
  const padding = { top: 44, right: 90, bottom: 56, left: 44 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;
  const allValues = series.flatMap((s) => s.points);
  const maxV = Math.max(1, ...allValues);
  const minV = Math.min(0, ...allValues);
  const range = maxV - minV || 1;
  const stepX = categories.length > 1 ? plotW / (categories.length - 1) : 0;
  const yFor = (v: number) => padding.top + plotH - ((v - minV) / range) * plotH;
  const xFor = (i: number) => padding.left + i * stepX;
  const zeroY = yFor(0);

  const lines = series
    .map((s) => {
      const pts = s.points.map((v, i) => `${xFor(i).toFixed(1)},${yFor(v).toFixed(1)}`).join(" ");
      const dots = s.points
        .map((v, i) => `<circle cx="${xFor(i).toFixed(1)}" cy="${yFor(v).toFixed(1)}" r="3.5" fill="${s.color}" />`)
        .join("");
      const lastLabel = s.points.length > 0
        ? `<text x="${(xFor(s.points.length - 1) + 6).toFixed(1)}" y="${(yFor(s.points[s.points.length - 1]!) + 4).toFixed(1)}" font-family="${FONT_FAMILY}" font-size="12" fill="${s.color}" font-weight="bold">${escapeXml(fmt(s.points[s.points.length - 1]!))}</text>`
        : "";
      return `<polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="2.5" />${dots}${lastLabel}`;
    })
    .join("");

  const xLabels = categories
    .map(
      (c, i) =>
        `<text x="${xFor(i).toFixed(1)}" y="${(padding.top + plotH + 20).toFixed(1)}" text-anchor="middle" font-family="${FONT_FAMILY}" font-size="12" fill="${LABEL_COLOR}">${escapeXml(c)}</text>`,
    )
    .join("");

  const legend = series
    .map(
      (s, i) => `
      <rect x="${padding.left + i * 150}" y="${height - 18}" width="10" height="10" fill="${s.color}" />
      <text x="${padding.left + i * 150 + 16}" y="${height - 9}" font-family="${FONT_FAMILY}" font-size="11" fill="${LABEL_COLOR}">${escapeXml(s.name)}</text>
    `,
    )
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect width="${width}" height="${height}" fill="#ffffff" />
    <text x="${width / 2}" y="22" text-anchor="middle" font-family="${FONT_FAMILY}" font-size="15" fill="${LABEL_COLOR}" font-weight="bold">${escapeXml(title)}</text>
    <line x1="${padding.left}" y1="${zeroY.toFixed(1)}" x2="${width - padding.right}" y2="${zeroY.toFixed(1)}" stroke="${AXIS_COLOR}" stroke-width="1" />
    ${lines}
    ${xLabels}
    ${legend}
  </svg>`;
}
