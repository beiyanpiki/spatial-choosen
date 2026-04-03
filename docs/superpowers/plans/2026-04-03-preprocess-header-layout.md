# Preprocess Header Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Simplify the preprocess workspace layout so the project name becomes the editable page title, autosave moves inline under the title, and redundant descriptive copy is removed from the right-side workflow panel.

**Architecture:** Keep the change contained to `src/app/preprocess/components/PreprocessWorkspace.tsx`. Reuse the existing Chakra layout and autosave state logic, but restructure the header composition and panel top section so the UI is denser without changing preprocess behavior.

**Tech Stack:** Next.js 16, React 19, TypeScript strict mode, Chakra UI, ESLint, TypeScript language server.

---

## File map

- Modify: `src/app/preprocess/components/PreprocessWorkspace.tsx`

## Implementation notes before starting

- Work in a dedicated worktree because the current repository already has unrelated in-progress changes.
- Do not change autosave state transitions or preprocess data mutation logic in `src/app/preprocess/page.tsx`.
- Preserve `data-testid='project-name-input'` by reusing it on the inline title editor so existing tests or tooling do not lose their selector.
- Keep the step badge and heading in the panel header, but remove the descriptive paragraph for every step.
- For the editable title, use a local editing state so the page shows a heading by default and only renders an input while editing.

### Task 1: Restructure the preprocess header into back button + editable title + inline autosave

**Files:**
- Modify: `src/app/preprocess/components/PreprocessWorkspace.tsx`

- [ ] **Step 1: Add the failing header interaction test mentally and lock the expected UI contract**

The resulting header should satisfy this contract:

```tsx
// Expected UI contract in PreprocessWorkspace
// 1. A ghost back button appears to the left of the main title row.
// 2. The main title shows project.name as large text by default.
// 3. Clicking the title swaps it for an Input using data-testid='project-name-input'.
// 4. Blur or Enter returns to text mode and keeps the edited name.
// 5. Autosave badge + detail render in a horizontal row beneath the title.
```

- [ ] **Step 2: Run targeted diagnostics to capture the clean baseline for the workspace file**

Run: `lsp_diagnostics` on `src/app/preprocess/components/PreprocessWorkspace.tsx`

Expected: no pre-existing TypeScript errors in the target file before the layout refactor.

- [ ] **Step 3: Replace the current two-column header with the new compact composition**

Introduce local state for inline title editing and replace the existing `Preprocess workspace` heading block with a row containing the back button and editable project-name heading. Move the autosave badge and detail under that row in a single `HStack`/`Flex` instead of a separate right-side stack.

```tsx
const [isEditingProjectName, setIsEditingProjectName] = useState(false);
const [draftProjectName, setDraftProjectName] = useState(project?.name ?? '');

useEffect(() => {
  if (!isEditingProjectName && project) {
    setDraftProjectName(project.name);
  }
}, [isEditingProjectName, project]);

<Stack spacing={2} flex='1' minW={0}>
  <HStack spacing={3} align='center'>
    <Button variant='ghost' onClick={onBackToLanding}>
      ← Back
    </Button>
    {isEditingProjectName ? (
      <Input
        value={draftProjectName}
        data-testid='project-name-input'
        onChange={(event) => setDraftProjectName(event.target.value)}
        onBlur={commitProjectName}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commitProjectName();
          if (event.key === 'Escape') cancelProjectNameEdit();
        }}
      />
    ) : (
      <Heading size='lg' onClick={() => setIsEditingProjectName(true)}>
        {project.name || 'Untitled project'}
      </Heading>
    )}
  </HStack>

  <HStack spacing={3} wrap='wrap'>
    <Badge data-testid='autosave-status'>{autosaveStatus}</Badge>
    {autosaveDetail ? <Text fontSize='sm'>{autosaveDetail}</Text> : null}
  </HStack>
</Stack>
```

- [ ] **Step 4: Run diagnostics again on the workspace file**

Run: `lsp_diagnostics` on `src/app/preprocess/components/PreprocessWorkspace.tsx`

Expected: no TypeScript or JSX errors after the header refactor.

### Task 2: Remove duplicated panel metadata and workflow helper copy

**Files:**
- Modify: `src/app/preprocess/components/PreprocessWorkspace.tsx`

- [ ] **Step 1: Remove the duplicated project-name form block from the panel body**

Delete the entire `Project name` label/input/helper text stack under the panel header so the project name lives only in the page header.

```tsx
// Delete this block entirely
<Stack spacing={2} maxW='480px'>
  <Text fontWeight='semibold' fontSize='sm'>Project name</Text>
  <Input value={project.name} onChange={...} data-testid='project-name-input' />
  <Text fontSize='sm' color='gray.500'>Draft changes save when you move to the next preprocess step.</Text>
</Stack>
```

- [ ] **Step 2: Remove workflow helper paragraphs from panel headers and fallback shells**

Keep `currentCopy.title` for the panel heading, but stop rendering `currentCopy.body` both in the main panel header and in the generic fallback box.

```tsx
<Stack spacing={1}>
  <Badge colorScheme='brand' alignSelf='flex-start'>{currentStepMeta.label}</Badge>
  <Heading size='md'>{currentCopy.title}</Heading>
</Stack>

<Box border='1px solid' borderColor='gray.100' borderRadius='lg' p={5} bg='gray.50'>
  <Heading size='sm'>{currentCopy.title}</Heading>
</Box>
```

- [ ] **Step 3: Manually review the source step and another workflow step for visual intent**

Confirm in code that:

```text
Source step: panel opens directly into source/upload controls with no placeholder paragraph.
Localization step: panel shows step badge + heading, then immediately the tool panels.
Autosave: status remains visible near the title instead of the former right column.
```

- [ ] **Step 4: Run final verification for the changed file and app build**

Run: `lsp_diagnostics` on `src/app/preprocess/components/PreprocessWorkspace.tsx`

Run: `npm run build`

Expected: diagnostics clean and Next.js build succeeds without introducing new errors from the layout-only change.
