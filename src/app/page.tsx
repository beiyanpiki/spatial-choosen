'use client';

import {
  AlertDialog,
  AlertDialogBody,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogOverlay,
  AspectRatio,
  Badge,
  Box,
  Button,
  Flex,
  Grid,
  Heading,
  IconButton,
  Image,
  Input,
  Select,
  SimpleGrid,
  Stack,
  Text,
  useDisclosure,
} from '@chakra-ui/react';
import { CloseIcon } from '@chakra-ui/icons';
import type { FocusableElement } from '@chakra-ui/utils';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { flushSync } from 'react-dom';
import { decodeBundleFromFile, type Coord } from '@/lib/bundleDecoder';
import { buildSpotMatrix, normalizeChipRect, parseChipType } from '@/lib/chip';
import { deserializeProject } from '@/lib/projectPackage';
import { deleteProject, readProjects, upsertProject } from '@/lib/projects';
import type { ChipRect, ChipType, MatrixDtype, Project, Spot } from '@/types/project';

const dateFormatter = new Intl.DateTimeFormat('en', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
});

type PendingBundle = {
  imageDataUrl: string;
  width: number;
  height: number;
  coord: Coord;
  chipType: ChipType | null;
  chipRect: ChipRect | null;
  spotMatrix?: Spot[][];
  matrixBuffer: ArrayBuffer;
  matrixShape: number[];
  matrixDtype: MatrixDtype;
  bundleName: string;
};

const MAX_RECENT_PROJECTS = 5;

async function measureImage(dataUrl: string): Promise<{ width: number; height: number }> {
  const img = new window.Image();
  img.src = dataUrl;
  await img.decode();
  return { width: img.naturalWidth, height: img.naturalHeight };
}

