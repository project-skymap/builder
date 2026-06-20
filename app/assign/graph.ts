// k-nearest-neighbour graph over the star field.
// Indexed by star id — graph[starId] is the node for that star.

import type { StarOutput } from "@project-skymap/library";

export interface StarNode {
  id:               number;
  x:                number;
  y:                number;
  magnitude:        number;
  /** IDs of the K nearest stars, sorted closest-first. */
  neighbors:        number[];
  /** Euclidean distances matching the neighbors array. */
  neighborDists:    number[];
  /** Mean of neighborDists — used to detect void-crossing edges. */
  meanNeighborDist: number;
}

/** Indexed array: graph[star.id] === the StarNode for that star. */
export type SkyGraph = StarNode[];

const K = 8; // neighbours per star

/**
 * Build a k-NN graph from the star field.
 * O(n²) — ~20 ms for n=1,189. Safe to run synchronously.
 */
export function buildGraph(stars: StarOutput[]): SkyGraph {
  // Build lookup by id first (star ids are 0-indexed sequential integers).
  const graph: StarNode[] = new Array(stars.length);

  for (const star of stars) {
    const dists: { id: number; dist: number }[] = [];

    for (const other of stars) {
      if (other.id === star.id) continue;
      const dx = star.x - other.x;
      const dy = star.y - other.y;
      dists.push({ id: other.id, dist: Math.sqrt(dx * dx + dy * dy) });
    }

    dists.sort((a, b) => a.dist - b.dist);
    const nearest = dists.slice(0, K);

    const neighbors     = nearest.map(d => d.id);
    const neighborDists = nearest.map(d => d.dist);
    const meanNeighborDist =
      neighborDists.reduce((s, d) => s + d, 0) / neighborDists.length;

    graph[star.id] = {
      id: star.id,
      x: star.x,
      y: star.y,
      magnitude: star.magnitude,
      neighbors,
      neighborDists,
      meanNeighborDist,
    };
  }

  return graph;
}
