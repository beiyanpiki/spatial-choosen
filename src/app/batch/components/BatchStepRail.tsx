'use client';

import { Badge, Box, Button, Heading, Stack, Text } from '@chakra-ui/react';

import type { BatchStepId, BatchStepStatus } from '@/types/batch';

export type BatchStepItem = {
  id: BatchStepId;
  label: string;
  description: string;
  status: BatchStepStatus;
  enabled: boolean;
  hint: string | null;
  testId: string;
};

const statusTone: Record<BatchStepStatus, string> = {
  idle: 'gray',
  ready: 'blue',
  complete: 'green',
  error: 'red',
};

type BatchStepRailProps = {
  currentStep: BatchStepId;
  items: readonly BatchStepItem[];
  onSelect: (stepId: BatchStepId) => void;
};

export function BatchStepRail({ currentStep, items, onSelect }: BatchStepRailProps) {
  return (
    <Stack
      spacing={3}
      w={{ base: '100%', md: '250px', xl: '280px' }}
      minW={{ base: '100%', md: '250px', xl: '280px' }}
      alignSelf='stretch'
      data-testid='batch-workflow-rail'
    >
      <Box bg='white' border='1px solid' borderColor='gray.200' borderRadius='2xl' boxShadow='sm' px={4} py={4}>
        <Stack spacing={1}>
          <Heading size='sm'>Batch Workflow</Heading>
          <Text fontSize='sm' color='gray.500'>
            Import n NATA packages, align every section to a reference, then annotate once and propagate.
          </Text>
        </Stack>
      </Box>

      {items.map((item, index) => {
        const isActive = item.id === currentStep;
        return (
          <Button
            key={item.id}
            data-testid={item.testId}
            justifyContent='space-between'
            alignItems='flex-start'
            minH='84px'
            h='auto'
            px={4}
            py={3}
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
            isDisabled={!item.enabled}
            onClick={() => onSelect(item.id)}
          >
            <Stack spacing={1} textAlign='left' flex='1' minW={0}>
              <Text
                fontSize='xs'
                fontWeight='semibold'
                letterSpacing='0.12em'
                textTransform='uppercase'
                color={isActive ? 'whiteAlpha.800' : 'gray.400'}
              >
                Step {index + 1}
              </Text>
              <Text fontWeight='semibold'>{item.label}</Text>
              <Text fontSize='xs' whiteSpace='normal' color={isActive ? 'whiteAlpha.900' : 'gray.500'}>
                {item.hint ?? item.description}
              </Text>
            </Stack>
            <Badge
              ml={3}
              flexShrink={0}
              colorScheme={statusTone[item.status]}
              textTransform='capitalize'
              borderRadius='full'
              px={2}
              py={0.5}
              bg={isActive ? 'whiteAlpha.200' : undefined}
              color={isActive ? 'white' : undefined}
            >
              {item.status}
            </Badge>
          </Button>
        );
      })}
    </Stack>
  );
}
