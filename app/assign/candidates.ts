// Candidate next-star suggestion engine.
// Returns a small ranked list of suggestions — never more than 5.
// Scores are advisory only; never shown to the user as numbers.

import type { SkyGraph, StarNode } from "./graph";
import type { MomentumState } from "./momentum";
import type { ShapeArchetype, ArchetypeConfig } from "./archetypes";
import { ARCHETYPES, DEFAULT_ARCHETYPE } from "./archetypes";

export interface CandidateMove {
  starId: number;
  tier:   1 | 2;    // 1 = primary (pulsing glow), 2 = secondary (quiet)
  hint:   string;   // plain English, one short phrase
}

/** Optional context that enriches the scoring model. */
export interface CandidateOptions {
  /** Momentum derived from recent assignments in this book. */
  momentum?:          MomentumState | null;
  /** Active shape archetype for this book. */
  archetype?:         ShapeArchetype;
  /** Positions of all already-assigned stars in the current book. */
  bookStarPositions?: { x: number; y: number }[];
}

// ---------------------------------------------------------------------------
// Chapter candidates (within a book)
// ---------------------------------------------------------------------------

/**
 * Suggest up to 5 candidate stars for the next chapter.
 *
 * @param anchorStarId     Most-recently assigned star. Null for the very first chapter.
 * @param assigned         All currently assigned star IDs.
 * @param graph            The k-NN sky graph.
 * @param remainingInBook  Chapters left in the current book (including this one).
 * @param options          Optional momentum / archetype / book context.
 */
export function getCandidates(
  anchorStarId:    number | null,
  assigned:        Set<number>,
  graph:           SkyGraph,
  remainingInBook: number,
  options?:        CandidateOptions,
): CandidateMove[] {
  if (anchorStarId === null) {
    return getFirstCandidates(assigned, graph);
  }

  const anchor = graph[anchorStarId];
  if (!anchor) return [];

  const momentum  = options?.momentum ?? null;
  const archetype = ARCHETYPES[options?.archetype ?? DEFAULT_ARCHETYPE]!;

  // Centroid of current book stars (for shape scoring)
  const bookPos = options?.bookStarPositions ?? [];
  const bookCentroid = bookPos.length > 0
    ? {
        x: bookPos.reduce((s, p) => s + p.x, 0) / bookPos.length,
        y: bookPos.reduce((s, p) => s + p.y, 0) / bookPos.length,
      }
    : null;

  interface Scored {
    starId:           number;
    score:            number;
    isVoidCrossing:   boolean;
    isDirectNeighbor: boolean;
    goodCapacity:     boolean;
  }

  const scored: Scored[] = [];
  const seen = new Set<number>();

  // ── Distance-1 neighbours ─────────────────────────────────────────────────
  for (let ni = 0; ni < anchor.neighbors.length; ni++) {
    const nid  = anchor.neighbors[ni] as number;
    const dist = anchor.neighborDists[ni] as number;
    if (assigned.has(nid) || seen.has(nid)) continue;
    seen.add(nid);

    const neighbor = graph[nid];
    if (!neighbor) continue;

    const isVoidCrossing = dist > 2.5 * anchor.meanNeighborDist;
    const freeNeighbors  = neighbor.neighbors.filter(
      id => !assigned.has(id) && id !== anchorStarId,
    ).length;
    const goodCapacity = freeNeighbors >= Math.min(remainingInBook * 0.25, 2);

    let score = 2.5;
    if (isVoidCrossing) score -= 0.8;
    if (!goodCapacity)  score -= 0.5;

    score += momentumBonus(neighbor, anchor, momentum, archetype.momentumWeight);
    score += shapeBonus(neighbor, anchor, archetype, bookCentroid, 1.0);

    scored.push({ starId: nid, score, isVoidCrossing, isDirectNeighbor: true, goodCapacity });
  }

  // ── Distance-2 neighbours (only if pool is thin) ──────────────────────────
  if (scored.length < 5) {
    for (const nid of anchor.neighbors) {
      const hop1 = graph[nid as number];
      if (!hop1) continue;
      for (const nnid of hop1.neighbors) {
        if (assigned.has(nnid) || seen.has(nnid) || nnid === anchorStarId) continue;
        seen.add(nnid);

        const nn = graph[nnid];
        if (!nn) continue;

        const edgeDist = Math.sqrt(
          (anchor.x - nn.x) ** 2 + (anchor.y - nn.y) ** 2,
        );
        const isVoidCrossing = edgeDist > 3.5 * anchor.meanNeighborDist;
        const freeNeighbors  = nn.neighbors.filter(id => !assigned.has(id)).length;
        const goodCapacity   = freeNeighbors >= Math.min(remainingInBook * 0.25, 2);

        let score = 1.2;
        if (isVoidCrossing) score -= 0.6;
        if (!goodCapacity)  score -= 0.4;

        // Momentum and shape have reduced influence for hop-2 candidates
        score += momentumBonus(nn, anchor, momentum, archetype.momentumWeight) * 0.65;
        score += shapeBonus(nn, anchor, archetype, bookCentroid, 0.65);

        scored.push({ starId: nnid, score, isVoidCrossing, isDirectNeighbor: false, goodCapacity });
      }
    }
  }

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, 5).map((s, idx) => ({
    starId: s.starId,
    tier:   (idx < 3 ? 1 : 2) as 1 | 2,
    hint:   hintFor(s.isVoidCrossing, s.isDirectNeighbor, s.goodCapacity, archetype.id),
  }));
}

// ---------------------------------------------------------------------------
// First chapter candidates (no anchor)
// ---------------------------------------------------------------------------

