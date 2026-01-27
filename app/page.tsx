"use client";

import { useCallback, useMemo, useState, useRef, useEffect } from "react";
import type { SceneNode, StarMapConfig, StarArrangement, StarMapHandle, BibleJSON } from "@project-skymap/library";
import { StarMap, bibleToSceneModel, generateArrangement, defaultGenerateOptions } from "@project-skymap/library";
import bible from "../public/bible.json";
import initialArrangement from "./arrangement.json";
import groups from "./groups.json";

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
  division: "Gospels",
  book: "John",
  bookKey: "JHN",
  chapter: 3
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
  const [constellationConfig, setConstellationConfig] = useState<any>(null);
  const [revealOrderEnabled, setRevealOrderEnabled] = useState(true);
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

  const config = useMemo<StarMapConfig>(
    () => ({
      background: "#05060a",
      camera: { fov: 80, z: 120, lon: initialLon * Math.PI / 180 },
      data: bible,
      adapter: bibleToSceneModel,
      arrangement,
      editable: isEditable,
      groups: groups as any,
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
    [focusNodeId, arrangement, isEditable, showBookLabels, showDivisionLabels, showChapterLabels, showGroupLabels, showLines, showBoundaries, showConstellationArt, showBackdropStars, backdropStarsCount, constellationConfig, initialLon]
  );

  const handleSelect = useCallback((node: SceneNode) => {
    // Order Reveal Interaction
    if (node && (node.level === 2 || node.level === 3)) {
        const bookId = node.level === 2 ? node.id : node.parent!;
        mapRef.current?.setFocusedBook(bookId);
    } else {
        mapRef.current?.setFocusedBook(null);
    }
    
    // Existing Game Logic
    console.log("Selected node:", node);

    // Simulate "Is Correct?" logic
    // Level 0: Testament
    if (node.level === 0) {
      if (node.label === ANSWER.testament) {
        setFocusNodeId(node.id);
      }
    }
    // Level 1: Division
    else if (node.level === 1) {
      if (node.label === ANSWER.division) {
        setFocusNodeId(node.id);
      }
    }
    // Level 2: Book
    else if (node.level === 2) {
      const { bookKey } = node.meta as { bookKey: string };
      if (bookKey === ANSWER.bookKey) {
        setFocusNodeId(node.id);
      }
    }
    // Level 3: Chapter
    else if (node.level === 3) {
      const { bookKey, chapter } = node.meta as { bookKey: string; chapter: number };
      if (bookKey === ANSWER.bookKey && chapter === ANSWER.chapter) {
        setFocusNodeId(node.id); // Focus on the winning chapter
      } else if (bookKey === ANSWER.bookKey) {
         // Correct book, wrong chapter -> Focus the book if not already
         setFocusNodeId(`B:${bookKey}`);
      }
    }
  }, []);

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
            <div style={{ marginTop: 4 }}>
               1. New Testament &gt; Prophecy<br/>
               2. Revelation
            </div>
        </div>
        
        <button 
            onClick={() => { setFocusNodeId(undefined); mapRef.current?.setFocusedBook(null); }}
            style={{ marginBottom: 10 }}
        >
            Reset Focus
        </button>

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
