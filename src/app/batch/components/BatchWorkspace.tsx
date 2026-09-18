'use client';

import {
  Alert,
  AlertDescription,
  AlertIcon,
  Badge,
  Button,
  Card,
  CardBody,
  Divider,
  Flex,
  HStack,
  Heading,
  Link,
  Radio,
  RadioGroup,
  SimpleGrid,
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
import NextLink from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  DEFAULT_MATRIX_CONVENTION,
  DEFAULT_SIMILARITY_PARAMS,
  normalizeSimilarityParams,
} from '@/lib/batch/affine';
import {
  buildBatchBundleZip,
  buildBatchPackageZip,
  buildPackageExportFileName,
  downloadBlob,
} from '@/lib/batch/exportPackages';
import {
  buildBatchPackage,
  groupSourceFiles,
  readBatchSourceFiles,
  type BatchSelectedFile,
} from '@/lib/batch/importPackages';
import { buildExportInputs, buildTransformMatrixCsv, computeSelection } from '@/lib/batch/pipeline';
import { regionsFromSelectedBarcodes } from '@/lib/batch/resume';
import {
  createRegion,
  mapReferenceRegionsToPackage,
  regionsTouchedByStroke,
} from '@/lib/batch/regions';
import type {
  BatchMatrixConvention,
  BatchMatrixLayout,
  BatchPackage,
  BatchPoint,
  BatchRegion,
  BatchRegionMode,
  BatchSelectionResult,
  BatchSelectionSettings,
  BatchSimilarityParams,
  BatchStepId,
} from '@/types/batch';

import { BatchAlignStage, type BatchAlignTarget } from './BatchAlignStage';
import { BatchImportPanel } from './BatchImportPanel';
import { BatchRegionStage, type BatchRegionTool } from './BatchRegionStage';
import { BatchStepRail, type BatchStepItem } from './BatchStepRail';
import {
  DEFAULT_MATRIX_LAYOUT,
  DEFAULT_SELECTION_SETTINGS,
  createDefaultAlignment,
  hasCustomRegions,
  isDefaultAlignment,
  resolveAlignment,
  resolveAllPackageRegions,
  resolveRegionsForPackage,
} from '../batchState';

const EMPTY_TARGET: BatchAlignTarget = {
  name: 'reference',
  previewUrl: null,
  previewSize: null,
  size: null,
  spots: null,
  spotDiameterFullres: null,
};

const toAlignTarget = (entry: BatchPackage | null | undefined): BatchAlignTarget => (
  entry
    ? {
        name: entry.name,
        previewUrl: entry.previewUrl,
        previewSize: entry.previewSize,
        size: entry.fullresSize,
        spots: entry.spots,
        spotDiameterFullres: entry.spotDiameterFullres,
      }
    : EMPTY_TARGET
);

type Notice = { tone: 'info' | 'success' | 'error'; text: string };

const readyPackages = (packages: readonly BatchPackage[]) =>
  packages.filter((entry) => entry.status === 'ready');

