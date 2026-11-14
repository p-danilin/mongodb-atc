import type { Bounds, Position } from "@contract/types";

export interface Projection {
  /** Drawing area (without padding), in SVG units. */
  width: number;
  height: number;
  /** [minX, minY, width, height] for the SVG viewBox, padding included. */
  viewBox: [number, number, number, number];
  toSvg(p: Position): [number, number];
  toLonLat(p: [number, number]): Position;
}

/** Linear projection, north up, longitude scaled by cos(centre latitude). `scale` = SVG units per degree of latitude. */
export function makeProjection(
  bounds: Bounds,
  opts: { padding?: number; scale?: number } = {},
): Projection {
  const { padding = 60, scale = 40000 } = opts;
  const [minLon, minLat, maxLon, maxLat] = bounds;
  const k = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
  const width = (maxLon - minLon) * k * scale;
  const height = (maxLat - minLat) * scale;
  return {
    width,
    height,
    viewBox: [0, 0, width + 2 * padding, height + 2 * padding],
    toSvg: ([lon, lat]) => [padding + (lon - minLon) * k * scale, padding + (maxLat - lat) * scale],
    toLonLat: ([x, y]) => [minLon + (x - padding) / (k * scale), maxLat - (y - padding) / scale],
  };
}
