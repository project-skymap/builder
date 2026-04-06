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
import type { SkyGraph } from "./graph";
import type { CandidateMove } from "./candidates";
import { computeMomentum, computeEnvelopeCandidates } from "./momentum";
import type { MomentumState, EnvelopeCandidate } from "./momentum";
import { ARCHETYPES, ARCHETYPE_ORDER, DEFAULT_ARCHETYPE } from "./archetypes";
import type { ShapeArchetype } from "./archetypes";

// ---------------------------------------------------------------------------
// Derived render state (pure — computed from session + graph each render)
// ---------------------------------------------------------------------------

interface RenderState {
  assignments:        Record<number, number>; // chapterGlobalIndex → starId
  starToChapter:      Map<number, number>;    // starId → chapterGlobalIndex
  assignedSet:        Set<number>;
  anchor:             number | null;
  currentBookStars:   Set<number>;
  candidates:         CandidateMove[];
  inTransition:       boolean;
  cursor:             number;                 // 0–1188
  // Guided-emergence additions
  ghostPath:          number[];              // ordered star IDs for the recent trail
  envelopeCandidates: EnvelopeCandidate[];  // soft suggestion clouds (transition only)
  currentArchetype:   ShapeArchetype;
  momentum:           MomentumState | null;
}

function computeRenderState(session: Session, graph: SkyGraph): RenderState {
  const { assignments, cursor, undoStack, bookArchetypes } = session;

  // Build reverse map
  const starToChapter = new Map<number, number>();
  for (const [chIdxStr, starId] of Object.entries(assignments)) {
    starToChapter.set(starId, Number(chIdxStr));
  }
  const assignedSet = new Set(starToChapter.keys());

  const cursorChapter = getChapter(cursor);
  const cursorBook    = cursorChapter ? getBook(cursorChapter.bookIndex) : undefined;

  const inTransition =
    cursor > 0 &&
    cursorChapter !== undefined &&
    cursorChapter.chapterNumber === 1;

  let anchor: number | null = null;
  const currentBookStars    = new Set<number>();

  if (inTransition) {
    const prevBook = cursorBook ? getBook(cursorBook.index - 1) : undefined;
    if (prevBook) {
      for (let i = prevBook.startGlobalIndex; i <= prevBook.endGlobalIndex; i++) {
        const sid = assignments[i];
        if (sid !== undefined) currentBookStars.add(sid);
      }
    }
    if (undoStack.length > 0) {
      anchor = assignments[undoStack[undoStack.length - 1]!] ?? null;
    }
  } else if (cursorBook) {
    for (let i = cursorBook.startGlobalIndex; i <= cursorBook.endGlobalIndex; i++) {
      const sid = assignments[i];
      if (sid !== undefined) currentBookStars.add(sid);
    }
    for (let i = undoStack.length - 1; i >= 0; i--) {
      const chIdx = undoStack[i]!;
      if (chIdx >= cursorBook.startGlobalIndex && chIdx <= cursorBook.endGlobalIndex) {
        anchor = assignments[chIdx] ?? null;
        break;
      }
    }
    if (anchor === null && undoStack.length > 0) {
      anchor = assignments[undoStack[undoStack.length - 1]!] ?? null;
    }
  }

  // ── Archetype for the current / incoming book ──────────────────────────────
  const activeBookIndex = inTransition
    ? (cursorBook?.index ?? 0)                       // incoming book
    : (cursorBook?.index ?? -1);                     // current book
  const currentArchetype: ShapeArchetype =
    (activeBookIndex >= 0 ? bookArchetypes[activeBookIndex] : undefined)
    ?? DEFAULT_ARCHETYPE;

  // ── Momentum (current book only, not during transition) ───────────────────
  let momentum: MomentumState | null = null;
  if (!inTransition && cursorBook) {
    momentum = computeMomentum(
      undoStack, assignments, graph,
      cursorBook.startGlobalIndex, cursorBook.endGlobalIndex,
    );
  }

  // ── Book star positions for shape scoring ──────────────────────────────────
  const bookStarPositions = Array.from(currentBookStars)
    .map(id => graph[id])
    .filter((n): n is NonNullable<typeof n> => n !== undefined && n !== null)
    .map(n => ({ x: n.x, y: n.y }));

  // ── Candidates ─────────────────────────────────────────────────────────────
  let candidates: CandidateMove[];
  if (cursor >= 1189) {
    candidates = [];
  } else if (inTransition) {
    candidates = getTransitionCandidates(
      Array.from(currentBookStars),
      assignedSet,
      graph,
    );
  } else {
    const remaining = cursorBook ? cursorBook.endGlobalIndex - cursor + 1 : 0;
    candidates = getCandidates(anchor, assignedSet, graph, remaining, {
      momentum,
      archetype: currentArchetype,
      bookStarPositions,
    });
  }

  // ── Ghost path: last 8 current-book stars in assignment order ─────────────
  const ghostPath: number[] = [];
  if (!inTransition && cursorBook) {
    const trail = undoStack
      .filter(i => i >= cursorBook.startGlobalIndex && i <= cursorBook.endGlobalIndex)
      .slice(-8);
    for (const i of trail) {
      const sid = assignments[i];
      if (sid !== undefined) ghostPath.push(sid);
    }
  }

  // ── Envelope candidates (only needed during transition) ───────────────────
  let envelopeCandidates: EnvelopeCandidate[] = [];
  if (inTransition && cursorBook) {
    envelopeCandidates = computeEnvelopeCandidates(
      cursorBook.chapterCount,
      assignedSet,
      graph,
    );
  }

  return {
    assignments, starToChapter, assignedSet,
    anchor, currentBookStars, candidates,
    inTransition, cursor,
    ghostPath, envelopeCandidates, currentArchetype, momentum,
  };
}

