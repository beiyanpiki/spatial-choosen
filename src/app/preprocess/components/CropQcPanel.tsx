'use client';

import {
  Box,
  Button,
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
import {
  commitCropQcOverlayOpacityDraft,
  createCropQcOverlayOpacityState,
  syncCommittedCropQcOverlayOpacity,
  updateCropQcOverlayOpacityDraft,
} from './cropQcOverlayOpacity';
import { getCropQcPreviewMode } from './cropQcPreviewModes';

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
};

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
}: CropQcPanelProps) {
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

  return (
    <Stack spacing={5}>
      <HStack spacing={3}>
        <Button onClick={onRunCrop} data-testid='cropqc-run' colorScheme='brand' isDisabled={!canRun}>
          Generate Registered ROI
        </Button>
        <Button onClick={onAccept} data-testid='cropqc-accept' colorScheme='green' isDisabled={!canAccept}>
          Approve Registration
        </Button>
        <Button onClick={onRejectToAlign} data-testid='cropqc-reject-to-align' variant='outline' isDisabled={!canAccept}>
          Return to Landmark Pairing
        </Button>
      </HStack>

      <HStack justify='space-between'>
        <Text color='gray.600'>Registered Image Size</Text>
        <Text fontWeight='semibold' data-testid='cropqc-dimensions'>{dimensionsText}</Text>
      </HStack>

      <Tabs size='sm' variant='enclosed' isLazy>
        <TabList>
          <Tab>Checkerboard View</Tab>
          <Tab>Landmark Pair Verification</Tab>
          <Tab>Overlay View</Tab>
        </TabList>

        <TabPanels>
          <TabPanel px={0} pt={4}>
            <Stack spacing={3}>
              <Box>
                <Text fontSize='sm' fontWeight='semibold' color='gray.700'>
                  {tissueAlignPreviewMode.title}
                </Text>
                <Text fontSize='sm' color='gray.600'>
                  {tissueAlignPreviewMode.description}
                </Text>
              </Box>
              <Box
                border='1px solid'
                borderColor='gray.200'
                borderRadius='lg'
                overflow='hidden'
                bg='gray.50'
                minH={{ base: '320px', lg: '400px' }}
                h={{ base: '44vh', lg: '52vh' }}
                maxH='480px'
                maxW='480px'
                mx='auto'
                display='flex'
                alignItems='center'
                justifyContent='center'
              >
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
              <Box>
                <Text fontSize='sm' fontWeight='semibold' color='gray.700'>
                  {featureMatchesPreviewMode.title}
                </Text>
                <Text fontSize='sm' color='gray.600'>
                  {featureMatchesPreviewMode.description}
                </Text>
              </Box>
              <Box
                border='1px solid'
                borderColor='gray.200'
                borderRadius='lg'
                overflow='hidden'
                bg='gray.50'
                minH={{ base: '320px', lg: '400px' }}
                h={{ base: '44vh', lg: '52vh' }}
                maxH='480px'
                display='flex'
                alignItems='center'
                justifyContent='center'
              >
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
                <Text fontSize='sm' color='gray.600'>Overlay Transparency: {displayedOverlayOpacity.toFixed(2)}</Text>
                <Slider
                  min={0}
                  max={1}
                  step={0.01}
                  value={displayedOverlayOpacity}
                  onChange={handleOverlayOpacityChange}
                  onChangeEnd={handleOverlayOpacityChangeEnd}
                  data-testid='cropqc-overlay-opacity'
                >
                  <SliderTrack>
                    <SliderFilledTrack />
                  </SliderTrack>
                  <SliderThumb />
                </Slider>
              </Stack>

              <Box
                border='1px solid'
                borderColor='gray.200'
                borderRadius='lg'
                overflow='hidden'
                position='relative'
                bg='gray.50'
                minH={{ base: '280px', lg: '360px' }}
                h={{ base: '44vh', lg: '52vh' }}
                maxH='640px'
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
                  <Box p={4}><Text fontSize='sm' color='gray.500'>Overlay preview appears after registered crop generation.</Text></Box>
                )}
              </Box>
            </Stack>
          </TabPanel>
        </TabPanels>
      </Tabs>
    </Stack>
  );
}
