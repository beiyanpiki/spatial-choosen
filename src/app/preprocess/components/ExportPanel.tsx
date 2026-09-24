'use client';

import {
  Badge,
  Box,
  Button,
  Card,
  CardBody,
  Checkbox,
  Flex,
  HStack,
  Icon,
  SimpleGrid,
  Stack,
  Text,
} from '@chakra-ui/react';

type ExportPanelProps = {
  includeProject: boolean;
  onToggleIncludeProject: (value: boolean) => void;
  onDownload: () => void;
  isExporting: boolean;
  canExport: boolean;
  blockedReason?: string | null;
  isStale?: boolean;
  lastExportedAt?: string | null;
  includeAlignedImage?: boolean;
  roiSummary?: string | null;
  chipSummary?: string | null;
  tissueSummary?: string | null;
  outputFileName?: string | null;
};

function SectionLabel({ children }: { children: string }) {
  return (
    <Text fontSize="xs" textTransform="uppercase" letterSpacing="0.12em" color="gray.500">
      {children}
    </Text>
  );
}

function IncludedItem({ label, included }: { label: string; included?: boolean }) {
  return (
    <HStack spacing={2} align="flex-start">
      <Text
        as="span"
        color={included === false ? 'gray.300' : 'green.500'}
        fontSize="sm"
        lineHeight={1.4}
        aria-hidden="true"
      >
        ✓
      </Text>
      <Text fontSize="sm" color={included === false ? 'gray.400' : 'gray.700'}>
        {label}
      </Text>
    </HStack>
  );
}

function SummaryStat({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <HStack spacing={2}>
      <Text fontSize="sm" color="gray.600">
        {label}
      </Text>
      <Text fontSize="sm" fontWeight="semibold" data-testid={testId}>
        {value}
      </Text>
    </HStack>
  );
}

