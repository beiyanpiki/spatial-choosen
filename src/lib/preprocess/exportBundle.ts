import JSZip from 'jszip';
import type { PreprocessProject, ProjectedSpot } from '@/types/preprocess';
import { getPreprocessPackageSourceEntries, serializePreprocessProject } from './package';
import {
  getProjectedSpotFullresCsvCoordinates,
  resolveAuthoritativeSpotDiameterFullres,
} from './spotProjection';
import { deriveSelectedSpotIdsFromRegions } from './tissueRegions';

const FIDUCIAL_DIAMETER_FULLRES = 0.027;

type PreprocessExportReadiness =
  | {
      canExport: false;
      reason: string;
    }
  | {
      canExport: true;
      data: {
        cropWidth: number;
        cropHeight: number;
        heCropAssets: {
          fullres: { dataUrl: string };
          hires: { dataUrl: string };
          lowres: { dataUrl: string };
        };
        projectedSpots: ProjectedSpot[];
        rows: number;
        columns: number;
        selectedSpotIds: Set<string>;
        spotDiameterFullres: number;
        tissueHiresScale: number;
        tissueLowresScale: number;
      };
    };

const dataUrlToBytes = (dataUrl: string) => {
  const [meta, payload] = dataUrl.split(',', 2);
  if (!meta || !payload) throw new Error('Invalid data URL payload');
  const binary = atob(payload);
  const buffer = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    buffer[index] = binary.charCodeAt(index);
  }
  return buffer;
};

const toCsv = (projectedSpots: ProjectedSpot[], selectedSpotIds: Set<string>, cropWidth: number, cropHeight: number) => {
  const lines = [
    'barcode,in_tissue,array_row,array_col,pxl_row_in_fullres,pxl_col_in_fullres',
  ];

  for (const spot of projectedSpots) {
    const coordinates = getProjectedSpotFullresCsvCoordinates({
      spot,
      cropWidth,
      cropHeight,
    });

    lines.push([
      spot.barcode,
      selectedSpotIds.has(spot.id) ? '1' : '0',
      String(spot.arrayRow),
      String(spot.arrayCol),
      String(coordinates.pxl_row_in_fullres),
      String(coordinates.pxl_col_in_fullres),
    ].join(','));
  }

  return `${lines.join('\n')}\n`;
};

const toMatrixCsv = (projectedSpots: ProjectedSpot[], selectedSpotIds: Set<string>, rows: number, columns: number) => {
  const matrix = Array.from({ length: rows }, () => Array.from({ length: columns }, () => '0'));

  for (const spot of projectedSpots) {
    const rowIndex = spot.arrayRow - 1;
    const columnIndex = spot.arrayCol - 1;
    if (rowIndex < 0 || rowIndex >= rows || columnIndex < 0 || columnIndex >= columns) {
      continue;
    }

    matrix[rowIndex][columnIndex] = selectedSpotIds.has(spot.id) ? '1' : '0';
  }

  return `${matrix.map((row) => row.join(',')).join('\n')}\n`;
};

