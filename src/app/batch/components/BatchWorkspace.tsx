'use client';
import {
  Alert,
  AlertDescription,
  AlertIcon,
  Badge,
  Button,
  ButtonGroup,
  Card,
  CardBody,
  Divider,
  Flex,
  HStack,
  Heading,
  Link,
  Radio,
  RadioGroup,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  TableContainer,
  Tbody,
  Td,
  Text,
  Th,
  Thead,
  Tr,
} from '@chakra-ui/react';
import NextLink from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_MATRIX_CONVENTION,
  DEFAULT_SIMILARITY_PARAMS,
  applyAffine,
  composeAffine,
  decomposeNormalizedSimilarity,
  invertAffine,
  normalizeSimilarityParams,
  scaleAffineInput,
  similarityPixelMatrix,
  similarityNormalizedMatrix,
} from '@/lib/batch/affine';
import { transformBounds, unionBounds } from '@/lib/batch/viewBounds';
import {
  buildBatchBundleZip,
  buildBatchPackageZip,
  buildPackageExportFileName,
  downloadBlob,
} from '@/lib/batch/exportPackages';
import {
  buildBatchPackage,
  groupSourceFiles,
  readBatchSourceFiles,
  type BatchSelectedFile,
} from '@/lib/batch/importPackages';
import { buildExportInputs, buildTransformMatrixCsv, computeSelection } from '@/lib/batch/pipeline';
import { regionsFromSelectedBarcodes } from '@/lib/batch/resume';
import {
  applyRegionStroke,
  cloneRegions,
  createRegion,
  mapPackageRegionsToReference,
  mapReferenceRegionsToPackage,
} from '@/lib/batch/regions';
import {
  BATCH_REGION_COLORS,
  DEFAULT_REGION_COLOR_ID,
  createRegionColor,
  nextRegionColorId,
  type BatchRegionColor,
} from '@/lib/batch/regionColors';
import { clearStoredRegionColors } from '@/lib/batch/regionColorStore';
import { createRegionHistory, type RegionHistorySnapshot } from '@/lib/batch/regionHistory';
import {
  BATCH_SESSION_FILE_NAME,
  BATCH_SESSION_VERSION,
  BATCH_WORK_FOLDER_SUFFIX,
  batchSnapshotFileName,
  createBatchSessionId,
  parseBatchSession,
  serializeBatchSession,
  type BatchSession,
  type BatchSessionSummary,
} from '@/lib/batch/session';
import {
  deleteBatchSessionRecord,
  readBatchSessionSummaries,
  readStoredBatchSession,
  saveBatchSessionRecord,
} from '@/lib/batch/sessionStore';
import {
  directoryToSourceFiles,
  describePickerError,
  ensurePermission,
  findWorkFolder,
  listDirectoryNames,
  openWorkFolder,
  pickDataDirectory,
  readPackageFilesByName,
  readSessionFile,
  resolveRestoreFolder,
  supportsWorkFolder,
  WORK_FOLDER_UNSUPPORTED_MESSAGE,
  writeTextFile,
  type BatchDirectoryHandleLike,
  type BatchWorkFolder,
} from '@/lib/batch/workFolder';
import type {
  BatchBounds,
  BatchMatrixConvention,
  BatchMatrixLayout,
  BatchPackage,
  BatchPoint,
  BatchRegion,
  BatchRegionMode,
  BatchSelectionResult,
  BatchSelectionSettings,
  BatchSimilarityParams,
  BatchStepId,
} from '@/types/batch';
import { BatchAlignStage, type BatchAlignTarget } from './BatchAlignStage';
import { BatchImportPanel } from './BatchImportPanel';
import { PackageStrip } from './PackageStrip';
import {
  BatchRegionStage,
  type BatchRegionFrame,
  type BatchRegionTool,
} from './BatchRegionStage';
import { BatchStepRail, type BatchStepItem } from './BatchStepRail';
import {
  DEFAULT_MATRIX_LAYOUT,
  DEFAULT_SELECTION_SETTINGS,
  applyAlignmentEdits,
  applySharedStroke,
  createDefaultAlignment,
  hasCustomRegions,
  isDefaultAlignment,
  linkAlignmentToBase,
  resolveAlignment,
  resolveAllPackageRegions,
  resolveRegionsForPackage,
  transferReferenceRegions,
  type AlignmentLink,
} from '../batchState';
const EMPTY_TARGET: BatchAlignTarget = {
  name: 'reference',
  previewUrl: null,
  previewSize: null,
  size: null,
  spots: null,
  spotDiameterFullres: null,
};
const toAlignTarget = (entry: BatchPackage | null | undefined): BatchAlignTarget => (
  entry
    ? {
        name: entry.name,
        previewUrl: entry.previewUrl,
        previewSize: entry.previewSize,
        size: entry.fullresSize,
        spots: entry.spots,
        spotDiameterFullres: entry.spotDiameterFullres,
      }
    : EMPTY_TARGET);
type Notice = { tone: 'info' | 'success' | 'error'; text: string };

/** Auto-save badge copy, mirroring the preprocessing workspace's status chip. */
const AUTO_SAVE_LABEL: Record<'off' | 'saving' | 'saved' | 'error', string> = {
  off: '仅浏览器内',
  saving: '保存中…',
  saved: '已自动保存',
  error: '保存失败',
};

const AUTO_SAVE_TONE: Record<'off' | 'saving' | 'saved' | 'error', string> = {
  off: 'gray',
  saving: 'blue',
  saved: 'green',
  error: 'red',
};

/** History key for the reference image's own regions.
 */
const REFERENCE_REGION_KEY = 'reference';

/** Where a stroke drawn on an aligned panel lands.
 */
type StrokeScope = 'all' | 'image';

/**
 * Chooses whether a stroke is mapped onto the whole batch or stays on the image
 * being drawn. Step 3 defaults to `all` (paint once, every adjusted image — the
 * locked reference included — takes the region); step 4 defaults to `image`,
 * because that pass is where a single image gets reviewed and tweaked.
 */
function StrokeScopeToggle({
  value,
  onChange,
  testId,
}: {
  value: StrokeScope;
  onChange: (next: StrokeScope) => void;
  testId: string;
}) {
  return (
    <HStack spacing={2} data-testid={testId}>
      <Text fontSize='xs' color='gray.500'>Apply strokes to</Text>
      <ButtonGroup size='xs' variant='outline' isAttached>
        <Button
          isActive={value === 'all'}
          aria-pressed={value === 'all'}
          colorScheme={value === 'all' ? 'brand' : 'gray'}
          title='Map the stroke onto every adjusted image, the reference included'
          onClick={() => onChange('all')}
        >
          All images
        </Button>
        <Button
          isActive={value === 'image'}
          aria-pressed={value === 'image'}
          colorScheme={value === 'image' ? 'brand' : 'gray'}
          title='Keep the stroke on this image only'
          onClick={() => onChange('image')}
        >
          This image only
        </Button>
      </ButtonGroup>
    </HStack>
  );
}
const readyPackages = (packages: readonly BatchPackage[]) =>
  packages.filter((entry) => entry.status === 'ready');
