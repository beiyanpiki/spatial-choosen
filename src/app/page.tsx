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
import { useEffect, useMemo, useState } from 'react';
import { readProjects, upsertProject } from '@/lib/projects';
import { Project } from '@/types/project';

const dateFormatter = new Intl.DateTimeFormat('en', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
});

type PendingImage = {
  dataUrl: string;
  width: number;
  height: number;
};

async function readImageFile(file: File): Promise<PendingImage> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const img = new Image();
  img.src = dataUrl;
  await img.decode();

  return { dataUrl, width: img.naturalWidth, height: img.naturalHeight };
}

export default function HomePage() {
  const router = useRouter();

  const [projectName, setProjectName] = useState('');
  const [pendingImage, setPendingImage] = useState<PendingImage | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [feedback, setFeedback] = useState<{ text: string; tone: 'success' | 'error' | 'info' } | null>(null);

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

  const canCreate = projectName.trim().length > 1 && !!pendingImage;

  const handleFile = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const file = fileList[0];
    try {
      const img = await readImageFile(file);
      setPendingImage(img);
      setFeedback({ text: `Loaded ${file.name} (${img.width}×${img.height})`, tone: 'success' });
    } catch (error) {
      console.error(error);
      setFeedback({ text: 'Unable to read image', tone: 'error' });
    }
  };

  const createProject = async () => {
    if (!canCreate || !pendingImage) return;
    setIsSaving(true);
    try {
      const id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `proj-${Date.now()}`;
      const project: Project = {
        id,
        name: projectName.trim(),
        createdAt: new Date().toISOString(),
        imageData: pendingImage.dataUrl,
        imageWidth: pendingImage.width,
        imageHeight: pendingImage.height,
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
            <Text color="gray.600">Give it a name, choose a slide image (kept in your browser), and we will generate an ID.</Text>

            <Stack spacing={2}>
              <Text fontWeight="semibold" fontSize="sm">Project Name</Text>
              <Input
                placeholder="Tumor slice A"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
              />
            </Stack>

            <Stack spacing={3}>
              <Text fontWeight="semibold" fontSize="sm">Slide Image</Text>
              <Flex align="center" gap={3} flexWrap="wrap">
                <Button as="label" cursor="pointer" colorScheme="brand" variant="solid">
                  Select image
                  <Input
                    type="file"
                    accept="image/*"
                    display="none"
                    onChange={(e) => handleFile(e.target.files)}
                  />
                </Button>
                {pendingImage && (
                  <Badge colorScheme="green">{pendingImage.width} × {pendingImage.height}</Badge>
                )}
              </Flex>
              {pendingImage && (
                <Box borderRadius="md" overflow="hidden" border="1px solid" borderColor="gray.100">
                  <AspectRatio ratio={pendingImage.width / pendingImage.height}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={pendingImage.dataUrl} alt="Selected preview" style={{ objectFit: 'cover' }} />
                  </AspectRatio>
                </Box>
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