export function getPreprocessZipExportReadiness(project: PreprocessProject): PreprocessExportReadiness {
  if (project.cropQc.status !== 'complete' || project.cropQc.isStale) {
    return {
      canExport: false,
      reason: 'Crop/QC output is stale or incomplete. Re-run Crop/QC and accept it before export.',
    };
  }

  const cropWidth = project.cropQc.cropWidth;
  const cropHeight = project.cropQc.cropHeight;
  if (typeof cropWidth !== 'number' || cropWidth <= 0 || typeof cropHeight !== 'number' || cropHeight <= 0) {
    return {
      canExport: false,
      reason: 'Crop dimensions are missing. Re-run Crop/QC before export.',
    };
  }

  const cropAssets = project.cropQc.cropAssets;
  const heFullres = cropAssets?.he?.fullres?.dataUrl;
  const heHires = cropAssets?.he?.hires?.dataUrl;
  const heLowres = cropAssets?.he?.lowres?.dataUrl;
  if (!heFullres || !heHires || !heLowres) {
    return {
      canExport: false,
      reason: 'Canonical HE crop assets are missing. Re-run Crop/QC before export.',
    };
  }

  const tissueHiresScale = project.cropQc.tissue_hires_scalef;
  const tissueLowresScale = project.cropQc.tissue_lowres_scalef;
  if (
    typeof tissueHiresScale !== 'number'
    || !Number.isFinite(tissueHiresScale)
    || tissueHiresScale <= 0
    || typeof tissueLowresScale !== 'number'
    || !Number.isFinite(tissueLowresScale)
    || tissueLowresScale <= 0
  ) {
    return {
      canExport: false,
      reason: 'Scale metadata is missing. Re-run Crop/QC before export.',
    };
  }

  if (project.chipConfig.status !== 'complete' || project.chipConfig.isStale) {
    return {
      canExport: false,
      reason: 'Chip projection is stale or incomplete. Reapply chip configuration before export.',
    };
  }

  const projectedSpots = project.chipConfig.projectedSpots;
  const rows = project.chipConfig.rows;
  const columns = project.chipConfig.columns;
  const spotDiameterFullres = resolveAuthoritativeSpotDiameterFullres({
    persistedSpotDiameterFullres: project.cropQc.spot_diameter_fullres,
    projectedSpots,
    cropWidth,
    cropHeight,
  });
  if (
    !projectedSpots
    || projectedSpots.length === 0
    || typeof rows !== 'number'
    || rows <= 0
    || typeof columns !== 'number'
    || columns <= 0
    || typeof spotDiameterFullres !== 'number'
    || !Number.isFinite(spotDiameterFullres)
    || spotDiameterFullres <= 0
  ) {
    return {
      canExport: false,
      reason: 'Chip projection geometry or spot diameter metadata is missing. Reapply chip configuration before export.',
    };
  }

  if (project.tissueSelection.status !== 'complete' || project.tissueSelection.isStale) {
    return {
      canExport: false,
      reason: 'Tissue selection is stale or incomplete. Re-run tissue detection or finish tissue edits before export.',
    };
  }

  const resolvedSelectedSpotIds = project.tissueSelection.regions.length > 0
    ? deriveSelectedSpotIdsFromRegions(project.tissueSelection.regions, projectedSpots)
    : (project.tissueSelection.selectedSpotIds ?? project.tissueSelection.autoSelectedSpotIds);

  return {
    canExport: true,
    data: {
      cropWidth,
      cropHeight,
      heCropAssets: {
        fullres: { dataUrl: heFullres },
        hires: { dataUrl: heHires },
        lowres: { dataUrl: heLowres },
      },
      projectedSpots,
      rows,
      columns,
      selectedSpotIds: new Set(resolvedSelectedSpotIds),
      spotDiameterFullres,
      tissueHiresScale,
      tissueLowresScale,
    },
  };
}

export async function exportPreprocessZip(args: {
  project: PreprocessProject;
  includeProjectJson: boolean;
  includeAlignedImage: boolean;
}) {
  const { project, includeProjectJson, includeAlignedImage } = args;
  const readiness = getPreprocessZipExportReadiness(project);
  if (!readiness.canExport) {
    throw new Error(readiness.reason);
  }

  const {
    cropWidth,
    cropHeight,
    heCropAssets,
    projectedSpots,
    rows,
    columns,
    selectedSpotIds,
    spotDiameterFullres,
    tissueHiresScale,
    tissueLowresScale,
  } = readiness.data;

  const scalefactors = {
    spot_diameter_fullres: spotDiameterFullres,
    fiducial_diameter_fullres: FIDUCIAL_DIAMETER_FULLRES,
    tissue_hires_scalef: tissueHiresScale,
    tissue_lowres_scalef: tissueLowresScale,
  };

  const zip = new JSZip();
  zip.file('tissue_fullres_image.png', dataUrlToBytes(heCropAssets.fullres.dataUrl));
  zip.file('tissue_hires_image.png', dataUrlToBytes(heCropAssets.hires.dataUrl));
  zip.file('tissue_lowres_image.png', dataUrlToBytes(heCropAssets.lowres.dataUrl));
  zip.file('scalefactors_json.json', JSON.stringify(scalefactors, null, 2));
  zip.file('tissue_positions.csv', toCsv(projectedSpots, selectedSpotIds, cropWidth, cropHeight));
  zip.file('tissue_matrix.csv', toMatrixCsv(projectedSpots, selectedSpotIds, rows, columns));

  if (includeAlignedImage) {
    zip.file('aligned_tissue_image.png', dataUrlToBytes(heCropAssets.fullres.dataUrl));
  }

  if (includeProjectJson) {
    const projectBlob = await serializePreprocessProject(project);
    const projectText = await projectBlob.text();
    zip.file('project.json', projectText);
    const sourceEntries = await getPreprocessPackageSourceEntries(project);
    for (const entry of sourceEntries) {
      zip.file(entry.path, entry.blob);
    }
  }

  const blob = await zip.generateAsync({ type: 'blob' });
  return {
    fileName: `${project.name || 'preprocess-project'}-preprocess.zip`,
    blob,
  };
}
