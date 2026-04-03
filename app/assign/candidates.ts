// Candidate next-star suggestion engine.
// Returns a small ranked list of suggestions — never more than 5.
// Scores are advisory only; never shown to the user as numbers.

import type { SkyGraph, StarNode } from "./graph";

export interface CandidateMove {
  starId: number;
  tier:   1 | 2;    // 1 = primary (pulsing glow), 2 = secondary (quiet)
  hint:   string;   // plain English, one short phrase
}

// ---------------------------------------------------------------------------
// Chapter candidates (within a book)
// ---------------------------------------------------------------------------

/**
 * Suggest the next star for the current chapter.
 *
 * @param anchorStarId  The star of the most recently assigned chapter.
 *                      Null when no chapter has been assigned yet (Genesis 1).
 * @param assigned      Set of all currently assigned star IDs.
 * @param graph         The k-NN sky graph.
 * @param remainingInBook  Chapters left in the current book (including this one).
 */
export function getCandidates(
  anchorStarId:    number | null,
  assigned:        Set<number>,
  graph:           SkyGraph,
  remainingInBook: number,
): CandidateMove[] {
  if (anchorStarId === null) {
    return getFirstCandidates(assigned, graph);
  }

  const anchor = graph[anchorStarId];
  if (!anchor) return [];

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

    const neighbor        = graph[nid];
    if (!neighbor) continue;

    const isVoidCrossing  = dist > 2.5 * anchor.meanNeighborDist;
    const freeNeighbors   = neighbor.neighbors.filter(
      id => !assigned.has(id) && id !== anchorStarId,
    ).length;
    const goodCapacity    = freeNeighbors >= Math.min(remainingInBook * 0.25, 2);

    let score = 3.0;
    if (isVoidCrossing) score -= 1.0;
    if (!goodCapacity)  score -= 0.7;

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

        const edgeDist        = Math.sqrt((anchor.x - nn.x) ** 2 + (anchor.y - nn.y) ** 2);
        const isVoidCrossing  = edgeDist > 3.5 * anchor.meanNeighborDist;
        const freeNeighbors   = nn.neighbors.filter(id => !assigned.has(id)).length;
        const goodCapacity    = freeNeighbors >= Math.min(remainingInBook * 0.25, 2);

        let score = 1.5;
        if (isVoidCrossing) score -= 0.8;
        if (!goodCapacity)  score -= 0.5;

        scored.push({ starId: nnid, score, isVoidCrossing, isDirectNeighbor: false, goodCapacity });
      }
    }
  }

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, 5).map((s, idx) => ({
    starId: s.starId,
    tier:   (idx < 3 ? 1 : 2) as 1 | 2,
    hint:   hintFor(s.isVoidCrossing, s.isDirectNeighbor, s.goodCapacity),
  }));
}

// ---------------------------------------------------------------------------
// First chapter candidates (Genesis 1 — no anchor)
// ---------------------------------------------------------------------------

function getFirstCandidates(assigned: Set<number>, graph: SkyGraph): CandidateMove[] {
  const unassigned = graph.filter(n => n && !assigned.has(n.id));
  if (unassigned.length === 0) return [];

  // Three spatial regions; pick the densest unassigned star from each.
  const regions: Array<(n: StarNode) => boolean> = [
    n => n.x <  0 && n.y < 0,  // upper-left
    n => n.x >= 0 && n.y < 0,  // upper-right
    n => n.y >= 0,              // lower half
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
 * Suggest three starting stars for the next book.
 * Returns up to 3 candidates spread across near / moderate / far distances
 * from the just-completed book's star cluster.
 */
export function getTransitionCandidates(
  bookStarIds: number[],
  assigned:    Set<number>,
  graph:       SkyGraph,
): CandidateMove[] {
  const bookStarSet = new Set(bookStarIds);
  const assignedSet = assigned;

  // BFS outward from the completed book's stars
  const distanceMap = new Map<number, number>(); // starId → hops from book
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
        if (!assignedSet.has(nid) && !bookStarSet.has(nid)) {
          distanceMap.set(nid, hop);
        }
      }
    }
    frontier = next;
  }

  // Split into three distance tiers
  const near:     number[] = [];
  const moderate: number[] = [];
  const far:      number[] = [];

  for (const [starId, hops] of distanceMap) {
    if (hops <= 2)       near.push(starId);
    else if (hops <= 5)  moderate.push(starId);
    else                 far.push(starId);
  }

  const result: CandidateMove[] = [];

  const pick = (pool: number[], hint: string): void => {
    if (pool.length === 0) return;
    // Prefer denser areas (smaller meanNeighborDist)
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

  // Fill to 3 if we have fewer
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
// Helpers
// ---------------------------------------------------------------------------

function hintFor(
  isVoidCrossing:   boolean,
  isDirectNeighbor: boolean,
  goodCapacity:     boolean,
): string {
  if (isVoidCrossing)                        return "crosses into open space";
  if (!goodCapacity)                         return "limited room ahead";
  if (isDirectNeighbor)                      return "continues naturally";
  return "nearby, good room ahead";
}
