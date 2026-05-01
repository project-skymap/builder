"use client";

import { useCallback, useMemo, useState, useRef, useEffect } from "react";
import type { SceneNode, SceneModel, StarMapConfig, StarArrangement, StarMapHandle, BibleJSON, HierarchyFilter, HorizonThemeConfig } from "@project-skymap/library";
import { StarMap, bibleToSceneModel, generateArrangement, defaultGenerateOptions } from "@project-skymap/library";
import bible from "../public/bible.json";
import initialArrangement from "./arrangement.json";
import groups from "./groups.json";
import labelColors from "../public/colours.json";
import horizonPresetData from "../public/horizons/biblical-presets.v1.json";
import type { Session } from "./assign/session";
import { loadSession, saveSession, createSession, importSkyField as importSkyFieldFile } from "./assign/session";
import { CANON, BOOKS } from "./assign/canon";

const BOOK_COLORS: Record<string, string> = {};

// Simple hash-based color generator for books
function getBookColor(bookKey: string) {
  if (BOOK_COLORS[bookKey]) return BOOK_COLORS[bookKey];
  
  let hash = 0;
  for (let i = 0; i < bookKey.length; i++) {
    hash = bookKey.charCodeAt(i) + ((hash << 5) - hash);
  }
  
  const h = Math.abs(hash % 360);
  const s = 60 + (Math.abs(hash >> 8) % 30); // 60-90% saturation
  const l = 60 + (Math.abs(hash >> 16) % 20); // 60-80% lightness
  
  const color = `hsl(${h}, ${s}%, ${l}%)`;
  BOOK_COLORS[bookKey] = color;
  return color;
}

// Pre-generate all book colors
bible.testaments.forEach(t => 
  t.divisions.forEach(d => 
    d.books.forEach(b => getBookColor(b.key))
  )
);

// ---------------------------------------------------------------------------
// Assignment mode helpers
// ---------------------------------------------------------------------------

function buildVerseCounts(): number[] {
  const arr: number[] = [];
  for (const testament of (bible as BibleJSON).testaments) {
    for (const division of testament.divisions) {
      for (const book of division.books) {
        const verses = (book as any).verses as number[] | undefined;
        for (let c = 0; c < book.chapters; c++) {
          arr.push(verses?.[c] ?? 1);
        }
      }
    }
  }
  return arr;
}

const VERSE_COUNTS = buildVerseCounts();

const assignNodeId = {
  testament: (t: string)               => `T:${t}`,
  division:  (t: string, d: string)    => `D:${t}:${d}`,
  book:      (key: string)             => `B:${key}`,
  chapter:   (key: string, ch: number) => `C:${key}:${ch}`,
};

function chapterNodeToGlobalIndex(id: string): number | undefined {
  const m = id.match(/^C:([^:]+):(\d+)$/);
  if (!m) return undefined;
  const book = BOOKS.find(b => b.key === m[1]);
  if (!book) return undefined;
  const gi = book.startGlobalIndex + Number(m[2]) - 1;
  return gi >= book.startGlobalIndex && gi <= book.endGlobalIndex ? gi : undefined;
}

function buildAssignedScene(session: Session): { model: SceneModel; arrangement: StarArrangement } {
  const nodes: SceneNode[] = [];
  const arrangement: StarArrangement = {};
  const addedT = new Set<string>();
  const addedD = new Set<string>();
  const addedB = new Set<string>();

  for (const [chStr, starId] of Object.entries(session.assignments)) {
    const chIdx   = Number(chStr);
    const chapter = CANON[chIdx];
    if (!chapter) continue;
    const star = session.skyField.stars[starId as unknown as number];
    if (!star) continue;

    const tid = assignNodeId.testament(chapter.testament);
    if (!addedT.has(tid)) {
      addedT.add(tid);
      nodes.push({ id: tid, label: chapter.testament, level: 0, meta: { testament: chapter.testament } });
    }
    const did = assignNodeId.division(chapter.testament, chapter.divisionName);
    if (!addedD.has(did)) {
      addedD.add(did);
      nodes.push({ id: did, label: chapter.divisionName, level: 1, parent: tid,
        meta: { testament: chapter.testament, division: chapter.divisionName } });
    }
    const bid = assignNodeId.book(chapter.bookKey);
    if (!addedB.has(bid)) {
      addedB.add(bid);
      nodes.push({ id: bid, label: chapter.bookName, level: 2, parent: did,
        meta: { testament: chapter.testament, division: chapter.divisionName,
                bookKey: chapter.bookKey, book: chapter.bookName } });
    }
    const cid = assignNodeId.chapter(chapter.bookKey, chapter.chapterNumber);
    nodes.push({
      id: cid, label: `${chapter.bookName} ${chapter.chapterNumber}`,
      level: 3, parent: bid,
      weight: VERSE_COUNTS[chIdx] ?? 1,
      meta: { testament: chapter.testament, division: chapter.divisionName,
              bookKey: chapter.bookKey, book: chapter.bookName, chapter: chapter.chapterNumber },
    });
    arrangement[cid] = { position: [star.x3 * 2000, star.y3 * 2000, star.z3 * 2000] };
  }

  return { model: { nodes }, arrangement };
}

// ---------------------------------------------------------------------------
// Define a "Correct Answer" for testing
const ANSWER = {
  testament: "New",
  division: "Paul's Letters",
  book: "Romans",
  bookKey: "ROM",
  chapter: 8
};

