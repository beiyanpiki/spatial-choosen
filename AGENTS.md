# Repository Guidelines

## Project Structure & Module Organization

This is a strict TypeScript Next.js 16/React 19 application using the App Router and Chakra UI. Most work belongs under `src/`:

- `src/app/` — routes, providers, and route-specific UI; the preprocessing workspace lives in `src/app/preprocess/`.
- `src/lib/` — bundle decoding, storage, geometry, export, and browser-only domain helpers; preprocessing logic is in `src/lib/preprocess/`.
- `src/types/` — shared project and preprocessing data models.
- `public/` — static assets, chip manifests/templates, and vendored OpenCV files.
- `docs/` — supporting documentation and images.

Co-located `AGENTS.md` files contain additional route- and layer-specific conventions; read the nearest one before editing those areas.

## Build, Test, and Development Commands

```bash
npm ci                 # Install dependencies from package-lock.json
npm run dev            # Start Next.js at http://localhost:3000
npm run build          # Type-check and create the production build
npm run lint           # Run ESLint with Next.js and TypeScript rules
npm run test:unit      # Run all Vitest unit and component tests
```

`npm run test:unit -- src/lib/preprocess/alignment.test.ts` runs a focused test file.

## Coding Style & Naming Conventions

- Use two-space indentation, strict TypeScript, and the existing `@/*` import alias.
- Name React components and types in `PascalCase`; use `camelCase` for functions, variables, and hooks.
- Prefer Chakra components and props over ad-hoc CSS for interface work.
- Keep browser-dependent code guarded or confined to client components.
- ESLint uses the flat configuration in `eslint.config.mjs`; do not add generated, vendored, or build output to lint scopes.

## Testing Guidelines

Vitest runs Node tests for `src/**/*.test.ts` and jsdom component tests for `src/**/*.test.tsx`; `src/test/setup.ts` configures the DOM environment. Co-locate tests with their modules and use descriptive suffixes such as `.interaction.test.tsx` or `.rotation-contract.test.tsx`. Add regression coverage for bug fixes and meaningful domain behavior. No coverage threshold is currently configured.

## Commit & Pull Request Guidelines

Recent history favors concise Conventional Commits, especially `feat(preprocess): ...` and `fix(preprocess): ...`; otherwise use a short imperative subject. Pull requests should explain the change and user-visible behavior, link relevant issues, show test/build results, and include screenshots or recordings for UI changes. Call out storage-format, migration, or preprocessing-package compatibility impacts.

## Security & Data Handling

Do not commit sensitive sample images, patient data, or generated archives. Keep large binaries out of `localStorage`; follow the existing IndexedDB/localStorage split.
