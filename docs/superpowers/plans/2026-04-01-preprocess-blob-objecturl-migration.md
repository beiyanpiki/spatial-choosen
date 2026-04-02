# Preprocess Blob ObjectURL Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace preprocess data URL-based source image persistence with Blob-backed IndexedDB storage and runtime ObjectURLs, while keeping legacy saved projects readable and preserving preprocess export/import behavior.

**Architecture:** Source images become binary-first: Blob is persisted in IndexedDB, ObjectURL exists only at runtime, and legacy data URL projects are lazily migrated on load/save. Runtime UI and processing consume generic image URLs or blob-backed payloads, while package/export reads binary payloads instead of assuming embedded base64 source images.

**Tech Stack:** Next.js App Router, React 19, TypeScript strict, IndexedDB, Blob/ObjectURL browser APIs, Playwright, JSZip

---

### Task 1: Contract and storage foundation

**Files:**
- Modify: `src/types/preprocess.ts`
- Modify: `src/lib/preprocess/constants.ts`
- Modify: `src/lib/preprocess/storage.ts`
- Modify: `src/app/preprocess/page.tsx`
- Test: `tests/e2e/preprocess-export.spec.ts`

- [ ] Define persisted blob-backed fields and runtime-only URL fields for preprocess source images.
- [ ] Update preprocess storage versioning/constants for blob-backed source persistence.
- [ ] Make storage persist blobs in IndexedDB, hydrate runtime ObjectURLs, and fall back to legacy data URLs for old projects.
- [ ] Add or update a Playwright recovery/export test so legacy projects still load and blob-backed projects hydrate correctly.
- [ ] Run the targeted test and fix contract/storage issues before moving on.

### Task 2: Upload and runtime consumer migration

**Files:**
- Modify: `src/lib/preprocess/sourceImage.ts`
- Modify: `src/app/preprocess/components/PreprocessWorkspace.tsx`
- Modify: `src/app/preprocess/components/CanvasStage.tsx`
- Modify: `src/app/preprocess/components/AlignmentPanel.tsx`
- Modify: `src/app/preprocess/components/CropQcPanel.tsx`
- Modify: `src/app/preprocess/components/ChipConfigPanel.tsx`
- Modify: `src/app/preprocess/components/TissueSelectionPanel.tsx`
- Test: `tests/e2e/preprocess-upload-support.spec.ts`
- Test: `tests/e2e/preprocess-localize-align-gating.spec.ts`

- [ ] Change source image creation to return blob-backed payloads and runtime URLs instead of canonical data URLs.
- [ ] Update workspace gating and render consumers to prefer runtime ObjectURLs and only fall back to legacy data URLs.
- [ ] Ensure ObjectURL lifecycle is owned centrally so replaced/unmounted images are revoked.
- [ ] Run upload/gating Playwright coverage to prove TIFF/BMP-capable upload paths still advance the workflow.

### Task 3: Processing and binary export/package support

**Files:**
- Modify: `src/lib/preprocess/cropQc.ts`
- Modify: `src/lib/preprocess/tissuePipeline.ts`
- Modify: `src/lib/preprocess/package.ts`
- Modify: `src/lib/preprocess/exportBundle.ts`
- Test: `tests/e2e/preprocess-export.spec.ts`
- Test: `tests/e2e/preprocess-failure-return.spec.ts`
- Test: `tests/e2e/preprocess-tissue-auto.spec.ts`
- Test: `tests/e2e/preprocess-tissue-edit.spec.ts`

- [ ] Make processing entrypoints consume blob-backed/runtime URL image sources without assuming source data URLs.
- [ ] Keep derived previews working while removing source-image dependence on persisted base64 strings.
- [ ] Evolve preprocess package/export so it serializes binary payloads and still accepts legacy inline-data-url imports.
- [ ] Run targeted Playwright export/import/tissue regressions and fix compatibility issues.

### Task 4: Full verification

**Files:**
- Modify only if verification reveals migration-caused defects.

- [ ] Run `lsp_diagnostics` on all changed files.
- [ ] Run targeted Playwright specs for upload, recovery, export, and tissue flows.
- [ ] Run `npm run lint` and `npm run build`.
- [ ] Perform manual QA for one blob-backed upload flow and one legacy-fallback load path.