export default function Page() {
  const presetThemes = (horizonPresetData.themes ?? []) as HorizonThemeConfig[];
  const presetDefaultThemeId = (horizonPresetData.defaultThemeId ?? "") as string;
  const [focusNodeId, setFocusNodeId] = useState<string | undefined>(undefined);
  const [arrangement, setArrangement] = useState<StarArrangement>(initialArrangement as unknown as StarArrangement);
  const [mode, setMode] = useState<"view" | "edit" | "assign">("view");
  const isEditable = mode === "edit";
  const [showBookLabels, setShowBookLabels] = useState(true);
  const [showDivisionLabels, setShowDivisionLabels] = useState(false);
  const [showChapterLabels, setShowChapterLabels] = useState(true);
  const [showGroupLabels, setShowGroupLabels] = useState(true);
  const [showLines, setShowLines] = useState(false);
  const [showBoundaries, setShowBoundaries] = useState(false);
  const [initialLon, setInitialLon] = useState(275);
  const [initialLat, setInitialLat] = useState(20);
  const [currentFov, setCurrentFov] = useState(35);
  const [showConstellationArt, setShowConstellationArt] = useState(true);
  const [constellationBaseOpacity, setConstellationBaseOpacity] = useState(40);
  const [showBackdropStars, setShowBackdropStars] = useState(false);
  const [backdropStarsCount, setBackdropStarsCount] = useState(5000);
  const [backdropWideFovGain, setBackdropWideFovGain] = useState(0);
  const [backdropSizeExponent, setBackdropSizeExponent] = useState(0.2);
  const [backdropEnergy, setBackdropEnergy] = useState(0.2);
  const [starSizeExponent, setStarSizeExponent] = useState(4.0);
  const [starSizeScale, setStarSizeScale] = useState(6.0);
  const [starSizeWeightPercentile, setStarSizeWeightPercentile] = useState(1.0);
  const [starZoomReveal, setStarZoomReveal] = useState(false);
  const [showAtmosphere, setShowAtmosphere] = useState(false);
  const [showMoon, setShowMoon] = useState(false);
  const [showSunrise, setShowSunrise] = useState(false);
  const [showMilkyWay, setShowMilkyWay] = useState(false);
  const [projection, setProjection] = useState<"perspective" | "stereographic" | "blended">("blended");
  const [chapterLabelMaxFov, setChapterLabelMaxFov] = useState(22);
  const [labelOverlapPx, setLabelOverlapPx] = useState(12);
  const [labelReappearDelayMs, setLabelReappearDelayMs] = useState(60);
  const [constellationConfig, setConstellationConfig] = useState<any>(null);
  const [revealOrderEnabled, setRevealOrderEnabled] = useState(true);
  const [selectedGuess, setSelectedGuess] = useState<SceneNode | null>(null);
  const [hierarchyFilter, setHierarchyFilter] = useState<HierarchyFilter | null>(null);
  const [guessHistory, setGuessHistory] = useState<{node: SceneNode, result: string}[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [solved, setSolved] = useState(false);
  const [sheetExpanded, setSheetExpanded] = useState(false);
  const [longPressInfo, setLongPressInfo] = useState<{ node: SceneNode | null; x: number; y: number } | null>(null);
  const [showGestureHints, setShowGestureHints] = useState(false);
  const [horizonThemes] = useState<HorizonThemeConfig[]>(presetThemes);
  const [selectedHorizonThemeId, setSelectedHorizonThemeId] = useState<string>(presetDefaultThemeId || presetThemes[0]?.id || "");
  const [projectionBlendOverride, setProjectionBlendOverride] = useState(-1);
  const [disableZenithBias, setDisableZenithBias] = useState(false);
  const [disableZenithFlatten, setDisableZenithFlatten] = useState(false);
  const [disableHorizonTheme, setDisableHorizonTheme] = useState(false);
  const [horizonDiagnostics, setHorizonDiagnostics] = useState(false);
  const [freezeBandStartFov, setFreezeBandStartFov] = useState(76);
  const [freezeBandEndFov, setFreezeBandEndFov] = useState(84);
  const [zenithBiasStartFov, setZenithBiasStartFov] = useState(85);
  const [verticalPanDampStartFov, setVerticalPanDampStartFov] = useState(72);
  const [verticalPanDampEndFov, setVerticalPanDampEndFov] = useState(96);
  const [verticalPanDampLatStartDeg, setVerticalPanDampLatStartDeg] = useState(45);
  const [verticalPanDampLatEndDeg, setVerticalPanDampLatEndDeg] = useState(82);
  const touchStartY = useRef<number | null>(null);
  const mapRef = useRef<StarMapHandle>(null);

  // Assignment mode state
  const [assignSession,        setAssignSession]        = useState<Session | null>(null);
  const [selectedAssignNode,   setSelectedAssignNode]   = useState<SceneNode | null>(null);
  const [selectedMarkerStarId, setSelectedMarkerStarId] = useState<number | null>(null);

  // Show gesture hints on first mobile visit
  useEffect(() => {
    const isMobile = window.matchMedia('(max-width: 768px)').matches;
    const hasSeenHints = localStorage.getItem('skymap-gesture-hints-seen');
    if (isMobile && !hasSeenHints) {
      setShowGestureHints(true);
    }
  }, []);

  const dismissGestureHints = useCallback(() => {
    setShowGestureHints(false);
    localStorage.setItem('skymap-gesture-hints-seen', 'true');
  }, []);

  const handleLongPress = useCallback((node: SceneNode | null, x: number, y: number) => {
    setLongPressInfo({ node, x, y });
  }, []);

  // ── Assignment mode lifecycle ──────────────────────────────────────────────

  // Load session from localStorage when first entering assign mode
  useEffect(() => {
    if (mode === "assign" && assignSession === null) {
      setAssignSession(loadSession());
    }
  }, [mode, assignSession]);

  // Persist every time the session changes
  useEffect(() => {
    if (assignSession) saveSession(assignSession);
  }, [assignSession]);

  // Build partial SceneModel + arrangement from assigned chapters
  const assignedScene = useMemo(() => {
    if (mode !== "assign" || !assignSession?.skyField) return null;
    return buildAssignedScene(assignSession);
  }, [mode, assignSession]);

  // Unassigned star positions → orange markers
  const { markerPositions, markerStarIds } = useMemo(() => {
    if (mode !== "assign" || !assignSession?.skyField)
      return { markerPositions: [] as Array<[number,number,number]>, markerStarIds: [] as number[] };
    const assigned = new Set<number>(Object.values(assignSession.assignments) as number[]);
    const positions: Array<[number,number,number]> = [];
    const ids: number[] = [];
    for (const star of assignSession.skyField.stars) {
      if (!assigned.has(star.id)) {
        positions.push([star.x3 * 2000, star.y3 * 2000, star.z3 * 2000]);
        ids.push(star.id);
      }
    }
    return { markerPositions: positions, markerStarIds: ids };
  }, [mode, assignSession]);

  // starId → chapterGlobalIndex (for assigned-star info panel)
  const assignStarToChapter = useMemo(() => {
    const m = new Map<number, number>();
    for (const [ch, st] of Object.entries(assignSession?.assignments ?? {}))
      m.set(st as unknown as number, Number(ch));
    return m;
  }, [assignSession]);

  // Assign config — replaces the normal config while in assign mode
  const assignConfig = useMemo<StarMapConfig | null>(() => {
    if (!assignedScene) return null;
    return {
      model:       assignedScene.model,
      arrangement: assignedScene.arrangement,
      markerPositions,
      layout: { algorithm: "phyllotaxis", radius: 2000 },
      starSizeExponent:         4.0,
      starSizeScale:            6.0,
      starSizeWeightPercentile: 1.0,
      starZoomReveal:           false,
      showBookLabels:     false,
      showChapterLabels:  false,
      showDivisionLabels: false,
      showGroupLabels:    false,
      showAtmosphere,
      showMoon,
      showSunrise:       false,
      showMilkyWay:      false,
      showBackdropStars: false,
      projection,
      fitProjection: true,
    };
  }, [assignedScene, markerPositions, showAtmosphere, showMoon, projection]);

  // ── Assignment handlers ────────────────────────────────────────────────────

  const handleMarkerSelect = useCallback((index: number) => {
    const starId = markerStarIds[index];
    if (starId === undefined) return;
    setSelectedMarkerStarId(starId);
    setSelectedAssignNode(null);
  }, [markerStarIds]);

  const handleAssign = useCallback((chapterGlobalIndex: number, starId: number) => {
    setAssignSession(prev => {
      if (!prev) return prev;
      const next: Record<number, number> = {};
      for (const [ch, st] of Object.entries(prev.assignments))
        if (Number(ch) !== chapterGlobalIndex) next[Number(ch)] = st as unknown as number;
      next[chapterGlobalIndex] = starId;
      return { ...prev, assignments: next };
    });
    setSelectedMarkerStarId(null);
  }, []);

  const handleDeassign = useCallback(() => {
    const chIdx =
      selectedAssignNode
        ? chapterNodeToGlobalIndex(selectedAssignNode.id)
        : selectedMarkerStarId !== null
          ? assignStarToChapter.get(selectedMarkerStarId)
          : undefined;
    if (chIdx === undefined) return;
    setAssignSession(prev => {
      if (!prev) return prev;
      const { [chIdx]: _removed, ...rest } = prev.assignments;
      return { ...prev, assignments: rest };
    });
    setSelectedAssignNode(null);
    setSelectedMarkerStarId(null);
  }, [selectedAssignNode, selectedMarkerStarId, assignStarToChapter]);

  const handleImportAssignSkyField = useCallback(async (file: File) => {
    try {
      const skyField = await importSkyFieldFile(file);
      setAssignSession(createSession(skyField));
    } catch { /* invalid file */ }
  }, []);

  const handleExportAssignmentArrangement = useCallback(() => {
    if (!assignSession?.skyField) return;
    const arr: StarArrangement = {};
    for (const [chStr, starId] of Object.entries(assignSession.assignments)) {
      const chIdx   = Number(chStr);
      const chapter = CANON[chIdx];
      if (!chapter) continue;
      const star = assignSession.skyField.stars[starId as unknown as number];
      if (!star) continue;
      arr[assignNodeId.chapter(chapter.bookKey, chapter.chapterNumber)] = {
        position: [star.x3 * 2000, star.y3 * 2000, star.z3 * 2000],
      };
    }
    const blob = new Blob([JSON.stringify(arr, null, 2)], { type: "application/json" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = "arrangement.json"; a.click();
    URL.revokeObjectURL(url);
  }, [assignSession]);

  // ── End assignment mode ────────────────────────────────────────────────────

  useEffect(() => {
    fetch(`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/constellations.json`)
      .then(res => {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }
        return res.json();
      })
      .then(data => {
        console.log("[Constellations] Loaded config with", data.constellations?.length, "items");
        if (data.atlasBasePath) {
          data.atlasBasePath = `${process.env.NEXT_PUBLIC_BASE_PATH || ""}${data.atlasBasePath}`;
        }
        setConstellationConfig(data);
      })
      .catch(err => {
        console.error("[Constellations] Failed to load config:", err);
      });
  }, []);

  const selectedHorizonTheme = useMemo(
    () => horizonThemes.find((t) => t.id === selectedHorizonThemeId),
    [horizonThemes, selectedHorizonThemeId]
  );

  const handleArrangementChange = useCallback((newArr: StarArrangement) => {
    setArrangement(newArr);
  }, []);

  const handleExport = useCallback(() => {
    const fullArr = mapRef.current?.getFullArrangement();
    if (!fullArr) return;

    const json = JSON.stringify(fullArr, null, 2);
    console.log("Full Arrangement:", json);
    navigator.clipboard.writeText(json).catch(() => {});
    alert("Full arrangement exported to console and clipboard!");
  }, []);

  const handleGenerate = useCallback(() => {
    // Generate with a random seed based on time to ensure variation
    const seed = Date.now();
    console.log("Generating arrangement with seed:", seed);
    const newArrangement = generateArrangement(bible as BibleJSON, { ...defaultGenerateOptions, seed });
    setArrangement(newArrangement);
    alert(`Generated new galaxy arrangement! (Seed: ${seed})`);
  }, []);
  
  // Sync Reveal Order State
  useEffect(() => {
      mapRef.current?.setOrderRevealEnabled?.(revealOrderEnabled);
  }, [revealOrderEnabled]);

  // Sync Hierarchy Filter
  useEffect(() => {
      mapRef.current?.setHierarchyFilter?.(hierarchyFilter);
  }, [hierarchyFilter]);

  const config = useMemo<StarMapConfig>(
    () => ({
      background: "#05060a",
      camera: { lon: initialLon * Math.PI / 180, lat: initialLat * Math.PI / 180 },
      data: bible,
      adapter: bibleToSceneModel,
      arrangement,
      editable: isEditable,
      groups: groups as any,
      labelColors: labelColors as Record<string, string>,
      showBookLabels,
      showDivisionLabels,
      showChapterLabels,
      showGroupLabels,
      labelBehavior: {
        overlapPaddingPx: 2,
        reappearDelayMs: labelReappearDelayMs,
        classes: {
          chapter: { maxFov: chapterLabelMaxFov, maxOverlapPx: labelOverlapPx },
          group: { maxFov: chapterLabelMaxFov, maxOverlapPx: labelOverlapPx }
        }
      },
      showConstellationLines: showLines,
      showDivisionBoundaries: showBoundaries,
      showConstellationArt,
      constellationBaseOpacity,
      showBackdropStars,
      backdropStarsCount,
      backdropWideFovGain,
      backdropSizeExponent,
      backdropEnergy,
      starSizeExponent,
      starSizeScale,
      starSizeWeightPercentile,
      starZoomReveal,
      showAtmosphere,
      showMoon,
      showSunrise,
      showMilkyWay,
      horizonTheme: selectedHorizonTheme,
      projection,
      constellations: constellationConfig,
      fitProjection: true,
      debug: {
        sceneMechanics: {
          projectionBlendOverride: projectionBlendOverride < 0 ? null : projectionBlendOverride,
          disableZenithBias,
          disableZenithFlatten,
          disableHorizonTheme,
          horizonDiagnostics,
          freezeBandStartFov,
          freezeBandEndFov,
          zenithBiasStartFov,
          verticalPanDampStartFov,
          verticalPanDampEndFov,
          verticalPanDampLatStartDeg,
          verticalPanDampLatEndDeg
        }
      },
      visuals: {
        colorBy: [
          // Per-book colors (level 3)
          ...Object.entries(BOOK_COLORS).map(([key, color]) => ({
            when: { bookKey: key, level: 3 },
            value: color
          })),
          { when: { level: 0 }, value: "#38bdf8" },
          { when: { level: 1 }, value: "#a3e635" },
          { when: { level: 2 }, value: "#ffffff" },
        ],
        sizeBy: [{ when: { level: 3 }, field: "weight", scale: [2.0, 5.0] }]
      },
      layout: { mode: "spherical", radius: 500, chapterRingSpacing: 40, algorithm: "phyllotaxis" },
      focus: {
        nodeId: focusNodeId,
        animate: true
      }
    }),
    [focusNodeId, arrangement, isEditable, showBookLabels, showDivisionLabels, showChapterLabels, showGroupLabels, showLines, showBoundaries, showConstellationArt, constellationBaseOpacity, showBackdropStars, backdropStarsCount, backdropWideFovGain, backdropSizeExponent, backdropEnergy, starSizeExponent, starSizeScale, starSizeWeightPercentile, starZoomReveal, constellationConfig, initialLon, initialLat, projection, chapterLabelMaxFov, labelOverlapPx, labelReappearDelayMs, showMoon, showSunrise, showMilkyWay, selectedHorizonTheme, projectionBlendOverride, disableZenithBias, disableZenithFlatten, disableHorizonTheme, horizonDiagnostics, freezeBandStartFov, freezeBandEndFov, zenithBiasStartFov, verticalPanDampStartFov, verticalPanDampEndFov, verticalPanDampLatStartDeg, verticalPanDampLatEndDeg]
  );

  const handleSelect = useCallback((node: SceneNode) => {
    // Assign mode — selecting an assigned chapter star
    if (mode === "assign") {
      if (node.level === 3) {
        setSelectedAssignNode(node);
        setSelectedMarkerStarId(null);
      }
      return;
    }

    // Order Reveal Interaction
    if (node && (node.level === 2 || node.level === 3)) {
        const bookId = node.level === 2 ? node.id : node.parent!;
        mapRef.current?.setFocusedBook(bookId);
    } else {
        mapRef.current?.setFocusedBook(null);
    }

    // Select chapter stars as guess candidates
    if (!solved && node.level === 3) {
        setSelectedGuess(node);
    }
  }, [mode, solved]);

  const handleSubmitGuess = useCallback(() => {
    if (!selectedGuess || solved) return;
    const meta = selectedGuess.meta as { testament: string; division: string; bookKey: string; chapter: number };

    // Zoom into the guessed star
    mapRef.current?.flyTo(selectedGuess.id, 10);

    // Check exact match
    if (meta.bookKey === ANSWER.bookKey && meta.chapter === ANSWER.chapter) {
        setSolved(true);
        setFocusNodeId(selectedGuess.id);
        setGuessHistory(prev => [...prev, { node: selectedGuess, result: "Correct!" }]);
        setSelectedGuess(null);
        return;
    }

    // Build filter from hierarchy match
    const newFilter: HierarchyFilter = {};
    let matchLevel = "";

    if (meta.testament === ANSWER.testament) {
        newFilter.testament = ANSWER.testament;
        matchLevel = "testament";
        if (meta.division === ANSWER.division) {
            newFilter.division = ANSWER.division;
            matchLevel = "division";
            if (meta.bookKey === ANSWER.bookKey) {
                newFilter.bookKey = ANSWER.bookKey;
                matchLevel = "book";
            }
        }
    }

    const result = matchLevel
        ? `Wrong — correct ${matchLevel}`
        : "Wrong — no match";

    // Merge with existing filter (only narrows, never widens)
    if (matchLevel) {
        setHierarchyFilter(prev => prev ? { ...prev, ...newFilter } : newFilter);
    }

    setGuessHistory(prev => [...prev, { node: selectedGuess, result }]);
    setSelectedGuess(null);
  }, [selectedGuess, solved]);

  const handleHover = useCallback((node?: SceneNode) => {
    if (node) {
       // Order Reveal Interaction
       if (node.level === 2 || node.level === 3) {
           const bookId = node.level === 2 ? node.id : node.parent!;
           mapRef.current?.setHoveredBook(bookId);
       } else if (node.level === 2.5) {
           // Group Label -> get parent book
           mapRef.current?.setHoveredBook(node.parent!);
       } else {
           mapRef.current?.setHoveredBook(null);
       }
    } else {
        mapRef.current?.setHoveredBook(null);
    }
  }, []);

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        background: "#05060a",
        color: "#e5e7eb",
        margin: 0,
        padding: 0,
        overflow: "hidden",
        position: "relative"
      }}
    >
      <div
        className={`settings-panel ${sheetExpanded ? 'expanded' : ''}`}
        onTouchStart={(e) => {
          touchStartY.current = e.touches[0].clientY;
        }}
        onTouchEnd={(e) => {
          if (touchStartY.current === null) return;
          const touchEndY = e.changedTouches[0].clientY;
          const deltaY = touchStartY.current - touchEndY;
          if (deltaY > 50) {
            setSheetExpanded(true);
          } else if (deltaY < -50) {
            setSheetExpanded(false);
          }
          touchStartY.current = null;
        }}
      >
        <div
          className="drag-handle"
          onClick={() => setSheetExpanded(!sheetExpanded)}
        />
        <div className="header">Star Map Builder</div>
        
        <div style={{ marginBottom: 10, fontSize: 12, color: '#aaa' }}>
            <strong style={{ color: '#fff' }}>Goal:</strong> Find {ANSWER.book} {ANSWER.chapter}
        </div>

        {solved && (
            <div style={{ marginBottom: 10, padding: 8, background: '#166534', border: '1px solid #22c55e', borderRadius: 4, fontSize: 13, fontWeight: 'bold', color: '#bbf7d0' }}>
                Correct! {ANSWER.book} {ANSWER.chapter} found in {guessHistory.length} {guessHistory.length === 1 ? 'guess' : 'guesses'}.
            </div>
        )}

        {!solved && selectedGuess && (
            <div style={{ marginBottom: 10, fontSize: 12 }}>
                <strong style={{ color: '#fbbf24' }}>Selected:</strong>{' '}
                <span style={{ color: '#fff' }}>{selectedGuess.label}</span>
            </div>
        )}

        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
            <button
                onClick={handleSubmitGuess}
                disabled={!selectedGuess || solved}
                style={{
                    flex: 1,
                    background: selectedGuess && !solved ? '#b45309' : '#374151',
                    borderColor: selectedGuess && !solved ? '#f59e0b' : '#6b7280',
                    opacity: selectedGuess && !solved ? 1 : 0.5
                }}
            >
                Submit Guess
            </button>
            <button
                onClick={() => {
                    setFocusNodeId(undefined);
                    setSelectedGuess(null);
                    setHierarchyFilter(null);
                    setGuessHistory([]);
                    setSolved(false);
                    mapRef.current?.setFocusedBook(null);
                    mapRef.current?.setHierarchyFilter?.(null);
                }}
                style={{ flex: 1 }}
            >
                Reset
            </button>
        </div>

        {guessHistory.length > 0 && (
            <div style={{ marginBottom: 10, fontSize: 11, maxHeight: 120, overflowY: 'auto' }}>
                <strong style={{ color: '#94a3b8', display: 'block', marginBottom: 4 }}>Guesses:</strong>
                {guessHistory.map((g, i) => (
                    <div key={i} style={{ color: g.result === "Correct!" ? '#4ade80' : '#fb923c', marginBottom: 2 }}>
                        {i + 1}. {g.node.label} — {g.result}
                    </div>
                ))}
            </div>
        )}

        {hierarchyFilter && !solved && (
            <div style={{ marginBottom: 10, fontSize: 11, color: '#818cf8' }}>
                <strong>Narrowed to:</strong>
                {hierarchyFilter.testament && <div>Testament: {hierarchyFilter.testament}</div>}
                {hierarchyFilter.division && <div>Division: {hierarchyFilter.division}</div>}
                {hierarchyFilter.bookKey && <div>Book: {hierarchyFilter.bookKey}</div>}
            </div>
        )}

        <div
            className="divider"
            onClick={() => setSettingsOpen(v => !v)}
            style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 0', userSelect: 'none' }}
        >
            <span style={{ fontSize: 10, color: '#666', letterSpacing: '0.05em', textTransform: 'uppercase' }}>Settings</span>
            <span style={{ fontSize: 10, color: '#555' }}>{settingsOpen ? '▲' : '▼'}</span>
        </div>

        {settingsOpen && <>

        <div className="control-group">
            <label style={{ justifyContent: 'space-between', width: '100%' }}>
                <span>Rotation</span>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                    <span className="value-display" style={{ marginRight: 5 }}>{initialLon}°</span>
                    <input type="range" min="0" max="360" value={initialLon} onChange={e => setInitialLon(Number(e.target.value))} />
                </div>
            </label>
        </div>
        <div className="control-group">
            <label style={{ justifyContent: 'space-between', width: '100%' }}>
                <span>Tilt</span>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                    <span className="value-display" style={{ marginRight: 5 }}>{initialLat}°</span>
                    <input type="range" min="-89" max="89" value={initialLat} onChange={e => setInitialLat(Number(e.target.value))} />
                </div>
            </label>
        </div>

        <div className="control-group"><label><span>Order Reveal</span><input type="checkbox" checked={revealOrderEnabled} onChange={e => setRevealOrderEnabled(e.target.checked)} /></label></div>
        {revealOrderEnabled && (
            <div style={{ fontSize: 10, color: '#666', paddingLeft: 10, marginBottom: 5 }}>
                Params: Amp 0.6, Dur 1.5s, Delay 40ms, Cooldown 2s
            </div>
        )}
        <div className="control-group"><label><span>Book Labels</span><input type="checkbox" checked={showBookLabels} onChange={e => setShowBookLabels(e.target.checked)} /></label></div>
        <div className="control-group"><label><span>Group Labels</span><input type="checkbox" checked={showGroupLabels} onChange={e => setShowGroupLabels(e.target.checked)} /></label></div>
        <div className="control-group"><label><span>Division Labels</span><input type="checkbox" checked={showDivisionLabels} onChange={e => setShowDivisionLabels(e.target.checked)} /></label></div>
        <div className="control-group"><label><span>Chapter Labels</span><input type="checkbox" checked={showChapterLabels} onChange={e => setShowChapterLabels(e.target.checked)} /></label></div>
        <div className="control-group"><label><span>Constellations</span><input type="checkbox" checked={showLines} onChange={e => setShowLines(e.target.checked)} /></label></div>
        <div className="control-group"><label><span>Division Borders</span><input type="checkbox" checked={showBoundaries} onChange={e => setShowBoundaries(e.target.checked)} /></label></div>
        <div className="control-group"><label><span>Artwork</span><input type="checkbox" checked={showConstellationArt} onChange={e => setShowConstellationArt(e.target.checked)} /></label></div>
        <div className="control-group" style={{ paddingLeft: 10 }}>
            <label style={{ justifyContent: "space-between", width: "100%" }}>
                <span style={{ fontSize: "0.9em", color: "#ccc" }}>Artwork Opacity</span>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <input
                        type="number"
                        min="0" max="300" step="1"
                        value={constellationBaseOpacity}
                        onChange={e => setConstellationBaseOpacity(Number(e.target.value))}
                        style={{ width: 48, background: "#1a1a2e", color: "#fff", border: "1px solid #333", borderRadius: 4, padding: "1px 4px", fontSize: 11, textAlign: "right" }}
                    />
                    <input
                        type="range"
                        min="0" max="300" step="1"
                        value={constellationBaseOpacity}
                        onChange={e => setConstellationBaseOpacity(Number(e.target.value))}
                    />
                </div>
            </label>
        </div>
        <div className="control-group"><label><span>Backdrop Stars</span><input type="checkbox" checked={showBackdropStars} onChange={e => setShowBackdropStars(e.target.checked)} /></label></div>
        {showBackdropStars && (
            <>
                <div className="control-group" style={{ paddingLeft: 10 }}>
                    <label style={{ justifyContent: 'space-between', width: '100%' }}>
                        <span style={{ fontSize: '0.9em', color: '#ccc' }}>Count</span>
                        <div style={{ display: 'flex', alignItems: 'center' }}>
                            <span className="value-display" style={{ marginRight: 5, width: 40, textAlign: 'right' }}>{backdropStarsCount}</span>
                            <input 
                                type="range" 
                                min="0" max="50000" step="1000"
                                value={backdropStarsCount} 
                                onChange={e => setBackdropStarsCount(Number(e.target.value))} 
                            />
                        </div>
                    </label>
                </div>
                <div className="control-group" style={{ paddingLeft: 10 }}>
                    <label style={{ justifyContent: 'space-between', width: '100%' }}>
                        <span style={{ fontSize: '0.9em', color: '#ccc' }}>Wide FOV Gain</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <input
                                type="number"
                                min="0" max="1" step="0.01"
                                value={backdropWideFovGain}
                                onChange={e => setBackdropWideFovGain(Number(e.target.value))}
                                style={{ width: 48, background: '#1a1a2e', color: '#fff', border: '1px solid #333', borderRadius: 4, padding: '1px 4px', fontSize: 11, textAlign: 'right' }}
                            />
                            <input
                                type="range"
                                min="0" max="1" step="0.01"
                                value={backdropWideFovGain}
                                onChange={e => setBackdropWideFovGain(Number(e.target.value))}
                            />
                        </div>
                    </label>
                </div>
                <div className="control-group" style={{ paddingLeft: 10 }}>
                    <label style={{ justifyContent: 'space-between', width: '100%' }}>
                        <span style={{ fontSize: '0.9em', color: '#ccc' }}>Size Exponent</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <input
                                type="number"
                                min="0.4" max="1.4" step="0.01"
                                value={backdropSizeExponent}
                                onChange={e => setBackdropSizeExponent(Number(e.target.value))}
                                style={{ width: 48, background: '#1a1a2e', color: '#fff', border: '1px solid #333', borderRadius: 4, padding: '1px 4px', fontSize: 11, textAlign: 'right' }}
                            />
                            <input
                                type="range"
                                min="0.4" max="1.4" step="0.01"
                                value={backdropSizeExponent}
                                onChange={e => setBackdropSizeExponent(Number(e.target.value))}
                            />
                        </div>
                    </label>
                </div>
                <div className="control-group" style={{ paddingLeft: 10 }}>
                    <label style={{ justifyContent: 'space-between', width: '100%' }}>
                        <span style={{ fontSize: '0.9em', color: '#ccc' }}>Backdrop Energy</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <input
                                type="number"
                                min="0.2" max="5" step="0.1"
                                value={backdropEnergy}
                                onChange={e => setBackdropEnergy(Number(e.target.value))}
                                style={{ width: 48, background: '#1a1a2e', color: '#fff', border: '1px solid #333', borderRadius: 4, padding: '1px 4px', fontSize: 11, textAlign: 'right' }}
                            />
                            <input
                                type="range"
                                min="0.2" max="5" step="0.1"
                                value={backdropEnergy}
                                onChange={e => setBackdropEnergy(Number(e.target.value))}
                            />
                        </div>
                    </label>
                </div>
            </>
        )}
        <div className="control-group"><label><span>Atmosphere</span><input type="checkbox" checked={showAtmosphere} onChange={e => setShowAtmosphere(e.target.checked)} /></label></div>
        <div className="control-group"><label><span>Moon</span><input type="checkbox" checked={showMoon} onChange={e => setShowMoon(e.target.checked)} /></label></div>
        <div className="control-group"><label><span>Sunrise</span><input type="checkbox" checked={showSunrise} onChange={e => setShowSunrise(e.target.checked)} /></label></div>
        <div className="control-group"><label><span>Milky Way</span><input type="checkbox" checked={showMilkyWay} onChange={e => setShowMilkyWay(e.target.checked)} /></label></div>
        <div className="control-group">
            <label>
                <span>Horizon Theme</span>
                <select
                    value={selectedHorizonThemeId}
                    onChange={e => setSelectedHorizonThemeId(e.target.value)}
                    style={{ background: '#1a1a2e', color: '#fff', border: '1px solid #333', borderRadius: 4, padding: '2px 4px', fontSize: 12 }}
                >
                    {horizonThemes.length === 0 ? (
                        <option value="">Loading…</option>
                    ) : (
                        horizonThemes.map((theme) => (
                            <option key={theme.id} value={theme.id}>{theme.label}</option>
                        ))
                    )}
                </select>
            </label>
        </div>
        <div className="control-group">
            <label style={{ justifyContent: 'space-between', width: '100%' }}>
                <span>Star Size Curve</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <input
                        type="number"
                        min="1.0" max="100" step="0.1"
                        value={starSizeExponent}
                        onChange={e => setStarSizeExponent(Number(e.target.value))}
                        style={{ width: 48, background: '#1a1a2e', color: '#fff', border: '1px solid #333', borderRadius: 4, padding: '1px 4px', fontSize: 11, textAlign: 'right' }}
                    />
                    <input
                        type="range"
                        min="1.0" max="100" step="0.1"
                        value={starSizeExponent}
                        onChange={e => setStarSizeExponent(Number(e.target.value))}
                    />
                </div>
            </label>
        </div>
        <div className="control-group">
            <label style={{ justifyContent: 'space-between', width: '100%' }}>
                <span>Star Size</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <input
                        type="number"
                        min="0.1" max="10" step="0.05"
                        value={starSizeScale}
                        onChange={e => setStarSizeScale(Number(e.target.value))}
                        style={{ width: 48, background: '#1a1a2e', color: '#fff', border: '1px solid #333', borderRadius: 4, padding: '1px 4px', fontSize: 11, textAlign: 'right' }}
                    />
                    <input
                        type="range"
                        min="0.1" max="10" step="0.05"
                        value={starSizeScale}
                        onChange={e => setStarSizeScale(Number(e.target.value))}
                    />
                </div>
            </label>
        </div>
        <div className="control-group">
            <label style={{ justifyContent: 'space-between', width: '100%' }}>
                <span>Size Cap %ile</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <input
                        type="number"
                        min="0.5" max="1.0" step="0.01"
                        value={starSizeWeightPercentile}
                        onChange={e => setStarSizeWeightPercentile(Number(e.target.value))}
                        style={{ width: 48, background: '#1a1a2e', color: '#fff', border: '1px solid #333', borderRadius: 4, padding: '1px 4px', fontSize: 11, textAlign: 'right' }}
                    />
                    <input
                        type="range"
                        min="0.5" max="1.0" step="0.01"
                        value={starSizeWeightPercentile}
                        onChange={e => setStarSizeWeightPercentile(Number(e.target.value))}
                    />
                </div>
            </label>
        </div>
        <div className="control-group"><label><span>Zoom Reveal</span><input type="checkbox" checked={starZoomReveal} onChange={e => setStarZoomReveal(e.target.checked)} /></label></div>
        <div className="control-group"><label><span>Projection</span><select value={projection} onChange={e => setProjection(e.target.value as any)} style={{ background: '#1a1a2e', color: '#fff', border: '1px solid #333', borderRadius: 4, padding: '2px 4px', fontSize: 12 }}><option value="blended">Blended (Auto)</option><option value="perspective">Perspective</option><option value="stereographic">Stereographic</option></select></label></div>
        <div className="control-group">
            <label style={{ justifyContent: 'space-between', width: '100%' }}>
                <span>Blend Override</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <input
                        type="number"
                        min="-1" max="1" step="0.05"
                        value={projectionBlendOverride}
                        onChange={e => setProjectionBlendOverride(Number(e.target.value))}
                        style={{ width: 48, background: '#1a1a2e', color: '#fff', border: '1px solid #333', borderRadius: 4, padding: '1px 4px', fontSize: 11, textAlign: 'right' }}
                    />
                    <input
                        type="range"
                        min="-1" max="1" step="0.05"
                        value={projectionBlendOverride}
                        onChange={e => setProjectionBlendOverride(Number(e.target.value))}
                    />
                </div>
            </label>
        </div>
        <div className="control-group"><label><span>Disable Zenith Bias</span><input type="checkbox" checked={disableZenithBias} onChange={e => setDisableZenithBias(e.target.checked)} /></label></div>
        <div className="control-group"><label><span>Disable Zenith Flatten</span><input type="checkbox" checked={disableZenithFlatten} onChange={e => setDisableZenithFlatten(e.target.checked)} /></label></div>
        <div className="control-group"><label><span>Disable Horizon Theme</span><input type="checkbox" checked={disableHorizonTheme} onChange={e => setDisableHorizonTheme(e.target.checked)} /></label></div>
        <div className="control-group"><label><span>Horizon Diagnostics</span><input type="checkbox" checked={horizonDiagnostics} onChange={e => setHorizonDiagnostics(e.target.checked)} /></label></div>
        <div className="control-group">
            <label style={{ justifyContent: 'space-between', width: '100%' }}>
                <span>Freeze Band Start</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <input
                        type="number"
                        min="50" max="120" step="1"
                        value={freezeBandStartFov}
                        onChange={e => setFreezeBandStartFov(Number(e.target.value))}
                        style={{ width: 48, background: '#1a1a2e', color: '#fff', border: '1px solid #333', borderRadius: 4, padding: '1px 4px', fontSize: 11, textAlign: 'right' }}
                    />
                    <input
                        type="range"
                        min="50" max="120" step="1"
                        value={freezeBandStartFov}
                        onChange={e => setFreezeBandStartFov(Number(e.target.value))}
                    />
                </div>
            </label>
        </div>
        <div className="control-group">
            <label style={{ justifyContent: 'space-between', width: '100%' }}>
                <span>Freeze Band End</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <input
                        type="number"
                        min="50" max="120" step="1"
                        value={freezeBandEndFov}
                        onChange={e => setFreezeBandEndFov(Number(e.target.value))}
                        style={{ width: 48, background: '#1a1a2e', color: '#fff', border: '1px solid #333', borderRadius: 4, padding: '1px 4px', fontSize: 11, textAlign: 'right' }}
                    />
                    <input
                        type="range"
                        min="50" max="120" step="1"
                        value={freezeBandEndFov}
                        onChange={e => setFreezeBandEndFov(Number(e.target.value))}
                    />
                </div>
            </label>
        </div>
        <div className="control-group">
            <label style={{ justifyContent: 'space-between', width: '100%' }}>
                <span>Zenith Bias Start</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <input
                        type="number"
                        min="50" max="120" step="1"
                        value={zenithBiasStartFov}
                        onChange={e => setZenithBiasStartFov(Number(e.target.value))}
                        style={{ width: 48, background: '#1a1a2e', color: '#fff', border: '1px solid #333', borderRadius: 4, padding: '1px 4px', fontSize: 11, textAlign: 'right' }}
                    />
                    <input
                        type="range"
                        min="50" max="120" step="1"
                        value={zenithBiasStartFov}
                        onChange={e => setZenithBiasStartFov(Number(e.target.value))}
                    />
                </div>
            </label>
        </div>
        <div className="control-group">
            <label style={{ justifyContent: 'space-between', width: '100%' }}>
                <span>Vert Pan FOV Start</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <input
                        type="number"
                        min="40" max="130" step="1"
                        value={verticalPanDampStartFov}
                        onChange={e => setVerticalPanDampStartFov(Number(e.target.value))}
                        style={{ width: 48, background: '#1a1a2e', color: '#fff', border: '1px solid #333', borderRadius: 4, padding: '1px 4px', fontSize: 11, textAlign: 'right' }}
                    />
                    <input
                        type="range"
                        min="40" max="130" step="1"
                        value={verticalPanDampStartFov}
                        onChange={e => setVerticalPanDampStartFov(Number(e.target.value))}
                    />
                </div>
            </label>
        </div>
        <div className="control-group">
            <label style={{ justifyContent: 'space-between', width: '100%' }}>
                <span>Vert Pan FOV End</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <input
                        type="number"
                        min="40" max="130" step="1"
                        value={verticalPanDampEndFov}
                        onChange={e => setVerticalPanDampEndFov(Number(e.target.value))}
                        style={{ width: 48, background: '#1a1a2e', color: '#fff', border: '1px solid #333', borderRadius: 4, padding: '1px 4px', fontSize: 11, textAlign: 'right' }}
                    />
                    <input
                        type="range"
                        min="40" max="130" step="1"
                        value={verticalPanDampEndFov}
                        onChange={e => setVerticalPanDampEndFov(Number(e.target.value))}
                    />
                </div>
            </label>
        </div>
        <div className="control-group">
            <label style={{ justifyContent: 'space-between', width: '100%' }}>
                <span>Vert Pan Lat Start</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <input
                        type="number"
                        min="0" max="89" step="1"
                        value={verticalPanDampLatStartDeg}
                        onChange={e => setVerticalPanDampLatStartDeg(Number(e.target.value))}
                        style={{ width: 48, background: '#1a1a2e', color: '#fff', border: '1px solid #333', borderRadius: 4, padding: '1px 4px', fontSize: 11, textAlign: 'right' }}
                    />
                    <input
                        type="range"
                        min="0" max="89" step="1"
                        value={verticalPanDampLatStartDeg}
                        onChange={e => setVerticalPanDampLatStartDeg(Number(e.target.value))}
                    />
                </div>
            </label>
        </div>
        <div className="control-group">
            <label style={{ justifyContent: 'space-between', width: '100%' }}>
                <span>Vert Pan Lat End</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <input
                        type="number"
                        min="0" max="89" step="1"
                        value={verticalPanDampLatEndDeg}
                        onChange={e => setVerticalPanDampLatEndDeg(Number(e.target.value))}
                        style={{ width: 48, background: '#1a1a2e', color: '#fff', border: '1px solid #333', borderRadius: 4, padding: '1px 4px', fontSize: 11, textAlign: 'right' }}
                    />
                    <input
                        type="range"
                        min="0" max="89" step="1"
                        value={verticalPanDampLatEndDeg}
                        onChange={e => setVerticalPanDampLatEndDeg(Number(e.target.value))}
                    />
                </div>
            </label>
        </div>
        <div className="control-group">
            <label style={{ justifyContent: 'space-between', width: '100%' }}>
                <span>Chapter Label Max FOV</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <input
                        type="number"
                        min="5" max="120" step="1"
                        value={chapterLabelMaxFov}
                        onChange={e => setChapterLabelMaxFov(Number(e.target.value))}
                        style={{ width: 48, background: '#1a1a2e', color: '#fff', border: '1px solid #333', borderRadius: 4, padding: '1px 4px', fontSize: 11, textAlign: 'right' }}
                    />
                    <input
                        type="range"
                        min="5" max="120" step="1"
                        value={chapterLabelMaxFov}
                        onChange={e => setChapterLabelMaxFov(Number(e.target.value))}
                    />
                </div>
            </label>
        </div>
        <div className="control-group">
            <label style={{ justifyContent: 'space-between', width: '100%' }}>
                <span>Label Overlap (px)</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <input
                        type="number"
                        min="0" max="40" step="1"
                        value={labelOverlapPx}
                        onChange={e => setLabelOverlapPx(Number(e.target.value))}
                        style={{ width: 48, background: '#1a1a2e', color: '#fff', border: '1px solid #333', borderRadius: 4, padding: '1px 4px', fontSize: 11, textAlign: 'right' }}
                    />
                    <input
                        type="range"
                        min="0" max="40" step="1"
                        value={labelOverlapPx}
                        onChange={e => setLabelOverlapPx(Number(e.target.value))}
                    />
                </div>
            </label>
        </div>
        <div className="control-group">
            <label style={{ justifyContent: 'space-between', width: '100%' }}>
                <span>Label Reappear Delay (ms)</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <input
                        type="number"
                        min="0" max="1000" step="10"
                        value={labelReappearDelayMs}
                        onChange={e => setLabelReappearDelayMs(Number(e.target.value))}
                        style={{ width: 56, background: '#1a1a2e', color: '#fff', border: '1px solid #333', borderRadius: 4, padding: '1px 4px', fontSize: 11, textAlign: 'right' }}
                    />
                    <input
                        type="range"
                        min="0" max="1000" step="10"
                        value={labelReappearDelayMs}
                        onChange={e => setLabelReappearDelayMs(Number(e.target.value))}
                    />
                </div>
            </label>
        </div>

        <div className="divider"></div>
        
        <div className="status">FOV: {currentFov.toFixed(1)}°</div>
        <div className="status" style={{ color: '#f4a' }}>
            Mode: {
                projection === 'blended' ? 'Blended (Auto)' :
                projection === 'perspective' ? 'Perspective' :
                'Stereographic'
            }
        </div>

        <div className="divider"></div>

        {/* Mode switcher */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
            {(["view", "edit", "assign"] as const).map(m => (
                <button
                    key={m}
                    onClick={() => setMode(m)}
                    style={{
                        flex: 1,
                        fontSize: 11,
                        padding: '4px 2px',
                        background: mode === m
                            ? m === "edit" ? "#7f1d1d" : m === "assign" ? "#1a3a1a" : "#1e3a8a"
                            : "#1f2937",
                        borderColor: mode === m
                            ? m === "edit" ? "#ef4444" : m === "assign" ? "#22c55e" : "#3b82f6"
                            : "#374151",
                        color: mode === m ? "#fff" : "#9ca3af",
                        textTransform: "capitalize",
                    }}
                >
                    {m}
                </button>
            ))}
        </div>

        {mode === "edit" && (
            <div style={{ marginTop: 4 }}>
                <button
                    onClick={handleGenerate}
                    style={{ background: "#581c87", borderColor: "#8b5cf6" }}
                >
                    Generate Galaxy
                </button>
                <button onClick={handleExport}>Export JSON</button>
                <p className="sub-text">
                    Click Export, then overwrite <code>builder/app/arrangement.json</code>.
                </p>
            </div>
        )}

        {mode === "assign" && (
            <div style={{ marginTop: 4 }}>
                {!assignSession?.skyField ? (
                    <div>
                        <p className="sub-text" style={{ marginBottom: 8 }}>
                            Import a SkyField JSON to begin assigning chapters to stars.
                        </p>
                        <label style={{ display: 'block', cursor: 'pointer' }}>
                            <input
                                type="file"
                                accept=".json"
                                style={{ display: 'none' }}
                                onChange={e => {
                                    const f = e.target.files?.[0];
                                    if (f) handleImportAssignSkyField(f);
                                    e.target.value = "";
                                }}
                            />
                            <span
                                style={{
                                    display: 'block',
                                    textAlign: 'center',
                                    padding: '6px 10px',
                                    background: '#14532d',
                                    border: '1px solid #22c55e',
                                    borderRadius: 4,
                                    fontSize: 12,
                                    color: '#86efac',
                                    cursor: 'pointer',
                                }}
                            >
                                Import SkyField JSON
                            </span>
                        </label>
                    </div>
                ) : (
                    <>
                        {/* Progress */}
                        {(() => {
                            const total = CANON.length;
                            const done  = Object.keys(assignSession.assignments).length;
                            const pct   = Math.round((done / total) * 100);
                            return (
                                <div style={{ marginBottom: 10 }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#9ca3af', marginBottom: 3 }}>
                                        <span>Progress</span>
                                        <span>{done} / {total} ({pct}%)</span>
                                    </div>
                                    <div style={{ height: 4, background: '#1f2937', borderRadius: 2, overflow: 'hidden' }}>
                                        <div style={{ height: '100%', width: `${pct}%`, background: '#22c55e', transition: 'width 0.3s' }} />
                                    </div>
                                </div>
                            );
                        })()}

                        {/* Selected marker (unassigned star) */}
                        {selectedMarkerStarId !== null && (
                            <div style={{ marginBottom: 10, padding: 8, background: '#1c1f12', border: '1px solid #f59e0b', borderRadius: 6, fontSize: 12 }}>
                                <div style={{ color: '#fcd34d', fontWeight: 'bold', marginBottom: 4 }}>
                                    Unassigned Star #{selectedMarkerStarId}
                                </div>
                                {(() => {
                                    const existingCh = assignStarToChapter.get(selectedMarkerStarId);
                                    if (existingCh !== undefined) {
                                        const ch = CANON[existingCh];
                                        return (
                                            <div style={{ color: '#d1d5db', marginBottom: 6 }}>
                                                Assigned to: {ch?.bookName} {ch?.chapterNumber}
                                            </div>
                                        );
                                    }
                                    return null;
                                })()}
                                <p className="sub-text" style={{ marginBottom: 6 }}>
                                    Select a chapter star to re-assign, or click the map to dismiss.
                                </p>
                                <button
                                    onClick={handleDeassign}
                                    style={{ fontSize: 11, padding: '3px 8px', background: '#7f1d1d', borderColor: '#ef4444' }}
                                >
                                    De-assign
                                </button>
                            </div>
                        )}

                        {/* Selected assigned chapter */}
                        {selectedAssignNode && (
                            <div style={{ marginBottom: 10, padding: 8, background: '#0f1e2e', border: '1px solid #3b82f6', borderRadius: 6, fontSize: 12 }}>
                                <div style={{ color: '#93c5fd', fontWeight: 'bold', marginBottom: 4 }}>
                                    {selectedAssignNode.label}
                                </div>
                                {(() => {
                                    const meta = selectedAssignNode.meta as any;
                                    return (
                                        <div style={{ color: '#9ca3af', fontSize: 11, lineHeight: 1.6 }}>
                                            {meta.testament && <div>Testament: {meta.testament}</div>}
                                            {meta.division  && <div>Division: {meta.division}</div>}
                                        </div>
                                    );
                                })()}
                                {selectedMarkerStarId !== null && (
                                    <button
                                        onClick={() => {
                                            const chIdx = chapterNodeToGlobalIndex(selectedAssignNode.id);
                                            if (chIdx !== undefined) handleAssign(chIdx, selectedMarkerStarId);
                                        }}
                                        style={{ marginTop: 6, fontSize: 11, padding: '3px 8px', background: '#14532d', borderColor: '#22c55e', color: '#86efac' }}
                                    >
                                        Assign to Star #{selectedMarkerStarId}
                                    </button>
                                )}
                                <button
                                    onClick={handleDeassign}
                                    style={{ marginTop: 6, marginLeft: 4, fontSize: 11, padding: '3px 8px', background: '#7f1d1d', borderColor: '#ef4444' }}
                                >
                                    De-assign
                                </button>
                            </div>
                        )}

                        {/* Actions */}
                        <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                            <label style={{ flex: 1, cursor: 'pointer' }}>
                                <input
                                    type="file"
                                    accept=".json"
                                    style={{ display: 'none' }}
                                    onChange={e => {
                                        const f = e.target.files?.[0];
                                        if (f) handleImportAssignSkyField(f);
                                        e.target.value = "";
                                    }}
                                />
                                <span style={{ display: 'block', textAlign: 'center', padding: '4px 6px', background: '#1f2937', border: '1px solid #374151', borderRadius: 4, fontSize: 11, color: '#9ca3af', cursor: 'pointer' }}>
                                    Replace SkyField
                                </span>
                            </label>
                            <button
                                onClick={handleExportAssignmentArrangement}
                                style={{ flex: 1, fontSize: 11, padding: '4px 6px', background: '#1e3a8a', borderColor: '#3b82f6' }}
                            >
                                Export arrangement.json
                            </button>
                        </div>
                    </>
                )}
            </div>
        )}

        </>}
      </div>

      <StarMap
        ref={mapRef}
        className="starmap"
        config={mode === "assign" && assignConfig ? assignConfig : config}
        onSelect={handleSelect}
        onHover={handleHover}
        onArrangementChange={handleArrangementChange}
        onFovChange={setCurrentFov}
        onLongPress={handleLongPress}
        onMarkerSelect={handleMarkerSelect}
      />

      {/* Long-press info popup */}
      {longPressInfo && (
        <div
          className="long-press-popup"
          style={{
            position: 'fixed',
            left: Math.min(longPressInfo.x, window.innerWidth - 220),
            top: Math.max(longPressInfo.y - 120, 10),
            background: 'rgba(10, 15, 25, 0.95)',
            border: '1px solid #4fa',
            borderRadius: 8,
            padding: 12,
            minWidth: 200,
            maxWidth: 280,
            zIndex: 200,
            color: '#fff',
            fontSize: 13,
            boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
          }}
          onClick={() => setLongPressInfo(null)}
        >
          {longPressInfo.node ? (
            <>
              <div style={{ fontWeight: 'bold', marginBottom: 6, color: '#4fa' }}>
                {longPressInfo.node.label}
              </div>
              {longPressInfo.node.meta && (
                <div style={{ fontSize: 11, color: '#aaa', lineHeight: 1.5 }}>
                  {(longPressInfo.node.meta as any).testament && (
                    <div>Testament: {(longPressInfo.node.meta as any).testament}</div>
                  )}
                  {(longPressInfo.node.meta as any).division && (
                    <div>Division: {(longPressInfo.node.meta as any).division}</div>
                  )}
                  {(longPressInfo.node.meta as any).book && (
                    <div>Book: {(longPressInfo.node.meta as any).book}</div>
                  )}
                  {(longPressInfo.node.meta as any).chapter && (
                    <div>Chapter: {(longPressInfo.node.meta as any).chapter}</div>
                  )}
                </div>
              )}
              <div style={{ fontSize: 10, color: '#666', marginTop: 8 }}>
                Tap to dismiss
              </div>
            </>
          ) : (
            <div style={{ color: '#888' }}>No star selected</div>
          )}
        </div>
      )}

      {/* Gesture hints overlay */}
      {showGestureHints && (
        <div
          className="gesture-hints-overlay"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.85)',
            zIndex: 300,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
            color: '#fff',
          }}
          onClick={dismissGestureHints}
        >
          <div style={{ maxWidth: 320, textAlign: 'center' }}>
            <h2 style={{ fontSize: 22, marginBottom: 24, color: '#4fa' }}>
              Touch Controls
            </h2>
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>👆</div>
              <div style={{ fontSize: 14, color: '#ccc' }}>
                <strong>Drag</strong> to rotate the sky
              </div>
            </div>
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>🤏</div>
              <div style={{ fontSize: 14, color: '#ccc' }}>
                <strong>Pinch</strong> to zoom in/out
              </div>
            </div>
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>👆👆</div>
              <div style={{ fontSize: 14, color: '#ccc' }}>
                <strong>Double-tap</strong> to fly to a star
              </div>
            </div>
            <div style={{ marginBottom: 30 }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>👆⏱️</div>
              <div style={{ fontSize: 14, color: '#ccc' }}>
                <strong>Long-press</strong> for star info
              </div>
            </div>
            <button
              onClick={dismissGestureHints}
              style={{
                background: '#4fa',
                color: '#000',
                border: 'none',
                padding: '12px 32px',
                borderRadius: 8,
                fontSize: 16,
                fontWeight: 'bold',
                cursor: 'pointer',
              }}
            >
              Got it!
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
