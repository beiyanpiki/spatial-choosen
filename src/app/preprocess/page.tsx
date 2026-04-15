'use client';

import { Box, Heading, useToast } from '@chakra-ui/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { PREPROCESS_STORAGE_SCHEMA_VERSION } from '@/lib/preprocess/constants';
import {
  DEFAULT_LOCALIZATION_IMAGE_TRANSFORM,
  normalizeLocalizationSlice,
} from '@/lib/preprocess/localization';
import { migratePreprocessProject } from '@/lib/preprocess/migrations';
import { deserializePreprocessImport } from '@/lib/preprocess/package';
import { buildUpdatedProjectSnapshot } from '@/lib/preprocess/projectUpdates';
import {
  deletePreprocessProject,
  getPreprocessProject,
  readPreprocessProjectSummaries,
  upsertPreprocessProject,
  upsertPreprocessProjectMetadata,
} from '@/lib/preprocess/storage';
import type {
  PreprocessPersistMode,
  PreprocessProjectSummary,
} from '@/lib/preprocess/storage';
import { DEFAULT_TISSUE_PARAMS } from '@/lib/preprocess/tissueThresholds';
import type {
  HeFocusSlice,
  PreprocessProject,
  PreprocessSliceBase,
  PreprocessStepId,
} from '@/types/preprocess';
import { PreprocessLanding } from './components/PreprocessLanding';
import { PreprocessWorkspace } from './components/PreprocessWorkspace';

const collectProjectObjectUrls = (project: PreprocessProject | null) => {
  const urls = new Set<string>();
  if (!project) return urls;

  const addUrl = (url: string | null | undefined) => {
    if (typeof url === 'string' && url.startsWith('blob:')) {
      urls.add(url);
    }
  };

  for (const image of Object.values(project.sourceAssets.images)) {
    addUrl(image?.objectUrl);
    addUrl(image?.thumbnailObjectUrl);
  }

  addUrl(project.heFocus.focusedImageDataUrl);

  const cropAssets = project.cropQc.cropAssets;
  if (cropAssets?.eosin && cropAssets.he) {
    for (const assetSet of [cropAssets.eosin, cropAssets.he]) {
      addUrl(assetSet.fullres.dataUrl);
      addUrl(assetSet.hires.dataUrl);
      addUrl(assetSet.lowres.dataUrl);
    }
  }

  addUrl(project.cropQc.checkerboardPreview?.dataUrl);
  addUrl(project.cropQc.featureMatchesPreview?.dataUrl);
  addUrl(project.cropQc.eosinPreviewDataUrl);
  addUrl(project.cropQc.previewDataUrl);
  addUrl(project.cropQc.checkerboardPreviewDataUrl);
  addUrl(project.cropQc.featureMatchesPreviewDataUrl);

  return urls;
};

const revokeObjectUrls = (urls: Iterable<string>) => {
  for (const url of urls) {
    URL.revokeObjectURL(url);
  }
};

const WORKFLOW_VERSION = 2;
const METADATA_AUTOSAVE_DEBOUNCE_MS = 300;

type PersistStrategy = 'immediate' | 'debounced';

type PersistOptions = {
  mode?: PreprocessPersistMode;
  strategy?: PersistStrategy;
};

const createSlice = (status: PreprocessSliceBase['status']): PreprocessSliceBase => ({
  status,
  isStale: false,
  updatedAt: null,
  error: null,
});

const createDefaultImageTransform = () => ({
  ...DEFAULT_LOCALIZATION_IMAGE_TRANSFORM,
});

const createHeFocusSlice = (status: PreprocessSliceBase['status']): HeFocusSlice => ({
  ...createSlice(status),
  targetImage: 'he',
  chipBounds: null,
  handles: [],
  imageTransform: createDefaultImageTransform(),
  focusedImageDataUrl: null,
});

const normalizeHeFocusSlice = (slice: HeFocusSlice): HeFocusSlice => {
  const normalized = normalizeLocalizationSlice({
    ...slice,
    chipType: null,
    method: null,
    boxColor: 'green',
  });

  return {
    ...slice,
    chipBounds: normalized.chipBounds,
    handles: normalized.handles,
    imageTransform: normalized.imageTransform,
    focusedImageDataUrl: slice.focusedImageDataUrl ?? null,
  };
};

