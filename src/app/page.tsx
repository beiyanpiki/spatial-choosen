'use client';

import {
  AspectRatio,
  Badge,
  Box,
  Button,
  Flex,
  Grid,
  Heading,
  Input,
  SimpleGrid,
  Stack,
  Text,
} from '@chakra-ui/react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, useTransition } from 'react';
import { readProjects, upsertProject } from '@/lib/projects';
import { decodeBundleFromFile, Coord } from '@/lib/bundleDecoder';
import { buildSpotMatrix, normalizeChipRect, parseChipType } from '@/lib/chip';
import { ChipRect, ChipType, MatrixDtype, Project, Spot } from '@/types/project';

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

async function measureImage(dataUrl: string): Promise<{ width: number; height: number }> {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  return { width: img.naturalWidth, height: img.naturalHeight };
}

export default function HomePage() {
  const router = useRouter();

  const [projectName, setProjectName] = useState('');
  const [pendingBundle, setPendingBundle] = useState<PendingBundle | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isParsingBundle, setIsParsingBundle] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [feedback, setFeedback] = useState<{ text: string; tone: 'success' | 'error' | 'info' } | null>(null);
  const [isPendingTransition, startTransition] = useTransition();

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

  const handleBundleFile = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const file = fileList[0];
    try {
      setIsParsingBundle(true);
      // Yield to paint the loading state before heavy parse.
      await new Promise((resolve) => setTimeout(resolve, 0));
      const decoded = await decodeBundleFromFile(file);
      const { width, height } = await measureImage(decoded.imageDataUrl);
      const chipType = parseChipType(decoded.coord.chip);
      const chipRect = normalizeChipRect(decoded.coord, width, height);
      const spotMatrix = chipType && chipRect
        ? buildSpotMatrix(chipRect, chipType, width, height)
        : undefined;
      const matrixBuffer = decoded.matrix.data.buffer.slice(
        decoded.matrix.data.byteOffset,
        decoded.matrix.data.byteOffset + decoded.matrix.data.byteLength,
      );

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

  const createProject = async () => {
    if (!canCreate || !pendingBundle) return;
    setIsSaving(true);
    try {
      const id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `proj-${Date.now()}`;
      const project: Project = {
        id,
        name: projectName.trim(),
        createdAt: new Date().toISOString(),
        imageData: pendingBundle.imageDataUrl,
        imageWidth: pendingBundle.width,
        imageHeight: pendingBundle.height,
        chipType: pendingBundle.chipType,
        chipRect: pendingBundle.chipRect,
        spotMatrix: pendingBundle.spotMatrix,
        chipFromBundle: Boolean(pendingBundle.chipType),
        matrixShape: pendingBundle.matrixShape,
        matrixDtype: pendingBundle.matrixDtype,
        matrixData: pendingBundle.matrixBuffer,
        regions: [],
      };
      await upsertProject(project);
      setProjects((prev) => [project, ...prev.filter((p) => p.id !== project.id)]);
      router.push(`/spatial?project_id=${project.id}`);
    } catch (error) {
      console.error(error);
      setFeedback({ text: 'Failed to create project', tone: 'error' });
    } finally {
      setIsSaving(false);
    }
  };

  const recent = useMemo(() => projects.slice(0, 8), [projects]);

  return (
    <Box px={{ base: 4, md: 10 }} py={{ base: 8, md: 12 }} maxW="1200px" mx="auto">
      <Stack spacing={6} mb={4}>
        <Heading size="lg">Spatial Projects</Heading>
        <Text color="gray.600">Create a project, store the slide locally, and jump into region annotation.</Text>
      </Stack>

      <Grid templateColumns={{ base: '1fr', lg: '1.1fr 1fr' }} gap={8} alignItems="start">
        <Box bg="white" boxShadow="sm" borderRadius="lg" p={6} border="1px solid" borderColor="gray.100">
          <Stack spacing={4}>
            <Heading size="md">New Project</Heading>
            <Text color="gray.600">Provide a bundle (image + hull + matrix), keep everything local, and jump into annotation.</Text>

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
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={pendingBundle.imageDataUrl} alt="Selected preview" style={{ objectFit: 'cover' }} />
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
              onClick={createProject}
              alignSelf={{ base: 'stretch', md: 'flex-start' }}
            >
              Create & annotate
            </Button>

            {feedback && (
              <Text fontSize="sm" color={feedback.tone === 'error' ? 'red.500' : feedback.tone === 'success' ? 'green.600' : 'gray.600'}>
                {feedback.text}
              </Text>
            )}
          </Stack>
        </Box>

        <Box>
          <Flex justify="space-between" align="center" mb={3}>
            <Heading size="md">Recent</Heading>
            <Badge colorScheme="gray">Stored locally</Badge>
          </Flex>
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
                  onClick={() => router.push(`/spatial?project_id=${project.id}`)}
                >
                  <AspectRatio ratio={(project.imageWidth || 4) / (project.imageHeight || 3)}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={project.imageData} alt={project.name} style={{ objectFit: 'cover' }} />
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
    </Box>
  );
}
