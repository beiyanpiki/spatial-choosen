# Issue: `/preprocess` autosave exceeds `localStorage` quota

## Summary

The `/preprocess` autosave can fail after tissue spot detection or manual tissue edits because the metadata write exceeds the browser's `localStorage` quota.

## Observed error

```text
Failed to autosave preprocessing project
QuotaExceededError: Failed to execute 'setItem' on 'Storage':
Setting the value of 'spatial-preprocess-projects' exceeded the quota.
```

The browser console reports the error from `installHook.js`, with the failing storage key:

```text
spatial-preprocess-projects
```

## Reproduction context

1. Open `/preprocess` in a desktop browser.
2. Create or open a preprocessing project with source images and complete registration.
3. Select a chip size and run tissue spot detection, or edit tissue spots manually.
4. Wait for autosave.
5. The page shows `ERROR` and `save failed - last saved snapshot preserved`.

In the reported sample, ZIP export still completed successfully after the autosave error.

## Impact

- The current in-memory tissue result can still be exported, but it is not guaranteed to survive a refresh or browser close.
- The UI falls back to the last successfully persisted project snapshot.
- A recovery ZIP exported before leaving the page can preserve the current result only when the project recovery option is included.
- Users may mistake a successful tissue step or successful ZIP download for a successfully saved project.

## Technical finding

Preprocessing metadata is intentionally written to `localStorage` under `spatial-preprocess-projects`; image and tissue payloads are stored separately in IndexedDB. The exception proves that the metadata serialization itself, or the accumulated metadata records, has exceeded the browser's `localStorage` quota.

The failure is therefore in the metadata persistence path, specifically the call to `localStorage.setItem`, rather than in image decoding, tissue detection, registration, or ZIP generation.

## Follow-up investigation

- Measure serialized metadata size before writing and report the size and estimated available quota where the browser exposes it.
- Inspect existing records for legacy inline data URLs or unexpectedly large metadata fields; migrate or remove them without putting image/matrix payloads back into `localStorage`.
- Confirm that a tissue-only save cannot make the metadata record unnecessarily large.
- Define behavior when quota is exhausted: preserve the last good snapshot, clearly identify unsaved changes, and provide a recovery export path.
- Add a browser-level regression test that fills the metadata quota and verifies the fallback state and user-facing error.
- Verify recovery by importing a ZIP containing the project file and source assets.

## Temporary user guidance

Until fixed, users should download a recovery ZIP with the project-recovery option enabled before refreshing or closing the page. They should not clear site data or delete the project while the autosave status is `ERROR`, `RETRYING`, or `SAVING`.

