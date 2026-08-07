"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getViewModeProfile } from "@project-skymap/library";
import type { ConstellationConfig, HierarchyFilter, HorizonThemeConfig, PlanetariumViewMode, SceneNode, StarArrangement, StarMapConfig, StarMapHandle } from "@project-skymap/library";
import { StarMap } from "@project-skymap/library";
import { CANON } from "../assign/canon";
import type { Chapter } from "../assign/canon";
import type { Session } from "../assign/session";
import { importSession } from "../assign/session";
import defaultArrangement from "../arrangement.json";
import { BuilderSection, BuilderWorkspace } from "../components/BuilderWorkspace";
import {
  buildArrangementFromSession,
  buildModelFromArrangement,
  ARRANGEMENT_RADIUS,
  chapterNodeToGlobalIndex,
  computeBookRegions,
  computeDivisionRegions,
  DEFAULT_HORIZON_THEME_ID,
  divisionTriangulationColor,
  HORIZON_THEMES,
  optimizeArrangementForVisibility,
  remapArrangementToVisibleHemisphere,
} from "../skymap/shared";
import {
  buildCustomHorizonTheme,
  PREVIEW_CUSTOM_HORIZON_DEFAULTS,
  type CustomHorizonFill,
  type HorizonColorMode,
  type PreviewCustomHorizonDefaults,
} from "./config";
import { loadPipelineArrangement, loadPipelineConstellations, savePipelineArrangement, savePipelineConstellations } from "../skymap/pipeline";

const PREVIEW_STORAGE_KEY = "skymap-preview-arrangement";
const PREVIEW_HORIZON_SETTINGS_KEY = "skymap-preview-horizon-settings";
const REFINE_STORAGE_KEY = "skymap-refine-session";
const CONSTELLATE_STORAGE_KEY = "skymap-constellate-constellations";

type PreviewPayload = {
  arrangement: StarArrangement;
  source: "arrangement" | "session" | "autosave";
  filename?: string;
};

type FilterMatch = {
  level: "book" | "division" | "testament" | "none";
  label: string;
  filter: HierarchyFilter | null;
};

type ImmersiveTuning = {
  starScale: number;
  backdropCount: number;
  backdropGain: number;
  backdropEnergy: number;
  horizonFlattening: number;
  horizonWarp: number;
  hazeStrength: number;
};

type ZenithHorizonTuning = {
  groundAlpha: number;
  horizonFlattening: number;
  horizonWarp: number;
  hazeStrength: number;
  rimStrength: number;
  landscapeOpacity: number;
  landscapeHeight: number;
  landscapeSoftness: number;
};

type Vec3Tuple = [number, number, number];
type NudgeTargetKind = "artwork" | "book" | "star";
type NudgeMoveMode = "position" | "rotation";
type NudgeTarget = {
  kind: NudgeTargetKind;
  id: string;
  mode: NudgeMoveMode;
};

const DEFAULT_IMMERSIVE_TUNING: ImmersiveTuning = {
  starScale: 0.68,
  backdropCount: 7000,
  backdropGain: 0.58,
  backdropEnergy: 2.9,
  horizonFlattening: 0.35,
  horizonWarp: 0.45,
  hazeStrength: 0.62,
};

const DEFAULT_ZENITH_HORIZON_TUNING: ZenithHorizonTuning = {
  groundAlpha: 0,
  horizonFlattening: 0,
  horizonWarp: 0,
  hazeStrength: 0,
  rimStrength: 0,
  landscapeOpacity: 0.6,
  landscapeHeight: 5.0,
  landscapeSoftness: 0.4,
};

function chapterTitle(chapter: Chapter): string {
  return `${chapter.bookName} ${chapter.chapterNumber}`;
}

function getTodayChapterIndex(date = new Date()): number {
  const start = new Date(date.getFullYear(), 0, 1).getTime();
  const today = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const dayOfYear = Math.max(0, Math.floor((today - start) / 86_400_000));
  return dayOfYear % CANON.length;
}

function getNodeChapter(node: SceneNode | null): Chapter | null {
  if (!node || node.level !== 3) return null;
  const chapterIndex = chapterNodeToGlobalIndex(node.id);
  return chapterIndex === undefined ? null : CANON[chapterIndex] ?? null;
}

function getChapterNodeId(chapter: Chapter): string {
  return `C:${chapter.bookKey}:${chapter.chapterNumber}`;
}

function getYesFilterMatch(guest: Chapter, answer: Chapter): FilterMatch {
  if (guest.bookKey === answer.bookKey) {
    return {
      level: "book",
      label: `Same book: ${answer.bookName}`,
      filter: { testament: answer.testament, division: answer.divisionName, bookKey: answer.bookKey },
    };
  }
  if (guest.testament === answer.testament && guest.divisionName === answer.divisionName) {
    return {
      level: "division",
      label: `Same division: ${answer.divisionName}`,
      filter: { testament: answer.testament, division: answer.divisionName },
    };
  }
  if (guest.testament === answer.testament) {
    return {
      level: "testament",
      label: `Same testament: ${answer.testament}`,
      filter: { testament: answer.testament },
    };
  }
  return { level: "none", label: "No shared testament, division, or book.", filter: null };
}

function buildImmersiveHorizonTheme(theme: HorizonThemeConfig | undefined, tuning: ImmersiveTuning): HorizonThemeConfig | undefined {
  if (!theme) return undefined;
  const points = theme.profile?.points;
  const averageAlt = points?.length
    ? points.reduce((sum, point) => sum + point.altDeg, 0) / points.length
    : 2.5;

  return {
    ...theme,
    id: `${theme.id}-immersive`,
    label: `${theme.label} Immersive`,
    groundColor: "#121923",
    horizonLineColor: "#8fa9c6",
    horizonLineThickness: Math.min(theme.horizonLineThickness ?? 0, 1),
    atmosphere: {
      ...theme.atmosphere,
      fogVisible: true,
      fogBandTopAltDeg: 14,
      fogBandBottomAltDeg: -18,
      fogIntensity: tuning.hazeStrength,
      minimalBrightness: 0.2,
      minimalAltitudeDeg: -3,
    },
    profile: theme.profile
      ? {
          ...theme.profile,
          points: points?.map((point) => ({
            ...point,
            altDeg: averageAlt + (point.altDeg - averageAlt) * tuning.horizonFlattening,
          })) ?? theme.profile.points,
        }
      : theme.profile,
  };
}

function buildZenithHorizonTheme(theme: HorizonThemeConfig | undefined, tuning: ZenithHorizonTuning): HorizonThemeConfig | undefined {
  if (!theme) return undefined;
  const points = theme.profile?.points;
  const averageAlt = points?.length
    ? points.reduce((sum, point) => sum + point.altDeg, 0) / points.length
    : 2.5;

  return {
    ...theme,
    id: `${theme.id}-zenith`,
    label: `${theme.label} Zenith`,
    horizonLineColor: "#88a8ca",
    horizonLineThickness: tuning.rimStrength * 2,
    atmosphere: {
      ...theme.atmosphere,
      fogVisible: true,
      fogBandTopAltDeg: 12,
      fogBandBottomAltDeg: -16,
      fogIntensity: tuning.hazeStrength,
      minimalBrightness: 0.18,
      minimalAltitudeDeg: -3,
    },
    profile: theme.profile
      ? {
          ...theme.profile,
          points: points?.map((point) => ({
            ...point,
            altDeg: averageAlt + (point.altDeg - averageAlt) * tuning.horizonFlattening,
          })) ?? theme.profile.points,
        }
      : theme.profile,
  };
}

