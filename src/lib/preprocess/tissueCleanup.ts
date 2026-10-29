import type { ProjectedSpot } from '@/types/preprocess';

type SpotMap = Map<string, ProjectedSpot>;

const keyFor = (row: number, col: number) => `${row}:${col}`;

const neighborsFor = (spot: ProjectedSpot, spotsByGrid: Map<string, ProjectedSpot>) => {
  const neighbors: ProjectedSpot[] = [];
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) continue;
      const candidate = spotsByGrid.get(keyFor(spot.arrayRow + dy, spot.arrayCol + dx));
      if (candidate) neighbors.push(candidate);
    }
  }
  return neighbors;
};

export function applyConnectedSpotCleanup(args: {
  projectedSpots: ProjectedSpot[];
  selectedIds: Set<string>;
  minConnectedSpotCount: number;
}) {
  const byId: SpotMap = new Map(args.projectedSpots.map((spot) => [spot.id, spot]));
  const byGrid = new Map(args.projectedSpots.map((spot) => [keyFor(spot.arrayRow, spot.arrayCol), spot]));
  const visited = new Set<string>();
  const keep = new Set<string>();

  for (const spotId of args.selectedIds) {
    if (visited.has(spotId)) continue;
    const seed = byId.get(spotId);
    if (!seed) continue;

    const component: string[] = [];
    const queue: ProjectedSpot[] = [seed];
    visited.add(seed.id);

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) continue;
      component.push(current.id);

      for (const neighbor of neighborsFor(current, byGrid)) {
        if (!args.selectedIds.has(neighbor.id) || visited.has(neighbor.id)) continue;
        visited.add(neighbor.id);
        queue.push(neighbor);
      }
    }

    if (component.length >= args.minConnectedSpotCount) {
      component.forEach((id) => {
        keep.add(id);
      });
    }
  }

  return keep;
}

export function applyDensityFilter(args: {
  projectedSpots: ProjectedSpot[];
  candidateIds: Set<string>;
  eps: number;
  minSamples: number;
}) {
  const keep = new Set<string>();

  for (const spot of args.projectedSpots) {
    if (!args.candidateIds.has(spot.id)) continue;
    let neighbors = 0;
    for (const other of args.projectedSpots) {
      if (!args.candidateIds.has(other.id)) continue;
      const dx = spot.x - other.x;
      const dy = spot.y - other.y;
      const dist = Math.hypot(dx, dy);
      if (dist <= args.eps) neighbors += 1;
    }
    if (neighbors >= args.minSamples) keep.add(spot.id);
  }

  return keep;
}

/**
 * Adds candidate spots that touch the current selection (one grid ring).
 * Boundary spots only partially overlap tissue, so their statistics sit below
 * the main Otsu threshold; a single growth round recovers them without the
 * runaway that unbounded transitive growth would cause.
 */
export function applyBoundaryGrowth(args: {
  projectedSpots: ProjectedSpot[];
  selectedIds: Set<string>;
  candidateIds: Set<string>;
}) {
  const byGrid = new Map(args.projectedSpots.map((spot) => [keyFor(spot.arrayRow, spot.arrayCol), spot]));
  const keep = new Set(args.selectedIds);

  for (const spot of args.projectedSpots) {
    if (args.selectedIds.has(spot.id) || !args.candidateIds.has(spot.id)) {
      continue;
    }

    // Judge adjacency against the original selection only, so the loop cannot
    // cascade into a second ring.
    for (const neighbor of neighborsFor(spot, byGrid)) {
      if (args.selectedIds.has(neighbor.id)) {
        keep.add(spot.id);
        break;
      }
    }
  }

  return keep;
}

/**
 * Keeps connected groups of selected spots that are large in absolute terms
 * and large relative to the biggest group. Real tissue forms large contiguous
 * regions; background patches whose statistics resemble tissue survive the
 * threshold as small isolated islands, which this filter removes. Both bounds
 * are fixed relative constants of the auto pipeline, not user knobs.
 */
export const AUTO_COMPONENT_MIN_SPOTS = 4;
export const AUTO_COMPONENT_AREA_RATIO = 0.05;

export function applyRelativeComponentFilter(args: {
  projectedSpots: ProjectedSpot[];
  selectedIds: Set<string>;
}) {
  const byId: SpotMap = new Map(args.projectedSpots.map((spot) => [spot.id, spot]));
  const byGrid = new Map(args.projectedSpots.map((spot) => [keyFor(spot.arrayRow, spot.arrayCol), spot]));
  const visited = new Set<string>();
  const components: string[][] = [];

  for (const spotId of args.selectedIds) {
    if (visited.has(spotId)) continue;
    const seed = byId.get(spotId);
    if (!seed) continue;

    const component: string[] = [];
    const queue: ProjectedSpot[] = [seed];
    visited.add(seed.id);

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) continue;
      component.push(current.id);

      for (const neighbor of neighborsFor(current, byGrid)) {
        if (!args.selectedIds.has(neighbor.id) || visited.has(neighbor.id)) continue;
        visited.add(neighbor.id);
        queue.push(neighbor);
      }
    }

    components.push(component);
  }

  if (components.length === 0) {
    return args.selectedIds;
  }

  let largest = 0;
  for (const component of components) {
    if (component.length > largest) largest = component.length;
  }

  const keepThreshold = Math.max(AUTO_COMPONENT_MIN_SPOTS, Math.ceil(largest * AUTO_COMPONENT_AREA_RATIO));
  const keep = new Set<string>();
  for (const component of components) {
    if (component.length >= keepThreshold) {
      component.forEach((id) => {
        keep.add(id);
      });
    }
  }

  return keep;
}