export function BatchWorkspace() {
  const [packages, setPackages] = useState<BatchPackage[]>([]);
  const [referencePackageId, setReferencePackageId] = useState<string | null>(null);
  const [alignments, setAlignments] = useState<Record<string, BatchSimilarityParams>>({});
  const [referenceRegions, setReferenceRegions] = useState<BatchRegion[]>([]);
  const [customRegions, setCustomRegions] = useState<Record<string, BatchRegion[]>>({});
  // Selection settings are fixed defaults: the review step no longer exposes
  // them, so the exported files always use the same, well-defined behaviour.
  const selection: BatchSelectionSettings = DEFAULT_SELECTION_SETTINGS;
  const matrixLayout: BatchMatrixLayout = DEFAULT_MATRIX_LAYOUT;
  const matrixConvention: BatchMatrixConvention = DEFAULT_MATRIX_CONVENTION;
  const [step, setStep] = useState<BatchStepId>('import');
  const [activePackageId, setActivePackageId] = useState<string | null>(null);
  const [regionTool, setRegionTool] = useState<BatchRegionTool>('draw');
  const [regionMode, setRegionMode] = useState<BatchRegionMode>('project');
  const [referenceConfirmed, setReferenceConfirmed] = useState(false);
  const [walkthroughPackageId, setWalkthroughPackageId] = useState<string | null>(null);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const packagesRef = useRef<BatchPackage[]>([]);
  packagesRef.current = packages;

  useEffect(() => () => {
    packagesRef.current.forEach((entry) => {
      if (entry.previewUrl) URL.revokeObjectURL(entry.previewUrl);
    });
  }, []);

  const releasePackages = useCallback((entries: readonly BatchPackage[]) => {
    entries.forEach((entry) => {
      if (entry.previewUrl) URL.revokeObjectURL(entry.previewUrl);
    });
  }, []);

  const importPackages = useCallback(async (selectedFiles: BatchSelectedFile[]) => {
    if (selectedFiles.length === 0) return;

    setNotice(null);
    setBusyLabel('Reading selection…');

    try {
      const { files, archives } = await readBatchSourceFiles(selectedFiles);
      const groups = groupSourceFiles(files);

      if (groups.length === 0) {
        setNotice({
          tone: 'error',
          text: 'No NATA package found. Each package folder needs a tissue_fullres_image.png and a tissue_positions.csv.',
        });
        return;
      }

      const built: BatchPackage[] = [];
      for (const [index, group] of groups.entries()) {
        setBusyLabel(`Preparing ${group.name} (${index + 1}/${groups.length})…`);
        // Sequential decoding keeps peak memory bounded for 6000px PNGs.
        built.push(await buildBatchPackage(group, `batch-${Date.now().toString(36)}-${index}`));
      }

      releasePackages(packagesRef.current);
      setPackages(built);

      const reference = built.find((entry) => entry.status === 'ready') ?? null;
      setReferencePackageId(reference?.id ?? null);

      // A package exported by step 5 carries its alignment (transform-matrix.csv)
      // and its barcode selection (in_selected), so the batch can be resumed
      // instead of drawn from scratch.
      const restoredAlignments: Record<string, BatchSimilarityParams> = {};
      const restoredRegions: Record<string, BatchRegion[]> = {};
      let restoredAlignmentCount = 0;
      let restoredSelectionCount = 0;

      const reconstruct = (entry: BatchPackage) => (
        entry.resume?.selectedBarcodes && entry.spots && entry.fullresSize
          ? regionsFromSelectedBarcodes({
              spots: entry.spots,
              selectedBarcodes: entry.resume.selectedBarcodes,
              size: entry.fullresSize,
              anchorMode: DEFAULT_SELECTION_SETTINGS.anchorMode,
              spotDiameterFullres: entry.spotDiameterFullres,
            })
          : null
      );

      for (const entry of built) {
        restoredAlignments[entry.id] = entry.resume?.alignment ?? createDefaultAlignment();
        if (entry.resume?.alignment) restoredAlignmentCount += 1;

        const regions = reconstruct(entry);
        if (regions) {
          restoredSelectionCount += 1;
          if (entry.id !== reference?.id) {
            restoredRegions[entry.id] = regions;
          }
        }
      }

      const referenceRegionsRestored = reference ? reconstruct(reference) ?? [] : [];
      const resumed = restoredAlignmentCount > 0 || restoredSelectionCount > 0;

      setAlignments(restoredAlignments);
      setCustomRegions(restoredRegions);
      setReferenceRegions(referenceRegionsRestored);
      setActivePackageId(built[0]?.id ?? null);
      setReferenceConfirmed(referenceRegionsRestored.length > 0);

      const firstOther = reference
        ? built.find((entry) => entry.id !== reference.id && entry.status === 'ready')
        : undefined;
      setWalkthroughPackageId(restoredSelectionCount > 0 ? firstOther?.id ?? null : null);

      if (restoredSelectionCount > 0 && referenceRegionsRestored.length > 0) {
        // Every package came back with its own region, which is what per-image
        // mode describes; the review step is still where editing continues.
        setRegionMode('perImage');
      }

      setStep(resumed ? 'imageRegions' : 'align');

      const failed = built.filter((entry) => entry.status === 'error');
      setNotice({
        tone: failed.length > 0 ? 'info' : 'success',
        text: resumed
          ? `Resumed a previous batch result: alignment restored for ${restoredAlignmentCount} package(s) and selections for ${restoredSelectionCount}. Everything stays editable.`
          : failed.length > 0
            ? `Imported ${built.length} package(s); ${failed.length} could not be read.`
            : `Imported ${built.length} package(s)${archives.length > 0 ? ` from ${archives.length} archive(s)` : ''}. Reference: ${reference?.name ?? '—'}.`,
      });
    } catch (error) {
      setNotice({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Unable to import the selected files.',
      });
    } finally {
      setBusyLabel(null);
    }
  }, [releasePackages]);

  const clearAll = useCallback(() => {
    releasePackages(packagesRef.current);
    setPackages([]);
    setReferencePackageId(null);
    setAlignments({});
    setReferenceRegions([]);
    setCustomRegions({});
    setActivePackageId(null);
    setReferenceConfirmed(false);
    setWalkthroughPackageId(null);
    setNotice(null);
    setStep('import');
  }, [releasePackages]);

  const referencePackage = useMemo(
    () => packages.find((entry) => entry.id === referencePackageId) ?? null,
    [packages, referencePackageId],
  );

  const nonReferencePackages = useMemo(
    () => readyPackages(packages).filter((entry) => entry.id !== referencePackageId),
    [packages, referencePackageId],
  );

  const activeAlignPackage = useMemo(() => {
    const found = nonReferencePackages.find((entry) => entry.id === activePackageId);
    return found ?? nonReferencePackages[0] ?? null;
  }, [activePackageId, nonReferencePackages]);

  const activeRegionPackage = useMemo(() => {
    const ready = readyPackages(packages);
    return ready.find((entry) => entry.id === activePackageId) ?? referencePackage ?? ready[0] ?? null;
  }, [activePackageId, packages, referencePackage]);

  const regionsByPackage = useMemo(() => resolveAllPackageRegions({
    packages,
    referencePackageId,
    referenceRegions,
    customRegions,
    alignments,
  }), [alignments, customRegions, packages, referencePackageId, referenceRegions]);

  const selectionByPackage = useMemo(() => {
    const result: Record<string, BatchSelectionResult> = {};

    for (const entry of packages) {
      if (entry.status !== 'ready' || !entry.spots || !entry.fullresSize) continue;

      result[entry.id] = computeSelection({
        spots: entry.spots,
        regions: regionsByPackage[entry.id] ?? [],
        size: entry.fullresSize,
        settings: selection,
        spotDiameterFullres: entry.spotDiameterFullres,
      });
    }

    return result;
  }, [packages, regionsByPackage, selection]);

  const alignedCount = useMemo(
    () => nonReferencePackages.filter((entry) => !isDefaultAlignment(resolveAlignment(alignments, entry.id))).length,
    [alignments, nonReferencePackages],
  );

  const stepItems = useMemo<BatchStepItem[]>(() => {
    const hasPackages = packages.length > 0;
    const hasReference = Boolean(referencePackage);
    const hasRegions = referenceRegions.length > 0;
    // A resumed batch may carry per-image regions without a reference outline.
    const hasAnyRegions = hasRegions || Object.keys(customRegions).length > 0;
    const regionsProjected = hasAnyRegions
      && readyPackages(packages).every((entry) => (regionsByPackage[entry.id]?.length ?? 0) > 0);
    const selectionReady = regionsProjected
      && readyPackages(packages).every((entry) => Boolean(selectionByPackage[entry.id]));
    const annotatable = readyPackages(packages).filter((entry) => entry.id !== referencePackageId);
    const drawnByHand = annotatable.filter((entry) => hasCustomRegions(customRegions, entry.id)).length;
    const isPerImage = regionMode === 'perImage';

    return [
      {
        id: 'import',
        label: 'Import packages',
        description: 'Load n NATA packages.',
        status: hasPackages ? 'complete' : 'idle',
        enabled: true,
        hint: hasPackages ? `${packages.length} package(s) loaded` : 'Select a folder or drop packages',
        testId: 'batch-step-import',
      },
      {
        id: 'align',
        label: 'Align to reference',
        description: 'Rotate and scale every image onto image[0].',
        status: nonReferencePackages.length > 0 && alignedCount === nonReferencePackages.length ? 'complete' : 'ready',
        enabled: nonReferencePackages.length > 0,
        hint: nonReferencePackages.length > 0
          ? `${alignedCount}/${nonReferencePackages.length} aligned`
          : 'Needs at least two ready packages',
        testId: 'batch-step-align',
      },
      {
        id: 'referenceRegion',
        label: isPerImage ? 'Annotate each image' : 'Draw region on image[0]',
        description: isPerImage
          ? 'Draw the reference, confirm it, then outline every image.'
          : 'Annotate the reference image once.',
        status: hasRegions ? 'complete' : 'ready',
        enabled: hasReference,
        hint: !isPerImage
          ? (hasRegions ? `${referenceRegions.length} region(s)` : 'Draw at least one region')
          : referenceConfirmed
            ? `${drawnByHand}/${annotatable.length} drawn by hand`
            : 'Draw the reference, then confirm it',
        testId: 'batch-step-reference-region',
      },
      {
        id: 'imageRegions',
        label: isPerImage ? 'Review each image' : 'Adjust each image',
        description: isPerImage
          ? 'Second pass over the regions you drew.'
          : 'Refine the projected region on every image.',
        status: selectionReady ? 'complete' : 'ready',
        enabled: hasAnyRegions,
        hint: !regionsProjected
          ? 'Waiting for the reference region'
          : isPerImage
            ? 'Editable second pass on step 3'
            : 'Projection from image[0]',
        testId: 'batch-step-image-regions',
      },
      {
        id: 'review',
        label: 'Export packages',
        description: 'Write in_selected and transform-matrix.csv.',
        status: selectionReady ? 'ready' : 'idle',
        enabled: hasAnyRegions,
        hint: 'tissue_positions.csv + transform-matrix.csv',
        testId: 'batch-step-review',
      },
    ];
  }, [
    alignedCount,
    customRegions,
    nonReferencePackages,
    packages,
    referencePackage,
    referenceConfirmed,
    referencePackageId,
    regionMode,
    referenceRegions.length,
    regionsByPackage,
    selectionByPackage,
  ]);

  const updateAlignment = useCallback((packageId: string, params: BatchSimilarityParams) => {
    setAlignments((previous) => ({
      ...previous,
      [packageId]: normalizeSimilarityParams(params),
    }));
  }, []);

  const commitReferenceStroke = useCallback((points: BatchPoint[], tool: BatchRegionTool) => {
    // Any change to the reference invalidates a confirmed walkthrough guide.
    setReferenceConfirmed(false);

    if (tool === 'erase') {
      const touched = regionsTouchedByStroke(referenceRegions, points);
      setReferenceRegions((previous) => previous.filter((region) => !touched.has(region.id)));
      return;
    }

    const region = createRegion(points);
    if (!region) return;
    setReferenceRegions((previous) => [...previous, region]);
  }, [referenceRegions]);

  const updateReferenceRegions = useCallback((
    updater: (previous: BatchRegion[]) => BatchRegion[],
  ) => {
    setReferenceConfirmed(false);
    setReferenceRegions(updater);
  }, []);

  const commitPackageStroke = useCallback((
    packageId: string,
    points: BatchPoint[],
    tool: BatchRegionTool,
  ) => {
    const derived = resolveRegionsForPackage({
      packageId,
      referencePackageId,
      referenceRegions,
      customRegions: {},
      alignments,
    });
    const current = customRegions[packageId] ?? derived;

    if (tool === 'erase') {
      const touched = regionsTouchedByStroke(current, points);
      setCustomRegions((previous) => ({
        ...previous,
        [packageId]: current.filter((region) => !touched.has(region.id)),
      }));
      return;
    }

    const region = createRegion(points);
    if (!region) return;
    setCustomRegions((previous) => ({
      ...previous,
      [packageId]: [...current, region],
    }));
  }, [alignments, customRegions, referencePackageId, referenceRegions]);

  const resetPackageRegions = useCallback((packageId: string) => {
    setCustomRegions((previous) => {
      const next = { ...previous };
      delete next[packageId];
      return next;
    });
  }, []);

  const collectExportInputs = useCallback((subset: readonly BatchPackage[]) => buildExportInputs({
    packages: subset,
    referencePackageId,
    alignments,
    selectionByPackage,
    matrixLayout,
    matrixConvention,
  }), [alignments, matrixConvention, matrixLayout, referencePackageId, selectionByPackage]);

  const handleExportAll = useCallback(async () => {
    setIsExporting(true);
    try {
      const inputs = collectExportInputs(packages);
      for (const input of inputs) {
        const blob = await buildBatchPackageZip(input);
        downloadBlob(blob, buildPackageExportFileName(input.packageName));
        // Sequential downloads stay within the browser's per-gesture limits.
        await new Promise((resolve) => window.setTimeout(resolve, 350));
      }
      setNotice({ tone: 'success', text: `Exported ${inputs.length} package(s).` });
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Export failed.' });
    } finally {
      setIsExporting(false);
    }
  }, [collectExportInputs, packages]);

  const handleExportBundle = useCallback(async () => {
    setIsExporting(true);
    try {
      const inputs = collectExportInputs(packages);
      const blob = await buildBatchBundleZip(inputs);
      downloadBlob(blob, 'nata-batch-selection.zip');
      setNotice({ tone: 'success', text: `Exported ${inputs.length} package(s) as one archive.` });
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Export failed.' });
    } finally {
      setIsExporting(false);
    }
  }, [collectExportInputs, packages]);

  const handleExportOne = useCallback(async (entry: BatchPackage) => {
    setIsExporting(true);
    try {
      const [input] = collectExportInputs([entry]);
      const blob = await buildBatchPackageZip(input);
      downloadBlob(blob, buildPackageExportFileName(input.packageName));
      setNotice({ tone: 'success', text: `Exported ${entry.name}.` });
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Export failed.' });
    } finally {
      setIsExporting(false);
    }
  }, [collectExportInputs]);

  const matrixPreviewByPackage = useMemo(() => {
    const previews: Record<string, string> = {};
    const referenceSize = referencePackage?.fullresSize;
    if (!referenceSize) return previews;

    for (const entry of packages) {
      if (!entry.fullresSize) continue;
      previews[entry.id] = buildTransformMatrixCsv({
        params: resolveAlignment(alignments, entry.id),
        packageSize: entry.fullresSize,
        referenceSize,
        layout: matrixLayout,
        convention: matrixConvention,
      }).trim();
    }

    return previews;
  }, [alignments, matrixConvention, matrixLayout, packages, referencePackage]);

  const activeAlignParams = activeAlignPackage
    ? resolveAlignment(alignments, activeAlignPackage.id)
    : { ...DEFAULT_SIMILARITY_PARAMS };

  const derivedActiveRegions = activeRegionPackage
    ? resolveRegionsForPackage({
        packageId: activeRegionPackage.id,
        referencePackageId,
        referenceRegions,
        customRegions: {},
        alignments,
      })
    : [];
  const activeRegions = activeRegionPackage ? regionsByPackage[activeRegionPackage.id] ?? [] : [];
  const activeIsCustom = activeRegionPackage
    ? hasCustomRegions(customRegions, activeRegionPackage.id)
    : false;

  const walkthroughPackages = nonReferencePackages;

  const walkthroughPackage = useMemo(() => {
    const found = walkthroughPackages.find((entry) => entry.id === walkthroughPackageId);
    return found ?? walkthroughPackages[0] ?? null;
  }, [walkthroughPackageId, walkthroughPackages]);

  const walkthroughParams = walkthroughPackage
    ? resolveAlignment(alignments, walkthroughPackage.id)
    : null;

  const walkthroughOwnRegions = useMemo(
    () => (walkthroughPackage ? regionsByPackage[walkthroughPackage.id] ?? [] : []),
    [regionsByPackage, walkthroughPackage],
  );

  // The drawing panel is a second, independent view: polygons live in that
  // package's own frame, and the reference selection only appears as a dashed
  // projection so the two side-by-side panels can be compared.
  const walkthroughProjectedGuide = useMemo(
    () => (walkthroughParams
      ? mapReferenceRegionsToPackage(referenceRegions, walkthroughParams)
      : []),
    [referenceRegions, walkthroughParams],
  );

  const commitWalkthroughStroke = useCallback((
    points: BatchPoint[],
    tool: BatchRegionTool,
  ) => {
    if (!walkthroughPackage) return;

    const ownRegions = regionsByPackage[walkthroughPackage.id] ?? [];
    const packageId = walkthroughPackage.id;

    if (tool === 'erase') {
      const touched = regionsTouchedByStroke(ownRegions, points);
      setCustomRegions((previous) => ({
        ...previous,
        [packageId]: ownRegions.filter((region) => !touched.has(region.id)),
      }));
      return;
    }

    const created = createRegion(points);
    if (!created) return;

    setCustomRegions((previous) => ({
      ...previous,
      [packageId]: [...ownRegions, created],
    }));
  }, [regionsByPackage, walkthroughPackage]);

  const walkthroughIndex = walkthroughPackage
    ? walkthroughPackages.findIndex((entry) => entry.id === walkthroughPackage.id)
    : -1;

  const stepWalkthrough = useCallback((offset: number) => {
    if (walkthroughIndex < 0) return;
    const next = walkthroughPackages[walkthroughIndex + offset];
    if (next) setWalkthroughPackageId(next.id);
  }, [walkthroughIndex, walkthroughPackages]);

  const renderReferenceStage = (description: string) => (
    <BatchRegionStage
      title={`Draw the selection on ${referencePackage?.name ?? 'the reference image'}`}
      description={description}
      imageUrl={referencePackage?.previewUrl ?? null}
      imageSize={referencePackage?.fullresSize ?? null}
      regions={referenceRegions}
      tool={regionTool}
      onToolChange={setRegionTool}
      spots={referencePackage?.spots ?? null}
      selectedBarcodeSet={
        referencePackage
          ? new Set(selectionByPackage[referencePackage.id]?.selectedBarcodes ?? [])
          : null
      }
      spotDiameterFullres={referencePackage?.spotDiameterFullres ?? null}
      anchorMode={selection.anchorMode}
      onCommitStroke={commitReferenceStroke}
      onUndoRegion={() => updateReferenceRegions((previous) => previous.slice(0, -1))}
      onClearRegions={() => updateReferenceRegions(() => [])}
      testIdPrefix='batch-reference-region'
    />
  );

  return (
    <Stack spacing={6} data-testid='batch-workspace'>
      <Flex justify='space-between' align={{ base: 'flex-start', md: 'center' }} gap={4} wrap='wrap'>
        <Stack spacing={1}>
          <Heading size='lg'>NATA Batch Selection</Heading>
          <Text color='gray.500' maxW='780px'>
            Import n NATA packages, align every full-resolution image to the reference package, annotate the
            reference once, then export each package with a barcode selection column and its transform matrix.
          </Text>
        </Stack>
        <HStack spacing={3}>
          <Link as={NextLink} href='/preprocess' color='brand.600' fontWeight='medium'>Preprocessing</Link>
          <Link as={NextLink} href='/' color='brand.600' fontWeight='medium'>Home</Link>
        </HStack>
      </Flex>

      {notice ? (
        <Alert status={notice.tone} borderRadius='xl' data-testid='batch-notice'>
          <AlertIcon />
          <AlertDescription>{notice.text}</AlertDescription>
        </Alert>
      ) : null}

      <Flex gap={6} align='flex-start' direction={{ base: 'column', lg: 'row' }}>
        <BatchStepRail currentStep={step} items={stepItems} onSelect={setStep} />

        <Stack spacing={4} flex='1' minW={0}>
          {step === 'import' ? (
            <BatchImportPanel
              packages={packages}
              referencePackageId={referencePackageId}
              busyLabel={busyLabel}
              onReferenceChange={setReferencePackageId}
              onSelectedFiles={importPackages}
              onClear={clearAll}
            />
          ) : null}

          {step === 'align' ? (
            <Card border='1px solid' borderColor='gray.200' borderRadius='2xl' boxShadow='sm' bg='white'>
              <CardBody p={{ base: 4, xl: 5 }}>
                <Stack spacing={4}>
                  <Flex justify='space-between' align={{ base: 'flex-start', md: 'center' }} gap={3} wrap='wrap'>
                    <Stack spacing={1}>
                      <Text fontSize='lg' fontWeight='semibold'>
                        Align every image to {referencePackage?.name ?? 'the reference'}
                      </Text>
                      <Text fontSize='sm' color='gray.500'>
                        Rotate, scale and shift each overlay until it matches the reference, then move on to the next package.
                      </Text>
                    </Stack>
                    <HStack spacing={2}>
                      <Badge
                        colorScheme={nonReferencePackages.length > 0 && alignedCount === nonReferencePackages.length ? 'green' : 'orange'}
                        borderRadius='full'
                      >
                        {alignedCount}/{nonReferencePackages.length} aligned
                      </Badge>
                      <Button
                        size='sm'
                        variant='outline'
                        onClick={() => setAlignments(Object.fromEntries(
                          packages.map((entry) => [entry.id, createDefaultAlignment()]),
                        ))}
                      >
                        Reset all
                      </Button>
                    </HStack>
                  </Flex>

                  <SimpleGrid columns={{ base: 1, md: 3, xl: 4 }} spacing={2}>
                    {nonReferencePackages.map((entry) => {
                      const params = resolveAlignment(alignments, entry.id);
                      const isActive = entry.id === activeAlignPackage?.id;
                      const aligned = !isDefaultAlignment(params);

                      return (
                        <Button
                          key={entry.id}
                          size='sm'
                          h='auto'
                          py={2}
                          justifyContent='space-between'
                          variant={isActive ? 'solid' : 'outline'}
                          colorScheme={isActive ? 'brand' : 'gray'}
                          onClick={() => setActivePackageId(entry.id)}
                        >
                          <Stack spacing={0} align='flex-start'>
                            <Text fontSize='sm' fontWeight='semibold'>{entry.name}</Text>
                            <Text fontSize='xs' opacity={0.75}>
                              {params.rotationDegrees.toFixed(1)}° · {params.scale.toFixed(3)}×
                            </Text>
                          </Stack>
                          <Badge ml={2} colorScheme={aligned ? 'green' : 'gray'} borderRadius='full'>
                            {aligned ? 'set' : 'identity'}
                          </Badge>
                        </Button>
                      );
                    })}
                  </SimpleGrid>

                  {activeAlignPackage ? (
                    <>
                      <Divider />
                      <BatchAlignStage
                        reference={toAlignTarget(referencePackage)}
                        moving={toAlignTarget(activeAlignPackage)}
                        params={activeAlignParams}
                        anchorMode={selection.anchorMode}
                        matrixConvention={matrixConvention}
                        onParamsChange={(params) => updateAlignment(activeAlignPackage.id, params)}
                      />
                      <HStack spacing={3} wrap='wrap'>
                        <Button
                          size='sm'
                          variant='outline'
                          onClick={() => setAlignments((previous) => {
                            const next = { ...previous };
                            nonReferencePackages.forEach((entry) => {
                              next[entry.id] = normalizeSimilarityParams(activeAlignParams);
                            });
                            return next;
                          })}
                        >
                          Apply this transform to all images
                        </Button>
                        <Button
                          size='sm'
                          variant='ghost'
                          onClick={() => updateAlignment(activeAlignPackage.id, createDefaultAlignment())}
                        >
                          Reset this image
                        </Button>
                        <Button
                          size='sm'
                          colorScheme='brand'
                          variant='ghost'
                          onClick={() => {
                            const index = nonReferencePackages.findIndex((entry) => entry.id === activeAlignPackage.id);
                            const next = nonReferencePackages[index + 1];
                            if (next) setActivePackageId(next.id);
                          }}
                        >
                          Next image →
                        </Button>
                      </HStack>
                    </>
                  ) : (
                    <Text fontSize='sm' color='gray.500'>Import at least two ready packages to align.</Text>
                  )}
                </Stack>
              </CardBody>
            </Card>
          ) : null}

          {step === 'referenceRegion' ? (
            <Card border='1px solid' borderColor='gray.200' borderRadius='2xl' boxShadow='sm' bg='white'>
              <CardBody p={{ base: 4, xl: 5 }}>
                <Stack spacing={4}>
                  <Stack spacing={2}>
                    <Text fontSize='lg' fontWeight='semibold'>Selection mode</Text>
                    <RadioGroup
                      value={regionMode}
                      onChange={(value) => setRegionMode(value === 'perImage' ? 'perImage' : 'project')}
                      data-testid='batch-region-mode'
                    >
                      <Stack spacing={3}>
                        <Radio value='project' alignItems='flex-start'>
                          <Stack spacing={0}>
                            <Text>Project one region — draw on the reference, apply it to every image</Text>
                            <Text fontSize='xs' color='gray.500'>
                              Fastest when all sections cover the same tissue. Per-image tweaks stay available
                              in step 4.
                            </Text>
                          </Stack>
                        </Radio>
                        <Radio value='perImage' alignItems='flex-start'>
                          <Stack spacing={0}>
                            <Text>Annotate each image — confirm the reference, then draw on every image in turn</Text>
                            <Text fontSize='xs' color='gray.500'>
                              The confirmed reference outline stays on screen as a dashed guide while you outline
                              each package you aligned in step 2.
                            </Text>
                          </Stack>
                        </Radio>
                      </Stack>
                    </RadioGroup>
                  </Stack>

                  <Divider />

                  {regionMode === 'project' ? (
                    <>
                      {renderReferenceStage(
                        'Freehand-draw the tissue area to keep. This region is projected onto every other package in the next step.',
                      )}
                      {referencePackage ? (
                        <HStack spacing={3} wrap='wrap'>
                          <Badge colorScheme='green' borderRadius='full'>
                            {selectionByPackage[referencePackage.id]?.selectedBarcodes.length ?? 0} barcodes inside the region
                          </Badge>
                          <Badge colorScheme='gray' borderRadius='full'>
                            {referencePackage.spots?.length ?? 0} barcodes in the package
                          </Badge>
                        </HStack>
                      ) : null}
                    </>
                  ) : null}

                  {regionMode === 'perImage' && !referenceConfirmed ? (
                    <>
                      {renderReferenceStage(
                        'Draw the reference region, then confirm it. The confirmed outline becomes the guide for every other image.',
                      )}
                      <HStack spacing={3} wrap='wrap'>
                        <Button
                          colorScheme='brand'
                          isDisabled={referenceRegions.length === 0}
                          data-testid='batch-confirm-reference'
                          onClick={() => {
                            setReferenceConfirmed(true);
                            if (!walkthroughPackageId) {
                              setWalkthroughPackageId(nonReferencePackages[0]?.id ?? null);
                            }
                          }}
                        >
                          Confirm reference region
                        </Button>
                        {referenceRegions.length === 0 ? (
                          <Text fontSize='sm' color='gray.500'>Draw at least one region first.</Text>
                        ) : (
                          <Text fontSize='sm' color='gray.500'>
                            {referenceRegions.length} region(s) ready to confirm.
                          </Text>
                        )}
                      </HStack>
                    </>
                  ) : null}

                  {regionMode === 'perImage' && referenceConfirmed ? (
                    <Stack spacing={4}>
                      <Flex justify='space-between' align={{ base: 'flex-start', md: 'center' }} gap={3} wrap='wrap'>
                        <Stack spacing={1}>
                          <Text fontSize='lg' fontWeight='semibold'>Annotate each image</Text>
                          <Text fontSize='sm' color='gray.500'>
                            Reference confirmed with {referenceRegions.length} region(s); it stays as the dashed
                            guide while you draw on each package.
                          </Text>
                        </Stack>
                        <HStack spacing={3} wrap='wrap'>
                          <Text fontSize='sm' color='gray.500'>
                            Two independent panels: the reference stays fixed on the left, the image you draw on
                            can be zoomed freely on the right.
                          </Text>
                          <Button variant='ghost' size='sm' onClick={() => setReferenceConfirmed(false)}>
                            Back to reference
                          </Button>
                        </HStack>
                      </Flex>

                      <SimpleGrid columns={{ base: 2, md: 4, xl: 6 }} spacing={2}>
                        <Button size='sm' h='auto' py={2} variant='outline' isDisabled colorScheme='gray'>
                          <Stack spacing={0} align='flex-start'>
                            <Text fontSize='sm' fontWeight='semibold'>{referencePackage?.name ?? 'reference'}</Text>
                            <Text fontSize='xs' opacity={0.75}>reference</Text>
                          </Stack>
                        </Button>
                        {walkthroughPackages.map((entry) => {
                          const isActive = entry.id === walkthroughPackage?.id;
                          const edited = hasCustomRegions(customRegions, entry.id);
                          return (
                            <Button
                              key={entry.id}
                              size='sm'
                              h='auto'
                              py={2}
                              variant={isActive ? 'solid' : 'outline'}
                              colorScheme={isActive ? 'brand' : 'gray'}
                              onClick={() => setWalkthroughPackageId(entry.id)}
                            >
                              <Stack spacing={0} align='flex-start'>
                                <Text fontSize='sm' fontWeight='semibold'>{entry.name}</Text>
                                <Text fontSize='xs' opacity={0.75}>
                                  {edited ? 'drawn' : 'projected'} · {selectionByPackage[entry.id]?.selectedBarcodes.length ?? 0}
                                </Text>
                              </Stack>
                            </Button>
                          );
                        })}
                      </SimpleGrid>

                      {walkthroughPackage ? (
                        <>
                            <SimpleGrid columns={{ base: 1, xl: 2 }} spacing={4} alignItems='start'>
                              <BatchRegionStage
                                title={`Reference — ${referencePackage?.name ?? ''}`}
                                description='Locked reference view. Use it to compare shape and position while you draw on the right.'
                                imageUrl={referencePackage?.previewUrl ?? null}
                                imageSize={referencePackage?.fullresSize ?? null}
                                regions={referenceRegions}
                                spots={referencePackage?.spots ?? null}
                                selectedBarcodeSet={
                                  referencePackage
                                    ? new Set(selectionByPackage[referencePackage.id]?.selectedBarcodes ?? [])
                                    : null
                                }
                                spotDiameterFullres={referencePackage?.spotDiameterFullres ?? null}
                                anchorMode={selection.anchorMode}
                                locked
                                interactive={false}
                                testIdPrefix='batch-walkthrough-reference'
                              />

                              <BatchRegionStage
                                title={`${walkthroughPackage.name} — ${walkthroughIndex + 1}/${walkthroughPackages.length}`}
                                description='Draw the tissue area for this image. The dashed outline is the reference region projected into it; zoom with the wheel while the pointer is over the image.'
                                imageUrl={walkthroughPackage.previewUrl}
                                imageSize={walkthroughPackage.fullresSize}
                                regions={walkthroughOwnRegions}
                                overlayRegions={walkthroughProjectedGuide}
                                overlayLabel='Reference guide'
                                tool={regionTool}
                                onToolChange={setRegionTool}
                                spots={walkthroughPackage.spots}
                                selectedBarcodeSet={selectionByPackage[walkthroughPackage.id]?.selectedBarcodeSet ?? null}
                                spotDiameterFullres={walkthroughPackage.spotDiameterFullres}
                                anchorMode={selection.anchorMode}
                                onCommitStroke={commitWalkthroughStroke}
                                onUndoRegion={() => setCustomRegions((previous) => ({
                                  ...previous,
                                  [walkthroughPackage.id]: walkthroughOwnRegions.slice(0, -1),
                                }))}
                                onClearRegions={() => setCustomRegions((previous) => ({
                                  ...previous,
                                  [walkthroughPackage.id]: [],
                                }))}
                                testIdPrefix='batch-walkthrough-draw'
                              />
                            </SimpleGrid>

                            <Text fontSize='sm' color='gray.500'>
                              {walkthroughIndex + 1} / {walkthroughPackages.length} — strokes on the right panel are
                              stored in {walkthroughPackage.name}&apos;s own coordinates, so the left reference stays
                              untouched.
                            </Text>

                          <Flex justify='space-between' align='center' gap={3} wrap='wrap'>
                            <HStack spacing={3} wrap='wrap'>
                              <Button
                                size='sm'
                                variant='outline'
                                isDisabled={walkthroughIndex <= 0}
                                onClick={() => stepWalkthrough(-1)}
                              >
                                ← Previous image
                              </Button>
                              <Button
                                size='sm'
                                variant='outline'
                                isDisabled={walkthroughIndex >= walkthroughPackages.length - 1}
                                onClick={() => stepWalkthrough(1)}
                              >
                                Next image →
                              </Button>
                                <Button
                                  size='sm'
                                  variant='ghost'
                                  isDisabled={!hasCustomRegions(customRegions, walkthroughPackage.id)}
                                  onClick={() => resetPackageRegions(walkthroughPackage.id)}
                                >
                                  Use the projected region
                                </Button>
                                <Button
                                  size='sm'
                                  variant='ghost'
                                  isDisabled={walkthroughOwnRegions.length === 0}
                                  data-testid='batch-walkthrough-undo'
                                  onClick={() => setCustomRegions((previous) => ({
                                    ...previous,
                                    [walkthroughPackage.id]: walkthroughOwnRegions.slice(0, -1),
                                  }))}
                                >
                                  Undo region
                                </Button>
                                <Button
                                  size='sm'
                                  variant='ghost'
                                  isDisabled={walkthroughOwnRegions.length === 0}
                                  onClick={() => setCustomRegions((previous) => ({
                                    ...previous,
                                    [walkthroughPackage.id]: [],
                                  }))}
                                >
                                  Clear regions
                                </Button>
                            </HStack>
                            <HStack spacing={3} wrap='wrap'>
                              <Badge colorScheme='green' borderRadius='full'>
                                {selectionByPackage[walkthroughPackage.id]?.selectedBarcodes.length ?? 0} barcodes selected
                              </Badge>
                              <Badge colorScheme='gray' borderRadius='full'>
                                {walkthroughPackage.spots?.length ?? 0} barcodes in the package
                              </Badge>
                            </HStack>
                          </Flex>
                        </>
                      ) : (
                        <Text fontSize='sm' color='gray.500'>
                          Import at least two ready packages to annotate them individually.
                        </Text>
                      )}
                    </Stack>
                  ) : null}
                </Stack>
              </CardBody>
            </Card>
          ) : null}

          {step === 'imageRegions' ? (
            <Card border='1px solid' borderColor='gray.200' borderRadius='2xl' boxShadow='sm' bg='white'>
              <CardBody p={{ base: 4, xl: 5 }}>
                <Stack spacing={4}>
                  <Stack spacing={1}>
                    <Text fontSize='lg' fontWeight='semibold'>
                      {regionMode === 'perImage'
                        ? 'Second pass: review every image'
                        : 'Adjust the projected region per image'}
                    </Text>
                    <Text fontSize='sm' color='gray.500'>
                      {regionMode === 'perImage'
                        ? 'Every package keeps the region you drew in step 3. Open one to double-check it, or touch it up here — edits stay on that image only.'
                        : 'Step 3 projected the reference region onto every package. Open one to adjust it for that image alone.'}
                    </Text>
                  </Stack>

                  <SimpleGrid columns={{ base: 1, md: 3, xl: 4 }} spacing={2}>
                    {readyPackages(packages).map((entry) => {
                      const isActive = entry.id === activeRegionPackage?.id;
                      const custom = hasCustomRegions(customRegions, entry.id);

                      return (
                        <Button
                          key={entry.id}
                          size='sm'
                          h='auto'
                          py={2}
                          justifyContent='space-between'
                          variant={isActive ? 'solid' : 'outline'}
                          colorScheme={isActive ? 'brand' : 'gray'}
                          onClick={() => setActivePackageId(entry.id)}
                        >
                          <Stack spacing={0} align='flex-start'>
                            <Text fontSize='sm' fontWeight='semibold'>{entry.name}</Text>
                            <Text fontSize='xs' opacity={0.75}>
                              {custom ? 'drawn' : 'projected'} · {selectionByPackage[entry.id]?.selectedBarcodes.length ?? 0}
                            </Text>
                          </Stack>
                        </Button>
                      );
                    })}
                  </SimpleGrid>

                  {activeRegionPackage ? (
                    <>
                      <Divider />
                      <HStack spacing={3} wrap='wrap'>
                        <Text fontSize='sm' color='gray.500'>
                          {activeIsCustom
                            ? 'Solid green is the region kept for this image; the dashed outline is the projection from the reference, kept for comparison.'
                            : regionMode === 'perImage'
                              ? 'This image still holds the region you drew in step 3. Drawing here overrides it for this image only.'
                              : 'This image still uses the region projected from the reference. Drawing here overrides it for this image only.'}
                        </Text>
                        {activeIsCustom ? (
                          <Button size='xs' variant='outline' onClick={() => resetPackageRegions(activeRegionPackage.id)}>
                            Reset to reference
                          </Button>
                        ) : null}
                      </HStack>
                      <BatchRegionStage
                        title={activeRegionPackage.name}
                        description='Confirm the projected region. Draw or erase only if this image needs its own boundary.'
                        imageUrl={activeRegionPackage.previewUrl}
                        imageSize={activeRegionPackage.fullresSize}
                        regions={activeRegions}
                        overlayRegions={activeIsCustom ? derivedActiveRegions : []}
                        tool={regionTool}
                        onToolChange={setRegionTool}
                        spots={activeRegionPackage.spots}
                        selectedBarcodeSet={selectionByPackage[activeRegionPackage.id]?.selectedBarcodeSet ?? null}
                        spotDiameterFullres={activeRegionPackage.spotDiameterFullres}
                        anchorMode={selection.anchorMode}
                        onCommitStroke={(points, tool) => commitPackageStroke(activeRegionPackage.id, points, tool)}
                        onClearRegions={() => setCustomRegions((previous) => ({
                          ...previous,
                          [activeRegionPackage.id]: [],
                        }))}
                        testIdPrefix='batch-image-region'
                      />
                    </>
                  ) : (
                    <Text fontSize='sm' color='gray.500'>Import packages first.</Text>
                  )}
                </Stack>
              </CardBody>
            </Card>
          ) : null}

          {step === 'review' ? (
            <Stack spacing={4}>
              <Card border='1px solid' borderColor='gray.200' borderRadius='2xl' boxShadow='sm' bg='white'>
                <CardBody p={{ base: 4, xl: 5 }}>
                  <Stack spacing={4}>
                    <Flex justify='space-between' align={{ base: 'flex-start', md: 'center' }} gap={3} wrap='wrap'>
                      <Stack spacing={1}>
                        <Text fontSize='lg' fontWeight='semibold'>Export</Text>
                        <Text fontSize='sm' color='gray.500'>
                          Every package keeps its original files; only tissue_positions.csv gains
                          <code> in_selected</code> and transform-matrix.csv is added.
                          A barcode counts as selected as soon as its spot square — anchored at the
                          <code> pxl_*</code> top-left corner — touches the drawn region, and the matrix is
                          written in each package&apos;s own frame as 2×3 rows.
                        </Text>
                      </Stack>
                      <HStack spacing={3} wrap='wrap'>
                        <Button
                          colorScheme='brand'
                          isLoading={isExporting}
                          onClick={handleExportAll}
                          data-testid='batch-export-all'
                        >
                          Download {packages.length} package(s)
                        </Button>
                        <Button variant='outline' isLoading={isExporting} onClick={handleExportBundle}>
                          Download as one archive
                        </Button>
                      </HStack>
                    </Flex>

                    <TableContainer>
                      <Table size='sm'>
                        <Thead>
                          <Tr>
                            <Th>Package</Th>
                            <Th isNumeric>Barcodes</Th>
                            <Th isNumeric>in_selected</Th>
                            <Th>
                              transform-matrix.csv → {matrixConvention === 'reference-frame'
                                ? `${referencePackage?.name ?? 'reference'} px`
                                : 'own-size px'}
                            </Th>
                            <Th />
                          </Tr>
                        </Thead>
                        <Tbody>
                          {packages.map((entry) => (
                            <Tr key={entry.id}>
                              <Td>
                                <Stack spacing={0}>
                                  <Text fontWeight='medium'>{entry.name}</Text>
                                  <Text fontSize='xs' color='gray.500'>
                                    {entry.fullresSize
                                      ? `${entry.fullresSize.width}×${entry.fullresSize.height} px`
                                      : '—'}
                                  </Text>
                                </Stack>
                              </Td>
                              <Td isNumeric>{entry.spots?.length.toLocaleString('en-US') ?? '—'}</Td>
                              <Td isNumeric>{selectionByPackage[entry.id]?.selectedBarcodes.length.toLocaleString('en-US') ?? '—'}</Td>
                              <Td>
                                <Text fontFamily='mono' fontSize='xs' whiteSpace='pre-wrap'>
                                  {matrixPreviewByPackage[entry.id] ?? '—'}
                                </Text>
                              </Td>
                              <Td>
                                <Button
                                  size='xs'
                                  variant='outline'
                                  isDisabled={entry.status !== 'ready'}
                                  onClick={() => handleExportOne(entry)}
                                >
                                  Download
                                </Button>
                              </Td>
                            </Tr>
                          ))}
                        </Tbody>
                      </Table>
                    </TableContainer>
                  </Stack>
                </CardBody>
              </Card>
            </Stack>
          ) : null}
        </Stack>
      </Flex>
    </Stack>
  );
}
