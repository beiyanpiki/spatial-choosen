# PROJECT KNOWLEDGE BASE

**Generated:** 2026-03-26 11:30:40 +08
**Commit:** fd055c8
**Branch:** main

## OVERVIEW
Next.js 16 / React 19 / TypeScript strict app for loading spatial transcriptomics bundles, storing projects locally in the browser, and annotating tissue regions on a canvas.
The repo is small but concentrated: most behavior lives in two large client routes under `src/app/` and a browser-only utility layer under `src/lib/`.

## STRUCTURE
```text
spatial-choosen/
├── src/app/             # App Router UI; Chakra-based client pages
├── src/lib/             # Bundle decoding, storage, chip math, export helpers
├── src/types/           # Shared project data model
├── .spec-workflow/      # Spec/steering templates; mostly scaffolding today
├── public/              # Stock static assets from starter template
├── task.md              # Historical product brief in Chinese
└── README.md            # Mostly create-next-app boilerplate
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| App shell, metadata, global provider | `src/app/layout.tsx`, `src/app/providers.tsx`, `src/theme.ts` | Chakra provider + Space Grotesk theme wrapper |
| Home / project creation / import flows | `src/app/page.tsx` | Large client page; bundle upload, project list, quota handling |
| Annotation workspace | `src/app/spatial/page.tsx` | Largest hotspot; canvas, geometry, region editing, export |
| Browser persistence | `src/lib/projects.ts` | localStorage metadata + IndexedDB blobs/matrix split |
| Bundle decoding / numpy parsing | `src/lib/bundleDecoder.ts` | Base64 decode, coord extraction, Fortran-to-C reorder |
| Chip layout math | `src/lib/chip.ts` | Normalized chip rect + spot grid generation |
| Portable project import/export | `src/lib/projectPackage.ts` | `.spatialproj` packaging |
| Shared domain types | `src/types/project.ts` | `Project`, `Region`, `Spot`, chip/matrix types |
| Spec workflow templates | `.spec-workflow/templates/` | Template content, not runtime behavior |

## CONVENTIONS
- App Router is present, but both main routes are client-heavy (`'use client'`). Do not assume server actions or backend APIs exist here.
- Use the `@/*` path alias from `tsconfig.json`; repo code already imports through `@/lib`, `@/types`, `@/theme`.
- Chakra UI is the active UI system. Layout/stateful UI work should match Chakra patterns before introducing custom styling.
- Browser storage is intentionally split: lightweight project metadata in `localStorage`, image/matrix payloads in IndexedDB.
- Geometry/storage helpers normalize image-relative coordinates to `0..1`; UI code converts to pixels only for rendering.

## ANTI-PATTERNS (THIS PROJECT)
- Do not move image or matrix payloads back into `localStorage`; `src/lib/projects.ts` explicitly separates them for quota reasons.
- Do not assume `README.md` captures product behavior; it is mostly starter boilerplate.
- Do not infer current repo rules from `.spec-workflow/templates/*`; those files are generic scaffolds, not implemented architecture.

## UNIQUE STYLES
- User-visible copy emphasizes “local only” behavior and browser persistence.
- The home page and annotation workspace both end with the `@M20 Genomics` footer text.
- The app supports `.spatialproj` exports plus CSV result exports; storage/export concerns are first-class, not add-ons.

## COMMANDS
```bash
npm run dev
npm run build
npm run lint
```

## NOTES
- No project tests or CI workflows are committed right now; `package-lock.json` mentions Playwright, but there is no checked-in Playwright config or test suite.
- `task.md` is worth reading for original product intent around chip rectangles, spot grids, and bundle structure.
- `public/` still contains stock starter SVG assets and is not central to app behavior.
