import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import type { SimSample3D } from "../../physics/sim/types3d.js";
import type { ThrustSample } from "../../physics/motor/thrustcurve-client.js";
import { altitudeAxisUnitLabel, altitudeAxisValue, forceAxisUnitLabel, forceAxisValue, velocityAxisUnitLabel, velocityAxisValue } from "../units.js";

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
 * Separate from activeCharts/destroyActiveCharts -- the thrust-curve chart lives in the motor
 * detail panel, mounted/torn down on motor selection and dry-mass/CG edits, on a different
 * lifecycle than the flight-result charts (mounted once a simulation completes, which can still be
 * showing the PREVIOUS motor's results while a new one's thrust curve is already up).
 */
let thrustChart: uPlot | null = null;

/**
 * The raw thrust-vs-time curve for whichever motor is currently selected — the actual sampled
 * ThrustCurve.org data (see this project's own linear interpolation in
 * physics/motor/interpolation.ts, and OpenRocket's own ThrustCurveMotor.getThrust, which
 * interpolates the same way over the same kind of real sample data), not a simplified
 * average/linear model — so a long-tail or spiky motor (M650-family, H128W, etc.) shows its real
 * non-linear shape here, not a smoothed approximation.
 */
export function renderThrustCurveChart(containerId: string, samples: ThrustSample[]): void {
  thrustChart?.destroy();
  thrustChart = null;
  const container = document.getElementById(containerId);
  if (!container || samples.length < 2) return;
  const time = Float64Array.from(samples.map((s) => s.time));
  thrustChart = buildPanel(container, time, {
    containerId,
    title: "Thrust",
    unitLabel: forceAxisUnitLabel(),
    values: Float64Array.from(samples.map((s) => forceAxisValue(s.thrust))),
    stroke: "#e8590c",
    axisDecimals: 0,
    // Some real motor source files don't sample from ignition (confirmed real, not hypothetical:
    // AeroTech J570W's own "cert" curve starts at t=0.039s, already well into the thrust rise) --
    // without pinning the axis, uPlot's default auto-range would start at that first sample instead
    // of 0, silently hiding that the curve doesn't cover the true start of the burn.
    xMin: 0,
    // The line between points is a straight-line interpolation, not a model of the real curve (see
    // this module's own doc comment) -- showing the actual sampled points makes that distinction
    // visible: dense sampling reads as smooth, but a sparse/coarse source file (some RASP .eng
    // files log as few as a dozen points across a multi-second burn) shows its own straight
    // segments plainly, which the line alone could otherwise pass off as real curvature.
    showPoints: true,
  });
  if (thrustChart) {
    wireTouchScrub(thrustChart);
    wireDesktopClickLock(thrustChart);
  }
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
 * Shared across all four synced charts: true once the reading has been "locked" in place --
 * either by a desktop click (see wireDesktopClickLock) or by touching at all (see wireTouchScrub,
 * which has always left the cursor in place after touchend, just under a different name until
 * now). While locked, further mouse movement is ignored (see passthroughUnlessLocked) so the
 * pinned reading stays put instead of sliding away the instant the mouse moves -- there was
 * previously no way to actually hold a reading still to compare against the other charts.
 * Cleared only by clearAllChartCursors (the reset button), which also unlocks.
 */
let scrubLocked = false;

/**
 * Notified whenever scrubLocked actually CHANGES (not on every touchmove while already locked) --
 * lets main.ts show its "reset scrub" button only once there's actually a pinned reading to clear,
 * instead of showing it unconditionally regardless of whether anyone's touched a chart yet.
 */
let onScrubLockChange: ((locked: boolean) => void) | null = null;
export function setScrubLockListener(fn: (locked: boolean) => void): void {
  onScrubLockChange = fn;
}

function setScrubLocked(locked: boolean): void {
  if (locked === scrubLocked) return;
  scrubLocked = locked;
  onScrubLockChange?.(locked);
}

type MouseListener = (e: MouseEvent) => null;
type MouseListenerFactory = (self: uPlot, targ: HTMLElement, handler: MouseListener) => MouseListener | null;

/** cursor.bind factory for mousemove/mouseleave: passes the event through to uPlot's default handler unless scrubLocked, in which case it's swallowed -- this is what actually stops the crosshair from following the mouse (or clearing on mouseleave) once locked. */
const passthroughUnlessLocked: MouseListenerFactory = (_self, _targ, handler) => (e) => {
  if (!scrubLocked) handler(e);
  return null;
};

/** Click-to-lock on desktop: the mouse has already tracked to this position via mousemove, so locking just means suppressing further movement (see passthroughUnlessLocked) rather than repositioning anything. */
function wireDesktopClickLock(u: uPlot): void {
  u.over.addEventListener("click", () => {
    setScrubLocked(true);
  });
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
    setScrubLocked(true); // same "hold it still" semantics as touchend below, set up front
    const rect = u.over.getBoundingClientRect();
    setCursorSynced(u, { left: touch.clientX - rect.left, top: touch.clientY - rect.top });
  };
  u.over.addEventListener("touchstart", setCursorFromTouch, { passive: false });
  u.over.addEventListener("touchmove", setCursorFromTouch, { passive: false });
  // touchend deliberately does NOT clear the cursor -- touch has no "mouse left the area"
  // equivalent, so the crosshair/legend values from the last touch point persist (so there's
  // actually something to read after lifting a finger) until clearAllChartCursors runs.
}

