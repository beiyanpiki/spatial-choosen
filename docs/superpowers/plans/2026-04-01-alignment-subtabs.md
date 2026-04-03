# Alignment Subtabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the alignment panel from two large side-by-side landmark canvases into subtabs and constrain canvas height so images fit the page better.

**Architecture:** Reuse the existing Chakra tabs pattern already used in preprocess (`LocalizationPanel.tsx`) and keep all alignment math/state unchanged. Only modify `AlignmentPanel.tsx`: swap the two-canvas `Flex` with `Tabs`, and add viewport-aware height constraints to the `LandmarkCanvas` container while preserving its minimum height.

**Tech Stack:** Next.js App Router, React 19, TypeScript strict, Chakra UI.

---

### Task 1: Replace side-by-side panes with Chakra subtabs

**Files:**
- Modify: `src/app/preprocess/components/AlignmentPanel.tsx`

- [ ] **Step 1: Add Chakra tabs imports in `AlignmentPanel.tsx`**

```tsx
import {
  // existing imports...
  Tab,
  TabList,
  TabPanel,
  TabPanels,
  Tabs,
} from '@chakra-ui/react';
```

- [ ] **Step 2: Replace the two-pane `<Flex>` block with `<Tabs>`**

```tsx
<Tabs size='sm' variant='enclosed' isLazy>
  <TabList>
    <Tab>Eosin landmarks</Tab>
    <Tab>H&E landmarks</Tab>
  </TabList>
  <TabPanels>
    <TabPanel px={0} pt={4}>
      <LandmarkCanvas image={referenceImage} imageKey='source' points={sourcePoints} pendingPoint={pendingPair.source} title='Eosin landmarks (reference)' tool={tool} onCreatePoint={addOrUpdatePendingPoint} onDeletePoint={handleDeletePoint} onMovePoint={handleMovePoint} testIdPrefix='alignment-source' />
    </TabPanel>
    <TabPanel px={0} pt={4}>
      <LandmarkCanvas image={movingImage} imageKey='target' points={targetPoints} pendingPoint={pendingPair.target} title='H&E landmarks (moving)' tool={tool} onCreatePoint={addOrUpdatePendingPoint} onDeletePoint={handleDeletePoint} onMovePoint={handleMovePoint} testIdPrefix='alignment-target' />
    </TabPanel>
  </TabPanels>
</Tabs>
```

- [ ] **Step 3: Constrain landmark canvas container height in `LandmarkCanvas`**

```tsx
<Box
  // existing props...
  minH='320px'
  h={{ base: '52vh', xl: '58vh' }}
  maxH='680px'
  position='relative'
/>
```

- [ ] **Step 4: Validate with diagnostics and project checks**

Run:

```bash
npm run lint
npm run build
```

Expected:
- Lint exits with code 0.
- Build exits with code 0.
- No TypeScript or JSX errors in `AlignmentPanel.tsx`.

- [ ] **Step 5: (Optional, only if user requests) Commit**

```bash
git add src/app/preprocess/components/AlignmentPanel.tsx docs/superpowers/specs/2026-04-01-alignment-subtabs-design.md docs/superpowers/plans/2026-04-01-alignment-subtabs.md
git commit -m "update alignment panel with tabbed landmark views"
```
