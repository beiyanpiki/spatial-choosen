'use client';

import {
  Badge,
  Box,
  Button,
  Card,
  CardBody,
  Flex,
  Image,
  SimpleGrid,
  Stack,
  Text,
} from '@chakra-ui/react';

type ExportPreviewPanelProps = {
  eosinCropDataUrl: string | null;
  heCropDataUrl: string | null;
  spotImageDataUrl: string | null;
  imageDimensionsSummary: string | null;
  isRenderingSpotImage: boolean;
  spotImageError: string | null;
  canPreview: boolean;
  blockedReason?: string | null;
  onContinueToExport: () => void;
};

type PreviewSlot = {
  title: string;
  imageUrl: string | null;
  testId: string;
  placeholderText: string;
};

const PREVIEW_IMAGE_BOX_HEIGHT = { base: '220px', md: '280px' };

function PreviewImageFrame({ slot }: { slot: PreviewSlot }) {
  return (
    <Stack spacing={2}>
      <Text fontSize="sm" fontWeight="semibold" color="gray.800">
        {slot.title}
      </Text>
      {slot.imageUrl ? (
        <Image
          src={slot.imageUrl}
          alt={slot.title}
          data-testid={slot.testId}
          w="full"
          h={PREVIEW_IMAGE_BOX_HEIGHT}
          objectFit="contain"
          bg="white"
          border="1px solid"
          borderColor="gray.200"
          borderRadius="lg"
        />
      ) : (
        <Flex
          data-testid={`${slot.testId}-placeholder`}
          w="full"
          h={PREVIEW_IMAGE_BOX_HEIGHT}
          align="center"
          justify="center"
          px={4}
          bg="gray.50"
          border="1px dashed"
          borderColor="gray.200"
          borderRadius="lg"
        >
          <Text fontSize="sm" color="gray.500" textAlign="center">
            {slot.placeholderText}
          </Text>
        </Flex>
      )}
    </Stack>
  );
}

export function ExportPreviewPanel({
  eosinCropDataUrl,
  heCropDataUrl,
  spotImageDataUrl,
  imageDimensionsSummary,
  isRenderingSpotImage,
  spotImageError,
  canPreview,
  blockedReason = null,
  onContinueToExport,
}: ExportPreviewPanelProps) {
  const status = !canPreview
    ? { label: 'Blocked', colorScheme: 'orange' }
    : isRenderingSpotImage || !spotImageDataUrl
      ? { label: 'Preparing spot image', colorScheme: 'orange' }
      : { label: 'Ready', colorScheme: 'green' };

  const previewSlots: PreviewSlot[] = [
    {
      title: 'Cropped eosin image',
      imageUrl: canPreview ? eosinCropDataUrl : null,
      testId: 'export-preview-eosin-image',
      placeholderText: 'The cropped eosin image is unavailable.',
    },
    {
      title: 'Cropped H&E image',
      imageUrl: canPreview ? heCropDataUrl : null,
      testId: 'export-preview-he-image',
      placeholderText: 'The cropped H&E image is unavailable.',
    },
    {
      title: 'Standalone spot image',
      imageUrl: canPreview ? spotImageDataUrl : null,
      testId: 'export-preview-spot-image',
      placeholderText: isRenderingSpotImage
        ? 'Preparing the standalone spot image…'
        : spotImageError ?? 'The standalone spot image is unavailable.',
    },
  ];

  return (
    <Card
      border="1px solid"
      borderColor="gray.200"
      borderRadius="2xl"
      boxShadow="sm"
      bg="white"
      maxW="720px"
      data-testid="export-preview-panel"
    >
      <CardBody p={0}>
        <Stack spacing={0} divider={<Box h="1px" bg="gray.100" />}>
          <Stack px={6} py={5} spacing={3}>
            <Flex justify="space-between" align="flex-start" gap={3} wrap="wrap">
              <Stack spacing={2} flex="1" minW={0}>
                <Text
                  fontSize="xs"
                  textTransform="uppercase"
                  letterSpacing="0.12em"
                  color="gray.500"
                >
                  Export Preview
                </Text>
                <Text fontSize="sm" color="gray.600">
                  Review the registered crops next to the standalone spot image
                  before exporting. All three images share the registered crop
                  dimensions
                  {imageDimensionsSummary ? ` (${imageDimensionsSummary})` : ''}
                  , so tissue coverage can be compared position for position.
                </Text>
              </Stack>
              <Badge
                colorScheme={status.colorScheme}
                borderRadius="full"
                px={2.5}
                py={1}
                flexShrink={0}
                data-testid="export-preview-status-badge"
              >
                {status.label}
              </Badge>
            </Flex>
          </Stack>

          <Stack px={6} py={5} spacing={4}>
            {!canPreview && blockedReason ? (
              <Flex
                gap={2}
                align="flex-start"
                border="1px solid"
                borderColor="orange.200"
                borderLeftWidth="4px"
                borderRadius="md"
                bg="orange.50"
                px={3}
                py={2.5}
                data-testid="export-preview-blocked-reason"
              >
                <Text aria-hidden="true" fontSize="md" lineHeight={1.3}>
                  ⚠️
                </Text>
                <Text fontSize="sm" color="orange.600">
                  {blockedReason}
                </Text>
              </Flex>
            ) : null}
            {canPreview && spotImageError ? (
              <Flex
                gap={2}
                align="flex-start"
                border="1px solid"
                borderColor="red.100"
                borderLeftWidth="4px"
                borderRadius="md"
                bg="red.50"
                px={3}
                py={2.5}
                data-testid="export-preview-spot-image-error"
              >
                <Text aria-hidden="true" fontSize="md" lineHeight={1.3}>
                  ⚠️
                </Text>
                <Text fontSize="sm" color="red.600">
                  {spotImageError}
                </Text>
              </Flex>
            ) : null}
            <SimpleGrid columns={{ base: 1, lg: 3 }} spacing={4}>
              {previewSlots.map((slot) => (
                <PreviewImageFrame key={slot.testId} slot={slot} />
              ))}
            </SimpleGrid>
          </Stack>

          <Stack px={6} py={5} spacing={3}>
            <Button
              colorScheme="brand"
              w="100%"
              onClick={onContinueToExport}
              isDisabled={!canPreview}
              data-testid="export-preview-continue"
            >
              Continue to export
            </Button>
          </Stack>
        </Stack>
      </CardBody>
    </Card>
  );
}
