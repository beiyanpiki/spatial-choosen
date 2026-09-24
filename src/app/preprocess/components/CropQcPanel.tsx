'use client';

import {
  Badge,
  Box,
  Button,
  Flex,
  HStack,
  Slider,
  SliderFilledTrack,
  SliderThumb,
  SliderTrack,
  Stack,
  Tab,
  TabList,
  TabPanel,
  TabPanels,
  Tabs,
  Text,
} from '@chakra-ui/react';
import { useCallback, useMemo, useState } from 'react';
import type { AlignmentSlice } from '@/types/preprocess';
import {
  commitCropQcOverlayOpacityDraft,
  createCropQcOverlayOpacityState,
  syncCommittedCropQcOverlayOpacity,
  updateCropQcOverlayOpacityDraft,
} from './cropQcOverlayOpacity';
import { getCropQcPreviewMode } from './cropQcPreviewModes';

type AlignmentQualityFlags = NonNullable<AlignmentSlice['qualityFlags']>;

type CropQcPanelProps = {
  cropHeight: number | null;
  cropWidth: number | null;
  eosinCropDataUrl: string | null;
  heCropDataUrl: string | null;
  checkerboardDataUrl: string | null;
  featureMatchesDataUrl: string | null;
  overlayOpacity: number;
  onOverlayOpacityCommit: (value: number) => void;
  onRunCrop: () => void;
  onAccept: () => void;
  onRejectToAlign: () => void;
  canRun: boolean;
  canAccept: boolean;
  qcAccepted?: boolean;
  alignmentRmse?: number | null;
  alignmentInlierRatio?: number | null;
  alignmentQualityFlags?: AlignmentQualityFlags | null;
};

const formatPercent = (value: number | null) =>
  value === null || value === undefined
    ? '—'
    : `${(value * 100).toFixed(1)}%`;
const formatMetric = (value: number | null | undefined, digits = 3) =>
  value === null || value === undefined ? '—' : value.toFixed(digits);

const previewBoxStyle = {
  border: '1px solid',
  borderColor: 'gray.200',
  borderRadius: 'lg',
  overflow: 'hidden',
  bg: 'gray.50',
  minH: { base: '320px', lg: '420px' },
  h: { base: '44vh', lg: '56vh' },
  maxH: '640px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
} as const;

