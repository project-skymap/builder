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
  const [currentFov, setCurrentFov] = useState(80);
  const [showConstellationArt, setShowConstellationArt] = useState(true);
  const [showBackdropStars, setShowBackdropStars] = useState(true);
  const [backdropStarsCount, setBackdropStarsCount] = useState(31000);
  const [showAtmosphere, setShowAtmosphere] = useState(false);
  const [projection, setProjection] = useState<"perspective" | "stereographic" | "blended">("blended");
  const [constellationConfig, setConstellationConfig] = useState<any>(null);
  const [revealOrderEnabled, setRevealOrderEnabled] = useState(true);
  const [selectedGuess, setSelectedGuess] = useState<SceneNode | null>(null);
  const [hierarchyFilter, setHierarchyFilter] = useState<HierarchyFilter | null>(null);
  const [guessHistory, setGuessHistory] = useState<{node: SceneNode, result: string}[]>([]);
  const [solved, setSolved] = useState(false);
  const mapRef = useRef<StarMapHandle>(null);

  useEffect(() => {
    fetch("/constellations.json")
      .then(res => res.json())
      .then(data => setConstellationConfig(data))
      .catch(err => console.error("Failed to load constellations:", err));
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
      camera: { fov: 80, z: 120, lon: initialLon * Math.PI / 180 },
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
      showConstellationLines: showLines,
      showDivisionBoundaries: showBoundaries,
      showConstellationArt,
      showBackdropStars,
      backdropStarsCount,
      showAtmosphere,
      projection,
      constellations: constellationConfig,
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
      layout: { mode: "spherical", radius: 500, chapterRingSpacing: 40 },
      focus: {
        nodeId: focusNodeId,
        animate: true
      }
    }),
    [focusNodeId, arrangement, isEditable, showBookLabels, showDivisionLabels, showChapterLabels, showGroupLabels, showLines, showBoundaries, showConstellationArt, showBackdropStars, backdropStarsCount, constellationConfig, initialLon, projection]
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
      <div className="settings-panel">
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

        <div className="divider"></div>
        
        <div className="status">FOV: {currentFov.toFixed(1)}°</div>
        <div className="status" style={{ color: '#f4a' }}>Mode: Spherical</div>

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
      />
    </div>
  );
}
