"use client";

import { useCallback, useMemo, useState, useRef, useEffect } from "react";
import type { SceneNode, StarMapConfig, StarArrangement, StarMapHandle, BibleJSON, HierarchyFilter } from "@project-skymap/library";
import { StarMap, bibleToSceneModel, generateArrangement, defaultGenerateOptions } from "@project-skymap/library";
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
  const [constellationBaseOpacity, setConstellationBaseOpacity] = useState(25);
  const [showBackdropStars, setShowBackdropStars] = useState(true);
  const [backdropStarsCount, setBackdropStarsCount] = useState(5000);
  const [backdropWideFovGain, setBackdropWideFovGain] = useState(0);
  const [backdropSizeExponent, setBackdropSizeExponent] = useState(0.2);
  const [backdropEnergy, setBackdropEnergy] = useState(0.2);
  const [starSizeExponent, setStarSizeExponent] = useState(4.0);
  const [starSizeScale, setStarSizeScale] = useState(6.0);
  const [showAtmosphere, setShowAtmosphere] = useState(false);
  const [showMoon, setShowMoon] = useState(false);
  const [showSunrise, setShowSunrise] = useState(false);
  const [showMilkyWay, setShowMilkyWay] = useState(false);
  const [projection, setProjection] = useState<"perspective" | "stereographic" | "blended">("blended");
  const [chapterLabelMaxFov, setChapterLabelMaxFov] = useState(46);
  const [labelOverlapPx, setLabelOverlapPx] = useState(12);
  const [labelReappearDelayMs, setLabelReappearDelayMs] = useState(60);
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

  const config = useMemo<StarMapConfig>(
    () => ({
      background: "#05060a",
      camera: { lon: initialLon * Math.PI / 180 },
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
          group: { maxFov: chapterLabelMaxFov + 6, maxOverlapPx: labelOverlapPx }
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
      showAtmosphere,
      showMoon,
      showSunrise,
      showMilkyWay,
      projection,
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
    [focusNodeId, arrangement, isEditable, showBookLabels, showDivisionLabels, showChapterLabels, showGroupLabels, showLines, showBoundaries, showConstellationArt, constellationBaseOpacity, showBackdropStars, backdropStarsCount, backdropWideFovGain, backdropSizeExponent, backdropEnergy, starSizeExponent, starSizeScale, constellationConfig, initialLon, projection, chapterLabelMaxFov, labelOverlapPx, labelReappearDelayMs, showMoon, showSunrise, showMilkyWay]
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
        <div className="control-group"><label><span>Projection</span><select value={projection} onChange={e => setProjection(e.target.value as any)} style={{ background: '#1a1a2e', color: '#fff', border: '1px solid #333', borderRadius: 4, padding: '2px 4px', fontSize: 12 }}><option value="blended">Blended (Auto)</option><option value="perspective">Perspective</option><option value="stereographic">Stereographic</option></select></label></div>
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
        className="starmap"
        config={config}
        onSelect={handleSelect}
        onHover={handleHover}
        onArrangementChange={handleArrangementChange}
        onFovChange={setCurrentFov}
        onLongPress={handleLongPress}
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
