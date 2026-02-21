"use client";

import { useCallback, useMemo, useState, useRef, useEffect } from "react";
import type { SceneNode, StarMapConfig, StarArrangement, StarMapHandle, BibleJSON, HierarchyFilter } from "@project-skymap/library";
import { StarMap, bibleToSceneModel, createBibleTileStreaming, generateArrangement, defaultGenerateOptions } from "@project-skymap/library";
import bible from "../public/bible.json";
import initialArrangement from "./arrangement.json";
import groups from "./groups.json";
import labelColors from "../public/colours.json";

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

// Define a "Correct Answer" for testing
const ANSWER = {
  testament: "New",
  division: "Paul's Letters",
  book: "Romans",
  bookKey: "ROM",
  chapter: 8
};

export default function Page() {
  const [focusNodeId, setFocusNodeId] = useState<string | undefined>(undefined);
  const [arrangement, setArrangement] = useState<StarArrangement>(initialArrangement as unknown as StarArrangement);
  const [isEditable, setIsEditable] = useState(false);
  const [showBookLabels, setShowBookLabels] = useState(true);
  const [showDivisionLabels, setShowDivisionLabels] = useState(false);
  const [showChapterLabels, setShowChapterLabels] = useState(true);
  const [showGroupLabels, setShowGroupLabels] = useState(true);
  const [showLines, setShowLines] = useState(false);
  const [showBoundaries, setShowBoundaries] = useState(false);
  const [initialLon, setInitialLon] = useState(275);
  const [currentFov, setCurrentFov] = useState(50);
  const [showConstellationArt, setShowConstellationArt] = useState(true);
  const [showBackdropStars, setShowBackdropStars] = useState(true);
  const [backdropStarsCount, setBackdropStarsCount] = useState(31000);
  const [showAtmosphere, setShowAtmosphere] = useState(false);
  const [projection, setProjection] = useState<"perspective" | "stereographic" | "blended">("blended");
  const [useEngineNext, setUseEngineNext] = useState(true);
  const [useBibleTileStreaming, setUseBibleTileStreaming] = useState(true);
  const [showTelemetry, setShowTelemetry] = useState(true);
  const [telemetryRecording, setTelemetryRecording] = useState(false);
  const [telemetrySessionName, setTelemetrySessionName] = useState("");
  const [constellationConfig, setConstellationConfig] = useState<any>(null);
  const [revealOrderEnabled, setRevealOrderEnabled] = useState(true);
  const [selectedGuess, setSelectedGuess] = useState<SceneNode | null>(null);
  const [hierarchyFilter, setHierarchyFilter] = useState<HierarchyFilter | null>(null);
  const [guessHistory, setGuessHistory] = useState<{node: SceneNode, result: string}[]>([]);
  const [solved, setSolved] = useState(false);
  const [sheetExpanded, setSheetExpanded] = useState(false);
  const [longPressInfo, setLongPressInfo] = useState<{ node: SceneNode | null; x: number; y: number } | null>(null);
  const [showGestureHints, setShowGestureHints] = useState(false);
  const touchStartY = useRef<number | null>(null);
  const mapRef = useRef<StarMapHandle>(null);
  const frameCountRef = useRef(0);
  const frameDeltaSumRef = useRef(0);
  const lastFrameTsRef = useRef(0);
  const sampleStartTsRef = useRef(0);
  const telemetryStartedAtRef = useRef(0);
  const telemetrySamplesRef = useRef<Array<Record<string, unknown>>>([]);
  const telemetryEventsRef = useRef<Array<Record<string, unknown>>>([]);
  const [telemetry, setTelemetry] = useState<{
    fps: number;
    frameMs: number;
    sampleMs: number;
    debug?: Record<string, unknown>;
  }>({ fps: 0, frameMs: 0, sampleMs: 0, debug: undefined });

  const addTelemetryEvent = useCallback((type: string, payload?: Record<string, unknown>) => {
    if (!telemetryRecording) return;
    const now = performance.now();
    const started = telemetryStartedAtRef.current || now;
    telemetryEventsRef.current.push({
      tMs: now - started,
      type,
      ...(payload ?? {}),
    });
  }, [telemetryRecording]);

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

  useEffect(() => {
    let raf = 0;
    function step(ts: number) {
      if (lastFrameTsRef.current > 0) {
        frameDeltaSumRef.current += Math.max(0, ts - lastFrameTsRef.current);
      }
      frameCountRef.current += 1;
      if (sampleStartTsRef.current === 0) sampleStartTsRef.current = ts;
      lastFrameTsRef.current = ts;
      raf = requestAnimationFrame(step);
    }
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      frameCountRef.current = 0;
      frameDeltaSumRef.current = 0;
      lastFrameTsRef.current = 0;
      sampleStartTsRef.current = 0;
    };
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => {
      const now = performance.now();
      const elapsed = Math.max(1, now - (sampleStartTsRef.current || now));
      const frames = frameCountRef.current;
      const fps = frames > 0 ? (frames * 1000) / elapsed : 0;
      const frameMs = frames > 0 ? frameDeltaSumRef.current / frames : 0;
      const debug = mapRef.current?.getDebugState?.();
      setTelemetry({
        fps,
        frameMs,
        sampleMs: elapsed,
        debug,
      });
      if (telemetryRecording) {
        const started = telemetryStartedAtRef.current || now;
        telemetrySamplesRef.current.push({
          tMs: now - started,
          fps,
          frameMs,
          debug: debug ?? null,
        });
      }
      frameCountRef.current = 0;
      frameDeltaSumRef.current = 0;
      sampleStartTsRef.current = now;
    }, 1000);
    return () => clearInterval(id);
  }, [telemetryRecording]);

  const startTelemetryRecording = useCallback(() => {
    const now = performance.now();
    telemetryStartedAtRef.current = now;
    telemetrySamplesRef.current = [];
    telemetryEventsRef.current = [];
    setTelemetryRecording(true);
  }, []);

  const stopTelemetryRecording = useCallback(() => {
    setTelemetryRecording(false);
  }, []);

  const clearTelemetryRecording = useCallback(() => {
    telemetrySamplesRef.current = [];
    telemetryEventsRef.current = [];
    telemetryStartedAtRef.current = telemetryStartedAtRef.current || performance.now();
  }, []);

  const buildTelemetryPayload = useCallback(() => {
    const started = telemetryStartedAtRef.current || performance.now();
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      sessionName: telemetrySessionName || undefined,
      engineVariant: useEngineNext ? "next" : "legacy",
      tileStreamingEnabled: useEngineNext && useBibleTileStreaming,
      startedAtMs: started,
      sampleCount: telemetrySamplesRef.current.length,
      eventCount: telemetryEventsRef.current.length,
      samples: telemetrySamplesRef.current,
      events: telemetryEventsRef.current,
    };
  }, [telemetrySessionName, useBibleTileStreaming, useEngineNext]);

  const exportTelemetryRecording = useCallback(() => {
    const payload = buildTelemetryPayload();
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const name = telemetrySessionName.trim() ? telemetrySessionName.trim().replace(/\s+/g, "-") : "session";
    const a = document.createElement("a");
    a.href = url;
    a.download = `telemetry-${name}-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [buildTelemetryPayload, telemetrySessionName]);

  useEffect(() => {
    (window as any).__skymapTelemetryExport = () => buildTelemetryPayload();
    (window as any).__skymapTelemetryStart = () => startTelemetryRecording();
    (window as any).__skymapTelemetryStop = () => stopTelemetryRecording();
    (window as any).__skymapTelemetryClear = () => clearTelemetryRecording();
    (window as any).__skymapGetDebugState = () => mapRef.current?.getDebugState?.() ?? null;
    return () => {
      delete (window as any).__skymapTelemetryExport;
      delete (window as any).__skymapTelemetryStart;
      delete (window as any).__skymapTelemetryStop;
      delete (window as any).__skymapTelemetryClear;
      delete (window as any).__skymapGetDebugState;
    };
  }, [buildTelemetryPayload, clearTelemetryRecording, startTelemetryRecording, stopTelemetryRecording]);

  const sceneModel = useMemo(() => bibleToSceneModel(bible as BibleJSON), []);

  const bibleTileStreaming = useMemo(() => {
    if (!useEngineNext || !useBibleTileStreaming) return undefined;
    return createBibleTileStreaming(sceneModel, arrangement, {
      maxLoadedTiles: 28,
      maxConcurrentLoads: 4,
      transitionFrames: 0,
      selector: {
        maxSelectedTiles: 8,
        maxDepth: 4,
        refinementFovDeg: 58,
      },
    });
  }, [useEngineNext, useBibleTileStreaming, sceneModel, arrangement]);

  const config = useMemo<StarMapConfig>(
    () => ({
      background: "#05060a",
      camera: { lon: initialLon * Math.PI / 180 },
      data: bible,
      adapter: bibleToSceneModel,
      model: sceneModel,
      arrangement,
      editable: isEditable,
      groups: groups as any,
      labelColors: labelColors as Record<string, string>,
      showBookLabels,
      showDivisionLabels,
      showChapterLabels,
      showGroupLabels,
      showConstellationLines: showLines,
      showDivisionBoundaries: showBoundaries,
      showConstellationArt,
      showBackdropStars,
      backdropStarsCount,
      showAtmosphere,
      projection,
      engineVariant: useEngineNext ? "next" : "legacy",
      tileStreaming: bibleTileStreaming,
      constellations: constellationConfig,
      fitProjection: true,
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
    [focusNodeId, arrangement, isEditable, showBookLabels, showDivisionLabels, showChapterLabels, showGroupLabels, showLines, showBoundaries, showConstellationArt, showBackdropStars, backdropStarsCount, constellationConfig, initialLon, projection, useEngineNext, bibleTileStreaming, sceneModel]
  );

  const handleSelect = useCallback((node: SceneNode) => {
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
  }, [solved]);

  const handleSubmitGuess = useCallback(() => {
    if (!selectedGuess || solved) return;
    const meta = selectedGuess.meta as { testament: string; division: string; bookKey: string; chapter: number };

    // Zoom into the guessed star
    mapRef.current?.flyTo(selectedGuess.id, 10);

    // Check exact match
    if (meta.bookKey === ANSWER.bookKey && meta.chapter === ANSWER.chapter) {
        addTelemetryEvent("guess_submit", { nodeId: selectedGuess.id, result: "correct" });
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
    addTelemetryEvent("guess_submit", { nodeId: selectedGuess.id, result, matchLevel: matchLevel || null });

    // Merge with existing filter (only narrows, never widens)
    if (matchLevel) {
        setHierarchyFilter(prev => prev ? { ...prev, ...newFilter } : newFilter);
    }

    setGuessHistory(prev => [...prev, { node: selectedGuess, result }]);
    setSelectedGuess(null);
  }, [addTelemetryEvent, selectedGuess, solved]);

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

  useEffect(() => {
    addTelemetryEvent("toggle_engine_next", { value: useEngineNext });
  }, [addTelemetryEvent, useEngineNext]);

  useEffect(() => {
    addTelemetryEvent("toggle_tile_streaming", { value: useBibleTileStreaming });
  }, [addTelemetryEvent, useBibleTileStreaming]);

  const debugAny = telemetry.debug as Record<string, any> | undefined;
  const tileDebug = debugAny?.tile as Record<string, any> | undefined;

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

        <div className="divider"></div>

        <div className="control-group">
            <label style={{ justifyContent: 'space-between', width: '100%' }}>
                <span>Rotation</span>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                    <span className="value-display" style={{ marginRight: 5 }}>{initialLon}°</span>
                    <input 
                        type="range" 
                        min="0" max="360" 
                        value={initialLon} 
                        onChange={e => setInitialLon(Number(e.target.value))} 
                    />
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
        <div className="control-group"><label><span>Backdrop Stars</span><input type="checkbox" checked={showBackdropStars} onChange={e => setShowBackdropStars(e.target.checked)} /></label></div>
        {showBackdropStars && (
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
        )}
        <div className="control-group"><label><span>Atmosphere</span><input type="checkbox" checked={showAtmosphere} onChange={e => setShowAtmosphere(e.target.checked)} /></label></div>
        <div className="control-group"><label><span>Projection</span><select value={projection} onChange={e => setProjection(e.target.value as any)} style={{ background: '#1a1a2e', color: '#fff', border: '1px solid #333', borderRadius: 4, padding: '2px 4px', fontSize: 12 }}><option value="blended">Blended (Auto)</option><option value="perspective">Perspective</option><option value="stereographic">Stereographic</option></select></label></div>
        <div className="control-group"><label><span>Engine Next</span><input data-testid="toggle-engine-next" type="checkbox" checked={useEngineNext} onChange={e => setUseEngineNext(e.target.checked)} /></label></div>
        <div className="control-group">
          <label>
            <span>Bible Tile Streaming</span>
            <input
              data-testid="toggle-tile-streaming"
              type="checkbox"
              checked={useBibleTileStreaming}
              onChange={e => setUseBibleTileStreaming(e.target.checked)}
              disabled={!useEngineNext}
            />
          </label>
        </div>
        <div className="control-group"><label><span>Telemetry Overlay</span><input type="checkbox" checked={showTelemetry} onChange={e => setShowTelemetry(e.target.checked)} /></label></div>
        <div className="control-group">
          <label style={{ justifyContent: "space-between", width: "100%" }}>
            <span>Telemetry Session</span>
            <input
              data-testid="input-telemetry-session-name"
              type="text"
              value={telemetrySessionName}
              onChange={(e) => setTelemetrySessionName(e.target.value)}
              placeholder="optional name"
              style={{ background: "#1a1a2e", color: "#fff", border: "1px solid #333", borderRadius: 4, padding: "2px 6px", fontSize: 11, width: 120 }}
            />
          </label>
        </div>
        <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
          {!telemetryRecording ? (
            <button data-testid="btn-telemetry-record" onClick={startTelemetryRecording} style={{ flex: 1, background: "#14532d", borderColor: "#22c55e" }}>
              Record
            </button>
          ) : (
            <button data-testid="btn-telemetry-stop" onClick={stopTelemetryRecording} style={{ flex: 1, background: "#7f1d1d", borderColor: "#ef4444" }}>
              Stop
            </button>
          )}
          <button data-testid="btn-telemetry-clear" onClick={clearTelemetryRecording} style={{ flex: 1 }}>
            Clear
          </button>
          <button data-testid="btn-telemetry-export" onClick={exportTelemetryRecording} style={{ flex: 1 }}>
            Export
          </button>
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

        <button 
            onClick={() => setIsEditable(!isEditable)}
            style={{ background: isEditable ? "#7f1d1d" : "#1e3a8a", borderColor: isEditable ? "#ef4444" : "#3b82f6" }}
        >
            {isEditable ? "Stop Editing" : "Edit Stars"}
        </button>
        
        {isEditable && (
            <div style={{ marginTop: 10 }}>
                <button 
                    onClick={handleGenerate}
                    style={{ background: "#581c87", borderColor: "#8b5cf6" }}
                >
                    Generate Galaxy
                </button>
                <button 
                    onClick={handleExport}
                >
                    Export JSON
                </button>
                <p className="sub-text">
                    Click Export, then overwrite <code>builder/app/arrangement.json</code>.
                </p>
            </div>
        )}
      </div>

      <StarMap
        ref={mapRef}
        testId="starmap-canvas"
        className="starmap"
        config={config}
        onSelect={(node) => {
          addTelemetryEvent("select", {
            nodeId: node.id,
            level: node.level,
            parent: node.parent ?? null,
          });
          handleSelect(node);
        }}
        onHover={handleHover}
        onArrangementChange={handleArrangementChange}
        onFovChange={setCurrentFov}
        onLongPress={(node, x, y) => {
          addTelemetryEvent("long_press", {
            nodeId: node?.id ?? null,
            x,
            y,
          });
          handleLongPress(node, x, y);
        }}
      />

      {showTelemetry && (
        <div
          style={{
            position: "fixed",
            right: 12,
            top: 12,
            zIndex: 250,
            minWidth: 250,
            maxWidth: 360,
            background: "rgba(7, 11, 20, 0.86)",
            border: "1px solid rgba(106, 176, 255, 0.45)",
            borderRadius: 8,
            color: "#dbeafe",
            padding: "10px 12px",
            fontSize: 11,
            lineHeight: 1.45,
            backdropFilter: "blur(6px)",
            pointerEvents: "none",
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 4, color: "#93c5fd" }}>Telemetry</div>
          <div>Recording: {telemetryRecording ? "yes" : "no"} | Samples: {telemetrySamplesRef.current.length} | Events: {telemetryEventsRef.current.length}</div>
          <div>Engine: {String((telemetry.debug?.engine as string | undefined) ?? (useEngineNext ? "next" : "legacy"))}</div>
          <div>FPS: {telemetry.fps.toFixed(1)} | Frame: {telemetry.frameMs.toFixed(2)}ms</div>
          <div>FOV: {Number((telemetry.debug?.fovDeg as number | undefined) ?? currentFov).toFixed(2)}</div>
          <div>Yaw/Pitch: {Number((telemetry.debug?.yawRad as number | undefined) ?? 0).toFixed(3)} / {Number((telemetry.debug?.pitchRad as number | undefined) ?? 0).toFixed(3)}</div>
          {tileDebug && (
            <div>
              Tiles: {tileDebug.activeCount}/{tileDebug.loadedCount}
              {" "}Q:{tileDebug.queueCount} IF:{tileDebug.inFlightCount}
            </div>
          )}
          {typeof telemetry.debug?.renderMs === "number" && typeof telemetry.debug?.updateMs === "number" && (
            <div>Core update/render: {(telemetry.debug.updateMs as number).toFixed(2)} / {(telemetry.debug.renderMs as number).toFixed(2)} ms</div>
          )}
        </div>
      )}

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
