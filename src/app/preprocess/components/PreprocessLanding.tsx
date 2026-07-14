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
import type { PreprocessStepId } from '@/types/preprocess';

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
    .map((image) => (image.kind === 'he' ? 'HE' : 'Eosin reference'));

  return labels.length > 0 ? labels.join(' + ') : 'No source images yet';
};

const STEP_LABELS: Record<PreprocessStepId, string> = {
  sourceAssets: 'Source images',
  localization: 'Chip localization',
  heFocus: 'HE focus',
  alignment: 'Image registration',
  cropQc: 'Crop QC',
  chipConfig: 'Chip projection',
  tissueSelection: 'Tissue spot selection',
  exportState: 'Export package',
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
            <Badge colorScheme='brand' variant='subtle'>LOCAL PROCESSING</Badge>
            <Heading size='lg'>Preprocessing Workspace</Heading>
            <Text color='gray.600' maxW='760px'>
              Create, manage, and continue preprocessing projects for image registration, tissue spot selection, and downstream analysis in NATA Insight Bioinformatics Software. All project data is processed and stored locally in your browser.
            </Text>
          </Stack>

          <Flex direction={{ base: 'column', xl: 'row' }} gap={8} align='stretch'>
            <Stack spacing={4} flex='0 0 360px'>
              <Box bg='white' boxShadow='md' borderRadius='lg' p={6} border='1px solid' borderColor='gray.100'>
                <Stack spacing={4} align='stretch'>
                  <Stack spacing={1}>
                    <Heading size='md'>New preprocessing project</Heading>
                    <Text fontSize='sm' color='gray.500'>
                      Create a new preprocessing project for a tissue section.
                    </Text>
                  </Stack>

                  <Stack spacing={2}>
                    <Text fontWeight='semibold' fontSize='sm'>Project name</Text>
                    <Input
                      placeholder='Tumor section A preprocessing'
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
                    Create preprocessing project
                  </Button>
                </Stack>
              </Box>

              <Box bg='white' boxShadow='md' borderRadius='lg' p={6} border='1px solid' borderColor='gray.100'>
                <Stack spacing={4} align='stretch'>
                  <Stack spacing={1}>
                    <Heading size='md'>Import Preprocessing Package</Heading>
                    <Text color='gray.600'>
                      Import a previously exported preprocessing package to continue editing or resume preprocessing.
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
                    Select Package
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
                    Only valid preprocessing packages generated by NATAScope can be imported.
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
                <Heading size='md'>Saved preprocessing projects</Heading>
              </Flex>
              <Text fontSize='sm' color='gray.600' mb={4}>
                Open an existing preprocessing project or continue working on an imported project.
              </Text>

              {projects.length === 0 ? (
                <Box bg='white' border='1px dashed' borderColor='gray.200' p={8} borderRadius='lg' textAlign='center'>
                  <Text color='gray.600'>No preprocessing projects yet. Create one to get started.</Text>
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
                          <Text>Current step: {STEP_LABELS[project.currentStep]}</Text>
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
