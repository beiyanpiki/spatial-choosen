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
import { useMemo } from 'react';

type CropQcPanelProps = {
  cropHeight: number | null;
  cropWidth: number | null;
  eosinCropDataUrl: string | null;
  heCropDataUrl: string | null;
  checkerboardDataUrl: string | null;
  featureMatchesDataUrl: string | null;
  overlayOpacity: number;
  onOverlayOpacityChange: (value: number) => void;
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
  onOverlayOpacityChange,
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

  return (
    <Stack spacing={5}>
      <HStack spacing={3}>
        <Button onClick={onRunCrop} data-testid='cropqc-run' colorScheme='brand' isDisabled={!canRun}>
          Generate crop + QC
        </Button>
        <Button onClick={onAccept} data-testid='cropqc-accept' colorScheme='green' isDisabled={!canAccept}>
          Accept QC
        </Button>
        <Button onClick={onRejectToAlign} data-testid='cropqc-reject-to-align' variant='outline' isDisabled={!canAccept}>
          Reject and return to alignment
        </Button>
      </HStack>

      <HStack justify='space-between'>
        <Text color='gray.600'>Crop dimensions</Text>
        <Text fontWeight='semibold' data-testid='cropqc-dimensions'>{dimensionsText}</Text>
      </HStack>

      <Tabs size='sm' variant='enclosed' isLazy>
        <TabList>
          <Tab>Tissue align</Tab>
          <Tab>Feature matches</Tab>
          <Tab>Overlay opacity</Tab>
        </TabList>

        <TabPanels>
          <TabPanel px={0} pt={4}>
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
                  alt='QC checkerboard preview'
                  data-testid='cropqc-spatial-align-canvas'
                  style={{ display: 'block', width: '100%', height: '100%', objectFit: 'contain' }}
                />
              ) : (
                <Box p={4}><Text fontSize='sm' color='gray.500'>Checkerboard preview appears after crop generation.</Text></Box>
              )}
            </Box>
          </TabPanel>

          <TabPanel px={0} pt={4}>
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
                  alt='QC feature matches preview'
                  data-testid='cropqc-feature-matches-canvas'
                  style={{ display: 'block', width: '100%', height: '100%', objectFit: 'contain' }}
                />
              ) : (
                <Box p={4}><Text fontSize='sm' color='gray.500'>Feature-match preview appears after crop generation.</Text></Box>
              )}
            </Box>
          </TabPanel>

          <TabPanel px={0} pt={4}>
            <Stack spacing={4}>
              <Stack spacing={2}>
                <Text fontSize='sm' color='gray.600'>Overlay opacity: {overlayOpacity.toFixed(2)}</Text>
                <Slider
                  min={0}
                  max={1}
                  step={0.01}
                  value={overlayOpacity}
                  onChange={onOverlayOpacityChange}
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
                        alt='Eosin crop preview'
                        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain' }}
                      />
                    ) : null}
                    {heCropDataUrl ? (
                      <img
                        src={heCropDataUrl}
                        alt='Warped HE crop preview'
                        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', opacity: overlayOpacity }}
                      />
                    ) : null}
                  </>
                ) : (
                  <Box p={4}><Text fontSize='sm' color='gray.500'>Overlay preview appears after crop generation.</Text></Box>
                )}
              </Box>
            </Stack>
          </TabPanel>
        </TabPanels>
      </Tabs>
    </Stack>
  );
}