function downloadJson(data: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function normalizeTuple(position: Vec3Tuple): Vec3Tuple {
  const length = Math.hypot(position[0], position[1], position[2]);
  if (length <= 1e-9) return [0, ARRANGEMENT_RADIUS, 0];
  return [position[0] / length, position[1] / length, position[2] / length];
}

function rotateTupleAroundAxis(position: Vec3Tuple, axis: Vec3Tuple, angleDeg: number): Vec3Tuple {
  const axisLength = Math.hypot(axis[0], axis[1], axis[2]);
  if (axisLength <= 1e-9) return position;
  const [ux, uy, uz] = [axis[0] / axisLength, axis[1] / axisLength, axis[2] / axisLength];
  const angle = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const [x, y, z] = position;
  const dot = ux * x + uy * y + uz * z;
  return [
    x * cos + (uy * z - uz * y) * sin + ux * dot * (1 - cos),
    y * cos + (uz * x - ux * z) * sin + uy * dot * (1 - cos),
    z * cos + (ux * y - uy * x) * sin + uz * dot * (1 - cos),
  ];
}

function nudgeSkyPosition(position: Vec3Tuple, key: string, stepDeg: number): Vec3Tuple {
  if (key === "ArrowLeft") return rotateTupleAroundAxis(position, [0, 1, 0], -stepDeg);
  if (key === "ArrowRight") return rotateTupleAroundAxis(position, [0, 1, 0], stepDeg);

  const direction = normalizeTuple(position);
  let meridianAxis: Vec3Tuple = [-direction[2], 0, direction[0]];
  if (Math.hypot(meridianAxis[0], meridianAxis[1], meridianAxis[2]) <= 1e-6) {
    meridianAxis = [1, 0, 0];
  }
  return rotateTupleAroundAxis(position, meridianAxis, key === "ArrowUp" ? stepDeg : -stepDeg);
}

function nudgeArrangementPositions(
  arrangement: StarArrangement,
  ids: string[],
  key: string,
  stepDeg: number,
): StarArrangement {
  const next: StarArrangement = { ...arrangement };
  for (const id of ids) {
    const entry = next[id];
    if (!entry?.position) continue;
    next[id] = {
      ...entry,
      position: nudgeSkyPosition(entry.position, key, stepDeg),
    };
  }
  return next;
}

function formatVec(position: Vec3Tuple | null | undefined): string {
  if (!position) return "none";
  return position.map((value) => value.toFixed(1)).join(", ");
}

function loadPreviewPayload(): PreviewPayload | null {
  if (typeof window === "undefined") return null;
  const arrangement = loadPipelineArrangement();
  if (arrangement) return { arrangement, source: "arrangement", filename: "pipeline arrangement.json" };
  const bundledArrangement = defaultArrangement as unknown as StarArrangement;
  if (Object.keys(bundledArrangement).length > 0) {
    return { arrangement: bundledArrangement, source: "arrangement", filename: "bundled arrangement.json" };
  }
  try {
    const raw = localStorage.getItem(PREVIEW_STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as PreviewPayload;
    if (!data?.arrangement) return null;
    return data;
  } catch {
    return null;
  }
}

function savePreviewPayload(payload: PreviewPayload): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(PREVIEW_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore storage failures.
  }
}

function loadPreviewHorizonSettings(): PreviewCustomHorizonDefaults | null {
  if (typeof window === "undefined") return null;
  try {
    const data = JSON.parse(localStorage.getItem(PREVIEW_HORIZON_SETTINGS_KEY) ?? "null") as Partial<PreviewCustomHorizonDefaults> | null;
    if (!data) return null;
    const next = { ...PREVIEW_CUSTOM_HORIZON_DEFAULTS };
    if (data.mode === "light" || data.mode === "dark" || data.mode === "custom") next.mode = data.mode;
    if (data.fill === "solid" || data.fill === "radial") next.fill = data.fill;
    if (typeof data.groundColor === "string") next.groundColor = data.groundColor;
    if (typeof data.horizonLineColor === "string") next.horizonLineColor = data.horizonLineColor;
    if (typeof data.gradientInnerColor === "string") next.gradientInnerColor = data.gradientInnerColor;
    if (typeof data.gradientOuterColor === "string") next.gradientOuterColor = data.gradientOuterColor;
    if (typeof data.gradientRadius === "number") next.gradientRadius = data.gradientRadius;
    if (typeof data.gradientIntensity === "number") next.gradientIntensity = data.gradientIntensity;
    return next;
  } catch {
    return null;
  }
}

function savePreviewHorizonSettings(settings: PreviewCustomHorizonDefaults): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(PREVIEW_HORIZON_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage failures.
  }
}

function loadRefineAutosave(): Session | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(REFINE_STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Session;
    if (!data?.skyField?.stars || !data?.assignments) return null;
    return data;
  } catch {
    return null;
  }
}

function loadConstellateAutosave(): ConstellationConfig | null {
  if (typeof window === "undefined") return null;
  const pipelineConstellations = loadPipelineConstellations();
  if (pipelineConstellations) return pipelineConstellations;
  try {
    const data = JSON.parse(localStorage.getItem(CONSTELLATE_STORAGE_KEY) ?? "null") as ConstellationConfig | null;
    if (!data?.version || !Array.isArray(data.constellations)) return null;
    return data;
  } catch {
    return null;
  }
}

function buildPreviewPayloadFromArrangement(arrangement: StarArrangement, filename?: string): PreviewPayload {
  return { arrangement, source: "arrangement", filename };
}

function buildPreviewPayloadFromSession(session: Session, filename?: string): PreviewPayload {
  return { arrangement: buildArrangementFromSession(session), source: "session", filename };
}

function addConstellationCentersToArrangement(
  arrangement: StarArrangement,
  config: ConstellationConfig | null,
): StarArrangement {
  if (!config) return arrangement;
  const entries = config.constellations.filter((item) => Array.isArray(item.center) && item.center.length >= 3);
  if (entries.length === 0) return arrangement;

  const next: StarArrangement = { ...arrangement };
  for (const item of entries) {
    const [x, y, z] = item.center as [number, number, number];
    next[item.id] = {
      ...next[item.id],
      center: [x, y, z],
    };
  }
  return next;
}

