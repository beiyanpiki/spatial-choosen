export type ChipConfigManifest = {
  id: '50um' | '15um';
  label: string;
  gridRows: number;
  gridCols: number;
  spotDiameter: number;
  spotGap: number;
  barcodeTemplatePath: string;
  tissuePositionsPath: string;
};

export type ChipTemplateEntry = {
  barcode: string;
  arrayRow: number;
  arrayCol: number;
};

export type ChipConfigData = {
  manifest: ChipConfigManifest;
  templateEntries: ChipTemplateEntry[];
};

const CHIP_IDS: readonly ChipConfigManifest['id'][] = ['50um', '15um'];

const isManifest = (value: unknown): value is ChipConfigManifest => {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Record<string, unknown>;
  return (entry.id === '50um' || entry.id === '15um')
    && typeof entry.label === 'string'
    && typeof entry.gridRows === 'number'
    && typeof entry.gridCols === 'number'
    && typeof entry.spotDiameter === 'number'
    && typeof entry.spotGap === 'number'
    && typeof entry.barcodeTemplatePath === 'string'
    && typeof entry.tissuePositionsPath === 'string';
};

export async function loadChipConfigManifest(chipId: ChipConfigManifest['id']) {
  const response = await fetch(`/preprocess-chip-configs/${chipId}/manifest.json`);
  if (!response.ok) {
    throw new Error(`Chip config ${chipId} is unavailable (${response.status})`);
  }

  const parsed: unknown = await response.json();
  if (!isManifest(parsed)) {
    throw new Error(`Chip config ${chipId} manifest is malformed`);
  }

  return parsed;
}

export async function loadAllChipConfigManifests() {
  const entries = await Promise.all(CHIP_IDS.map(async (chipId) => loadChipConfigManifest(chipId)));
  return entries;
}

const buildDefaultTemplate = (chip: ChipConfigManifest): ChipTemplateEntry[] => {
  const entries: ChipTemplateEntry[] = [];
  for (let row = 1; row <= chip.gridRows; row += 1) {
    for (let col = 1; col <= chip.gridCols; col += 1) {
      entries.push({
        barcode: `${chip.id}-${String(row).padStart(3, '0')}-${String(col).padStart(3, '0')}`,
        arrayRow: row,
        arrayCol: col,
      });
    }
  }
  return entries;
};

const parseTemplateCsv = (chip: ChipConfigManifest, csvText: string): ChipTemplateEntry[] => {
  const lines = csvText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length <= 1) {
    return buildDefaultTemplate(chip);
  }

  const header = lines[0].split(',').map((value) => value.trim());
  const barcodeIndex = header.indexOf('barcode');
  const rowIndex = header.indexOf('array_row');
  const colIndex = header.indexOf('array_col');
  if (barcodeIndex < 0 || rowIndex < 0 || colIndex < 0) {
    throw new Error(`Chip config ${chip.id} template CSV is malformed`);
  }

  const entries: ChipTemplateEntry[] = [];
  for (const line of lines.slice(1)) {
    const columns = line.split(',');
    const barcode = columns[barcodeIndex]?.trim();
    const arrayRow = Number(columns[rowIndex]);
    const arrayCol = Number(columns[colIndex]);
    if (!barcode || !Number.isInteger(arrayRow) || !Number.isInteger(arrayCol)) continue;
    if (arrayRow < 1 || arrayRow > chip.gridRows || arrayCol < 1 || arrayCol > chip.gridCols) continue;
    entries.push({ barcode, arrayRow, arrayCol });
  }

  if (entries.length === 0) {
    return buildDefaultTemplate(chip);
  }

  return entries;
};

export async function loadChipConfigData(chipId: ChipConfigManifest['id']): Promise<ChipConfigData> {
  const manifest = await loadChipConfigManifest(chipId);
  const response = await fetch(manifest.tissuePositionsPath);
  if (!response.ok) {
    throw new Error(`Chip config ${chipId} tissue positions are unavailable (${response.status})`);
  }

  const csvText = await response.text();
  const templateEntries = parseTemplateCsv(manifest, csvText);
  return {
    manifest,
    templateEntries,
  };
}
