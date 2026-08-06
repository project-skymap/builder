"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { DEFAULT_SKY_PARAMS } from "@project-skymap/library";
import type { ConstellationConfig, SkyField, StarArrangement, StarOutput } from "@project-skymap/library";
import type { Session } from "../assign/session";
import { importSession } from "../assign/session";
import { CANON, BOOKS } from "../assign/canon";
import bibleRaw from "../../public/bible.json";
import defaultArrangement from "../arrangement.json";
import { BuilderSection, BuilderWorkspace } from "../components/BuilderWorkspace";
import { ARRANGEMENT_RADIUS, buildArrangementPositionFromStar, getDefaultVisibilityHorizonGuide, syncSkyStarToHemisphere, chapterNodeToGlobalIndex } from "../skymap/shared";
import { loadPipelineArrangement, savePipelineArrangement } from "../skymap/pipeline";
import {
  artworkTangentFrame,
  bookKeyFromConstellation,
  centerToMapPoint,
  domeVecToMapPoint,
  normalizeVec2,
  type Vec2,
} from "../skymap/artworkProjection";

const STORAGE_KEY = "skymap-refine-session";
const BUILDER_BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const SKY_FIELD_RENDER_RADIUS = 1.25;
const SKY_FIELD_FADE_START = SKY_FIELD_RENDER_RADIUS * 0.88;
const TRIANGULATION_MAX_EDGE_FACTOR = 2.35;
const STAR_DRAG_HIT_RADIUS = 12;
const EDGE_HIT_RADIUS = 10;
const DEFAULT_VISIBILITY_HORIZON_GUIDE = getDefaultVisibilityHorizonGuide();

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
const MAX_VERSE_COUNT = Math.max(...VERSE_COUNTS);

type TriPoint = {
  id: string;
  x: number;
  y: number;
};

type TriEdge = {
  a: string;
  b: string;
};

type BookPoint = {
  chapterGlobalIndex: number;
  starId: number;
  x: number;
  y: number;
  magnitude: number;
  verseCount: number;
};

type BookGeometry = {
  bookKey: string;
  bookName: string;
  divisionName: string;
  testament: "Old" | "New";
  chapterCount: number;
  points: BookPoint[];
  edges: Array<{ a: BookPoint; b: BookPoint }>;
  centroid: { x: number; y: number };
};

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

function centroidForBook(book: BookGeometry): Vec2 {
  return book.centroid;
}

function clampToSkyRadius(x: number, y: number): { x: number; y: number } {
  const r = Math.hypot(x, y);
  if (r <= SKY_FIELD_RENDER_RADIUS || r === 0) return { x, y };
  const scale = SKY_FIELD_RENDER_RADIUS / r;
  return { x: x * scale, y: y * scale };
}

function syncStarPosition(star: StarOutput, x: number, y: number): StarOutput {
  const clamped = clampToSkyRadius(x, y);
  return syncSkyStarToHemisphere({
    ...star,
    x: clamped.x,
    y: clamped.y,
  });
}

function saveRefineSession(session: Session): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Ignore storage quota issues.
  }
}

function loadRefineSession(): Session | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Session;
    if (!data?.skyField?.stars || !Array.isArray(data.skyField.stars)) return null;
    return data;
  } catch {
    return null;
  }
}

