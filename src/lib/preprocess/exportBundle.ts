import JSZip from 'jszip';
import type { PreprocessProject, ProjectedSpot } from '@/types/preprocess';
import { deriveSelectedSpotIdsFromRegions } from './tissueRegions';
import { getPreprocessPackageSourceEntries, serializePreprocessProject } from './package';

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
    lines.push([
      spot.barcode,
      selectedSpotIds.has(spot.id) ? '1' : '0',
      String(spot.arrayRow),
      String(spot.arrayCol),
      String(Math.round(spot.y * cropHeight)),
      String(Math.round(spot.x * cropWidth)),
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

export async function exportPreprocessZip(args: {
  project: PreprocessProject;
  includeProjectJson: boolean;
  includeAlignedImage: boolean;
}) {
  const { project, includeProjectJson, includeAlignedImage } = args;
  const cropWidth = project.cropQc.cropWidth;
  const cropHeight = project.cropQc.cropHeight;
  const processPng = project.cropQc.eosinPreviewDataUrl;
  const tissueRes = project.cropQc.previewDataUrl;
  const projectedSpots = project.chipConfig.projectedSpots;
  const rows = project.chipConfig.rows;
  const columns = project.chipConfig.columns;
  const resolvedSelectedSpotIds = project.tissueSelection.regions.length > 0 && projectedSpots
    ? deriveSelectedSpotIdsFromRegions(project.tissueSelection.regions, projectedSpots)
    : project.tissueSelection.selectedSpotIds ?? project.tissueSelection.autoSelectedSpotIds;
  const selectedSpotIds = new Set(resolvedSelectedSpotIds);

  if (!cropWidth || !cropHeight || !processPng || !tissueRes || !projectedSpots) {
    throw new Error('Export prerequisites missing. Complete crop/QC, chip config, and tissue selection first.');
  }

  if (!rows || !columns) {
    throw new Error('Chip grid dimensions missing. Complete chip config before export.');
  }

  const meanSpotDiameter = projectedSpots.length > 0
    ? projectedSpots.reduce((sum, spot) => sum + ((spot.diameterX * cropWidth + spot.diameterY * cropHeight) / 2), 0) / projectedSpots.length
    : 0;

  const scalefactors = {
    spot_diameter_fullres: meanSpotDiameter,
    fiducial_diameter_fullres: meanSpotDiameter,
    tissue_hires_scalef: 1,
    tissue_lowres_scalef: Math.min(1, 600 / Math.max(cropWidth, cropHeight)),
  };

  const zip = new JSZip();
  zip.file('process.png', dataUrlToBytes(processPng));
  zip.file('tissue_res_image.png', dataUrlToBytes(tissueRes));
  zip.file('scalefactors.json', JSON.stringify(scalefactors, null, 2));
  zip.file('tissue_position.csv', toCsv(projectedSpots, selectedSpotIds, cropWidth, cropHeight));
  zip.file('tissue_matrix.csv', toMatrixCsv(projectedSpots, selectedSpotIds, rows, columns));

  if (includeAlignedImage) {
    zip.file('aligned_tissue_image.png', dataUrlToBytes(tissueRes));
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