const normalizeProjectForWorkspace = (project: PreprocessProject): PreprocessProject => {
  const migrated = migratePreprocessProject(project);
  return {
    ...migrated,
    localization: normalizeLocalizationSlice(migrated.localization),
    heFocus: normalizeHeFocusSlice(migrated.heFocus),
  };
};

const buildEmptyPreprocessProject = (name: string): PreprocessProject => {
  const now = new Date().toISOString();

  return {
    id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `preprocess-${Date.now()}`,
    name: name.trim(),
    createdAt: now,
    updatedAt: now,
    workflowVersion: WORKFLOW_VERSION,
    storageVersion: PREPROCESS_STORAGE_SCHEMA_VERSION,
    currentStep: 'sourceAssets',
    sourceAssets: {
      ...createSlice('ready'),
      activeImage: 'eosin',
      images: {
        eosin: null,
        he: null,
      },
      oversizedImageWarning: null,
    },
    localization: {
      ...createSlice('idle'),
      targetImage: 'eosin',
      chipType: null,
      method: null,
      chipBounds: null,
      handles: [],
      boxColor: 'green',
      imageTransform: createDefaultImageTransform(),
    },
    heFocus: createHeFocusSlice('idle'),
    alignment: {
      ...createSlice('idle'),
      referenceImage: 'eosin',
      movingImage: 'he',
      movingImageTransform: createDefaultImageTransform(),
      overlayOpacity: 0.5,
      controlPoints: [],
      inlierMask: null,
      affineMatrix: null,
      reprojectionRmse: null,
      inlierRatio: null,
      ransacReprojThreshold: null,
      qualityFlags: {
        minPairs: false,
        inlierRatio: false,
        rmse: false,
        finiteMatrix: false,
        scaleRange: false,
        accepted: false,
      },
      solveAccepted: false,
      failureReason: null,
      transform: null,
      previewDataUrl: null,
    },
    cropQc: {
      ...createSlice('idle'),
      cropRect: null,
      cropWidth: null,
      cropHeight: null,
      paddingRatio: 0.02,
      checkerboardTileSize: 64,
      overlayOpacity: 0.5,
      qcAccepted: false,
      issues: [],
      eosinPreviewDataUrl: null,
      previewDataUrl: null,
      checkerboardPreviewDataUrl: null,
      featureMatchesPreviewDataUrl: null,
      featureMatchesPreview: {
        dataUrl: null,
      },
    },
    chipConfig: {
      ...createSlice('idle'),
      chipType: null,
      rows: null,
      columns: null,
      pitchX: null,
      pitchY: null,
      origin: null,
      rotationDegrees: 0,
      projectedSpots: null,
    },
    tissueSelection: {
      ...createSlice('idle'),
      ...DEFAULT_TISSUE_PARAMS,
      mode: 'matrix',
      thresholdMode: 'raw',
      autoSelectedSpotIds: [],
      matrix: null,
      supportState: 'unsupported',
      unsupportedReason: null,
      paritySummary: null,
      warning: null,
      selectedSpotIds: null,
    },
    exportState: {
      ...createSlice('idle'),
      requestedFormats: [],
      lastExportedAt: null,
      artifacts: [],
    },
  };
};

