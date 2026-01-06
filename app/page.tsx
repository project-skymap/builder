"use client";

import { useCallback, useMemo, useState, useRef } from "react";
import type { SceneNode, StarMapConfig, StarArrangement, StarMapHandle } from "@project-skymap/library";
import { StarMap, bibleToSceneModel } from "@project-skymap/library";
import bible from "../public/bible.json";
import initialArrangement from "./arrangement.json";

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
  const [arrangement, setArrangement] = useState<StarArrangement>(initialArrangement as StarArrangement);
  const [isEditable, setIsEditable] = useState(false);
  const mapRef = useRef<StarMapHandle>(null);

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

  const config = useMemo<StarMapConfig>(
    () => ({
      background: "#05060a",
      camera: { fov: 60, z: 120 },
      data: bible,
      adapter: bibleToSceneModel,
      arrangement,
      editable: isEditable,
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
        sizeBy: [{ when: { level: 3 }, field: "weight", scale: [0.5, 3.0] }]
      },
      layout: { mode: "spherical", radius: 500, chapterRingSpacing: 40 },
      focus: {
        nodeId: focusNodeId,
        animate: true
      }
    }),
    [focusNodeId, arrangement, isEditable]
  );

  const handleSelect = useCallback((node: SceneNode) => {
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
      // console.log("Hover node:", node);
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
      <div style={{ position: "absolute", top: 20, left: 20, zIndex: 10, background: "rgba(0,0,0,0.5)", padding: 10, borderRadius: 8 }}>
        <p><strong>Goal:</strong> Find {ANSWER.book} {ANSWER.chapter}</p>
        <p>1. Select "New Testament"</p>
        <p>2. Select "Prophecy"</p>
        <p>3. Select "Revelation"</p>
        <button 
            onClick={() => setFocusNodeId(undefined)}
            style={{ marginTop: 10, padding: "5px 10px", cursor: "pointer" }}
        >
            Reset Focus
        </button>

        <div style={{ marginTop: 20, borderTop: "1px solid #555", paddingTop: 10 }}>
            <button 
                onClick={() => setIsEditable(!isEditable)}
                style={{ padding: "5px 10px", cursor: "pointer", background: isEditable ? "#ef4444" : "#3b82f6", color: "white", border: "none", borderRadius: 4 }}
            >
                {isEditable ? "Stop Editing" : "Edit Stars"}
            </button>
            {isEditable && (
                <div style={{ marginTop: 10 }}>
                    <button 
                        onClick={handleExport}
                        style={{ padding: "5px 10px", cursor: "pointer" }}
                    >
                        Export JSON
                    </button>
                    <p style={{ fontSize: 11, color: "#9ca3af", marginTop: 5 }}>
                        Click Export, then overwrite <code>builder/app/arrangement.json</code> with the result.
                    </p>
                </div>
            )}
        </div>
      </div>

      <StarMap
        ref={mapRef}
        className="starmap"
        config={config}
        onSelect={handleSelect}
        onHover={handleHover}
        onArrangementChange={handleArrangementChange}
      />
    </div>
  );
}