function publicAssetPath(path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${BUILDER_BASE_PATH}${normalizedPath}`;
}

function downloadJson(data: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function exportRefineSession(session: Session): void {
  downloadJson(session, "skymap-refine-session.json");
}

function buildArrangement(session: Session): StarArrangement {
  const arrangement: StarArrangement = {};
  for (const [chapterKey, starId] of Object.entries(session.assignments)) {
    const chapter = CANON[Number(chapterKey)];
    const star = session.skyField.stars[starId];
    if (!chapter || !star) continue;
    arrangement[`C:${chapter.bookKey}:${chapter.chapterNumber}`] = {
      position: buildArrangementPositionFromStar(star),
    };
  }
  return arrangement;
}

function buildRefineSessionFromArrangement(arrangement: StarArrangement): Session {
  const stars: StarOutput[] = [];
  const assignments: Record<number, number> = {};

  const entries = Object.entries(arrangement)
    .map(([chapterId, entry]) => {
      const chapterGlobalIndex = chapterNodeToGlobalIndex(chapterId);
      return chapterGlobalIndex === undefined || !entry.position ? null : { chapterId, entry, chapterGlobalIndex };
    })
    .filter((entry): entry is { chapterId: string; entry: StarArrangement[string]; chapterGlobalIndex: number } => entry !== null)
    .sort((a, b) => a.chapterGlobalIndex - b.chapterGlobalIndex);

  for (const item of entries) {
    const position = item.entry.position!;
    const x = -position[0] / ARRANGEMENT_RADIUS;
    const y = position[2] / ARRANGEMENT_RADIUS;
    const starId = stars.length;
    stars.push(syncSkyStarToHemisphere({
      id: starId,
      x,
      y,
      x3: position[0] / ARRANGEMENT_RADIUS,
      y3: position[1] / ARRANGEMENT_RADIUS,
      z3: position[2] / ARRANGEMENT_RADIUS,
      magnitude: 3.2,
    }));
    assignments[item.chapterGlobalIndex] = starId;
  }

  const skyField: SkyField = {
    version: 2,
    params: DEFAULT_SKY_PARAMS,
    stars,
    metrics: {
      clusterDominanceScore: 0,
      nearestNeighbourCV: 0,
      maxVoidRadius: 0,
      edgeGradientRatio: 0,
    },
  };

  return { skyField, assignments, cursor: entries.length, undoStack: entries.map((entry) => entry.chapterGlobalIndex), bookArchetypes: {}, snapshots: [] };
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

  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
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

  let triangles = [{ a: superA, b: superB, c: superC }];

  for (const point of points) {
    const bad = triangles.filter((triangle) =>
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

    triangles = triangles.filter((triangle) => !bad.includes(triangle));

    for (const edge of polygon.values()) {
      if (edge.count !== 1) continue;
      triangles.push({ a: edge.a, b: edge.b, c: point });
    }
  }

  const superIds = new Set([superA.id, superB.id, superC.id]);
  const edges = new Map<string, TriEdge>();

  for (const triangle of triangles) {
    const ids = [triangle.a.id, triangle.b.id, triangle.c.id];
    if (ids.some((id) => superIds.has(id))) continue;
    const pairs = [
      [triangle.a.id, triangle.b.id],
      [triangle.b.id, triangle.c.id],
      [triangle.c.id, triangle.a.id],
    ] as const;
    for (const [a, b] of pairs) edges.set(triangulationKey(a, b), { a, b });
  }

  return [...edges.values()];
}

function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  if (dx === 0 && dy === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  const sx = ax + dx * t;
  const sy = ay + dy * t;
  return Math.hypot(px - sx, py - sy);
}

function getBookGeometry(session: Session | null): BookGeometry[] {
  if (!session) return [];

  const books = new Map<string, BookGeometry>();
  for (const [chapterKey, starId] of Object.entries(session.assignments)) {
    const chapterGlobalIndex = Number(chapterKey);
    const chapter = CANON[chapterGlobalIndex];
    const star = session.skyField.stars[starId];
    if (!chapter || !star) continue;

    let book = books.get(chapter.bookKey);
    if (!book) {
      book = {
        bookKey: chapter.bookKey,
        bookName: chapter.bookName,
        divisionName: chapter.divisionName,
        testament: chapter.testament,
        chapterCount: chapter.bookTotal,
        points: [],
        edges: [],
        centroid: { x: 0, y: 0 },
      };
      books.set(chapter.bookKey, book);
    }

    book.points.push({
      chapterGlobalIndex,
      starId,
      x: star.x,
      y: star.y,
      magnitude: star.magnitude,
      verseCount: VERSE_COUNTS[chapterGlobalIndex] ?? 1,
    });
  }

  return [...books.values()].map((book) => {
    const centroid = book.points.length > 0
      ? {
          x: book.points.reduce((sum, point) => sum + point.x, 0) / book.points.length,
          y: book.points.reduce((sum, point) => sum + point.y, 0) / book.points.length,
        }
      : { x: 0, y: 0 };
    const pointMap = new Map<string, BookPoint>(book.points.map((point) => [`${point.chapterGlobalIndex}`, point]));
    const edgesRaw = book.points.length === 2
      ? [{ a: `${book.points[0]!.chapterGlobalIndex}`, b: `${book.points[1]!.chapterGlobalIndex}` }]
      : bowyerWatson(book.points.map((point) => ({
          id: `${point.chapterGlobalIndex}`,
          x: point.x,
          y: point.y,
        })));

    const lengths = edgesRaw.map((edge) => {
      const a = pointMap.get(edge.a);
      const b = pointMap.get(edge.b);
      if (!a || !b) return Infinity;
      return Math.hypot(a.x - b.x, a.y - b.y);
    }).filter(Number.isFinite);

    const averageLength = lengths.length > 0
      ? lengths.reduce((sum, value) => sum + value, 0) / lengths.length
      : 0;
    const maxLength = averageLength > 0 ? averageLength * TRIANGULATION_MAX_EDGE_FACTOR : Infinity;
    const edges = edgesRaw
      .map((edge) => {
        const a = pointMap.get(edge.a);
        const b = pointMap.get(edge.b);
        if (!a || !b) return null;
        const length = Math.hypot(a.x - b.x, a.y - b.y);
        if (length > maxLength) return null;
        return { a, b };
      })
      .filter((edge): edge is { a: BookPoint; b: BookPoint } => edge !== null);

    return { ...book, centroid, edges };
  });
}

function updateStarInSession(session: Session, starId: number, x: number, y: number): Session {
  const nextStars = [...session.skyField.stars];
  const star = nextStars[starId];
  if (!star) return session;
  nextStars[starId] = syncStarPosition(star, x, y);
  return {
    ...session,
    skyField: {
      ...session.skyField,
      stars: nextStars,
    },
  };
}

function translateBookInSession(session: Session, bookKey: string, dx: number, dy: number): Session {
  let nextSession = session;
  for (const [chapterKey, starId] of Object.entries(session.assignments)) {
    const chapter = CANON[Number(chapterKey)];
    if (!chapter || chapter.bookKey !== bookKey) continue;
    const star = nextSession.skyField.stars[starId];
    if (!star) continue;
    nextSession = updateStarInSession(nextSession, starId, star.x + dx, star.y + dy);
  }
  return nextSession;
}

function rotateBookInSession(session: Session, bookKey: string, radians: number): Session {
  const points: Array<{ starId: number; x: number; y: number }> = [];
  for (const [chapterKey, starId] of Object.entries(session.assignments)) {
    const chapter = CANON[Number(chapterKey)];
    const star = session.skyField.stars[starId];
    if (!chapter || chapter.bookKey !== bookKey || !star) continue;
    points.push({ starId, x: star.x, y: star.y });
  }
  if (points.length === 0) return session;

  const centroid = {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  };
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);

  let nextSession = session;
  for (const point of points) {
    const relX = point.x - centroid.x;
    const relY = point.y - centroid.y;
    const x = centroid.x + relX * cos - relY * sin;
    const y = centroid.y + relX * sin + relY * cos;
    nextSession = updateStarInSession(nextSession, point.starId, x, y);
  }
  return nextSession;
}

function resetView(
  zoomRef: React.MutableRefObject<number>,
  panRef: React.MutableRefObject<{ x: number; y: number }>,
  spinRef: React.MutableRefObject<number>,
): void {
  zoomRef.current = 1;
  panRef.current = { x: 0, y: 0 };
  spinRef.current = 0;
}

export default function RefinePage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<number>(0);
  const zoomRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });
  const spinRef = useRef(0);
  const hitStarsRef = useRef<Array<{ starId: number; x: number; y: number; r: number }>>([]);
  const hitEdgesRef = useRef<Array<{ bookKey: string; ax: number; ay: number; bx: number; by: number }>>([]);
  const imagesRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const dragRef = useRef<
    | { type: "none" }
    | { type: "pan" | "spin"; lastX: number; lastY: number }
    | { type: "star"; starId: number }
    | { type: "book"; bookKey: string; lastWorld: { x: number; y: number } | null }
  >({ type: "none" });

  const [session, setSession] = useState<Session | null>(null);
  const [sessionStatus, setSessionStatus] = useState("No refine session loaded yet.");
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [selectedStarId, setSelectedStarId] = useState<number | null>(null);
  const [selectedBookKey, setSelectedBookKey] = useState<string | null>(null);
  const [showBookTriangulation, setShowBookTriangulation] = useState(true);
  const [showVisibilityGuides, setShowVisibilityGuides] = useState(true);
  const [showConstellationArtwork, setShowConstellationArtwork] = useState(true);
  const [constellationConfig, setConstellationConfig] = useState<ConstellationConfig | null>(null);
  const [availableArtworkCount, setAvailableArtworkCount] = useState(0);

  useEffect(() => {
    const arrangement = loadPipelineArrangement();
    if (arrangement) {
      setSession(buildRefineSessionFromArrangement(arrangement));
      setSessionStatus("Restored arrangement.json from the Builder pipeline.");
      return;
    }
    const bundledArrangement = defaultArrangement as unknown as StarArrangement;
    if (Object.keys(bundledArrangement).length > 0) {
      setSession(buildRefineSessionFromArrangement(bundledArrangement));
      setSessionStatus("Loaded bundled arrangement.json from the codebase.");
      return;
    }
    const saved = loadRefineSession();
    setSession(saved);
    setSessionStatus(saved ? "Restored legacy refine session from this browser." : "Load an arrangement.json exported from Assign or Curate.");
  }, []);

  useEffect(() => {
    fetch(publicAssetPath("/constellations.json"))
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((data: ConstellationConfig) => {
        if (data?.version && Array.isArray(data.constellations)) setConstellationConfig(data);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!constellationConfig) return;
    let cancelled = false;
    const basePath = constellationConfig.atlasBasePath.replace(/\/$/, "");
    let loadedCount = 0;
    setAvailableArtworkCount(0);
    for (const item of constellationConfig.constellations) {
      const src = publicAssetPath(`${basePath}/${item.image}`);
      if (imagesRef.current.has(src)) continue;
      const image = new Image();
      image.onload = () => {
        if (cancelled) return;
        loadedCount += 1;
        setAvailableArtworkCount(loadedCount);
      };
      image.src = src;
      imagesRef.current.set(src, image);
    }
    return () => { cancelled = true; };
  }, [constellationConfig]);

  useEffect(() => {
    if (!session) return;
    saveRefineSession(session);
    savePipelineArrangement(buildArrangement(session));
    setLastSavedAt(Date.now());
    setSessionStatus("Autosaved refined arrangement in this browser.");
  }, [session]);

  const books = useMemo(() => getBookGeometry(session), [session]);
  const selectedBook = useMemo(
    () => books.find((book) => book.bookKey === selectedBookKey) ?? null,
    [books, selectedBookKey],
  );
  const selectedStar = useMemo(() => {
    if (selectedStarId === null || !session) return null;
    const chapterGlobalIndex = Number(
      Object.entries(session.assignments).find(([, starId]) => starId === selectedStarId)?.[0] ?? -1,
    );
    const chapter = CANON[chapterGlobalIndex];
    const star = session.skyField.stars[selectedStarId];
    if (!chapter || !star) return null;
    return { chapter, star, verseCount: VERSE_COUNTS[chapterGlobalIndex] ?? 1 };
  }, [selectedStarId, session]);

  const assignedCount = Object.keys(session?.assignments ?? {}).length;
  const arrangementCount = assignedCount;
  const lastSavedLabel = lastSavedAt !== null
    ? new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(lastSavedAt)
    : null;

  const toWorldPoint = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const baseRadius = Math.min(width, height) / 2 - 12;
    const radius = baseRadius * zoomRef.current;
    const scx = width / 2 + panRef.current.x;
    const scy = height / 2 + panRef.current.y;
    const rx = ((x - scx) / radius) * SKY_FIELD_RENDER_RADIUS;
    const rz = ((y - scy) / radius) * SKY_FIELD_RENDER_RADIUS;
    const cos = Math.cos(spinRef.current);
    const sin = Math.sin(spinRef.current);
    return {
      x: rx * cos - rz * sin,
      y: rx * sin + rz * cos,
    };
  }, []);

  const handleImportSession = useCallback(async (file: File) => {
    try {
      const imported = await importSession(file);
      setSession(imported);
      savePipelineArrangement(buildArrangement(imported));
      setSelectedStarId(null);
      setSelectedBookKey(null);
      setSessionStatus(`Loaded refine session from ${file.name}.`);
      resetView(zoomRef, panRef, spinRef);
    } catch {
      setSessionStatus(`Could not load ${file.name}.`);
    }
  }, []);

  const handleImportArrangement = useCallback(async (file: File) => {
    try {
      const imported = JSON.parse(await file.text()) as StarArrangement;
      const nextSession = buildRefineSessionFromArrangement(imported);
      if (nextSession.skyField.stars.length === 0) throw new Error("No chapter positions found.");
      setSession(nextSession);
      savePipelineArrangement(imported);
      setSelectedStarId(null);
      setSelectedBookKey(null);
      setSessionStatus(`Loaded arrangement from ${file.name}.`);
      resetView(zoomRef, panRef, spinRef);
    } catch {
      setSessionStatus(`Could not load ${file.name}.`);
    }
  }, []);

  const moveSelection = useCallback((dx: number, dy: number) => {
    setSession((prev) => {
      if (!prev) return prev;
      if (selectedStarId !== null) {
        const star = prev.skyField.stars[selectedStarId];
        if (!star) return prev;
        return updateStarInSession(prev, selectedStarId, star.x + dx, star.y + dy);
      }
      if (selectedBookKey) return translateBookInSession(prev, selectedBookKey, dx, dy);
      return prev;
    });
  }, [selectedBookKey, selectedStarId]);

  const rotateSelection = useCallback((radians: number) => {
    if (!selectedBookKey) return;
    setSession((prev) => (prev ? rotateBookInSession(prev, selectedBookKey, radians) : prev));
  }, [selectedBookKey]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;

      const moveStep = event.shiftKey ? 0.018 : 0.007;
      const rotateStep = event.shiftKey ? Math.PI / 24 : Math.PI / 90;

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        moveSelection(-moveStep, 0);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        moveSelection(moveStep, 0);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        moveSelection(0, -moveStep);
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        moveSelection(0, moveStep);
      } else if (event.key === "[") {
        event.preventDefault();
        rotateSelection(-rotateStep);
      } else if (event.key === "]") {
        event.preventDefault();
        rotateSelection(rotateStep);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [moveSelection, rotateSelection]);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    let bestStar: { starId: number; x: number; y: number; r: number } | null = null;
    for (const hit of hitStarsRef.current) {
      if (Math.hypot(hit.x - x, hit.y - y) <= hit.r) {
        if (!bestStar || hit.r < bestStar.r) bestStar = hit;
      }
    }
    if (bestStar) {
      const chapterKey = Object.entries(session?.assignments ?? {}).find(([, starId]) => starId === bestStar.starId)?.[0];
      const chapter = chapterKey ? CANON[Number(chapterKey)] : undefined;
      setSelectedStarId(bestStar.starId);
      setSelectedBookKey(chapter?.bookKey ?? null);
      dragRef.current = { type: "star", starId: bestStar.starId };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }

    let bestBook: { bookKey: string; distance: number } | null = null;
    for (const edge of hitEdgesRef.current) {
      const distance = distanceToSegment(x, y, edge.ax, edge.ay, edge.bx, edge.by);
      if (distance <= EDGE_HIT_RADIUS && (!bestBook || distance < bestBook.distance)) {
        bestBook = { bookKey: edge.bookKey, distance };
      }
    }
    if (bestBook) {
      setSelectedStarId(null);
      setSelectedBookKey(bestBook.bookKey);
      dragRef.current = { type: "book", bookKey: bestBook.bookKey, lastWorld: toWorldPoint(event.clientX, event.clientY) };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }

    dragRef.current = {
      type: event.shiftKey ? "spin" : "pan",
      lastX: event.clientX,
      lastY: event.clientY,
    };
    setSelectedStarId(null);
    setSelectedBookKey(null);
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [session, toWorldPoint]);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (drag.type === "none") return;

    if (drag.type === "pan" || drag.type === "spin") {
      const dx = event.clientX - drag.lastX;
      const dy = event.clientY - drag.lastY;
      drag.lastX = event.clientX;
      drag.lastY = event.clientY;
      if (drag.type === "spin") {
        spinRef.current += dx * 0.005;
      } else {
        panRef.current = { x: panRef.current.x + dx, y: panRef.current.y + dy };
      }
      return;
    }

    if (drag.type === "star") {
      const world = toWorldPoint(event.clientX, event.clientY);
      if (!world) return;
      setSession((prev) => (prev ? updateStarInSession(prev, drag.starId, world.x, world.y) : prev));
      return;
    }

    if (drag.type === "book") {
      const world = toWorldPoint(event.clientX, event.clientY);
      if (!world || !drag.lastWorld) {
        drag.lastWorld = world;
        return;
      }
      const dx = world.x - drag.lastWorld.x;
      const dy = world.y - drag.lastWorld.y;
      drag.lastWorld = world;
      setSession((prev) => (prev ? translateBookInSession(prev, drag.bookKey, dx, dy) : prev));
    }
  }, [toWorldPoint]);

  const handlePointerUp = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    dragRef.current = { type: "none" };
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const handleWheel = useCallback((event: React.WheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    const factor = event.deltaY > 0 ? 0.93 : 1.07;
    zoomRef.current = Math.max(0.35, Math.min(6, zoomRef.current * factor));
  }, []);

  const handleDoubleClick = useCallback(() => {
    resetView(zoomRef, panRef, spinRef);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !session) return;

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
      const scx = cx + panRef.current.x;
      const scy = cy + panRef.current.y;
      const cos = Math.cos(spinRef.current);
      const sin = Math.sin(spinRef.current);
      const projectPoint = (point: Vec2): Vec2 => ({
        x: scx + projectSkyCoordinate(point.x * cos + point.y * sin) * radius,
        y: scy + projectSkyCoordinate(-point.x * sin + point.y * cos) * radius,
      });

      hitStarsRef.current = [];
      hitEdgesRef.current = [];

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

      if (showConstellationArtwork && constellationConfig) {
        const itemByBookKey = new Map(constellationConfig.constellations.map((item) => [bookKeyFromConstellation(item), item]));
        const basePath = constellationConfig.atlasBasePath.replace(/\/$/, "");

        for (const book of books) {
          const item = itemByBookKey.get(book.bookKey);
          if (!item || item.radius <= 1) continue;

          const center = centerToMapPoint(item, centroidForBook(book));
          const screen = projectPoint(center);
          const src = publicAssetPath(`${basePath}/${item.image}`);
          const image = imagesRef.current.get(src);
          if (!image?.complete || image.naturalWidth <= 0) continue;

          const radiusPx = (item.radius / ARRANGEMENT_RADIUS / SKY_FIELD_RENDER_RADIUS) * radius;
          const aspect = item.aspectRatio ?? (image.naturalHeight ? image.naturalWidth / image.naturalHeight : 1);
          const widthPx = radiusPx * 2 * Math.sqrt(aspect);
          const heightPx = radiusPx * 2 / Math.sqrt(aspect);
          const frame = artworkTangentFrame(item, centroidForBook(book));
          const orientationProbe = 100;
          const rightScreen = projectPoint(domeVecToMapPoint({
            x: frame.center.x + frame.rightDir.x * orientationProbe,
            y: frame.center.y + frame.rightDir.y * orientationProbe,
            z: frame.center.z + frame.rightDir.z * orientationProbe,
          }));
          const upScreen = projectPoint(domeVecToMapPoint({
            x: frame.center.x + frame.upDir.x * orientationProbe,
            y: frame.center.y + frame.upDir.y * orientationProbe,
            z: frame.center.z + frame.upDir.z * orientationProbe,
          }));
          const imageX = normalizeVec2({ x: rightScreen.x - screen.x, y: rightScreen.y - screen.y });
          const imageY = normalizeVec2({ x: upScreen.x - screen.x, y: upScreen.y - screen.y });

          ctx.save();
          ctx.transform(imageX.x, imageX.y, imageY.x, imageY.y, screen.x, screen.y);
          ctx.globalCompositeOperation = "source-over";
          ctx.globalAlpha = book.bookKey === selectedBookKey ? 0.32 : 0.22;
          ctx.drawImage(image, -widthPx / 2, -heightPx / 2, widthPx, heightPx);
          ctx.globalCompositeOperation = "source-over";
          ctx.globalAlpha = 1;
          ctx.setLineDash([8, 6]);
          ctx.strokeStyle = book.bookKey === selectedBookKey ? "rgba(255,236,179,0.78)" : "rgba(170,190,255,0.34)";
          ctx.lineWidth = book.bookKey === selectedBookKey ? 1.6 : 1.1;
          ctx.strokeRect(-widthPx / 2, -heightPx / 2, widthPx, heightPx);
          ctx.setLineDash([]);
          ctx.restore();
        }
      }

      if (showBookTriangulation) {
        for (const book of books) {
          if (book.edges.length === 0) continue;
          const selected = book.bookKey === selectedBookKey;
          ctx.save();
          ctx.beginPath();
          for (const edge of book.edges) {
            const ax = scx + projectSkyCoordinate(edge.a.x * cos + edge.a.y * sin) * radius;
            const ay = scy + projectSkyCoordinate(-edge.a.x * sin + edge.a.y * cos) * radius;
            const bx = scx + projectSkyCoordinate(edge.b.x * cos + edge.b.y * sin) * radius;
            const by = scy + projectSkyCoordinate(-edge.b.x * sin + edge.b.y * cos) * radius;
            ctx.moveTo(ax, ay);
            ctx.lineTo(bx, by);
            hitEdgesRef.current.push({ bookKey: book.bookKey, ax, ay, bx, by });
          }
          ctx.shadowBlur = selected ? 16 : 10;
          ctx.shadowColor = selected ? "rgba(255,236,179,0.75)" : divisionTriangulationColor(book.divisionName);
          ctx.strokeStyle = selected ? "rgba(255,236,179,0.82)" : divisionTriangulationColor(book.divisionName);
          ctx.lineWidth = selected ? 2.4 : 1.5;
          ctx.stroke();
          ctx.restore();
        }
      }

      for (const book of books) {
        for (const point of book.points) {
          const projR = Math.hypot(point.x, point.y);
          const fade = projR >= SKY_FIELD_RENDER_RADIUS
            ? 0
            : projR > SKY_FIELD_FADE_START
              ? Math.max(0, (SKY_FIELD_RENDER_RADIUS - projR) / (SKY_FIELD_RENDER_RADIUS - SKY_FIELD_FADE_START))
              : 1;
          if (fade <= 0) continue;

          const rx = projectSkyCoordinate(point.x * cos + point.y * sin);
          const rz = projectSkyCoordinate(-point.x * sin + point.y * cos);
          const sx = scx + rx * radius;
          const sy = scy + rz * radius;
          const starSelected = point.starId === selectedStarId;
          const bookSelected = book.bookKey === selectedBookKey;
          const starRadius = assignedStarRadius(point.verseCount);
          const scale = assignedStarScale(point.verseCount);

          drawGeneratorStyleStar(ctx, sx, sy, point.magnitude, fade, scale);

          if (bookSelected || starSelected) {
            ctx.beginPath();
            ctx.arc(sx, sy, starRadius + (starSelected ? 6 : 4), 0, Math.PI * 2);
            ctx.strokeStyle = starSelected ? "rgba(255,255,255,0.78)" : "rgba(251,191,36,0.62)";
            ctx.lineWidth = starSelected ? 1.8 : 1.2;
            ctx.stroke();
          }

          hitStarsRef.current.push({
            starId: point.starId,
            x: sx,
            y: sy,
            r: Math.max(STAR_DRAG_HIT_RADIUS, starRadius + 6),
          });
        }
      }
    };

    draw();
    return () => cancelAnimationFrame(animRef.current);
  }, [books, constellationConfig, selectedBookKey, selectedStarId, session, showBookTriangulation, showConstellationArtwork, showVisibilityGuides]);

  return (
    <BuilderWorkspace
      route="refine"
      title="Refine"
      subtitle="Nudge chapter stars after Curate has established book artwork placement."
      sidebarWidthClass="w-80"
      sidebar={
        <>
          <p className="text-xs leading-relaxed text-white/45">
            Refine consumes the current `arrangement.json` draft and saves refined chapter positions back to that artifact.
          </p>

          {!session ? (
            <BuilderSection label="Load Arrangement">
              <p className="text-[10px] leading-relaxed text-white/20">
                Load the `arrangement.json` exported from Assign or restored from Curate to begin refining.
              </p>
              <FileInput label="Load arrangement" filename="arrangement.json" onChange={handleImportArrangement} />
              <FileInput label="Load legacy session" filename="skymap-session.json" onChange={handleImportSession} />
            </BuilderSection>
          ) : (
            <>
              <BuilderSection label="Progress">
                <div className="rounded-md border border-white/8 bg-white/[0.03] px-2.5 py-2">
                  <div className="flex items-center justify-between text-xs text-white/48">
                    <span>Assigned chapters</span>
                    <span className="tabular-nums text-white/72">{assignedCount.toLocaleString()}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between text-xs text-white/48">
                    <span>Arrangement stars</span>
                    <span className="tabular-nums text-white/72">{arrangementCount.toLocaleString()}</span>
                  </div>
                </div>
              </BuilderSection>

              <BuilderSection label="Selection">
                {selectedStar ? (
                  <div className="flex flex-col gap-2 rounded-lg border border-white/10 bg-white/[0.03] p-3">
                    <p className="text-[10px] uppercase tracking-widest text-white/30">Star</p>
                    <div>
                      <p className="text-sm font-medium text-white/82">
                        {selectedStar.chapter.bookName} {selectedStar.chapter.chapterNumber}
                      </p>
                      <p className="mt-0.5 text-xs text-white/35">
                        Star #{selectedStarId} · {selectedStar.verseCount} verses
                      </p>
                    </div>
                    <p className="text-[10px] leading-relaxed text-white/24">
                      Drag to reposition. Use arrow keys for precise nudging. Hold `Shift` for larger steps.
                    </p>
                  </div>
                ) : selectedBook ? (
                  <div className="flex flex-col gap-2 rounded-lg border border-amber-400/18 bg-amber-500/[0.07] p-3">
                    <p className="text-[10px] uppercase tracking-widest text-amber-100/65">Constellation</p>
                    <div>
                      <p className="text-sm font-medium text-amber-50">{selectedBook.bookName}</p>
                      <p className="mt-0.5 text-xs text-amber-100/55">
                        {selectedBook.points.length}/{selectedBook.chapterCount} chapters · {selectedBook.divisionName}
                      </p>
                    </div>
                    <p className="text-[10px] leading-relaxed text-amber-100/48">
                      Drag a selected line to move the whole book. Use arrow keys to nudge, and `[` / `]` to rotate around the book centre.
                    </p>
                    <div className="flex gap-2 pt-1">
                      <button
                        onClick={() => rotateSelection(-Math.PI / 90)}
                        className="rounded border border-white/10 bg-white/[0.03] px-2 py-1 text-xs text-white/55 transition-colors hover:text-white/80"
                      >
                        Rotate Left
                      </button>
                      <button
                        onClick={() => rotateSelection(Math.PI / 90)}
                        className="rounded border border-white/10 bg-white/[0.03] px-2 py-1 text-xs text-white/55 transition-colors hover:text-white/80"
                      >
                        Rotate Right
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="text-[10px] leading-relaxed text-white/20">
                    Click a star to edit a single chapter, or click a constellation line to select a whole book.
                  </p>
                )}
              </BuilderSection>

              <BuilderSection label="Canvas Controls">
                <label className="flex items-center justify-between text-xs text-white/52">
                  <span>Show visibility guide</span>
                  <input
                    type="checkbox"
                    checked={showVisibilityGuides}
                    onChange={(event) => setShowVisibilityGuides(event.target.checked)}
                    className="accent-amber-400"
                  />
                </label>
                <label className="flex items-center justify-between text-xs text-white/52">
                  <span>Show constellation art</span>
                  <input
                    type="checkbox"
                    checked={showConstellationArtwork}
                    onChange={(event) => setShowConstellationArtwork(event.target.checked)}
                    className="accent-amber-400"
                  />
                </label>
                <p className="text-[10px] leading-relaxed text-white/22">
                  Overlays curated artwork boundaries from `constellations.json` so chapter positions can be refined inside the intended book art.
                  {constellationConfig ? ` Found ${availableArtworkCount} available PNGs.` : " Public constellations.json has not loaded yet."}
                </p>
                <p className="text-[10px] leading-relaxed text-white/22">
                  Draws the default Preview horizon contour so book shapes can be refined inside the area expected to stay visible.
                </p>
                <label className="flex items-center justify-between text-xs text-white/52">
                  <span>Show book triangulation</span>
                  <input
                    type="checkbox"
                    checked={showBookTriangulation}
                    onChange={(event) => setShowBookTriangulation(event.target.checked)}
                    className="accent-amber-400"
                  />
                </label>
                <button
                  onClick={() => resetView(zoomRef, panRef, spinRef)}
                  className="text-left text-xs text-white/45 transition-colors hover:text-white/70"
                >
                  Reset view
                </button>
                <p className="text-[10px] leading-relaxed text-white/22">
                  Drag empty space to pan. Shift-drag empty space to spin. Scroll to zoom. Double-click to reset the camera.
                </p>
              </BuilderSection>

              <BuilderSection label="Persistence">
                <div className="rounded-md border border-white/8 bg-white/[0.03] px-2.5 py-2">
                  <p className="text-[10px] uppercase tracking-widest text-white/22">Status</p>
                  <p className="mt-1 text-xs text-white/52">{sessionStatus}</p>
                  {lastSavedLabel && (
                    <p className="mt-1 text-[10px] text-white/28">Last autosave: {lastSavedLabel}</p>
                  )}
                </div>
                <button
                  onClick={() => exportRefineSession(session)}
                  className="text-left text-xs text-white/45 transition-colors hover:text-white/70"
                >
                  Download legacy refine session
                </button>
                <FileInput label="Load arrangement" filename="arrangement.json" onChange={handleImportArrangement} />
                <FileInput label="Load legacy session" filename="skymap-session.json" onChange={handleImportSession} />
              </BuilderSection>

              <BuilderSection label="Export">
                <button
                  onClick={() => {
                    const arrangement = buildArrangement(session);
                    savePipelineArrangement(arrangement);
                    downloadJson(arrangement, "arrangement.json");
                  }}
                  className="text-left text-xs text-white/45 transition-colors hover:text-white/70"
                >
                  Export arrangement.json
                </button>
                <button
                  onClick={() => exportRefineSession(session)}
                  className="text-left text-xs text-white/45 transition-colors hover:text-white/70"
                >
                  Export session JSON
                </button>
                <Link href="/constellate" className="text-left text-xs text-white/45 transition-colors hover:text-white/70">
                  Open Constellate
                </Link>
              </BuilderSection>
            </>
          )}
        </>
      }
    >
      <div ref={containerRef} className="relative h-full">
        {session ? (
          <>
            <canvas
              ref={canvasRef}
              className="h-full w-full cursor-grab active:cursor-grabbing"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerLeave={() => { dragRef.current = { type: "none" }; }}
              onWheel={handleWheel}
              onDoubleClick={handleDoubleClick}
            />
            <div className="pointer-events-none absolute bottom-5 left-5 rounded-md border border-white/10 bg-[#0b0f1a]/88 px-3 py-2">
              <p className="text-[10px] uppercase tracking-[0.24em] text-white/28">Refine Controls</p>
              <p className="mt-1 text-xs text-white/52">
                Drag stars for chapter-level edits. Drag triangulation lines for whole-book moves.
              </p>
              <p className="mt-1 text-[10px] text-white/34">
                Arrow keys nudge. Shift = coarse. `[` and `]` rotate the selected book.
              </p>
            </div>
          </>
        ) : (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <p className="text-sm text-white/10">load an arrangement to begin refining</p>
          </div>
        )}
      </div>
    </BuilderWorkspace>
  );
}

function FileInput({ label, filename, onChange }: {
  label: string;
  filename: string;
  onChange: (file: File) => void;
}) {
  return (
    <label className="flex flex-col gap-1 cursor-pointer">
      <span className="text-[10px] uppercase tracking-widest text-white/30">{label}</span>
      <div className="text-xs text-white/55 bg-white/5 border border-white/10 rounded px-3 py-2 hover:bg-white/8 transition-colors text-center">
        {filename}
      </div>
      <input
        type="file"
        accept=".json"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onChange(file);
          event.currentTarget.value = "";
        }}
      />
    </label>
  );
}