export default function PreviewPage() {
  const mapRef = useRef<StarMapHandle>(null);
  const [horizonSettingsLoaded, setHorizonSettingsLoaded] = useState(false);
  const [payload, setPayload] = useState<PreviewPayload | null>(null);
  const [status, setStatus] = useState("No preview source loaded yet.");
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [currentFov, setCurrentFov] = useState(() => getViewModeProfile("zenith").defaultFov);
  const [currentCamera, setCurrentCamera] = useState<{ lon: number; lat: number; fov: number } | null>(null);
  const [showDivisionLabels, setShowDivisionLabels] = useState(false);
  const [showDivisionTint, setShowDivisionTint] = useState(true);
  const [showBookLabels, setShowBookLabels] = useState(true);
  const [showChapterLabels, setShowChapterLabels] = useState(true);
  const [groundCaptionText, setGroundCaptionText] = useState(""); //useState("Folly outweighs wisdom, leading to chaos");
  const [showConstellationArt, setShowConstellationArt] = useState(true);
  const [showBackdropStars, setShowBackdropStars] = useState(false);
  const [showAtmosphere, setShowAtmosphere] = useState(false);
  const [showMoon, setShowMoon] = useState(false);
  const [showSunrise, setShowSunrise] = useState(false);
  const [showMilkyWay, setShowMilkyWay] = useState(false);
  const [triangulationMode, setTriangulationMode] = useState<"off" | "focused" | "full">("focused");
  const [useVisibleHemisphere, setUseVisibleHemisphere] = useState(false);
  const [edgePanEnabled, setEdgePanEnabled] = useState(false);
  const [viewMode, setViewMode] = useState<PlanetariumViewMode>("zenith");
  const [chapterLabelMaxFov, setChapterLabelMaxFov] = useState(22);
  const [constellationBaseOpacity, setConstellationBaseOpacity] = useState(80);
  const [starSizeExponent, setStarSizeExponent] = useState(4.0);
  const [starSizeScale, setStarSizeScale] = useState(1.25);
  const [starSizeWeightPercentile, setStarSizeWeightPercentile] = useState(1.0);
  const [immersiveTuning, setImmersiveTuning] = useState<ImmersiveTuning>(DEFAULT_IMMERSIVE_TUNING);
  const [zenithHorizonTuning, setZenithHorizonTuning] = useState<ZenithHorizonTuning>(DEFAULT_ZENITH_HORIZON_TUNING);
  const [divisionLabelPushFraction, setDivisionLabelPushFraction] = useState(0.45);
  const [divisionLabelHorizonPaddingDeg, setDivisionLabelHorizonPaddingDeg] = useState(25);
  const [selectedHorizonThemeId, setSelectedHorizonThemeId] = useState(DEFAULT_HORIZON_THEME_ID || HORIZON_THEMES[0]?.id || "");
  const [customHorizon, setCustomHorizon] = useState<PreviewCustomHorizonDefaults>(PREVIEW_CUSTOM_HORIZON_DEFAULTS);
  const [horizonColorMode, setHorizonColorMode] = useState<HorizonColorMode>(PREVIEW_CUSTOM_HORIZON_DEFAULTS.mode);
  const [constellationConfig, setConstellationConfig] = useState<ConstellationConfig | null>(null);
  const [constellationSource, setConstellationSource] = useState<"default" | "custom" | "autosave">("default");
  const [isSidebarHovered, setIsSidebarHovered] = useState(false);
  const [filterTestament, setFilterTestament] = useState("");
  const [filterDivision, setFilterDivision] = useState("");
  const [filterBook, setFilterBook] = useState("");
  const [selectedNode, setSelectedNode] = useState<SceneNode | null>(null);
  const [answerChapterIndex, setAnswerChapterIndex] = useState(getTodayChapterIndex);
  const [filterTestStatus, setFilterTestStatus] = useState("Select a chapter star to test Yes narrowing.");
  const [nudgeTarget, setNudgeTarget] = useState<NudgeTarget>({ kind: "artwork", id: "", mode: "position" });
  const [nudgeStepDeg, setNudgeStepDeg] = useState(0.25);
  const [nudgeStatus, setNudgeStatus] = useState("No nudge target selected.");

  useEffect(() => {
    const saved = loadPreviewHorizonSettings();
    if (saved) {
      setCustomHorizon(saved);
      setHorizonColorMode(saved.mode);
    }
    setHorizonSettingsLoaded(true);
  }, []);

  useEffect(() => {
    if (!horizonSettingsLoaded) return;
    savePreviewHorizonSettings({ ...customHorizon, mode: horizonColorMode });
  }, [customHorizon, horizonColorMode, horizonSettingsLoaded]);

  useEffect(() => {
    const autosaved = loadPreviewPayload();
    if (autosaved) {
      setPayload({ ...autosaved, source: "autosave" });
      setStatus("Restored preview arrangement from this browser.");
      return;
    }

    const refineSession = loadRefineAutosave();
    if (refineSession) {
      setPayload({ arrangement: buildArrangementFromSession(refineSession), source: "session" });
      setStatus("Loaded latest Refine autosave into Preview.");
      return;
    }

    setStatus("Load an arrangement or a session exported from Refine to preview the planetarium experience.");
  }, []);

  useEffect(() => {
    if (!payload) return;
    savePreviewPayload(payload);
    setLastSavedAt(Date.now());
  }, [payload]);

  useEffect(() => {
    fetch("/constellations.json")
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((data) => {
        const constellateAutosave = loadConstellateAutosave();
        setConstellationConfig(constellateAutosave ?? data);
        setConstellationSource(constellateAutosave ? "autosave" : "default");
      })
      .catch(() => {
        setConstellationConfig(null);
      });
  }, []);

  const model = useMemo(() => (payload ? buildModelFromArrangement(payload.arrangement) : null), [payload]);

  const divisionColors = useMemo(() => {
    if (!model) return {};
    const colors: Record<string, string> = {};
    for (const node of model.nodes) {
      if (node.level !== 1) continue;
      const divisionName = (node.meta?.division as string) ?? node.label;
      colors[divisionName] = divisionTriangulationColor(divisionName);
    }
    return colors;
  }, [model]);

  const filterTestaments = useMemo(
    () => model?.nodes.filter((n) => n.level === 0).map((n) => ({ id: n.meta?.testament as string, label: n.label })) ?? [],
    [model],
  );
  const filterDivisions = useMemo(() => {
    if (!filterTestament || !model) return [];
    return model.nodes
      .filter((n) => n.level === 1 && (n.meta?.testament as string) === filterTestament)
      .map((n) => ({ id: n.meta?.division as string, label: n.label }));
  }, [model, filterTestament]);
  const filterBooks = useMemo(() => {
    if (!filterDivision || !model) return [];
    return model.nodes
      .filter((n) => n.level === 2 && n.parent === `D:${filterTestament}:${filterDivision}`)
      .map((n) => ({ id: n.meta?.bookKey as string, label: n.label }));
  }, [model, filterTestament, filterDivision]);

  const bookNodes = useMemo(
    () => model?.nodes.filter((node) => node.level === 2) ?? [],
    [model],
  );
  const chapterNodes = useMemo(
    () => model?.nodes.filter((node) => node.level === 3) ?? [],
    [model],
  );
  const visibleConstellationItems = useMemo(
    () => constellationConfig?.constellations ?? [],
    [constellationConfig],
  );
  const nudgeSelectedBook = useMemo(
    () => bookNodes.find((node) => node.id === nudgeTarget.id) ?? null,
    [bookNodes, nudgeTarget.id],
  );
  const nudgeSelectedStar = useMemo(
    () => chapterNodes.find((node) => node.id === nudgeTarget.id) ?? null,
    [chapterNodes, nudgeTarget.id],
  );
  const nudgeSelectedArtwork = useMemo(
    () => visibleConstellationItems.find((item) => item.id === nudgeTarget.id) ?? null,
    [nudgeTarget.id, visibleConstellationItems],
  );
  const nudgePosition = useMemo(() => {
    if (nudgeTarget.kind === "artwork") return nudgeSelectedArtwork?.center?.length === 3 ? nudgeSelectedArtwork.center as Vec3Tuple : null;
    if (!payload) return null;
    return payload.arrangement[nudgeTarget.id]?.position ?? null;
  }, [nudgeSelectedArtwork, nudgeTarget.id, nudgeTarget.kind, payload]);

  useEffect(() => {
    if (!filterTestament) {
      mapRef.current?.setHierarchyFilter(null);
      return;
    }
    const filter: HierarchyFilter = { testament: filterTestament };
    if (filterDivision) filter.division = filterDivision;
    if (filterBook) filter.bookKey = filterBook;
    mapRef.current?.setHierarchyFilter(filter);
  }, [filterTestament, filterDivision, filterBook]);

  useEffect(() => {
    if (!nudgeTarget.id) return;

    if (nudgeTarget.kind === "star" && nudgeSelectedStar) {
      setSelectedNode(nudgeSelectedStar);
      setNudgeStatus(`Highlighted ${nudgeSelectedStar.label}.`);
      return;
    }

    if (nudgeTarget.kind === "book" && nudgeSelectedBook) {
      setSelectedNode(nudgeSelectedBook);
      mapRef.current?.setFocusedBook(nudgeSelectedBook.id);
      setNudgeStatus(`Highlighted ${nudgeSelectedBook.label}.`);
      return;
    }

    if (nudgeTarget.kind === "artwork" && nudgeSelectedArtwork) {
      setSelectedNode({ id: nudgeSelectedArtwork.id, label: nudgeSelectedArtwork.title, level: -1 });
      setShowConstellationArt(true);
      setNudgeStatus(`Highlighted ${nudgeSelectedArtwork.title}.`);
    }
  }, [nudgeSelectedArtwork, nudgeSelectedBook, nudgeSelectedStar, nudgeTarget.id, nudgeTarget.kind]);

  const selectedChapter = useMemo(() => getNodeChapter(selectedNode), [selectedNode]);
  const answerChapter = CANON[answerChapterIndex] ?? CANON[0]!;
  const currentFilterLabel = useMemo(() => {
    if (!filterTestament) return "All stars";
    const parts = [filterTestament];
    if (filterDivision) parts.push(filterDivision);
    if (filterBook) parts.push(filterBook);
    return parts.join(" / ");
  }, [filterBook, filterDivision, filterTestament]);
  const selectedHorizonTheme = useMemo<HorizonThemeConfig | undefined>(
    () => HORIZON_THEMES.find((theme) => theme.id === selectedHorizonThemeId) ?? HORIZON_THEMES[0],
    [selectedHorizonThemeId],
  );
  const previewHorizonTheme = useMemo<HorizonThemeConfig | undefined>(() => {
    if (!selectedHorizonTheme || horizonColorMode === "light") return selectedHorizonTheme;
    if (horizonColorMode === "custom") return buildCustomHorizonTheme(selectedHorizonTheme, customHorizon);
    return {
      ...selectedHorizonTheme,
      id: `${selectedHorizonTheme.id}-dark`,
      label: `${selectedHorizonTheme.label} Dark`,
      groundColor: "#000000",
      horizonLineColor: "#000000",
      atmosphere: {
        ...selectedHorizonTheme.atmosphere,
        fogVisible: false,
        fogIntensity: 0,
        minimalBrightness: 0,
      },
    };
  }, [customHorizon, horizonColorMode, selectedHorizonTheme]);
  const effectiveHorizonTheme = useMemo(() => {
    if (viewMode === "immersive") return buildImmersiveHorizonTheme(previewHorizonTheme, immersiveTuning);
    if (viewMode === "zenith") return buildZenithHorizonTheme(previewHorizonTheme, zenithHorizonTuning);
    return previewHorizonTheme;
  }, [immersiveTuning, previewHorizonTheme, viewMode, zenithHorizonTuning]);
  const previewArrangement = useMemo(
    () => (payload ? addConstellationCentersToArrangement(payload.arrangement, constellationConfig) : null),
    [constellationConfig, payload],
  );
  const optimizedArrangement = useMemo(
    () => (
      previewArrangement
        ? optimizeArrangementForVisibility(previewArrangement, selectedHorizonTheme)
        : null
    ),
    [previewArrangement, selectedHorizonTheme],
  );
  const displayArrangement = useMemo(
    () => (
      optimizedArrangement && useVisibleHemisphere
        ? remapArrangementToVisibleHemisphere(optimizedArrangement, selectedHorizonTheme)
        : optimizedArrangement
    ),
    [optimizedArrangement, selectedHorizonTheme, useVisibleHemisphere],
  );
  // Computed straight from the arrangement actually being displayed (post-rotation,
  // post-remap), so the tint disc always lines up with the stars on screen — regardless
  // of which arrangement is loaded (upload, Refine session, autosave).
  const adjustedDivisionRegions = useMemo<StarMapConfig["divisionRegions"]>(
    () => (displayArrangement ? computeDivisionRegions(displayArrangement) : undefined),
    [displayArrangement],
  );
  // Same idea as adjustedDivisionRegions, but per-book — anchors book label placement
  // to each book's true star centroid on whatever arrangement is on screen.
  const adjustedBookRegions = useMemo<StarMapConfig["bookRegions"]>(
    () => (displayArrangement ? computeBookRegions(displayArrangement) : undefined),
    [displayArrangement],
  );

  const previewConstellationConfig = useMemo(() => {
    if (!constellationConfig) return null;
    const defined = constellationConfig.constellations.filter(
      (c) => (
        (c.lineSegments?.length ?? 0) > 0 ||
        (c.linePaths?.length ?? 0) > 0 ||
        c.rotationDeg !== 0 ||
        (constellationSource !== "default" && c.radius > 1)
      ),
    );
    return { ...constellationConfig, constellations: defined };
  }, [constellationConfig, constellationSource]);

  const config = useMemo<StarMapConfig | null>(() => {
    if (!model || !displayArrangement) return null;
    return {
      model,
      arrangement: displayArrangement,
      layout: { algorithm: "phyllotaxis", radius: 2000 },
      showBookLabels,
      showChapterLabels,
      showDivisionLabels,
      showDivisionTint,
      divisionLabelPushFraction,
      divisionLabelHorizonPaddingDeg,
      showGroupLabels: false,
      divisionColors,
      divisionRegions: adjustedDivisionRegions,
      bookRegions: adjustedBookRegions,
      labelBehavior: {
        overlapPaddingPx: 2,
        reappearDelayMs: 60,
        classes: {
          chapter: { maxFov: chapterLabelMaxFov, maxOverlapPx: 12 },
        },
      },
      showConstellationLines: triangulationMode !== "off",
      constellationLineMode: triangulationMode,
      showConstellationArt,
      constellationBaseOpacity,
      showBackdropStars: showBackdropStars || viewMode === "immersive",
      backdropStarsCount: viewMode === "immersive" ? Math.round(immersiveTuning.backdropCount) : undefined,
      backdropWideFovGain: viewMode === "immersive" ? immersiveTuning.backdropGain : undefined,
      backdropSizeExponent: viewMode === "immersive" ? 1.0 : undefined,
      backdropEnergy: viewMode === "immersive" ? immersiveTuning.backdropEnergy : undefined,
      showAtmosphere: showAtmosphere || viewMode === "immersive",
      showMoon,
      showSunrise,
      showMilkyWay,
      horizonTheme: effectiveHorizonTheme,
      immersiveHorizonWarp: viewMode === "immersive" ? immersiveTuning.horizonWarp : 0,
      zenithHorizonWarp: viewMode === "zenith" ? zenithHorizonTuning.horizonWarp : 0,
      horizonGroundAlpha: viewMode === "zenith" ? zenithHorizonTuning.groundAlpha : 1,
      showLandscapeSilhouette: viewMode === "zenith",
      landscapeSilhouetteOpacity: viewMode === "zenith" ? zenithHorizonTuning.landscapeOpacity : 0,
      landscapeSilhouetteHeightDeg: zenithHorizonTuning.landscapeHeight,
      landscapeSilhouetteSoftness: zenithHorizonTuning.landscapeSoftness,
      landscapeSilhouetteColor: "#05080d",
      selectedStarId: selectedChapter ? selectedNode?.id : null,
      answerStarId: getChapterNodeId(answerChapter),
      focus: { nodeId: nudgeTarget.id || null },
      edgePanEnabled,
      viewMode,
      constellations: previewConstellationConfig,
      fitProjection: true,
      starSizeExponent,
      starSizeScale: viewMode === "immersive" ? starSizeScale * immersiveTuning.starScale : starSizeScale,
      starSizeWeightPercentile,
      starZoomReveal: false,
      groundCaptionText: groundCaptionText || undefined,
      // Fixed default camera position regardless of viewMode (including zenith,
      // which previously always looked straight up at lat=90°).
      camera: {
        lon: 245 * (Math.PI / 180),
        lat: 40 * (Math.PI / 180),
        fov: getViewModeProfile(viewMode).defaultFov,
      },
    };
  }, [
    chapterLabelMaxFov,
    triangulationMode,
    constellationBaseOpacity,
    displayArrangement,
    divisionColors,
    divisionLabelPushFraction,
    divisionLabelHorizonPaddingDeg,
    adjustedDivisionRegions,
    adjustedBookRegions,
    model,
    previewConstellationConfig,
    effectiveHorizonTheme,
    answerChapter,
    edgePanEnabled,
    immersiveTuning,
    selectedChapter,
    selectedNode,
    zenithHorizonTuning,
    viewMode,
    selectedHorizonTheme,
    nudgeTarget.id,
    showAtmosphere,
    showBackdropStars,
    showBookLabels,
    showChapterLabels,
    showConstellationArt,
    showDivisionLabels,
    showDivisionTint,
    groundCaptionText,
    showMilkyWay,
    showMoon,
    showSunrise,
    starSizeExponent,
    starSizeScale,
    starSizeWeightPercentile,
  ]);

  const arrangementCount = displayArrangement
    ? Object.keys(displayArrangement).filter((key) => /^C:/.test(key)).length
    : 0;
  const lastSavedLabel = lastSavedAt !== null
    ? new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(lastSavedAt)
    : null;

  const updateCustomHorizon = useCallback((patch: Partial<PreviewCustomHorizonDefaults>) => {
    setCustomHorizon((current) => ({ ...current, ...patch }));
  }, []);

  const handleResetCustomHorizon = useCallback(() => {
    setCustomHorizon(PREVIEW_CUSTOM_HORIZON_DEFAULTS);
    setHorizonColorMode(PREVIEW_CUSTOM_HORIZON_DEFAULTS.mode);
  }, []);

  const updateImmersiveTuning = useCallback((patch: Partial<ImmersiveTuning>) => {
    setImmersiveTuning((current) => ({ ...current, ...patch }));
  }, []);

  const handleResetImmersiveTuning = useCallback(() => {
    setImmersiveTuning(DEFAULT_IMMERSIVE_TUNING);
  }, []);

  const updateZenithHorizonTuning = useCallback((patch: Partial<ZenithHorizonTuning>) => {
    setZenithHorizonTuning((current) => ({ ...current, ...patch }));
  }, []);

  const handleResetZenithHorizonTuning = useCallback(() => {
    setZenithHorizonTuning(DEFAULT_ZENITH_HORIZON_TUNING);
  }, []);

  const handleImportArrangement = useCallback(async (file: File) => {
    try {
      const arrangement = JSON.parse(await file.text()) as StarArrangement;
      const next = buildPreviewPayloadFromArrangement(arrangement, file.name);
      setPayload(next);
      savePipelineArrangement(arrangement);
      setStatus(`Loaded arrangement from ${file.name}.`);
    } catch {
      setStatus(`Could not load ${file.name}.`);
    }
  }, []);

  const handleImportSession = useCallback(async (file: File) => {
    try {
      const session = await importSession(file);
      const next = buildPreviewPayloadFromSession(session, file.name);
      setPayload(next);
      setStatus(`Loaded preview source from ${file.name}.`);
    } catch {
      setStatus(`Could not load ${file.name}.`);
    }
  }, []);

  const handleImportConstellations = useCallback(async (file: File) => {
    try {
      const next = JSON.parse(await file.text()) as ConstellationConfig;
      if (!next?.version || !Array.isArray(next.constellations)) throw new Error("Invalid constellations file.");
      setConstellationConfig(next);
      savePipelineConstellations(next);
      setConstellationSource("custom");
      setStatus(`Loaded custom constellations from ${file.name}.`);
    } catch {
      setStatus(`Could not load ${file.name}.`);
    }
  }, []);

  const sourceLabel = payload
    ? payload.source === "autosave"
      ? "Browser autosave"
      : payload.source === "session"
        ? "Refine session"
        : "Arrangement"
    : null;

  const handleCameraChange = useCallback((lon: number, lat: number, fov: number) => {
    setCurrentCamera({ lon, lat, fov });
    setCurrentFov(fov);
  }, []);

  const handleConstellationLinesChange = useCallback((checked: boolean) => {
    setTriangulationMode(checked ? "focused" : "off");
  }, []);

  const handleConstellationLinesAlwaysOnChange = useCallback((checked: boolean) => {
    setTriangulationMode(checked ? "full" : "focused");
  }, []);

  const applyHierarchyFilter = useCallback((filter: HierarchyFilter | null) => {
    setFilterTestament(filter?.testament ?? "");
    setFilterDivision(filter?.division ?? "");
    setFilterBook(filter?.bookKey ?? "");
    mapRef.current?.setHierarchyFilter(filter);
  }, []);

  const handleNudgeTargetKindChange = useCallback((kind: NudgeTargetKind) => {
    setNudgeTarget({ kind, id: "", mode: "position" });
    setNudgeStatus("Choose a target.");
  }, []);

  const handleNudgeTargetIdChange = useCallback((id: string) => {
    setNudgeTarget((current) => ({ ...current, id }));
    setNudgeStatus("Target changed.");
  }, []);

  const handleHighlightNudgeTarget = useCallback(() => {
    if (!nudgeTarget.id) {
      setNudgeStatus("Choose a nudge target first.");
      return;
    }

    if (nudgeTarget.kind === "star") {
      const node = nudgeSelectedStar;
      if (!node) return;
      setSelectedNode(node);
      mapRef.current?.flyTo(node.id, 18);
      setNudgeStatus(`Highlighted ${node.label}.`);
      return;
    }

    if (nudgeTarget.kind === "book") {
      const node = nudgeSelectedBook;
      const bookKey = node?.meta?.bookKey as string | undefined;
      const division = node?.meta?.division as string | undefined;
      const testament = model?.nodes.find((candidate) => candidate.id === node?.parent)?.meta?.testament as string | undefined;
      if (!node || !bookKey || !division || !testament) return;
      setSelectedNode(node);
      applyHierarchyFilter({ testament, division, bookKey });
      mapRef.current?.setFocusedBook(node.id);
      mapRef.current?.flyTo(node.id, 26);
      setNudgeStatus(`Highlighted ${node.label}.`);
      return;
    }

    if (nudgeSelectedArtwork) {
      setSelectedNode({ id: nudgeSelectedArtwork.id, label: nudgeSelectedArtwork.title, level: -1 });
      setShowConstellationArt(true);
      mapRef.current?.flyTo(nudgeSelectedArtwork.id, 28);
      setNudgeStatus(`Highlighted ${nudgeSelectedArtwork.title}.`);
    }
  }, [applyHierarchyFilter, model?.nodes, nudgeSelectedArtwork, nudgeSelectedBook, nudgeSelectedStar, nudgeTarget.id, nudgeTarget.kind]);

  const handleNudgeKey = useCallback((key: string) => {
    if (!nudgeTarget.id || !payload) return false;
    const movementKeys = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]);
    const rotationKeys = new Set(["q", "Q", "e", "E", "[", "]"]);
    const isMovement = movementKeys.has(key);
    const isRotation = rotationKeys.has(key);
    if (!isMovement && !isRotation) return false;
    if (nudgeTarget.kind === "artwork" && nudgeTarget.mode === "position" && isRotation) return false;

    if (nudgeTarget.kind === "artwork" && nudgeTarget.mode === "rotation") {
      const delta = key === "ArrowLeft" || key === "ArrowDown" || key === "q" || key === "Q" || key === "["
        ? -nudgeStepDeg
        : nudgeStepDeg;
      setConstellationConfig((current) => {
        if (!current) return current;
        const next = {
          ...current,
          constellations: current.constellations.map((item) => (
            item.id === nudgeTarget.id
              ? { ...item, rotationDeg: Number(((item.rotationDeg ?? 0) + delta).toFixed(4)) }
              : item
          )),
        };
        savePipelineConstellations(next);
        return next;
      });
      setConstellationSource("custom");
      setNudgeStatus(`Rotated ${nudgeSelectedArtwork?.title ?? nudgeTarget.id} ${delta > 0 ? "+" : ""}${delta.toFixed(2)} deg.`);
      return true;
    }

    if (!isMovement) return false;

    if (nudgeTarget.kind === "artwork") {
      setConstellationConfig((current) => {
        if (!current) return current;
        const next = {
          ...current,
          constellations: current.constellations.map((item) => {
            if (item.id !== nudgeTarget.id) return item;
            const currentCenter = item.center?.length === 3
              ? item.center as Vec3Tuple
              : payload.arrangement[item.id]?.center ?? [0, ARRANGEMENT_RADIUS, 0] as Vec3Tuple;
            return { ...item, center: nudgeSkyPosition(currentCenter, key, nudgeStepDeg) };
          }),
        };
        savePipelineConstellations(next);
        return next;
      });
      setConstellationSource("custom");
      setNudgeStatus(`Moved ${nudgeSelectedArtwork?.title ?? nudgeTarget.id}.`);
      return true;
    }

    const ids = nudgeTarget.kind === "book"
      ? chapterNodes.filter((node) => node.parent === nudgeTarget.id).map((node) => node.id)
      : [nudgeTarget.id];
    if (ids.length === 0) return false;

    setPayload((current) => {
      if (!current) return current;
      const arrangement = nudgeArrangementPositions(current.arrangement, ids, key, nudgeStepDeg);
      const next = { ...current, arrangement };
      savePipelineArrangement(arrangement);
      return next;
    });
    setNudgeStatus(`Moved ${nudgeTarget.kind === "book" ? nudgeSelectedBook?.label ?? nudgeTarget.id : nudgeSelectedStar?.label ?? nudgeTarget.id}.`);
    return true;
  }, [chapterNodes, nudgeSelectedArtwork?.title, nudgeSelectedBook?.label, nudgeSelectedStar?.label, nudgeStepDeg, nudgeTarget.id, nudgeTarget.kind, payload]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, button")) return;
      if (handleNudgeKey(event.key)) event.preventDefault();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleNudgeKey]);

  const handleSelectNode = useCallback((node: SceneNode) => {
    setSelectedNode(node);
    const chapter = getNodeChapter(node);
    setFilterTestStatus(
      chapter
        ? `Selected guest star: ${chapterTitle(chapter)}.`
        : "Selected object is not a chapter star.",
    );
  }, []);

  const handleApplyYesNarrowing = useCallback(() => {
    if (!selectedChapter) {
      setFilterTestStatus("Select a chapter star before applying Yes narrowing.");
      return;
    }
    const match = getYesFilterMatch(selectedChapter, answerChapter);
    applyHierarchyFilter(match.filter);
    setFilterTestStatus(match.filter ? `Applied ${match.label}.` : match.label);
  }, [answerChapter, applyHierarchyFilter, selectedChapter]);

  const handleUseTodayAnswer = useCallback(() => {
    const index = getTodayChapterIndex();
    setAnswerChapterIndex(index);
    setFilterTestStatus(`Today's answer set to ${chapterTitle(CANON[index]!)}.`);
  }, []);

  const handleFlyToSelectedStar = useCallback(() => {
    if (!selectedChapter || !selectedNode) return;
    mapRef.current?.flyTo(selectedNode.id, 18);
  }, [selectedChapter, selectedNode]);

  const handleFlyToAnswerStar = useCallback(() => {
    mapRef.current?.flyTo(getChapterNodeId(answerChapter), 18);
  }, [answerChapter]);

  const handleRefreshViewport = useCallback(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        mapRef.current?.resize();
      });
    });
  }, []);

  useEffect(() => {
    mapRef.current?.setInteractionEnabled(!isSidebarHovered);
  }, [isSidebarHovered]);

  return (
    <BuilderWorkspace
      route="preview"
      title="Preview"
      subtitle=""
      sidebarWidthClass="w-144"
      collapsibleSidebar
      onSidebarHoverChange={setIsSidebarHovered}
      onRefreshViewport={handleRefreshViewport}
      sidebar={
        <>
          {!payload ? (
            <BuilderSection label="Load Source">
              <p className="text-[10px] leading-relaxed text-white/20">
                Load an `arrangement.json` or a `skymap-session.json` exported from Refine. If you have just been in Refine, Preview will also try the latest autosaved refine session.
              </p>
              <FileInput label="Load arrangement" filename="arrangement.json" onChange={handleImportArrangement} />
              <FileInput label="Load session" filename="skymap-session.json" onChange={handleImportSession} />
              <FileInput label="Load constellations" filename="constellations.json" onChange={handleImportConstellations} />
            </BuilderSection>
          ) : (
            <>
              <BuilderSection label="Source">
                <div className="rounded-md border border-white/8 bg-white/[0.03] px-2.5 py-2">
                  <div className="flex items-center justify-between text-xs text-white/48">
                    <span>Type</span>
                    <span className="text-white/72">{sourceLabel}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between text-xs text-white/48">
                    <span>Chapters in preview</span>
                    <span className="tabular-nums text-white/72">{arrangementCount.toLocaleString()}</span>
                  </div>
                  {payload.filename && (
                    <div className="mt-1 text-[10px] text-white/28">{payload.filename}</div>
                  )}
                </div>
                <div className="flex gap-2">
                  <FileInput label="Replace arrangement" filename="arrangement.json" onChange={handleImportArrangement} compact />
                  <FileInput label="Replace session" filename="skymap-session.json" onChange={handleImportSession} compact />
                  <FileInput label="Constellations" filename="constellations.json" onChange={handleImportConstellations} compact />
                </div>
              </BuilderSection>

              <BuilderSection label="Atmosphere">
                <Toggle label="Division labels" checked={showDivisionLabels} onChange={setShowDivisionLabels} />
                <Toggle label="Division tint" checked={showDivisionTint} onChange={setShowDivisionTint} />
                <Toggle label="Book labels" checked={showBookLabels} onChange={setShowBookLabels} />
                <Toggle label="Chapter labels" checked={showChapterLabels} onChange={setShowChapterLabels} />
                <label className="flex flex-col gap-1 text-xs text-white/52">
                  <span>Ground caption text</span>
                  <textarea
                    value={groundCaptionText}
                    onChange={(event) => setGroundCaptionText(event.target.value)}
                    placeholder="Passage summary…"
                    rows={2}
                    className="w-full resize-none rounded border border-white/10 bg-white/[0.03] px-2 py-1.5 text-xs text-white/78 placeholder:text-white/25"
                  />
                </label>
                <Toggle label="Constellation lines" checked={triangulationMode !== "off"} onChange={handleConstellationLinesChange} />
                {triangulationMode !== "off" && (
                  <Toggle label="Keep lines always on" checked={triangulationMode === "full"} onChange={handleConstellationLinesAlwaysOnChange} />
                )}
                <Toggle label="Constellation art" checked={showConstellationArt} onChange={setShowConstellationArt} />
                <Toggle label="Visible hemisphere" checked={useVisibleHemisphere} onChange={setUseVisibleHemisphere} />
                <Toggle label="Backdrop stars" checked={showBackdropStars} onChange={setShowBackdropStars} />
                <Toggle label="Atmosphere" checked={showAtmosphere} onChange={setShowAtmosphere} />
                <Toggle label="Moon" checked={showMoon} onChange={setShowMoon} />
                <Toggle label="Sunrise" checked={showSunrise} onChange={setShowSunrise} />
                <Toggle label="Milky Way" checked={showMilkyWay} onChange={setShowMilkyWay} />
              </BuilderSection>

              <BuilderSection label="Filter">
                <p className="text-[10px] leading-relaxed text-white/20">
                  Simulate the Bible Game narrowing. Select a testament to filter, then optionally narrow to a division or book.
                </p>
                <SelectRow
                  label="Testament"
                  value={filterTestament}
                  onChange={(v) => {
                    setFilterTestament(v);
                    setFilterDivision("");
                    setFilterBook("");
                  }}
                  options={[{ value: "", label: "All" }, ...filterTestaments.map((t) => ({ value: t.id, label: t.label }))]}
                />
                {filterTestament && (
                  <SelectRow
                    label="Division"
                    value={filterDivision}
                    onChange={(v) => {
                      setFilterDivision(v);
                      setFilterBook("");
                    }}
                    options={[{ value: "", label: "All divisions" }, ...filterDivisions.map((d) => ({ value: d.id, label: d.label }))]}
                  />
                )}
                {filterDivision && (
                  <SelectRow
                    label="Book"
                    value={filterBook}
                    onChange={(v) => setFilterBook(v)}
                    options={[{ value: "", label: "All books" }, ...filterBooks.map((b) => ({ value: b.id, label: b.label }))]}
                  />
                )}
              </BuilderSection>

              <BuilderSection label="Selected Star">
                <div className="rounded-md border border-white/8 bg-white/[0.03] px-2.5 py-2">
                  {selectedChapter ? (
                    <>
                      <div className="flex items-center justify-between gap-3 text-xs text-white/48">
                        <span>Guest</span>
                        <span className="text-right text-white/78">{chapterTitle(selectedChapter)}</span>
                      </div>
                      <div className="mt-1 flex items-center justify-between gap-3 text-[10px] text-white/35">
                        <span>Testament</span>
                        <span className="text-right">{selectedChapter.testament}</span>
                      </div>
                      <div className="mt-1 flex items-center justify-between gap-3 text-[10px] text-white/35">
                        <span>Division</span>
                        <span className="text-right">{selectedChapter.divisionName}</span>
                      </div>
                      <div className="mt-1 flex items-center justify-between gap-3 text-[10px] text-white/35">
                        <span>Book key</span>
                        <span className="font-mono text-right">{selectedChapter.bookKey}</span>
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={handleFlyToSelectedStar}
                          className="rounded border border-sky-300/20 bg-sky-300/[0.08] px-2 py-1.5 text-[10px] text-sky-100/70 transition-colors hover:bg-sky-300/[0.14]"
                        >
                          Fly to guest
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedNode(null);
                            setFilterTestStatus("Cleared guest star selection.");
                          }}
                          className="rounded border border-white/10 bg-white/[0.05] px-2 py-1.5 text-[10px] text-white/55 transition-colors hover:bg-white/[0.09] hover:text-white/75"
                        >
                          Clear guest
                        </button>
                      </div>
                    </>
                  ) : selectedNode ? (
                    <>
                      <div className="flex items-center justify-between gap-3 text-xs text-white/48">
                        <span>Selected</span>
                        <span className="text-right text-white/78">{selectedNode.label}</span>
                      </div>
                      <p className="mt-1 text-[10px] text-white/25">Select a chapter star to test Bible Game narrowing.</p>
                    </>
                  ) : (
                    <p className="text-[10px] text-white/25">Click a star in the sky to make it the guest star.</p>
                  )}
                </div>
              </BuilderSection>

              <BuilderSection label="Game Test">
                <div className="rounded-md border border-white/8 bg-white/[0.03] px-2.5 py-2">
                  <div className="flex items-center justify-between gap-3 text-xs text-white/48">
                    <span>Answer</span>
                    <span className="text-right text-white/78">{chapterTitle(answerChapter)}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-3 text-[10px] text-white/35">
                    <span>Division</span>
                    <span className="text-right">{answerChapter.divisionName}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-3 text-[10px] text-white/35">
                    <span>Current filter</span>
                    <span className="text-right">{currentFilterLabel}</span>
                  </div>
                </div>
                <label className="flex items-center justify-between gap-3 text-xs text-white/52">
                  <span>Answer #</span>
                  <input
                    type="number"
                    min={1}
                    max={CANON.length}
                    value={answerChapterIndex + 1}
                    onChange={(event) => {
                      const next = Math.max(1, Math.min(CANON.length, Number(event.target.value) || 1));
                      setAnswerChapterIndex(next - 1);
                    }}
                    className="w-24 rounded border border-white/10 bg-white/[0.03] px-2 py-1 text-right text-xs text-white/78"
                  />
                </label>
                <div className="grid grid-cols-4 gap-2">
                  <button
                    type="button"
                    onClick={handleApplyYesNarrowing}
                    disabled={!selectedChapter}
                    className="rounded border border-white/10 bg-white/[0.05] px-2 py-1.5 text-[10px] text-white/55 transition-colors hover:bg-white/[0.09] hover:text-white/75 disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    Yes
                  </button>
                  <button
                    type="button"
                    onClick={handleUseTodayAnswer}
                    className="rounded border border-white/10 bg-white/[0.05] px-2 py-1.5 text-[10px] text-white/55 transition-colors hover:bg-white/[0.09] hover:text-white/75"
                  >
                    Today
                  </button>
                  <button
                    type="button"
                    onClick={handleFlyToAnswerStar}
                    className="rounded border border-amber-300/20 bg-amber-300/[0.08] px-2 py-1.5 text-[10px] text-amber-100/70 transition-colors hover:bg-amber-300/[0.14]"
                  >
                    Fly
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      applyHierarchyFilter(null);
                      setFilterTestStatus("Cleared hierarchy filter.");
                    }}
                    className="rounded border border-white/10 bg-white/[0.05] px-2 py-1.5 text-[10px] text-white/55 transition-colors hover:bg-white/[0.09] hover:text-white/75"
                  >
                    Clear
                  </button>
                </div>
                <p className="text-[10px] leading-relaxed text-white/28">{filterTestStatus}</p>
              </BuilderSection>

              <BuilderSection label="Tuning">
                <SelectRow
                  label="View mode"
                  value={viewMode}
                  onChange={(value) => setViewMode(value as PlanetariumViewMode)}
                  options={[
                    { value: "zenith", label: "Zenith" },
                    { value: "immersive", label: "Immersive" },
                    { value: "hybrid", label: "Hybrid" },
                  ]}
                />
                <div className={`flex flex-col gap-3 rounded-md border border-white/8 bg-white/[0.03] p-2.5 transition-opacity ${viewMode === "zenith" ? "opacity-100" : "opacity-45"}`}>
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] uppercase tracking-widest text-white/22">Zenith Horizon</p>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-white/25">{viewMode === "zenith" ? "Active" : "Inactive"}</span>
                      <button
                        type="button"
                        onClick={handleResetZenithHorizonTuning}
                        className="text-[10px] text-white/35 transition-colors hover:text-white/65"
                      >
                        Reset
                      </button>
                    </div>
                  </div>
                  <SliderRow
                    label="Ground alpha"
                    value={zenithHorizonTuning.groundAlpha}
                    min={0}
                    max={1}
                    step={0.01}
                    onChange={(value) => updateZenithHorizonTuning({ groundAlpha: value })}
                  />
                  <SliderRow
                    label="Horizon shape"
                    value={zenithHorizonTuning.horizonFlattening}
                    min={0}
                    max={1}
                    step={0.01}
                    onChange={(value) => updateZenithHorizonTuning({ horizonFlattening: value })}
                  />
                  <SliderRow
                    label="Rim warp"
                    value={zenithHorizonTuning.horizonWarp}
                    min={0}
                    max={0.45}
                    step={0.01}
                    onChange={(value) => updateZenithHorizonTuning({ horizonWarp: value })}
                  />
                  <SliderRow
                    label="Rim haze"
                    value={zenithHorizonTuning.hazeStrength}
                    min={0}
                    max={1}
                    step={0.01}
                    onChange={(value) => updateZenithHorizonTuning({ hazeStrength: value })}
                  />
                  <SliderRow
                    label="Rim line"
                    value={zenithHorizonTuning.rimStrength}
                    min={0}
                    max={1}
                    step={0.01}
                    onChange={(value) => updateZenithHorizonTuning({ rimStrength: value })}
                  />
                  <SliderRow
                    label="Landscape opacity"
                    value={zenithHorizonTuning.landscapeOpacity}
                    min={0}
                    max={1}
                    step={0.01}
                    onChange={(value) => updateZenithHorizonTuning({ landscapeOpacity: value })}
                  />
                  <SliderRow
                    label="Landscape height"
                    value={zenithHorizonTuning.landscapeHeight}
                    min={0}
                    max={18}
                    step={0.25}
                    onChange={(value) => updateZenithHorizonTuning({ landscapeHeight: value })}
                  />
                  <SliderRow
                    label="Landscape softness"
                    value={zenithHorizonTuning.landscapeSoftness}
                    min={0}
                    max={0.8}
                    step={0.01}
                    onChange={(value) => updateZenithHorizonTuning({ landscapeSoftness: value })}
                  />
                </div>
                <div className={`flex flex-col gap-3 rounded-md border border-white/8 bg-white/[0.03] p-2.5 transition-opacity ${viewMode === "immersive" ? "opacity-100" : "opacity-45"}`}>
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] uppercase tracking-widest text-white/22">Immersive</p>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-white/25">{viewMode === "immersive" ? "Active" : "Inactive"}</span>
                      <button
                        type="button"
                        onClick={handleResetImmersiveTuning}
                        className="text-[10px] text-white/35 transition-colors hover:text-white/65"
                      >
                        Reset
                      </button>
                    </div>
                  </div>
                  <SliderRow
                    label="Star scale"
                    value={immersiveTuning.starScale}
                    min={0.25}
                    max={1.25}
                    step={0.01}
                    onChange={(value) => updateImmersiveTuning({ starScale: value })}
                  />
                  <SliderRow
                    label="Backdrop count"
                    value={immersiveTuning.backdropCount}
                    min={1000}
                    max={12000}
                    step={250}
                    onChange={(value) => updateImmersiveTuning({ backdropCount: value })}
                  />
                  <SliderRow
                    label="Backdrop gain"
                    value={immersiveTuning.backdropGain}
                    min={0}
                    max={1}
                    step={0.01}
                    onChange={(value) => updateImmersiveTuning({ backdropGain: value })}
                  />
                  <SliderRow
                    label="Backdrop energy"
                    value={immersiveTuning.backdropEnergy}
                    min={0.5}
                    max={5}
                    step={0.05}
                    onChange={(value) => updateImmersiveTuning({ backdropEnergy: value })}
                  />
                  <SliderRow
                    label="Horizon shape"
                    value={immersiveTuning.horizonFlattening}
                    min={0}
                    max={1}
                    step={0.01}
                    onChange={(value) => updateImmersiveTuning({ horizonFlattening: value })}
                  />
                  <SliderRow
                    label="Horizon warp"
                    value={immersiveTuning.horizonWarp}
                    min={0}
                    max={1}
                    step={0.01}
                    onChange={(value) => updateImmersiveTuning({ horizonWarp: value })}
                  />
                  <SliderRow
                    label="Haze strength"
                    value={immersiveTuning.hazeStrength}
                    min={0}
                    max={1}
                    step={0.01}
                    onChange={(value) => updateImmersiveTuning({ hazeStrength: value })}
                  />
                </div>
                <SelectRow
                  label="Horizon theme"
                  value={selectedHorizonThemeId}
                  onChange={setSelectedHorizonThemeId}
                  options={HORIZON_THEMES.map((theme) => ({ value: theme.id, label: theme.label }))}
                />
                <SelectRow
                  label="Horizon colour"
                  value={horizonColorMode}
                  onChange={(value) => setHorizonColorMode(value as HorizonColorMode)}
                  options={[
                    { value: "light", label: "Light" },
                    { value: "dark", label: "Dark" },
                    { value: "custom", label: "Custom" },
                  ]}
                />
                {horizonColorMode === "custom" && (
                  <div className="flex flex-col gap-3 rounded-md border border-white/8 bg-white/[0.03] p-2.5">
                    <SelectRow
                      label="Custom fill"
                      value={customHorizon.fill}
                      onChange={(value) => updateCustomHorizon({ fill: value as CustomHorizonFill })}
                      options={[
                        { value: "solid", label: "Solid" },
                        { value: "radial", label: "Radial" },
                      ]}
                    />
                    <ColorRow
                      label="Ground"
                      value={customHorizon.groundColor}
                      onChange={(value) => updateCustomHorizon({ groundColor: value })}
                    />
                    <ColorRow
                      label="Rim / fog"
                      value={customHorizon.horizonLineColor}
                      onChange={(value) => updateCustomHorizon({ horizonLineColor: value })}
                    />
                    {customHorizon.fill === "radial" && (
                      <>
                        <ColorRow
                          label="Gradient inner"
                          value={customHorizon.gradientInnerColor}
                          onChange={(value) => updateCustomHorizon({ gradientInnerColor: value })}
                        />
                        <ColorRow
                          label="Gradient outer"
                          value={customHorizon.gradientOuterColor}
                          onChange={(value) => updateCustomHorizon({ gradientOuterColor: value })}
                        />
                        <SliderRow
                          label="Gradient radius"
                          value={customHorizon.gradientRadius}
                          min={0.15}
                          max={2.5}
                          step={0.05}
                          onChange={(value) => updateCustomHorizon({ gradientRadius: value })}
                        />
                        <SliderRow
                          label="Gradient strength"
                          value={customHorizon.gradientIntensity}
                          min={0}
                          max={1}
                          step={0.05}
                          onChange={(value) => updateCustomHorizon({ gradientIntensity: value })}
                        />
                      </>
                    )}
                    <button
                      type="button"
                      onClick={handleResetCustomHorizon}
                      className="text-left text-[10px] uppercase tracking-widest text-white/30 transition-colors hover:text-white/65"
                    >
                      Reset to config defaults
                    </button>
                  </div>
                )}
                <SliderRow
                  label="Chapter label FOV"
                  value={chapterLabelMaxFov}
                  min={8}
                  max={48}
                  step={1}
                  onChange={setChapterLabelMaxFov}
                />
                <SliderRow
                  label="Division label spread"
                  value={divisionLabelPushFraction}
                  min={0}
                  max={1.2}
                  step={0.05}
                  onChange={setDivisionLabelPushFraction}
                />
                <SliderRow
                  label="Division label horizon padding"
                  value={divisionLabelHorizonPaddingDeg}
                  min={0}
                  max={45}
                  step={1}
                  onChange={setDivisionLabelHorizonPaddingDeg}
                />
                <SliderRow
                  label="Artwork opacity"
                  value={constellationBaseOpacity}
                  min={0}
                  max={120}
                  step={1}
                  onChange={setConstellationBaseOpacity}
                />
                <SliderRow
                  label="Star size curve"
                  value={starSizeExponent}
                  min={1}
                  max={8}
                  step={0.1}
                  onChange={setStarSizeExponent}
                />
                <SliderRow
                  label="Star size scale"
                  value={starSizeScale}
                  min={0.1}
                  max={10}
                  step={0.05}
                  onChange={setStarSizeScale}
                />
                <SliderRow
                  label="Size cap percentile"
                  value={starSizeWeightPercentile}
                  min={0.5}
                  max={1}
                  step={0.01}
                  onChange={setStarSizeWeightPercentile}
                />
              </BuilderSection>

              <BuilderSection label="Camera">
                <div className="rounded-md border border-white/8 bg-white/[0.03] px-2.5 py-2 font-mono">
                  <div className="flex items-center justify-between text-[10px] text-white/48">
                    <span>FOV</span>
                    <span className="text-white/80">{currentFov.toFixed(1)}°</span>
                  </div>
                  {currentCamera ? (
                    <>
                      <div className="flex items-center justify-between text-[10px] text-white/48">
                        <span>Lon</span>
                        <span className="text-white/80">{(currentCamera.lon * 180 / Math.PI).toFixed(1)}°</span>
                      </div>
                      <div className="mt-1 flex items-center justify-between text-[10px] text-white/48">
                        <span>Lat</span>
                        <span className="text-white/80">{(currentCamera.lat * 180 / Math.PI).toFixed(1)}°</span>
                      </div>
                    </>
                  ) : (
                    <p className="mt-1 text-[10px] text-white/22">Pan or zoom the sky to see camera position.</p>
                  )}
                </div>
                {currentCamera && (
                    <CameraSnippet lon={currentCamera.lon} lat={currentCamera.lat} fov={currentCamera.fov} />
                )}
                <Toggle label="Edge panning" checked={edgePanEnabled} onChange={setEdgePanEnabled} />
              </BuilderSection>

              <BuilderSection label="Nudge">
                <SelectRow
                  label="Target"
                  value={nudgeTarget.kind}
                  onChange={(value) => handleNudgeTargetKindChange(value as NudgeTargetKind)}
                  options={[
                    { value: "artwork", label: "Artwork" },
                    { value: "book", label: "Book stars" },
                    { value: "star", label: "Chapter star" },
                  ]}
                />
                {nudgeTarget.kind === "artwork" && (
                  <>
                    <SelectRow
                      label="Artwork"
                      value={nudgeTarget.id}
                      onChange={handleNudgeTargetIdChange}
                      options={[
                        { value: "", label: "None" },
                        ...visibleConstellationItems.map((item) => ({ value: item.id, label: item.title })),
                      ]}
                    />
                    <SelectRow
                      label="Mode"
                      value={nudgeTarget.mode}
                      onChange={(value) => setNudgeTarget((current) => ({ ...current, mode: value as NudgeMoveMode }))}
                      options={[
                        { value: "position", label: "Position" },
                        { value: "rotation", label: "Rotation" },
                      ]}
                    />
                  </>
                )}
                {nudgeTarget.kind === "book" && (
                  <SelectRow
                    label="Book"
                    value={nudgeTarget.id}
                    onChange={handleNudgeTargetIdChange}
                    options={[
                      { value: "", label: "None" },
                      ...bookNodes.map((node) => ({ value: node.id, label: node.label })),
                    ]}
                  />
                )}
                {nudgeTarget.kind === "star" && (
                  <SelectRow
                    label="Star"
                    value={nudgeTarget.id}
                    onChange={handleNudgeTargetIdChange}
                    options={[
                      { value: "", label: "None" },
                      ...chapterNodes.map((node) => ({ value: node.id, label: node.label })),
                    ]}
                  />
                )}
                <SliderRow
                  label={nudgeTarget.mode === "rotation" ? "Rotation step" : "Move step"}
                  value={nudgeStepDeg}
                  min={0.05}
                  max={3}
                  step={0.05}
                  onChange={setNudgeStepDeg}
                />
                <div className="rounded-md border border-white/8 bg-white/[0.03] px-2.5 py-2">
                  <div className="flex items-center justify-between text-[10px] text-white/38">
                    <span>Position</span>
                    <span className="font-mono text-white/60">{formatVec(nudgePosition)}</span>
                  </div>
                  {nudgeTarget.kind === "artwork" && (
                    <div className="mt-1 flex items-center justify-between text-[10px] text-white/38">
                      <span>Rotation</span>
                      <span className="font-mono text-white/60">{(nudgeSelectedArtwork?.rotationDeg ?? 0).toFixed(2)} deg</span>
                    </div>
                  )}
                </div>
                <div>
                  <button
                    type="button"
                    onClick={handleHighlightNudgeTarget}
                    className="w-full rounded border border-sky-300/20 bg-sky-300/[0.08] px-2 py-1.5 text-[10px] text-sky-100/70 transition-colors hover:bg-sky-300/[0.14]"
                  >
                    Fly to target
                  </button>
                </div>
                <p className="text-[10px] leading-relaxed text-white/28">
                  {nudgeTarget.mode === "rotation" && nudgeTarget.kind === "artwork"
                    ? "Use arrow keys to rotate the selected artwork."
                    : "Use arrow keys to move the selected target across the sky."}
                </p>
                <p className="text-[10px] leading-relaxed text-white/34">{nudgeStatus}</p>
              </BuilderSection>

              <BuilderSection label="Status">
                <div className="rounded-md border border-white/8 bg-white/[0.03] px-2.5 py-2">
                  <p className="text-[10px] uppercase tracking-widest text-white/22">Preview</p>
                  <p className="mt-1 text-xs text-white/52">{status}</p>
                  <p className="mt-1 text-[10px] text-white/28">Mode: {useVisibleHemisphere ? "Visible cap" : "Physical hemisphere"}</p>
                  <p className="mt-1 text-[10px] text-white/28">Lines: {triangulationMode}</p>
                  <p className="mt-1 text-[10px] text-white/28">Constellations: {constellationSource}</p>
                  {lastSavedLabel && (
                    <p className="mt-1 text-[10px] text-white/28">Autosave: {lastSavedLabel}</p>
                  )}
                </div>
                <button
                  onClick={() => optimizedArrangement && downloadJson(optimizedArrangement, "arrangement.json")}
                  className="text-left text-xs text-white/45 transition-colors hover:text-white/70"
                >
                  Export arrangement.json
                </button>
                <button
                  onClick={() => constellationConfig && downloadJson(constellationConfig, "constellations.json")}
                  className="text-left text-xs text-white/45 transition-colors hover:text-white/70"
                >
                  Export constellations.json
                </button>
                <Link href="/constellate" className="text-left text-xs text-white/45 transition-colors hover:text-white/70">
                  Return to Constellate
                </Link>
              </BuilderSection>
            </>
          )}
        </>
      }
    >
      {config ? (
        <div className="relative h-full">
          <StarMap
            ref={mapRef}
            config={config}
            className="h-full w-full"
            onFovChange={setCurrentFov}
            onCameraChange={handleCameraChange}
            onSelect={handleSelectNode}
          />
        </div>
      ) : (
        <div className="flex h-full items-center justify-center">
          <p className="text-sm text-white/10">load refined output to preview the planetarium</p>
        </div>
      )}
    </BuilderWorkspace>
  );
}

