'use client';

import {
  Badge,
  Box,
  Button,
  Card,
  CardBody,
  Flex,
  HStack,
  Radio,
  RadioGroup,
  Stack,
  Table,
  TableContainer,
  Tbody,
  Td,
  Text,
  Th,
  Thead,
  Tr,
} from '@chakra-ui/react';
import { useEffect, useRef, useState } from 'react';

import {
  readDroppedBatchFiles,
  selectedFilesFromFileList,
  type BatchSelectedFile,
} from '@/lib/batch/importPackages';
import type { BatchPackage } from '@/types/batch';

type BatchImportPanelProps = {
  packages: readonly BatchPackage[];
  referencePackageId: string | null;
  busyLabel: string | null;
  onReferenceChange: (packageId: string) => void;
  onSelectedFiles: (files: BatchSelectedFile[]) => void;
  onClear: () => void;
};

const statusTone: Record<BatchPackage['status'], string> = {
  loading: 'blue',
  ready: 'green',
  error: 'red',
};

const formatCount = (value: number | null | undefined) => (
  typeof value === 'number' ? value.toLocaleString('en-US') : '—'
);

export function BatchImportPanel({
  packages,
  referencePackageId,
  busyLabel,
  onReferenceChange,
  onSelectedFiles,
  onClear,
}: BatchImportPanelProps) {
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const zipInputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    const input = folderInputRef.current;
    if (!input) return;

    // `webkitdirectory` keeps the folder layout in `webkitRelativePath`, which
    // is what lets one drop cover every `<sample>/spatial/...` package.
    input.setAttribute('webkitdirectory', '');
    input.setAttribute('directory', '');
  }, []);

  const readyCount = packages.filter((entry) => entry.status === 'ready').length;
  const errorCount = packages.filter((entry) => entry.status === 'error').length;

  return (
    <Card border='1px solid' borderColor='gray.200' borderRadius='2xl' boxShadow='sm' bg='white'>
      <CardBody p={{ base: 4, xl: 5 }}>
        <Stack spacing={4}>
          <Stack spacing={1}>
            <Text fontSize='lg' fontWeight='semibold'>Import NATA packages</Text>
            <Text fontSize='sm' color='gray.500'>
              Select the folder that contains every <code>&lt;sample&gt;/spatial</code> package, or drop
              the packages (folders or <code>.zip</code>) below. The first package becomes the reference
              image.
            </Text>
          </Stack>

          <HStack spacing={3} wrap='wrap'>
            <Button colorScheme='brand' onClick={() => folderInputRef.current?.click()}>
              Select package folder(s)
            </Button>
            <Button variant='outline' onClick={() => zipInputRef.current?.click()}>
              Select .zip package(s)
            </Button>
            {packages.length > 0 ? (
              <Button variant='ghost' colorScheme='red' onClick={onClear}>Clear all</Button>
            ) : null}
            <input
              ref={folderInputRef}
              type='file'
              multiple
              hidden
              data-testid='batch-folder-input'
              onChange={(event) => {
                if (event.target.files) {
                  onSelectedFiles(selectedFilesFromFileList(event.target.files));
                }
                event.target.value = '';
              }}
            />
            <input
              ref={zipInputRef}
              type='file'
              accept='.zip'
              multiple
              hidden
              data-testid='batch-zip-input'
              onChange={(event) => {
                if (event.target.files) {
                  onSelectedFiles(selectedFilesFromFileList(event.target.files));
                }
                event.target.value = '';
              }}
            />
          </HStack>

          <Box
            border='2px dashed'
            borderColor={isDragging ? 'brand.400' : 'gray.300'}
            bg={isDragging ? 'brand.50' : 'gray.50'}
            borderRadius='xl'
            px={4}
            py={6}
            textAlign='center'
            data-testid='batch-drop-zone'
            onDragOver={(event) => {
              event.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={async (event) => {
              event.preventDefault();
              setIsDragging(false);
              const dropped = await readDroppedBatchFiles(event.dataTransfer);
              if (dropped.length > 0) {
                onSelectedFiles(dropped);
              }
            }}
          >
            <Stack spacing={1}>
              <Text fontWeight='semibold'>Drop NATA package folders or .zip archives here</Text>
              <Text fontSize='sm' color='gray.500'>
                Each package needs <code>tissue_fullres_image.png</code>, <code>tissue_positions.csv</code> and
                <code> scalefactors_json.json</code>.
              </Text>
              <Text fontSize='sm' color='gray.500'>
                Re-importing a package that was already exported here also restores its alignment
                (<code>transform-matrix.csv</code>) and its selection (<code>in_selected</code>), so you can
                continue where you left off.
              </Text>
            </Stack>
          </Box>

          {busyLabel ? (
            <Badge colorScheme='blue' borderRadius='full' px={3} py={1} alignSelf='flex-start'>
              {busyLabel}
            </Badge>
          ) : null}

          {packages.length > 0 ? (
            <Stack spacing={3}>
              <Flex justify='space-between' align='center' wrap='wrap' gap={2}>
                <Text fontWeight='semibold'>
                  {packages.length} package{packages.length === 1 ? '' : 's'} detected
                </Text>
                <HStack spacing={2}>
                  <Badge colorScheme='green' borderRadius='full'>{readyCount} ready</Badge>
                  {errorCount > 0 ? (
                    <Badge colorScheme='red' borderRadius='full'>{errorCount} failed</Badge>
                  ) : null}
                </HStack>
              </Flex>

              <RadioGroup
                value={referencePackageId ?? ''}
                onChange={onReferenceChange}
                data-testid='batch-reference-selector'
              >
                <TableContainer>
                  <Table size='sm'>
                    <Thead>
                      <Tr>
                        <Th w='70px'>Reference</Th>
                        <Th>Package</Th>
                        <Th isNumeric>Fullres</Th>
                        <Th isNumeric>Spots</Th>
                        <Th isNumeric>Spot Ø</Th>
                        <Th>Status</Th>
                      </Tr>
                    </Thead>
                    <Tbody>
                      {packages.map((entry) => (
                        <Tr key={entry.id}>
                          <Td>
                            <Radio
                              value={entry.id}
                              isDisabled={entry.status !== 'ready'}
                              data-testid={`batch-reference-${entry.name}`}
                            />
                          </Td>
                          <Td>
                            <Stack spacing={0}>
                              <Text fontWeight='medium'>{entry.name}</Text>
                              <Text fontSize='xs' color='gray.500'>
                                {entry.status === 'error' && entry.error
                                  ? entry.error
                                  : `${entry.files.length} files`}
                              </Text>
                            </Stack>
                          </Td>
                          <Td isNumeric>
                            {entry.fullresSize
                              ? `${entry.fullresSize.width}×${entry.fullresSize.height}`
                              : '—'}
                          </Td>
                          <Td isNumeric>{formatCount(entry.spots?.length ?? null)}</Td>
                          <Td isNumeric>
                            {entry.spotDiameterFullres ? entry.spotDiameterFullres.toFixed(2) : '—'}
                          </Td>
                          <Td>
                            <Badge colorScheme={statusTone[entry.status]} borderRadius='full'>
                              {entry.status}
                            </Badge>
                          </Td>
                        </Tr>
                      ))}
                    </Tbody>
                  </Table>
                </TableContainer>
              </RadioGroup>
            </Stack>
          ) : (
            <Text fontSize='sm' color='gray.500'>No packages imported yet.</Text>
          )}
        </Stack>
      </CardBody>
    </Card>
  );
}
