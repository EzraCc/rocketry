import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import type { SimSample3D } from "../../physics/sim/types3d.js";
import { altitudeAxisUnitLabel, altitudeAxisValue, velocityAxisUnitLabel, velocityAxisValue } from "../units.js";

/**
 * Four small time-series charts (altitude, speed, Mach, tilt-from-vertical)
 * sharing a synced cursor/x-zoom, mounted into fixed placeholder divs.
 * Tilt-from-vertical is the direct visualization of weathercocking severity
 * — the project's original motivating use case (see the plan's Context) —
 * so it's included alongside the more standard altitude/speed/Mach panels
 * rather than added later as an afterthought.
 *
 * uPlot instances own real canvas/DOM nodes that main.ts's innerHTML-based
 * re-render would silently detach without releasing uPlot's own internal
 * listeners, so every mount here explicitly destroys whatever chart
 * instances it previously created before building new ones.
 */

let activeCharts: uPlot[] = [];

function destroyActiveCharts(): void {
  for (const chart of activeCharts) chart.destroy();
  activeCharts = [];
}

/**
 * u.setCursor's public .d.ts only exposes (opts, fireHook) — but uPlot's actual implementation
 * (uPlot.iife.js's updateCursor) takes a third internal _pub argument that gates whether the
 * move gets published to OTHER synced-by-key chart instances: `if (_pub) pubSync(...)`. Omitting
 * it (the public signature's default) means a manually-triggered setCursor moves only that one
 * chart's own crosshair and never reaches the other three — confirmed directly: without this,
 * touch-scrubbing the altitude chart left the speed/Mach/tilt legends stuck on "--" even though
 * the exact same gesture works correctly (syncs across all four) via real mouse events, since
 * uPlot's internal mousemove handler always passes _pub=true itself.
 */
type SetCursorInternal = (opts: { left: number; top: number }, fire: boolean, pub: boolean) => void;
function setCursorSynced(u: uPlot, opts: { left: number; top: number }): void {
  (u.setCursor as unknown as SetCursorInternal)(opts, true, true);
}

/**
 * uPlot's cursor only tracks mouse events out of the box (its own cursor.bind option is
 * mouse-only too, confirmed from its type defs — there's no built-in touch remapping), so a
 * finger drag does nothing to the crosshair/legend on a touchscreen unless wired up explicitly.
 * touchstart+touchmove both call setCursorSynced() with the touch point converted into u.over's
 * local coordinate space (what setCursor expects) — touchstart alone (not just touchmove) so a
 * single press-and-hold immediately shows a reading, not just once the finger starts moving.
 *
 * preventDefault on both events is what turns this into a deliberate "grab" gesture rather than
 * letting the touch fall through to the page's normal vertical scroll — the tradeoff being that a
 * touch that starts on a chart can no longer scroll the page from there, which is the intended
 * "click and hold to scrub" behavior, not an accidental side effect.
 */
function wireTouchScrub(u: uPlot): void {
  const setCursorFromTouch = (e: TouchEvent): void => {
    const touch = e.touches[0];
    if (!touch) return;
    e.preventDefault();
    const rect = u.over.getBoundingClientRect();
    setCursorSynced(u, { left: touch.clientX - rect.left, top: touch.clientY - rect.top });
  };
  u.over.addEventListener("touchstart", setCursorFromTouch, { passive: false });
  u.over.addEventListener("touchmove", setCursorFromTouch, { passive: false });
  // touchend deliberately does NOT clear the cursor -- touch has no "mouse left the area"
  // equivalent, so the crosshair/legend values from the last touch point persist (so there's
  // actually something to read after lifting a finger) until clearAllChartCursors runs.
}

/** Moves every synced chart's cursor off-canvas, clearing the crosshair/legend readout — the reset button's whole job, since touch scrubbing (see wireTouchScrub) deliberately leaves the cursor in place after touchend rather than auto-clearing it like a mouse leaving the area would. */
export function clearAllChartCursors(): void {
  for (const chart of activeCharts) setCursorSynced(chart, { left: -10, top: -10 });
}

