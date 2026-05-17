"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SceneNode, SceneModel, StarArrangement, StarMapHandle, StarOutput } from "@project-skymap/library";
import { StarMap } from "@project-skymap/library";
import type { Session } from "./session";
import {
  loadSession, saveSession, createSession,
  exportSession, exportAssignments, importSession, importSkyField, consumeGeneratedSkyField,
} from "./session";
import { CANON, BOOKS } from "./canon";
import type { Chapter } from "./canon";
import bibleRaw from "../../public/bible.json";
import { BuilderSection, BuilderSubTabs, BuilderWorkspace } from "../components/BuilderWorkspace";
import {
  buildAssignedScene as buildAssignedSceneShared,
  buildModelFromArrangement as buildModelFromArrangementShared,
  getDefaultHorizonTheme,
  getDefaultVisibilityHorizonGuide,
} from "../skymap/shared";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Tab = "view" | "assign";

// ---------------------------------------------------------------------------
// Verse counts
// ---------------------------------------------------------------------------

function buildVerseCounts(): number[] {
  const arr: number[] = [];
  for (const testament of (bibleRaw as any).testaments) {
    for (const division of testament.divisions) {
      for (const book of division.books) {
        for (let c = 0; c < book.chapters; c++) {
          arr.push((book.verses as number[])[c] ?? 1);
        }
      }
    }
  }
  return arr;
}

const VERSE_COUNTS = buildVerseCounts();
const TOTAL_CHAPTERS = CANON.length;
const MAX_VERSE_COUNT = Math.max(...VERSE_COUNTS);
const ASSIGNED_LABEL_ZOOM_THRESHOLD = 1.65;
const TRIANGULATION_MAX_EDGE_FACTOR = 2.35;
const SKY_FIELD_RENDER_RADIUS = 1.25;
const SKY_FIELD_FADE_START = SKY_FIELD_RENDER_RADIUS * 0.88;
const DEFAULT_VISIBILITY_HORIZON_GUIDE = getDefaultVisibilityHorizonGuide();

function assignedStarRadius(verseCount: number): number {
  const normalized = Math.max(0, Math.min(1, verseCount / MAX_VERSE_COUNT));
  return 1.9 + Math.pow(normalized, 0.55) * 4.6;
}

function assignedStarScale(verseCount: number): number {
  const normalized = Math.max(0, Math.min(1, verseCount / MAX_VERSE_COUNT));
  return 1 + Math.pow(normalized, 0.65) * 1.55;
}

function projectSkyCoordinate(value: number): number {
  return value / SKY_FIELD_RENDER_RADIUS;
}

type AssignmentHealth = {
  totalStars: number;
  totalChapters: number;
  assignedChapters: number;
  validAssignedChapters: number;
  uniqueAssignedStars: number;
  duplicateAssignments: number;
  invalidAssignments: number;
  openStars: number;
  remainingChapters: number;
  capacityDelta: number;
  canCompleteAssignment: boolean;
  visibleOpenStars: number;
  edgeOpenStars: number;
  hiddenOpenStars: number;
};

function getAssignmentHealth(session: Session | null): AssignmentHealth {
  const totalStars = session?.skyField.stars.length ?? 0;
  const assignments = session?.assignments ?? {};
  const assignedChapters = Object.keys(assignments).length;
  const starIds = new Set((session?.skyField.stars ?? []).map(star => star.id));

  let validAssignedChapters = 0;
  let invalidAssignments = 0;
  const usedStars = new Set<number>();
  let visibleOpenStars = 0;
  let edgeOpenStars = 0;
  let hiddenOpenStars = 0;

  for (const starId of Object.values(assignments)) {
    if (!starIds.has(starId)) {
      invalidAssignments += 1;
      continue;
    }
    validAssignedChapters += 1;
    usedStars.add(starId);
  }

  const uniqueAssignedStars = usedStars.size;
  const duplicateAssignments = Math.max(0, validAssignedChapters - uniqueAssignedStars);
  const openStars = Math.max(0, totalStars - uniqueAssignedStars);
  const remainingChapters = Math.max(0, TOTAL_CHAPTERS - assignedChapters);
  const capacityDelta = totalStars - TOTAL_CHAPTERS;
  const canCompleteAssignment = openStars >= remainingChapters && invalidAssignments === 0;

  for (const star of session?.skyField.stars ?? []) {
    if (usedStars.has(star.id)) continue;
    const r = Math.sqrt(star.x * star.x + star.y * star.y);
    if (r < SKY_FIELD_FADE_START) {
      visibleOpenStars += 1;
    } else if (r < SKY_FIELD_RENDER_RADIUS) {
      edgeOpenStars += 1;
    } else {
      hiddenOpenStars += 1;
    }
  }

  return {
    totalStars,
    totalChapters: TOTAL_CHAPTERS,
    assignedChapters,
    validAssignedChapters,
    uniqueAssignedStars,
    duplicateAssignments,
    invalidAssignments,
    openStars,
    remainingChapters,
    capacityDelta,
    canCompleteAssignment,
    visibleOpenStars,
    edgeOpenStars,
    hiddenOpenStars,
  };
}

