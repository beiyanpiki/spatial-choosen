import { Badge, Button, Stack, Text } from '@chakra-ui/react';
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
    case 'alignment':
      return project.localization.status === 'complete';
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
      spacing={3}
      w={{ base: '100%', lg: '280px' }}
      bg='white'
      border='1px solid'
      borderColor='gray.100'
      borderRadius='lg'
      boxShadow='sm'
      p={4}
      alignSelf='stretch'
    >
      <Text fontSize='sm' fontWeight='semibold' color='gray.500'>
        Workflow
      </Text>
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
            minH='72px'
            h='auto'
            px={4}
            py={3}
            variant={isActive ? 'solid' : 'outline'}
            colorScheme={isActive ? 'brand' : 'gray'}
            isDisabled={!enabled}
            onClick={() => onStepSelect(step.id)}
          >
            <Stack spacing={1} textAlign='left' flex='1'>
              <Text fontWeight='semibold'>{step.label}</Text>
              <Text fontSize='xs' whiteSpace='normal' color={isActive ? 'whiteAlpha.900' : 'gray.500'}>
                {step.description}
              </Text>
            </Stack>
            <Badge
              ml={3}
              colorScheme={statusToneByStep[stepState.status] ?? 'gray'}
              textTransform='capitalize'
            >
              {stepState.status}
            </Badge>
          </Button>
        );
      })}
    </Stack>
  );
}
