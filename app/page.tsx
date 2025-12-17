"use client";

import { useCallback, useMemo } from "react";
import type { SceneNode, StarMapConfig } from "@project-skymap/library";
import { StarMap, bibleToSceneModel } from "@project-skymap/library";
import bible from "./bible.json";

export default function Page() {
  const model = useMemo(() => bibleToSceneModel(bible), []);

  const config = useMemo<StarMapConfig>(
    () => ({
      background: "#05060a",
      camera: { fov: 60, z: 120 },
      model,
      visuals: {
        colorBy: [
          { when: { icon: "✝️" }, value: "#e23f6d" },
          { when: { icon: "☀️" }, value: "#f7d046" },
          { when: { icon: "💔" }, value: "#f97316" },
          { when: { icon: "✨" }, value: "#7dd3fc" },
          { when: { icon: "⚖️" }, value: "#9ca3af" },
          { when: { icon: "🧠" }, value: "#a855f7" },
          { when: { icon: "🙏" }, value: "#86efac" },
          { when: { icon: "📖" }, value: "#60a5fa" },
          { when: { level: 0 }, value: "#38bdf8" },
          { when: { level: 1 }, value: "#a3e635" },
          { when: { level: 2 }, value: "#fbbf24" },
          { when: { level: 3 }, value: "#c084fc" }
        ],
        sizeBy: [{ when: { level: 3 }, field: "weight", scale: [0.6, 2.4] }]
      },
      layout: { mode: "radial", radius: 18, chapterRingSpacing: 8 }
    }),
    [model]
  );

  const handleSelect = useCallback((node: SceneNode) => {
    console.log("Selected node:", node);
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
