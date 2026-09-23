export type BatchStepId =
  | 'import'
  | 'align'
  | 'referenceRegion'
  | 'imageRegions'
  | 'review';

/**
 * How step 3 collects the selection.
 *
 * - `project`: one region is drawn on the reference image and projected onto
 *   every other package.
 * - `perImage`: the reference region is confirmed first and kept as a guide,
 *   then every package is walked through and annotated individually.
 */
export type BatchRegionMode = 'project' | 'perImage';

export type BatchStepStatus = 'idle' | 'ready' | 'complete' | 'error';

export type BatchPoint = {
  x: number;
  y: number;
};

export type BatchImageSize = {
  width: number;
  height: number;
};

export type BatchBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/**
 * Affine transform stored row-major as `[a, b, c, d, e, f]`.
 *
 * `x' = a * x + b * y + c`
 * `y' = d * x + e * y + f`
 */
export type BatchAffineMatrix = [number, number, number, number, number, number];

/**
 * Manual rotate/scale/translate parameters for one package relative to the
 * reference package.
 *
 * The transform is expressed in each image's own normalized `[0, 1]` frame:
 * a normalized point of the moving image maps to a normalized point of the
 * reference image. Rotation and scale always pivot on the moving image centre,
 * so `offsetX` / `offsetY` alone decide where that centre lands.
 */
export type BatchSimilarityParams = {
  rotationDegrees: number;
  scale: number;
  flipHorizontal: boolean;
  flipVertical: boolean;
  offsetX: number;
  offsetY: number;
};

export type BatchRegion = {
  id: string;
  points: BatchPoint[];
  /** Inner rings cut out of `points`, normalized like it. */
  holes?: BatchPoint[][];
  /**
   * 1-based region class. The class drives the drawing colour and the value
   * written to `selected_class`, so different colours can be told apart in the
   * exported table.
   */
  colorId: number;
};

export type BatchSpot = {
  barcode: string;
  inTissue: boolean;
  arrayRow: number;
  arrayCol: number;
  pxlRowInFullres: number;
  pxlColInFullres: number;
};

export type BatchPositionsTable = {
  header: string[];
  rows: string[][];
  columnIndex: Record<string, number>;
};

export type BatchPackageFile = {
  /** Path relative to the package root, for example `spatial/tissue_positions.csv`. */
  relativePath: string;
  /** File name without directories. */
  name: string;
  blob: Blob;
};

export type BatchPackageStatus = 'loading' | 'ready' | 'error';

/**
 * State recovered when a package that was already exported by step 5 is
 * imported again, so a batch can be resumed instead of redone.
 */
export type BatchPackageResume = {
  /** Alignment recovered from `transform-matrix.csv` (own-size frame). */
  alignment: BatchSimilarityParams | null;
  /** Barcodes flagged by a previous export, or null when there was no such column. */
  selectedBarcodes: string[] | null;
  /** Region class per barcode, when the export recorded `selected_class`. */
  classByBarcode: Map<string, number> | null;
  /** Colour per class, when the export recorded `selected_color`. */
  colorByClass: Map<number, string> | null;
};

export type BatchPackage = {
  id: string;
  /** Folder name that hosted the package, for example `250926-SPA-GW1`. */
  name: string;
  files: BatchPackageFile[];
  fullresFileName: string | null;
  positionsFileName: string | null;
  scalefactorsFileName: string | null;
  fullresSize: BatchImageSize | null;
  previewUrl: string | null;
  previewSize: BatchImageSize | null;
  /**
   * Normalized bounds of the non-white content, used to trim the pure-white
   * padding some packages carry. Null when there is nothing to trim.
   */
  contentBounds: BatchBounds | null;
  spotDiameterFullres: number | null;
  spots: BatchSpot[] | null;
  positions: BatchPositionsTable | null;
  resume: BatchPackageResume | null;
  status: BatchPackageStatus;
  error: string | null;
};

export type BatchSpotAnchorMode = 'top-left' | 'center';

export type BatchHitMode = 'center' | 'overlap';

export type BatchMatrixLayout = '2x3' | '3x3';

/**
 * Which frame the exported transform matrix lands in.
 *
 * - `reference-frame`: output coordinates are pixels of the reference image
 *   (image[0]), so the value also folds in the size difference between the two
 *   images. This is the frame that lets packages be compared with each other.
 * - `source-frame`: output coordinates stay in a canvas the same size as the
 *   package's own image, so the matrix only carries the rotate/scale/translate
 *   that was performed during alignment.
 */
export type BatchMatrixConvention = 'reference-frame' | 'source-frame';

export type BatchSelectionSettings = {
  anchorMode: BatchSpotAnchorMode;
  hitMode: BatchHitMode;
};

export type BatchSelectionResult = {
  selectedBarcodes: string[];
  selectedBarcodeSet: Set<string>;
  /** Region class (1..n) per selected barcode, for the exported class column. */
  classByBarcode: Map<string, number>;
  totalSpots: number;
};