function PreprocessContent() {
  const toast = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();

  const preprocessId = searchParams.get('preprocess_id');
  const [projectName, setProjectName] = useState('');
  const [projects, setProjects] = useState<PreprocessProjectSummary[]>([]);
  const [project, setProject] = useState<PreprocessProject | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isDeletingId, setIsDeletingId] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [isLoadingProject, setIsLoadingProject] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [autosaveStatus, setAutosaveStatus] = useState<'saving' | 'saved' | 'retrying' | 'error'>('saved');
  const [autosaveDetail, setAutosaveDetail] = useState<string | null>(null);

  const latestSaveAttemptRef = useRef(0);
  const lastSavedProjectRef = useRef<PreprocessProject | null>(null);
  const pendingSnapshotRef = useRef<PreprocessProject | null>(null);
  const pendingPersistModeRef = useRef<PreprocessPersistMode>('metadata');
  const pendingPersistTimerRef = useRef<number | null>(null);
  const activeObjectUrlsRef = useRef<Set<string>>(new Set());
  const savingObjectUrlCountsRef = useRef<Map<string, number>>(new Map());
  const deferredObjectUrlsRef = useRef<Set<string>>(new Set());

  const clearPendingPersistTimer = useCallback(() => {
    if (pendingPersistTimerRef.current !== null) {
      window.clearTimeout(pendingPersistTimerRef.current);
      pendingPersistTimerRef.current = null;
    }
  }, []);

  const isSavingObjectUrl = useCallback((url: string) => {
    return (savingObjectUrlCountsRef.current.get(url) ?? 0) > 0;
  }, []);

  const retainSavingObjectUrls = useCallback((urls: Set<string>) => {
    for (const url of urls) {
      savingObjectUrlCountsRef.current.set(url, (savingObjectUrlCountsRef.current.get(url) ?? 0) + 1);
    }
  }, []);

  const releaseSavingObjectUrls = useCallback((urls: Set<string>) => {
    for (const url of urls) {
      const nextCount = (savingObjectUrlCountsRef.current.get(url) ?? 0) - 1;
      if (nextCount > 0) {
        savingObjectUrlCountsRef.current.set(url, nextCount);
      } else {
        savingObjectUrlCountsRef.current.delete(url);
      }
    }
  }, []);

  const flushDeferredObjectUrls = useCallback((activeUrls?: Set<string>) => {
    const currentActiveUrls = activeUrls ?? activeObjectUrlsRef.current;
    for (const url of Array.from(deferredObjectUrlsRef.current)) {
      if (currentActiveUrls.has(url) || isSavingObjectUrl(url)) {
        continue;
      }

      URL.revokeObjectURL(url);
      deferredObjectUrlsRef.current.delete(url);
    }
  }, [isSavingObjectUrl]);

  const refreshProjects = useCallback(async () => {
    const list = await readPreprocessProjectSummaries();
    setProjects(list);
    return list;
  }, []);

  useEffect(() => {
    if (preprocessId) return;

    let active = true;
    readPreprocessProjectSummaries()
      .then((list) => {
        if (active) setProjects(list);
      })
      .catch((error) => {
        console.error(error);
        if (active) {
          toast({
            title: 'Failed to read preprocess projects',
            description: 'Existing preprocess drafts could not be loaded from this browser.',
            status: 'error',
          });
        }
      });

    return () => {
      active = false;
    };
  }, [preprocessId, toast]);

  useEffect(() => {
    if (!preprocessId) {
      setProject(null);
      setLoadError(null);
      setAutosaveStatus('saved');
      setAutosaveDetail(null);
      lastSavedProjectRef.current = null;
      return;
    }

    let cancelled = false;

    const run = async () => {
      setIsLoadingProject(true);
      setLoadError(null);
      try {
        const storedProject = await getPreprocessProject(preprocessId);
        if (cancelled) {
          revokeObjectUrls(collectProjectObjectUrls(storedProject ?? null));
          return;
        }
        if (!storedProject) {
          setProject(null);
          setLoadError('Preprocess project not found in this browser.');
          return;
        }

        const snapshot = normalizeProjectForWorkspace(storedProject);
        lastSavedProjectRef.current = snapshot;
        setProject(snapshot);
        setAutosaveStatus('saved');
        setAutosaveDetail(`last saved at ${new Date(snapshot.updatedAt).toLocaleTimeString()}`);
      } catch (error) {
        if (cancelled) return;
        console.error(error);
        setProject(null);
        setLoadError('Unable to load preprocess project from storage.');
      } finally {
        if (!cancelled) setIsLoadingProject(false);
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [preprocessId]);

  useEffect(() => {
    const nextUrls = collectProjectObjectUrls(project);
    for (const url of activeObjectUrlsRef.current) {
      if (!nextUrls.has(url)) {
        if (isSavingObjectUrl(url)) {
          deferredObjectUrlsRef.current.add(url);
        } else {
          URL.revokeObjectURL(url);
        }
      }
    }
    activeObjectUrlsRef.current = nextUrls;
    flushDeferredObjectUrls(nextUrls);
  }, [flushDeferredObjectUrls, isSavingObjectUrl, project]);

  useEffect(() => () => {
    for (const url of activeObjectUrlsRef.current) {
      if (isSavingObjectUrl(url)) {
        deferredObjectUrlsRef.current.add(url);
      } else {
        URL.revokeObjectURL(url);
      }
    }
    activeObjectUrlsRef.current = new Set();
    flushDeferredObjectUrls(activeObjectUrlsRef.current);
  }, [flushDeferredObjectUrls, isSavingObjectUrl]);

  const persistProjectSnapshot = useCallback(async (
    snapshot: PreprocessProject,
    mode: PreprocessPersistMode = 'full',
  ) => {
    const saveAttempt = latestSaveAttemptRef.current + 1;
    latestSaveAttemptRef.current = saveAttempt;
    const persistWithProtectedUrls = async (projectToSave: PreprocessProject) => {
      const savingUrls = collectProjectObjectUrls(projectToSave);
      retainSavingObjectUrls(savingUrls);
      try {
        await upsertPreprocessProject(projectToSave, { mode });
      } finally {
        releaseSavingObjectUrls(savingUrls);
        flushDeferredObjectUrls();
      }
    };

    setAutosaveStatus('saving');
    setAutosaveDetail(null);
    try {
      await persistWithProtectedUrls(snapshot);
      lastSavedProjectRef.current = snapshot;
      if (saveAttempt === latestSaveAttemptRef.current) {
        setAutosaveStatus('saved');
        setAutosaveDetail(`last saved at ${new Date().toLocaleTimeString()}`);
      }
    } catch (error) {
      console.error('Failed to autosave preprocess project', error);

      if (lastSavedProjectRef.current) {
        try {
          if (saveAttempt === latestSaveAttemptRef.current) {
            setAutosaveStatus('retrying');
            setAutosaveDetail('retrying with last good snapshot…');
          }
          await persistWithProtectedUrls(lastSavedProjectRef.current);
        } catch (restoreError) {
          console.error('Failed to restore last preprocess snapshot', restoreError);
        }
      }

      if (saveAttempt === latestSaveAttemptRef.current) {
        setAutosaveStatus('error');
        setAutosaveDetail('save failed — last saved snapshot preserved');
        toast({
          title: 'Autosave failed',
          description: 'The last successful preprocess snapshot stays in storage. Retry after fixing the issue.',
          status: 'error',
        });
      }
    }
  }, [flushDeferredObjectUrls, releaseSavingObjectUrls, retainSavingObjectUrls, toast]);

  const flushPendingProjectSnapshot = useCallback((synchronousMetadata = false) => {
    const pendingSnapshot = pendingSnapshotRef.current;
    if (!pendingSnapshot) {
      clearPendingPersistTimer();
      return;
    }

    const mode = pendingPersistModeRef.current;
    pendingSnapshotRef.current = null;
    clearPendingPersistTimer();

    if (synchronousMetadata && mode === 'metadata') {
      latestSaveAttemptRef.current += 1;
      lastSavedProjectRef.current = pendingSnapshot;
      upsertPreprocessProjectMetadata(pendingSnapshot);
      return;
    }

    void persistProjectSnapshot(pendingSnapshot, mode);
  }, [clearPendingPersistTimer, persistProjectSnapshot]);

  const previousPreprocessIdRef = useRef<string | null>(preprocessId);

  useEffect(() => {
    if (previousPreprocessIdRef.current !== preprocessId) {
      flushPendingProjectSnapshot(true);
      previousPreprocessIdRef.current = preprocessId;
    }
  }, [flushPendingProjectSnapshot, preprocessId]);

  const scheduleProjectPersist = useCallback((
    snapshot: PreprocessProject,
    options?: PersistOptions,
  ) => {
    const mode = options?.mode ?? 'full';
    const strategy = options?.strategy ?? 'immediate';

    if (strategy === 'debounced' && mode === 'metadata') {
      pendingSnapshotRef.current = snapshot;
      pendingPersistModeRef.current = mode;
      setAutosaveStatus('saving');
      setAutosaveDetail('saving changes…');
      clearPendingPersistTimer();
      pendingPersistTimerRef.current = window.setTimeout(() => {
        flushPendingProjectSnapshot();
      }, METADATA_AUTOSAVE_DEBOUNCE_MS);
      return;
    }

    pendingSnapshotRef.current = null;
    clearPendingPersistTimer();
    void persistProjectSnapshot(snapshot, mode);
  }, [clearPendingPersistTimer, flushPendingProjectSnapshot, persistProjectSnapshot]);

  useEffect(() => {
    const flushOnExit = () => {
      flushPendingProjectSnapshot(true);
    };
    const flushOnHidden = () => {
      if (document.visibilityState === 'hidden') {
        flushOnExit();
      }
    };

    window.addEventListener('pagehide', flushOnExit);
    window.addEventListener('beforeunload', flushOnExit);
    document.addEventListener('visibilitychange', flushOnHidden);
    return () => {
      window.removeEventListener('pagehide', flushOnExit);
      window.removeEventListener('beforeunload', flushOnExit);
      document.removeEventListener('visibilitychange', flushOnHidden);
      flushPendingProjectSnapshot(true);
    };
  }, [flushPendingProjectSnapshot]);

  const openProject = useCallback((projectId: string) => {
    router.push(`/preprocess?preprocess_id=${encodeURIComponent(projectId)}`);
  }, [router]);

  const handleCreateProject = useCallback(async () => {
    if (projectName.trim().length < 2) return;

    setIsCreating(true);
    try {
      const nextProject = buildEmptyPreprocessProject(projectName);
      await upsertPreprocessProject(nextProject);
      setProjectName('');
      toast({ title: 'Preprocess project created', status: 'success' });
      openProject(nextProject.id);
    } catch (error) {
      console.error(error);
      toast({
        title: 'Failed to create preprocess project',
        description: 'The project could not be saved in this browser.',
        status: 'error',
      });
    } finally {
      setIsCreating(false);
    }
  }, [openProject, projectName, toast]);

  const handleDeleteProject = useCallback(async (projectId: string) => {
    setIsDeletingId(projectId);
    try {
      await deletePreprocessProject(projectId);
      setProjects((previous) => previous.filter((entry) => entry.id !== projectId));
      toast({ title: 'Preprocess project deleted', status: 'info' });
    } catch (error) {
      console.error(error);
      toast({
        title: 'Failed to delete preprocess project',
        description: 'This saved draft could not be removed.',
        status: 'error',
      });
    } finally {
      setIsDeletingId(null);
    }
  }, [toast]);

  const handleImportProject = useCallback(async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;

    setIsImporting(true);
    try {
        const importedProject = normalizeProjectForWorkspace(await deserializePreprocessImport(fileList[0]));
        await upsertPreprocessProject(importedProject);
      toast({ title: 'Preprocess project imported', status: 'success' });
      openProject(importedProject.id);
    } catch (error) {
      console.error(error);
      toast({
        title: 'Import rejected',
        description: error instanceof Error ? error.message : 'The selected preprocess project is invalid.',
        status: 'error',
      });
      await refreshProjects().catch((refreshError) => console.error(refreshError));
    } finally {
      setIsImporting(false);
    }
  }, [openProject, refreshProjects, toast]);

  const updateProject = useCallback((
    updater: (current: PreprocessProject) => PreprocessProject,
    persistOptions?: PersistOptions,
  ) => {
    setProject((current) => {
      if (!current) return current;
      const nextSnapshot = buildUpdatedProjectSnapshot(
        current,
        updater,
        new Date().toISOString(),
      );
      if (nextSnapshot === current) {
        return current;
      }
      scheduleProjectPersist(nextSnapshot, persistOptions);
      return nextSnapshot;
    });
  }, [scheduleProjectPersist]);

  const handleStepChange = useCallback((stepId: PreprocessStepId) => {
    setProject((current) => {
      if (!current) return current;

      const nextSnapshot: PreprocessProject = {
        ...current,
        currentStep: stepId,
        updatedAt: new Date().toISOString(),
      };

      scheduleProjectPersist(nextSnapshot);
      return nextSnapshot;
    });
  }, [scheduleProjectPersist]);

  const handleProjectNameChange = useCallback((value: string) => {
    updateProject((current) => ({
      ...current,
      name: value,
    }));
  }, [updateProject]);

  const handleBackToLanding = useCallback(() => {
    router.push('/preprocess');
  }, [router]);

  if (!preprocessId) {
    return (
      <PreprocessLanding
        isCreating={isCreating}
        isDeletingId={isDeletingId}
        isImporting={isImporting}
        onCreateProject={handleCreateProject}
        onDeleteProject={handleDeleteProject}
        onImportProject={handleImportProject}
        onOpenProject={openProject}
        projectName={projectName}
        projects={projects}
        setProjectName={setProjectName}
      />
    );
  }

  return (
      <PreprocessWorkspace
        autosaveStatus={autosaveStatus}
        autosaveDetail={autosaveDetail}
        isLoading={isLoadingProject}
        loadError={loadError}
        onBackToLanding={handleBackToLanding}
        onProjectMutate={updateProject}
        onProjectNameChange={handleProjectNameChange}
        onStepChange={handleStepChange}
        project={project}
    />
  );
}

export default function PreprocessPage() {
  return (
    <Suspense
      fallback={
        <Box p={10}>
          <Heading size='md'>Loading…</Heading>
        </Box>
      }
    >
      <PreprocessContent />
    </Suspense>
  );
}
