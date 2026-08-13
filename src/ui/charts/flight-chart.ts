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

interface Panel {
  containerId: string;
  title: string;
  unitLabel: string;
  values: Float64Array;
  stroke: string;
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
      { label: panel.title, stroke: panel.stroke, width: 2, points: { show: false } },
    ],
    axes: [
      { label: "time (s)", stroke: AXIS_STROKE, grid: { stroke: GRID_STROKE }, ticks: { stroke: AXIS_STROKE } },
      { label: panel.unitLabel, stroke: AXIS_STROKE, grid: { stroke: GRID_STROKE }, ticks: { stroke: AXIS_STROKE } },
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
    },
    {
      containerId: containerIds.speed,
      title: "Speed",
      unitLabel: velocityAxisUnitLabel(),
      values: Float64Array.from(samples.map((s) => velocityAxisValue(s.speed))),
      stroke: "#e8590c",
    },
    {
      containerId: containerIds.mach,
      title: "Mach",
      unitLabel: "Mach",
      values: Float64Array.from(samples.map((s) => s.mach)),
      stroke: "#2b8a3e",
    },
    {
      containerId: containerIds.tilt,
      title: "Tilt from vertical",
      unitLabel: "deg",
      values: Float64Array.from(samples.map((s) => s.tiltFromVerticalDeg)),
      stroke: "#9c36b5",
    },
  ];

  for (const panel of panels) {
    const container = document.getElementById(panel.containerId);
    if (!container) continue;
    const chart = buildPanel(container, time, panel);
    if (chart) activeCharts.push(chart);
  }
}
