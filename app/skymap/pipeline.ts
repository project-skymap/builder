import type { ConstellationConfig, StarArrangement } from "@project-skymap/library";

export const PIPELINE_ARRANGEMENT_KEY = "skymap-pipeline-arrangement";
export const PIPELINE_CONSTELLATIONS_KEY = "skymap-pipeline-constellations";
export const PIPELINE_CONSTELLATIONS_PROJECTION_KEY = "skymap-pipeline-constellations-projection";
export const PIPELINE_CONSTELLATIONS_PROJECTION_VERSION = "builder-dome-v1";

function safeParseJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function loadPipelineArrangement(): StarArrangement | null {
  if (typeof window === "undefined") return null;
  const data = safeParseJson<StarArrangement>(localStorage.getItem(PIPELINE_ARRANGEMENT_KEY));
  return data && typeof data === "object" ? data : null;
}

export function savePipelineArrangement(arrangement: StarArrangement): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(PIPELINE_ARRANGEMENT_KEY, JSON.stringify(arrangement));
  } catch {
    // Ignore storage quota issues.
  }
}

export function loadPipelineConstellations(): ConstellationConfig | null {
  if (typeof window === "undefined") return null;
  const data = safeParseJson<ConstellationConfig>(localStorage.getItem(PIPELINE_CONSTELLATIONS_KEY));
  if (!data?.version || !Array.isArray(data.constellations)) return null;
  if (localStorage.getItem(PIPELINE_CONSTELLATIONS_PROJECTION_KEY) === PIPELINE_CONSTELLATIONS_PROJECTION_VERSION) {
    return data;
  }

  const migrated = {
    ...data,
    constellations: data.constellations.map((item) => {
      if (!Array.isArray(item.center) || item.center.length < 3) return item;
      const [x, y, z] = item.center as [number, number, number];
      return {
        ...item,
        center: [-x, y, -z] as [number, number, number],
      };
    }),
  };
  savePipelineConstellations(migrated);
  return migrated;
}

export function savePipelineConstellations(config: ConstellationConfig): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(PIPELINE_CONSTELLATIONS_KEY, JSON.stringify(config));
    localStorage.setItem(PIPELINE_CONSTELLATIONS_PROJECTION_KEY, PIPELINE_CONSTELLATIONS_PROJECTION_VERSION);
  } catch {
    // Ignore storage quota issues.
  }
}
