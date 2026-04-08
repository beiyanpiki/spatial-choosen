import { Badge, Box, Button, Heading, Stack, Text } from '@chakra-ui/react';
import type { PreprocessProject, PreprocessStepId } from '@/types/preprocess';

type StepItem = {
  id: PreprocessStepId;
  label: string;
  description: string;
  testId?: string;
};

export const PREPROCESS_STEP_ITEMS: readonly StepItem[] = [
  {
    id: 'sourceAssets',
    label: 'Source',
    description: 'Upload Eosin + H&E inputs',
    testId: 'preprocess-step-source-assets',
  },
  {
    id: 'localization',
    label: 'Localize',
    description: 'Place the chip footprint',
    testId: 'preprocess-step-localize',
  },
  {
    id: 'heFocus',
    label: 'HE Focus',
    description: 'Focus the working H&E area',
    testId: 'preprocess-step-he-focus',
  },
  {
    id: 'alignment',
    label: 'Align',
    description: 'Register both source images',
    testId: 'preprocess-step-align',
  },
  {
    id: 'cropQc',
    label: 'Crop',
    description: 'Inspect crop + QC bounds',
    testId: 'preprocess-step-crop',
  },
  {
    id: 'chipConfig',
    label: 'Chip',
    description: 'Preview spot grid settings',
    testId: 'preprocess-step-chip',
  },
  {
    id: 'tissueSelection',
    label: 'Tissue',
    description: 'Select capture regions',
    testId: 'preprocess-step-tissue',
  },
  {
    id: 'exportState',
    label: 'Export',
    description: 'Package outputs for handoff',
    testId: 'preprocess-step-export',
  },
] as const;

const statusToneByStep: Record<string, string> = {
  idle: 'gray',
  ready: 'blue',
  processing: 'orange',
  complete: 'green',
  stale: 'yellow',
  error: 'red',
};

const stepStateFor = (project: PreprocessProject, stepId: PreprocessStepId) => {
  switch (stepId) {
    case 'sourceAssets':
      return project.sourceAssets;
    case 'localization':
      return project.localization;
    case 'heFocus':
      return project.heFocus;
    case 'alignment':
      return project.alignment;
    case 'cropQc':
      return project.cropQc;
    case 'chipConfig':
      return project.chipConfig;
    case 'tissueSelection':
      return project.tissueSelection;
    case 'exportState':
      return project.exportState;
    default:
      return project.sourceAssets;
  }
};

type StepSidebarProps = {
  currentStep: PreprocessStepId;
  onStepSelect: (stepId: PreprocessStepId) => void;
  project: PreprocessProject;
};

const isStepEnabled = (project: PreprocessProject, stepId: PreprocessStepId) => {
  switch (stepId) {
    case 'sourceAssets':
      return true;
    case 'localization':
      return true;
    case 'heFocus':
      return project.localization.status === 'complete';
    case 'alignment':
      return project.heFocus.status === 'complete';
    case 'cropQc':
      return project.alignment.status === 'complete';
    case 'chipConfig':
      return project.cropQc.status === 'complete';
    case 'tissueSelection':
      return project.chipConfig.status === 'complete';
    case 'exportState':
      return project.tissueSelection.status === 'complete';
    default:
      return false;
  }
};

export function StepSidebar({ currentStep, onStepSelect, project }: StepSidebarProps) {
  return (
    <Stack
      spacing={4}
      w={{ base: '100%', xl: '272px' }}
      minW={{ base: '100%', xl: '272px' }}
      alignSelf='stretch'
      data-testid='preprocess-workflow-rail'
    >
      <Box
        bg='white'
        border='1px solid'
        borderColor='gray.200'
        borderRadius='2xl'
        boxShadow='sm'
        px={4}
        py={4}
      >
        <Stack spacing={1}>
          <Heading size='sm'>Workflow</Heading>
          <Text fontSize='sm' color='gray.500'>Move step-by-step and keep downstream stages valid.</Text>
        </Stack>
      </Box>
      {PREPROCESS_STEP_ITEMS.map((step) => {
        const stepState = stepStateFor(project, step.id);
        const isActive = step.id === currentStep;
        const enabled = isStepEnabled(project, step.id);
        return (
          <Button
            key={step.id}
            data-testid={step.testId}
            justifyContent='space-between'
            alignItems='flex-start'
            minH='88px'
            h='auto'
            px={4}
            py={4}
            borderRadius='2xl'
            borderWidth='1px'
            borderColor={isActive ? 'brand.200' : 'gray.200'}
            bg={isActive ? 'brand.500' : 'white'}
            color={isActive ? 'white' : 'gray.800'}
            _hover={{
              bg: isActive ? 'brand.600' : 'gray.50',
              borderColor: isActive ? 'brand.300' : 'gray.300',
            }}
            _disabled={{
              opacity: 0.58,
              cursor: 'not-allowed',
              bg: 'gray.100',
              color: 'gray.500',
            }}
            isDisabled={!enabled}
            onClick={() => onStepSelect(step.id)}
          >
            <Stack spacing={1} textAlign='left' flex='1'>
              <Text fontSize='xs' fontWeight='semibold' letterSpacing='0.12em' textTransform='uppercase' color={isActive ? 'whiteAlpha.800' : 'gray.400'}>
                {step.id}
              </Text>
              <Text fontWeight='semibold'>{step.label}</Text>
              <Text fontSize='xs' whiteSpace='normal' color={isActive ? 'whiteAlpha.900' : 'gray.500'}>
                {step.description}
              </Text>
            </Stack>
            <Badge
              ml={3}
              colorScheme={statusToneByStep[stepState.status] ?? 'gray'}
              textTransform='capitalize'
              borderRadius='full'
              px={2}
              py={0.5}
              bg={isActive ? 'whiteAlpha.200' : undefined}
              color={isActive ? 'white' : undefined}
            >
              {stepState.status}
            </Badge>
          </Button>
        );
      })}
    </Stack>
  );
}