function HomePage() {
  const router = useRouter();

  const [projectName, setProjectName] = useState('');
  const [pendingBundle, setPendingBundle] = useState<PendingBundle | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isParsingBundle, setIsParsingBundle] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [feedback, setFeedback] = useState<{ text: string; tone: 'success' | 'error' | 'info' } | null>(null);
  const [isPendingTransition, startTransition] = useTransition();
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);
  const [isDeletingId, setIsDeletingId] = useState<string | null>(null);
  const [capacityOverflow, setCapacityOverflow] = useState(0);
  const [storageTargetId, setStorageTargetId] = useState<string>('');
  const [isImporting, setIsImporting] = useState(false);
  const [pendingImportedProject, setPendingImportedProject] = useState<Project | null>(null);

  const capacityDialog = useDisclosure();
  const deleteDialog = useDisclosure();
  const storageDialog = useDisclosure();

  const closeCapacityDialog = () => {
    setCapacityOverflow(0);
    setPendingImportedProject(null);
    capacityDialog.onClose();
  };

  const closeStorageDialog = () => {
    setStorageTargetId('');
    storageDialog.onClose();
  };

  const capacityCancelRef = useRef<HTMLButtonElement>(null);
  const deleteCancelRef = useRef<HTMLButtonElement>(null);
  const storageCancelRef = useRef<HTMLButtonElement>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let active = true;
    readProjects()
      .then((list) => {
        if (active) setProjects(list);
      })
      .catch((error) => {
        console.error(error);
        if (active) setFeedback({ text: 'Failed to read saved projects', tone: 'error' });
      });
    return () => { active = false; };
  }, []);

  const canCreate = projectName.trim().length > 1 && !!pendingBundle;

  const isQuotaError = (error: unknown) => {
    if (!(error instanceof DOMException)) return false;
    return error.name === 'QuotaExceededError'
      || error.name === 'NS_ERROR_DOM_QUOTA_REACHED'
      || error.code === 22;
  };

  const requestDelete = (project: Project) => {
    setProjectToDelete(project);
    deleteDialog.onOpen();
  };

  const deleteProjectById = async (projectId: string, onDone?: () => void) => {
    setIsDeletingId(projectId);
    try {
      await deleteProject(projectId);
      setProjects((prev) => prev.filter((p) => p.id !== projectId));
      if (onDone) onDone();
    } catch (error) {
      console.error(error);
      setFeedback({ text: 'Failed to delete project', tone: 'error' });
    } finally {
      setIsDeletingId(null);
    }
  };

  const confirmDelete = async () => {
    if (!projectToDelete) return;
    await deleteProjectById(projectToDelete.id, () => setFeedback({ text: 'Project removed', tone: 'info' }));
    setProjectToDelete(null);
    deleteDialog.onClose();
  };

  const trimOverflowProjects = async (overflow: number): Promise<Project[]> => {
    if (overflow <= 0) return projects;
    const targets = projects.slice(-overflow);
    for (const project of targets) {
      await deleteProject(project.id);
    }
    let nextList: Project[] = [];
    setProjects((prev) => {
      nextList = prev.filter((p) => !targets.some((t) => t.id === p.id));
      return nextList;
    });
    return nextList;
  };

  const refreshProjects = async () => {
    const list = await readProjects();
    setProjects(list);
    return list;
  };

  const persistImportedProject = async (restored: Project) => {
    try {
      await upsertProject(restored);
      await refreshProjects();
      setFeedback({ text: 'Project imported', tone: 'success' });
      router.push(`/spatial?project_id=${restored.id}`);
    } catch (error) {
      console.error(error);
      setFeedback({ text: 'Failed to import project', tone: 'error' });
    } finally {
      setIsImporting(false);
      setPendingImportedProject(null);
    }
  };

  const handleBundleFile = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const file = fileList[0];
    try {
      // Force flush so the loading spinner paints before heavy parsing kicks in (React 18 batches async handlers).
      flushSync(() => setIsParsingBundle(true));
      // Yield a frame to allow the spinner to render.
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
      const decoded = await decodeBundleFromFile(file);
      const { width, height } = await measureImage(decoded.imageDataUrl);
      const chipType = parseChipType(decoded.coord.chip);
      const chipRect = normalizeChipRect(decoded.coord, width, height);
      const spotMatrix = chipType && chipRect
        ? buildSpotMatrix(chipRect, chipType, width, height)
        : undefined;
      // Copy into a plain ArrayBuffer; typed arrays from npyjs may be backed by SharedArrayBuffer
      // which is not assignable to the Project matrix type nor storable in IndexedDB.
      const matrixBuffer = (() => {
        const out = new ArrayBuffer(decoded.matrix.data.byteLength);
        const view = new Uint8Array(out);
        view.set(new Uint8Array(
          decoded.matrix.data.buffer,
          decoded.matrix.data.byteOffset,
          decoded.matrix.data.byteLength,
        ));
        return out;
      })();

      startTransition(() => {
        setPendingBundle({
          imageDataUrl: decoded.imageDataUrl,
          width,
          height,
          coord: decoded.coord,
          chipType,
          chipRect,
          spotMatrix,
          matrixBuffer,
          matrixShape: decoded.matrix.shape,
          matrixDtype: decoded.matrix.dtype,
          bundleName: file.name,
        });
      });

      if (!projectName.trim()) {
        setProjectName(file.name.replace(/\.[^.]+$/, ''));
      }

      const chipMsg = chipType ? `chip ${chipType}` : 'chip unspecified';
      setFeedback({ text: `Bundle loaded (${width}×${height}, ${chipMsg})`, tone: 'success' });
    } catch (error) {
      console.error(error);
      setFeedback({ text: 'Failed to read bundle. Ensure JSON schema is correct.', tone: 'error' });
      setPendingBundle(null);
    } finally {
      setIsParsingBundle(false);
    }
  };

  const handleImportFile = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const file = fileList[0];
    setIsImporting(true);
    try {
      const restored = await deserializeProject(file);
      const overflow = Math.max(0, projects.length + 1 - MAX_RECENT_PROJECTS);
      if (overflow > 0) {
        setCapacityOverflow(overflow);
        setPendingImportedProject(restored);
        capacityDialog.onOpen();
        setIsImporting(false);
        return;
      }
      await persistImportedProject(restored);
    } catch (error) {
      console.error(error);
      setFeedback({
        text: error instanceof Error ? error.message : 'Failed to import project',
        tone: 'error',
      });
    } finally {
      setIsImporting(false);
    }
  };

  const buildProject = (): Project => {
    if (!pendingBundle) {
      throw new Error('Cannot build a project without a loaded bundle');
    }

    const bundle = pendingBundle;
    const id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `proj-${Date.now()}`;
    return {
      id,
      name: projectName.trim(),
      createdAt: new Date().toISOString(),
      imageData: bundle.imageDataUrl,
      imageWidth: bundle.width,
      imageHeight: bundle.height,
      chipType: bundle.chipType,
      chipRect: bundle.chipRect,
      spotMatrix: bundle.spotMatrix,
      chipFromBundle: Boolean(bundle.chipType),
      matrixShape: bundle.matrixShape,
      matrixDtype: bundle.matrixDtype,
      matrixData: bundle.matrixBuffer,
      regions: [],
    };
  };

  const createProject = async (options?: { trimOverflow?: boolean }) => {
    if (!canCreate || !pendingBundle) return;
    let latestProjects = projects;
    setIsSaving(true);
    try {
      if (options?.trimOverflow) {
        const overflow = Math.max(0, projects.length + 1 - MAX_RECENT_PROJECTS);
        latestProjects = await trimOverflowProjects(overflow);
      }

      const project = buildProject();
      await upsertProject(project);
      setProjects((prev) => [project, ...prev.filter((p) => p.id !== project.id)]);
      router.push(`/spatial?project_id=${project.id}`);
    } catch (error) {
      console.error(error);
      if (isQuotaError(error)) {
        setFeedback({ text: 'Storage full. Delete a recent project to continue.', tone: 'error' });
        const base = latestProjects.length > 0 ? latestProjects : projects;
        const fallbackList = options?.trimOverflow ? base.slice(0, MAX_RECENT_PROJECTS) : base;
        setStorageTargetId(fallbackList[fallbackList.length - 1]?.id ?? '');
        storageDialog.onOpen();
      } else {
        setFeedback({ text: 'Failed to create project', tone: 'error' });
      }
    } finally {
      setIsSaving(false);
    }
  };

  const requestCreate = () => {
    if (!canCreate || !pendingBundle) return;
    const overflow = Math.max(0, projects.length + 1 - MAX_RECENT_PROJECTS);
    if (overflow > 0) {
      setCapacityOverflow(overflow);
      capacityDialog.onOpen();
      return;
    }
    void createProject();
  };

  const confirmCreateWithTrim = async () => {
    if (pendingImportedProject) {
      await trimOverflowProjects(capacityOverflow);
      await persistImportedProject(pendingImportedProject);
      closeCapacityDialog();
      return;
    }
    await createProject({ trimOverflow: true });
    closeCapacityDialog();
  };

  const handleStorageDelete = async () => {
    if (!storageTargetId) return;
    await deleteProjectById(storageTargetId, () => setFeedback({ text: 'Space freed. Try saving again.', tone: 'info' }));
    closeStorageDialog();
  };

  const recent = useMemo(() => projects.slice(0, MAX_RECENT_PROJECTS), [projects]);
  const overflowTargets = useMemo(
    () => (capacityOverflow > 0 ? projects.slice(-capacityOverflow) : []),
    [capacityOverflow, projects],
  );
  const isAtCapacity = projects.length >= MAX_RECENT_PROJECTS;

  return (
    <Flex direction="column" minH="100vh" bg="gray.50">
      <Flex flex="1" align="center" justify="center" px={{ base: 4, md: 10 }} py={{ base: 8, md: 12 }}>
        <Box width="100%" maxW="1200px">
        <Stack spacing={4} mb={6} align="flex-start" textAlign="left">
          <Heading size="lg">Spatial Tissue Region Annotator</Heading>
          <Text color="gray.600">Create a project to load your H&E slide and interactively annotate spatial tissue regions for downstream spatial transcriptomics analysis.</Text>
          <Button variant="outline" colorScheme="brand" onClick={() => router.push('/preprocess')}>
            Open preprocessing workspace
          </Button>
        </Stack>

        <Grid templateColumns={{ base: '1fr', lg: '1.1fr 1fr' }} gap={8} alignItems="stretch">
          <Stack spacing={4}>
            <Stack spacing={4}>
              <Box bg="white" boxShadow="md" borderRadius="lg" p={6} border="1px solid" borderColor="gray.100">
                <Stack spacing={4} align="stretch">
                  <Stack spacing={1}>
                    <Heading size="md">New Project</Heading>
                    <Text fontSize="sm" color={isAtCapacity ? 'red.500' : 'gray.500'}>
                      A maximum of {MAX_RECENT_PROJECTS} recent projects are stored. When full, creating a new project will remove the oldest after confirmation.
                    </Text>
                  </Stack>

                  <Stack spacing={2}>
                    <Text fontWeight="semibold" fontSize="sm">Project Name</Text>
                    <Input
                      placeholder="Tumor slice A"
                      value={projectName}
                      onChange={(e) => setProjectName(e.target.value)}
                    />
                  </Stack>

                  <Stack spacing={3}>
                    <Text fontWeight="semibold" fontSize="sm">Upload bundle (JSON)</Text>
                    <Flex align="center" gap={3} flexWrap="wrap">
                      <Button
                        as="label"
                        cursor="pointer"
                        colorScheme="brand"
                        variant="solid"
                        isLoading={isParsingBundle || isPendingTransition}
                        loadingText="Loading bundle"
                        spinnerPlacement="end"
                      >
                        Select bundle
                        <Input
                          type="file"
                          accept="application/json"
                          display="none"
                          onChange={(e) => handleBundleFile(e.target.files)}
                        />
                      </Button>
                      {pendingBundle && (
                        <Badge colorScheme="green">{pendingBundle.width} × {pendingBundle.height}</Badge>
                      )}
                    </Flex>
                    {pendingBundle && (
                        <Box borderRadius="md" overflow="hidden" border="1px solid" borderColor="gray.100">
                          <AspectRatio ratio={pendingBundle.width / pendingBundle.height}>
                            <Image src={pendingBundle.imageDataUrl} alt="Selected preview" objectFit="cover" />
                          </AspectRatio>
                        </Box>
                    )}
                    {pendingBundle && (
                      <Stack spacing={1} fontSize="sm" color="gray.600">
                        <Text>Bundle: {pendingBundle.bundleName}</Text>
                        <Text>
                          Hull: x={pendingBundle.coord.x}, y={pendingBundle.coord.y}, w={pendingBundle.coord.width}, h={pendingBundle.coord.height}
                        </Text>
                        <Text>
                          Chip: {pendingBundle.chipType ? `${pendingBundle.chipType === '50um' ? '50 μm' : '15 μm'} (locked from bundle)` : 'unspecified'}
                        </Text>
                        <Text>Matrix shape: {pendingBundle.matrixShape.join(' × ')} ({pendingBundle.matrixDtype})</Text>
                      </Stack>
                    )}
                  </Stack>

                  <Button
                    colorScheme="brand"
                    isDisabled={!canCreate}
                    isLoading={isSaving}
                    onClick={requestCreate}
                    alignSelf={{ base: 'stretch', md: 'flex-start' }}
                  >
                    Create & annotate
                  </Button>
                </Stack>
              </Box>

              <Box bg="white" boxShadow="md" borderRadius="lg" p={6} border="1px solid" borderColor="gray.100">
                <Stack spacing={4} align="stretch">
                  <Stack spacing={1}>
                    <Heading size="md">Import Project</Heading>
                    <Text color="gray.600">Open an existing .spatialproj or JSON export saved from this app.</Text>
                  </Stack>
                  <Button
                    variant="outline"
                    size="sm"
                    alignSelf="flex-start"
                    onClick={() => importInputRef.current?.click()}
                    isLoading={isImporting}
                  >
                    Select file to import
                  </Button>
                  <Input
                    ref={importInputRef}
                    type="file"
                    accept=".spatialproj,application/x-spatialproj+json,application/json"
                    display="none"
                    onChange={(e) => {
                      handleImportFile(e.target.files);
                      e.target.value = '';
                    }}
                  />
                  <Text fontSize="sm" color="gray.500">
                    Imports stay on this device and count toward the recent list limit.
                  </Text>
                </Stack>
              </Box>
            </Stack>

            {feedback && (
              <Text fontSize="sm" color={feedback.tone === 'error' ? 'red.500' : feedback.tone === 'success' ? 'green.600' : 'gray.600'}>
                {feedback.text}
              </Text>
            )}
          </Stack>

          <Box
            bg="white"
            boxShadow="md"
            borderRadius="lg"
            p={6}
            border="1px solid"
            borderColor="gray.100"
            alignSelf="start"
          >
            <Flex justify="space-between" align="center" mb={3}>
              <Heading size="md">Recent</Heading>
              <Badge colorScheme="gray">Stored locally</Badge>
            </Flex>
            <Text fontSize="sm" color="gray.600" mb={4}>
              Latest {MAX_RECENT_PROJECTS} projects are kept. Remove an entry to make space for new ones.
            </Text>
            {recent.length === 0 ? (
              <Box bg="white" border="1px dashed" borderColor="gray.200" p={6} borderRadius="lg" textAlign="center">
                <Text color="gray.600">No projects yet. Create one to get started.</Text>
              </Box>
            ) : (
              <SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
                {recent.map((project) => (
                  <Box
                    key={project.id}
                    bg="white"
                    borderRadius="lg"
                    overflow="hidden"
                    border="1px solid"
                    borderColor="gray.100"
                    boxShadow="xs"
                    cursor="pointer"
                    transition="all 0.2s"
                    _hover={{ boxShadow: 'md', translateY: -1 }}
                    position="relative"
                    role="group"
                    onClick={() => router.push(`/spatial?project_id=${project.id}`)}
                  >
                    <IconButton
                      aria-label="Delete recent project"
                      icon={<CloseIcon boxSize={3} />}
                      size="sm"
                      variant="ghost"
                      colorScheme="red"
                      position="absolute"
                      top={2}
                      right={2}
                      isLoading={isDeletingId === project.id}
                      visibility={{ base: 'visible', md: 'hidden' }}
                      opacity={{ base: 1, md: 0 }}
                      bg="whiteAlpha.800"
                      zIndex={2}
                      _hover={{ bg: 'white', opacity: 1 }}
                      _focusVisible={{ visibility: 'visible', opacity: 1 }}
                      transition="visibility 0s linear 0.1s, opacity 0.15s ease"
                      _groupHover={{ visibility: 'visible', opacity: 1, transitionDelay: '0s' }}
                      onClick={(e) => {
                        e.stopPropagation();
                        requestDelete(project);
                      }}
                    />
                    <AspectRatio ratio={(project.imageWidth || 4) / (project.imageHeight || 3)}>
                      <Image src={project.imageData} alt={project.name} objectFit="cover" />
                    </AspectRatio>
                    <Box p={4}>
                      <Heading size="sm" mb={1} noOfLines={1}>{project.name}</Heading>
                      <Text fontSize="sm" color="gray.500">{dateFormatter.format(new Date(project.createdAt))}</Text>
                      <Text fontSize="xs" color="gray.500" mt={1}>ID: {project.id}</Text>
                    </Box>
                  </Box>
                ))}
              </SimpleGrid>
            )}
          </Box>
      </Grid>

      <AlertDialog
        isOpen={capacityDialog.isOpen}
        leastDestructiveRef={capacityCancelRef as React.RefObject<FocusableElement>}
        onClose={closeCapacityDialog}
        isCentered
      >
        <AlertDialogOverlay>
          <AlertDialogContent>
            <AlertDialogHeader fontSize="lg" fontWeight="bold">
              Recent list is full
            </AlertDialogHeader>
            <AlertDialogBody>
              <Text mb={3}>Saving a new project requires removing {capacityOverflow} older project(s).</Text>
              {overflowTargets.length > 0 && (
                <Stack spacing={1} mb={3}>
                  {overflowTargets.map((project) => (
                    <Text key={project.id} fontSize="sm" color="gray.700">• {project.name}</Text>
                  ))}
                </Stack>
              )}
              <Text>Delete the oldest and continue?</Text>
            </AlertDialogBody>
            <AlertDialogFooter>
              <Button ref={capacityCancelRef} onClick={closeCapacityDialog} variant="ghost">
                Cancel
              </Button>
              <Button colorScheme="red" onClick={confirmCreateWithTrim} ml={3} isLoading={isSaving}>
                Delete oldest & create
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogOverlay>
      </AlertDialog>

      <AlertDialog
        isOpen={deleteDialog.isOpen}
        leastDestructiveRef={deleteCancelRef as React.RefObject<FocusableElement>}
        onClose={() => {
          setProjectToDelete(null);
          deleteDialog.onClose();
        }}
        isCentered
      >
        <AlertDialogOverlay>
          <AlertDialogContent>
            <AlertDialogHeader fontSize="lg" fontWeight="bold">Delete project</AlertDialogHeader>
            <AlertDialogBody>
              {projectToDelete ? (
                <Text>
                  Remove &ldquo;{projectToDelete.name}&rdquo; from recent projects?
                </Text>
              ) : (
                <Text>Remove this project from recent projects?</Text>
              )}
            </AlertDialogBody>
            <AlertDialogFooter>
              <Button ref={deleteCancelRef} onClick={deleteDialog.onClose} variant="ghost">
                Cancel
              </Button>
              <Button
                colorScheme="red"
                onClick={confirmDelete}
                ml={3}
                isLoading={isDeletingId === projectToDelete?.id}
              >
                Delete
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogOverlay>
      </AlertDialog>

      <AlertDialog
        isOpen={storageDialog.isOpen}
        leastDestructiveRef={storageCancelRef as React.RefObject<FocusableElement>}
        onClose={closeStorageDialog}
        isCentered
      >
        <AlertDialogOverlay>
          <AlertDialogContent>
            <AlertDialogHeader fontSize="lg" fontWeight="bold">Storage is full</AlertDialogHeader>
            <AlertDialogBody>
              <Text mb={3}>IndexedDB quota has been reached. Delete a recent project to free space, then retry saving.</Text>
              <Select
                value={storageTargetId}
                onChange={(e) => setStorageTargetId(e.target.value)}
                placeholder="Select a project to delete"
              >
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>{project.name}</option>
                ))}
              </Select>
            </AlertDialogBody>
            <AlertDialogFooter>
              <Button ref={storageCancelRef} onClick={closeStorageDialog} variant="ghost">
                Cancel
              </Button>
              <Button
                colorScheme="red"
                onClick={handleStorageDelete}
                ml={3}
                isDisabled={!storageTargetId}
                isLoading={isDeletingId === storageTargetId}
              >
                Delete selected
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogOverlay>
      </AlertDialog>
        </Box>
      </Flex>
      <Text textAlign="center" fontSize="sm" color="gray.600" py={1} mt="auto">
        @M20 Genomics
      </Text>
    </Flex>
  );
}

export default dynamic(() => Promise.resolve(HomePage), { ssr: false });
