/** Canonical coordinates for the isolated 200×200 toroidal sample realm. */
export const PREVIEW_WORLD_SIZE = 200

export function wrapPreviewCoordinate(value: number): number {
  if (!Number.isFinite(value)) throw new RangeError('Map coordinates must be finite.')
  return ((value + 100) % PREVIEW_WORLD_SIZE + PREVIEW_WORLD_SIZE) % PREVIEW_WORLD_SIZE - 100
}

export function wrapPreviewCell(col: number, row: number): { col: number; row: number } {
  if (!Number.isInteger(col) || !Number.isInteger(row)) throw new RangeError('Map coordinates must be finite whole tiles.')
  return { col: wrapPreviewCoordinate(col), row: wrapPreviewCoordinate(row) }
}

/** Shortest signed displacement from a to b; an exact half-world chooses −100. */
export function wrappedPreviewDelta(a: number, b: number): number {
  return wrapPreviewCoordinate(wrapPreviewCoordinate(b) - wrapPreviewCoordinate(a))
}

export function wrappedPreviewDistance(a: { col: number; row: number }, b: { col: number; row: number }): number {
  return Math.max(Math.abs(wrappedPreviewDelta(a.col, b.col)), Math.abs(wrappedPreviewDelta(a.row, b.row)))
}