/** Moves every synced chart's cursor off-canvas and unlocks scrubbing — the reset button's whole job, since both touch scrubbing and a desktop click deliberately leave/lock the cursor in place (see wireTouchScrub/wireDesktopClickLock) rather than auto-clearing like a mouse leaving the area normally would. */
/** Current scrub-lock state -- read once at render time (see renderFlightResultHtml's own button markup) so a re-render (e.g. a unit toggle) doesn't reset an already-visible reset button back to hidden; onScrubLockChange (setScrubLockListener) handles keeping it in sync the rest of the time, as the lock state actually changes. */
export function isScrubLocked(): boolean {
  return scrubLocked;
}

export function clearAllChartCursors(): void {
  setScrubLocked(false);
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
  /** Pins the x-axis's minimum instead of uPlot's default auto-range (which starts at the first data point) — only the thrust chart needs this (see renderThrustCurveChart's own comment for why); the four flight-result charts always have a real t=0 sample, so leave this undefined there. */
  xMin?: number;
  /** Marks every actual data point on top of the connecting line -- off by default (the flight-result charts are dense simulation output, where per-point markers would just be visual noise), on for the thrust chart specifically, where the whole point is showing exactly where this motor's OWN sampled data points are, distinct from the straight-line interpolation drawn between them. */
  showPoints?: boolean;
}

/** One series against a secondary (right-side) y-axis, layered onto a Panel's own primary (left) one -- see buildPanel's own handling. Currently only used to merge Speed and Mach into one chart (they're proportional at any given altitude/temperature, so overlaying them directly makes that relationship visible instead of forcing a side-by-side comparison across two separate panels). */
interface SecondaryPanel {
  title: string;
  unitLabel: string;
  values: Float64Array;
  stroke: string;
  axisDecimals: number;
}

// uPlot draws axis ticks/labels/grid on <canvas>, not DOM text, so CSS (and hence Pico's
// light/dark theme variables) can't reach them — a fixed mid-gray reads fine on both themes,
// which is the whole point, rather than wiring up prefers-color-scheme detection for this.
const AXIS_STROKE = "#888888";
const GRID_STROKE = "rgba(136, 136, 136, 0.2)";

const X_AXIS_LABEL = "time (s)";

/** Builds a single-axis panel, or (with secondary given) two series sharing one chart -- the
 * primary against the usual left axis, the secondary against its own right-side axis with its own
 * scale, color-matched to its line/ticks so it's clear at a glance which axis belongs to which
 * series without needing to cross-reference the legend. */
