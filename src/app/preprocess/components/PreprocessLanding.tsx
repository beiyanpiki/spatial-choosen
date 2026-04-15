'use client';

import { CloseIcon } from '@chakra-ui/icons';
import {
  Badge,
  Box,
  Button,
  Flex,
  Heading,
  IconButton,
  Input,
  SimpleGrid,
  Stack,
  Text,
} from '@chakra-ui/react';
import { useRef } from 'react';
import type { PreprocessProjectSummary } from '@/lib/preprocess/storage';

const dateFormatter = new Intl.DateTimeFormat('en', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
});

type PreprocessLandingProps = {
  isCreating: boolean;
  isDeletingId: string | null;
  isImporting: boolean;
  onCreateProject: () => void;
  onDeleteProject: (projectId: string) => void;
  onImportProject: (fileList: FileList | null) => void;
  onOpenProject: (projectId: string) => void;
  projectName: string;
  projects: PreprocessProjectSummary[];
  setProjectName: (value: string) => void;
};

const describeSources = (project: PreprocessProjectSummary) => {
  const labels = [project.sourceAssets.images.eosin, project.sourceAssets.images.he]
    .filter((image): image is NonNullable<typeof image> => Boolean(image))
    .map((image) => image.kind.toUpperCase());

  return labels.length > 0 ? labels.join(' + ') : 'No source images yet';
};

export function PreprocessLanding({
  isCreating,
  isDeletingId,
  isImporting,
  onCreateProject,
  onDeleteProject,
  onImportProject,
  onOpenProject,
  projectName,
  projects,
  setProjectName,
}: PreprocessLandingProps) {
  const importInputRef = useRef<HTMLInputElement | null>(null);

  return (
    <Flex direction='column' minH='100vh' bg='gray.50' data-testid='preprocess-landing-shell'>
      <Flex flex='1' align='center' justify='center' px={{ base: 4, md: 10 }} py={{ base: 8, md: 12 }}>
        <Box width='100%' maxW='1200px'>
          <Stack spacing={4} mb={6} align='flex-start' textAlign='left'>
            <Badge colorScheme='brand' variant='subtle'>Local only</Badge>
            <Heading size='lg'>Preprocess Workspace</Heading>
            <Text color='gray.600' maxW='760px'>
              Create a preprocess project to organize source images, move through the step-by-step shell,
              and keep every saved snapshot in this browser only.
            </Text>
          </Stack>

          <Flex direction={{ base: 'column', xl: 'row' }} gap={8} align='stretch'>
            <Stack spacing={4} flex='0 0 360px'>
              <Box bg='white' boxShadow='md' borderRadius='lg' p={6} border='1px solid' borderColor='gray.100'>
                <Stack spacing={4} align='stretch'>
                  <Stack spacing={1}>
                    <Heading size='md'>New preprocess project</Heading>
                    <Text fontSize='sm' color='gray.500'>
                      Start with an empty shell. Source image upload arrives inside the workflow.
                    </Text>
                  </Stack>

                  <Stack spacing={2}>
                    <Text fontWeight='semibold' fontSize='sm'>Project name</Text>
                    <Input
                      placeholder='Tumor preprocess set A'
                      value={projectName}
                      onChange={(event) => setProjectName(event.target.value)}
                    />
                  </Stack>

                  <Button
                    colorScheme='brand'
                    alignSelf={{ base: 'stretch', md: 'flex-start' }}
                    onClick={onCreateProject}
                    isDisabled={projectName.trim().length < 2}
                    isLoading={isCreating}
                    data-testid='preprocess-create-project'
                  >
                    Create preprocess project
                  </Button>
                </Stack>
              </Box>

              <Box bg='white' boxShadow='md' borderRadius='lg' p={6} border='1px solid' borderColor='gray.100'>
                <Stack spacing={4} align='stretch'>
                  <Stack spacing={1}>
                    <Heading size='md'>Import preprocess project</Heading>
                    <Text color='gray.600'>
                      Restore a saved preprocess package without mixing it into annotation projects.
                    </Text>
                  </Stack>
                  <Button
                    variant='outline'
                    size='sm'
                    alignSelf='flex-start'
                    onClick={() => importInputRef.current?.click()}
                    isLoading={isImporting}
                    data-testid='preprocess-import-project'
                  >
                    Select file to import
                  </Button>
                    <Input
                      ref={importInputRef}
                      type='file'
                      accept='.json,.zip,application/x-spatial-preprocess+json,application/json,application/zip'
                      display='none'
                    onChange={(event) => {
                      onImportProject(event.target.files);
                      event.target.value = '';
                    }}
                  />
                  <Text fontSize='sm' color='gray.500'>
                    Malformed imports are rejected before anything in local storage is replaced.
                  </Text>
                </Stack>
              </Box>
            </Stack>

            <Box
              flex='1'
              bg='white'
              boxShadow='md'
              borderRadius='lg'
              p={6}
              border='1px solid'
              borderColor='gray.100'
              data-testid='preprocess-project-list'
            >
              <Flex justify='space-between' align='center' mb={3} gap={4} wrap='wrap'>
                <Heading size='md'>Saved preprocess projects</Heading>
                <Badge colorScheme='gray'>Stored locally</Badge>
              </Flex>
              <Text fontSize='sm' color='gray.600' mb={4}>
                Open an existing shell, delete old drafts, or continue from an imported package.
              </Text>

              {projects.length === 0 ? (
                <Box bg='white' border='1px dashed' borderColor='gray.200' p={8} borderRadius='lg' textAlign='center'>
                  <Text color='gray.600'>No preprocess projects yet. Create one to get started.</Text>
                </Box>
              ) : (
                <SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
                  {projects.map((project) => (
                    <Box
                      key={project.id}
                      borderRadius='lg'
                      border='1px solid'
                      borderColor='gray.100'
                      boxShadow='xs'
                      p={5}
                      position='relative'
                    >
                      <IconButton
                        aria-label={`Delete ${project.name}`}
                        icon={<CloseIcon boxSize={3} />}
                        size='sm'
                        variant='ghost'
                        colorScheme='red'
                        position='absolute'
                        top={2}
                        right={2}
                        isLoading={isDeletingId === project.id}
                        onClick={() => onDeleteProject(project.id)}
                      />
                      <Stack spacing={3} pr={8}>
                        <Stack spacing={1}>
                          <Heading size='sm'>{project.name}</Heading>
                          <Text fontSize='sm' color='gray.500'>
                            Updated {dateFormatter.format(new Date(project.updatedAt || project.createdAt))}
                          </Text>
                        </Stack>

                        <Stack spacing={1} fontSize='sm' color='gray.600'>
                          <Text>Current step: {project.currentStep}</Text>
                          <Text>{describeSources(project)}</Text>
                          <Text>ID: {project.id}</Text>
                        </Stack>

                        <Button size='sm' colorScheme='brand' alignSelf='flex-start' onClick={() => onOpenProject(project.id)}>
                          Open workspace
                        </Button>
                      </Stack>
                    </Box>
                  ))}
                </SimpleGrid>
              )}
            </Box>
          </Flex>
        </Box>
      </Flex>

      <Text textAlign='center' fontSize='sm' color='gray.600' py={1} mt='auto'>
        @M20 Genomics
      </Text>
    </Flex>
  );
}
