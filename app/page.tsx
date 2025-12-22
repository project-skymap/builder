"use client";

import { useCallback, useMemo } from "react";
import type { SceneNode, StarMapConfig } from "@project-skymap/library";
import { StarMap, bibleToSceneModel } from "@project-skymap/library";
import bible from "../public/bible.json";

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

export default function Page() {
  const config = useMemo<StarMapConfig>(
    () => ({
      background: "#05060a",
      camera: { fov: 60, z: 120 },
      data: bible,
      adapter: bibleToSceneModel,
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
      layout: { mode: "spherical", radius: 500, chapterRingSpacing: 40 }
    }),
    []
  );

  const handleSelect = useCallback((node: SceneNode) => {
    console.log("Selected node:", node);
    if (node.level === 3) {
      const { book, chapter } = node.meta as { book: string; chapter: number };
      alert(`Book: ${book}, Chapter: ${chapter}`);
    }
  }, []);

  const handleHover = useCallback((node?: SceneNode) => {
    if (node) {
      console.log("Hover node:", node);
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
        overflow: "hidden"
      }}
    >
      <StarMap
        className="starmap"
        config={config}
        onSelect={handleSelect}
        onHover={handleHover}
      />
    </div>
  );
}
