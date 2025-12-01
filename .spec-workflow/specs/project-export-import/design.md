# Design Document

## Overview

Implement a portable project package flow that complements the existing “Export” (results) action. The feature adds:
- **Export Project** in the spatial editor: package full project state (metadata, bundle preview, regions, spot/matrix data) into a single downloadable `.spatialproj` file, fully client-side.
- **Import Project** on Home: ingest a `.spatialproj` file, validate schema/version, and insert into Recent (respecting capacity rules) so users can open and continue editing without re-uploading assets.
This preserves the local-first model and enables backup/share across sessions/devices.

## Steering Document Alignment

### Technical Standards (tech.md)
- Keep all processing in-browser; no network calls.
- Use existing storage helpers and IndexedDB for large binaries; avoid new dependencies when native APIs suffice.

### Project Structure (structure.md)
- UI changes stay within existing pages: `src/app/spatial/page.tsx` (export CTA/logic) and `src/app/page.tsx` (Home import CTA/flow).
- New serialization module lives in `src/lib/projectPackage.ts` to keep concerns separated.

## Code Reuse Analysis

### Existing Components to Leverage
- **`src/lib/projects.ts`**: read/upsert/delete projects; reuse to persist imported packages and fetch full project data (including matrix/image).
- **Capacity dialog logic in `src/app/page.tsx`**: reuse for enforcing `MAX_RECENT_PROJECTS`.
- **Toast/feedback patterns** in spatial & Home pages for success/error surfacing.
- **Base64 helpers** in `src/lib/bundleDecoder.ts` for ArrayBuffer ⇄ base64 conversions.

### Integration Points
- **Home Recent list**: after import, use `upsertProject` + existing state refresh to display the restored project.
- **Spatial export button**: replace/extend current simple JSON+CSV export to call the packer and trigger download.
- **Storage layer (IndexedDB/localStorage)**: still used as the persistence target after import.

## Architecture

- Introduce **`projectPackage.ts`** providing:
  - `PACKAGE_VERSION = 1`
  - `serializeProject(project: Project): Promise<Blob>`: builds JSON payload `{ version, project, matrixDataBase64? }`, where `project.matrixData` and `matrixDataBase64` hold the same buffer; strips transient UI-only fields. Returns a `Blob` with mime `application/x-spatialproj+json`.
  - `deserializeProject(file: File): Promise<Project>`: parses JSON, validates version/schema, reconstructs `ArrayBuffer` from base64 into `project.matrixData`, ensures required fields.
- Export flow (Spatial page):
  - Ensure `matrixData` is loaded (if missing, try `getProject(project.id)` to hydrate from IndexedDB).
  - Call `serializeProject`, trigger download with filename `${project.name || 'project'}.spatialproj`.
  - On success, show toast with size; on failure, error toast.
- Import flow (Home page):
  - Add “Import Project” button with hidden file input.
  - On file select, call `deserializeProject`.
  - Before persist, check capacity: if over limit, show existing capacity dialog; if confirmed, trim oldest then persist.
  - Insert project at top using `upsertProject` and refresh state; navigate to spatial page on user action (open).
- File format keeps KISS: single JSON blob with base64 for binary; no compression/deps. Ready for future versioned migrations via `PACKAGE_VERSION`.

### Modular Design Principles
- **Single File Responsibility**: `projectPackage.ts` handles serialization concerns only; pages manage UI and flow.
- **Component Isolation**: New import control isolated in Home page section; export hook isolated in Spatial page.
- **Service Layer Separation**: Storage (projects.ts) untouched; packaging layer added between UI and storage.
- **Utility Modularity**: Reuse base64 utilities; add minimal buffer helpers if needed.

## Components and Interfaces

### `projectPackage.ts`
- **Purpose:** Convert `Project` ↔ portable package blob/file.
- **Interfaces:** `serializeProject(project)`, `deserializeProject(file)`, `PACKAGE_VERSION`.
- **Dependencies:** `Project` type, base64 helpers, `TextDecoder/Encoder`.
- **Reuses:** `base64ToUint8Array` (bundleDecoder), `ArrayBuffer` handling.

### Spatial Export action (in `src/app/spatial/page.tsx`)
- **Purpose:** Provide “Export Project” CTA that saves `.spatialproj`.
- **Interfaces:** Extends existing `handleExportProject` to call new packer; keeps CSV export optional/unchanged.
- **Dependencies:** `serializeProject`, `toast`, `upsertProject` (for hydration fallback).
- **Reuses:** Existing export button placement and feedback.

### Home Import control (in `src/app/page.tsx`)
- **Purpose:** Let users select a `.spatialproj` file and add it to Recent, enforcing capacity.
- **Interfaces:** New handler `handleImportProject(file)` + file input/button.
- **Dependencies:** `deserializeProject`, `upsertProject`, capacity dialog, router navigation.
- **Reuses:** Recent list refresh logic, capacity overflow dialog.

## Data Models

### Package Payload (version 1)
```
type ProjectPackageV1 = {
  version: 1;
  project: Project & { matrixData?: undefined }; // matrix removed to avoid double storage
  matrixDataBase64?: string; // optional when matrix exists
};
```
- `project.matrixData` is reattached after decoding `matrixDataBase64`.
- Optional to support projects without matrices.

## Error Handling

### Error Scenarios
1. **Invalid file type or JSON parse failure**
   - **Handling:** Reject with user-facing error “File is not a valid Spatial project package.”
   - **User Impact:** Toast/inline alert; no state change.
2. **Version mismatch**
   - **Handling:** Reject versions other than `1`; message instructs to re-export with latest app.
   - **User Impact:** Error toast; nothing persisted.
3. **Capacity overflow on import**
   - **Handling:** Reuse capacity dialog; only proceed after user confirms trimming oldest entries.
   - **User Impact:** Clear prompt; no silent deletions.
4. **IndexedDB failures during persist**
   - **Handling:** Catch and show “Save failed”; leave storage untouched; keep parsed project in memory not added to list.

## Testing Strategy

### Unit Testing
- Test `serializeProject`/`deserializeProject` round-trip for:
  - Project with matrix data.
  - Project without matrix.
  - Version mismatch/invalid payload.

### Integration Testing
- Home import flow: capacity dialog triggers when limit reached; successful import shows in Recent.
- Spatial export flow: clicking export downloads `.spatialproj`; toast appears.

### End-to-End Testing
- Scenario: Export a project, clear local storage/IndexedDB, import the exported file on Home, open and verify annotations/matrix rendered.