interface Panel {
  containerId: string;
  title: string;
  unitLabel: string;
  values: Float64Array;
  stroke: string;
  /** Decimal places for the y-axis tick labels — uPlot's default (up to ~6 significant figures) reads as "calculator output," not a human-scale figure (e.g. "1234.5678900001 m" for altitude). Tuned per quantity: whole meters/feet for altitude, one decimal for speed, two for Mach (where the second decimal is the whole point of showing it at all). */
  axisDecimals: number;
}

// uPlot draws axis ticks/labels/grid on <canvas>, not DOM text, so CSS (and hence Pico's
// light/dark theme variables) can't reach them — a fixed mid-gray reads fine on both themes,
// which is the whole point, rather than wiring up prefers-color-scheme detection for this.
const AXIS_STROKE = "#888888";
const GRID_STROKE = "rgba(136, 136, 136, 0.2)";

function buildPanel(container: HTMLElement, time: Float64Array, panel: Panel): uPlot | null {
  if (container.clientWidth <= 0) return null;
  const opts: uPlot.Options = {
    title: `${panel.title} (${panel.unitLabel})`,
    width: container.clientWidth,
    height: 180,
    cursor: { sync: { key: "flight-charts" } },
    scales: { x: { time: false } },
    series: [
      {},
      {
        label: panel.title,
        stroke: panel.stroke,
        width: 2,
        points: { show: false },
        // Legend/cursor readout shows the exact sampled float otherwise (e.g. "1234.5678900001
        // m") -- same fixed-decimals policy as the axis ticks below, just applied to the one
        // point under the cursor instead of the whole tick range.
        value: (_u, v) => (v === null || v === undefined ? "--" : v.toFixed(panel.axisDecimals)),
      },
    ],
    axes: [
      { label: "time (s)", stroke: AXIS_STROKE, grid: { stroke: GRID_STROKE }, ticks: { stroke: AXIS_STROKE } },
      {
        label: panel.unitLabel,
        stroke: AXIS_STROKE,
        grid: { stroke: GRID_STROKE },
        ticks: { stroke: AXIS_STROKE },
        values: (_u, splits) => splits.map((v) => v.toFixed(panel.axisDecimals)),
      },
    ],
  };
  return new uPlot(opts, [time, panel.values], container);
}

export function renderFlightChart(containerIds: {
  altitude: string;
  speed: string;
  mach: string;
  tilt: string;
}, samples: SimSample3D[]): void {
  destroyActiveCharts();
  if (samples.length < 2) return;

  const time = Float64Array.from(samples.map((s) => s.time));
  const panels: Panel[] = [
    {
      containerId: containerIds.altitude,
      title: "Altitude",
      unitLabel: altitudeAxisUnitLabel(),
      values: Float64Array.from(samples.map((s) => altitudeAxisValue(s.altitude))),
      stroke: "#2f6feb",
      axisDecimals: 0, // whole meters/feet -- fractional altitude isn't meaningful at human scale
    },
    {
      containerId: containerIds.speed,
      title: "Speed",
      unitLabel: velocityAxisUnitLabel(),
      values: Float64Array.from(samples.map((s) => velocityAxisValue(s.speed))),
      stroke: "#e8590c",
      axisDecimals: 1,
    },
    {
      containerId: containerIds.mach,
      title: "Mach",
      unitLabel: "Mach",
      values: Float64Array.from(samples.map((s) => s.mach)),
      stroke: "#2b8a3e",
      axisDecimals: 2, // the second decimal is the point of showing Mach at all -- 0.8 vs 0.85 vs 0.9 matters near transonic
    },
    {
      containerId: containerIds.tilt,
      title: "Tilt from vertical",
      unitLabel: "deg",
      values: Float64Array.from(samples.map((s) => s.tiltFromVerticalDeg)),
      stroke: "#9c36b5",
      axisDecimals: 1,
    },
  ];

  for (const panel of panels) {
    const container = document.getElementById(panel.containerId);
    if (!container) continue;
    const chart = buildPanel(container, time, panel);
    if (chart) {
      wireTouchScrub(chart);
      activeCharts.push(chart);
    }
  }
}
