import type { Component } from "../../model/component.js";
import { isBodyComponent } from "../../model/component.js";
import {
  finRootBodyRadius,
  placeComponents,
  referenceDiameter,
} from "../geometry/rocket-geometry.js";
import { symmetricComponentAero } from "./symmetric-component-calc.js";
import { trapezoidFinAero } from "./fin-calc.js";
import { freeformFinAero } from "./freeform-fin-calc.js";

export interface BarrowmanResult {
  cna: number; // per radian, rocket total
  cpX: number; // m from nose tip
  refDiameter: number;
  refArea: number;
}

/**
 * Total rocket CNa and CP: sum of each component's (cna, cp) pair, with CP
 * being the CNa-weighted average axial position — the standard Barrowman
 * combination rule (equivalent to OpenRocket's AerodynamicForces.merge).
 */
export function computeBarrowman(components: Component[], mach: number): BarrowmanResult {
  const refDiameter = referenceDiameter(components);
  const refArea = Math.PI * (refDiameter / 2) ** 2;
  const placed = placeComponents(components);

  let cnaSum = 0;
  let cnaXSum = 0;

  placed.forEach((entry, i) => {
    const c = entry.component;
    if (isBodyComponent(c)) {
      const { cna, cpX } = symmetricComponentAero(c, refArea);
      cnaSum += cna;
      cnaXSum += cna * (entry.x0 + cpX);
      return;
    }
    // fin set
    if (refArea < 1e-9) return;
    const bodyRadius = finRootBodyRadius(placed, i);
    const { cna, cpX } =
      c.type === "finset"
        ? trapezoidFinAero(c, bodyRadius, mach, refArea)
        : freeformFinAero(c, bodyRadius, mach, refArea);
    cnaSum += cna;
    cnaXSum += cna * (entry.x0 + cpX);
  });

  const cpX = Math.abs(cnaSum) > 1e-9 ? cnaXSum / cnaSum : 0;
  return { cna: cnaSum, cpX, refDiameter, refArea };
}

/** Static stability margin in calibers: (CP - CG) / referenceDiameter. Positive = stable. */
export function stabilityMargin(cpX: number, cgX: number, refDiameter: number): number {
  if (refDiameter < 1e-9) return 0;
  return (cpX - cgX) / refDiameter;
}