export function CropQcPanel({
  cropHeight,
  cropWidth,
  eosinCropDataUrl,
  heCropDataUrl,
  checkerboardDataUrl,
  featureMatchesDataUrl,
  overlayOpacity,
  onOverlayOpacityCommit,
  onRunCrop,
  onAccept,
  onRejectToAlign,
  canRun,
  canAccept,
  qcAccepted = false,
  alignmentRmse = null,
  alignmentInlierRatio = null,
  alignmentQualityFlags = null,
}: CropQcPanelProps) {
  const hasGeneratedCrop = Boolean(
    eosinCropDataUrl || heCropDataUrl || checkerboardDataUrl || featureMatchesDataUrl,
  );

  const dimensionsText = useMemo(() => {
    if (!cropWidth || !cropHeight) return 'Not generated';
    return `${cropWidth} × ${cropHeight}`;
  }, [cropHeight, cropWidth]);

  const [overlayOpacityState, setOverlayOpacityState] = useState(() => (
    createCropQcOverlayOpacityState(overlayOpacity)
  ));

  const syncedOverlayOpacityState = syncCommittedCropQcOverlayOpacity(
    overlayOpacityState,
    overlayOpacity,
  );

  const handleOverlayOpacityChange = useCallback((value: number) => {
    setOverlayOpacityState((current) => updateCropQcOverlayOpacityDraft(
      syncCommittedCropQcOverlayOpacity(current, overlayOpacity),
      value,
    ));
  }, [overlayOpacity]);

  const handleOverlayOpacityChangeEnd = useCallback((value: number) => {
    setOverlayOpacityState((current) => commitCropQcOverlayOpacityDraft(
      syncCommittedCropQcOverlayOpacity(current, overlayOpacity),
      value,
    ));
    onOverlayOpacityCommit(value);
  }, [onOverlayOpacityCommit, overlayOpacity]);

  const displayedOverlayOpacity = syncedOverlayOpacityState.displayOpacity;
  const tissueAlignPreviewMode = getCropQcPreviewMode('tissueAlign');
  const featureMatchesPreviewMode = getCropQcPreviewMode('featureMatches');

  const reviewStatus = qcAccepted
    ? { label: 'Accepted', colorScheme: 'green' as const }
    : hasGeneratedCrop
      ? { label: 'Ready to review', colorScheme: 'blue' as const }
      : { label: 'Not generated', colorScheme: 'gray' as const };

  return (
    <Stack spacing={5}>
      <Box
        border='1px solid'
        borderColor='gray.200'
        borderRadius='2xl'
        bg='white'
        px={5}
        py={4}
        boxShadow='sm'
      >
        <Stack spacing={3}>
          <Flex
            justify='space-between'
            align={{ base: 'flex-start', md: 'center' }}
            gap={4}
            wrap='wrap'
          >
            <Stack spacing={2}>
              <Flex align='center' gap={2} wrap='wrap'>
                <Text
                  fontSize='xs'
                  textTransform='uppercase'
                  letterSpacing='0.12em'
                  color='gray.500'
                >
                  Registration Review
                </Text>
                <Badge
                  colorScheme={reviewStatus.colorScheme}
                  borderRadius='full'
                  px={2.5}
                  py={1}
                  data-testid='cropqc-status-badge'
                  data-review-status={qcAccepted
                    ? 'accepted'
                    : hasGeneratedCrop
                      ? 'ready'
                      : 'not-generated'}
                >
                  {reviewStatus.label}
                </Badge>
              </Flex>
              <HStack spacing={5} wrap='wrap'>
                <HStack spacing={2}>
                  <Text fontSize='sm' color='gray.600'>Registered Image Size</Text>
                  <Text fontSize='sm' fontWeight='semibold' data-testid='cropqc-dimensions'>
                    {dimensionsText}
                  </Text>
                </HStack>
                <HStack spacing={2}>
                  <Text fontSize='sm' color='gray.600'>Reprojection RMSE</Text>
                  <Text fontSize='sm' fontWeight='semibold' data-testid='cropqc-rmse'>
                    {`${formatMetric(alignmentRmse)} px`}
                  </Text>
                </HStack>
                <HStack spacing={2}>
                  <Text fontSize='sm' color='gray.600'>Inlier Ratio</Text>
                  <Text fontSize='sm' fontWeight='semibold' data-testid='cropqc-inlier-ratio'>
                    {formatPercent(alignmentInlierRatio)}
                  </Text>
                </HStack>
              </HStack>
            </Stack>
            <Button
              onClick={onRunCrop}
              data-testid='cropqc-run'
              colorScheme='brand'
              isDisabled={!canRun}
              flexShrink={0}
            >
              {hasGeneratedCrop ? 'Regenerate Registered ROI' : 'Generate Registered ROI'}
            </Button>
          </Flex>
          {alignmentQualityFlags ? (
            <Text fontSize='xs' color='gray.500' data-testid='cropqc-quality-flags'>
              Quality gates — minPairs:
              {alignmentQualityFlags.minPairs ? '✓' : '✗'} • inlier:
              {alignmentQualityFlags.inlierRatio ? '✓' : '✗'} • rmse:
              {alignmentQualityFlags.rmse ? '✓' : '✗'} • matrix:
              {alignmentQualityFlags.finiteMatrix ? '✓' : '✗'} • scale:
              {alignmentQualityFlags.scaleRange ? '✓' : '✗'}
            </Text>
          ) : null}
          {!canRun ? (
            <Text fontSize='sm' color='orange.600'>
              Complete landmark pairing with accepted quality gates to enable
              registered ROI generation.
            </Text>
          ) : null}
        </Stack>
      </Box>

      <Tabs size='sm' variant='enclosed' isLazy>
        <TabList>
          <Tab>Checkerboard View</Tab>
          <Tab>Landmark Pair Verification</Tab>
          <Tab>Overlay View</Tab>
        </TabList>

        <TabPanels>
          <TabPanel px={0} pt={4}>
            <Stack spacing={3}>
              <Text fontSize='sm' color='gray.600'>
                {tissueAlignPreviewMode.description}
              </Text>
              <Box {...previewBoxStyle}>
                {checkerboardDataUrl ? (
                  <img
                    src={checkerboardDataUrl}
                    alt='Registered crop checkerboard QC preview'
                    data-testid='cropqc-spatial-align-canvas'
                    style={{ display: 'block', width: '100%', height: '100%', objectFit: 'contain' }}
                  />
                ) : (
                  <Box p={4}><Text fontSize='sm' color='gray.500'>{tissueAlignPreviewMode.emptyState}</Text></Box>
                )}
              </Box>
            </Stack>
          </TabPanel>

          <TabPanel px={0} pt={4}>
            <Stack spacing={3}>
              <Text fontSize='sm' color='gray.600'>
                {featureMatchesPreviewMode.description}
              </Text>
              <Box {...previewBoxStyle}>
                {featureMatchesDataUrl ? (
                  <img
                    src={featureMatchesDataUrl}
                    alt='Landmark match QC preview'
                    data-testid='cropqc-feature-matches-canvas'
                    style={{ display: 'block', width: '100%', height: '100%', objectFit: 'contain' }}
                  />
                ) : (
                  <Box p={4}><Text fontSize='sm' color='gray.500'>{featureMatchesPreviewMode.emptyState}</Text></Box>
                )}
              </Box>
            </Stack>
          </TabPanel>

          <TabPanel px={0} pt={4}>
            <Stack spacing={4}>
              <Stack spacing={2}>
                <Text fontSize='sm' color='gray.600'>Adjust the transparency of the registered H&E image to visually assess the overlap between the selected ROI and the NATA Align image.</Text>
                <Flex align='center' gap={4} wrap='wrap'>
                  <Text
                    fontSize='sm'
                    fontWeight='semibold'
                    color='gray.700'
                    flexShrink={0}
                  >
                    Overlay Transparency: {displayedOverlayOpacity.toFixed(2)}
                  </Text>
                  <Slider
                    min={0}
                    max={1}
                    step={0.01}
                    value={displayedOverlayOpacity}
                    onChange={handleOverlayOpacityChange}
                    onChangeEnd={handleOverlayOpacityChangeEnd}
                    data-testid='cropqc-overlay-opacity'
                    flex={1}
                    minW={{ base: '200px', md: '280px' }}
                  >
                    <SliderTrack>
                      <SliderFilledTrack />
                    </SliderTrack>
                    <SliderThumb />
                  </Slider>
                </Flex>
              </Stack>

              <Box
                {...previewBoxStyle}
                position='relative'
                alignItems='stretch'
                justifyContent='flex-start'
              >
                {eosinCropDataUrl || heCropDataUrl ? (
                  <>
                    {eosinCropDataUrl ? (
                      <img
                        src={eosinCropDataUrl}
                        alt='Eosin reference crop preview'
                        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain' }}
                      />
                    ) : null}
                    {heCropDataUrl ? (
                      <img
                        src={heCropDataUrl}
                        alt='Registered HE crop preview'
                        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', opacity: displayedOverlayOpacity }}
                      />
                    ) : null}
                  </>
                ) : (
                  <Flex align='center' justify='center' w='100%'>
                    <Text fontSize='sm' color='gray.500'>Overlay preview appears after registered crop generation.</Text>
                  </Flex>
                )}
              </Box>
            </Stack>
          </TabPanel>
        </TabPanels>
      </Tabs>

      <Flex
        justify={{ base: 'flex-start', lg: 'flex-end' }}
        align='center'
        gap={3}
        wrap='wrap'
      >
        {!canAccept ? (
          <Text fontSize='sm' color='gray.500' flex='1'>
            Generate the registered ROI to enable approval.
          </Text>
        ) : null}
        <Button
          onClick={onRejectToAlign}
          data-testid='cropqc-reject-to-align'
          variant='outline'
          isDisabled={!canAccept}
        >
          Return to Landmark Pairing
        </Button>
        <Button
          onClick={onAccept}
          data-testid='cropqc-accept'
          colorScheme='green'
          isDisabled={!canAccept}
        >
          Approve Registration
        </Button>
      </Flex>
    </Stack>
  );
}