function drawGeneratorStyleStar(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  magnitude: number,
  fade: number,
  scale = 1,
): void {
  if (magnitude < 2.5) {
    const glowR = 8 * scale;
    const grad = ctx.createRadialGradient(sx, sy, 0, sx, sy, glowR);
    grad.addColorStop(0, `rgba(255,240,210,${(0.45 * fade).toFixed(3)})`);
    grad.addColorStop(1, "rgba(255,240,210,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(sx - glowR, sy - glowR, glowR * 2, glowR * 2);

    ctx.beginPath();
    ctx.arc(sx, sy, 2.2 * scale, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,248,230,${fade.toFixed(3)})`;
    ctx.fill();
  } else if (magnitude < 3.5) {
    const glowR = 5 * scale;
    const grad = ctx.createRadialGradient(sx, sy, 0, sx, sy, glowR);
    grad.addColorStop(0, `rgba(255,240,210,${(0.40 * fade).toFixed(3)})`);
    grad.addColorStop(1, "rgba(255,240,210,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(sx - glowR, sy - glowR, glowR * 2, glowR * 2);

    ctx.beginPath();
    ctx.arc(sx, sy, 1.8 * scale, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,248,230,${fade.toFixed(3)})`;
    ctx.fill();
  } else if (magnitude < 4.5) {
    ctx.beginPath();
    ctx.arc(sx, sy, 1.4 * scale, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(220,230,255,${(0.97 * fade).toFixed(3)})`;
    ctx.fill();
  } else if (magnitude < 5.5) {
    ctx.beginPath();
    ctx.arc(sx, sy, 1.0 * scale, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(210,220,255,${(0.92 * fade).toFixed(3)})`;
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.arc(sx, sy, 0.7 * scale, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(200,210,255,${(0.85 * fade).toFixed(3)})`;
    ctx.fill();
  }
}

function divisionTriangulationColor(divisionName: string): string {
  const key = divisionName.toLowerCase();
  if (key === "the law" || key === "paul's letters") return "rgba(110,170,255,0.58)";
  if (key === "history" || key === "prophecy") return "rgba(182,120,255,0.58)";
  if (key === "wisdom" || key === "general letters") return "rgba(255,110,110,0.58)";
  if (key === "major prophets" || key === "early church") return "rgba(110,214,146,0.58)";
  if (key === "minor prophets" || key === "gospels") return "rgba(255,214,92,0.64)";
  return "rgba(180,190,220,0.48)";
}

type TriPoint = {
  id: string;
  x: number;
  y: number;
};

type TriEdge = {
  a: string;
  b: string;
};

function triangulationKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function circumcircleContains(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, px: number, py: number): boolean {
  const apx = ax - px;
  const apy = ay - py;
  const bpx = bx - px;
  const bpy = by - py;
  const cpx = cx - px;
  const cpy = cy - py;

  const det = (apx * apx + apy * apy) * (bpx * cpy - cpx * bpy)
    - (bpx * bpx + bpy * bpy) * (apx * cpy - cpx * apy)
    + (cpx * cpx + cpy * cpy) * (apx * bpy - bpx * apy);
  const orientation = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  return orientation > 0 ? det > 1e-9 : det < -1e-9;
}

function bowyerWatson(points: TriPoint[]): TriEdge[] {
  if (points.length < 3) return [];

  const xs = points.map(point => point.x);
  const ys = points.map(point => point.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  const dx = maxX - minX || 1;
  const dy = maxY - minY || 1;
  const deltaMax = Math.max(dx, dy);
  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;

  const superA: TriPoint = { id: "__super_a__", x: midX - 20 * deltaMax, y: midY - deltaMax };
  const superB: TriPoint = { id: "__super_b__", x: midX, y: midY + 20 * deltaMax };
  const superC: TriPoint = { id: "__super_c__", x: midX + 20 * deltaMax, y: midY - deltaMax };

  let triangles = [{
    a: superA,
    b: superB,
    c: superC,
  }];

  for (const point of points) {
    const bad = triangles.filter(triangle =>
      circumcircleContains(
        triangle.a.x, triangle.a.y,
        triangle.b.x, triangle.b.y,
        triangle.c.x, triangle.c.y,
        point.x, point.y,
      ),
    );

    const polygon = new Map<string, { a: TriPoint; b: TriPoint; count: number }>();
    for (const triangle of bad) {
      const edges = [
        [triangle.a, triangle.b],
        [triangle.b, triangle.c],
        [triangle.c, triangle.a],
      ] as const;

      for (const [ea, eb] of edges) {
        const key = triangulationKey(ea.id, eb.id);
        const existing = polygon.get(key);
        if (existing) {
          existing.count += 1;
        } else {
          polygon.set(key, { a: ea, b: eb, count: 1 });
        }
      }
    }

    triangles = triangles.filter(triangle => !bad.includes(triangle));

    for (const edge of polygon.values()) {
      if (edge.count !== 1) continue;
      triangles.push({ a: edge.a, b: edge.b, c: point });
    }
  }

  const superIds = new Set([superA.id, superB.id, superC.id]);
  const edges = new Map<string, TriEdge>();

  for (const triangle of triangles) {
    const ids = [triangle.a.id, triangle.b.id, triangle.c.id];
    if (ids.some(id => superIds.has(id))) continue;
    const pairs = [
      [triangle.a.id, triangle.b.id],
      [triangle.b.id, triangle.c.id],
      [triangle.c.id, triangle.a.id],
    ] as const;
    for (const [a, b] of pairs) {
      edges.set(triangulationKey(a, b), { a, b });
    }
  }

  return [...edges.values()];
}

// ---------------------------------------------------------------------------
// Scene helpers
// ---------------------------------------------------------------------------

const nid = {
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

// ---------------------------------------------------------------------------
// Chapter search
// ---------------------------------------------------------------------------

function parseChapterQuery(query: string): Chapter[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  // Detect trailing chapter number: "gen 1", "1 cor 13", "ps 23"
  const m        = q.match(/^(.+?)\s+(\d+)$/);
  const bookPart = (m ? m[1]! : q).trim();
  const chapNum  = m ? Number(m[2]) : null;

  const matched = BOOKS.filter(b => {
    const key  = b.key.toLowerCase();
    const name = b.name.toLowerCase();
    return key.startsWith(bookPart) || name.startsWith(bookPart);
  });

  if (matched.length === 0) return [];

  const results: Chapter[] = [];
  for (const book of matched.slice(0, 3)) {
    if (chapNum !== null) {
      if (chapNum >= 1 && chapNum <= book.chapterCount) {
        const ch = CANON[book.startGlobalIndex + chapNum - 1];
        if (ch) results.push(ch);
      }
    } else {
      const show = matched.length === 1 ? 8 : 3;
      for (let i = 0; i < Math.min(book.chapterCount, show); i++) {
        const ch = CANON[book.startGlobalIndex + i];
        if (ch) results.push(ch);
      }
    }
    if (results.length >= 8) break;
  }

  return results.slice(0, 8);
}

// ---------------------------------------------------------------------------
// File export helpers
// ---------------------------------------------------------------------------

function downloadJson(data: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function BuilderPage() {
  const mapRef = useRef<StarMapHandle>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const spinRef = useRef(0);
  const zoomRef = useRef(1.0);
  const panRef = useRef({ x: 0, y: 0 });
  const isDraggingRef = useRef(false);
  const dragMovedRef = useRef(false);
  const dragModeRef = useRef<"pan" | "spin">("pan");
  const lastMouseRef = useRef({ x: 0, y: 0 });
  const assignedHitRef = useRef<Array<{ chapterGlobalIndex: number; starId: number; x: number; y: number; r: number }>>([]);
  const unassignedHitRef = useRef<Array<{ starId: number; x: number; y: number; r: number }>>([]);

  const [activeTab, setActiveTab] = useState<Tab>("assign");

  // View + Edit share this arrangement state (both load arrangement.json)
  const [arrangement, setArrangement] = useState<StarArrangement | null>(null);

  // Assign: full session (skyfield + assignments)
  const [session, setSession] = useState<Session | null>(null);
  const [sessionStatus, setSessionStatus] = useState<string>("No session loaded yet.");
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [showBookTriangulation, setShowBookTriangulation] = useState(true);
  const [showVisibilityGuides, setShowVisibilityGuides] = useState(true);

  // 3D selection (Assign mode only)
  const [selectedNode,          setSelectedNode]          = useState<SceneNode | null>(null);
  const [selectedMarkerStarId,  setSelectedMarkerStarId]  = useState<number | null>(null);
  const [popupAnchor,           setPopupAnchor]           = useState<{ x: number; y: number } | null>(null);
  const [armedChapterIndex,     setArmedChapterIndex]     = useState<number | null>(null);

  const lastPointerRef   = useRef({ x: 0, y: 0 });
  const containerRef     = useRef<HTMLDivElement>(null);

  // ── Session bootstrap ──────────────────────────────────────────────────────

  useEffect(() => {
    const handedOffSkyField = consumeGeneratedSkyField();
    if (handedOffSkyField) {
      setSession(createSession(handedOffSkyField));
      setActiveTab("assign");
      setSessionStatus("Loaded generated sky field from Generate.");
      return;
    }
    const saved = loadSession();
    setSession(saved);
    setSessionStatus(saved ? "Restored autosaved session from this browser." : "No saved browser session found.");
  }, []);
  useEffect(() => {
    if (!session) return;
    saveSession(session);
    setLastSavedAt(Date.now());
    setSessionStatus(prev =>
      prev.startsWith("Loaded ") || prev.startsWith("Restored ") || prev.startsWith("Imported ")
        ? prev
        : "Autosaved in this browser.",
    );
  }, [session]);

  // ── Derived data ───────────────────────────────────────────────────────────

  const viewModel = useMemo(() => {
    if (!arrangement) return null;
    return buildModelFromArrangementShared(arrangement);
  }, [arrangement]);

  const starToChapter = useMemo(() => {
    const m = new Map<number, number>();
    for (const [chStr, starId] of Object.entries(session?.assignments ?? {})) {
      m.set(starId, Number(chStr));
    }
    return m;
  }, [session]);

  const assignedChapters = useMemo(
    () => new Set<number>(Object.keys(session?.assignments ?? {}).map(Number)),
    [session],
  );

  // ── 3D config ──────────────────────────────────────────────────────────────

  const [constellationConfig, setConstellationConfig] = useState<any>(null);

  const horizonTheme = useMemo(() => getDefaultHorizonTheme(), []);

  useEffect(() => {
    fetch("/constellations.json")
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(data => {
        if (data.atlasBasePath) data.atlasBasePath = data.atlasBasePath;
        setConstellationConfig(data);
      })
      .catch(() => {});
  }, []);

  const config = useMemo(() => {
    const base = {
      layout:            { algorithm: "phyllotaxis" as const, radius: 2000 },
      starSizeExponent:         4.0,
      starSizeScale:            6.0,
      starSizeWeightPercentile: 1.0,
      starZoomReveal:           false,
      showAtmosphere:       false,
      showMoon:             false,
      showSunrise:          false,
      showMilkyWay:         false,
      showBackdropStars:    false,
      showConstellationArt: true,
      constellations:       constellationConfig,
      horizonTheme,
      projection:           "blended" as const,
      fitProjection:        true,
      labelBehavior: {
        overlapPaddingPx:  2,
        reappearDelayMs:   60,
        classes: {
          chapter: { maxFov: 22, maxOverlapPx: 12 },
        },
      },
    };

    if (activeTab === "view") {
      if (!viewModel || !arrangement) return null;
      return {
        ...base,
        model:              viewModel,
        arrangement,
        editable:           false,
        showBookLabels:     true,
        showChapterLabels:  true,
        showDivisionLabels: false,
        showGroupLabels:    false,
      };
    }

    return null;
  }, [activeTab, viewModel, arrangement, constellationConfig, horizonTheme]);

  // ── Tab switch ─────────────────────────────────────────────────────────────

  const handleTabChange = useCallback((tab: Tab) => {
    setSelectedNode(null);
    setSelectedMarkerStarId(null);
    setPopupAnchor(null);
    setArmedChapterIndex(null);
    setActiveTab(tab);
  }, []);

  // ── Assign handlers ────────────────────────────────────────────────────────

  const assignChapterToStar = useCallback((chapterGlobalIndex: number, starId: number) => {
    setSession(prev => {
      if (!prev) return prev;
      const next: Record<number, number> = {};
      for (const [ch, st] of Object.entries(prev.assignments)) {
        if (Number(ch) !== chapterGlobalIndex) next[Number(ch)] = st;
      }
      next[chapterGlobalIndex] = starId;
      return { ...prev, assignments: next };
    });
  }, []);

  const handleAssign = useCallback((chapterGlobalIndex: number) => {
    if (selectedMarkerStarId === null) return;
    assignChapterToStar(chapterGlobalIndex, selectedMarkerStarId);
    setArmedChapterIndex(null);
    setSelectedMarkerStarId(null);
    setPopupAnchor(null);
  }, [assignChapterToStar, selectedMarkerStarId]);

  const handleDeassign = useCallback(() => {
    const chIdx =
      selectedNode             ? chapterNodeToGlobalIndex(selectedNode.id) :
      selectedMarkerStarId !== null ? starToChapter.get(selectedMarkerStarId) :
      undefined;
    if (chIdx === undefined) return;
    setSession(prev => {
      if (!prev) return prev;
      const next = { ...prev.assignments };
      delete next[chIdx];
      return { ...prev, assignments: next };
    });
    if (armedChapterIndex === chIdx) setArmedChapterIndex(null);
    setSelectedNode(null);
    setSelectedMarkerStarId(null);
  }, [armedChapterIndex, selectedNode, selectedMarkerStarId, starToChapter]);

  const handleClose = useCallback(() => {
    setSelectedNode(null);
    setSelectedMarkerStarId(null);
    setPopupAnchor(null);
    setArmedChapterIndex(null);
  }, []);

  const handleDeassignByIndex = useCallback((chapterGlobalIndex: number) => {
    setSession(prev => {
      if (!prev) return prev;
      const next = { ...prev.assignments };
      delete next[chapterGlobalIndex];
      return { ...prev, assignments: next };
    });
    if (armedChapterIndex === chapterGlobalIndex) setArmedChapterIndex(null);
  }, [armedChapterIndex]);

  // ── File import ────────────────────────────────────────────────────────────

  const handleImportArrangement = useCallback(async (file: File) => {
    try {
      setArrangement(JSON.parse(await file.text()) as StarArrangement);
    } catch { /* invalid */ }
  }, []);

  const handleImportSkyField = useCallback(async (file: File) => {
    try {
      setSession(createSession(await importSkyField(file)));
      setSessionStatus(`Loaded sky field from ${file.name}.`);
    } catch { /* invalid */ }
  }, []);

  const handleImportSession = useCallback(async (file: File) => {
    try {
      setSession(await importSession(file));
      setSessionStatus(`Imported session from ${file.name}.`);
    } catch { /* invalid */ }
  }, []);

  // ── Derived display values ─────────────────────────────────────────────────

  const assignmentHealth   = useMemo(() => getAssignmentHealth(session), [session]);
  const totalAssigned      = assignmentHealth.assignedChapters;
  const hasSkyField        = assignmentHealth.totalStars > 0;
  const unassignedCount    = assignmentHealth.openStars;
  const arrangementCount   = arrangement
    ? Object.keys(arrangement).filter(k => /^C:/.test(k)).length
    : 0;

  const selectedChapterIndex = selectedNode ? chapterNodeToGlobalIndex(selectedNode.id) : undefined;
  const selectedChapter      = selectedChapterIndex !== undefined ? CANON[selectedChapterIndex] : undefined;
  const selectedVerses       = selectedChapterIndex !== undefined ? VERSE_COUNTS[selectedChapterIndex] : undefined;
  const selectedMarkerStar   = selectedMarkerStarId !== null
    ? session?.skyField.stars.find(star => star.id === selectedMarkerStarId) ?? null
    : null;
  const armedChapter         = armedChapterIndex !== null ? CANON[armedChapterIndex] : undefined;
  const armedVerses          = armedChapterIndex !== null ? VERSE_COUNTS[armedChapterIndex] : undefined;
  const lastSavedLabel       = lastSavedAt !== null
    ? new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(lastSavedAt)
    : null;
  const triangulationBooks = useMemo(() => {
    if (!session?.skyField) return [];

    const books = new Map<string, {
      divisionName: string;
      points: Array<{ chapterGlobalIndex: number; starId: number; x: number; y: number }>;
    }>();

    for (const [chapterKey, starId] of Object.entries(session.assignments)) {
      const chapterGlobalIndex = Number(chapterKey);
      const chapter = CANON[chapterGlobalIndex];
      const star = session.skyField.stars.find(item => item.id === starId);
      if (!chapter || !star) continue;

      let book = books.get(chapter.bookKey);
      if (!book) {
        book = { divisionName: chapter.divisionName, points: [] };
        books.set(chapter.bookKey, book);
      }
      book.points.push({
        chapterGlobalIndex,
        starId,
        x: star.x,
        y: star.y,
      });
    }

    return [...books.entries()].map(([bookKey, book]) => {
      const points = book.points;
      const pointMap = new Map<string, (typeof points)[number]>(
        points.map(point => [`${point.chapterGlobalIndex}`, point] as const),
      );
      const edges = points.length === 2
        ? [{ a: `${points[0]!.chapterGlobalIndex}`, b: `${points[1]!.chapterGlobalIndex}` }]
        : bowyerWatson(points.map(point => ({
            id: `${point.chapterGlobalIndex}`,
            x: point.x,
            y: point.y,
          })));

      const lengths = edges.map(edge => {
        const a = pointMap.get(edge.a);
        const b = pointMap.get(edge.b);
        if (!a || !b) return Infinity;
        return Math.hypot(a.x - b.x, a.y - b.y);
      }).filter(Number.isFinite);

      const averageLength = lengths.length > 0
        ? lengths.reduce((sum, value) => sum + value, 0) / lengths.length
        : 0;
      const maxLength = averageLength > 0 ? averageLength * TRIANGULATION_MAX_EDGE_FACTOR : Infinity;
      type BookEdge = { a: (typeof points)[number]; b: (typeof points)[number] };

      return {
        bookKey,
        divisionName: book.divisionName,
        color: divisionTriangulationColor(book.divisionName),
        edges: edges
          .map(edge => {
            const a = pointMap.get(edge.a);
            const b = pointMap.get(edge.b);
            if (!a || !b) return null;
            const length = Math.hypot(a.x - b.x, a.y - b.y);
            if (length > maxLength) return null;
            return { a, b };
          })
          .filter((edge): edge is BookEdge => edge !== null),
      };
    });
  }, [session]);

  const focusSkyStar = useCallback((star: StarOutput) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const baseRadius = Math.min(width, height) / 2 - 12;
    zoomRef.current = 1.45;
    const radius = baseRadius * zoomRef.current;
    const cos = Math.cos(spinRef.current);
    const sin = Math.sin(spinRef.current);
    const rx = projectSkyCoordinate(star.x * cos + star.y * sin);
    const rz = projectSkyCoordinate(-star.x * sin + star.y * cos);
    panRef.current = { x: -rx * radius, y: -rz * radius };
  }, []);

  const handleArmReassign = useCallback((chapterGlobalIndex: number) => {
    const chapter = CANON[chapterGlobalIndex];
    const starId = session?.assignments[chapterGlobalIndex];
    const star = starId !== undefined ? session?.skyField.stars.find(item => item.id === starId) : undefined;
    if (!chapter) return;
    setArmedChapterIndex(chapterGlobalIndex);
    setSelectedNode(null);
    setSelectedMarkerStarId(null);
    setPopupAnchor(null);
    if (activeTab === "assign" && star) {
      focusSkyStar(star);
      return;
    }
    mapRef.current?.flyTo(nid.chapter(chapter.bookKey, chapter.chapterNumber), 10);
  }, [activeTab, focusSkyStar, session]);

  const handleFlyToChapter = useCallback((chapterGlobalIndex: number) => {
    if (activeTab !== "assign") {
      const chapter = CANON[chapterGlobalIndex];
      if (!chapter) return;
      mapRef.current?.flyTo(nid.chapter(chapter.bookKey, chapter.chapterNumber), 10);
      return;
    }

    const chapter = CANON[chapterGlobalIndex];
    const starId = session?.assignments[chapterGlobalIndex];
    const star = starId !== undefined ? session?.skyField.stars.find(item => item.id === starId) : undefined;
    if (!chapter || !star) return;

    setSelectedNode({
      id: nid.chapter(chapter.bookKey, chapter.chapterNumber),
      label: `${chapter.bookName} ${chapter.chapterNumber}`,
      level: 3,
      parent: nid.book(chapter.bookKey),
    });
    setSelectedMarkerStarId(null);
    setPopupAnchor(null);
    setArmedChapterIndex(null);
    focusSkyStar(star);
  }, [activeTab, focusSkyStar, session]);

  const handleCanvasPointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    isDraggingRef.current = true;
    dragMovedRef.current = false;
    dragModeRef.current = e.shiftKey ? "spin" : "pan";
    lastMouseRef.current = { x: e.clientX, y: e.clientY };
    lastPointerRef.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);

  const handleCanvasPointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDraggingRef.current) return;
    const dx = e.clientX - lastMouseRef.current.x;
    const dy = e.clientY - lastMouseRef.current.y;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) dragMovedRef.current = true;
    lastMouseRef.current = { x: e.clientX, y: e.clientY };
    lastPointerRef.current = { x: e.clientX, y: e.clientY };

    if (dragModeRef.current === "spin") {
      spinRef.current += dx * 0.005;
    } else {
      panRef.current = { x: panRef.current.x + dx, y: panRef.current.y + dy };
    }
  }, []);

  const handleCanvasPointerUp = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;

    if (dragMovedRef.current) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    let bestUnassigned: { starId: number; x: number; y: number; r: number } | null = null;
    for (const hit of unassignedHitRef.current) {
      const dx = hit.x - x;
      const dy = hit.y - y;
      if (dx * dx + dy * dy <= hit.r * hit.r) {
        if (!bestUnassigned || hit.r < bestUnassigned.r) bestUnassigned = hit;
      }
    }

    if (bestUnassigned) {
      if (armedChapterIndex !== null) {
        assignChapterToStar(armedChapterIndex, bestUnassigned.starId);
        setArmedChapterIndex(null);
        setSelectedNode(null);
        setSelectedMarkerStarId(null);
        setPopupAnchor(null);
        return;
      }

      setSelectedMarkerStarId(bestUnassigned.starId);
      setSelectedNode(null);
      setPopupAnchor({ x: bestUnassigned.x, y: bestUnassigned.y });
      return;
    }

    let bestAssigned: { chapterGlobalIndex: number; starId: number; x: number; y: number; r: number } | null = null;
    for (const hit of assignedHitRef.current) {
      const dx = hit.x - x;
      const dy = hit.y - y;
      if (dx * dx + dy * dy <= hit.r * hit.r) {
        if (!bestAssigned || hit.r < bestAssigned.r) bestAssigned = hit;
      }
    }

    if (bestAssigned) {
      const chapter = CANON[bestAssigned.chapterGlobalIndex];
      if (!chapter) return;
      setSelectedNode({
        id: nid.chapter(chapter.bookKey, chapter.chapterNumber),
        label: `${chapter.bookName} ${chapter.chapterNumber}`,
        level: 3,
        parent: nid.book(chapter.bookKey),
      });
      setSelectedMarkerStarId(null);
      setPopupAnchor(null);
      setArmedChapterIndex(null);
      return;
    }

    handleClose();
  }, [armedChapterIndex, assignChapterToStar, handleClose]);

  const handleCanvasWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.93 : 1.07;
    zoomRef.current = Math.max(0.3, Math.min(6, zoomRef.current * factor));
  }, []);

  const handleCanvasDoubleClick = useCallback(() => {
    panRef.current = { x: 0, y: 0 };
    zoomRef.current = 1;
    spinRef.current = 0;
  }, []);

  useEffect(() => {
    if (activeTab !== "assign") return;
    const canvas = canvasRef.current;
    if (!canvas || !session?.skyField) return;

    const draw = () => {
      animRef.current = requestAnimationFrame(draw);

      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const cx = width / 2;
      const cy = height / 2;
      const baseRadius = Math.min(width, height) / 2 - 12;
      const radius = baseRadius * zoomRef.current;
      const showAssignedLabels = zoomRef.current >= ASSIGNED_LABEL_ZOOM_THRESHOLD;
      const spin = spinRef.current;
      const pan = panRef.current;
      const scx = cx + pan.x;
      const scy = cy + pan.y;
      const cos = Math.cos(spin);
      const sin = Math.sin(spin);

      assignedHitRef.current = [];
      unassignedHitRef.current = [];

      ctx.fillStyle = "#05060a";
      ctx.fillRect(0, 0, width, height);

      ctx.beginPath();
      ctx.arc(scx, scy, radius, 0, Math.PI * 2);
      ctx.fillStyle = "#090d1a";
      ctx.fill();

      ctx.beginPath();
      ctx.arc(scx, scy, radius, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(80,100,160,0.35)";
      ctx.lineWidth = 1.5;
      ctx.stroke();

      if (showVisibilityGuides) {
        ctx.save();
        ctx.setLineDash([2, 8]);
        ctx.lineCap = "round";

        if (DEFAULT_VISIBILITY_HORIZON_GUIDE.length > 1) {
          ctx.beginPath();
          DEFAULT_VISIBILITY_HORIZON_GUIDE.forEach((point, index) => {
            const gx = scx + projectSkyCoordinate(point.x * cos + point.y * sin) * radius;
            const gy = scy + projectSkyCoordinate(-point.x * sin + point.y * cos) * radius;
            if (index === 0) ctx.moveTo(gx, gy);
            else ctx.lineTo(gx, gy);
          });
          ctx.closePath();
          ctx.strokeStyle = "rgba(255,255,255,0.82)";
          ctx.lineWidth = 1.2;
          ctx.stroke();
        }

        ctx.restore();
      }

      if (showBookTriangulation) {
        for (const book of triangulationBooks) {
          if (book.edges.length === 0) continue;
          ctx.save();
          ctx.beginPath();
          for (const edge of book.edges) {
            const ax = scx + projectSkyCoordinate(edge.a.x * cos + edge.a.y * sin) * radius;
            const ay = scy + projectSkyCoordinate(-edge.a.x * sin + edge.a.y * cos) * radius;
            const bx = scx + projectSkyCoordinate(edge.b.x * cos + edge.b.y * sin) * radius;
            const by = scy + projectSkyCoordinate(-edge.b.x * sin + edge.b.y * cos) * radius;
            ctx.moveTo(ax, ay);
            ctx.lineTo(bx, by);
          }
          ctx.shadowBlur = 10;
          ctx.shadowColor = book.color;
          ctx.strokeStyle = book.color;
          ctx.lineWidth = 1.5;
          ctx.stroke();
          ctx.restore();
        }
      }

      for (const star of session.skyField.stars) {
        const projR = Math.sqrt(star.x * star.x + star.y * star.y);
        const fade = projR >= SKY_FIELD_RENDER_RADIUS
          ? 0
          : projR > SKY_FIELD_FADE_START
            ? Math.max(0, (SKY_FIELD_RENDER_RADIUS - projR) / (SKY_FIELD_RENDER_RADIUS - SKY_FIELD_FADE_START))
            : 1;
        if (fade <= 0) continue;

        const rx = projectSkyCoordinate(star.x * cos + star.y * sin);
        const rz = projectSkyCoordinate(-star.x * sin + star.y * cos);
        const sx = scx + rx * radius;
        const sy = scy + rz * radius;
        const mag = star.magnitude;

        const chapterGlobalIndex = starToChapter.get(star.id);
        if (chapterGlobalIndex !== undefined) {
          const isSelected = selectedChapterIndex === chapterGlobalIndex;
          const isArmed = armedChapterIndex === chapterGlobalIndex;
          const chapter = CANON[chapterGlobalIndex];
          const verseCount = VERSE_COUNTS[chapterGlobalIndex] ?? 1;
          const scale = assignedStarScale(verseCount);
          const chapterRadius = assignedStarRadius(verseCount);

          drawGeneratorStyleStar(ctx, sx, sy, mag, fade, scale);

          if (isSelected || isArmed) {
            ctx.beginPath();
            ctx.arc(sx, sy, chapterRadius + (isSelected ? 6 : 5), 0, Math.PI * 2);
            ctx.strokeStyle = isSelected ? "rgba(255,255,255,0.65)" : "rgba(251,191,36,0.65)";
            ctx.lineWidth = isSelected ? 1.5 : 1.2;
            ctx.stroke();
          }

          if (chapter && (showAssignedLabels || isSelected || isArmed)) {
            const label = `${chapter.bookName} ${chapter.chapterNumber}`;
            ctx.font = isSelected || isArmed ? "12px Arial, Helvetica, sans-serif" : "11px Arial, Helvetica, sans-serif";
            const textWidth = ctx.measureText(label).width;
            const labelX = sx + chapterRadius + 7;
            const labelY = sy - chapterRadius - 4;
            ctx.fillStyle = isSelected
              ? "rgba(12,15,26,0.94)"
              : isArmed
                ? "rgba(16,13,8,0.94)"
                : "rgba(10,13,22,0.86)";
            ctx.fillRect(labelX - 6, labelY - 11, textWidth + 12, 16);
            ctx.fillStyle = isSelected
              ? "rgba(255,255,255,0.95)"
              : isArmed
                ? "rgba(255,243,200,0.95)"
                : "rgba(228,235,255,0.82)";
            ctx.fillText(label, labelX, labelY);
          }

          assignedHitRef.current.push({
            chapterGlobalIndex,
            starId: star.id,
            x: sx,
            y: sy,
            r: chapterRadius + (isSelected ? 8 : 6),
          });
        } else {
          drawGeneratorStyleStar(ctx, sx, sy, mag, fade);

          ctx.beginPath();
          ctx.arc(sx, sy, 3.1, 0, Math.PI * 2);
          ctx.strokeStyle = selectedMarkerStarId === star.id
            ? "rgba(253,224,71,0.95)"
            : "rgba(251,191,36,0.78)";
          ctx.lineWidth = selectedMarkerStarId === star.id ? 2 : 1.15;
          ctx.stroke();

          unassignedHitRef.current.push({
            starId: star.id,
            x: sx,
            y: sy,
            r: selectedMarkerStarId === star.id ? 12 : 10,
          });
        }
      }
    };

    draw();
    return () => cancelAnimationFrame(animRef.current);
  }, [activeTab, armedChapterIndex, selectedChapterIndex, selectedMarkerStarId, session, showBookTriangulation, showVisibilityGuides, starToChapter, triangulationBooks]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <BuilderWorkspace
      route="assign"
      title="Builder"
      subtitle="Load a generated sky field, assign chapters to stars, then export the session into Refine for constellation shaping."
      sidebarWidthClass="w-72"
      sidebar={
        <>
          <p className="text-xs leading-relaxed text-white/45">
            Assign uses the generated sky as a fixed stage. Amber stars are unassigned targets. White stars already carry chapters.
          </p>

          <BuilderSection label="Mode">
            <BuilderSubTabs
              tabs={["view", "assign"] as const}
              activeTab={activeTab}
              onChange={handleTabChange}
            />
          </BuilderSection>

          {activeTab === "view" && (
            <BuilderSection label="View">
              <FileInput label="Load arrangement" filename="arrangement.json"
                         onChange={handleImportArrangement} />
              {arrangementCount > 0
                ? <p className="text-xs text-white/35">{arrangementCount.toLocaleString()} chapters</p>
                : <p className="text-[10px] leading-relaxed text-white/20">
                    Load an arrangement.json exported from Assign or Edit.
                  </p>
              }
            </BuilderSection>
          )}

          {activeTab === "assign" && (
            !hasSkyField ? (
              <BuilderSection label="Assign">
                <p className="text-[10px] leading-relaxed text-white/20">
                  Load a sky field to begin assigning chapters.
                </p>
                <FileInput label="Load sky field" filename="skyfield.json"
                           onChange={handleImportSkyField} />
                <FileInput label="Resume session" filename="skymap-session.json"
                           onChange={handleImportSession} />
              </BuilderSection>
            ) : (
              <>
                <BuilderSection label="Progress">
                  <div className="flex flex-col gap-1.5">
                    <div className="flex justify-between text-xs">
                      <span className="text-white/30">Assigned</span>
                      <span className="tabular-nums text-white/55">
                        {totalAssigned.toLocaleString()} / {TOTAL_CHAPTERS.toLocaleString()}
                      </span>
                    </div>
                    <div className="h-0.5 overflow-hidden rounded-full bg-white/8">
                      <div className="h-full rounded-full transition-all duration-300"
                           style={{
                             width: `${(totalAssigned / TOTAL_CHAPTERS) * 100}%`,
                             background: "rgba(255,160,60,0.55)",
                           }} />
                    </div>
                    <div className="flex justify-between text-[10px] uppercase tracking-widest text-white/22">
                      <span>{unassignedCount.toLocaleString()} stars open</span>
                      <span>{totalAssigned.toLocaleString()} placed</span>
                    </div>
                  </div>
                </BuilderSection>

                <BuilderSection label="Coverage">
                  <div className="rounded-md border border-white/8 bg-white/[0.03] px-2.5 py-2">
                    <div className="flex items-center justify-between text-[10px] uppercase tracking-widest text-white/22">
                      <span>Capacity</span>
                      <span className={assignmentHealth.canCompleteAssignment ? "text-emerald-300/70" : "text-amber-200/70"}>
                        {assignmentHealth.canCompleteAssignment ? "Completable" : "Attention"}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-col gap-1 text-xs">
                      <div className="flex items-center justify-between text-white/48">
                        <span>Sky field stars</span>
                        <span className="tabular-nums text-white/72">{assignmentHealth.totalStars.toLocaleString()}</span>
                      </div>
                      <div className="flex items-center justify-between text-white/48">
                        <span>Bible chapters</span>
                        <span className="tabular-nums text-white/72">{assignmentHealth.totalChapters.toLocaleString()}</span>
                      </div>
                      <div className="flex items-center justify-between text-white/48">
                        <span>Open stars vs chapters left</span>
                        <span className="tabular-nums text-white/72">
                          {assignmentHealth.openStars.toLocaleString()} / {assignmentHealth.remainingChapters.toLocaleString()}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-white/48">
                        <span>Visible open stars</span>
                        <span className="tabular-nums text-white/72">{assignmentHealth.visibleOpenStars.toLocaleString()}</span>
                      </div>
                      <div className="flex items-center justify-between text-white/48">
                        <span>Edge-band open stars</span>
                        <span className="tabular-nums text-white/72">{assignmentHealth.edgeOpenStars.toLocaleString()}</span>
                      </div>
                      <div className="flex items-center justify-between text-white/48">
                        <span>Hidden open stars</span>
                        <span className={`tabular-nums ${
                          assignmentHealth.hiddenOpenStars === 0 ? "text-emerald-300/70" : "text-amber-200/70"
                        }`}>
                          {assignmentHealth.hiddenOpenStars.toLocaleString()}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-white/48">
                        <span>Headroom</span>
                        <span className={`tabular-nums ${
                          assignmentHealth.capacityDelta >= 0 ? "text-emerald-300/70" : "text-amber-200/70"
                        }`}>
                          {assignmentHealth.capacityDelta >= 0 ? "+" : ""}
                          {assignmentHealth.capacityDelta.toLocaleString()}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-white/48">
                        <span>Unique stars claimed</span>
                        <span className="tabular-nums text-white/72">
                          {assignmentHealth.uniqueAssignedStars.toLocaleString()} / {assignmentHealth.validAssignedChapters.toLocaleString()}
                        </span>
                      </div>
                    </div>
                  </div>

                  {assignmentHealth.invalidAssignments > 0 || assignmentHealth.duplicateAssignments > 0 ? (
                    <p className="text-[10px] leading-relaxed text-amber-100/58">
                      Session integrity warning:
                      {" "}
                      {assignmentHealth.invalidAssignments > 0
                        ? `${assignmentHealth.invalidAssignments.toLocaleString()} assignment${assignmentHealth.invalidAssignments === 1 ? "" : "s"} point to missing stars. `
                        : ""}
                      {assignmentHealth.duplicateAssignments > 0
                        ? `${assignmentHealth.duplicateAssignments.toLocaleString()} assignment${assignmentHealth.duplicateAssignments === 1 ? "" : "s"} share a star that is already claimed.`
                        : ""}
                    </p>
                  ) : assignmentHealth.hiddenOpenStars > 0 ? (
                    <p className="text-[10px] leading-relaxed text-amber-100/58">
                      Some open stars still fall outside the current render radius. That indicates a mismatch between generated coordinates and the assign viewport.
                    </p>
                  ) : (
                    <p className="text-[10px] leading-relaxed text-white/24">
                      This session is balanced when open stars match chapters left. `Hidden open stars` should stay at `0`; any remainder should be either clearly visible or sitting in the edge fade band.
                    </p>
                  )}
                </BuilderSection>

                <BuilderSection label="Sky Controls">
                  <label className="flex items-center justify-between text-xs text-white/52">
                  <span>Show visibility guide</span>
                    <input
                      type="checkbox"
                      checked={showVisibilityGuides}
                      onChange={e => setShowVisibilityGuides(e.target.checked)}
                      className="accent-amber-400"
                    />
                  </label>
                  <p className="text-[10px] leading-relaxed text-white/22">
                    Draws the default Preview horizon contour so assigned stars can be kept within the area expected to stay visible.
                  </p>
                  <label className="flex items-center justify-between text-xs text-white/52">
                    <span>Show book triangulation</span>
                    <input
                      type="checkbox"
                      checked={showBookTriangulation}
                      onChange={e => setShowBookTriangulation(e.target.checked)}
                      className="accent-amber-400"
                    />
                  </label>
                  <p className="text-[10px] leading-relaxed text-white/22">
                    Builds per-book Delaunay groupings with division colours:
                    blue for Law and Paul&apos;s Letters, violet for History and Revelation,
                    red for Wisdom and General Letters, green for Major Prophets and Early Church,
                    gold for Minor Prophets and the Gospels.
                  </p>
                </BuilderSection>

                <BuilderSection label="Selection">
                  {selectedChapter ? (
                    <div className="flex flex-col gap-2 rounded-lg border border-white/10 bg-white/[0.03] p-3">
                      <div className="flex items-start justify-between">
                        <p className="text-[10px] uppercase tracking-widest text-white/30">Selected</p>
                        <button onClick={handleClose}
                                className="text-xs text-white/20 transition-colors hover:text-white/50">✕</button>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-white/80">
                          {selectedChapter.bookName} {selectedChapter.chapterNumber}
                        </p>
                        <p className="mt-0.5 text-xs text-white/35">
                          {selectedVerses} verses · {selectedChapter.divisionName}
                        </p>
                      </div>
                      <button onClick={handleDeassign}
                              className="text-left text-xs text-red-400/50 transition-colors hover:text-red-400/80">
                        Remove assignment
                      </button>
                      <button onClick={() => selectedChapterIndex !== undefined && handleArmReassign(selectedChapterIndex)}
                              className="text-left text-xs text-amber-200/55 transition-colors hover:text-amber-100">
                        Move assignment
                      </button>
                    </div>
                  ) : armedChapter ? (
                    <div className="flex flex-col gap-2 rounded-lg border border-amber-400/18 bg-amber-500/[0.07] p-3">
                      <div className="flex items-start justify-between">
                        <p className="text-[10px] uppercase tracking-widest text-amber-100/65">Reassigning</p>
                        <button onClick={handleClose}
                                className="text-xs text-amber-100/35 transition-colors hover:text-amber-100/70">✕</button>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-amber-50">
                          {armedChapter.bookName} {armedChapter.chapterNumber}
                        </p>
                        <p className="mt-0.5 text-xs text-amber-100/55">
                          {armedVerses} verses · click an amber star to move this chapter
                        </p>
                      </div>
                      <button onClick={handleClose}
                              className="text-left text-xs text-amber-100/55 transition-colors hover:text-amber-100/85">
                        Cancel move
                      </button>
                    </div>
                  ) : selectedMarkerStar ? (
                    <div className="flex flex-col gap-2 rounded-lg border border-amber-400/18 bg-amber-500/[0.07] p-3">
                      <div className="flex items-start justify-between">
                        <p className="text-[10px] uppercase tracking-widest text-amber-100/65">Target Star</p>
                        <button onClick={handleClose}
                                className="text-xs text-amber-100/35 transition-colors hover:text-amber-100/70">✕</button>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-amber-50">
                          Unassigned Star #{selectedMarkerStar.id}
                        </p>
                        <p className="mt-0.5 text-xs text-amber-100/55">
                          Magnitude {selectedMarkerStar.magnitude.toFixed(2)} · chapter picker open
                        </p>
                      </div>
                      <p className="text-[10px] leading-relaxed text-amber-100/48">
                        Type a reference such as `Gen 1`, `Ps 23`, or `Rom 8` in the floating picker to place a chapter here.
                      </p>
                      <button onClick={handleClose}
                              className="text-left text-xs text-amber-100/55 transition-colors hover:text-amber-100/85">
                        Clear selection
                      </button>
                    </div>
                  ) : (
                    <p className="text-[10px] leading-relaxed text-white/20">
                      Click an amber star to assign a chapter. Click a white star to inspect or remove its assignment.
                    </p>
                  )}
                </BuilderSection>

                {totalAssigned > 0 && (
                  <BuilderSection label="Assigned Chapters">
                    <AssignedChaptersList
                      session={session!}
                      verseCounts={VERSE_COUNTS}
                      onFlyTo={handleFlyToChapter}
                      onDeassign={handleDeassignByIndex}
                      onArmReassign={handleArmReassign}
                      armedChapterIndex={armedChapterIndex}
                    />
                  </BuilderSection>
                )}

                <BuilderSection label="Persistence">
                  <p className="text-[10px] leading-relaxed text-white/24">
                    Your assignment session autosaves in this browser. Export the session file when you are ready to continue into Refine.
                  </p>
                  <div className="rounded-md border border-white/8 bg-white/[0.03] px-2.5 py-2">
                    <p className="text-[10px] uppercase tracking-widest text-white/22">Status</p>
                    <p className="mt-1 text-xs text-white/52">{sessionStatus}</p>
                    {lastSavedLabel && (
                      <p className="mt-1 text-[10px] text-white/28">Last autosave: {lastSavedLabel}</p>
                    )}
                  </div>
                  <button
                    onClick={() => session && exportSession(session)}
                    className="text-left text-xs text-white/45 transition-colors hover:text-white/70"
                  >
                    Download session file
                  </button>
                  <FileInput label="Resume session" filename="skymap-session.json"
                             onChange={handleImportSession} />
                  <FileInput label="Load new sky field" filename="skyfield.json"
                             onChange={handleImportSkyField} />
                </BuilderSection>

                <BuilderSection label="Export">
                  <button
                    onClick={() => {
                      if (session) {
                        const { arrangement: arr } = buildAssignedSceneShared(session);
                        downloadJson(arr, "arrangement.json");
                      }
                    }}
                    className="text-left text-xs text-white/45 transition-colors hover:text-white/70"
                  >
                    arrangement.json
                  </button>
                  <button
                    onClick={() => session && exportAssignments(session)}
                    className="text-left text-xs text-white/45 transition-colors hover:text-white/70"
                  >
                    Assignments JSON
                  </button>
                </BuilderSection>
              </>
            )
          )}

        </>
      }
    >
      <div
        ref={containerRef}
        className="relative h-full"
        onPointerDown={e => { lastPointerRef.current = { x: e.clientX, y: e.clientY }; }}
      >
        {activeTab === "assign" && hasSkyField ? (
          <>
            <canvas
              ref={canvasRef}
              className="h-full w-full cursor-grab active:cursor-grabbing"
              onPointerDown={handleCanvasPointerDown}
              onPointerMove={handleCanvasPointerMove}
              onPointerUp={handleCanvasPointerUp}
              onPointerLeave={() => { isDraggingRef.current = false; }}
              onWheel={handleCanvasWheel}
              onDoubleClick={handleCanvasDoubleClick}
            />
            <div className="pointer-events-none absolute bottom-5 left-5 rounded-md border border-white/10 bg-[#0b0f1a]/88 px-3 py-2">
              <p className="text-[10px] uppercase tracking-[0.24em] text-white/28">Sky Controls</p>
              <p className="mt-1 text-xs text-white/52">
                Drag to pan. Shift-drag to spin. Scroll to zoom. Double-click to reset.
              </p>
              <p className="mt-1 text-[10px] text-white/34">
                Chapter labels appear from {ASSIGNED_LABEL_ZOOM_THRESHOLD.toFixed(2)}× zoom.
              </p>
            </div>
          </>
        ) : config ? (
          <StarMap
            ref={mapRef}
            config={config}
            className="h-full w-full"
            onArrangementChange={undefined}
          />
        ) : (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <p className="text-sm text-white/10">{emptyHint(activeTab)}</p>
          </div>
        )}

        {activeTab === "assign" && selectedMarkerStar && popupAnchor && (
          <>
            <div
              className="pointer-events-none absolute z-30 rounded-full border border-amber-300/65 bg-amber-300/10 shadow-[0_0_0_1px_rgba(253,230,138,0.08),0_0_24px_rgba(251,191,36,0.22)]"
              style={{
                left: popupAnchor.x - 15,
                top: popupAnchor.y - 15,
                width: 30,
                height: 30,
              }}
            />
            <div className="pointer-events-none absolute left-5 top-5 z-30 rounded-md border border-amber-400/18 bg-[#100d08]/90 px-3 py-2">
              <p className="text-[10px] uppercase tracking-[0.24em] text-amber-100/45">Assigning</p>
              <p className="mt-1 text-sm text-amber-50">Star #{selectedMarkerStar.id}</p>
              <p className="text-[10px] text-amber-100/45">Choose a chapter in the floating picker</p>
            </div>
          </>
        )}

        {activeTab === "assign" && armedChapter && !selectedMarkerStar && (
          <div className="pointer-events-none absolute left-5 top-5 z-30 rounded-md border border-amber-400/18 bg-[#100d08]/90 px-3 py-2">
            <p className="text-[10px] uppercase tracking-[0.24em] text-amber-100/45">Move Assignment</p>
            <p className="mt-1 text-sm text-amber-50">{armedChapter.bookName} {armedChapter.chapterNumber}</p>
            <p className="text-[10px] text-amber-100/45">Click an amber star to place it</p>
          </div>
        )}

        {activeTab === "assign" && popupAnchor && selectedMarkerStarId !== null && (
          <>
            <div className="absolute inset-0 z-40" style={{ pointerEvents: "auto" }} onClick={handleClose} />
            <AssignPopup
              anchor={popupAnchor}
              containerRef={containerRef}
              verseCounts={VERSE_COUNTS}
              assignedChapters={assignedChapters}
              onAssign={handleAssign}
              onClose={handleClose}
            />
          </>
        )}
      </div>
    </BuilderWorkspace>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emptyHint(tab: Tab): string {
  if (tab === "view")   return "load an arrangement.json to view";
  return "load a sky field to begin assigning";
}

// ---------------------------------------------------------------------------
// FileInput
// ---------------------------------------------------------------------------

function FileInput({ label, filename, onChange }: {
  label:    string;
  filename: string;
  onChange: (file: File) => void;
}) {
  return (
    <label className="flex flex-col gap-1 cursor-pointer">
      <span className="text-[10px] uppercase tracking-widest text-white/30">{label}</span>
      <div className="text-xs text-white/55 bg-white/5 border border-white/10 rounded
                      px-3 py-2 hover:bg-white/8 transition-colors text-center">
        {filename}
      </div>
      <input type="file" accept=".json" className="hidden"
        onChange={e => {
          const f = e.target.files?.[0];
          if (f) onChange(f);
          e.currentTarget.value = "";
        }} />
    </label>
  );
}

// ---------------------------------------------------------------------------
// AssignedChaptersList — scrollable, searchable list of placed chapters
// ---------------------------------------------------------------------------

function AssignedChaptersList({
  session, verseCounts, onFlyTo, onDeassign, onArmReassign, armedChapterIndex,
}: {
  session:    Session;
  verseCounts: number[];
  onFlyTo:    (chapterGlobalIndex: number) => void;
  onDeassign: (chapterGlobalIndex: number) => void;
  onArmReassign: (chapterGlobalIndex: number) => void;
  armedChapterIndex: number | null;
}) {
  const [search,            setSearch]            = useState("");
  const [confirmingRemoval, setConfirmingRemoval] = useState<number | null>(null);

  const chapters = useMemo(() => {
    return Object.keys(session.assignments)
      .map(k => CANON[Number(k)])
      .filter((ch): ch is NonNullable<typeof ch> => ch !== undefined)
      .sort((a, b) => a.globalIndex - b.globalIndex);
  }, [session.assignments]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return chapters;
    return chapters.filter(ch =>
      ch.bookName.toLowerCase().includes(q) ||
      ch.bookKey.toLowerCase().startsWith(q) ||
      ch.divisionName.toLowerCase().includes(q) ||
      ch.testament.toLowerCase().includes(q) ||
      String(ch.chapterNumber).startsWith(q) ||
      `${ch.bookName} ${ch.chapterNumber}`.toLowerCase().includes(q),
    );
  }, [chapters, search]);

  const grouped = useMemo(() => {
    const groups: Array<{
      bookKey: string;
      bookName: string;
      divisionName: string;
      testament: "Old" | "New";
      chapterCount: number;
      assignedCount: number;
      chapters: typeof filtered;
    }> = [];

    for (const chapter of filtered) {
      const lastGroup = groups[groups.length - 1];
      if (!lastGroup || lastGroup.bookKey !== chapter.bookKey) {
        groups.push({
          bookKey: chapter.bookKey,
          bookName: chapter.bookName,
          divisionName: chapter.divisionName,
          testament: chapter.testament,
          chapterCount: chapter.bookTotal,
          assignedCount: 1,
          chapters: [chapter],
        });
        continue;
      }

      lastGroup.chapters.push(chapter);
      lastGroup.assignedCount += 1;
    }

    return groups;
  }, [filtered]);

  const firstAssigned = chapters[0];
  const lastAssigned = chapters[chapters.length - 1];

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <p className="text-[10px] uppercase tracking-widest text-white/25">Chapters</p>
        <span className="text-[10px] text-white/20 tabular-nums">{chapters.length}</span>
      </div>
      {firstAssigned && lastAssigned && (
        <div className="rounded-md border border-white/8 bg-white/[0.03] px-2.5 py-2">
          <div className="flex items-center justify-between text-[10px] uppercase tracking-widest text-white/22">
            <span>Canon span</span>
            <span>{grouped.length} books</span>
          </div>
          <div className="mt-1 flex items-center justify-between gap-3 text-xs text-white/52">
            <span className="truncate">{firstAssigned.bookName} {firstAssigned.chapterNumber}</span>
            <span className="text-white/18">to</span>
            <span className="truncate text-right">{lastAssigned.bookName} {lastAssigned.chapterNumber}</span>
          </div>
        </div>
      )}
      <input
        type="text"
        placeholder="Search testament, division, book, or ref…"
        value={search}
        onChange={e => setSearch(e.target.value)}
        className="bg-white/5 border border-white/10 rounded px-2 py-1.5 text-xs
                   text-white/70 outline-none placeholder:text-white/20 w-full"
      />
      <div className="flex flex-col gap-0.5 overflow-y-auto" style={{ maxHeight: 192 }}>
        {grouped.map(group => (
          <div key={group.bookKey} className="rounded-md border border-white/8 bg-white/[0.02]">
            <div className="flex items-start justify-between gap-3 border-b border-white/6 px-2.5 py-2">
              <div className="min-w-0">
                <p className="truncate text-xs font-medium text-white/70">{group.bookName}</p>
                <p className="truncate text-[10px] uppercase tracking-widest text-white/22">
                  {group.testament} · {group.divisionName}
                </p>
              </div>
              <div className="text-right text-[10px] tabular-nums text-white/24">
                <p>{group.assignedCount}/{group.chapterCount}</p>
                <p>assigned</p>
              </div>
            </div>

            <div className="flex flex-col gap-0.5 p-1">
              {group.chapters.map(ch => (
                <div key={ch.globalIndex}>
                  {confirmingRemoval === ch.globalIndex ? (
                    <div className="flex items-center gap-1.5 rounded px-2 py-1.5
                                    border border-red-500/15 bg-red-500/8">
                      <span className="min-w-0 flex-1 truncate text-xs text-white/40">
                        {ch.bookName} {ch.chapterNumber}
                      </span>
                      <span className="flex-shrink-0 text-[10px] text-white/35">Remove?</span>
                      <button
                        onClick={() => { onDeassign(ch.globalIndex); setConfirmingRemoval(null); }}
                        className="flex-shrink-0 px-0.5 text-[10px] font-medium text-red-400/70 transition-colors hover:text-red-400"
                      >
                        Yes
                      </button>
                      <button
                        onClick={() => setConfirmingRemoval(null)}
                        className="flex-shrink-0 px-0.5 text-[10px] text-white/30 transition-colors hover:text-white/60"
                      >
                        No
                      </button>
                    </div>
                  ) : (
                    <div
                      className={`group flex items-center justify-between rounded px-2 py-1 transition-colors cursor-pointer ${
                        armedChapterIndex === ch.globalIndex ? "bg-amber-500/[0.10]" : "hover:bg-white/5"
                      }`}
                      onClick={() => onFlyTo(ch.globalIndex)}
                    >
                      <div className="min-w-0 flex-1">
                        <p className={`truncate text-xs transition-colors ${
                          armedChapterIndex === ch.globalIndex
                            ? "text-amber-50"
                            : "text-white/55 group-hover:text-white/80"
                        }`}>
                          {ch.bookName} {ch.chapterNumber}
                        </p>
                        <p className={`text-[10px] tabular-nums ${
                          armedChapterIndex === ch.globalIndex ? "text-amber-100/50" : "text-white/20"
                        }`}>
                          Canon #{String(ch.globalIndex + 1).padStart(4, "0")}
                        </p>
                      </div>
                      <div className="ml-2 flex flex-shrink-0 items-center gap-1.5">
                        <span className="text-[10px] tabular-nums text-white/20">
                          {verseCounts[ch.globalIndex]}v
                        </span>
                        <button
                          onClick={e => { e.stopPropagation(); onArmReassign(ch.globalIndex); }}
                          className={`px-1 text-[10px] uppercase tracking-widest transition-colors ${
                            armedChapterIndex === ch.globalIndex
                              ? "text-amber-100/75"
                              : "text-white/22 hover:text-amber-100/70"
                          }`}
                          aria-label={`Move ${ch.bookName} ${ch.chapterNumber}`}
                        >
                          Move
                        </button>
                        <button
                          onClick={e => { e.stopPropagation(); setConfirmingRemoval(ch.globalIndex); }}
                          className="w-3.5 text-center text-[11px] leading-none text-transparent transition-colors group-hover:text-white/25 hover:!text-white/65"
                          aria-label={`Remove ${ch.bookName} ${ch.chapterNumber}`}
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <p className="text-[10px] text-white/20 px-2 py-1">No matches</p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AssignPopup — floating command-palette style chapter picker
// ---------------------------------------------------------------------------

function AssignPopup({
  anchor, containerRef, verseCounts, assignedChapters, onAssign, onClose,
}: {
  anchor:            { x: number; y: number };
  containerRef:      React.RefObject<HTMLDivElement | null>;
  verseCounts:       number[];
  assignedChapters:  Set<number>;
  onAssign:          (globalIndex: number) => void;
  onClose:           () => void;
}) {
  const [query,       setQuery]       = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const results = useMemo(() => parseChapterQuery(query), [query]);

  // Reset highlight when result list changes
  useEffect(() => { setSelectedIdx(0); }, [results.length]);

  // Position: right of click, clamped to container bounds
  const style = useMemo(() => {
    const W    = containerRef.current?.clientWidth  ?? 1200;
    const H    = containerRef.current?.clientHeight ?? 800;
    const popW = 256;
    let left   = anchor.x + 20;
    let top    = anchor.y - 16;
    if (left + popW > W - 8) left = anchor.x - popW - 20;
    if (left < 8)             left = 8;
    if (top  < 8)             top  = 8;
    if (top  > H - 56)        top  = H - 56;
    return { left, top, width: popW };
  }, [anchor, containerRef]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") { onClose(); return; }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIdx(i => Math.min(i + 1, results.length - 1));
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIdx(i => Math.max(i - 1, 0));
    }
    if (e.key === "Enter") {
      const ch = results[selectedIdx];
      if (ch) onAssign(ch.globalIndex);
    }
  };

  return (
    <div
      className="absolute z-50 flex flex-col rounded-lg border border-white/15 shadow-2xl overflow-hidden"
      style={{ ...style, background: "#0c0f1a" }}
    >
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={e => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Gen 1, Ps 23, Rev 3…"
        className="px-3 py-2.5 text-sm text-white/80 bg-transparent border-b border-white/10
                   outline-none placeholder:text-white/25 w-full"
      />

      {results.length > 0 ? (
        <div className="flex flex-col py-1 overflow-y-auto" style={{ maxHeight: 240 }}>
          {results.map((ch, idx) => {
            const isAssigned = assignedChapters.has(ch.globalIndex);
            return (
              <button
                key={ch.globalIndex}
                onMouseEnter={() => setSelectedIdx(idx)}
                onClick={() => onAssign(ch.globalIndex)}
                className={`flex items-center justify-between px-3 py-1.5 text-left transition-colors ${
                  idx === selectedIdx ? "bg-white/10" : "hover:bg-white/5"
                }`}
              >
                <span className={`text-sm ${isAssigned ? "text-white/35" : "text-white/80"}`}>
                  {ch.bookName} {ch.chapterNumber}
                </span>
                <span className="flex items-center gap-2 text-[10px] tabular-nums ml-3">
                  {isAssigned && (
                    <span className="text-amber-500/50">assigned</span>
                  )}
                  <span className="text-white/25">{verseCounts[ch.globalIndex]}v</span>
                </span>
              </button>
            );
          })}
        </div>
      ) : query.length > 0 ? (
        <p className="px-3 py-2.5 text-xs text-white/25">No match</p>
      ) : (
        <p className="px-3 py-2.5 text-xs text-white/20">type a book or reference</p>
      )}
    </div>
  );
}
