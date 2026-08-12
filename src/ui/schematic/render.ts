import { isBodyComponent, isFinSet, type Component } from "../../model/component.js";
import {
  bodyComponentRadius,
  finRootBodyRadius,
  placeComponents,
} from "../../physics/geometry/rocket-geometry.js";

/**
 * Read-only 2D side-view schematic (top half only, since rockets are
 * axisymmetric) rendered as an SVG string, walking the SAME radius functions
 * the physics core uses — guarantees the picture can never disagree with the
 * CP/CNa calculation.
 */
export function renderSchematicSvg(
  components: Component[],
  cpX?: number,
  cgX?: number,
  widthPx = 1400,
  heightPx = 350,
): string {
  const placed = placeComponents(components);
  if (placed.length === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${widthPx} ${heightPx}" width="100%" style="height:auto; max-width:100%;"></svg>`;
  }

  // Bounding box over EVERYTHING (bodies and fins), not just body components —
  // fins extend both radially (span) and often axially (swept trailing edges
  // can extend past the body's own aft end) beyond the body outline, and both
  // need to be included or the fin geometry gets silently clipped by the SVG
  // viewport with no visible stroke on the clipped edges.
  let minX = 0;
  let maxX = 0;
  let maxR = 0;

  placed.forEach((entry, i) => {
    const c = entry.component;
    if (isBodyComponent(c)) {
      minX = Math.min(minX, entry.x0);
      maxX = Math.max(maxX, entry.x0 + c.length);
      for (let j = 0; j <= 40; j++) {
        const x = (j / 40) * c.length;
        maxR = Math.max(maxR, bodyComponentRadius(c, x));
      }
      return;
    }
    if (!isFinSet(c)) return;
    const bodyR = finRootBodyRadius(placed, i);
    const finPts = finLocalPoints(c);
    for (const [dx, dy] of finPts) {
      minX = Math.min(minX, entry.x0 + dx);
      maxX = Math.max(maxX, entry.x0 + dx);
      maxR = Math.max(maxR, bodyR + dy);
    }
  });

  const totalLength = Math.max(maxX - minX, 1e-6);
  maxR = Math.max(maxR, 1e-6);

  const margin = 35;
  const scaleX = (widthPx - 2 * margin) / totalLength;
  const scaleY = (heightPx / 2 - margin) / maxR;
  const scale = Math.min(scaleX, scaleY);
  const cy = heightPx / 2;
  const toPx = (x: number): number => margin + (x - minX) * scale;
  const toPy = (r: number): number => cy - r * scale;
  const toPyBottom = (r: number): number => cy + r * scale;

  const parts: string[] = [];

  for (const entry of placed) {
    const c = entry.component;
    if (!isBodyComponent(c)) continue;
    const n = 40;
    const topPts: string[] = [];
    const bottomPts: string[] = [];
    for (let i = 0; i <= n; i++) {
      const xLocal = (i / n) * c.length;
      const r = bodyComponentRadius(c, xLocal);
      const px = toPx(entry.x0 + xLocal);
      topPts.push(`${px},${toPy(r)}`);
      bottomPts.unshift(`${px},${toPyBottom(r)}`);
    }
    const pts = [...topPts, ...bottomPts].join(" ");
    parts.push(`<polygon points="${pts}" fill="none" stroke="#222" stroke-width="3" stroke-linejoin="round" />`);
  }

  placed.forEach((entry, i) => {
    const c = entry.component;
    if (!isFinSet(c)) return;
    // Fin outline in the fin's local (chordwise x, spanwise y) plane, drawn
    // above and below the body for a schematic top+bottom fin pair, attached
    // at the body's actual radius at the fin's root (not an approximation).
    const rootX = toPx(entry.x0);
    const bodyR = finRootBodyRadius(placed, i);
    const finPts = finLocalPoints(c);
    for (const sign of [1, -1]) {
      const pts = finPts
        .map(([dx, dy]) => {
          const px = rootX + dx * scale;
          const py = cy - sign * (bodyR + dy) * scale;
          return `${px},${py}`;
        })
        .join(" ");
      parts.push(`<polygon points="${pts}" fill="#bcd" stroke="#222" stroke-width="2.5" stroke-linejoin="round" />`);
    }
  });

  if (cpX !== undefined) {
    const x = toPx(cpX);
    parts.push(
      `<circle cx="${x}" cy="${cy}" r="8" fill="#c33" stroke="#fff" stroke-width="1.5" /><text x="${x}" y="${cy + 32}" font-size="16" text-anchor="middle">CP</text>`,
    );
  }
  if (cgX !== undefined) {
    const x = toPx(cgX);
    parts.push(
      `<circle cx="${x}" cy="${cy}" r="8" fill="#36c" stroke="#fff" stroke-width="1.5" /><text x="${x}" y="${cy - 20}" font-size="16" text-anchor="middle">CG</text>`,
    );
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${widthPx} ${heightPx}" width="100%" style="height:auto; max-width:100%;">
    <rect x="0" y="0" width="${widthPx}" height="${heightPx}" fill="#fff" />
    <line x1="${toPx(minX)}" y1="${cy}" x2="${toPx(maxX)}" y2="${cy}" stroke="#ccc" stroke-width="1.5" stroke-dasharray="6 5" />
    ${parts.join("\n")}
  </svg>`;
}

function finLocalPoints(
  c: Extract<Component, { type: "finset" | "freeformfinset" }>,
): [number, number][] {
  return c.type === "finset"
    ? [
        [0, 0],
        [c.sweepLength, c.span],
        [c.sweepLength + c.tipChord, c.span],
        [c.rootChord, 0],
      ]
    : c.points;
}
