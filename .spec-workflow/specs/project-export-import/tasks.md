# Tasks Document

- [x] 1. Implement project packaging module
  - File: src/lib/projectPackage.ts
  - Create serialization/deserialization for Project ⇄ `.spatialproj` blob with versioning and matrix base64 handling.
  - Purpose: Provide single-responsibility service for export/import.
  - _Leverage: src/lib/bundleDecoder.ts (base64 helpers), src/types/project.ts_
  - _Requirements: Requirement 1, Requirement 2_
  - _Prompt: Role: TypeScript utility engineer focused on data serialization | Task: Implement the projectPackage module to serialize/deserialize full Project objects into a versioned `.spatialproj` Blob, including matrix ArrayBuffer via base64, validating schema and version | Restrictions: Keep in-browser only, no external deps, return clear errors on invalid version/payload | _Leverage: src/lib/bundleDecoder.ts base64 helpers, src/types/project.ts_ | _Requirements: Requirement 1, Requirement 2_ | Success: Round-trip works for projects with/without matrixData; invalid version/files rejected with descriptive errors.

- [x] 2. Add Export Project flow in spatial page
  - File: src/app/spatial/page.tsx
  - Replace existing export handler to use projectPackage serialization, include size toast, keep CSV export optional.
  - Purpose: Allow one-click export of full project package.
  - _Leverage: src/lib/projectPackage.ts, src/lib/projects.ts (getProject), existing toast patterns_
  - _Requirements: Requirement 1_
  - _Prompt: Role: React/TypeScript engineer | Task: Wire the spatial page Export CTA to use serializeProject, hydrate missing matrix via getProject if needed, download `.spatialproj`, and toast success/error; keep labeled CSV export as today | Restrictions: No blocking UI, handle failures gracefully | _Leverage: projectPackage, projects storage helpers_ | _Requirements: Requirement 1_ | Success: Export downloads a `.spatialproj` file with full data, toasts reflect outcome, CSV export still available.

- [x] 3. Add Import Project flow on Home
  - File: src/app/page.tsx
  - Add “Import Project” button + file input; on select, deserialize and persist respecting capacity dialog; refresh Recent.
  - Purpose: Let users restore a packaged project and continue editing.
  - _Leverage: src/lib/projectPackage.ts, src/lib/projects.ts (upsertProject/persist), existing capacity dialog logic_
  - _Requirements: Requirement 2_
  - _Prompt: Role: React/TypeScript engineer | Task: Implement Home import flow: file picker accepts `.spatialproj`, calls deserializeProject, enforces MAX_RECENT_PROJECTS using existing capacity dialog, upserts then refreshes recent list | Restrictions: Reject invalid/version-mismatched files with clear error; no network calls | _Leverage: projectPackage, projects storage_ | _Requirements: Requirement 2_ | Success: Valid imports appear at top of Recent, capacity prompts when full, errors surfaced without mutating state.
