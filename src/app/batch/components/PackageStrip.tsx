'use client';

import { Badge, Box, Button, Flex, HStack, Stack, Text } from '@chakra-ui/react';
import { useCallback, useState } from 'react';

import type { BatchPackage } from '@/types/batch';

type PackageStripProps = {
  packages: readonly BatchPackage[];
  referencePackageId: string | null;
  activePackageId: string | null;
  onSelect: (packageId: string) => void;
  onSetReference: (packageId: string) => void;
  /** Moves `packageId` so that it sits at `toIndex` in the list. */
  onReorder: (packageId: string, toIndex: number) => void;
  /** Short status line under the name, e.g. `drawn · 253`. */
  describe?: (entry: BatchPackage) => string | null;
  /**
   * Label for the designated chip. Steps 3 and 4 pick the batch reference;
   * step 2 picks the image the overlay is aligned against.
   */
  designateLabel?: string;
  designateTitle?: string;
  /** Chips that cannot take the designation (e.g. the overlay itself). */
  isDesignateDisabled?: (entry: BatchPackage) => boolean;
  testIdPrefix: string;
};

/**
 * Package chips that can be dragged into a different order.
 *
 * The order is the sample order used everywhere else, and the star re-bases the
 * whole batch onto another reference image.
 */
export function PackageStrip({
  packages,
  referencePackageId,
  activePackageId,
  onSelect,
  onSetReference,
  onReorder,
  describe,
  designateLabel = 'reference',
  designateTitle = 'Use this image as the reference',
  isDesignateDisabled,
  testIdPrefix,
}: PackageStripProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const finishDrag = useCallback(() => {
    setDraggingId(null);
    setDropIndex(null);
  }, []);

  return (
    <Flex
      wrap='wrap'
      gap={2}
      data-testid={`${testIdPrefix}-strip`}
      onDragOver={(event) => {
        if (!draggingId) return;
        event.preventDefault();
        setDropIndex(packages.length);
      }}
      onDrop={(event) => {
        event.preventDefault();
        if (draggingId) onReorder(draggingId, packages.length);
        finishDrag();
      }}
    >
      {packages.map((entry, index) => {
        const isReference = entry.id === referencePackageId;
        const isActive = entry.id === activePackageId;
        const isDropTarget = dropIndex === index && draggingId !== null && draggingId !== entry.id;

        return (
          <Box
            key={entry.id}
            draggable
            data-testid={`${testIdPrefix}-item-${entry.name}`}
            onDragStart={(event) => {
              setDraggingId(entry.id);
              event.dataTransfer.effectAllowed = 'move';
              // Firefox needs data set for the drag to start.
              event.dataTransfer.setData('text/plain', entry.name);
            }}
            onDragOver={(event) => {
              if (!draggingId) return;
              event.preventDefault();
              event.stopPropagation();
              setDropIndex(index);
            }}
            onDrop={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (draggingId) onReorder(draggingId, index);
              finishDrag();
            }}
            onDragEnd={finishDrag}
            opacity={draggingId === entry.id ? 0.5 : 1}
            border='2px solid'
            borderColor={isDropTarget ? 'brand.400' : 'transparent'}
            borderRadius='xl'
            cursor='grab'
          >
            <HStack
              spacing={1}
              align='stretch'
              bg={isActive ? 'brand.500' : 'white'}
              color={isActive ? 'white' : 'gray.800'}
              border='1px solid'
              borderColor={isActive ? 'brand.200' : 'gray.200'}
              borderRadius='lg'
              overflow='hidden'
            >
              <Button
                size='sm'
                h='auto'
                py={2}
                px={3}
                borderRadius={0}
                variant='ghost'
                color='inherit'
                _hover={{ bg: isActive ? 'brand.600' : 'gray.50' }}
                data-testid={`${testIdPrefix}-select-${entry.name}`}
                onClick={() => onSelect(entry.id)}
              >
                <Stack spacing={0} align='flex-start'>
                  <Text fontSize='sm' fontWeight='semibold'>{entry.name}</Text>
                  <Text fontSize='xs' opacity={0.75}>
                      {describe?.(entry) ?? (isReference ? 'reference' : '')}
                    </Text>
                  </Stack>
                </Button>

              {isReference ? (
                <Flex align='center' pr={3}>
                  <Badge colorScheme={isActive ? 'whiteAlpha' : 'brand'} borderRadius='full' data-testid={`${testIdPrefix}-reference-badge-${entry.name}`}>
                    {designateLabel}
                  </Badge>
                </Flex>
              ) : (
                <Button
                  size='xs'
                  alignSelf='stretch'
                  h='auto'
                  borderRadius={0}
                  variant='ghost'
                  color='inherit'
                  isDisabled={isDesignateDisabled?.(entry) ?? false}
                  title={designateTitle}
                  aria-label={`${designateTitle}: ${entry.name}`}
                  data-testid={`${testIdPrefix}-set-reference-${entry.name}`}
                  _hover={{ bg: isActive ? 'brand.600' : 'gray.100' }}
                  onClick={() => onSetReference(entry.id)}
                >
                  ☆
                </Button>
              )}
            </HStack>
          </Box>
        );
      })}
    </Flex>
  );
}
