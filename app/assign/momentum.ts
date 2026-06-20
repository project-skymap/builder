// Momentum tracking and book-envelope suggestions.
// Pure computation — no React, no side-effects.

import type { SkyGraph } from "./graph";

// ---------------------------------------------------------------------------
// Momentum
// ---------------------------------------------------------------------------

/** Tracks the "feel" of the path through the last WINDOW assignments. */
export interface MomentumState {
  /** Ordered recent star IDs for the current book — oldest first, newest last. */
  recentStarIds: number[];
  /** Mean displacement direction across recent moves (unit vector). Null if < 2 stars. */
  direction:     { x: number; y: number } | null;
  /** 0 = dead-straight path; 1 = maximum curvature / reversal. */
  curvature:     number;
  /** Mean nearest-neighbour distance of recent stars (unit-disk scale). */
  densityTrend:  number;
}

const MOMENTUM_WINDOW = 5;

/**
 * Derive the current momentum from the session's undo history.
 * Only considers assignments within [bookStart, bookEnd] (the current book).
 */
export function computeMomentum(
  undoStack:   number[],
  assignments: Record<number, number>,
  graph:       SkyGraph,
  bookStart:   number,
  bookEnd:     number,
): MomentumState {
  const recentChIndices = undoStack
    .filter(i => i >= bookStart && i <= bookEnd)
    .slice(-MOMENTUM_WINDOW);

  const recentStarIds = recentChIndices
    .map(i => assignments[i])
    .filter((id): id is number => id !== undefined);

  if (recentStarIds.length < 2) {
    return { recentStarIds, direction: null, curvature: 0, densityTrend: 0.05 };
  }

  const nodes = recentStarIds
    .map(id => graph[id])
    .filter((n): n is NonNullable<typeof n> => n !== undefined && n !== null);

  if (nodes.length < 2) {
    return { recentStarIds, direction: null, curvature: 0, densityTrend: 0.05 };
  }

  // Consecutive displacement vectors
  const disps: { x: number; y: number }[] = [];
  for (let i = 1; i < nodes.length; i++) {
    disps.push({ x: nodes[i]!.x - nodes[i - 1]!.x, y: nodes[i]!.y - nodes[i - 1]!.y });
  }

  // Mean direction (weighted toward most recent)
  let sumX = 0, sumY = 0;
  for (let i = 0; i < disps.length; i++) {
    const w = (i + 1) / disps.length; // recency weight
    sumX += disps[i]!.x * w;
    sumY += disps[i]!.y * w;
  }
  const len = Math.sqrt(sumX * sumX + sumY * sumY);
  const direction = len > 1e-6 ? { x: sumX / len, y: sumY / len } : null;

  // Curvature: mean fractional angle change between consecutive steps
  let curveAcc = 0, curveN = 0;
  for (let i = 1; i < disps.length; i++) {
    const a  = disps[i - 1]!;
    const b  = disps[i]!;
    const la = Math.sqrt(a.x * a.x + a.y * a.y);
    const lb = Math.sqrt(b.x * b.x + b.y * b.y);
    if (la > 1e-6 && lb > 1e-6) {
      const dot = Math.max(-1, Math.min(1, (a.x * b.x + a.y * b.y) / (la * lb)));
      curveAcc += Math.acos(dot) / Math.PI; // 0 = same direction, 1 = reversal
      curveN++;
    }
  }
  const curvature = curveN > 0 ? curveAcc / curveN : 0;

  // Density trend: mean of each recent star's mean nearest-neighbour distance
  const densityTrend = nodes.reduce((s, n) => s + n.meanNeighborDist, 0) / nodes.length;

  return { recentStarIds, direction, curvature, densityTrend };
}

// ---------------------------------------------------------------------------
// Book envelope
// ---------------------------------------------------------------------------

/** A suggested region of the sky that can accommodate an incoming book. */
export interface EnvelopeCandidate {
  /** Centre of the region in unit-disk coordinates. */
  x:       number;
  y:       number;
  /** Estimated radius needed to hold the book's chapters. */
  radius:  number;
  /** 0–1, where 1 means the region has exactly enough free stars. */
  quality: number;
}

/**
 * Find up to `maxResults` sky regions that have enough free stars
 * to accommodate a book with `chapterCount` chapters.
 *
 * Runs a lightweight 9×9 grid search — ~600 distance checks per call.
 */
export function computeEnvelopeCandidates(
  chapterCount: number,
  assignedSet:  Set<number>,
  graph:        SkyGraph,
  maxResults    = 3,
): EnvelopeCandidate[] {
  const available = graph.filter(n => {
    if (!n) return false;
    if (assignedSet.has(n.id)) return false;
    return Math.sqrt(n.x * n.x + n.y * n.y) < 0.92;
  });

  if (available.length < chapterCount) return [];

  // Estimate the radius that would contain ~chapterCount stars
  const density  = available.length / (Math.PI * 0.92 * 0.92);
  const neededR  = Math.sqrt(chapterCount / (Math.PI * density)) * 1.25; // 25% padding

  // 9 × 9 candidate centres across the inner disc
  const scored: EnvelopeCandidate[] = [];
  const steps = 9;

  for (let i = 0; i < steps; i++) {
    for (let j = 0; j < steps; j++) {
      const x = -0.76 + (i / (steps - 1)) * 1.52;
      const y = -0.76 + (j / (steps - 1)) * 1.52;
      if (Math.sqrt(x * x + y * y) > 0.80) continue;

      let count = 0;
      const r2 = neededR * neededR;
      for (const n of available) {
        const dx = n.x - x, dy = n.y - y;
        if (dx * dx + dy * dy <= r2) count++;
      }

      const quality = Math.min(1, count / chapterCount);
      if (quality > 0.35) scored.push({ x, y, radius: neededR, quality });
    }
  }

  scored.sort((a, b) => b.quality - a.quality);

  // Deduplicate: skip candidates that are too close to an already-chosen one
  const results: EnvelopeCandidate[] = [];
  for (const c of scored) {
    if (results.length >= maxResults) break;
    const tooClose = results.some(r => {
      const dx = r.x - c.x, dy = r.y - c.y;
      return Math.sqrt(dx * dx + dy * dy) < neededR * 0.9;
    });
    if (!tooClose) results.push(c);
  }

  return results;
}