function getFirstCandidates(assigned: Set<number>, graph: SkyGraph): CandidateMove[] {
  const unassigned = graph.filter(n => n && !assigned.has(n.id));
  if (unassigned.length === 0) return [];

  const regions: Array<(n: StarNode) => boolean> = [
    n => n.x <  0 && n.y < 0,
    n => n.x >= 0 && n.y < 0,
    n => n.y >= 0,
  ];

  const picks: CandidateMove[] = [];
  for (const inRegion of regions) {
    const regional = unassigned.filter(inRegion);
    if (regional.length === 0) continue;
    regional.sort((a, b) => a.meanNeighborDist - b.meanNeighborDist);
    const pick = regional[0];
    if (!pick || picks.some(p => p.starId === pick.id)) continue;
    picks.push({ starId: pick.id, tier: 1, hint: "begin the journey here" });
  }

  return picks.slice(0, 3);
}

// ---------------------------------------------------------------------------
// Transition candidates (start of a new book)
// ---------------------------------------------------------------------------

/**
 * Suggest three starting stars for the next book spread across
 * near / moderate / far distances from the just-completed cluster.
 */
export function getTransitionCandidates(
  bookStarIds: number[],
  assigned:    Set<number>,
  graph:       SkyGraph,
): CandidateMove[] {
  const bookStarSet = new Set(bookStarIds);

  const distanceMap = new Map<number, number>();
  const visited     = new Set<number>(bookStarIds);
  let frontier      = bookStarIds.filter(id => graph[id]);

  for (let hop = 1; hop <= 12 && frontier.length > 0; hop++) {
    const next: number[] = [];
    for (const sid of frontier) {
      const node = graph[sid];
      if (!node) continue;
      for (const nid of node.neighbors) {
        if (visited.has(nid)) continue;
        visited.add(nid);
        next.push(nid);
        if (!assigned.has(nid) && !bookStarSet.has(nid)) {
          distanceMap.set(nid, hop);
        }
      }
    }
    frontier = next;
  }

  const near: number[] = [], moderate: number[] = [], far: number[] = [];
  for (const [starId, hops] of distanceMap) {
    if      (hops <= 2) near.push(starId);
    else if (hops <= 5) moderate.push(starId);
    else                far.push(starId);
  }

  const result: CandidateMove[] = [];
  const pick = (pool: number[], hint: string): void => {
    if (pool.length === 0) return;
    pool.sort((a, b) =>
      (graph[a]?.meanNeighborDist ?? 1) - (graph[b]?.meanNeighborDist ?? 1),
    );
    const id = pool[0];
    if (id !== undefined && !result.some(r => r.starId === id)) {
      result.push({ starId: id, tier: 1, hint });
    }
  };

  pick(near,     "continue nearby");
  pick(moderate, "step into new territory");
  pick(far,      "begin elsewhere");

  if (result.length < 3) {
    const all = [...near, ...moderate, ...far];
    for (const id of all) {
      if (result.length >= 3) break;
      if (result.some(r => r.starId === id)) continue;
      result.push({ starId: id, tier: 2, hint: "available" });
    }
  }

  return result.slice(0, 3);
}

// ---------------------------------------------------------------------------
// Scoring helpers
// ---------------------------------------------------------------------------

/**
 * Returns a bonus in approximately [−0.6, +0.6] based on how well
 * the candidate continues the current momentum direction.
 */
function momentumBonus(
  node:          StarNode,
  anchor:        StarNode,
  momentum:      MomentumState | null,
  weight:        number,
): number {
  if (!momentum?.direction || weight <= 0) return 0;
  const dx   = node.x - anchor.x;
  const dy   = node.y - anchor.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 1e-6) return 0;
  const alignment = (dx / dist) * momentum.direction.x + (dy / dist) * momentum.direction.y;
  return weight * alignment * 0.6; // alignment ∈ [−1, 1]
}

/**
 * Returns a bonus in [0, +0.5] based on how well the candidate fits
 * the archetype's spatial intent (compactness, centripetal).
 */
function shapeBonus(
  node:         StarNode,
  anchor:       StarNode,
  archetype:    ArchetypeConfig,
  bookCentroid: { x: number; y: number } | null,
  scale:        number,
): number {
  if (!bookCentroid || archetype.id === "free") return 0;

  const dxC  = node.x - bookCentroid.x;
  const dyC  = node.y - bookCentroid.y;
  const distC = Math.sqrt(dxC * dxC + dyC * dyC);
  const refR  = Math.max(anchor.meanNeighborDist * 4, 0.05);

  if (archetype.centripetal > 0) {
    // cluster: reward proximity to the book centroid
    const s = Math.max(0, 1 - distC / refR);
    return archetype.centripetal * 0.45 * s * scale;
  } else if (archetype.centripetal < 0) {
    // burst: reward distance from the centroid
    const s = Math.min(1, distC / refR);
    return Math.abs(archetype.centripetal) * 0.45 * s * scale;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Hint generation
// ---------------------------------------------------------------------------

function hintFor(
  isVoidCrossing:   boolean,
  isDirectNeighbor: boolean,
  goodCapacity:     boolean,
  archetype:        ShapeArchetype,
): string {
  if (isVoidCrossing) return "crosses into open space";
  if (!goodCapacity)  return "limited room ahead";

  if (!isDirectNeighbor) return "nearby, good room ahead";

  switch (archetype) {
    case "arc":     return "follows the arc";
    case "cluster": return "pulls toward centre";
    case "chain":   return "continues the chain";
    case "burst":   return "bursts outward";
    default:        return "continues naturally";
  }
}
