# rocketry

A browser-based flight simulator for basic model/high-power rockets (nose cone, body tubes,
transitions/boat tails, trapezoidal fins). Client-side TypeScript, no backend.

This is an independent project — not a fork, submodule, or dependent package of OpenRocket.
Formulas are re-derived/re-implemented from OpenRocket's published algorithms (see inline
comments citing specific source files) rather than transcribed verbatim, so this project carries
no GPL encumbrance from OpenRocket's codebase.

## Status: M1 checkpoint

Static geometry + Barrowman CP/stability calculator (nose cone / body tube / transition-or-boat-tail
shapes, trapezoidal fins, corrected fin body-interference formula). No motor data, no flight
integrator yet — those are M2/M3.

## Dev

    npm install
    npm run dev     # dev server, see src/main.ts demo
    npm test        # vitest unit suite
    npm run build   # production build