// ---------------------------------------------------------------------------
// Canvas drawing
// ---------------------------------------------------------------------------

const BG = "#05060a";

function starDotRadius(magnitude: number): number {
  if      (magnitude < 2.5) return 2.2;
  else if (magnitude < 3.5) return 1.8;
  else if (magnitude < 4.5) return 1.4;
  else if (magnitude < 5.5) return 1.0;
  else                      return 0.7;
}

function drawSky(
  ctx:       CanvasRenderingContext2D,
  W:         number,
  H:         number,
  graph:     SkyGraph,
  rs:        RenderState,
  pan:       { x: number; y: number },
  zoom:      number,
  rotation:  number,
  time:      number,
  hoverStar: number | null,
  showLines: boolean,
): void {
  // ── Background: outside dark, inside subtly lighter so the boundary is clear ─
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);

  const baseR  = Math.min(W, H) / 2 - 16;
  const radius = baseR * zoom;
  const scx    = W / 2 + pan.x;
  const scy    = H / 2 + pan.y;

  // Star-field disc — slightly blue-tinted so inside/outside contrast is obvious
  ctx.beginPath();
  ctx.arc(scx, scy, radius, 0, Math.PI * 2);
  ctx.fillStyle = "#090d1a";
  ctx.fill();

  // Subtle boundary ring
  ctx.beginPath();
  ctx.arc(scx, scy, radius, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(80,100,160,0.35)";
  ctx.lineWidth   = 1.5;
  ctx.stroke();

  const cosR = Math.cos(rotation);
  const sinR = Math.sin(rotation);

  /** Rotate a unit-disk (x, y) by current rotation and project to canvas. */
  const project = (x: number, y: number) => ({
    sx: scx + (x * cosR - y * sinR) * radius,
    sy: scy + (x * sinR + y * cosR) * radius,
  });

  const pulse = 0.5 + 0.5 * Math.sin(time / 700);

  // ── Pass 0a: book envelope suggestion clouds ──────────────────────────────
  for (const env of rs.envelopeCandidates) {
    const { sx, sy } = project(env.x, env.y);
    const envR  = env.radius * radius;
    const alpha = env.quality * 0.16;

    const gr = ctx.createRadialGradient(sx, sy, 0, sx, sy, envR);
    gr.addColorStop(0,   `rgba(100,140,240,${(alpha * 0.55).toFixed(3)})`);
    gr.addColorStop(0.5, `rgba(80,120,210,${(alpha * 0.25).toFixed(3)})`);
    gr.addColorStop(1,   "rgba(60,100,180,0)");
    ctx.fillStyle = gr;
    ctx.fillRect(sx - envR, sy - envR, envR * 2, envR * 2);

    // Dashed boundary ring
    ctx.beginPath();
    ctx.arc(sx, sy, envR, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(100,140,220,${(env.quality * 0.22).toFixed(3)})`;
    ctx.lineWidth   = 1;
    ctx.setLineDash([4, 7]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // ── Pass 0b: ghost path — fading trail of recent book assignments ─────────
  if (rs.ghostPath.length >= 2) {
    const pathNodes = rs.ghostPath
      .map(id => graph[id])
      .filter((n): n is NonNullable<typeof n> => n !== undefined && n !== null);

    for (let i = 1; i < pathNodes.length; i++) {
      const t     = i / (pathNodes.length - 1);       // 0 = oldest, 1 = newest
      const alpha = 0.06 + 0.30 * t;
      const prev  = project(pathNodes[i - 1]!.x, pathNodes[i - 1]!.y);
      const curr  = project(pathNodes[i]!.x,     pathNodes[i]!.y);
      ctx.beginPath();
      ctx.moveTo(prev.sx, prev.sy);
      ctx.lineTo(curr.sx, curr.sy);
      ctx.strokeStyle = `rgba(255,200,100,${alpha.toFixed(3)})`;
      ctx.lineWidth   = 1.2;
      ctx.stroke();
    }
  }

  // ── Pass 1: all star dots ─────────────────────────────────────────────────
  for (const node of graph) {
    if (!node) continue;
    const { sx, sy } = project(node.x, node.y);

    const projR = Math.sqrt(node.x * node.x + node.y * node.y);
    if (projR >= 1.0) continue;
    // Fade only the outermost 12 % of the disc — rest is fully lit
    const fade = projR > 0.88 ? Math.max(0, (1 - projR) / 0.12) : 1;
    if (fade <= 0) continue;

    const starId = node.id;
    const dotR   = starDotRadius(node.magnitude);

    const isAnchor      = starId === rs.anchor;
    const isCurrentBook = rs.currentBookStars.has(starId);
    const isAssigned    = rs.assignedSet.has(starId);
    const isHovered     = starId === hoverStar;

    let r: number, g: number, b: number, alpha: number;

    if (isAnchor) {
      r = 255; g = 235; b = 160;
      alpha = fade;
      const glowR = dotR * 6;
      const gr    = ctx.createRadialGradient(sx, sy, 0, sx, sy, glowR);
      gr.addColorStop(0, `rgba(255,220,100,${(0.55 * fade).toFixed(3)})`);
      gr.addColorStop(1, "rgba(255,220,100,0)");
      ctx.fillStyle = gr;
      ctx.fillRect(sx - glowR, sy - glowR, glowR * 2, glowR * 2);
    } else if (isCurrentBook) {
      r = 255; g = 215; b = 130;
      alpha = 0.95 * fade;
    } else if (isAssigned) {
      r = 180; g = 188; b = 210;
      alpha = 0.70 * fade;
    } else {
      r = 210; g = 222; b = 255;
      alpha = isHovered ? 1.0 * fade : 0.88 * fade;
    }

    ctx.beginPath();
    ctx.arc(sx, sy, isAnchor ? dotR * 1.4 : dotR, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
    ctx.fill();
  }

  // ── Pass 2: candidate rings ───────────────────────────────────────────────
  for (const candidate of rs.candidates) {
    const node = graph[candidate.starId];
    if (!node) continue;

    const { sx, sy } = project(node.x, node.y);
    const projR = Math.sqrt(node.x * node.x + node.y * node.y);
    if (projR >= 1.0) continue;
    const fade = projR > 0.88 ? Math.max(0, (1 - projR) / 0.12) : 1;
    if (fade <= 0) continue;

    const ringR = starDotRadius(node.magnitude) * 4.0;
    const ringA = candidate.tier === 1
      ? (0.18 + 0.28 * pulse) * fade
      : 0.12 * fade;

    ctx.beginPath();
    ctx.arc(sx, sy, ringR, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255,242,190,${ringA.toFixed(3)})`;
    ctx.lineWidth   = candidate.tier === 1 ? 1.5 : 1.0;
    ctx.stroke();
  }

  // ── Pass 3: constellation line for current book ───────────────────────────
  if (showLines && rs.currentBookStars.size >= 2) {
    const refChapter = rs.inTransition
      ? getChapter(rs.cursor - 1)
      : getChapter(rs.cursor);
    const activeBook = refChapter ? getBook(refChapter.bookIndex) : undefined;
    const prevBook   = rs.inTransition && activeBook
      ? getBook(activeBook.index - 1)
      : activeBook;

    if (prevBook) {
      const orderedStars: { sx: number; sy: number }[] = [];
      for (
        let i = prevBook.startGlobalIndex;
        i <= Math.min(rs.cursor - 1, prevBook.endGlobalIndex);
        i++
      ) {
        const sid  = rs.assignments[i];
        if (sid === undefined) continue;
        const node = graph[sid];
        if (!node) continue;
        const projR = Math.sqrt(node.x * node.x + node.y * node.y);
        if (projR >= 1.0) continue;
        orderedStars.push(project(node.x, node.y));
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

  // ── Pass 4: chapter labels (visible when zoomed in) ───────────────────────
  if (zoom >= 2.2) {
    const labelAlpha = Math.min(0.75, (zoom - 2.2) / 1.5);
    ctx.save();
    ctx.font         = "9px 'SF Mono', ui-monospace, monospace";
    ctx.textAlign    = "center";
    ctx.textBaseline = "bottom";

    for (const [chIdxStr, starId] of Object.entries(rs.assignments)) {
      const node = graph[starId];
      if (!node) continue;

      const projR = Math.sqrt(node.x * node.x + node.y * node.y);
      if (projR >= 1.0) continue;
      const fade = projR > 0.88 ? Math.max(0, (1 - projR) / 0.12) : 1;
      if (fade <= 0) continue;

      const { sx, sy } = project(node.x, node.y);

      const chapter = getChapter(Number(chIdxStr));
      if (!chapter) continue;

      const label     = `${chapter.bookKey} ${chapter.chapterNumber}`;
      const dotOffset = starDotRadius(node.magnitude) + 4;

      ctx.fillStyle = `rgba(190,205,240,${(labelAlpha * fade).toFixed(3)})`;
      ctx.fillText(label, sx, sy - dotOffset);
    }

    ctx.restore();
  }
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function AssignPage() {
  // ── Core state ────────────────────────────────────────────────────────────
  const [session, setSession] = useState<Session | null>(null);
  const [graph, setGraph]     = useState<SkyGraph | null>(null);

  // ── Derived render state ──────────────────────────────────────────────────
  const renderStateRef = useRef<RenderState | null>(null);

  // ── Canvas refs ───────────────────────────────────────────────────────────
  const canvasRef              = useRef<HTMLCanvasElement>(null);
  const animRef                = useRef(0);
  const graphRef               = useRef<SkyGraph | null>(null);
  const renderStateRefForDraw  = useRef<RenderState | null>(null);
  const panRef                 = useRef({ x: 0, y: 0 });
  const zoomRef                = useRef(1.0);
  const rotationRef            = useRef(0);
  const hoverStarRef           = useRef<number | null>(null);
  const showLinesRef           = useRef(true);

  // ── Pointer interaction ───────────────────────────────────────────────────
  const isDragging     = useRef(false);
  const dragModeRef    = useRef<"pan" | "rotate">("pan");
  const dragStartRef   = useRef({ x: 0, y: 0 });
  const hasDraggedRef  = useRef(false);
  const lastPointerRef = useRef({ x: 0, y: 0 });

  // ── UI state ──────────────────────────────────────────────────────────────
  const [snapshotName, setSnapshotName]   = useState("");
  const [showSnapPanel, setShowSnapPanel] = useState(false);
  const [showLines, setShowLines]         = useState(true);
  const [hoverHint, setHoverHint]         = useState<string | null>(null);
  const [loadError, setLoadError]         = useState<string | null>(null);
  const [jumpBook, setJumpBook]           = useState(0);
  const [jumpChapter, setJumpChapter]     = useState(1);

  // ── Load saved session on mount ───────────────────────────────────────────
  useEffect(() => {
    const saved = loadSession();
    if (saved) {
      const g = buildGraph(saved.skyField.stars);
      setGraph(g);
      setSession(saved);
    }
  }, []);

  // ── Sync showLines → ref ──────────────────────────────────────────────────
  useEffect(() => {
    showLinesRef.current = showLines;
  }, [showLines]);

  // ── Sync session/graph → refs and auto-save ───────────────────────────────
  useEffect(() => {
    graphRef.current = graph;
    if (!session || !graph) {
      renderStateRef.current        = null;
      renderStateRefForDraw.current = null;
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
        rotationRef.current,
        performance.now(),
        hoverStarRef.current,
        showLinesRef.current,
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
    (canvasX: number, canvasY: number): number | null => {
      const g = graphRef.current;
      if (!g) return null;

      const canvas = canvasRef.current;
      if (!canvas) return null;
      const W       = canvas.width;
      const H       = canvas.height;
      const baseR   = Math.min(W, H) / 2 - 16;
      const radius  = baseR * zoomRef.current;
      const scx     = W / 2 + panRef.current.x;
      const scy     = H / 2 + panRef.current.y;
      const threshold = 18 / radius;

      let bestId   = -1;
      let bestDist = Infinity;

      // Convert canvas coords to unrotated unit-disk space
      const unitX  = (canvasX - scx) / radius;
      const unitY  = (canvasY - scy) / radius;
      const invCos = Math.cos(-rotationRef.current);
      const invSin = Math.sin(-rotationRef.current);
      const hitX   = unitX * invCos - unitY * invSin;
      const hitY   = unitX * invSin + unitY * invCos;

      for (const node of g) {
        if (!node) continue;
        const projR = Math.sqrt(node.x * node.x + node.y * node.y);
        if (projR >= 1.0) continue;

        const dx = node.x - hitX;
        const dy = node.y - hitY;
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
      if (!prev || prev.cursor >= 1189) return prev;
      const rs = renderStateRef.current;
      if (!rs) return prev;

      // Don't steal a star already assigned to a different chapter
      const existingChapter = rs.starToChapter.get(starId);
      if (existingChapter !== undefined && existingChapter !== prev.cursor) return prev;

      const chIdx = prev.cursor;

      // Advance cursor to next unassigned chapter
      let nextCursor = chIdx + 1;
      while (nextCursor < 1189 && prev.assignments[nextCursor] !== undefined) {
        nextCursor++;
      }

      // Update undoStack (remove if re-assigning same slot, append at end)
      const newUndoStack = [...prev.undoStack.filter(i => i !== chIdx), chIdx];

      return {
        ...prev,
        assignments: { ...prev.assignments, [chIdx]: starId },
        cursor:      nextCursor,
        undoStack:   newUndoStack,
      };
    });
  }, []);

  const handleDeassign = useCallback((starId: number) => {
    setSession(prev => {
      if (!prev) return prev;
      const rs = renderStateRef.current;
      if (!rs) return prev;
      const chIdx = rs.starToChapter.get(starId);
      if (chIdx === undefined) return prev;
      const newAssignments = { ...prev.assignments };
      delete newAssignments[chIdx];
      return {
        ...prev,
        assignments: newAssignments,
        cursor:      chIdx,
        undoStack:   prev.undoStack.filter(i => i !== chIdx),
      };
    });
  }, []);

  const handleUndo = useCallback(() => {
    setSession(prev => {
      if (!prev || prev.undoStack.length === 0) return prev;
      const lastChIdx      = prev.undoStack[prev.undoStack.length - 1]!;
      const newAssignments = { ...prev.assignments };
      delete newAssignments[lastChIdx];
      return {
        ...prev,
        assignments: newAssignments,
        cursor:      lastChIdx,
        undoStack:   prev.undoStack.slice(0, -1),
      };
    });
  }, []);

  const handleJump = useCallback((globalIndex: number) => {
    if (globalIndex < 0 || globalIndex >= 1189) return;
    setSession(prev => prev ? { ...prev, cursor: globalIndex } : prev);
  }, []);

  const handleSetArchetype = useCallback((archetype: ShapeArchetype) => {
    setSession(prev => {
      if (!prev) return prev;
      const rs = renderStateRef.current;
      if (!rs) return prev;
      // Apply to the incoming book (transition) or current book (assigning)
      const bookIdx = rs.inTransition
        ? (getChapter(rs.cursor)?.bookIndex ?? 0)
        : (getChapter(rs.cursor)?.bookIndex ?? -1);
      if (bookIdx < 0) return prev;
      return {
        ...prev,
        bookArchetypes: { ...prev.bookArchetypes, [bookIdx]: archetype },
      };
    });
  }, []);

  // ── Snapshots ─────────────────────────────────────────────────────────────
  const handleSaveSnapshot = useCallback(() => {
    setSession(prev => prev ? saveSnapshot(prev, snapshotName) : prev);
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
    isDragging.current     = true;
    hasDraggedRef.current  = false;
    dragModeRef.current    = e.button === 2 ? "rotate" : "pan";
    dragStartRef.current   = { x: e.clientX, y: e.clientY };
    lastPointerRef.current = { x: e.clientX, y: e.clientY };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging.current) {
      // Hover
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const cx   = e.clientX - rect.left;
      const cy   = e.clientY - rect.top;
      const sid  = starAtPoint(cx, cy);
      hoverStarRef.current = sid;

      const rs   = renderStateRef.current;
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

    if (dragModeRef.current === "rotate") {
      rotationRef.current += dx * 0.004;
    } else {
      panRef.current = { x: panRef.current.x + dx, y: panRef.current.y + dy };
    }
  }, [starAtPoint]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (!isDragging.current) return;
    isDragging.current = false;

    if (!hasDraggedRef.current && dragModeRef.current === "pan") {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const cx   = e.clientX - rect.left;
      const cy   = e.clientY - rect.top;
      const sid  = starAtPoint(cx, cy);
      if (sid !== null) {
        const rs = renderStateRef.current;
        if (rs?.assignedSet.has(sid)) {
          handleDeassign(sid);
        } else {
          handleAssign(sid);
        }
      }
    }
  }, [starAtPoint, handleAssign, handleDeassign]);

  const onPointerLeave = useCallback(() => {
    isDragging.current   = false;
    hoverStarRef.current = null;
    setHoverHint(null);
  }, []);

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.92 : 1.09;
    zoomRef.current = Math.max(0.4, Math.min(8, zoomRef.current * factor));
  }, []);

  const onDoubleClick = useCallback(() => {
    panRef.current      = { x: 0, y: 0 };
    zoomRef.current     = 1.0;
    rotationRef.current = 0;
  }, []);

  // ── Derived display values ────────────────────────────────────────────────
  const rs               = renderStateRef.current;
  const cursor           = rs?.cursor ?? 0;
  const inTransition     = rs?.inTransition ?? false;
  const totalAssigned    = rs?.assignedSet.size ?? 0;
  const done             = totalAssigned >= 1189;
  const currentArchetype = rs?.currentArchetype ?? DEFAULT_ARCHETYPE;

  const cursorChapter  = getChapter(cursor);
  const cursorBook     = cursorChapter ? getBook(cursorChapter.bookIndex) : undefined;

  const completedBook  = inTransition ? getBook((cursorBook?.index ?? 1) - 1) : null;
  const nextBook       = inTransition ? cursorBook : null;
  const currentBook    = !inTransition ? cursorBook : null;
  const chaptersPlaced = rs?.currentBookStars.size ?? 0;
  const chaptersInBook = currentBook?.chapterCount ?? 0;

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
              <p className="text-[10px] uppercase tracking-widest text-white/30 mb-2">Next</p>
              <p className="text-sm font-medium text-white/80">{nextBook?.name}</p>
              <p className="text-xs text-white/40 mt-0.5">{nextBook?.chapterCount} chapters</p>
            </div>

            {/* Archetype — set the shape intention for this book */}
            <ArchetypePicker current={currentArchetype} onChange={handleSetArchetype} />

            <div className="w-full h-px bg-white/8" />

            <p className="text-xs text-white/30 leading-relaxed">
              Suggested regions are shown as faint clouds. Click a glowing star to begin, or choose anywhere.
            </p>

            {hoverHint && (
              <p className="text-xs italic text-white/40">{hoverHint}</p>
            )}

            <div className="w-full h-px bg-white/8" />

            {/* Jump to */}
            <JumpPanel books={BOOKS} onJump={handleJump} jumpBook={jumpBook} setJumpBook={setJumpBook} jumpChapter={jumpChapter} setJumpChapter={setJumpChapter} />

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
                  {cursorChapter?.chapterNumber}
                </span>
                <span className="text-xs text-white/35">of {chaptersInBook}</span>
              </div>
            </div>

            {/* Book progress bar */}
            <div className="w-full h-0.5 rounded-full bg-white/8 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-150"
                style={{
                  width:      `${(chaptersPlaced / Math.max(1, chaptersInBook)) * 100}%`,
                  background: "rgba(255,215,120,0.6)",
                }}
              />
            </div>

            {/* Archetype — compact inline form during assignment */}
            <ArchetypePicker current={currentArchetype} onChange={handleSetArchetype} compact />

            {/* Hover hint */}
            {hoverHint && (
              <p className="text-xs italic text-white/35 min-h-[1rem]">{hoverHint}</p>
            )}

            {/* Overall progress */}
            <div className="text-xs text-white/25 tabular-nums">
              {totalAssigned.toLocaleString()} / 1,189 chapters
            </div>

            <div className="w-full h-px bg-white/8" />

            {/* Jump to */}
            <JumpPanel books={BOOKS} onJump={handleJump} jumpBook={jumpBook} setJumpBook={setJumpBook} jumpChapter={jumpChapter} setJumpChapter={setJumpChapter} />

            <div className="w-full h-px bg-white/8" />

            <UndoButton onClick={handleUndo} disabled={!session || session.undoStack.length === 0} />

            {/* Show/hide lines */}
            <button
              onClick={() => setShowLines(p => !p)}
              className="text-[10px] uppercase tracking-widest text-white/30
                         hover:text-white/55 transition-colors text-left"
            >
              {showLines ? "Hide" : "Show"} lines
            </button>

            <div className="flex-1" />

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
          style={{ cursor: "crosshair" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerLeave}
          onWheel={onWheel}
          onDoubleClick={onDoubleClick}
          onContextMenu={e => e.preventDefault()}
        />

        {/* Gesture hints — bottom edge, very dim */}
        <div className="absolute bottom-3 left-0 right-0 flex justify-center pointer-events-none">
          <p className="text-[10px] text-white/15 tracking-wide select-none">
            scroll · zoom &nbsp;·&nbsp; drag · pan &nbsp;·&nbsp; right-drag · rotate &nbsp;·&nbsp; double-click · reset
          </p>
        </div>

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

import type { Book } from "./canon";

function JumpPanel({
  books, onJump,
  jumpBook, setJumpBook,
  jumpChapter, setJumpChapter,
}: {
  books:          Book[];
  onJump:         (globalIndex: number) => void;
  jumpBook:       number;
  setJumpBook:    (v: number) => void;
  jumpChapter:    number;
  setJumpChapter: (v: number) => void;
}) {
  const selectedBook = books[jumpBook];
  const maxChapter   = selectedBook?.chapterCount ?? 1;

  const go = () => {
    if (!selectedBook) return;
    const ch = Math.max(1, Math.min(jumpChapter, maxChapter));
    onJump(selectedBook.startGlobalIndex + ch - 1);
  };

  return (
    <div>
      <p className="text-[10px] uppercase tracking-widest text-white/30 mb-2">Jump to</p>
      <div className="flex flex-col gap-1.5">
        <select
          value={jumpBook}
          onChange={e => { setJumpBook(Number(e.target.value)); setJumpChapter(1); }}
          className="w-full bg-white/5 border border-white/10 rounded px-2 py-1
                     text-xs text-white/60 outline-none"
        >
          {books.map(book => (
            <option key={book.index} value={book.index}>{book.name}</option>
          ))}
        </select>
        <div className="flex gap-1.5">
          <input
            type="number"
            min={1}
            max={maxChapter}
            value={jumpChapter}
            onChange={e => setJumpChapter(Number(e.target.value))}
            onKeyDown={e => { if (e.key === "Enter") go(); }}
            className="w-14 bg-white/5 border border-white/10 rounded px-2 py-1
                       text-xs text-white/60 outline-none"
          />
          <button
            onClick={go}
            className="flex-1 text-xs text-white/50 bg-white/5 border border-white/10
                       rounded px-2 py-1 hover:bg-white/10 transition-colors"
          >
            Go
          </button>
        </div>
      </div>
    </div>
  );
}

function ArchetypePicker({
  current,
  onChange,
  compact = false,
}: {
  current:  ShapeArchetype;
  onChange: (a: ShapeArchetype) => void;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <div className="flex gap-1 flex-wrap">
        {ARCHETYPE_ORDER.map(id => (
          <button
            key={id}
            onClick={() => onChange(id)}
            className={`text-[10px] px-1.5 py-0.5 rounded transition-colors ${
              current === id
                ? "bg-white/15 text-white/80"
                : "text-white/30 hover:text-white/50"
            }`}
          >
            {ARCHETYPES[id]!.label}
          </button>
        ))}
      </div>
    );
  }
  return (
    <div>
      <p className="text-[10px] uppercase tracking-widest text-white/30 mb-2">Shape</p>
      <div className="flex flex-col gap-0.5">
        {ARCHETYPE_ORDER.map(id => {
          const arch = ARCHETYPES[id]!;
          const isSelected = current === id;
          return (
            <button
              key={id}
              onClick={() => onChange(id)}
              className={`text-left px-2 py-1.5 rounded text-xs transition-colors ${
                isSelected ? "bg-white/10 text-white/85" : "text-white/35 hover:text-white/55 hover:bg-white/5"
              }`}
            >
              <span className="font-medium">{arch.label}</span>
              <span className={`ml-2 text-[10px] ${isSelected ? "text-white/45" : "text-white/20"}`}>
                {arch.description}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
