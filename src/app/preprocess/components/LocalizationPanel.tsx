'use client';

import {
  Badge,
  Box,
  Button,
  ButtonGroup,
  Divider,
  Input,
  Stack,
  Tab,
  TabList,
  TabPanel,
  TabPanels,
  Tabs,
  Text,
} from '@chakra-ui/react';
import { useRef } from 'react';
import { LOCALIZATION_BOX_COLOR_SWATCHS } from '@/lib/preprocess/localization';
import type {
  LocalizationBoxColor,
  LocalizationImageTransform,
  PreprocessRect,
  PreprocessSourceImage,
} from '@/types/preprocess';

type LocalizationPanelProps = {
  boxColor: LocalizationBoxColor;
  chipBounds: PreprocessRect | null;
  image: PreprocessSourceImage | null;
  imageTransform: LocalizationImageTransform;
  onBoxColorChange: (value: LocalizationBoxColor) => void;
  onFlipHorizontal: () => void;
  onFlipVertical: () => void;
  onResetTransform: () => void;
  onRotationChange: (value: number) => void;
  onScaleChange: (value: number) => void;
  onUploadEosin: (fileList: FileList | null) => void;
  summaryJson: string;
};

const formatBounds = (chipBounds: PreprocessRect | null) => {
  if (!chipBounds) return 'No chip box yet';

  return `x ${chipBounds.x.toFixed(3)} • y ${chipBounds.y.toFixed(3)} • w ${chipBounds.width.toFixed(3)} • h ${chipBounds.height.toFixed(3)}`;
};

export function LocalizationPanel({
  boxColor,
  chipBounds,
  image,
  imageTransform,
  onBoxColorChange,
  onFlipHorizontal,
  onFlipVertical,
  onResetTransform,
  onRotationChange,
  onScaleChange,
  onUploadEosin,
  summaryJson,
}: LocalizationPanelProps) {
  const uploadInputRef = useRef<HTMLInputElement | null>(null);

  return (
    <Stack
      spacing={4}
      w={{ base: '100%', xl: '340px' }}
      bg='white'
      border='1px solid'
      borderColor='gray.100'
      borderRadius='lg'
      boxShadow='sm'
      p={5}
      alignSelf='stretch'
    >
      <Stack spacing={1}>
        <Text fontSize='sm' fontWeight='semibold' color='gray.500'>Localization controls</Text>
        <Text fontSize='sm' color='gray.600'>
          Rotate and flip the displayed eosin image while keeping the saved chip box axis-aligned in image coordinates.
        </Text>
      </Stack>

      <Tabs size='sm' variant='enclosed' isLazy>
        <TabList>
          <Tab>Image</Tab>
          <Tab>Transform</Tab>
          <Tab>Box + Data</Tab>
        </TabList>

        <TabPanels>
          <TabPanel px={0} pt={4}>
            <Stack spacing={3}>
              <Stack spacing={1}>
                <Text fontSize='sm' fontWeight='semibold'>Eosin source</Text>
                <Text fontSize='sm' color='gray.600'>
                  {image
                    ? `${image.fileName} • ${image.width ?? '?'}×${image.height ?? '?'} px`
                    : 'Upload an eosin image to start localization.'}
                </Text>
              </Stack>

              <Badge colorScheme={image ? 'green' : 'orange'} alignSelf='flex-start'>
                {image ? 'Image ready' : 'Image missing'}
              </Badge>

              <Button colorScheme='brand' variant={image ? 'outline' : 'solid'} onClick={() => uploadInputRef.current?.click()}>
                {image ? 'Replace eosin image' : 'Upload eosin image'}
              </Button>
              <Input
                ref={uploadInputRef}
                type='file'
                accept='image/*,.tif,.tiff'
                display='none'
                onChange={(event) => {
                  onUploadEosin(event.target.files);
                  event.target.value = '';
                }}
              />
            </Stack>
          </TabPanel>

          <TabPanel px={0} pt={4}>
            <Stack spacing={3}>
              <Stack spacing={1}>
                <Text fontSize='sm' fontWeight='semibold'>Rotation</Text>
                <Text fontSize='sm' color='gray.600'>Display transform only</Text>
              </Stack>

              <Input
                type='range'
                min={-180}
                max={180}
                step={0.1}
                value={imageTransform.rotationDegrees}
                onChange={(event) => onRotationChange(Number(event.target.value))}
                data-testid='localize-rotation-slider'
                px={0}
              />
              <Text fontSize='sm' color='gray.600'>
                {imageTransform.rotationDegrees.toFixed(1)}°
              </Text>

              <Stack spacing={1} pt={2}>
                <Text fontSize='sm' fontWeight='semibold'>Zoom</Text>
                <Text fontSize='sm' color='gray.600'>Display scale only</Text>
              </Stack>

              <Input
                type='range'
                min={0.5}
                max={4}
                step={0.05}
                value={imageTransform.scale}
                onChange={(event) => onScaleChange(Number(event.target.value))}
                data-testid='localize-scale-slider'
                px={0}
              />
              <Text fontSize='sm' color='gray.600'>
                {(imageTransform.scale * 100).toFixed(0)}%
              </Text>

              <ButtonGroup size='sm' isAttached variant='outline'>
                <Button onClick={onFlipHorizontal} data-testid='localize-flip-horizontal'>
                  Flip horizontal
                </Button>
                <Button onClick={onFlipVertical}>Flip vertical</Button>
              </ButtonGroup>

              <Button size='sm' variant='ghost' onClick={onResetTransform}>
                Reset transform
              </Button>
            </Stack>
          </TabPanel>

          <TabPanel px={0} pt={4}>
            <Stack spacing={4}>
              <Stack spacing={3}>
                <Stack spacing={1}>
                  <Text fontSize='sm' fontWeight='semibold'>Chip box color</Text>
                  <Text fontSize='sm' color='gray.600'>Default green, optional white.</Text>
                </Stack>
                <ButtonGroup size='sm' isAttached>
                  {(['green', 'white'] as const).map((value) => (
                    <Button
                      key={value}
                      variant={boxColor === value ? 'solid' : 'outline'}
                      colorScheme={boxColor === value ? 'brand' : 'gray'}
                      onClick={() => onBoxColorChange(value)}
                    >
                      {LOCALIZATION_BOX_COLOR_SWATCHS[value].label}
                    </Button>
                  ))}
                </ButtonGroup>
              </Stack>

              <Divider />

              <Stack spacing={2}>
                <Text fontSize='sm' fontWeight='semibold'>Saved chip rectangle</Text>
                <Text fontSize='sm' color='gray.600'>{formatBounds(chipBounds)}</Text>
              </Stack>

              <Box
                as='pre'
                fontSize='xs'
                lineHeight='tall'
                bg='gray.900'
                color='whiteAlpha.900'
                borderRadius='md'
                p={3}
                overflowX='auto'
                data-testid='localization-summary-json'
              >
                {summaryJson}
              </Box>
            </Stack>
          </TabPanel>
        </TabPanels>
      </Tabs>
    </Stack>
  );
}
