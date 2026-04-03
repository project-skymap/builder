"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CANON, BOOKS, getChapter, getBook } from "./canon";
import { buildGraph } from "./graph";
import { getCandidates, getTransitionCandidates } from "./candidates";
import {
  createSession, saveSession, loadSession,
  saveSnapshot, restoreSnapshot, deleteSnapshot,
  exportSession, importSession, importSkyField,
} from "./session";
import type { Session } from "./session";
import type { SkyGraph, StarNode } from "./graph";
import type { CandidateMove } from "./candidates";

// ---------------------------------------------------------------------------
// Derived render state (pure — computed from session + graph each render)
// ---------------------------------------------------------------------------

interface RenderState {
  assigned:         Map<number, number>; // starId → globalChapterIndex
  assignedSet:      Set<number>;
  anchor:           number | null;       // last assigned star
  currentBookStars: Set<number>;         // stars placed in current book
  candidates:       CandidateMove[];
  inTransition:     boolean;
  chapterIndex:     number;              // 0–1189
}

function computeRenderState(session: Session, graph: SkyGraph): RenderState {
  const chapterIndex = session.history.length;
  const assigned     = new Map<number, number>();
  session.history.forEach((starId, idx) => assigned.set(starId, idx));
  const assignedSet  = new Set(session.history);
  const anchor       = session.history[chapterIndex - 1] ?? null;

  // Transition: we just finished a book and haven't started the next chapter yet
  const lastChapter    = getChapter(chapterIndex - 1);
  const inTransition   =
    lastChapter !== undefined &&
    lastChapter.chapterNumber === lastChapter.bookTotal &&
    chapterIndex < 1189;

  // The "active" book: completed book during transition, next book otherwise
  const activeBookIndex = inTransition
    ? lastChapter!.bookIndex
    : getChapter(chapterIndex)?.bookIndex ?? -1;

  const activeBook = getBook(activeBookIndex);

  const currentBookStars = new Set<number>();
  if (activeBook) {
    const end = inTransition
      ? activeBook.endGlobalIndex + 1
      : chapterIndex;
    for (let i = activeBook.startGlobalIndex; i < end; i++) {
      const sid = session.history[i];
      if (sid !== undefined) currentBookStars.add(sid);
    }
  }

  let candidates: CandidateMove[];
  if (inTransition) {
    candidates = getTransitionCandidates(
      Array.from(currentBookStars),
      assignedSet,
      graph,
    );
  } else if (chapterIndex < 1189) {
    const remaining = activeBook
      ? activeBook.endGlobalIndex - chapterIndex + 1
      : 0;
    candidates = getCandidates(anchor, assignedSet, graph, remaining);
  } else {
    candidates = [];
  }

  return {
    assigned, assignedSet, anchor, currentBookStars,
    candidates, inTransition, chapterIndex,
  };
}

// ---------------------------------------------------------------------------
// Canvas drawing
// ---------------------------------------------------------------------------

const BG = "#05060a";

