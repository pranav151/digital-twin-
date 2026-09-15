/** Metres. Front (+Z) faces the canopy; right (+X) is the mezzanine.
 * Dimensions supplied 2026-09-14. Rack counts/bay spacing are provisional.
 * Update these counts when the physical aisle survey arrives; geometry is generated.
 */
export const DEPOT = {
  width: 255, depth: 120, canopyDepth: 30, roofHeight: 13,
  mezzanine: { x: 76.5, z: -12.5, width: 102, depth: 95, elevation: 4.8 },
  gangway: { z: 39, depth: 8 },
  racks: {
    lower: { rows: 13, tiers: 3, bays: 9 },
    mezzanine: { rows: 15, tiers: 3, bays: 18 },
    rnr: { rows: 11, tiers: 4, bays: 9 },
    primary: { rows: 8, tiers: 4, bays: 8 },
    reserve: { rows: 3, tiers: 4, bays: 8 },
    pmsp: { rows: 4, tiers: 3, bays: 24 },
  },
  zones: [
    { name: 'MEZZANINE', detail: 'Small parts · 102 × 95 m', x: 76.5, z: -12.5, w: 102, d: 95, color: '#cfae6b' },
    { name: 'R&R STORAGE', detail: '4-tier pallet racks', x: -10, z: -12.5, w: 65, d: 95, color: '#8aa9a2' },
    { name: 'D22 PRIMARY', detail: '4-tier pallet racks', x: -74, z: -1, w: 55, d: 72, color: '#8aa9a2' },
    { name: 'D22 RESERVE', detail: 'Reserve storage', x: -116.5, z: -1, w: 22, d: 72, color: '#b5a283' },
    { name: 'PMSP', detail: 'Behind primary + reserve', x: -86, z: -49, w: 81, d: 22, color: '#9ba6bd' },
  ],
  stationPositions: {
    W1: [112, 5.1, 29], W2: [90, 5.1, -20], W3: [48, 5.1, -20],
    W4: [90, 0, 29], W5: [48, 0, 29], W6: [28, 0, 30],
    W7: [89, 0, 49], W8: [33, 0, 49], W9: [-42, 0, 49],
    W10: [-90, 0, 50], W11: [91, 0, 65], W12: [12, 0, 65], W13: [-95, 0, 65],
  } as Record<string, [number, number, number]>,
} as const;
