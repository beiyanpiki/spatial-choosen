/**
 * Minimal RFC4180-ish CSV reader/writer.
 *
 * The preprocessing/NATA pipelines emit plain comma separated values, but
 * barcode columns occasionally contain quoted fields, so the reader keeps
 * quote handling instead of splitting on commas.
 */

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let index = 0;

  const pushField = () => {
    row.push(field);
    field = '';
  };

  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  while (index < text.length) {
    const char = text[index];

    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }

        inQuotes = false;
        index += 1;
        continue;
      }

      field += char;
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      index += 1;
      continue;
    }

    if (char === ',') {
      pushField();
      index += 1;
      continue;
    }

    if (char === '\r') {
      index += 1;
      continue;
    }

    if (char === '\n') {
      pushRow();
      index += 1;
      continue;
    }

    field += char;
    index += 1;
  }

  if (field !== '' || row.length > 0) {
    pushRow();
  }

  return rows.filter((entry) => entry.some((cell) => cell.trim() !== ''));
}

const needsQuoting = (value: string) => /[",\r\n]/.test(value);

export function formatCsvField(value: string): string {
  if (!needsQuoting(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

export function stringifyCsv(rows: readonly (readonly string[])[]): string {
  const body = rows
    .map((row) => row.map((cell) => formatCsvField(cell)).join(','))
    .join('\n');

  return `${body}\n`;
}

export function normalizeHeader(header: readonly string[]): string[] {
  return header.map((value) => value.trim());
}

export function readColumnIndex(header: readonly string[]): Record<string, number> {
  const index: Record<string, number> = {};

  normalizeHeader(header).forEach((name, position) => {
    if (name !== '' && index[name] === undefined) {
      index[name] = position;
    }
  });

  return index;
}
