// Book shape archetypes.
// Each defines how the candidate-scoring model is biased while the user
// assigns chapters to a book.  None of them are enforced — they tilt the
// suggestions toward a shape without ever forbidding deviations.

export type ShapeArchetype = "arc" | "cluster" | "chain" | "burst" | "free";

export interface ArchetypeConfig {
  id:          ShapeArchetype;
  label:       string;
  description: string;
  // ── Scoring influence factors (used by candidates.ts) ────────────────────
  /** How strongly to follow the current movement direction. */
  momentumWeight:  number;
  /** 0 = spread freely, 1 = stay close to the book's centroid. */
  compactness:     number;
  /**
   * +ve = pull toward the book's centroid (cluster behaviour).
   * −ve = push away from the centroid (burst behaviour).
   *  0  = no centripetal influence.
   */
  centripetal:     number;
  /** Reward maintaining a consistent bearing (arc / chain). */
  directionalBias: number;
}

export const ARCHETYPES: Record<ShapeArchetype, ArchetypeConfig> = {
  arc: {
    id:              "arc",
    label:           "Arc",
    description:     "Smooth curve across the sky",
    momentumWeight:  0.55,
    compactness:     0.30,
    centripetal:     0.00,
    directionalBias: 0.45,
  },
  cluster: {
    id:              "cluster",
    label:           "Cluster",
    description:     "Dense, settled gathering",
    momentumWeight:  0.15,
    compactness:     0.75,
    centripetal:     0.65,
    directionalBias: 0.10,
  },
  chain: {
    id:              "chain",
    label:           "Chain",
    description:     "Linear march through the stars",
    momentumWeight:  0.75,
    compactness:     0.15,
    centripetal:     0.00,
    directionalBias: 0.75,
  },
  burst: {
    id:              "burst",
    label:           "Burst",
    description:     "Expands outward from an anchor",
    momentumWeight:  0.10,
    compactness:     0.10,
    centripetal:    -0.55,
    directionalBias: 0.10,
  },
  free: {
    id:              "free",
    label:           "Free",
    description:     "No guiding shape",
    momentumWeight:  0.25,
    compactness:     0.25,
    centripetal:     0.00,
    directionalBias: 0.25,
  },
};

export const DEFAULT_ARCHETYPE: ShapeArchetype = "arc";

/** Canonical display order for pickers. */
export const ARCHETYPE_ORDER: ShapeArchetype[] = [
  "arc", "cluster", "chain", "burst", "free",
];
