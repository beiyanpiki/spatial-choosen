import type { Point, Region } from '@/types/project';

export type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const EPSILON = 1e-9;

export function getRegionPaths(region: Region): Point[][] {
  return region.paths ?? [region.points];
}

export function pointInRing(point: Point, ring: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const xi = ring[i].x;
    const yi = ring[i].y;
    const xj = ring[j].x;
    const yj = ring[j].y;
    const intersect = yi > point.y !== yj > point.y
      && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function pointInRegion(point: Point, region: Region): boolean {
  const paths = getRegionPaths(region);
  if (paths.length === 0) return false;
  const insideOuter = pointInRing(point, paths[0]);
  if (!insideOuter) return false;
  return !paths.slice(1).some((hole) => pointInRing(point, hole));
}

export function ringIntersectsRect(
  ring: Point[],
  rect: Rect,
): boolean {
  const pointInRect = (pt: Point) => pt.x >= rect.x && pt.x <= rect.x + rect.width
    && pt.y >= rect.y && pt.y <= rect.y + rect.height;

  const segmentsIntersect = (p1: Point, p2: Point, q1: Point, q2: Point) => {
    const cross = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    const d1 = cross(p1, p2, q1);
    const d2 = cross(p1, p2, q2);
    const d3 = cross(q1, q2, p1);
    const d4 = cross(q1, q2, p2);
    const hasOppSign = (a: number, b: number) => (a > 0 && b < 0) || (a < 0 && b > 0);
    if (hasOppSign(d1, d2) && hasOppSign(d3, d4)) return true;
    const onSegment = (a: Point, b: Point, c: Point) =>
      Math.min(a.x, b.x) <= c.x && c.x <= Math.max(a.x, b.x)
      && Math.min(a.y, b.y) <= c.y && c.y <= Math.max(a.y, b.y)
      && Math.abs(cross(a, b, c)) < EPSILON;
    return (
      (Math.abs(d1) < EPSILON && onSegment(p1, p2, q1))
      || (Math.abs(d2) < EPSILON && onSegment(p1, p2, q2))
      || (Math.abs(d3) < EPSILON && onSegment(q1, q2, p1))
      || (Math.abs(d4) < EPSILON && onSegment(q1, q2, p2))
    );
  };

  if (ring.length === 0) return false;
  if (ring.some((pt) => pointInRect(pt))) return true;

  const corners: Point[] = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height },
    { x: rect.x, y: rect.y + rect.height },
  ];
  if (corners.some((c) => pointInRing(c, ring))) return true;

  const rectEdges: [Point, Point][] = [
    [corners[0], corners[1]],
    [corners[1], corners[2]],
    [corners[2], corners[3]],
    [corners[3], corners[0]],
  ];
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    for (const [r1, r2] of rectEdges) {
      if (segmentsIntersect(a, b, r1, r2)) return true;
    }
  }
  return false;
}

export function regionIntersectsRect(region: Region, rect: Rect): boolean {
  const paths = getRegionPaths(region);
  if (paths.length === 0) return false;
  if (!ringIntersectsRect(paths[0], rect)) return false;

  const corners: Point[] = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height },
    { x: rect.x, y: rect.y + rect.height },
  ];
  const insideHole = paths
    .slice(1)
    .some((hole) => corners.every((c) => pointInRing(c, hole)));
  return !insideHole;
}
