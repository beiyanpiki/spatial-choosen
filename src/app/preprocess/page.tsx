'use client';

import { Box, Heading, useToast } from '@chakra-ui/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import {
  DEFAULT_LOCALIZATION_IMAGE_TRANSFORM,
  normalizeLocalizationSlice,
} from '@/lib/preprocess/localization';
import { deserializePreprocessImport } from '@/lib/preprocess/package';
import { PREPROCESS_STORAGE_SCHEMA_VERSION } from '@/lib/preprocess/constants';
import { migratePreprocessProject } from '@/lib/preprocess/migrations';
import {
  deletePreprocessProject,
  getPreprocessProject,
  readPreprocessProjects,
  upsertPreprocessProject,
} from '@/lib/preprocess/storage';
import type {
  PreprocessProject,
  PreprocessSliceBase,
  PreprocessStepId,
} from '@/types/preprocess';
import { PreprocessLanding } from './components/PreprocessLanding';
import { PreprocessWorkspace } from './components/PreprocessWorkspace';

const collectProjectObjectUrls = (project: PreprocessProject | null) => {
  const urls = new Set<string>();
  if (!project) return urls;

  for (const image of Object.values(project.sourceAssets.images)) {
    if (image?.objectUrl) urls.add(image.objectUrl);
    if (image?.thumbnailObjectUrl) urls.add(image.thumbnailObjectUrl);
  }

  return urls;
};

const revokeObjectUrls = (urls: Iterable<string>) => {
  for (const url of urls) {
    URL.revokeObjectURL(url);
  }
};

const WORKFLOW_VERSION = 1;

const createSlice = (status: PreprocessSliceBase['status']): PreprocessSliceBase => ({
  status,
  isStale: false,
  updatedAt: null,
  error: null,
});

const cloneProject = (project: PreprocessProject): PreprocessProject => {
  if (typeof structuredClone === 'function') {
    return structuredClone(project);
  }

  return JSON.parse(JSON.stringify(project)) as PreprocessProject;
};

const normalizeProjectForWorkspace = (project: PreprocessProject): PreprocessProject => {
  const migrated = migratePreprocessProject(project);
  return {
    ...migrated,
    localization: normalizeLocalizationSlice(migrated.localization),
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
      imageTransform: {
        rotationDegrees: 0,
        flipHorizontal: false,
        flipVertical: false,
        scale: 1,
      },
    },
    alignment: {
      ...createSlice('idle'),
      referenceImage: 'eosin',
      movingImage: 'he',
      movingImageTransform: DEFAULT_LOCALIZATION_IMAGE_TRANSFORM,
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
      mode: 'polygon',
      thresholdMode: 'light',
      activationThreshold: 140,
      blockThreshold: 180,
      dbscanEps: 0.03,
      dbscanMinSamples: 3,
      minConnectedSpotCount: 8,
      autoSelectedSpotIds: [],
      forcedInSpotIds: [],
      forcedOutSpotIds: [],
      overrideNotice: null,
      paritySummary: null,
      warning: null,
      regions: [],
      selectedRegionId: null,
      previewDataUrl: null,
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
  const [projects, setProjects] = useState<PreprocessProject[]>([]);
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
  const activeObjectUrlsRef = useRef<Set<string>>(new Set());

  const refreshProjects = useCallback(async () => {
    const list = await readPreprocessProjects();
    setProjects(list);
    return list;
  }, []);

  useEffect(() => {
    if (preprocessId) return;

    let active = true;
    readPreprocessProjects()
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
        if (cancelled) return;
        if (!storedProject) {
          setProject(null);
          setLoadError('Preprocess project not found in this browser.');
          return;
        }

        const snapshot = cloneProject(normalizeProjectForWorkspace(storedProject));
        lastSavedProjectRef.current = cloneProject(snapshot);
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
        URL.revokeObjectURL(url);
      }
    }
    activeObjectUrlsRef.current = nextUrls;
  }, [project]);

  useEffect(() => () => {
    revokeObjectUrls(activeObjectUrlsRef.current);
    activeObjectUrlsRef.current = new Set();
  }, []);

  const persistProjectSnapshot = useCallback(async (snapshot: PreprocessProject) => {
    const saveAttempt = latestSaveAttemptRef.current + 1;
    latestSaveAttemptRef.current = saveAttempt;
    setAutosaveStatus('saving');
    setAutosaveDetail(null);
    try {
      await upsertPreprocessProject(snapshot);
      lastSavedProjectRef.current = cloneProject(snapshot);
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
          await upsertPreprocessProject(cloneProject(lastSavedProjectRef.current));
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
  }, [toast]);

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
  ) => {
    setProject((current) => {
      if (!current) return current;
      const nextSnapshot: PreprocessProject = {
        ...updater(current),
        updatedAt: new Date().toISOString(),
      };
      void persistProjectSnapshot(cloneProject(nextSnapshot));
      return nextSnapshot;
    });
  }, [persistProjectSnapshot]);

  const handleStepChange = useCallback((stepId: PreprocessStepId) => {
    if (!project) return;

    const nextSnapshot: PreprocessProject = {
      ...project,
      currentStep: stepId,
      updatedAt: new Date().toISOString(),
    };

    setProject(nextSnapshot);
    void persistProjectSnapshot(cloneProject(nextSnapshot));
  }, [persistProjectSnapshot, project]);

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
