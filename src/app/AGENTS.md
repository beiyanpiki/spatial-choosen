# APP ROUTES GUIDE

## OVERVIEW
`src/app/` is the UI layer: Chakra-based App Router pages, global layout/provider wiring, and the annotation route.

## STRUCTURE
```text
src/app/
├── layout.tsx        # Metadata + HTML shell
├── providers.tsx     # ChakraProvider wrapper
├── globals.css       # Minimal global resets + font/body colors
├── page.tsx          # Home / import / recent-project flow
├── spatial/page.tsx  # Annotation workspace
└── page.module.css   # Legacy starter CSS; not driving current pages
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Global metadata / document shell | `layout.tsx` | Space Grotesk font + app metadata |
| Theme/provider wiring | `providers.tsx`, `../theme.ts` | ChakraProvider with custom `brand` colors |
| Landing page interactions | `page.tsx` | Bundle upload, project creation, import/delete dialogs |
| Annotation route details | `spatial/page.tsx` | Canvas/editor hotspot; see child AGENTS |
| Global resets | `globals.css` | Body colors, font, box sizing |

## CONVENTIONS
- Prefer Chakra components and props over ad-hoc CSS for page work.
- Route files are client components when they need browser APIs; `page.tsx` and `spatial/page.tsx` both depend on browser-only behavior.
- `layout.tsx` is thin by design: metadata + provider wrapper only.
- `spatial/page.tsx` is wrapped in `Suspense` because it reads `useSearchParams()`.

## ANTI-PATTERNS
- Do not edit `page.module.css` expecting current home/annotation pages to change; it is not imported by the active route files.
- Do not introduce server-only patterns into the route pages without first separating browser APIs like IndexedDB, `Image`, file input, or canvas logic.
- Do not bypass `Providers`; Chakra theme assumptions are shared across both pages.

## NOTES
- Home-page export is `dynamic(() => Promise.resolve(HomePage), { ssr: false })`; keep that in mind before moving browser work into shared helpers.
- The real complexity in this tree is behavioral, not structural: two oversized route files dominate the app.