function buildPanel(container: HTMLElement, time: Float64Array, panel: Panel, secondary?: SecondaryPanel): uPlot | null {
  if (container.clientWidth <= 0) return null;
  const title = secondary ? `${panel.title} / ${secondary.title}` : `${panel.title} (${panel.unitLabel})`;
  const opts: uPlot.Options = {
    title,
    width: container.clientWidth,
    height: 180,
    cursor: {
      sync: { key: "flight-charts" },
      bind: { mousemove: passthroughUnlessLocked, mouseleave: passthroughUnlessLocked },
    },
    scales: {
      x: { time: false, range: panel.xMin === undefined ? undefined : (_u, _dataMin, dataMax) => [panel.xMin!, dataMax] },
      ...(secondary ? { secondary: {} } : {}),
    },
    series: [
      // uPlot's legend defaults an unlabeled x-series to the generic "Value" -- name it after the
      // x-axis itself (same string as the axis label below) so the legend row actually says what
      // that first number is, not a placeholder.
      { label: X_AXIS_LABEL },
      {
        label: `${panel.title} (${panel.unitLabel})`,
        stroke: panel.stroke,
        width: 2,
        points: { show: panel.showPoints ?? false },
        // Legend/cursor readout shows the exact sampled float otherwise (e.g. "1234.5678900001
        // m") -- same fixed-decimals policy as the axis ticks below, just applied to the one
        // point under the cursor instead of the whole tick range.
        value: (_u, v) => (v === null || v === undefined ? "--" : v.toFixed(panel.axisDecimals)),
      },
      ...(secondary
        ? [
            {
              // Skip the redundant "(Mach)" suffix when the unit label IS the title (Mach has no
              // separate unit name, unlike "Speed (mph)") -- same guard main.ts's Max Mach stat
              // already relies on implicitly by never suffixing it with a unit at all.
              label: secondary.title === secondary.unitLabel ? secondary.title : `${secondary.title} (${secondary.unitLabel})`,
              scale: "secondary",
              stroke: secondary.stroke,
              width: 2,
              points: { show: false },
              value: (_u: uPlot, v: number | null | undefined) => (v === null || v === undefined ? "--" : v.toFixed(secondary.axisDecimals)),
            } satisfies uPlot.Series,
          ]
        : []),
    ],
    axes: [
      { label: X_AXIS_LABEL, stroke: AXIS_STROKE, grid: { stroke: GRID_STROKE }, ticks: { stroke: AXIS_STROKE } },
      {
        label: panel.unitLabel,
        // Only color-matched to the series when there's a secondary axis to disambiguate from --
        // a lone axis stays neutral gray, same as every panel before this (see AXIS_STROKE).
        stroke: secondary ? panel.stroke : AXIS_STROKE,
        grid: { stroke: GRID_STROKE },
        ticks: { stroke: AXIS_STROKE },
        values: (_u, splits) => splits.map((v) => v.toFixed(panel.axisDecimals)),
      },
      ...(secondary
        ? [
            {
              label: secondary.unitLabel,
              scale: "secondary",
              side: 1 as const, // right
              stroke: secondary.stroke,
              grid: { show: false }, // the primary axis's grid lines are enough -- a second grid would just crosshatch
              ticks: { stroke: AXIS_STROKE },
              values: (_u: uPlot, splits: number[]) => splits.map((v) => v.toFixed(secondary.axisDecimals)),
            } satisfies uPlot.Axis,
          ]
        : []),
    ],
  };
  return new uPlot(opts, secondary ? [time, panel.values, secondary.values] : [time, panel.values], container);
}

export function renderFlightChart(containerIds: {
  altitude: string;
  speedMach: string;
  tilt: string;
}, samples: SimSample3D[]): void {
  destroyActiveCharts();
  if (samples.length < 2) return;

  const time = Float64Array.from(samples.map((s) => s.time));
  // Speed and Mach are directly proportional at any given instant (Mach = speed / local speed of
  // sound) -- as separate panels they're visually near-identical curves, just rescaled, telling you
  // nothing a single overlay with two axes doesn't already show more directly.
  const speedMachSecondary: SecondaryPanel = {
    title: "Mach",
    unitLabel: "Mach",
    values: Float64Array.from(samples.map((s) => s.mach)),
    stroke: "#2b8a3e",
    axisDecimals: 2, // the second decimal is the point of showing Mach at all -- 0.8 vs 0.85 vs 0.9 matters near transonic
  };
  const panels: { panel: Panel; secondary?: SecondaryPanel }[] = [
    {
      panel: {
        containerId: containerIds.altitude,
        title: "Altitude",
        unitLabel: altitudeAxisUnitLabel(),
        values: Float64Array.from(samples.map((s) => altitudeAxisValue(s.altitude))),
        stroke: "#2f6feb",
        axisDecimals: 0, // whole meters/feet -- fractional altitude isn't meaningful at human scale
      },
    },
    {
      panel: {
        containerId: containerIds.speedMach,
        title: "Speed",
        unitLabel: velocityAxisUnitLabel(),
        values: Float64Array.from(samples.map((s) => velocityAxisValue(s.speed))),
        stroke: "#e8590c",
        axisDecimals: 1,
      },
      secondary: speedMachSecondary,
    },
    {
      panel: {
        containerId: containerIds.tilt,
        title: "Tilt from vertical",
        unitLabel: "deg",
        values: Float64Array.from(samples.map((s) => s.tiltFromVerticalDeg)),
        stroke: "#9c36b5",
        axisDecimals: 1,
      },
    },
  ];

  for (const { panel, secondary } of panels) {
    const container = document.getElementById(panel.containerId);
    if (!container) continue;
    const chart = buildPanel(container, time, panel, secondary);
    if (chart) {
      wireTouchScrub(chart);
      wireDesktopClickLock(chart);
      activeCharts.push(chart);
    }
  }
}