export function BatchWorkspace() {
  const [packages, setPackages] = useState<BatchPackage[]>([]);
  const [referencePackageId, setReferencePackageId] = useState<string | null>(null);
  const [alignments, setAlignments] = useState<Record<string, BatchSimilarityParams>>({});
  /** Per package: the image its overlay was aligned against, plus the values dialled.
 */
  const [alignLinks, setAlignLinks] = useState<Record<string, AlignmentLink>>({});
  const [referenceRegions, setReferenceRegions] = useState<BatchRegion[]>([]);
  const [customRegions, setCustomRegions] = useState<Record<string, BatchRegion[]>>({});
  // Selection settings are fixed defaults: the review step no longer exposes
  // them, so the exported files always use the same, well-defined behaviour.
  const selection: BatchSelectionSettings = DEFAULT_SELECTION_SETTINGS;
  const matrixLayout: BatchMatrixLayout = DEFAULT_MATRIX_LAYOUT;
  const matrixConvention: BatchMatrixConvention = DEFAULT_MATRIX_CONVENTION;
  const [step, setStep] = useState<BatchStepId>('import');
  const [activePackageId, setActivePackageId] = useState<string | null>(null);
  const [regionTool, setRegionTool] = useState<BatchRegionTool>('merge');
  const [activeColorId, setActiveColorId] = useState<number>(DEFAULT_REGION_COLOR_ID);
  const [customColors, setCustomColors] = useState<BatchRegionColor[]>([]);
  /** Operator-given names for the colour groups; the id stays the export value. */
  const [colorNames, setColorNames] = useState<Record<number, string>>({});
  const [regionMode, setRegionMode] = useState<BatchRegionMode>('project');
  /**
   * Step 4 can overlay the tissue the package already kept — the second column
   * of `tissue_positions.csv` — on top of the region drawn here.
   */
  const [showTissueComparison, setShowTissueComparison] = useState(false);
  /** Step 3's project mode draws on any sample, the reference being the default. */
  const [projectDrawPackageId, setProjectDrawPackageId] = useState<string | null>(null);
  const [referenceConfirmed, setReferenceConfirmed] = useState(false);
  /**
   * Stroke scope per step, kept separate on purpose: step 3 normally paints the
   * shared region for the whole batch, while step 4 is the per-image review pass.
   */
  const [walkthroughScope, setWalkthroughScope] = useState<StrokeScope>('all');
  const [regionScope, setRegionScope] = useState<StrokeScope>('image');
  /** Last base image the operator picked in step 2, reused for other samples. */
  const [alignBaseId, setAlignBaseId] = useState<string | null>(null);
  const [walkthroughPackageId, setWalkthroughPackageId] = useState<string | null>(null);
  /** View of the picture panel on the right; the reference keeps its own below. */
  const [walkthroughView, setWalkthroughView] = useState({ zoom: 1, pan: { x: 0, y: 0 } });
  /**
   * The reference panel zooms and pans on its own. It must not follow the
   * picture beside it: sharing one view used to rescale the reference whenever
   * the right-hand image was switched or zoomed, which broke the comparison.
   */
  const [referenceView, setReferenceView] = useState({ zoom: 1, pan: { x: 0, y: 0 } });
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  /** Folder the session is auto-saved into; null when the batch only lives in the browser. */
  const [workFolder, setWorkFolder] = useState<BatchWorkFolder | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  /** Name the work folder is derived from (the imported folder or archive). */
  const [sessionName, setSessionName] = useState('batch');
  const [recentSessions, setRecentSessions] = useState<BatchSessionSummary[]>([]);
  const [autoSaveStatus, setAutoSaveStatus] = useState<'off' | 'saving' | 'saved' | 'error'>('off');
  const [autoSaveDetail, setAutoSaveDetail] = useState<string | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const packagesRef = useRef<BatchPackage[]>([]);
  packagesRef.current = packages;
  const sessionFileInputRef = useRef<HTMLInputElement | null>(null);
  /**
   * Region edits (merge / cut / overwrite / clear) are not reversible by just
   * dropping the last region, so every mutation snapshots the previous lists.
   * The stack is global — one step per operation, whichever image it touched —
   * so Undo still reaches the previous image after the operator switches
   * samples, instead of falling back to "nothing to undo" on the new one.
   */
  const regionHistoryRef = useRef(createRegionHistory());
  const [historyDepth, setHistoryDepth] = useState(0);
  const restoreRegionSnapshot = useCallback((snapshot: RegionHistorySnapshot) => {
    if (snapshot.key === REFERENCE_REGION_KEY) {
      setReferenceRegions(snapshot.regions ? cloneRegions(snapshot.regions) : []);
      return;
    }

    setCustomRegions((previous) => {
      const next = { ...previous };
      // `null` is "this image had no override yet": undoing the stroke that
      // created one has to hand the image back to the projected region.
      if (snapshot.regions) next[snapshot.key] = cloneRegions(snapshot.regions);
      else delete next[snapshot.key];
      return next;
    });
  }, []);
  const clearRegionHistory = useCallback(() => {
    regionHistoryRef.current.clear();
    setHistoryDepth(0);
  }, []);
  const recordRegionHistory = useCallback((snapshots: readonly RegionHistorySnapshot[]) => {
    regionHistoryRef.current.record(snapshots);
    setHistoryDepth(regionHistoryRef.current.depth());
  }, []);
  /** Reverts the most recent edit, whichever image it was made on. */
  const undoRegionEdit = useCallback(() => {
    const step = regionHistoryRef.current.undo();
    setHistoryDepth(regionHistoryRef.current.depth());
    step?.forEach(restoreRegionSnapshot);
  }, [restoreRegionSnapshot]);
  const canUndoRegions = historyDepth > 0;
  useEffect(() => () => {
    packagesRef.current.forEach((entry) => {
      if (entry.previewUrl) URL.revokeObjectURL(entry.previewUrl);
    });
  }, []);
  const releasePackages = useCallback((entries: readonly BatchPackage[]) => {
    entries.forEach((entry) => {
      if (entry.previewUrl) URL.revokeObjectURL(entry.previewUrl);
    });
  }, []);
  const importPackages = useCallback(async (
    selectedFiles: BatchSelectedFile[],
    options: { parentHandle?: BatchDirectoryHandleLike | null; sessionName?: string } = {},
  ) => {
    if (selectedFiles.length === 0) return;
    setNotice(null);
    setBusyLabel('Reading selection…');
    try {
      const { files, archives } = await readBatchSourceFiles(selectedFiles);
      const groups = groupSourceFiles(files);
      if (groups.length === 0) {
        setNotice({
          tone: 'error',
          text: 'No NATA package found. Each package folder needs a tissue_fullres_image.png and a tissue_positions.csv.',
        });
        return;
      }
      const built: BatchPackage[] = [];
      for (const [index, group] of groups.entries()) {
        setBusyLabel(`Preparing ${group.name} (${index + 1}/${groups.length})…`);
        // Sequential decoding keeps peak memory bounded for 6000px PNGs.
        built.push(await buildBatchPackage(group, `batch-${Date.now().toString(36)}-${index}`));
      }
      releasePackages(packagesRef.current);
      setPackages(built);
      clearRegionHistory();
      setProjectDrawPackageId(null);
      const reference = built.find((entry) => entry.status === 'ready') ?? null;
      setReferencePackageId(reference?.id ?? null);
      // A package exported by step 5 carries its alignment (transform-matrix.csv)
      // and its barcode selection (in_selected), so the batch can be resumed
      // instead of drawn from scratch.
      const restoredAlignments: Record<string, BatchSimilarityParams> = {};
      const restoredRegions: Record<string, BatchRegion[]> = {};
      let restoredAlignmentCount = 0;
      let restoredSelectionCount = 0;
      const reconstruct = (entry: BatchPackage) => (
        entry.resume?.selectedBarcodes && entry.spots && entry.fullresSize
          ? regionsFromSelectedBarcodes({
              spots: entry.spots,
              selectedBarcodes: entry.resume.selectedBarcodes,
              size: entry.fullresSize,
              anchorMode: DEFAULT_SELECTION_SETTINGS.anchorMode,
              spotDiameterFullres: entry.spotDiameterFullres,
            })
          : null
      );
      for (const entry of built) {
        restoredAlignments[entry.id] = entry.resume?.alignment ?? createDefaultAlignment();
        if (entry.resume?.alignment) restoredAlignmentCount += 1;
        const regions = reconstruct(entry);
        if (regions) {
          restoredSelectionCount += 1;
          if (entry.id !== reference?.id) {
            restoredRegions[entry.id] = regions;
          }
        }
      }
      const referenceRegionsRestored = reference ? reconstruct(reference) ?? [] : [];
      const resumed = restoredAlignmentCount > 0 || restoredSelectionCount > 0;
      // A newer export carries the colour of every class, so a resumed batch
      // comes back with the palette it was drawn with.
      const exportedColors = new Map<number, string>();
      for (const entry of built) {
        for (const [classId, hex] of entry.resume?.colorByClass ?? []) {
          if (!BATCH_REGION_COLORS.some((color) => color.id === classId)) {
            exportedColors.set(classId, hex);
          }
        }
      }
      if (exportedColors.size > 0) {
        setCustomColors(
          [...exportedColors]
            .sort((left, right) => left[0] - right[0])
            .map(([classId, hex]) => createRegionColor(classId, hex)),
        );
      }
      // The `Colours` column brings the region names back with the colours.
      const exportedNames = new Map<number, string>();
      for (const entry of built) {
        for (const [classId, name] of entry.resume?.nameByClass ?? []) {
          if (!exportedNames.has(classId)) exportedNames.set(classId, name);
        }
      }
      setColorNames(Object.fromEntries(exportedNames));
      setAlignments(restoredAlignments);
      // A resumed export carries absolute matrices, so nothing is chained yet.
      setAlignLinks({});
      setAlignBaseId(null);
      setCustomRegions(restoredRegions);
      setReferenceRegions(referenceRegionsRestored);
      const firstOther = reference
        ? built.find((entry) => entry.id !== reference.id && entry.status === 'ready')
        : undefined;
      // Default to another sample: step 2 then starts with image 2 over image 1,
      // and step 4 shows it next to the locked reference.
      setActivePackageId(firstOther?.id ?? built[0]?.id ?? null);
      setReferenceConfirmed(referenceRegionsRestored.length > 0);
      setWalkthroughPackageId(restoredSelectionCount > 0 ? firstOther?.id ?? null : null);
      if (restoredSelectionCount > 0 && referenceRegionsRestored.length > 0) {
        // Every package came back with its own region, which is what per-image
        // mode describes; the review step is still where editing continues.
        setRegionMode('perImage');
      }
      setStep(resumed ? 'imageRegions' : 'align');
      // The session lives in a `<folder>-natatoolkit` folder next to the data
      // whenever the browser handed us a writable folder handle; otherwise it is
      // kept in this browser only, and the UI says so.
      // The folder is named after the *data* folder that holds the samples, so a
      // zip named after one sample (or a legacy file-picker import) does not turn
      // a sample folder name into the session folder name.
      const firstRoot = groups[0]?.rootPath ?? '';
      const parentFolderName = firstRoot.includes('/')
        ? firstRoot.split('/').slice(0, -1).pop() ?? null
        : null;
      const nextSessionName = options.sessionName
        ?? archives[0]?.replace(/\.zip$/i, '')
        ?? parentFolderName
        ?? reference?.name
        ?? 'batch';
      setSessionId(createBatchSessionId());
      setSessionName(nextSessionName);
      if (options.parentHandle) {
        try {
          const folder = await openWorkFolder(options.parentHandle, nextSessionName);
          setWorkFolder(folder);
          setAutoSaveStatus('saved');
          setAutoSaveDetail(`自动保存到 ${folder.name}/`);
        } catch (error) {
          setWorkFolder(null);
          setAutoSaveStatus('error');
          setAutoSaveDetail(error instanceof Error ? error.message : '无法写入文件夹');
        }
      } else {
        setWorkFolder(null);
        setAutoSaveStatus(supportsWorkFolder() ? 'saved' : 'off');
        setAutoSaveDetail(
          supportsWorkFolder()
            ? '未连接文件夹，会话保存在浏览器内'
            : '当前浏览器不支持写入文件夹，会话保存在浏览器内',
        );
      }
      const failed = built.filter((entry) => entry.status === 'error');
      setNotice({
        tone: failed.length > 0 ? 'info' : 'success',
        text: resumed
          ? `Resumed a previous batch result: alignment restored for ${restoredAlignmentCount} package(s) and selections for ${restoredSelectionCount}. Everything stays editable.`
          : failed.length > 0
            ? `Imported ${built.length} package(s); ${failed.length} could not be read.`
            : `Imported ${built.length} package(s)${archives.length > 0 ? ` from ${archives.length} archive(s)` : ''}. Reference: ${reference?.name ?? '—'}.`,
      });
    } catch (error) {
      setNotice({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Unable to import the selected files.',
      });
    } finally {
      setBusyLabel(null);
    }
  }, [clearRegionHistory, releasePackages]);
  /* ---------------------------------------------------------------- *
   * Session persistence
   *
   * Every change produces a snapshot: it is written to `<data folder>/
   * <name>-natatoolkit/session.json` when the browser gave us a writable folder
   * handle, and always kept in IndexedDB so the landing can offer "继续上次分析"
   * after a reload. Manual save, snapshot, download and import sit on top of the
   * same snapshot format.
   * ---------------------------------------------------------------- */
  const buildSession = useCallback((): BatchSession => ({
    version: BATCH_SESSION_VERSION,
    id: sessionId ?? createBatchSessionId(),
    name: sessionName,
    savedAt: new Date().toISOString(),
    step,
    packages: packages.map((entry) => ({
      id: entry.id,
      name: entry.name,
      files: entry.files.map((file) => ({ relativePath: file.relativePath, name: file.name })),
      fullresFileName: entry.fullresFileName,
      positionsFileName: entry.positionsFileName,
      scalefactorsFileName: entry.scalefactorsFileName,
      fullresSize: entry.fullresSize,
      previewSize: entry.previewSize,
      contentBounds: entry.contentBounds,
      spotDiameterFullres: entry.spotDiameterFullres,
      spots: entry.spots,
      positions: entry.positions,
    })),
    referencePackageId,
    referenceRegions,
    customRegions,
    alignments,
    alignLinks,
    alignBaseId,
    customColors,
    colorNames: Object.fromEntries(
      Object.entries(colorNames).map(([key, value]) => [String(key), value]),
    ),
    activeColorId,
    regionTool,
    regionMode,
    referenceConfirmed,
    activePackageId,
    walkthroughPackageId,
    projectDrawPackageId,
    walkthroughScope,
    regionScope,
  }), [
    activeColorId,
    activePackageId,
    alignBaseId,
    alignLinks,
    alignments,
    colorNames,
    customColors,
    customRegions,
    packages,
    projectDrawPackageId,
    referenceConfirmed,
    referencePackageId,
    referenceRegions,
    regionMode,
    regionScope,
    regionTool,
    sessionId,
    sessionName,
    step,
    walkthroughPackageId,
    walkthroughScope,
  ]);
  /** Kept in refs so the debounced flush never runs against stale state. */
  const buildSessionRef = useRef(buildSession);
  buildSessionRef.current = buildSession;
  const workFolderRef = useRef<BatchWorkFolder | null>(workFolder);
  workFolderRef.current = workFolder;
  const sessionSaveAttemptRef = useRef(0);
  const autoSaveTimerRef = useRef<number | null>(null);
  /**
   * Session read from a file, waiting for its data folder.
   *
   * The folder dialog cannot follow the file dialog in the same click — the
   * second picker would have no user gesture left — so the import parks the
   * session here and the next "连接数据文件夹…" click finishes the restore.
   */
  const pendingSessionRef = useRef<BatchSession | null>(null);

  const persistSession = useCallback(async (
    options: { snapshot?: boolean; announce?: boolean } = {},
  ) => {
    if (packagesRef.current.length === 0) return;

    const attempt = sessionSaveAttemptRef.current + 1;
    sessionSaveAttemptRef.current = attempt;
    setAutoSaveStatus('saving');

    try {
      const session = buildSessionRef.current();
      const text = serializeBatchSession(session);
      const folder = workFolderRef.current;

      // The browser copy always happens: it is what makes "继续上次分析" work
      // even before the folder is reachable again.
      await saveBatchSessionRecord(session, { rootHandle: folder?.parent ?? null });
      if (folder) {
        await writeTextFile(folder.dir, BATCH_SESSION_FILE_NAME, text);
        if (options.snapshot) {
          await writeTextFile(folder.dir, batchSnapshotFileName(new Date()), text);
        }
      }

      if (attempt === sessionSaveAttemptRef.current) {
        const time = new Date().toLocaleTimeString();
        setAutoSaveStatus('saved');
        setAutoSaveDetail(
          folder
            ? `已自动保存 · ${time} · ${folder.name}/session.json`
            : `已保存在浏览器内 · ${time}（未连接文件夹）`,
        );
      }
      if (options.announce) {
        setNotice({
          tone: 'success',
          text: folder
            ? `已保存到 ${folder.name}/session.json`
            : '会话已保存在浏览器内；连接数据文件夹后会同步写入本地。',
        });
      }
      setRecentSessions(await readBatchSessionSummaries());
    } catch (error) {
      if (attempt === sessionSaveAttemptRef.current) {
        setAutoSaveStatus('error');
        setAutoSaveDetail(error instanceof Error ? error.message : '保存失败');
      }
    }
  }, []);

  /**
   * Auto-save: one write per burst of edits.
   *
   * The dependencies are the state the session is made of, so any edit to an
   * alignment, region, colour or step schedules a snapshot; the timer collapses
   * a stroke's follow-up updates into a single write.
   */
  useEffect(() => {
    if (packages.length === 0) return undefined;

    if (autoSaveTimerRef.current !== null) window.clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = window.setTimeout(() => {
      autoSaveTimerRef.current = null;
      void persistSession();
    }, 1200);

    return () => {
      if (autoSaveTimerRef.current !== null) {
        window.clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
    };
  }, [
    activeColorId,
    activePackageId,
    alignBaseId,
    alignLinks,
    alignments,
    colorNames,
    customColors,
    customRegions,
    packages,
    persistSession,
    projectDrawPackageId,
    referenceConfirmed,
    referencePackageId,
    referenceRegions,
    regionMode,
    regionScope,
    regionTool,
    step,
    walkthroughPackageId,
    walkthroughScope,
  ]);

  useEffect(() => {
    let cancelled = false;
    void readBatchSessionSummaries().then((list) => {
      if (!cancelled) setRecentSessions(list);
    });
    return () => { cancelled = true; };
  }, []);

  /** A cancelled picker is not an error; anything else deserves an explanation. */
  const reportPickerFailure = useCallback((error: unknown) => {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    setNotice({ tone: 'error', text: describePickerError(error) });
  }, []);

  const handleSaveNow = useCallback(() => {
    void persistSession({ announce: true });
  }, [persistSession]);

  const handleSaveSnapshot = useCallback(() => {
    void persistSession({ snapshot: true, announce: true });
  }, [persistSession]);

  const handleDownloadSession = useCallback(() => {
    if (packagesRef.current.length === 0) return;

    downloadBlob(
      new Blob([serializeBatchSession(buildSessionRef.current())], { type: 'application/json' }),
      batchSnapshotFileName(new Date()),
    );
    setNotice({ tone: 'success', text: '已下载会话文件；在另一台机器上导入它并选择数据文件夹即可继续。' });
  }, []);

  /** Imports a batch straight from a granted folder, which enables auto-save. */
  const handlePickDataFolder = useCallback(async () => {
    try {
      const parent = await pickDataDirectory('readwrite');
      setBusyLabel('读取文件夹…');
      const files = await directoryToSourceFiles(parent);
      if (files.length === 0) {
        setNotice({
          tone: 'error',
          text: '这个文件夹里没有找到 <样本>/spatial 结构，请选择包含样本文件夹的父目录。',
        });
        return;
      }
      await importPackages(files, { parentHandle: parent, sessionName: parent.name });
    } catch (error) {
      reportPickerFailure(error);
    } finally {
      setBusyLabel(null);
    }
  }, [importPackages, reportPickerFailure]);

  /** A dropped folder keeps its handle, so the drop gets the same auto-save. */
  const handleDroppedFolder = useCallback(async (handle: BatchDirectoryHandleLike) => {
    try {
      const granted = await ensurePermission(handle, 'readwrite');
      setBusyLabel('读取文件夹…');
      const files = await directoryToSourceFiles(handle);
      if (files.length === 0) {
        setNotice({ tone: 'error', text: '拖入的文件夹里没有找到 <样本>/spatial 结构。' });
        return;
      }
      await importPackages(files, {
        parentHandle: granted ? handle : null,
        sessionName: handle.name,
      });
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : '读取文件夹失败' });
    } finally {
      setBusyLabel(null);
    }
  }, [importPackages]);

  /**
   * Rebuilds a batch from a session snapshot.
   *
   * The images are re-read from the source folder instead of being copied into
   * the snapshot, so the restored batch can be drawn on and exported exactly like
   * a freshly imported one; the package ids come from the session, which is what
   * keeps every alignment and region keyed to the right image.
   */
  const restoreSession = useCallback(async (
    session: BatchSession,
    parent: BatchDirectoryHandleLike,
    /**
     * Folder that was already located inside `parent` (e.g. when the operator
     * picked the data folder of an existing session): reuse it instead of making
     * a second `-natatoolkit` folder next to it.
     */
    existingWorkFolder?: BatchWorkFolder | null,
  ) => {
    setIsRestoring(true);
    setNotice(null);
    try {
      const available = new Set(await listDirectoryNames(parent));
      const missing = session.packages
        .filter((entry) => !available.has(entry.name))
        .map((entry) => entry.name);
      if (missing.length > 0) {
        throw new Error(`选中的文件夹里找不到这些样本目录：${missing.join('、')}`);
      }

      const built: BatchPackage[] = [];
      for (const [index, entry] of session.packages.entries()) {
        setBusyLabel(`恢复 ${entry.name}（${index + 1}/${session.packages.length}）…`);
        const files = await readPackageFilesByName(parent, entry.name);
        built.push(await buildBatchPackage({ name: entry.name, rootPath: '', files }, entry.id));
      }

      releasePackages(packagesRef.current);
      setPackages(built);
      setSessionId(session.id);
      setSessionName(session.name);
      setReferencePackageId(session.referencePackageId);
      setReferenceRegions(session.referenceRegions);
      setCustomRegions(session.customRegions);
      setAlignments(session.alignments);
      setAlignLinks(session.alignLinks);
      setAlignBaseId(session.alignBaseId);
      setCustomColors(session.customColors);
      setColorNames(
        Object.fromEntries(
          Object.entries(session.colorNames ?? {}).map(([key, value]) => [Number(key), value]),
        ),
      );
      setActiveColorId(session.activeColorId);
      setRegionTool(session.regionTool);
      setRegionMode(session.regionMode);
      setReferenceConfirmed(session.referenceConfirmed);
      setActivePackageId(session.activePackageId);
      setWalkthroughPackageId(session.walkthroughPackageId);
      setProjectDrawPackageId(session.projectDrawPackageId);
      setWalkthroughScope(session.walkthroughScope);
      setRegionScope(session.regionScope);
      clearRegionHistory();
      setStep(session.step);

      // Named after the data folder, exactly like a fresh folder import; a batch
      // restored from an older session may carry a sample name, which must not
      // become the folder name.
      const folder = existingWorkFolder ?? await openWorkFolder(parent, parent.name);
      setSessionName(parent.name);
      setWorkFolder(folder);
      setAutoSaveStatus('saved');
      setAutoSaveDetail(`已恢复会话 · 自动保存到 ${folder.name}/session.json`);
      setRecentSessions(await readBatchSessionSummaries());
      setNotice({
        tone: 'success',
        text: `已恢复会话「${session.name}」：${built.length} 个包，保存于 ${new Date(session.savedAt).toLocaleString()}。继续修改会自动保存。`,
      });
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : '恢复会话失败' });
    } finally {
      setIsRestoring(false);
      setBusyLabel(null);
    }
  }, [clearRegionHistory, releasePackages]);

  /**
   * "继续上次分析".
   *
   * The directory dialog has to be opened while the click that asked for it is
   * still current, so the granted handle is reused when it already works and the
   * picker runs before anything that could consume that user gesture.
   */
  const handleContinueSession = useCallback(async (summary: BatchSessionSummary) => {
    setBusyLabel('读取会话…');
    try {
      const stored = await readStoredBatchSession(summary.id);
      if (!stored) throw new Error('这条会话记录已经不存在了');

      const parent = await resolveRestoreFolder({
        storedHandle: stored.rootHandle,
        pick: () => pickDataDirectory('readwrite'),
      });
      await restoreSession(stored.session, parent);
    } catch (error) {
      reportPickerFailure(error);
    } finally {
      setBusyLabel(null);
    }
  }, [reportPickerFailure, restoreSession]);

  /**
   * Connects a folder to the current batch (or finishes a session-file import).
   *
   * Declared after `restoreSession` because a parked session file is completed
   * from this click: the folder dialog has to be the first thing it does.
   */
  const handleConnectWorkFolder = useCallback(async () => {
    try {
      const parent = await pickDataDirectory('readwrite');

      const pending = pendingSessionRef.current;
      if (pending) {
        pendingSessionRef.current = null;
        await restoreSession(pending, parent);
        return;
      }

      // The session folder follows the data folder the operator just picked, so
      // "连接数据文件夹…" produces the same `<数据目录名>-natatoolkit` as importing
      // through "选择数据文件夹（自动保存到本地）".
      const folder = await openWorkFolder(parent, parent.name);
      setSessionName(parent.name);
      setWorkFolder(folder);
      setAutoSaveStatus('saved');
      setAutoSaveDetail(`自动保存到 ${folder.name}/session.json`);
      await persistSession({ announce: true });
    } catch (error) {
      reportPickerFailure(error);
    }
  }, [persistSession, reportPickerFailure, restoreSession]);

  /**
   * Session file from disk.
   *
   * Parsed here, then parked until the operator clicks the folder button: two
   * pickers cannot run from one click (the second has no user gesture left).
   */
  const handleImportSessionFile = useCallback(async (file: File) => {
    setBusyLabel('读取会话文件…');
    try {
      const session = parseBatchSession(await file.text());
      pendingSessionRef.current = session;
      setNotice({
        tone: 'info',
        text: `已读取会话「${session.name}」（${session.packages.length} 个包）。请再点「连接数据文件夹…」选择样本所在目录，随后会自动恢复。`,
      });
    } catch (error) {
      reportPickerFailure(error);
    } finally {
      setBusyLabel(null);
    }
  }, [reportPickerFailure]);

  /** Picks the data folder and continues from the session stored inside it. */
  const handleOpenSavedFolder = useCallback(async () => {
    try {
      const parent = await pickDataDirectory('readwrite');
      const folder = await findWorkFolder(parent);
      if (!folder) {
        throw new Error(`这个文件夹里没有找到 *${BATCH_WORK_FOLDER_SUFFIX} 目录，请选择包含样本的父目录。`);
      }
      const text = await readSessionFile(folder);
      if (!text) throw new Error(`目录 ${folder.name} 里没有 ${BATCH_SESSION_FILE_NAME}`);
      // The folder was already found in this parent, so the restore keeps writing
      // there instead of creating a second `-natatoolkit` beside it.
      await restoreSession(parseBatchSession(text), parent, {
        parent,
        dir: folder,
        name: folder.name,
      });
    } catch (error) {
      reportPickerFailure(error);
    }
  }, [reportPickerFailure, restoreSession]);

  const handleDeleteSession = useCallback(async (summary: BatchSessionSummary) => {
    await deleteBatchSessionRecord(summary.id);
    setRecentSessions(await readBatchSessionSummaries());
    setNotice({ tone: 'info', text: `已删除会话记录「${summary.name}」（磁盘上的文件夹不受影响）。` });
  }, []);
  const clearAll = useCallback(() => {
    releasePackages(packagesRef.current);
    setPackages([]);
    setReferencePackageId(null);
    setAlignments({});
    setAlignLinks({});
    setAlignBaseId(null);
    setReferenceRegions([]);
    setCustomRegions({});
    setColorNames({});
    setShowTissueComparison(false);
    setProjectDrawPackageId(null);
    setActivePackageId(null);
    setReferenceConfirmed(false);
    setWalkthroughPackageId(null);
    setNotice(null);
    setStep('import');
    // The session on disk/browser stays where it is, so "继续上次分析" can still
    // bring it back; only the live workspace is emptied.
    setWorkFolder(null);
    setSessionId(null);
    setAutoSaveStatus('off');
    setAutoSaveDetail(null);
    clearRegionHistory();
  }, [clearRegionHistory, releasePackages]);
  const referencePackage = useMemo(
    () => packages.find((entry) => entry.id === referencePackageId) ?? null,
    [packages, referencePackageId],
  );
  const nonReferencePackages = useMemo(
    () => readyPackages(packages).filter((entry) => entry.id !== referencePackageId),
    [packages, referencePackageId],
  );
  /** Step 2 can move any sample; the batch frame's own image is no exception. */
  const alignablePackages = useMemo(() => readyPackages(packages), [packages]);
  /**
   * Pose of the reference image itself. The batch frame is its original frame, so
   * the reference is normally the identity — but step 2 also lets it be nudged
   * against another base, exactly like every other sample.
   */
  const referenceParams = useMemo(
    () => (referencePackageId
      ? resolveAlignment(alignments, referencePackageId)
      : createDefaultAlignment()),
    [alignments, referencePackageId],
  );
  const activeAlignPackage = useMemo(() => {
    const found = alignablePackages.find((entry) => entry.id === activePackageId);
    return found ?? nonReferencePackages[0] ?? alignablePackages[0] ?? null;
  }, [activePackageId, alignablePackages, nonReferencePackages]);
  const activeRegionPackage = useMemo(() => {
    const ready = alignablePackages;
    return ready.find((entry) => entry.id === activePackageId) ?? referencePackage ?? ready[0] ?? null;
  }, [activePackageId, alignablePackages, referencePackage]);
  const regionsByPackage = useMemo(() => resolveAllPackageRegions({
    packages,
    referencePackageId,
    referenceRegions,
    customRegions,
    alignments,
  }), [alignments, customRegions, packages, referencePackageId, referenceRegions]);
  const selectionByPackage = useMemo(() => {
    const result: Record<string, BatchSelectionResult> = {};
    for (const entry of packages) {
      if (entry.status !== 'ready' || !entry.spots || !entry.fullresSize) continue;
      result[entry.id] = computeSelection({
        spots: entry.spots,
        regions: regionsByPackage[entry.id] ?? [],
        size: entry.fullresSize,
        settings: selection,
        spotDiameterFullres: entry.spotDiameterFullres,
      });
    }
    return result;
  }, [packages, regionsByPackage, selection]);
  /**
   * The tissue each package already kept before this tool ran, read from the
   * second column of its `tissue_positions.csv` (`in_tissue`). Step 4 overlays
   * it on the region being drawn so the two can be compared.
   */
  const previousTissueByPackage = useMemo(() => {
    const result: Record<string, Set<string>> = {};
    for (const entry of packages) {
      if (!entry.spots) continue;
      result[entry.id] = new Set(
        entry.spots.filter((spot) => spot.inTissue).map((spot) => spot.barcode),
      );
    }
    return result;
  }, [packages]);
  const alignedCount = useMemo(
    () => nonReferencePackages.filter((entry) => !isDefaultAlignment(resolveAlignment(alignments, entry.id))).length,
    [alignments, nonReferencePackages],
  );
  const stepItems = useMemo<BatchStepItem[]>(() => {
    const hasPackages = packages.length > 0;
    const hasReference = Boolean(referencePackage);
    const hasRegions = referenceRegions.length > 0;
    // A resumed batch may carry per-image regions without a reference outline.
    const hasAnyRegions = hasRegions || Object.keys(customRegions).length > 0;
    const regionsProjected = hasAnyRegions
      && readyPackages(packages).every((entry) => (regionsByPackage[entry.id]?.length ?? 0) > 0);
    const selectionReady = regionsProjected
      && readyPackages(packages).every((entry) => Boolean(selectionByPackage[entry.id]));
    const annotatable = readyPackages(packages).filter((entry) => entry.id !== referencePackageId);
    const drawnByHand = annotatable.filter((entry) => hasCustomRegions(customRegions, entry.id)).length;
    const isPerImage = regionMode === 'perImage';
    return [
      {
        id: 'import',
        label: 'Import packages',
        description: 'Load n NATA packages.',
        status: hasPackages ? 'complete' : 'idle',
        enabled: true,
        hint: hasPackages ? `${packages.length} package(s) loaded` : 'Select a folder or drop packages',
        testId: 'batch-step-import',
      },
      {
        id: 'align',
        label: 'Align to reference',
        description: 'Rotate and scale every image onto image[0].',
        status: nonReferencePackages.length > 0 && alignedCount === nonReferencePackages.length ? 'complete' : 'ready',
        enabled: nonReferencePackages.length > 0,
        hint: nonReferencePackages.length > 0
          ? `${alignedCount}/${nonReferencePackages.length} aligned`
          : 'Needs at least two ready packages',
        testId: 'batch-step-align',
      },
      {
        id: 'referenceRegion',
        label: isPerImage ? 'Annotate each image' : 'Draw region on image[0]',
        description: isPerImage
          ? 'Draw the reference, confirm it, then outline every image.'
          : 'Annotate the reference image once.',
        status: hasRegions ? 'complete' : 'ready',
        enabled: hasReference,
        hint: !isPerImage
          ? (hasRegions ? `${referenceRegions.length} region(s)` : 'Draw at least one region')
          : referenceConfirmed
            ? `${drawnByHand}/${annotatable.length} drawn by hand`
            : 'Draw the reference, then confirm it',
        testId: 'batch-step-reference-region',
      },
      {
        id: 'imageRegions',
        label: isPerImage ? 'Review each image' : 'Adjust each image',
        description: isPerImage
          ? 'Second pass over the regions you drew.'
          : 'Refine the projected region on every image.',
        status: selectionReady ? 'complete' : 'ready',
        enabled: hasAnyRegions,
        hint: !regionsProjected
          ? 'Waiting for the reference region'
          : isPerImage
            ? 'Editable second pass on step 3'
            : 'Projection from image[0]',
        testId: 'batch-step-image-regions',
      },
      {
        id: 'review',
        label: 'Export packages',
        description: 'Write in_selected and transform-matrix.csv.',
        status: selectionReady ? 'ready' : 'idle',
        enabled: hasAnyRegions,
        hint: 'tissue_positions.csv + transform-matrix.csv',
        testId: 'batch-step-review',
      },
    ];
  }, [
    alignedCount,
    customRegions,
    nonReferencePackages,
    packages,
    referencePackage,
    referenceConfirmed,
    referencePackageId,
    regionMode,
    referenceRegions.length,
    regionsByPackage,
    selectionByPackage,
  ]);
  /**
   * Writes absolute alignments plus the links behind them.
   *
   * Every package stores a `package -> reference` transform, but an overlay may
   * have been dialled against another image. When that base image moves, the
   * dependants are re-composed from their stored relative values so a chain like
   * `image 3 -> image 2 -> image 1` stays consistent.
   */
  const applyAlignmentUpdates = useCallback((
    updates: Record<string, BatchSimilarityParams>,
    linkUpdates: Record<string, AlignmentLink | null>,
  ) => {
    const next = applyAlignmentEdits({
      alignments,
      links: alignLinks,
      updates,
      linkUpdates,
    });
    setAlignments(next.alignments);
    setAlignLinks(next.links);
  }, [alignLinks, alignments]);
  /** Points one package's alignment at another base without moving it.
 */
  const chooseAlignBase = useCallback((packageId: string, baseId: string) => {
    const link = linkAlignmentToBase({
      alignments,
      packageId,
      baseId,
      referencePackageId,
    });

    // Remember the pick for the samples that have no base of their own yet.
    setAlignBaseId(baseId);
    setAlignLinks((previous) => {
      const next = { ...previous };
      if (link) {
        next[packageId] = link;
      } else {
        delete next[packageId];
      }
      return next;
    });
  }, [alignments, referencePackageId]);
  /**
   * Stores a pose dialled in the batch frame.
   *
   * The pose is absolute, but when the overlay was matched against another
   * sample its relative values are recorded too, so the pair stays together if
   * that base image is adjusted again.
   */
  const commitAlignParams = useCallback((
    packageId: string,
    baseId: string | null,
    absolute: BatchSimilarityParams,
  ) => {
    const link = baseId
      ? linkAlignmentToBase({
          alignments: { ...alignments, [packageId]: absolute },
          packageId,
          baseId,
          referencePackageId,
        })
      : null;

    // The newest pair wins: `package -> base` and `base -> package` cannot both
    // hold, otherwise the two images would drag each other around.
    const linkUpdates: Record<string, AlignmentLink | null> = { [packageId]: link };
    if (baseId && alignLinks[baseId]?.baseId === packageId) linkUpdates[baseId] = null;

    applyAlignmentUpdates({ [packageId]: absolute }, linkUpdates);
  }, [alignLinks, alignments, applyAlignmentUpdates, referencePackageId]);
  /** Puts every overlay back on its default pose and drops the base links.
 */
  const resetAllAlignments = useCallback(() => {
    applyAlignmentUpdates(
      Object.fromEntries(packages.map((entry) => [entry.id, createDefaultAlignment()])),
      Object.fromEntries(Object.keys(alignLinks).map((id) => [id, null])),
    );
  }, [alignLinks, applyAlignmentUpdates, packages]);
  /** Moves a package to a new position in the sample order.
 */
  const movePackage = useCallback((packageId: string, toIndex: number) => {
    setPackages((previous) => {
      const from = previous.findIndex((entry) => entry.id === packageId);
      if (from < 0) return previous;
      const next = [...previous];
      const [moved] = next.splice(from, 1);
      const target = Math.max(0, Math.min(toIndex, next.length));
      next.splice(target, 0, moved);
      return next;
    });
  }, []);
  /**
   * Re-bases the batch onto another reference image.
   *
   * Nothing moves on screen: every package transform and the region drawn on the
   * old reference are re-expressed in the new reference's frame.
   */
  const changeReference = useCallback((nextReferenceId: string) => {
    if (nextReferenceId === referencePackageId) return;
    const currentReference = packages.find((entry) => entry.id === referencePackageId) ?? null;
    if (!currentReference) {
      setReferencePackageId(nextReferenceId);
      return;
    }
    // Alignments describe `package -> current reference`, so moving the frame
    // means post-multiplying by the inverse of the *new* reference's transform.
    const toNewReference = invertAffine(
      similarityNormalizedMatrix(resolveAlignment(alignments, nextReferenceId)),
    );
    if (toNewReference) {
      const rebased: Record<string, BatchSimilarityParams> = {};
      for (const entry of packages) {
        rebased[entry.id] = decomposeNormalizedSimilarity(
          composeAffine(toNewReference, similarityNormalizedMatrix(resolveAlignment(alignments, entry.id))),
        ) ?? createDefaultAlignment();
      }
      const transfer = transferReferenceRegions({
        previousReferenceId: currentReference.id,
        nextReferenceId,
        previousReferenceRegions: referenceRegions,
        customRegions,
        // The outline lives in the *old reference image's* frame, so it needs one
        // extra hop through that image's own pose before landing in the new frame.
        toNextReference: composeAffine(
          toNewReference,
          similarityNormalizedMatrix(resolveAlignment(alignments, currentReference.id)),
        ),
      });
      setAlignments(rebased);
      setReferenceRegions(transfer.referenceRegions);
      setCustomRegions(transfer.customRegions);
      // The image on the right is the operator's own choice, so starring another
      // chip must not move it. It may even be the image that just became the
      // reference, which is how the two panels end up showing the same photo.
    }
    setReferencePackageId(nextReferenceId);
  }, [alignments, customRegions, packages, referencePackageId, referenceRegions]);
  const regionColors = useMemo(
    () => [...BATCH_REGION_COLORS, ...customColors].map((color) => {
      const name = colorNames[color.id];
      return name ? { ...color, name } : color;
    }),
    [colorNames, customColors],
  );
  /**
   * Renames a colour group. The class id never moves — it is the value written
   * to `selected_class` — so a rename is only the operator's own wording.
   */
  const renameRegionColor = useCallback((colorId: number, name: string) => {
    const trimmed = name.trim();
    if (trimmed === '') return;
    setColorNames((previous) => ({ ...previous, [colorId]: trimmed }));
  }, []);
  /** Adds a picked colour as a new class and selects it for drawing.
 */
  const addRegionColor = useCallback((hex: string) => {
    const color = createRegionColor(
      nextRegionColorId([...BATCH_REGION_COLORS, ...customColors]),
      hex,
    );
    setCustomColors((previous) => [...previous, color]);
    setActiveColorId(color.id);
  }, [customColors]);
  /** Drops every added colour and falls back to a built-in one if needed.
 */
  const clearRegionColors = useCallback(() => {
    const customIds = new Set(customColors.map((color) => color.id));
    setCustomColors([]);
    setActiveColorId((current) => (customIds.has(current) ? DEFAULT_REGION_COLOR_ID : current));
  }, [customColors]);
  // The palette is per session, so a reload starts from the built-in five. The
  // leftover key from the builds that persisted it is dropped once here.
  useEffect(() => {
    clearStoredRegionColors();
  }, []);
  /**
   * Applies a stroke drawn in the reference frame to the shared outline and to
   * every per-image override.
   *
   * This is the default behaviour in steps 3 and 4: one stroke is mapped onto
   * every adjusted image — the reference included — so the whole batch keeps a
   * single region. The overrides are updated in lockstep, otherwise an image
   * that was edited earlier would mask the shared stroke on itself.
   */
  const commitSharedStroke = useCallback((
    points: BatchPoint[],
    tool: BatchRegionTool,
    colorId: number,
  ) => {
    const stroke = createRegion(points, colorId);
    if (!stroke) return;
    // One undo step for the whole operation: the outline and every override are
    // snapshotted together, so a single Undo reverts a single stroke.
    recordRegionHistory([
      { key: REFERENCE_REGION_KEY, regions: referenceRegions },
      ...Object.entries(customRegions).map(([packageId, regions]) => ({ key: packageId, regions })),
    ]);
    const next = applySharedStroke({
      referenceRegions,
      customRegions,
      alignments,
      // The outline lives in the reference image's own frame, which may carry a pose.
      referenceParams,
      stroke,
      tool,
      colorId,
    });
    setReferenceRegions(next.referenceRegions);
    setCustomRegions(next.customRegions);
  }, [alignments, customRegions, recordRegionHistory, referenceParams, referenceRegions]);
  const updateReferenceRegions = useCallback((
    updater: (previous: BatchRegion[]) => BatchRegion[],
  ) => {
    setReferenceRegions(updater);
  }, []);
  const clearReferenceRegions = useCallback(() => {
    recordRegionHistory([{ key: REFERENCE_REGION_KEY, regions: referenceRegions }]);
    updateReferenceRegions(() => []);
  }, [recordRegionHistory, referenceRegions, updateReferenceRegions]);
  /**
   * Clears the region for the whole batch: the shared outline and every
   * per-image override, so all packages follow the (now empty) outline.
   */
  const clearSharedRegions = useCallback(() => {
    recordRegionHistory([
      { key: REFERENCE_REGION_KEY, regions: referenceRegions },
      ...Object.entries(customRegions).map(([packageId, regions]) => ({ key: packageId, regions })),
    ]);
    setReferenceRegions([]);
    setCustomRegions({});
  }, [customRegions, recordRegionHistory, referenceRegions]);
  const commitPackageStroke = useCallback((
    packageId: string,
    points: BatchPoint[],
    tool: BatchRegionTool,
    colorId: number,
  ) => {
    const stroke = createRegion(points, colorId);
    if (!stroke) return;
    // Steps 3 and 4 draw on the aligned view, so strokes arrive in the
    // reference frame and are converted back into the package's own frame.
    const [ownedStroke] = mapReferenceRegionsToPackage(
      [stroke],
      resolveAlignment(alignments, packageId),
    );
    if (!ownedStroke) return;
    // The reference outline lives in `referenceRegions` only. Step 4 lets the
    // operator draw on the reference panel, and storing that in `customRegions`
    // would make the strokes vanish as soon as the reference is switched.
    if (packageId === referencePackageId) {
      recordRegionHistory([{ key: REFERENCE_REGION_KEY, regions: referenceRegions }]);
      setReferenceRegions((previous) => applyRegionStroke(previous, ownedStroke, tool, colorId));
      return;
    }
    const derived = resolveRegionsForPackage({
      packageId,
      referencePackageId,
      referenceRegions,
      customRegions: {},
      alignments,
    });
    const current = customRegions[packageId] ?? derived;
    // The snapshot is the *override*, so undoing the first stroke on an image
    // hands it back to the projected region instead of leaving an empty one.
    recordRegionHistory([{ key: packageId, regions: customRegions[packageId] ?? null }]);
    setCustomRegions((previous) => ({
      ...previous,
      [packageId]: applyRegionStroke(current, ownedStroke, tool, colorId),
    }));
  }, [
    alignments,
    customRegions,
    recordRegionHistory,
    referencePackageId,
    referenceRegions,
  ]);
  /** Clears one image's regions, treating the reference as its own slot.
 */
  const clearPackageRegions = useCallback((packageId: string) => {
    if (packageId === referencePackageId) {
      clearReferenceRegions();
      return;
    }
    recordRegionHistory([{ key: packageId, regions: customRegions[packageId] ?? null }]);
    setCustomRegions((previous) => ({ ...previous, [packageId]: [] }));
  }, [clearReferenceRegions, customRegions, recordRegionHistory, referencePackageId]);
  const resetPackageRegions = useCallback((packageId: string) => {
    recordRegionHistory([{ key: packageId, regions: customRegions[packageId] ?? null }]);
    setCustomRegions((previous) => {
      const next = { ...previous };
      delete next[packageId];
      return next;
    });
  }, [customRegions, recordRegionHistory]);
  const collectExportInputs = useCallback((subset: readonly BatchPackage[]) => buildExportInputs({
    packages: subset,
    referencePackageId,
    alignments,
    selectionByPackage,
    matrixLayout,
    matrixConvention,
    colors: regionColors,
  }), [alignments, matrixConvention, matrixLayout, referencePackageId, regionColors, selectionByPackage]);
  const handleExportAll = useCallback(async () => {
    setIsExporting(true);
    try {
      const inputs = collectExportInputs(packages);
      for (const input of inputs) {
        const blob = await buildBatchPackageZip(input);
        downloadBlob(blob, buildPackageExportFileName(input.packageName));
        // Sequential downloads stay within the browser's per-gesture limits.
        await new Promise((resolve) => window.setTimeout(resolve, 350));
      }
      setNotice({ tone: 'success', text: `Exported ${inputs.length} package(s).` });
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Export failed.' });
    } finally {
      setIsExporting(false);
    }
  }, [collectExportInputs, packages]);
  const handleExportBundle = useCallback(async () => {
    setIsExporting(true);
    try {
      const inputs = collectExportInputs(packages);
      const blob = await buildBatchBundleZip(inputs);
      downloadBlob(blob, 'nata-batch-selection.zip');
      setNotice({ tone: 'success', text: `Exported ${inputs.length} package(s) as one archive.` });
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Export failed.' });
    } finally {
      setIsExporting(false);
    }
  }, [collectExportInputs, packages]);
  const handleExportOne = useCallback(async (entry: BatchPackage) => {
    setIsExporting(true);
    try {
      const [input] = collectExportInputs([entry]);
      const blob = await buildBatchPackageZip(input);
      downloadBlob(blob, buildPackageExportFileName(input.packageName));
      setNotice({ tone: 'success', text: `Exported ${entry.name}.` });
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Export failed.' });
    } finally {
      setIsExporting(false);
    }
  }, [collectExportInputs]);
  const matrixPreviewByPackage = useMemo(() => {
    const previews: Record<string, string> = {};
    const referenceSize = referencePackage?.fullresSize;
    if (!referenceSize) return previews;
    for (const entry of packages) {
      if (!entry.fullresSize) continue;
      previews[entry.id] = buildTransformMatrixCsv({
        params: resolveAlignment(alignments, entry.id),
        packageSize: entry.fullresSize,
        referenceSize,
        layout: matrixLayout,
        convention: matrixConvention,
      }).trim();
    }
    return previews;
  }, [alignments, matrixConvention, matrixLayout, packages, referencePackage]);
  const activeAlignParams = useMemo(
    () => (activeAlignPackage
      ? resolveAlignment(alignments, activeAlignPackage.id)
      : { ...DEFAULT_SIMILARITY_PARAMS }),
    [activeAlignPackage, alignments],
  );
  const alignIndex = activeAlignPackage
    ? alignablePackages.findIndex((entry) => entry.id === activeAlignPackage.id)
    : -1;
  /** The picked base is the image being moved, so another sample stands in for now. */
  const substitutedBase = alignBaseId && activeAlignPackage && alignBaseId === activeAlignPackage.id
    ? alignablePackages.find((entry) => entry.id === alignBaseId) ?? null
    : null;
  /**
   * Image drawn underneath the active overlay.
   *
   * Fixed for the whole session: it starts on the batch reference and moves only
   * when the operator stars another chip, which is what lets them chain the
   * alignment: match image 2 onto image 1, then use image 2 as the base for
   * image 3.
   */
  const alignBasePackage = useMemo(() => {
    if (!activeAlignPackage) return referencePackage;

    const ready = alignablePackages;
    const usable = (packageId: string | null | undefined) => {
      if (!packageId || packageId === activeAlignPackage.id) return null;
      return ready.find((entry) => entry.id === packageId) ?? null;
    };

    // The base is fixed: it changes only when the operator stars another chip (or
    // uses "use as base & next"), never merely because another sample is selected.
    // The per-package links behind the chaining are a *follow* relationship, so
    // they are deliberately not consulted here. The only automatic change happens
    // when the base would be the image being moved — a sample cannot sit on itself.
    return usable(alignBaseId)
      ?? usable(referencePackage?.id)
      ?? ready.find((entry) => entry.id !== activeAlignPackage.id)
      ?? null;
  }, [activeAlignPackage, alignBaseId, alignablePackages, referencePackage]);
  const activeRegions = useMemo(
    () => (activeRegionPackage ? regionsByPackage[activeRegionPackage.id] ?? [] : []),
    [activeRegionPackage, regionsByPackage],
  );
  const activeIsCustom = activeRegionPackage
    ? hasCustomRegions(customRegions, activeRegionPackage.id)
    : false;
  /**
   * Every ready package, the reference included: the walkthrough can load any
   * of them into the right-hand panel, so the reference is allowed to sit in
   * both panels at once. The chip decides the right panel, the ☆ decides the
   * reference (and with it the locked panel on the left).
   */
  const walkthroughPackages = useMemo(() => readyPackages(packages), [packages]);
  const walkthroughPackage = useMemo(() => {
    const found = walkthroughPackages.find((entry) => entry.id === walkthroughPackageId);
    return found ?? nonReferencePackages[0] ?? walkthroughPackages[0] ?? null;
  }, [nonReferencePackages, walkthroughPackageId, walkthroughPackages]);
  const walkthroughParams = walkthroughPackage
    ? resolveAlignment(alignments, walkthroughPackage.id)
    : null;
  const walkthroughOwnRegions = useMemo(
    () => (walkthroughPackage ? regionsByPackage[walkthroughPackage.id] ?? [] : []),
    [regionsByPackage, walkthroughPackage],
  );
  const walkthroughIndex = walkthroughPackage
    ? walkthroughPackages.findIndex((entry) => entry.id === walkthroughPackage.id)
    : -1;
  const stepWalkthrough = useCallback((offset: number) => {
    if (walkthroughIndex < 0) return;
    const next = walkthroughPackages[walkthroughIndex + offset];
    if (next) setWalkthroughPackageId(next.id);
  }, [walkthroughIndex, walkthroughPackages]);
  /**
   * Empty-margin trim for the aligned views.
   *
   * The panels live in the batch frame, so every image's own tissue box — the
   * reference included, which can carry a pose of its own — is mapped into that
   * frame before the boxes are unioned. Otherwise a section whose tissue reaches
   * further would be clipped.
   */
  const viewBoundsFor = useCallback((entry: BatchPackage | null): BatchBounds | null => {
    const boxOf = (item: BatchPackage | null) => (
      item?.contentBounds
        ? transformBounds(
            item.contentBounds,
            similarityNormalizedMatrix(resolveAlignment(alignments, item.id)),
          )
        : null
    );

    const ownBox = boxOf(entry);
    if (!entry || entry.id === referencePackage?.id) return ownBox;

    const referenceBox = boxOf(referencePackage);
    if (!referenceBox) return ownBox;
    if (!ownBox) return referenceBox;
    return unionBounds(referenceBox, ownBox);
  }, [alignments, referencePackage]);
  const referenceViewBounds = viewBoundsFor(referencePackage);
  /** The reference image shown in its own frame, used by the step-3 drawing stage. */
  const referenceOwnViewBounds = referencePackage?.contentBounds ?? null;
  /**
   * Both panels of the per-image walkthrough share one view box, otherwise the
   * reference is cropped to its own tissue while the drawing panel is cropped to
   * the union of both and the two pictures no longer line up.
   */
  const walkthroughViewBounds = walkthroughPackage
    ? viewBoundsFor(walkthroughPackage)
    : referenceViewBounds;
  /** Step 4 shows the same pair of panels, so it shares the view contract.
 */
  const regionViewBounds = activeRegionPackage
    ? viewBoundsFor(activeRegionPackage)
    : referenceViewBounds;
  /**
   * Builds the "already rotated and scaled onto the reference" frame for a
   * package, which is what steps 3 and 4 display.
   */
  const buildAlignedFrame = useCallback((entry: BatchPackage): BatchRegionFrame | null => {
    const referenceSize = referencePackage?.fullresSize;
    if (!referenceSize || !entry.fullresSize || !entry.previewSize) return null;
    const fullresToFrame = similarityPixelMatrix(
      resolveAlignment(alignments, entry.id),
      entry.fullresSize,
      referenceSize,
    );
    return {
      size: referenceSize,
      fullresToFrame,
      previewToFrame: scaleAffineInput(
        fullresToFrame,
        entry.fullresSize.width / entry.previewSize.width,
        entry.fullresSize.height / entry.previewSize.height,
      ),
    };
  }, [alignments, referencePackage]);
  const walkthroughAlignedFrame = walkthroughPackage
    ? buildAlignedFrame(walkthroughPackage)
    : null;
  const activeAlignedFrame = activeRegionPackage
    ? buildAlignedFrame(activeRegionPackage)
    : null;
  const referenceAlignedFrame = referencePackage
    ? buildAlignedFrame(referencePackage)
    : null;
  /**
   * The shared outline is stored in the reference image's own frame; the panels
   * draw the batch frame, so it is lifted by the reference's own pose. With the
   * reference at identity the two are the same list.
   */
  const referenceWorldRegions = useMemo(
    () => mapPackageRegionsToReference(referenceRegions, referenceParams),
    [referenceParams, referenceRegions],
  );
  const walkthroughDisplayRegions = useMemo(
    () => (walkthroughParams
      ? mapPackageRegionsToReference(walkthroughOwnRegions, walkthroughParams)
      : []),
    [walkthroughOwnRegions, walkthroughParams],
  );
  const activeRegionParams = activeRegionPackage
    ? resolveAlignment(alignments, activeRegionPackage.id)
    : null;
  const activeDisplayRegions = useMemo(
    () => (activeRegionParams
     ? mapPackageRegionsToReference(activeRegions, activeRegionParams)
     : []),
    [activeRegions, activeRegionParams],
  );
  /**
   * Step 3's project mode draws one shared region, but the operator may trace it
   * on any sample: the reference is drawn in its own frame, every other image is
   * shown already aligned onto that frame with the outline as a dashed guide.
   */
  const projectDrawPackage = useMemo(
    () => readyPackages(packages).find((entry) => entry.id === projectDrawPackageId)
      ?? referencePackage,
    [packages, projectDrawPackageId, referencePackage],
  );
  const projectDrawParams = projectDrawPackage
    ? resolveAlignment(alignments, projectDrawPackage.id)
    : null;
  const projectDrawDisplayRegions = useMemo(
    () => (projectDrawPackage && projectDrawParams
      ? mapPackageRegionsToReference(regionsByPackage[projectDrawPackage.id] ?? [], projectDrawParams)
      : []),
    [projectDrawPackage, projectDrawParams, regionsByPackage],
  );
  const projectDrawUsesReferenceFrame = Boolean(
    projectDrawPackage && projectDrawPackage.id !== referencePackage?.id,
  );
  const projectDrawAlignedFrame = projectDrawUsesReferenceFrame && projectDrawPackage
    ? buildAlignedFrame(projectDrawPackage)
    : null;
  const projectDrawViewBounds = projectDrawUsesReferenceFrame
    ? viewBoundsFor(projectDrawPackage)
    : referenceOwnViewBounds;
  /** Reference-frame points expressed in the batch frame. */
  const referencePointsToBatch = useCallback((points: readonly BatchPoint[]): BatchPoint[] => {
    const matrix = similarityNormalizedMatrix(referenceParams);
    return points.map((point) => applyAffine(matrix, point));
  }, [referenceParams]);
  const renderReferenceStage = (description: string) => (
    <BatchRegionStage
      title={`Draw the selection on ${referencePackage?.name ?? 'the reference image'}`}
      description={description}
      imageUrl={referencePackage?.previewUrl ?? null}
      imageSize={referencePackage?.fullresSize ?? null}
      // This stage shows the reference in its own frame, so its stroke points are
      // lifted into the batch frame before they reach the shared outline.
      viewBounds={referenceOwnViewBounds}
      regions={referenceRegions}
      tool={regionTool}
      onToolChange={setRegionTool}
      activeColorId={activeColorId}
      onActiveColorChange={setActiveColorId}
      colors={regionColors}
      onAddColor={addRegionColor}
      onClearColors={clearRegionColors}
      onRenameColor={renameRegionColor}
      spots={referencePackage?.spots ?? null}
      selectedBarcodeSet={
        referencePackage
          ? new Set(selectionByPackage[referencePackage.id]?.selectedBarcodes ?? [])
          : null
      }
      spotDiameterFullres={referencePackage?.spotDiameterFullres ?? null}
      anchorMode={selection.anchorMode}
      // The reference stage draws the shared region too, so per-image overrides
      // made earlier stay in sync instead of masking the new stroke.
      onCommitStroke={(points, tool, colorId) => (
        commitSharedStroke(referencePointsToBatch(points), tool, colorId)
      )}
      onUndoRegion={undoRegionEdit}
      canUndo={canUndoRegions}
      onClearRegions={clearSharedRegions}
      testIdPrefix='batch-reference-region'
    />
  );
  return (
    <Stack spacing={6} data-testid='batch-workspace'>
      <Flex justify='space-between' align={{ base: 'flex-start', md: 'center' }} gap={4} wrap='wrap'>
        <Stack spacing={1}>
          <Heading size='lg'>NATA toolkit - Multi Slides Alignment</Heading>
          <Text color='gray.500' maxW='780px'>
            Import n NATA packages, align every full-resolution slide to the reference, outline the tissue
            region once, then export each package with a barcode selection column and its transform matrix.
          </Text>
        </Stack>
        <HStack spacing={3}>
          <Link as={NextLink} href='/preprocess' color='brand.600' fontWeight='medium'>Preprocessing</Link>
          <Link as={NextLink} href='/' color='brand.600' fontWeight='medium'>Home</Link>
        </HStack>
      </Flex>
      {notice ? (
        <Alert status={notice.tone} borderRadius='xl' data-testid='batch-notice'>
          <AlertIcon />
          <AlertDescription>{notice.text}</AlertDescription>
        </Alert>
      ) : null}
      {/*
        Session bar: present in every step, because saving has to be possible at
        every stage and the operator needs to see where the auto-save lands.
      */}
      <Card
        border='1px solid'
        borderColor='gray.200'
        borderRadius='2xl'
        boxShadow='sm'
        bg='white'
        data-testid='batch-session-bar'
      >
        <CardBody p={{ base: 3, xl: 4 }}>
          <Flex justify='space-between' align={{ base: 'flex-start', xl: 'center' }} gap={3} wrap='wrap'>
            <HStack spacing={3} align='flex-start'>
              <Badge
                colorScheme={AUTO_SAVE_TONE[autoSaveStatus]}
                borderRadius='full'
                px={2}
                py={0.5}
                mt={0.5}
                data-testid='batch-autosave-status'
              >
                {AUTO_SAVE_LABEL[autoSaveStatus]}
              </Badge>
              <Stack spacing={0}>
                <Text fontSize='sm' fontWeight='medium'>
                  分阶段保存 · 会话
                  {workFolder ? ` · ${workFolder.name}` : ''}
                </Text>
                <Text fontSize='xs' color='gray.500' data-testid='batch-autosave-detail'>
                  {autoSaveDetail
                    ?? (packages.length === 0
                      ? '导入数据后，每次改动都会自动保存，可随时手动另存'
                      : '准备中…')}
                </Text>
              </Stack>
            </HStack>
            <HStack spacing={2} wrap='wrap'>
              <Button
                size='xs'
                colorScheme='brand'
                variant='outline'
                isDisabled={packages.length === 0 || isRestoring}
                onClick={handleSaveNow}
                data-testid='batch-save-now'
              >
                立即保存
              </Button>
              <Button
                size='xs'
                variant='outline'
                isDisabled={packages.length === 0 || !workFolder}
                title={workFolder ? `在 ${workFolder.name}/ 里留一份带时间戳的快照` : '先连接数据文件夹'}
                onClick={handleSaveSnapshot}
                data-testid='batch-save-snapshot'
              >
                另存快照
              </Button>
              <Button
                size='xs'
                variant='outline'
                isDisabled={packages.length === 0}
                onClick={handleDownloadSession}
                data-testid='batch-download-session'
              >
                下载会话文件
              </Button>
              <Button
                size='xs'
                variant='ghost'
                isLoading={isRestoring}
                onClick={handleOpenSavedFolder}
                data-testid='batch-open-saved-folder'
              >
                打开会话文件夹…
              </Button>
              <Button
                size='xs'
                variant='ghost'
                isDisabled={!supportsWorkFolder()}
                title={supportsWorkFolder() ? undefined : WORK_FOLDER_UNSUPPORTED_MESSAGE}
                onClick={handleConnectWorkFolder}
                data-testid='batch-connect-folder'
              >
                {workFolder ? '更换数据文件夹…' : '连接数据文件夹…'}
              </Button>
              <input
                ref={sessionFileInputRef}
                type='file'
                accept='.json,application/json'
                hidden
                data-testid='batch-session-file-input'
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void handleImportSessionFile(file);
                  event.target.value = '';
                }}
              />
              <Button
                size='xs'
                variant='ghost'
                isLoading={isRestoring}
                onClick={() => sessionFileInputRef.current?.click()}
                data-testid='batch-import-session'
              >
                导入会话文件…
              </Button>
            </HStack>
          </Flex>
        </CardBody>
      </Card>
      <Flex gap={6} align='flex-start' direction={{ base: 'column', lg: 'row' }}>
        <BatchStepRail currentStep={step} items={stepItems} onSelect={setStep} />
        <Stack spacing={4} flex='1' minW={0}>
          {step === 'import' ? (
            <BatchImportPanel
              packages={packages}
              referencePackageId={referencePackageId}
              busyLabel={busyLabel}
              onReferenceChange={changeReference}
              onSelectedFiles={importPackages}
              onClear={clearAll}
              onReorder={movePackage}
              recentSessions={recentSessions}
              workFolderName={workFolder?.name ?? null}
              onPickDataFolder={handlePickDataFolder}
              onDroppedFolder={handleDroppedFolder}
              onContinueSession={handleContinueSession}
              onDeleteSession={handleDeleteSession}
            />
          ) : null}
          {step === 'align' ? (
            <Card border='1px solid' borderColor='gray.200' borderRadius='2xl' boxShadow='sm' bg='white'>
              <CardBody p={{ base: 4, xl: 5 }}>
                <Stack spacing={4}>
                  <Flex justify='space-between' align={{ base: 'flex-start', md: 'center' }} gap={3} wrap='wrap'>
                    <Stack spacing={1}>
                      <Text fontSize='lg' fontWeight='semibold'>
                        Align every image to {referencePackage?.name ?? 'the reference'}
                      </Text>
                      <Text fontSize='sm' color='gray.500'>
                        Rotate, scale and shift each overlay until it matches the reference, then move on to the next package.
                        The base image underneath can be swapped per package, which also lets you chain the
                        alignment: match image 2 onto image 1, then use image 2 as the base for image 3.
                      </Text>
                    </Stack>
                    <HStack spacing={2}>
                      <Badge
                        colorScheme={nonReferencePackages.length > 0 && alignedCount === nonReferencePackages.length ? 'green' : 'orange'}
                        borderRadius='full'
                      >
                        {alignedCount}/{nonReferencePackages.length} aligned
                      </Badge>
                      <Button
                        size='sm'
                        variant='outline'
                        onClick={resetAllAlignments}
                      >
                        Reset all
                      </Button>
                    </HStack>
                  </Flex>
                  {activeAlignPackage ? (
                    <>
                      <Divider />
                      <Stack spacing={2}>
                        <Stack spacing={0}>
                          <Text fontSize='sm' fontWeight='semibold'>Samples and base image</Text>
                          <Text fontSize='xs' color='gray.500'>
                            Pick a sample to align it; ☆ moves the base image underneath. The base is shown in
                            the pose you already gave it, so you can chain the alignment: match image 2 onto
                            image 1, then star image 2 and match image 3 onto it. A chained image follows later
                            adjustments of its base. The base stays put while you switch samples — it changes
                            only when you star another chip. Every sample can be moved, image 1 included.
                          </Text>
                        </Stack>
                        <PackageStrip
                          packages={alignablePackages}
                          referencePackageId={alignBasePackage?.id ?? null}
                          activePackageId={activeAlignPackage.id}
                          designateLabel='base'
                          designateTitle='Use this image as the base underneath the overlay'
                          isDesignateDisabled={(entry) => entry.id === activeAlignPackage.id}
                          testIdPrefix='batch-align'
                          // Any sample can be the overlay, image[0] included; the base
                          // simply has to be a different image.
                          onSelect={setActivePackageId}
                          onSetReference={(packageId) => chooseAlignBase(activeAlignPackage.id, packageId)}
                          onReorder={movePackage}
                          describe={(entry) => {
                            if (entry.id === activeAlignPackage.id) return 'being aligned';
                            if (entry.id === alignBasePackage?.id) return 'base';
                            const params = resolveAlignment(alignments, entry.id);
                            const base = alignLinks[entry.id]
                              ? alignablePackages.find((item) => item.id === alignLinks[entry.id].baseId)
                              : null;
                            return `${params.rotationDegrees.toFixed(1)}° · ${params.scale.toFixed(3)}×${base ? ` · follows ${base.name}` : ''}`;
                          }}
                        />
                        {substitutedBase ? (
                          <Text fontSize='xs' color='orange.500' data-testid='batch-align-base-substituted'>
                            {substitutedBase.name} is the image being aligned, so {alignBasePackage?.name} is
                            used as the base for now. Pick another sample to get {substitutedBase.name} back
                            underneath.
                          </Text>
                        ) : null}
                      </Stack>
                      <BatchAlignStage
                        base={toAlignTarget(alignBasePackage)}
                        baseParams={alignBasePackage
                          ? resolveAlignment(alignments, alignBasePackage.id)
                          : { ...DEFAULT_SIMILARITY_PARAMS }}
                        frame={referencePackage?.fullresSize ?? null}
                        moving={toAlignTarget(activeAlignPackage)}
                        params={activeAlignParams}
                        frameName={referencePackage?.name}
                        anchorMode={selection.anchorMode}
                        matrixConvention={matrixConvention}
                        onParamsChange={(params) => (
                          commitAlignParams(
                            activeAlignPackage.id,
                            alignBasePackage?.id ?? null,
                            params,
                          )
                        )}
                      />
                      <HStack spacing={3} wrap='wrap'>
                        <Button
                          size='sm'
                          variant='outline'
                          title='Copy this overlay pose onto every other image; the copies stop following a base'
                          onClick={() => {
                            const updates: Record<string, BatchSimilarityParams> = {};
                            const clearedLinks: Record<string, AlignmentLink | null> = {};
                            alignablePackages.forEach((entry) => {
                              if (entry.id === activeAlignPackage.id) return;
                              updates[entry.id] = normalizeSimilarityParams(activeAlignParams);
                              clearedLinks[entry.id] = null;
                            });
                            applyAlignmentUpdates(updates, clearedLinks);
                          }}
                        >
                          Apply this transform to all images
                        </Button>
                        <Button
                          size='sm'
                          variant='ghost'
                          title='Back to the default pose in the batch frame'
                          onClick={() => commitAlignParams(
                            activeAlignPackage.id,
                            alignBasePackage?.id ?? null,
                            { ...DEFAULT_SIMILARITY_PARAMS },
                          )}
                        >
                          Reset this image
                        </Button>
                        <Button
                          size='sm'
                          variant='ghost'
                          isDisabled={alignIndex >= alignablePackages.length - 1}
                          title='Use this image as the base for the next one'
                          onClick={() => {
                            const next = alignablePackages[alignIndex + 1];
                            if (!next) return;
                            chooseAlignBase(next.id, activeAlignPackage.id);
                            setActivePackageId(next.id);
                          }}
                        >
                          Use as base & next image →
                        </Button>
                        <Button
                          size='sm'
                          colorScheme='brand'
                          variant='ghost'
                          onClick={() => {
                            const next = alignablePackages[alignIndex + 1];
                            if (next) setActivePackageId(next.id);
                          }}
                        >
                          Next image →
                        </Button>
                      </HStack>
                    </>
                  ) : (
                    <Text fontSize='sm' color='gray.500'>Import at least two ready packages to align.</Text>
                  )}
                </Stack>
              </CardBody>
            </Card>
          ) : null}
          {step === 'referenceRegion' ? (
            <Card border='1px solid' borderColor='gray.200' borderRadius='2xl' boxShadow='sm' bg='white'>
              <CardBody p={{ base: 4, xl: 5 }}>
                <Stack spacing={4}>
                  <Stack spacing={2}>
                    <Text fontSize='lg' fontWeight='semibold'>Selection mode</Text>
                    <RadioGroup
                      value={regionMode}
                      onChange={(value) => setRegionMode(value === 'perImage' ? 'perImage' : 'project')}
                      data-testid='batch-region-mode'
                    >
                      <Stack spacing={3}>
                        <Radio value='project' alignItems='flex-start'>
                          <Stack spacing={0}>
                            <Text>Project one region — draw on the reference, apply it to every image</Text>
                            <Text fontSize='xs' color='gray.500'>
                              Fastest when all sections cover the same tissue. Per-image tweaks stay available
                              in step 4.
                            </Text>
                          </Stack>
                        </Radio>
                        <Radio value='perImage' alignItems='flex-start'>
                          <Stack spacing={0}>
                            <Text>Annotate each image — confirm the reference, then draw on every image in turn</Text>
                            <Text fontSize='xs' color='gray.500'>
                              The confirmed reference outline stays on screen as a dashed guide while you outline
                              each package you aligned in step 2.
                            </Text>
                          </Stack>
                        </Radio>
                      </Stack>
                    </RadioGroup>
                  </Stack>
                  <Divider />
                  {regionMode === 'project' ? (
                    <>
                      <Stack spacing={2}>
                        <Stack spacing={0}>
                          <Text fontSize='sm' fontWeight='semibold'>Image to draw on</Text>
                          <Text fontSize='xs' color='gray.500'>
                            The region is shared, so it does not matter which image it is traced on — pick the
                            one whose tissue is easiest to follow. Every sample is shown already aligned to the
                            reference frame; only the reference itself is drawn in its own frame.
                          </Text>
                        </Stack>
                        <PackageStrip
                          packages={readyPackages(packages)}
                          referencePackageId={referencePackageId}
                          activePackageId={projectDrawPackage?.id ?? null}
                          testIdPrefix='batch-project-draw'
                          onSelect={setProjectDrawPackageId}
                          onSetReference={changeReference}
                          onReorder={movePackage}
                          describe={(entry) => (
                            entry.id === referencePackageId
                              ? 'reference'
                              : `${hasCustomRegions(customRegions, entry.id) ? 'drawn' : 'projected'} · ${selectionByPackage[entry.id]?.selectedBarcodes.length ?? 0}`
                          )}
                        />
                      </Stack>
                      {projectDrawUsesReferenceFrame && projectDrawPackage ? (
                        <BatchRegionStage
                          title={`Draw the shared region on ${projectDrawPackage.name}`}
                          description='Shown already rotated and scaled onto the reference, so the dashed reference outline lines up directly. The stroke joins the shared region and lands on every image.'
                          imageUrl={projectDrawPackage.previewUrl}
                          imageSize={projectDrawPackage.fullresSize}
                          frame={projectDrawAlignedFrame}
                          viewBounds={projectDrawViewBounds}
                          viewZoom={walkthroughView.zoom}
                          viewPan={walkthroughView.pan}
                          onViewZoomChange={(zoom) => setWalkthroughView((previous) => ({ ...previous, zoom }))}
                          onViewPanChange={(pan) => setWalkthroughView((previous) => ({ ...previous, pan }))}
                          regions={projectDrawDisplayRegions}
                          overlayRegions={referenceWorldRegions}
                          overlayLabel='Reference outline'
                          tool={regionTool}
                          onToolChange={setRegionTool}
                          activeColorId={activeColorId}
                          onActiveColorChange={setActiveColorId}
                          colors={regionColors}
                          onAddColor={addRegionColor}
                          onClearColors={clearRegionColors}
                          onRenameColor={renameRegionColor}
                          spots={projectDrawPackage.spots}
                          selectedBarcodeSet={
                            selectionByPackage[projectDrawPackage.id]?.selectedBarcodeSet ?? null
                          }
                          spotDiameterFullres={projectDrawPackage.spotDiameterFullres}
                          anchorMode={selection.anchorMode}
                          onCommitStroke={(points, tool, colorId) => commitSharedStroke(points, tool, colorId)}
                          onUndoRegion={undoRegionEdit}
                          canUndo={canUndoRegions}
                          onClearRegions={clearSharedRegions}
                          testIdPrefix='batch-project-draw-region'
                        />
                      ) : (
                        renderReferenceStage(
                          'Freehand-draw the tissue area to keep. This region is projected onto every other package in the next step.',
                        )
                      )}
                      {referencePackage ? (
                        <HStack spacing={3} wrap='wrap'>
                          <Badge colorScheme='green' borderRadius='full'>
                            {selectionByPackage[referencePackage.id]?.selectedBarcodes.length ?? 0} barcodes inside the region
                          </Badge>
                          <Badge colorScheme='gray' borderRadius='full'>
                            {referencePackage.spots?.length ?? 0} barcodes in the package
                          </Badge>
                        </HStack>
                      ) : null}
                    </>
                  ) : null}
                  {regionMode === 'perImage' && !referenceConfirmed ? (
                    <>
                      {renderReferenceStage(
                        'Draw the reference region, then confirm it. The confirmed outline becomes the guide for every other image.',
                      )}
                      <HStack spacing={3} wrap='wrap'>
                        <Button
                          colorScheme='brand'
                          isDisabled={referenceRegions.length === 0}
                          data-testid='batch-confirm-reference'
                          onClick={() => {
                            setReferenceConfirmed(true);
                            if (!walkthroughPackageId) {
                              setWalkthroughPackageId(nonReferencePackages[0]?.id ?? null);
                            }
                          }}
                        >
                          Confirm reference region
                        </Button>
                        {referenceRegions.length === 0 ? (
                          <Text fontSize='sm' color='gray.500'>Draw at least one region first.</Text>
                        ) : (
                          <Text fontSize='sm' color='gray.500'>
                            {referenceRegions.length} region(s) ready to confirm.
                          </Text>
                        )}
                      </HStack>
                    </>
                  ) : null}
                  {regionMode === 'perImage' && referenceConfirmed ? (
                    <Stack spacing={4}>
                      <Flex justify='space-between' align={{ base: 'flex-start', md: 'center' }} gap={3} wrap='wrap'>
                        <Stack spacing={1}>
                          <Text fontSize='lg' fontWeight='semibold'>Annotate each image</Text>
                          <Text fontSize='sm' color='gray.500'>
                            Reference confirmed with {referenceRegions.length} region(s); it stays as the dashed
                            guide while you draw on each package.
                          </Text>
                          <Text fontSize='xs' color='gray.500'>
                            Click a sample to load it into the right panel — the reference included, so it can
                            show up in both panels. Click the ☆ behind a chip to make that image the reference,
                            which also swaps the locked panel on the left.
                          </Text>
                        </Stack>
                        <HStack spacing={3} wrap='wrap'>
                          <StrokeScopeToggle
                            value={walkthroughScope}
                            onChange={setWalkthroughScope}
                            testId='batch-walkthrough-stroke-scope'
                          />
                          <Button variant='ghost' size='sm' onClick={() => setReferenceConfirmed(false)}>
                            Back to reference
                          </Button>
                        </HStack>
                      </Flex>
                      <PackageStrip
                        packages={readyPackages(packages)}
                        referencePackageId={referencePackageId}
                        activePackageId={walkthroughPackage?.id ?? null}
                        testIdPrefix='batch-walkthrough'
                        // The chip loads the image into the right panel — the
                        // reference included, so it can sit in both panels.
                        onSelect={setWalkthroughPackageId}
                        onSetReference={changeReference}
                        onReorder={movePackage}
                        describe={(entry) => {
                          if (entry.id === referencePackageId) return 'reference';
                          const edited = hasCustomRegions(customRegions, entry.id);
                          return `${edited ? 'drawn' : 'projected'} · ${selectionByPackage[entry.id]?.selectedBarcodes.length ?? 0}`;
                        }}
                      />
                      {walkthroughPackage ? (
                        <>
                            <SimpleGrid columns={{ base: 1, xl: 2 }} spacing={4} alignItems='start'>
                              <BatchRegionStage
                                title={`Reference — ${referencePackage?.name ?? ''}`}
                                description='Reference view with its own zoom, so switching the picture on the right never rescales it.'
                                imageUrl={referencePackage?.previewUrl ?? null}
                                imageSize={referencePackage?.fullresSize ?? null}
                                frame={referenceAlignedFrame}
                                viewBounds={referenceViewBounds}
                                regions={referenceWorldRegions}
                                spots={referencePackage?.spots ?? null}
                                selectedBarcodeSet={
                                  referencePackage
                                    ? new Set(selectionByPackage[referencePackage.id]?.selectedBarcodes ?? [])
                                    : null
                                }
                                spotDiameterFullres={referencePackage?.spotDiameterFullres ?? null}
                                anchorMode={selection.anchorMode}
                                viewZoom={referenceView.zoom}
                                viewPan={referenceView.pan}
                                onViewZoomChange={(zoom) => setReferenceView((previous) => ({ ...previous, zoom }))}
                                onViewPanChange={(pan) => setReferenceView((previous) => ({ ...previous, pan }))}
                                interactive={false}
                                toolbarPlacement='inside'
                                testIdPrefix='batch-walkthrough-reference'
                              />
                              <BatchRegionStage
                                title={`${walkthroughPackage.name} — ${walkthroughIndex + 1}/${walkthroughPackages.length}`}
                                description='Shown already rotated and scaled onto the reference, so the dashed reference outline lines up directly. Draw the area that belongs to this image; zoom with the wheel while the pointer is over it.'
                                imageUrl={walkthroughPackage.previewUrl}
                                imageSize={walkthroughPackage.fullresSize}
                                frame={walkthroughAlignedFrame}
                                viewBounds={walkthroughViewBounds}
                                viewZoom={walkthroughView.zoom}
                                viewPan={walkthroughView.pan}
                                onViewZoomChange={(zoom) => setWalkthroughView((previous) => ({ ...previous, zoom }))}
                                onViewPanChange={(pan) => setWalkthroughView((previous) => ({ ...previous, pan }))}
                                regions={walkthroughDisplayRegions}
                                overlayRegions={referenceWorldRegions}
                                overlayLabel='Reference outline'
                                tool={regionTool}
                                onToolChange={setRegionTool}
                                activeColorId={activeColorId}
                                onActiveColorChange={setActiveColorId}
                                colors={regionColors}
                                onAddColor={addRegionColor}
                                onClearColors={clearRegionColors}
                                onRenameColor={renameRegionColor}
                                spots={walkthroughPackage.spots}
                                selectedBarcodeSet={selectionByPackage[walkthroughPackage.id]?.selectedBarcodeSet ?? null}
                                spotDiameterFullres={walkthroughPackage.spotDiameterFullres}
                                anchorMode={selection.anchorMode}
                                onCommitStroke={(points, commitTool, colorId) => (
                                  walkthroughScope === 'all'
                                    ? commitSharedStroke(points, commitTool, colorId)
                                    : commitPackageStroke(walkthroughPackage.id, points, commitTool, colorId)
                                )}
                                onUndoRegion={undoRegionEdit}
                                canUndo={canUndoRegions}
                                onClearRegions={() => (
                                  walkthroughScope === 'all'
                                    ? clearSharedRegions()
                                    : clearPackageRegions(walkthroughPackage.id)
                                )}
                                // Outside the picture, in the free space to the
                                // right of the stage, so the image keeps its width.
                                toolbarPlacement='floating'
                                testIdPrefix='batch-walkthrough-draw'
                              />
                            </SimpleGrid>
                            <Text fontSize='sm' color='gray.500'>
                              {walkthroughIndex + 1} / {walkthroughPackages.length} —{' '}
                              {walkthroughScope === 'all'
                                ? `a stroke on the right panel becomes the shared region, so ${walkthroughPackage.name} and every other image (the reference included) pick it up.`
                                : `strokes stay in ${walkthroughPackage.name}'s own coordinates, so only this image changes.`}
                            </Text>
                          <Flex justify='space-between' align='center' gap={3} wrap='wrap'>
                            <HStack spacing={3} wrap='wrap'>
                              <Button
                                size='sm'
                                variant='outline'
                                isDisabled={walkthroughIndex <= 0}
                                onClick={() => stepWalkthrough(-1)}
                              >
                                ← Previous image
                              </Button>
                              <Button
                                size='sm'
                                variant='outline'
                                isDisabled={walkthroughIndex >= walkthroughPackages.length - 1}
                                onClick={() => stepWalkthrough(1)}
                              >
                                Next image →
                              </Button>
                                <Button
                                  size='sm'
                                  variant='ghost'
                                  isDisabled={!hasCustomRegions(customRegions, walkthroughPackage.id)}
                                  onClick={() => resetPackageRegions(walkthroughPackage.id)}
                                >
                                  Use the projected region
                                </Button>
                            </HStack>
                            <HStack spacing={3} wrap='wrap'>
                              <Badge colorScheme='green' borderRadius='full'>
                                {selectionByPackage[walkthroughPackage.id]?.selectedBarcodes.length ?? 0} barcodes selected
                              </Badge>
                              <Badge colorScheme='gray' borderRadius='full'>
                                {walkthroughPackage.spots?.length ?? 0} barcodes in the package
                              </Badge>
                            </HStack>
                          </Flex>
                        </>
                      ) : (
                        <Text fontSize='sm' color='gray.500'>
                          Import at least two ready packages to annotate them individually.
                        </Text>
                      )}
                    </Stack>
                  ) : null}
                </Stack>
              </CardBody>
            </Card>
          ) : null}
          {step === 'imageRegions' ? (
            <Card border='1px solid' borderColor='gray.200' borderRadius='2xl' boxShadow='sm' bg='white'>
              <CardBody p={{ base: 4, xl: 5 }}>
                <Stack spacing={4}>
                  <Stack spacing={1}>
                    <Text fontSize='lg' fontWeight='semibold'>
                      {regionMode === 'perImage'
                        ? 'Second pass: review every image'
                        : 'Adjust the projected region per image'}
                    </Text>
                    <Text fontSize='sm' color='gray.500'>
                      Every package is shown already rotated and scaled onto the reference, so the dashed
                      reference outline lines up directly.
                      {' '}Strokes stay on the image being edited by default; switch to
                      <strong> All images</strong> to map them onto the whole batch.
                    </Text>
                  </Stack>
                  <PackageStrip
                    packages={readyPackages(packages)}
                    referencePackageId={referencePackageId}
                    activePackageId={activeRegionPackage?.id ?? null}
                    testIdPrefix='batch-regions'
                    onSelect={setActivePackageId}
                    onSetReference={changeReference}
                    onReorder={movePackage}
                    describe={(entry) => {
                      if (entry.id === referencePackageId) return 'reference';
                      const custom = hasCustomRegions(customRegions, entry.id);
                      return `${custom ? 'drawn' : 'projected'} · ${selectionByPackage[entry.id]?.selectedBarcodes.length ?? 0}`;
                    }}
                  />
                  {activeRegionPackage ? (
                    <>
                      <Divider />
                      <HStack spacing={3} wrap='wrap'>
                        <Text fontSize='sm' color='gray.500'>
                          {activeRegionPackage.id === referencePackageId
                            ? 'The reference image is on both panels: the filled outline is the shared region every other image is projected from.'
                            : activeIsCustom
                              ? 'The filled outline is the region kept for this image; the dashed one is the reference outline, kept for comparison.'
                              : 'This image still uses the region projected from the reference.'}
                        </Text>
                        <StrokeScopeToggle
                          value={regionScope}
                          onChange={setRegionScope}
                          testId='batch-regions-stroke-scope'
                        />
                        <HStack spacing={2}>
                          <Text fontSize='xs' color='gray.500'>Compare with the tissue table</Text>
                          <Switch
                            size='sm'
                            colorScheme='brand'
                            isChecked={showTissueComparison}
                            data-testid='batch-regions-compare-tissue'
                            onChange={(event) => setShowTissueComparison(event.target.checked)}
                          />
                        </HStack>
                        {activeIsCustom ? (
                          <Button size='xs' variant='outline' onClick={() => resetPackageRegions(activeRegionPackage.id)}>
                            Reset to reference
                          </Button>
                        ) : null}
                      </HStack>
                      {showTissueComparison ? (
                        <Text fontSize='xs' color='gray.500' data-testid='batch-regions-compare-hint'>
                          The spot overlay now compares column 2 of {activeRegionPackage.name}&apos;s
                          tissue_positions.csv (<code>in_tissue</code>) with the region drawn here — green is
                          kept by both, amber only by the table, blue only by the region.
                        </Text>
                      ) : null}
                      <SimpleGrid columns={{ base: 1, xl: 2 }} spacing={4} alignItems='start'>
                        <BatchRegionStage
                          title={`Reference — ${referencePackage?.name ?? ''}`}
                          description='Reference view with its own zoom, so switching the picture on the right never rescales it.'
                          imageUrl={referencePackage?.previewUrl ?? null}
                          imageSize={referencePackage?.fullresSize ?? null}
                          frame={referenceAlignedFrame}
                          viewBounds={referenceViewBounds}
                          viewZoom={referenceView.zoom}
                          viewPan={referenceView.pan}
                          onViewZoomChange={(zoom) => setReferenceView((previous) => ({ ...previous, zoom }))}
                          onViewPanChange={(pan) => setReferenceView((previous) => ({ ...previous, pan }))}
                          regions={referenceWorldRegions}
                          spots={referencePackage?.spots ?? null}
                          selectedBarcodeSet={
                            referencePackage
                              ? new Set(selectionByPackage[referencePackage.id]?.selectedBarcodes ?? [])
                              : null
                          }
                          spotDiameterFullres={referencePackage?.spotDiameterFullres ?? null}
                          anchorMode={selection.anchorMode}
                          interactive={false}
                          toolbarPlacement='inside'
                          testIdPrefix='batch-regions-reference'
                        />
                        <BatchRegionStage
                          title={activeRegionPackage.name}
                          description='Draw the area that belongs to this image. Colours become different values in the exported table.'
                          imageUrl={activeRegionPackage.previewUrl}
                          imageSize={activeRegionPackage.fullresSize}
                          frame={activeAlignedFrame}
                          viewBounds={regionViewBounds}
                          viewZoom={walkthroughView.zoom}
                          viewPan={walkthroughView.pan}
                          onViewZoomChange={(zoom) => setWalkthroughView((previous) => ({ ...previous, zoom }))}
                          onViewPanChange={(pan) => setWalkthroughView((previous) => ({ ...previous, pan }))}
                          regions={activeDisplayRegions}
                          overlayRegions={referenceWorldRegions}
                          overlayLabel='Reference outline'
                          tool={regionTool}
                          onToolChange={setRegionTool}
                          activeColorId={activeColorId}
                          onActiveColorChange={setActiveColorId}
                          colors={regionColors}
                          onAddColor={addRegionColor}
                          onClearColors={clearRegionColors}
                          onRenameColor={renameRegionColor}
                          spots={activeRegionPackage.spots}
                          selectedBarcodeSet={selectionByPackage[activeRegionPackage.id]?.selectedBarcodeSet ?? null}
                          comparisonBarcodes={
                            showTissueComparison
                              ? previousTissueByPackage[activeRegionPackage.id] ?? null
                              : null
                          }
                          spotDiameterFullres={activeRegionPackage.spotDiameterFullres}
                          anchorMode={selection.anchorMode}
                          onCommitStroke={(points, tool, colorId) => (
                            regionScope === 'all'
                              ? commitSharedStroke(points, tool, colorId)
                              : commitPackageStroke(activeRegionPackage.id, points, tool, colorId)
                          )}
                          onUndoRegion={undoRegionEdit}
                          canUndo={canUndoRegions}
                          onClearRegions={() => (
                            regionScope === 'all'
                              ? clearSharedRegions()
                              : clearPackageRegions(activeRegionPackage.id)
                          )}
                          // Outside the picture, in the free space to the right
                          // of the stage, so the image keeps its width.
                          toolbarPlacement='floating'
                          testIdPrefix='batch-image-region'
                        />
                      </SimpleGrid>
                    </>
                  ) : (
                    <Text fontSize='sm' color='gray.500'>Import packages first.</Text>
                  )}
                </Stack>
              </CardBody>
            </Card>
          ) : null}
          {step === 'review' ? (
            <Stack spacing={4}>
              <Card border='1px solid' borderColor='gray.200' borderRadius='2xl' boxShadow='sm' bg='white'>
                <CardBody p={{ base: 4, xl: 5 }}>
                  <Stack spacing={4}>
                    <Flex justify='space-between' align={{ base: 'flex-start', md: 'center' }} gap={3} wrap='wrap'>
                      <Stack spacing={1}>
                        <Text fontSize='lg' fontWeight='semibold'>Export</Text>
                        <Text fontSize='sm' color='gray.500'>
                          Every package keeps its original files; only tissue_positions.csv gains
                          <code> in_selected</code> (0/1) plus <code>selected_class</code> — 0 when the barcode is
                          not selected, otherwise the number of the colour it was drawn with: 1–5 are the built-in
                          colours, 6 and above are the ones you added — and <code>selected_color</code>, the hex of
                          that colour, so a re-import brings the palette back. The last column,
                          <code> Colours</code>, carries the region name from steps 3/4 — <code>Group 1</code> or
                          whatever you renamed it to — and a re-import restores those names too.
                          transform-matrix.csv is added on top.
                          A barcode counts as selected as soon as its spot square — anchored at the
                          <code> pxl_*</code> top-left corner — touches the drawn region, and the matrix is
                          written in each package&apos;s own frame as 2×3 rows.
                        </Text>
                      </Stack>
                      <HStack spacing={3} wrap='wrap'>
                        <Button
                          colorScheme='brand'
                          isLoading={isExporting}
                          onClick={handleExportAll}
                          data-testid='batch-export-all'
                        >
                          Download {packages.length} package(s)
                        </Button>
                        <Button variant='outline' isLoading={isExporting} onClick={handleExportBundle}>
                          Download as one archive
                        </Button>
                      </HStack>
                    </Flex>
                    <TableContainer>
                      <Table size='sm'>
                        <Thead>
                          <Tr>
                            <Th>Package</Th>
                            <Th isNumeric>Barcodes</Th>
                            <Th isNumeric>in_selected</Th>
                            <Th>
                              transform-matrix.csv → {matrixConvention === 'reference-frame'
                                ? `${referencePackage?.name ?? 'reference'} px`
                                : 'own-size px'}
                            </Th>
                            <Th />
                          </Tr>
                        </Thead>
                        <Tbody>
                          {packages.map((entry) => (
                            <Tr key={entry.id}>
                              <Td>
                                <Stack spacing={0}>
                                  <Text fontWeight='medium'>{entry.name}</Text>
                                  <Text fontSize='xs' color='gray.500'>
                                    {entry.fullresSize
                                      ? `${entry.fullresSize.width}×${entry.fullresSize.height} px`
                                      : '—'}
                                  </Text>
                                </Stack>
                              </Td>
                              <Td isNumeric>{entry.spots?.length.toLocaleString('en-US') ?? '—'}</Td>
                              <Td isNumeric>{selectionByPackage[entry.id]?.selectedBarcodes.length.toLocaleString('en-US') ?? '—'}</Td>
                              <Td>
                                <Text fontFamily='mono' fontSize='xs' whiteSpace='pre-wrap'>
                                  {matrixPreviewByPackage[entry.id] ?? '—'}
                                </Text>
                              </Td>
                              <Td>
                                <Button
                                  size='xs'
                                  variant='outline'
                                  isDisabled={entry.status !== 'ready'}
                                  onClick={() => handleExportOne(entry)}
                                >
                                  Download
                                </Button>
                              </Td>
                            </Tr>
                          ))}
                        </Tbody>
                      </Table>
                    </TableContainer>
                  </Stack>
                </CardBody>
              </Card>
            </Stack>
          ) : null}
        </Stack>
      </Flex>
    </Stack>
  );
}
