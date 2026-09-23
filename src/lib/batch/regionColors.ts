export type BatchRegionColor = {
  id: number;
  name: string;
  stroke: string;
  fill: string;
  swatch: string;
  /** Hex form of the class colour, written to the exported table. */
  hex: string;
};

/**
 * Region classes. The id is what lands in `selected_class`, so the palette has
 * to stay stable and small enough to read in a spreadsheet column. Names are the
 * operator-facing group labels and can be renamed per session.
 */
export const BATCH_REGION_COLORS: readonly BatchRegionColor[] = [
  { id: 1, name: 'Group 1', stroke: 'rgb(229, 62, 62)', fill: 'rgba(229, 62, 62, 0.20)', swatch: '#E53E3E', hex: '#E53E3E' },
  { id: 2, name: 'Group 2', stroke: 'rgb(49, 130, 206)', fill: 'rgba(49, 130, 206, 0.20)', swatch: '#3182CE', hex: '#3182CE' },
  { id: 3, name: 'Group 3', stroke: 'rgb(56, 161, 105)', fill: 'rgba(56, 161, 105, 0.20)', swatch: '#38A169', hex: '#38A169' },
  { id: 4, name: 'Group 4', stroke: 'rgb(214, 158, 46)', fill: 'rgba(214, 158, 46, 0.22)', swatch: '#D69E2E', hex: '#D69E2E' },
  { id: 5, name: 'Group 5', stroke: 'rgb(128, 90, 213)', fill: 'rgba(128, 90, 213, 0.20)', swatch: '#805AD5', hex: '#805AD5' },
];

export const DEFAULT_REGION_COLOR_ID = 1;

const GOLDEN_ANGLE = 137.508;

/** Normalizes `#abc123` / `abc123` to `#ABC123`, or null when it is not a hex. */
export function normalizeHexColor(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;

  const trimmed = value.trim().replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(trimmed)) return null;

  return `#${trimmed.toUpperCase()}`;
}

const hslToHex = (hue: number, saturation: number, lightness: number): string => {
  const sat = saturation / 100;
  const light = lightness / 100;
  const chroma = (1 - Math.abs(2 * light - 1)) * sat;
  const secondary = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const offset = light - chroma / 2;
  const channel = (value: number) => Math.round((value + offset) * 255).toString(16).padStart(2, '0').toUpperCase();

  const [r, g, b] = hue < 60 ? [chroma, secondary, 0]
    : hue < 120 ? [secondary, chroma, 0]
      : hue < 180 ? [0, chroma, secondary]
        : hue < 240 ? [0, secondary, chroma]
          : hue < 300 ? [secondary, 0, chroma]
            : [chroma, 0, secondary];

  return `#${channel(r)}${channel(g)}${channel(b)}`;
};

/** Palette entry that already uses this exact colour, if any. */
export function findRegionColorByHex(
  palette: readonly BatchRegionColor[],
  hex: string,
): BatchRegionColor | null {
  const target = normalizeHexColor(hex);
  if (!target) return null;

  return palette.find((color) => normalizeHexColor(color.hex) === target) ?? null;
}

const hexToRgb = (hex: string) => {
  const normalized = hex.replace('#', '').trim();
  const value = normalized.length === 3
    ? normalized.split('').map((char) => `${char}${char}`).join('')
    : normalized;
  const parsed = Number.parseInt(value, 16);

  if (!Number.isFinite(parsed) || value.length !== 6) {
    return { r: 229, g: 62, b: 62 };
  }

  return {
    r: (parsed >> 16) & 0xff,
    g: (parsed >> 8) & 0xff,
    b: parsed & 0xff,
  };
};

/** Builds a class from a picked hex colour. */
export function createRegionColor(id: number, hex: string): BatchRegionColor {
  const { r, g, b } = hexToRgb(hex);

  return {
    id,
    name: `Group ${id}`,
    swatch: `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('').toUpperCase()}`,
    stroke: `rgb(${r}, ${g}, ${b})`,
    fill: `rgba(${r}, ${g}, ${b}, 0.20)`,
    hex: `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('').toUpperCase()}`,
  };
}

/** Class ids are exported values, so new colours always take a fresh id. */
export function nextRegionColorId(palette: readonly BatchRegionColor[]): number {
  return palette.reduce((highest, entry) => Math.max(highest, entry.id), 0) + 1;
}

/**
 * Colour for a class that is not in the palette yet, e.g. one recovered from a
 * previous export. Deterministic, so the same value always looks the same.
 */
export function synthesizedRegionColor(id: number): BatchRegionColor {
  const hue = Math.round((id * GOLDEN_ANGLE) % 360);
  const hex = hslToHex(hue, 62, 46);

  return {
    id,
    name: `Group ${id}`,
    swatch: `hsl(${hue}, 62%, 46%)`,
    stroke: `hsl(${hue}, 62%, 46%)`,
    fill: `hsla(${hue}, 62%, 46%, 0.20)`,
    hex,
  };
}

/** Any positive class id is valid: the palette is open ended. */
export function normalizeRegionColorId(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_REGION_COLOR_ID;

  const rounded = Math.round(value);
  return rounded >= 1 ? rounded : DEFAULT_REGION_COLOR_ID;
}

export function regionColor(
  colorId: number,
  palette: readonly BatchRegionColor[] = BATCH_REGION_COLORS,
): BatchRegionColor {
  const id = normalizeRegionColorId(colorId);
  return palette.find((entry) => entry.id === id) ?? synthesizedRegionColor(id);
}
