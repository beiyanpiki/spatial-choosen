# Requirements Document

## Introduction

Add a portable “Export Project” feature that packages the entire spatial annotation project (bundle JSON, derived metadata, annotations, and identifiers) into a single file, and a Home-screen “Import Project” action that restores a packaged project so users can resume editing without re-uploading assets. This preserves local-first privacy while enabling backup/sharing and continuity across sessions or devices.

## Alignment with Product Vision

Spatial keeps projects local and lightweight; exports remain fully client-side to avoid transmitting slide data, and imports respect the existing recent-project capacity rules so the Home flow stays predictable. Offline-friendly packaging aligns with PWA guidance to provide continuity regardless of connectivity.

## Requirements

### Requirement 1 — Export packaged project

**User Story:** As a spatial annotator, I want to export the entire project as one portable file so I can back it up or move it to another device and continue working later.

#### Acceptance Criteria

1. WHEN the user is viewing a project and selects “Export Project” THEN the app packages all project data (bundle JSON, annotations, chip type, hull/matrix, preview image, metadata, version) into a single file (e.g., `.spatialproj`) and triggers a download without uploading data to a server.
2. IF packaging fails (e.g., missing bundle pieces, exceeded in-memory limit, or serialization error) THEN the user sees an error message with a retry hint and no partial file is kept.
3. WHEN export completes THEN a success toast shows file name and size, and the operation does not block the UI thread (use async/worker-friendly approach).

### Requirement 2 — Import packaged project from Home

**User Story:** As a returning user, I want to import a previously exported project file from the Home page so I can pick up where I left off.

#### Acceptance Criteria

1. WHEN the user clicks “Import Project” on Home and selects a valid `.spatialproj` file THEN the app validates schema/version, restores bundle + annotations, and adds the project to Recent at the top while observing the MAX_RECENT_PROJECTS rule (prompting to replace the oldest when full, reusing existing capacity dialog).
2. IF the selected file is invalid, corrupted, or version-incompatible THEN the app surfaces a clear error and does not modify stored projects.
3. WHEN import succeeds THEN the project appears immediately in Recent and can be opened to the annotation workspace without re-uploading assets.

## Non-Functional Requirements

### Code Architecture and Modularity
- Keep export/import orchestration in dedicated modules/services; UI components handle intent and messaging only (Single Responsibility).
- Reuse existing capacity dialog and storage utilities to avoid duplication (DRY) and keep flows consistent.
- Introduce clear interfaces for serialization/deserialization to enable future schema evolution without breaking consumers (Open/Closed, Liskov).

### Performance
- Perform packaging/unpacking off the main thread when possible (e.g., Web Worker or async chunking) to keep UI responsive on large slides.
- Aim for export/import to complete within 3 seconds for typical slides (<25 MB bundle); show progress/loader when longer.
- Avoid unnecessary data copies; stream/zip in-memory where feasible.

### Security
- All work stays client-side; no network transmission of slide data during export/import.
- Validate file type/extension and parse with defensive checks to prevent XSS or malformed payload injection.
- Avoid persisting secrets; sanitize filenames and ensure only expected fields are deserialized.

### Reliability
- Maintain backward/forward compatibility via a version field in the package; reject or migrate older versions safely.
- Handle interruptions gracefully (e.g., user cancels file picker) with no partial state changes.

### Usability
- Provide clear CTAs: “Export Project” in project view and “Import Project” on Home.
- Use accessible messaging (toasts/inline alerts) with concise success/error text and keyboard-focus handling.
- Surface file size and target capacity effects so users understand storage impact.
