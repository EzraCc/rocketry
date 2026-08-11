import { isBodyComponent, type Component } from "../../model/component.js";
import {
  bodyComponentRadius,
  overallLength,
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
  widthPx = 800,
  heightPx = 200,
): string {
  const length = overallLength(components);
  if (length <= 0) return `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}"></svg>`;

  const placed = placeComponents(components);
  let maxR = 0;
  for (const entry of placed) {
    if (!isBodyComponent(entry.component)) continue;
    const c = entry.component;
    for (let i = 0; i <= 40; i++) {
      const x = (i / 40) * c.length;
      maxR = Math.max(maxR, bodyComponentRadius(c, x));
    }
  }
  maxR = Math.max(maxR, 1e-6);

  const margin = 20;
  const scaleX = (widthPx - 2 * margin) / length;
  const scaleY = (heightPx / 2 - margin) / maxR;
  const scale = Math.min(scaleX, scaleY);
  const cy = heightPx / 2;
  const toPx = (x: number): number => margin + x * scale;
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
    parts.push(`<polygon points="${pts}" fill="none" stroke="#333" stroke-width="1.5" />`);
  }

  for (const entry of placed) {
    const c = entry.component;
    if (c.type !== "finset" && c.type !== "freeformfinset") continue;
    // Fin outline in the fin's local (chordwise x, spanwise y) plane, drawn
    // above and below the body for a schematic top+bottom fin pair.
    const rootX = toPx(entry.x0);
    const bodyR = maxR; // approximate attach point at the widest body radius for the schematic
    const finPts: [number, number][] =
      c.type === "finset"
        ? [
            [0, 0],
            [c.sweepLength, c.span],
            [c.sweepLength + c.tipChord, c.span],
            [c.rootChord, 0],
          ]
        : c.points;
    for (const sign of [1, -1]) {
      const pts = finPts
        .map(([dx, dy]) => {
          const px = rootX + dx * scale;
          const py = cy - sign * (bodyR + dy) * scale;
          return `${px},${py}`;
        })
        .join(" ");
      parts.push(`<polygon points="${pts}" fill="#bcd" stroke="#333" stroke-width="1" />`);
    }
  }

  if (cpX !== undefined) {
    const x = toPx(cpX);
    parts.push(
      `<circle cx="${x}" cy="${cy}" r="5" fill="#c33" /><text x="${x}" y="${cy + 20}" font-size="10" text-anchor="middle">CP</text>`,
    );
  }
  if (cgX !== undefined) {
    const x = toPx(cgX);
    parts.push(
      `<circle cx="${x}" cy="${cy}" r="5" fill="#36c" /><text x="${x}" y="${cy - 12}" font-size="10" text-anchor="middle">CG</text>`,
    );
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}">
    <line x1="${margin}" y1="${cy}" x2="${widthPx - margin}" y2="${cy}" stroke="#ccc" stroke-dasharray="4 3" />
    ${parts.join("\n")}
  </svg>`;
}
