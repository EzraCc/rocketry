Status: done
Priority: high
Type: chore
Last updated: 2026-08-24

# Disable RASAero (.CDX1) import in the upload UI

## Context

User: "we haven't tested .cdx1 files for RasAero, let's remove support for
them for now. We built around .rkt and are having too many issues to claim
.cdx1 without further testing."

Scoped as a temporary UI-level disable, not a deletion — the parser
(`src/formats/rasaero/parse.ts`) and its tests are real, already-passing
code (verified against OpenRocket's own Java RASAero importer and three
real .CDX1 fixtures, per that file's own doc comment), just not something
this project wants to claim as supported to end users yet. "For now"
implies re-enabling later once it's had the same real-file testing pass
`.ork`/`.rkt` got this session, not permanent removal.

## Tasks

- [x] `src/main.ts`: removed `.CDX1` from the upload `<input accept=...>`
      list and the upload-section copy ("(.ork, .rkt, or .CDX1)" ->
      "(.ork or .rkt)").
- [x] `wireOrkImport`'s upload handler: replaced the `.cdx1` branch (which
      called `parseRasaeroXml`) with an explicit, clear rejection — throws
      "RASAero (.CDX1) import isn't supported yet..." which flows into the
      existing "Failed to import: ..." error surface, rather than either
      silently mis-parsing a .cdx1 as .ork (confusing generic XML error) or
      quietly still accepting it.
- [x] Removed the now-unused `parseRasaeroXml` import from `main.ts`.
- [x] Updated the one other user-facing string that named `.CDX1` as a
      supported source format (the "How Computed CP is calculated" info
      panel).
- [x] `README.md`: updated both mentions (feature list + project layout) to
      note `.CDX1` import exists in the codebase but is disabled in the UI
      for now, rather than silently going stale.
- [x] Full suite still green: 32 files / 673 tests (including
      `src/formats/rasaero/parse.test.ts`, untouched and still passing),
      `tsc --noEmit` clean.

## Decisions

- Left `src/formats/rasaero/parse.ts`, its tests, and the internal code
  comments describing RASAero's data-model behavior (in `main.ts`,
  `lib.ts`, `ui/embed.ts`) untouched — those still accurately describe the
  underlying type/data model, which didn't change; only the upload UI's
  reachability did.
- Deliberately did NOT touch `src/lib.ts`'s exported `simulateFromRasaero`
  (the published library API surface, per its own doc comment consumed by
  "a consumer like splashcast"). The user's complaint was specifically
  about testing `.cdx1` files through this app's own upload flow; disabling
  a separate external API contract without knowing whether anything live
  currently depends on it is a bigger, harder-to-reverse call than a UI
  toggle. Flagged to the user — worth a follow-up decision if RASAero
  import should also be pulled from the library API.

## Detours

None.

## Open questions

- Should `src/lib.ts`'s `simulateFromRasaero`/`parseRasaeroXml` exports also
  be disabled or removed? Left alone pending the user's explicit call (see
  Decisions above).