function drawSky(
  ctx:       CanvasRenderingContext2D,
  W:         number,
  H:         number,
  graph:     SkyGraph,
  rs:        RenderState,
  pan:       { x: number; y: number },
  zoom:      number,
  time:      number,
  hoverStar: number | null,
): void {
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);

  const baseR  = Math.min(W, H) / 2 - 16;
  const radius = baseR * zoom;
  const scx    = W / 2 + pan.x;
  const scy    = H / 2 + pan.y;

  const pulse = 0.5 + 0.5 * Math.sin(time / 700);

  const candidateMap = new Map<number, CandidateMove>(
    rs.candidates.map(c => [c.starId, c]),
  );

  // ── Pass 1: all star dots ─────────────────────────────────────────────────
  for (const node of graph) {
    if (!node) continue;
    const sx = scx + node.x * radius;
    const sy = scy + node.y * radius;

    // Edge fade (horizon)
    const projR2 = node.x * node.x + node.y * node.y;
    const projR  = Math.sqrt(projR2);
    if (projR >= 1.0) continue; // over horizon — invisible
    const fade   = projR > 0.7 ? Math.max(0, (1 - projR) / 0.3) : 1;
    if (fade <= 0) continue;

    const mag    = node.magnitude;
    const starId = node.id;

    const isAnchor       = starId === rs.anchor;
    const isCurrentBook  = rs.currentBookStars.has(starId);
    const isAssigned     = rs.assigned.has(starId);
    const isHovered      = starId === hoverStar;

    // Base dot radius from magnitude
    let dotR: number;
    if      (mag < 2.5) dotR = 2.2;
    else if (mag < 3.5) dotR = 1.8;
    else if (mag < 4.5) dotR = 1.4;
    else if (mag < 5.5) dotR = 1.0;
    else                dotR = 0.7;

    let r: number, g: number, b: number, alpha: number;

    if (isAnchor) {
      r = 255; g = 235; b = 160;
      alpha = fade;
      dotR *= 1.4;
      // Glow behind the anchor
      const glowR = dotR * 6;
      const gr    = ctx.createRadialGradient(sx, sy, 0, sx, sy, glowR);
      gr.addColorStop(0, `rgba(255,220,100,${(0.45 * fade).toFixed(3)})`);
      gr.addColorStop(1, "rgba(255,220,100,0)");
      ctx.fillStyle = gr;
      ctx.fillRect(sx - glowR, sy - glowR, glowR * 2, glowR * 2);
    } else if (isCurrentBook) {
      r = 255; g = 215; b = 130;
      alpha = 0.88 * fade;
    } else if (isAssigned) {
      r = 165; g = 172; b = 190;
      alpha = 0.36 * fade;
    } else {
      r = 200; g = 215; b = 255;
      alpha = isHovered ? 0.75 * fade : 0.54 * fade;
    }

    ctx.beginPath();
    ctx.arc(sx, sy, dotR, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
    ctx.fill();
  }

  // ── Pass 2: candidate rings (drawn on top) ────────────────────────────────
  for (const candidate of rs.candidates) {
    const node = graph[candidate.starId];
    if (!node) continue;

    const sx = scx + node.x * radius;
    const sy = scy + node.y * radius;

    const projR = Math.sqrt(node.x * node.x + node.y * node.y);
    if (projR >= 1.0) continue;
    const fade = projR > 0.7 ? Math.max(0, (1 - projR) / 0.3) : 1;
    if (fade <= 0) continue;

    const mag = node.magnitude;
    let dotR: number;
    if      (mag < 2.5) dotR = 2.2;
    else if (mag < 3.5) dotR = 1.8;
    else if (mag < 4.5) dotR = 1.4;
    else if (mag < 5.5) dotR = 1.0;
    else                dotR = 0.7;

    const ringR = dotR * 4.0;
    const ringA = candidate.tier === 1
      ? (0.18 + 0.28 * pulse) * fade
      : 0.12 * fade;

    ctx.beginPath();
    ctx.arc(sx, sy, ringR, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255,242,190,${ringA.toFixed(3)})`;
    ctx.lineWidth   = candidate.tier === 1 ? 1.5 : 1.0;
    ctx.stroke();
  }

  // ── Current-book constellation line (thin) ─────────────────────────────
  if (rs.currentBookStars.size >= 2) {
    const bookChapterStart = getBook(
      getChapter(
        rs.inTransition
          ? rs.chapterIndex - 1
          : rs.chapterIndex,
      )?.bookIndex ?? -1,
    );
    if (bookChapterStart) {
      const orderedStars: { sx: number; sy: number }[] = [];
      for (
        let i = bookChapterStart.startGlobalIndex;
        i < Math.min(rs.chapterIndex, bookChapterStart.endGlobalIndex + 1);
        i++
      ) {
        const sid  = session_history_at(rs, i);
        if (sid === undefined) continue;
        const node = graph[sid];
        if (!node) continue;
        const projR = Math.sqrt(node.x * node.x + node.y * node.y);
        if (projR >= 1.0) continue;
        orderedStars.push({
          sx: scx + node.x * radius,
          sy: scy + node.y * radius,
        });
      }
      if (orderedStars.length >= 2) {
        ctx.beginPath();
        ctx.moveTo(orderedStars[0]!.sx, orderedStars[0]!.sy);
        for (let i = 1; i < orderedStars.length; i++) {
          ctx.lineTo(orderedStars[i]!.sx, orderedStars[i]!.sy);
        }
        ctx.strokeStyle = "rgba(255,215,120,0.18)";
        ctx.lineWidth   = 0.8;
        ctx.stroke();
      }
    }
  }
}

// Small helper so drawSky can read session history by global index.
// We pass the history through the render-state indirection.
// (We store assigned: Map<starId→chapterIndex>, so we invert below.)
function session_history_at(rs: RenderState, globalIndex: number): number | undefined {
  for (const [starId, idx] of rs.assigned) {
    if (idx === globalIndex) return starId;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function AssignPage() {
  // ── Core state ────────────────────────────────────────────────────────────
  const [session, setSession]     = useState<Session | null>(null);
  const [graph, setGraph]         = useState<SkyGraph | null>(null);

  // ── Derived render state (recomputed on session/graph change) ─────────────
  const renderStateRef            = useRef<RenderState | null>(null);

  // ── Canvas refs ───────────────────────────────────────────────────────────
  const canvasRef                 = useRef<HTMLCanvasElement>(null);
  const animRef                   = useRef(0);
  const graphRef                  = useRef<SkyGraph | null>(null);
  const renderStateRefForDraw     = useRef<RenderState | null>(null);
  const panRef                    = useRef({ x: 0, y: 0 });
  const zoomRef                   = useRef(1.0);
  const hoverStarRef              = useRef<number | null>(null);

  // ── Pointer interaction ───────────────────────────────────────────────────
  const isDragging                = useRef(false);
  const dragStartRef              = useRef({ x: 0, y: 0 });
  const hasDraggedRef             = useRef(false);
  const lastPointerRef            = useRef({ x: 0, y: 0 });

  // ── UI state ──────────────────────────────────────────────────────────────
  const [snapshotName, setSnapshotName]     = useState("");
  const [showSnapPanel, setShowSnapPanel]   = useState(false);
  const [hoverHint, setHoverHint]           = useState<string | null>(null);
  const [loadError, setLoadError]           = useState<string | null>(null);

  // ── Load saved session on mount ───────────────────────────────────────────
  useEffect(() => {
    const saved = loadSession();
    if (saved) {
      const g = buildGraph(saved.skyField.stars);
      setGraph(g);
      setSession(saved);
    }
  }, []);

  // ── Sync state → refs for draw loop and auto-save ─────────────────────────
  useEffect(() => {
    graphRef.current = graph;
    if (!session || !graph) {
      renderStateRef.current         = null;
      renderStateRefForDraw.current  = null;
      return;
    }
    const rs = computeRenderState(session, graph);
    renderStateRef.current        = rs;
    renderStateRefForDraw.current = rs;
    saveSession(session);
  }, [session, graph]);

  // ── Canvas draw loop ──────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const draw = () => {
      animRef.current = requestAnimationFrame(draw);

      const W = canvas.clientWidth;
      const H = canvas.clientHeight;
      if (canvas.width !== W || canvas.height !== H) {
        canvas.width  = W;
        canvas.height = H;
      }

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const g  = graphRef.current;
      const rs = renderStateRefForDraw.current;
      if (!g || !rs) {
        ctx.fillStyle = BG;
        ctx.fillRect(0, 0, W, H);
        return;
      }

      drawSky(
        ctx, W, H, g, rs,
        panRef.current, zoomRef.current,
        performance.now(),
        hoverStarRef.current,
      );
    };

    draw();
    return () => cancelAnimationFrame(animRef.current);
  }, []); // runs once; reads from refs

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }); // no deps — handleUndo reads session from closure

  // ── Helpers: star under pointer ───────────────────────────────────────────
  const starAtPoint = useCallback(
    (canvasX: number, canvasY: number, onlyUnassigned = false): number | null => {
      const g  = graphRef.current;
      const rs = renderStateRef.current;
      if (!g) return null;

      const canvas = canvasRef.current;
      if (!canvas) return null;
      const W = canvas.width, H = canvas.height;
      const baseR  = Math.min(W, H) / 2 - 16;
      const radius = baseR * zoomRef.current;
      const scx    = W / 2 + panRef.current.x;
      const scy    = H / 2 + panRef.current.y;

      // Threshold: 18px in canvas space
      const threshold = 18 / radius;

      let bestId   = -1;
      let bestDist = Infinity;

      for (const node of g) {
        if (!node) continue;
        const projR = Math.sqrt(node.x * node.x + node.y * node.y);
        if (projR >= 1.0) continue; // invisible star

        if (onlyUnassigned && rs?.assignedSet.has(node.id)) continue;

        const starX = (canvasX - scx) / radius;
        const starY = (canvasY - scy) / radius;
        const dx    = node.x - starX;
        const dy    = node.y - starY;
        const dist  = Math.sqrt(dx * dx + dy * dy);

        if (dist < threshold && dist < bestDist) {
          bestDist = dist;
          bestId   = node.id;
        }
      }

      return bestId >= 0 ? bestId : null;
    },
    [],
  );

  // ── Assignment ────────────────────────────────────────────────────────────
  const handleAssign = useCallback((starId: number) => {
    setSession(prev => {
      if (!prev) return prev;
      const rs = renderStateRef.current;
      if (!rs) return prev;
      if (rs.assignedSet.has(starId)) return prev; // already assigned
      if (rs.chapterIndex >= 1189) return prev;     // complete

      const newHistory = [...prev.history, starId];
      return { ...prev, history: newHistory };
    });
  }, []);

  const handleUndo = useCallback(() => {
    setSession(prev => {
      if (!prev || prev.history.length === 0) return prev;
      return { ...prev, history: prev.history.slice(0, -1) };
    });
  }, []);

  // ── Snapshots ─────────────────────────────────────────────────────────────
  const handleSaveSnapshot = useCallback(() => {
    setSession(prev => {
      if (!prev) return prev;
      return saveSnapshot(prev, snapshotName);
    });
    setSnapshotName("");
  }, [snapshotName]);

  const handleRestoreSnapshot = useCallback((index: number) => {
    setSession(prev => prev ? restoreSnapshot(prev, index) : prev);
  }, []);

  const handleDeleteSnapshot = useCallback((index: number) => {
    setSession(prev => prev ? deleteSnapshot(prev, index) : prev);
  }, []);

  // ── File loading ──────────────────────────────────────────────────────────
  const handleLoadSkyField = useCallback(async (file: File) => {
    setLoadError(null);
    try {
      const sf = await importSkyField(file);
      const g  = buildGraph(sf.stars);
      const s  = createSession(sf);
      setGraph(g);
      setSession(s);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load file.");
    }
  }, []);

  const handleLoadSession = useCallback(async (file: File) => {
    setLoadError(null);
    try {
      const s = await importSession(file);
      const g = buildGraph(s.skyField.stars);
      setGraph(g);
      setSession(s);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load file.");
    }
  }, []);

  const handleExport = useCallback(() => {
    if (session) exportSession(session);
  }, [session]);

  const handleFileInput = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>, mode: "skyfield" | "session") => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (mode === "skyfield") await handleLoadSkyField(file);
      else await handleLoadSession(file);
      e.target.value = "";
    },
    [handleLoadSkyField, handleLoadSession],
  );

  // ── Canvas pointer events ─────────────────────────────────────────────────
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    isDragging.current    = true;
    hasDraggedRef.current = false;
    dragStartRef.current  = { x: e.clientX, y: e.clientY };
    lastPointerRef.current = { x: e.clientX, y: e.clientY };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging.current) {
      // Hover — update hovered star
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect   = canvas.getBoundingClientRect();
      const cx     = e.clientX - rect.left;
      const cy     = e.clientY - rect.top;
      const sid    = starAtPoint(cx, cy);
      hoverStarRef.current = sid;

      const rs  = renderStateRef.current;
      const cand = rs?.candidates.find(c => c.starId === sid);
      setHoverHint(cand?.hint ?? null);
      return;
    }

    const dx = e.clientX - lastPointerRef.current.x;
    const dy = e.clientY - lastPointerRef.current.y;
    lastPointerRef.current = { x: e.clientX, y: e.clientY };

    const totalDx = e.clientX - dragStartRef.current.x;
    const totalDy = e.clientY - dragStartRef.current.y;
    if (Math.sqrt(totalDx * totalDx + totalDy * totalDy) > 4) {
      hasDraggedRef.current = true;
    }

    panRef.current = { x: panRef.current.x + dx, y: panRef.current.y + dy };
  }, [starAtPoint]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (!isDragging.current) return;
    isDragging.current = false;

    if (!hasDraggedRef.current) {
      // It's a click — assign star
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const cx   = e.clientX - rect.left;
      const cy   = e.clientY - rect.top;
      const sid  = starAtPoint(cx, cy, true);
      if (sid !== null) handleAssign(sid);
    }
  }, [starAtPoint, handleAssign]);

  const onPointerLeave = useCallback(() => {
    isDragging.current    = false;
    hoverStarRef.current  = null;
    setHoverHint(null);
  }, []);

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const factor  = e.deltaY > 0 ? 0.92 : 1.09;
    zoomRef.current = Math.max(0.4, Math.min(8, zoomRef.current * factor));
  }, []);

  const onDoubleClick = useCallback(() => {
    panRef.current  = { x: 0, y: 0 };
    zoomRef.current = 1.0;
  }, []);

  // ── Derived display values ────────────────────────────────────────────────
  const rs              = renderStateRef.current;
  const chapterIndex    = rs?.chapterIndex ?? 0;
  const inTransition    = rs?.inTransition ?? false;
  const lastChapter     = getChapter(chapterIndex - 1);
  const currentChapter  = getChapter(chapterIndex);
  const completedBook   = inTransition ? getBook(lastChapter?.bookIndex ?? -1) : null;
  const nextBook        = inTransition ? getBook(currentChapter?.bookIndex ?? -1) : null;
  const currentBook     = !inTransition ? getBook(currentChapter?.bookIndex ?? -1) : null;
  const chaptersInBook  = currentBook?.chapterCount ?? 0;
  const chaptersPlaced  = currentBook
    ? chapterIndex - (currentBook.startGlobalIndex)
    : 0;
  const done = chapterIndex >= 1189;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-screen w-screen overflow-hidden" style={{ background: BG, color: "#ccd4e8" }}>

      {/* ── Sidebar ──────────────────────────────────────────────────────── */}
      <div className="w-64 flex-shrink-0 flex flex-col border-r border-white/8 overflow-y-auto"
           style={{ background: "#07090f" }}>

        {/* Header */}
        <div className="px-5 pt-5 pb-4 border-b border-white/8">
          <p className="text-[10px] uppercase tracking-widest text-white/30 mb-1">Project Skymap</p>
          <h1 className="text-sm font-medium text-white/80">Assignment</h1>
        </div>

        {!session ? (
          /* ── No session: load screen ─────────────────────────────────── */
          <div className="flex flex-col gap-4 p-5">
            <p className="text-xs text-white/40 leading-relaxed">
              Load a sky field from the generator to begin assigning chapters.
            </p>

            <label className="flex flex-col gap-1 cursor-pointer">
              <span className="text-[10px] uppercase tracking-widest text-white/30">
                Load sky field
              </span>
              <div className="text-xs text-white/60 bg-white/5 border border-white/10
                              rounded px-3 py-2 hover:bg-white/8 transition-colors text-center">
                skyfield.json
              </div>
              <input
                type="file" accept=".json" className="hidden"
                onChange={e => handleFileInput(e, "skyfield")}
              />
            </label>

            <label className="flex flex-col gap-1 cursor-pointer">
              <span className="text-[10px] uppercase tracking-widest text-white/30">
                Resume session
              </span>
              <div className="text-xs text-white/60 bg-white/5 border border-white/10
                              rounded px-3 py-2 hover:bg-white/8 transition-colors text-center">
                skymap-session.json
              </div>
              <input
                type="file" accept=".json" className="hidden"
                onChange={e => handleFileInput(e, "session")}
              />
            </label>

            {loadError && (
              <p className="text-xs text-red-400/80">{loadError}</p>
            )}

            <a href="/generate"
               className="text-[10px] text-white/25 hover:text-white/50 transition-colors text-center mt-2">
              ← Go to generator
            </a>
          </div>

        ) : done ? (
          /* ── Complete ────────────────────────────────────────────────── */
          <div className="flex flex-col gap-4 p-5">
            <div className="text-center py-4">
              <p className="text-white/60 text-sm">All 1,189 chapters assigned.</p>
              <p className="text-white/30 text-xs mt-1">The sky is complete.</p>
            </div>
            <button onClick={handleExport}
                    className="text-xs text-white/60 bg-white/5 border border-white/10
                               rounded px-3 py-2 hover:bg-white/8 transition-colors">
              Export session
            </button>
          </div>

        ) : inTransition ? (
          /* ── Book transition ─────────────────────────────────────────── */
          <div className="flex flex-col gap-5 p-5">
            <div>
              <p className="text-xs text-white/30 mb-1">{completedBook?.divisionName}</p>
              <p className="text-base font-medium text-white/85">{completedBook?.name}</p>
              <p className="text-xs text-white/40 mt-0.5">complete</p>
            </div>

            <div className="w-full h-px bg-white/8" />

            <div>
              <p className="text-[10px] uppercase tracking-widest text-white/30 mb-2">
                Next
              </p>
              <p className="text-sm font-medium text-white/80">{nextBook?.name}</p>
              <p className="text-xs text-white/40 mt-0.5">
                {nextBook?.chapterCount} chapters
              </p>
            </div>

            <p className="text-xs text-white/30 leading-relaxed">
              Three stars are suggested. Click one to begin, or choose anywhere.
            </p>

            {hoverHint && (
              <p className="text-xs italic text-white/40">{hoverHint}</p>
            )}

            <div className="w-full h-px bg-white/8" />
            <UndoButton onClick={handleUndo} />
          </div>

        ) : (
          /* ── Assigning ───────────────────────────────────────────────── */
          <div className="flex flex-col gap-4 p-5 flex-1">

            {/* Current position */}
            <div>
              <p className="text-[10px] uppercase tracking-widest text-white/30 mb-1">
                {currentBook?.divisionName}
              </p>
              <p className="text-sm font-medium text-white/85">{currentBook?.name}</p>
              <div className="flex items-baseline gap-1.5 mt-0.5">
                <span className="text-lg font-light text-white/90">
                  {currentChapter?.chapterNumber}
                </span>
                <span className="text-xs text-white/35">
                  of {chaptersInBook}
                </span>
              </div>
            </div>

            {/* Book progress bar */}
            <div>
              <div className="w-full h-0.5 rounded-full bg-white/8 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-150"
                  style={{
                    width:      `${(chaptersPlaced / Math.max(1, chaptersInBook)) * 100}%`,
                    background: "rgba(255,215,120,0.6)",
                  }}
                />
              </div>
            </div>

            {/* Hover hint */}
            {hoverHint && (
              <p className="text-xs italic text-white/35 min-h-[1rem]">{hoverHint}</p>
            )}

            {/* Overall progress */}
            <div className="text-xs text-white/25 tabular-nums">
              {chapterIndex.toLocaleString()} / 1,189 chapters
            </div>

            <div className="flex-1" />

            <UndoButton onClick={handleUndo} disabled={chapterIndex === 0} />

            {/* Snapshots */}
            <div className="border-t border-white/8 pt-4">
              <button
                className="text-[10px] uppercase tracking-widest text-white/30
                           hover:text-white/55 transition-colors w-full text-left"
                onClick={() => setShowSnapPanel(p => !p)}
              >
                Snapshots {session.snapshots.length > 0 && `(${session.snapshots.length})`}
              </button>

              {showSnapPanel && (
                <div className="mt-3 flex flex-col gap-2">
                  {/* Save new snapshot */}
                  <div className="flex gap-1.5">
                    <input
                      value={snapshotName}
                      onChange={e => setSnapshotName(e.target.value)}
                      placeholder="name…"
                      onKeyDown={e => { if (e.key === "Enter") handleSaveSnapshot(); }}
                      className="flex-1 bg-white/5 border border-white/10 rounded px-2 py-1
                                 text-xs text-white/70 placeholder:text-white/20 outline-none"
                    />
                    <button
                      onClick={handleSaveSnapshot}
                      className="text-xs text-white/50 bg-white/5 border border-white/10
                                 rounded px-2 py-1 hover:bg-white/10 transition-colors"
                    >
                      Save
                    </button>
                  </div>

                  {/* Snapshot list */}
                  {session.snapshots.map((snap, idx) => (
                    <div key={idx} className="flex items-center gap-1.5 group">
                      <button
                        onClick={() => handleRestoreSnapshot(idx)}
                        className="flex-1 text-left text-xs text-white/45
                                   hover:text-white/70 transition-colors truncate"
                      >
                        {snap.name}
                      </button>
                      <button
                        onClick={() => handleDeleteSnapshot(idx)}
                        className="text-[10px] text-white/20 hover:text-red-400/60
                                   opacity-0 group-hover:opacity-100 transition-all"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Export / reload */}
            <div className="border-t border-white/8 pt-4 flex flex-col gap-2">
              <button
                onClick={handleExport}
                className="text-[10px] uppercase tracking-widest text-white/30
                           hover:text-white/55 transition-colors text-left"
              >
                Export session
              </button>
              <label className="text-[10px] uppercase tracking-widest text-white/20
                                hover:text-white/40 transition-colors cursor-pointer text-left">
                Load new sky
                <input
                  type="file" accept=".json" className="hidden"
                  onChange={e => handleFileInput(e, "skyfield")}
                />
              </label>
            </div>
          </div>
        )}
      </div>

      {/* ── Canvas ───────────────────────────────────────────────────────── */}
      <div className="flex-1 relative">
        <canvas
          ref={canvasRef}
          className="w-full h-full"
          style={{ cursor: isDragging.current ? "grabbing" : "crosshair" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerLeave}
          onWheel={onWheel}
          onDoubleClick={onDoubleClick}
        />

        {/* Hint overlay — bottom-right, very unobtrusive */}
        {!session && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <p className="text-white/10 text-sm">load a sky field to begin</p>
          </div>
        )}

        {done && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <p className="text-white/15 text-sm tracking-widest uppercase">complete</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small reusable pieces
// ---------------------------------------------------------------------------

function UndoButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="text-[10px] uppercase tracking-widest text-white/30
                 hover:text-white/55 disabled:opacity-30 disabled:cursor-not-allowed
                 transition-colors text-left"
    >
      Undo  <span className="text-white/20 normal-case not-italic">⌘Z</span>
    </button>
  );
}
