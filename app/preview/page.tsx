"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { HorizonThemeConfig, StarArrangement, StarMapConfig, StarMapHandle } from "@project-skymap/library";
import { StarMap } from "@project-skymap/library";
import type { Session } from "../assign/session";
import { importSession } from "../assign/session";
import { BuilderSection, BuilderWorkspace } from "../components/BuilderWorkspace";
import {
  buildTriangulatedConstellations,
  buildArrangementFromSession,
  buildModelFromArrangement,
  DEFAULT_HORIZON_THEME_ID,
  HORIZON_THEMES,
  optimizeArrangementForVisibility,
  remapArrangementToVisibleHemisphere,
} from "../skymap/shared";

const PREVIEW_STORAGE_KEY = "skymap-preview-arrangement";
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
  const [payload, setPayload] = useState<PreviewPayload | null>(null);
  const [status, setStatus] = useState("No preview source loaded yet.");
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [currentFov, setCurrentFov] = useState(35);
  const [showBookLabels, setShowBookLabels] = useState(true);
  const [showChapterLabels, setShowChapterLabels] = useState(true);
  const [showConstellationArt, setShowConstellationArt] = useState(false);
  const [showBackdropStars, setShowBackdropStars] = useState(false);
  const [showAtmosphere, setShowAtmosphere] = useState(false);
  const [showMoon, setShowMoon] = useState(false);
  const [showSunrise, setShowSunrise] = useState(false);
  const [showMilkyWay, setShowMilkyWay] = useState(false);
  const [triangulationMode, setTriangulationMode] = useState<"off" | "focused" | "full">("focused");
  const [useVisibleHemisphere, setUseVisibleHemisphere] = useState(true);
  const [projection, setProjection] = useState<"perspective" | "stereographic" | "blended">("blended");
  const [chapterLabelMaxFov, setChapterLabelMaxFov] = useState(22);
  const [constellationBaseOpacity, setConstellationBaseOpacity] = useState(40);
  const [starSizeExponent, setStarSizeExponent] = useState(3.4);
  const [starSizeScale, setStarSizeScale] = useState(1.0);
  const [starSizeWeightPercentile, setStarSizeWeightPercentile] = useState(1.0);
  const [selectedHorizonThemeId, setSelectedHorizonThemeId] = useState(DEFAULT_HORIZON_THEME_ID || HORIZON_THEMES[0]?.id || "");
  const [constellationConfig, setConstellationConfig] = useState<any>(null);
  const [isSidebarHovered, setIsSidebarHovered] = useState(false);

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
  const selectedHorizonTheme = useMemo<HorizonThemeConfig | undefined>(
    () => HORIZON_THEMES.find((theme) => theme.id === selectedHorizonThemeId) ?? HORIZON_THEMES[0],
    [selectedHorizonThemeId],
  );
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
      showDivisionLabels: false,
      showGroupLabels: false,
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
      horizonTheme: selectedHorizonTheme,
      projection,
      constellations: previewConstellationConfig,
      fitProjection: true,
      starSizeExponent,
      starSizeScale,
      starSizeWeightPercentile,
      starZoomReveal: false,
      camera: { lon: 275 * Math.PI / 180, lat: 20 * Math.PI / 180 },
    };
  }, [
    chapterLabelMaxFov,
    triangulationMode,
    constellationBaseOpacity,
    displayArrangement,
    model,
    previewConstellationConfig,
    projection,
    selectedHorizonTheme,
    showAtmosphere,
    showBackdropStars,
    showBookLabels,
    showChapterLabels,
    showConstellationArt,
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

  useEffect(() => {
    mapRef.current?.setInteractionEnabled(!isSidebarHovered);
  }, [isSidebarHovered]);

  return (
    <BuilderWorkspace
      route="preview"
      title="Preview"
      subtitle="Render the refined sky through the actual Three.js library experience and judge the final atmosphere, readability, and constellation character."
      sidebarWidthClass="w-80"
      onSidebarHoverChange={setIsSidebarHovered}
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
                <Toggle label="Book labels" checked={showBookLabels} onChange={setShowBookLabels} />
                <Toggle label="Chapter labels" checked={showChapterLabels} onChange={setShowChapterLabels} />
                <Toggle label="Constellation art" checked={showConstellationArt} onChange={setShowConstellationArt} />
                <Toggle label="Visible hemisphere" checked={useVisibleHemisphere} onChange={setUseVisibleHemisphere} />
                <Toggle label="Backdrop stars" checked={showBackdropStars} onChange={setShowBackdropStars} />
                <Toggle label="Atmosphere" checked={showAtmosphere} onChange={setShowAtmosphere} />
                <Toggle label="Moon" checked={showMoon} onChange={setShowMoon} />
                <Toggle label="Sunrise" checked={showSunrise} onChange={setShowSunrise} />
                <Toggle label="Milky Way" checked={showMilkyWay} onChange={setShowMilkyWay} />
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
                  label="Triangulation"
                  value={triangulationMode}
                  onChange={(value) => setTriangulationMode(value as typeof triangulationMode)}
                  options={[
                    { value: "focused", label: "Focused" },
                    { value: "full", label: "Full" },
                    { value: "off", label: "Off" },
                  ]}
                />
                <SelectRow
                  label="Horizon theme"
                  value={selectedHorizonThemeId}
                  onChange={setSelectedHorizonThemeId}
                  options={HORIZON_THEMES.map((theme) => ({ value: theme.id, label: theme.label }))}
                />
                <SliderRow
                  label="Chapter label FOV"
                  value={chapterLabelMaxFov}
                  min={8}
                  max={48}
                  step={1}
                  onChange={setChapterLabelMaxFov}
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
                  min={1}
                  max={10}
                  step={0.1}
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

              <BuilderSection label="Status">
                <div className="rounded-md border border-white/8 bg-white/[0.03] px-2.5 py-2">
                  <p className="text-[10px] uppercase tracking-widest text-white/22">Preview</p>
                  <p className="mt-1 text-xs text-white/52">{status}</p>
                  <p className="mt-1 text-[10px] text-white/28">FOV: {currentFov.toFixed(1)}°</p>
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