export function ExportPanel({
  includeProject,
  onToggleIncludeProject,
  onDownload,
  isExporting,
  canExport,
  blockedReason = null,
  isStale = false,
  lastExportedAt = null,
  includeAlignedImage = true,
  roiSummary = null,
  chipSummary = null,
  tissueSummary = null,
  outputFileName = null,
}: ExportPanelProps) {
  const hasExported = Boolean(lastExportedAt);
  const status = isExporting
    ? { label: 'Exporting', colorScheme: 'orange' }
    : !canExport
      ? { label: 'Blocked', colorScheme: 'orange' }
      : isStale && hasExported
        ? { label: 'Updates pending', colorScheme: 'yellow' }
        : { label: 'Ready', colorScheme: 'green' };

  const summaryStats = [
    { label: 'Registered ROI', value: roiSummary, testId: 'export-stat-roi' },
    { label: 'Chip grid', value: chipSummary, testId: 'export-stat-chip' },
    { label: 'Tissue spots', value: tissueSummary, testId: 'export-stat-tissue' },
  ].filter((stat): stat is { label: string; value: string; testId: string } =>
    Boolean(stat.value),
  );

  return (
    <Card
      border="1px solid"
      borderColor="gray.200"
      borderRadius="2xl"
      boxShadow="sm"
      bg="white"
      maxW="720px"
    >
      <CardBody p={0}>
        <Stack spacing={0} divider={<Box h="1px" bg="gray.100" />}>
          <Stack px={6} py={5} spacing={3}>
            <Flex
              justify="space-between"
              align={{ base: 'flex-start', md: 'center' }}
              gap={3}
              wrap="wrap"
            >
              <Stack spacing={2} flex="1" minW={0}>
                <SectionLabel>Export Preprocessing Package</SectionLabel>
                <HStack spacing={3} wrap="wrap">
                  {summaryStats.map((stat) => (
                    <SummaryStat
                      key={stat.label}
                      label={stat.label}
                      value={stat.value}
                      testId={stat.testId}
                    />
                  ))}
                </HStack>
              </Stack>
              <Badge
                colorScheme={status.colorScheme}
                borderRadius="full"
                px={2.5}
                py={1}
                flexShrink={0}
                data-testid="export-status-badge"
              >
                {status.label}
              </Badge>
            </Flex>
          </Stack>

          <Stack px={6} py={5} spacing={3}>
            <SectionLabel>Package contents</SectionLabel>
            <Text color="gray.600">
              Download the preprocessing results required for downstream analysis in
              NATA Insight Bioinformatics Software.
            </Text>
            <SimpleGrid columns={{ base: 1, md: 2 }} spacing={2}>
              <IncludedItem label="Registered H&E crop (full-res, hires, lowres)" />
              <IncludedItem label="Aligned tissue image (registered overlay)" included={includeAlignedImage} />
              <IncludedItem label="Eosin reference crop" />
              <IncludedItem label="Tissue selection matrix (CSV)" />
              <IncludedItem label="Spot projection metadata (JSON)" />
              <IncludedItem
                label="NATAScope project file"
                included={includeProject}
              />
            </SimpleGrid>
          </Stack>

          <Stack px={6} py={4} spacing={2}>
            <SectionLabel>Options</SectionLabel>
            <Box
              p={3}
              border="1px solid"
              borderColor="gray.200"
              borderRadius="lg"
              bg="gray.50"
            >
              <Checkbox
                isChecked={includeProject}
                onChange={(event) => onToggleIncludeProject(event.target.checked)}
                data-testid='export-include-project'
              >
                Include NATAScope project file
              </Checkbox>
              <Text fontSize="xs" color="gray.500" mt={1} ms={6}>
                Adds project.json with the source images so this session can be
                restored later.
              </Text>
            </Box>
          </Stack>

          <Stack px={6} py={5} spacing={3}>
            {blockedReason && !canExport ? (
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
                data-testid="export-blocked-reason"
              >
                <Text aria-hidden="true" fontSize="md" lineHeight={1.3}>
                  ⚠️
                </Text>
                <Text fontSize="sm" color="orange.600">
                  {blockedReason}
                </Text>
              </Flex>
            ) : null}
            {isStale && hasExported ? (
              <Flex
                gap={2}
                align="flex-start"
                border="1px solid"
                borderColor="yellow.200"
                borderLeftWidth="4px"
                borderRadius="md"
                bg="yellow.50"
                px={3}
                py={2.5}
                data-testid="export-stale-notice"
              >
                <Text aria-hidden="true" fontSize="md" lineHeight={1.3}>
                  🕒
                </Text>
                <Stack spacing={0.5}>
                  <Text fontSize="sm" fontWeight="semibold" color="yellow.700">
                    Results changed since the last export
                  </Text>
                  <Text fontSize="sm" color="yellow.700">
                    Download the package again to hand the latest data to downstream
                    analysis.
                  </Text>
                </Stack>
              </Flex>
            ) : null}
            <Button
              colorScheme='brand'
              onClick={onDownload}
              isLoading={isExporting}
              loadingText='Preparing package'
              isDisabled={!canExport}
              w="100%"
              leftIcon={
                <Icon
                  viewBox="0 0 16 16"
                  boxSize={4}
                  aria-hidden="true"
                >
                  <path
                    fill="currentColor"
                    d="M8 1a1 1 0 0 1 1 1v6.586l2.293-2.293a1 1 0 1 1 1.414 1.414l-4 4a1 1 0 0 1-1.414 0l-4-4a1 1 0 1 1 1.414-1.414L7 8.586V2a1 1 0 0 1 1-1ZM2 13a1 1 0 0 1 1-1h10a1 1 0 1 1 0 2H3a1 1 0 0 1-1-1Z"
                  />
                </Icon>
              }
              data-testid='export-download-zip'
            >
              Download package
            </Button>
            {outputFileName ? (
              <Text
                fontSize="xs"
                color="gray.500"
                fontFamily="mono"
                textAlign="center"
                data-testid="export-output-file-name"
              >
                {outputFileName}
              </Text>
            ) : null}
            {lastExportedAt ? (
              <Text fontSize="xs" color="gray.500" textAlign="center" data-testid="export-last-exported">
                Last exported:{' '}
                {new Date(lastExportedAt).toLocaleString()}
              </Text>
            ) : null}
          </Stack>
        </Stack>
      </CardBody>
    </Card>
  );
}