function Toggle({ label, checked, onChange }: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between text-xs text-white/52">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="accent-indigo-400"
      />
    </label>
  );
}

function SliderRow({ label, value, min, max, step, onChange }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-xs text-white/48">
        <span>{label}</span>
        <span className="tabular-nums text-white/72">{value.toFixed(step < 1 ? 2 : 0)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full accent-indigo-400"
      />
    </div>
  );
}

function ColorRow({ label, value, onChange }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const pickerValue = /^#[0-9a-fA-F]{6}$/.test(value) ? value : "#000000";
  return (
    <label className="flex items-center justify-between gap-3 text-xs text-white/52">
      <span>{label}</span>
      <span className="flex items-center gap-2">
        <input
          type="color"
          value={pickerValue}
          onChange={(event) => onChange(event.target.value)}
          className="h-7 w-8 rounded border border-white/10 bg-transparent p-0"
        />
        <input
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="w-20 rounded border border-white/10 bg-white/[0.03] px-2 py-1 font-mono text-[10px] text-white/78"
        />
      </span>
    </label>
  );
}

function SelectRow({ label, value, onChange, options }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="flex items-center justify-between gap-3 text-xs text-white/52">
      <span>{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="rounded border border-white/10 bg-white/[0.03] px-2 py-1 text-xs text-white/78"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

function FileInput({ label, filename, onChange, compact = false }: {
  label: string;
  filename: string;
  onChange: (file: File) => void;
  compact?: boolean;
}) {
  return (
    <label className={`flex ${compact ? "flex-1" : "flex-col gap-1"} cursor-pointer`}>
      {!compact && <span className="text-[10px] uppercase tracking-widest text-white/30">{label}</span>}
      <div className={`text-xs text-white/55 bg-white/5 border border-white/10 rounded px-3 py-2 hover:bg-white/8 transition-colors text-center ${compact ? "w-full" : ""}`}>
        {compact ? label : filename}
      </div>
      <input
        type="file"
        accept=".json"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onChange(file);
          event.currentTarget.value = "";
        }}
      />
    </label>
  );
}

function CameraSnippet({ lon, lat, fov }: { lon: number; lat: number; fov: number }) {
  const [copied, setCopied] = useState(false);
  const lonRad = lon.toFixed(4);
  const latRad = lat.toFixed(4);
  const snippet = `camera: { lon: ${lonRad}, lat: ${latRad} },\ninitialFov: ${fov.toFixed(1)},`;

  function copy() {
    navigator.clipboard.writeText(snippet).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className="rounded-md border border-white/8 bg-white/[0.03] px-2.5 py-2">
      <div className="flex items-center justify-between">
        <p className="text-[10px] uppercase tracking-widest text-white/22">Config snippet</p>
        <button
          onClick={copy}
          className="text-[10px] text-white/40 transition-colors hover:text-white/70"
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <pre className="mt-1.5 whitespace-pre-wrap break-all font-mono text-[9px] leading-relaxed text-white/55">
        {snippet}
      </pre>
    </div>
  );
}
