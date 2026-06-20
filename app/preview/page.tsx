"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { HierarchyFilter, HorizonThemeConfig, StarArrangement, StarMapConfig, StarMapHandle } from "@project-skymap/library";
import { StarMap } from "@project-skymap/library";
import type { Session } from "../assign/session";
import { importSession } from "../assign/session";
import { BuilderSection, BuilderWorkspace } from "../components/BuilderWorkspace";
import {
  buildTriangulatedConstellations,
  buildArrangementFromSession,
  buildModelFromArrangement,
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

const PREVIEW_STORAGE_KEY = "skymap-preview-arrangement";
const PREVIEW_HORIZON_SETTINGS_KEY = "skymap-preview-horizon-settings";
const REFINE_STORAGE_KEY = "skymap-refine-session";

type PreviewPayload = {
  arrangement: StarArrangement;
  source: "arrangement" | "session" | "autosave";
  filename?: string;
};

function downloadJson(data: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function loadPreviewPayload(): PreviewPayload | null {
  if (typeof window === "undefined") return null;
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

function buildPreviewPayloadFromArrangement(arrangement: StarArrangement, filename?: string): PreviewPayload {
  return { arrangement, source: "arrangement", filename };
}

function buildPreviewPayloadFromSession(session: Session, filename?: string): PreviewPayload {
  return { arrangement: buildArrangementFromSession(session), source: "session", filename };
}

export default function PreviewPage() {
  const mapRef = useRef<StarMapHandle>(null);
  const [horizonSettingsLoaded, setHorizonSettingsLoaded] = useState(false);
  const [payload, setPayload] = useState<PreviewPayload | null>(null);
  const [status, setStatus] = useState("No preview source loaded yet.");
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [currentFov, setCurrentFov] = useState(35);
  const [currentCamera, setCurrentCamera] = useState<{ lon: number; lat: number; fov: number } | null>(null);
  const [showDivisionLabels, setShowDivisionLabels] = useState(true);
  const [showDivisionTint, setShowDivisionTint] = useState(true);
  const [showBookLabels, setShowBookLabels] = useState(false);
  const [showChapterLabels, setShowChapterLabels] = useState(false);
  const [showConstellationArt, setShowConstellationArt] = useState(false);
  const [showBackdropStars, setShowBackdropStars] = useState(false);
  const [showAtmosphere, setShowAtmosphere] = useState(false);
  const [showMoon, setShowMoon] = useState(false);
  const [showSunrise, setShowSunrise] = useState(false);
  const [showMilkyWay, setShowMilkyWay] = useState(false);
  const [triangulationMode, setTriangulationMode] = useState<"off" | "focused" | "full">("off");
  const [useVisibleHemisphere, setUseVisibleHemisphere] = useState(false);
  const [projection, setProjection] = useState<"perspective" | "stereographic" | "blended">("blended");
  const [chapterLabelMaxFov, setChapterLabelMaxFov] = useState(22);
  const [constellationBaseOpacity, setConstellationBaseOpacity] = useState(40);
  const [starSizeExponent, setStarSizeExponent] = useState(4.0);
  const [starSizeScale, setStarSizeScale] = useState(1.25);
  const [starSizeWeightPercentile, setStarSizeWeightPercentile] = useState(1.0);
  const [divisionLabelPushFraction, setDivisionLabelPushFraction] = useState(0.45);
  const [divisionLabelHorizonPaddingDeg, setDivisionLabelHorizonPaddingDeg] = useState(25);
  const [selectedHorizonThemeId, setSelectedHorizonThemeId] = useState(DEFAULT_HORIZON_THEME_ID || HORIZON_THEMES[0]?.id || "");
  const [customHorizon, setCustomHorizon] = useState<PreviewCustomHorizonDefaults>(PREVIEW_CUSTOM_HORIZON_DEFAULTS);
  const [horizonColorMode, setHorizonColorMode] = useState<HorizonColorMode>(PREVIEW_CUSTOM_HORIZON_DEFAULTS.mode);
  const [constellationConfig, setConstellationConfig] = useState<any>(null);
  const [isSidebarHovered, setIsSidebarHovered] = useState(false);
  const [filterTestament, setFilterTestament] = useState("");
  const [filterDivision, setFilterDivision] = useState("");
  const [filterBook, setFilterBook] = useState("");

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
        setConstellationConfig(data);
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
      .filter((n) => n.level === 2 && (n.meta?.testament as string) === filterTestament && (n.meta?.division as string) === filterDivision)
      .map((n) => ({ id: n.meta?.bookKey as string, label: n.label }));
  }, [model, filterTestament, filterDivision]);

  useEffect(() => { setFilterDivision(""); setFilterBook(""); }, [filterTestament]);
  useEffect(() => { setFilterBook(""); }, [filterDivision]);

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
  const optimizedArrangement = useMemo(
    () => (
      payload
        ? optimizeArrangementForVisibility(payload.arrangement, selectedHorizonTheme)
        : null
    ),
    [payload, selectedHorizonTheme],
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

  const previewConstellationConfig = useMemo(
    () => (
      triangulationMode !== "off" && displayArrangement
        ? buildTriangulatedConstellations(displayArrangement, constellationConfig)
        : constellationConfig
    ),
    [constellationConfig, displayArrangement, triangulationMode],
  );

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
      showBackdropStars,
      showAtmosphere,
      showMoon,
      showSunrise,
      showMilkyWay,
      horizonTheme: previewHorizonTheme,
      projection,
      constellations: previewConstellationConfig,
      fitProjection: true,
      starSizeExponent,
      starSizeScale,
      starSizeWeightPercentile,
      starZoomReveal: false,
      camera: { lon: 42 * Math.PI / 180, lat: 36 * Math.PI / 180 },
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
    model,
    previewConstellationConfig,
    previewHorizonTheme,
    projection,
    selectedHorizonTheme,
    showAtmosphere,
    showBackdropStars,
    showBookLabels,
    showChapterLabels,
    showConstellationArt,
    showDivisionLabels,
    showDivisionTint,
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

  const handleImportArrangement = useCallback(async (file: File) => {
    try {
      const arrangement = JSON.parse(await file.text()) as StarArrangement;
      const next = buildPreviewPayloadFromArrangement(arrangement, file.name);
      setPayload(next);
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

  const sourceLabel = payload
    ? payload.source === "autosave"
      ? "Browser autosave"
      : payload.source === "session"
        ? "Refine session"
        : "Arrangement"
    : null;

  const handleCameraChange = useCallback((lon: number, lat: number, fov: number) => {
    setCurrentCamera({ lon, lat, fov });
  }, []);

  const handleConstellationLinesChange = useCallback((checked: boolean) => {
    setTriangulationMode(checked ? "focused" : "off");
  }, []);

  const handleConstellationLinesAlwaysOnChange = useCallback((checked: boolean) => {
    setTriangulationMode(checked ? "full" : "focused");
  }, []);

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
      subtitle="Render the refined sky through the actual Three.js library experience and judge the final atmosphere, readability, and constellation character."
      sidebarWidthClass="w-80"
      collapsibleSidebar
      onSidebarHoverChange={setIsSidebarHovered}
      onRefreshViewport={handleRefreshViewport}
      sidebar={
        <>
          <p className="text-xs leading-relaxed text-white/45">
            Preview is the runtime check. It consumes the refined output and shows what the real planetarium experience will feel like through the library renderer.
          </p>

          {!payload ? (
            <BuilderSection label="Load Source">
              <p className="text-[10px] leading-relaxed text-white/20">
                Load an `arrangement.json` or a `skymap-session.json` exported from Refine. If you have just been in Refine, Preview will also try the latest autosaved refine session.
              </p>
              <FileInput label="Load arrangement" filename="arrangement.json" onChange={handleImportArrangement} />
              <FileInput label="Load session" filename="skymap-session.json" onChange={handleImportSession} />
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
                </div>
              </BuilderSection>

              <BuilderSection label="Atmosphere">
                <Toggle label="Division labels" checked={showDivisionLabels} onChange={setShowDivisionLabels} />
                <Toggle label="Division tint" checked={showDivisionTint} onChange={setShowDivisionTint} />
                <Toggle label="Book labels" checked={showBookLabels} onChange={setShowBookLabels} />
                <Toggle label="Chapter labels" checked={showChapterLabels} onChange={setShowChapterLabels} />
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
                  onChange={(v) => setFilterTestament(v)}
                  options={[{ value: "", label: "All" }, ...filterTestaments.map((t) => ({ value: t.id, label: t.label }))]}
                />
                {filterTestament && (
                  <SelectRow
                    label="Division"
                    value={filterDivision}
                    onChange={(v) => setFilterDivision(v)}
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

              <BuilderSection label="Tuning">
                <SelectRow
                  label="Projection"
                  value={projection}
                  onChange={(value) => setProjection(value as typeof projection)}
                  options={[
                    { value: "blended", label: "Blended" },
                    { value: "perspective", label: "Perspective" },
                    { value: "stereographic", label: "Stereographic" },
                  ]}
                />
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
                {currentCamera ? (
                  <>
                    <div className="rounded-md border border-white/8 bg-white/[0.03] px-2.5 py-2 font-mono">
                      <div className="flex items-center justify-between text-[10px] text-white/48">
                        <span>Lon</span>
                        <span className="text-white/80">{(currentCamera.lon * 180 / Math.PI).toFixed(1)}°</span>
                      </div>
                      <div className="mt-1 flex items-center justify-between text-[10px] text-white/48">
                        <span>Lat</span>
                        <span className="text-white/80">{(currentCamera.lat * 180 / Math.PI).toFixed(1)}°</span>
                      </div>
                      <div className="mt-1 flex items-center justify-between text-[10px] text-white/48">
                        <span>FOV</span>
                        <span className="text-white/80">{currentCamera.fov.toFixed(1)}°</span>
                      </div>
                    </div>
                    <CameraSnippet lon={currentCamera.lon} lat={currentCamera.lat} fov={currentCamera.fov} />
                  </>
                ) : (
                  <p className="text-[10px] text-white/22">Pan the sky to see camera position.</p>
                )}
              </BuilderSection>

              <BuilderSection label="Status">
                <div className="rounded-md border border-white/8 bg-white/[0.03] px-2.5 py-2">
                  <p className="text-[10px] uppercase tracking-widest text-white/22">Preview</p>
                  <p className="mt-1 text-xs text-white/52">{status}</p>
                  <p className="mt-1 text-[10px] text-white/28">Mode: {useVisibleHemisphere ? "Visible cap" : "Physical hemisphere"}</p>
                  <p className="mt-1 text-[10px] text-white/28">Lines: {triangulationMode}</p>
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
                <Link href="/refine" className="text-left text-xs text-white/45 transition-colors hover:text-white/70">
                  Return to Refine
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
