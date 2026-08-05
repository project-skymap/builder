"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ConstellationConfig, StarArrangement } from "@project-skymap/library";
import baseConstellationConfig from "../../public/constellations.json";
import { CANON } from "../assign/canon";
import { BuilderSection, BuilderWorkspace } from "../components/BuilderWorkspace";
import { ARRANGEMENT_RADIUS, VERSE_COUNTS, chapterNodeToGlobalIndex, divisionTriangulationColor } from "../skymap/shared";

const ARRANGEMENT_STORAGE_KEY = "skymap-constellate-arrangement";
const CONSTELLATION_STORAGE_KEY = "skymap-constellate-constellations";
const SKY_FIELD_RENDER_RADIUS = 1.25;

type ChapterPoint = {
  id: string;
  bookKey: string;
  bookName: string;
  divisionName: string;
  chapterNumber: number;
  x: number;
  y: number;
  position: Vec3;
  verseCount: number;
};

type BookGeometry = {
  bookKey: string;
  bookName: string;
  divisionName: string;
  chapterCount: number;
  points: ChapterPoint[];
};

type ConstellationItem = ConstellationConfig["constellations"][number];
type DragState =
  | { type: "none" }
  | { type: "pan" | "spin"; lastX: number; lastY: number }
  | { type: "art"; bookKey: string; offsetX: number; offsetY: number };

type Vec3 = {
  x: number;
  y: number;
  z: number;
};

const BASE_CONSTELLATION_CONFIG = baseConstellationConfig as unknown as ConstellationConfig;

function safeParseJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function loadStoredArrangement(): StarArrangement | null {
  if (typeof window === "undefined") return null;
  return safeParseJson<StarArrangement>(localStorage.getItem(ARRANGEMENT_STORAGE_KEY));
}

function loadStoredConstellations(): ConstellationConfig | null {
  if (typeof window === "undefined") return null;
  const data = safeParseJson<ConstellationConfig>(localStorage.getItem(CONSTELLATION_STORAGE_KEY));
  return data?.version && Array.isArray(data.constellations) ? data : null;
}

function saveStoredConstellations(config: ConstellationConfig): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(CONSTELLATION_STORAGE_KEY, JSON.stringify(config));
  } catch {
    // Ignore storage quota issues.
  }
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

function projectSkyCoordinate(value: number): number {
  return value / SKY_FIELD_RENDER_RADIUS;
}

function chapterRadius(verseCount: number): number {
  const maxVerseCount = Math.max(...VERSE_COUNTS);
  const normalized = Math.max(0, Math.min(1, verseCount / maxVerseCount));
  return 2.2 + Math.pow(normalized, 0.55) * 10.8;
}

function chapterProminence(verseCount: number): number {
  const maxVerseCount = Math.max(...VERSE_COUNTS);
  return Math.max(0, Math.min(1, verseCount / maxVerseCount));
}

function buildBookGeometry(arrangement: StarArrangement | null): BookGeometry[] {
  if (!arrangement) return [];
  const books = new Map<string, BookGeometry>();

  for (const [chapterId, entry] of Object.entries(arrangement)) {
    if (!chapterId.startsWith("C:") || !entry.position) continue;
    const chapterGlobalIndex = chapterNodeToGlobalIndex(chapterId);
    if (chapterGlobalIndex === undefined) continue;
    const chapter = CANON[chapterGlobalIndex];
    if (!chapter) continue;

    let book = books.get(chapter.bookKey);
    if (!book) {
      book = {
        bookKey: chapter.bookKey,
        bookName: chapter.bookName,
        divisionName: chapter.divisionName,
        chapterCount: chapter.bookTotal,
        points: [],
      };
      books.set(chapter.bookKey, book);
    }

    book.points.push({
      id: chapterId,
      bookKey: chapter.bookKey,
      bookName: chapter.bookName,
      divisionName: chapter.divisionName,
      chapterNumber: chapter.chapterNumber,
      x: -entry.position[0] / ARRANGEMENT_RADIUS,
      y: entry.position[2] / ARRANGEMENT_RADIUS,
      position: { x: entry.position[0], y: entry.position[1], z: entry.position[2] },
      verseCount: VERSE_COUNTS[chapterGlobalIndex] ?? 1,
    });
  }

  return [...books.values()].map((book) => ({
    ...book,
    points: book.points.sort((a, b) => a.chapterNumber - b.chapterNumber),
  }));
}

function bookKeyFromConstellation(item: ConstellationItem): string {
  return item.anchors[0]?.split(":")[1] ?? item.id;
}

function getBaseConstellationItem(bookKey: string): ConstellationItem | null {
  return BASE_CONSTELLATION_CONFIG.constellations.find((constellation) => bookKeyFromConstellation(constellation) === bookKey) ?? null;
}

function slugImageName(bookName: string): string {
  return `${bookName.toLowerCase().replace(/[^a-z0-9]+/g, "")}.png`;
}

function centroidForBook(book: BookGeometry): { x: number; y: number } {
  if (book.points.length === 0) return { x: 0, y: 0 };
  const sum = book.points.reduce((acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }), { x: 0, y: 0 });
  return { x: sum.x / book.points.length, y: sum.y / book.points.length };
}

function estimateRadiusForBook(book: BookGeometry): number {
  const center = centroidForBook(book);
  const maxDistance = book.points.reduce((max, point) => Math.max(max, Math.hypot(point.x - center.x, point.y - center.y)), 0);
  return Math.max(160, Math.min(820, (maxDistance + 0.08) * ARRANGEMENT_RADIUS));
}

function mapPointToDomeCenter(point: { x: number; y: number }): [number, number, number] {
  const radius2d = Math.hypot(point.x, point.y);
  const scale = radius2d > 0.98 ? 0.98 / radius2d : 1;
  const x = point.x * scale;
  const y = point.y * scale;
  const domeY = Math.sqrt(Math.max(0, 1 - x * x - y * y));
  return [-x * ARRANGEMENT_RADIUS, domeY * ARRANGEMENT_RADIUS, y * ARRANGEMENT_RADIUS];
}

function mapPointToDomeVec(point: { x: number; y: number }): Vec3 {
  const center = mapPointToDomeCenter(point);
  return { x: center[0], y: center[1], z: center[2] };
}

function domeVecToMapPoint(vec: Vec3): { x: number; y: number } {
  return {
    x: -vec.x / ARRANGEMENT_RADIUS,
    y: vec.z / ARRANGEMENT_RADIUS,
  };
}

function constellationCenterVec(item: ConstellationItem | null, book: BookGeometry | null): Vec3 {
  if (item?.center) {
    return {
      x: item.center[0],
      y: item.center[1],
      z: item.center[2] ?? 0,
    };
  }
  return mapPointToDomeVec(book ? centroidForBook(book) : { x: 0, y: 0 });
}

function vecLength(vec: Vec3): number {
  return Math.hypot(vec.x, vec.y, vec.z);
}

function normalizeVec(vec: Vec3): Vec3 {
  const length = vecLength(vec);
  if (length <= 1e-9) return { x: 0, y: 1, z: 0 };
  return { x: vec.x / length, y: vec.y / length, z: vec.z / length };
}

function centerToMapPoint(item: ConstellationItem | null, book: BookGeometry | null): { x: number; y: number } {
  if (item?.center) {
    return domeVecToMapPoint(constellationCenterVec(item, book));
  }
  return book ? centroidForBook(book) : { x: 0, y: 0 };
}

function makeFallbackConstellationItem(book: BookGeometry): ConstellationItem {
  const base = getBaseConstellationItem(book.bookKey);
  const center = centroidForBook(book);
  return {
    ...(base ?? {
      id: book.bookKey,
      title: book.bookName,
      type: "book",
      image: slugImageName(book.bookName),
      anchors: [`C:${book.bookKey}:1`, `C:${book.bookKey}:${book.chapterCount}`],
      center: null,
      radius: 1,
      rotationDeg: 0,
      opacity: 0.01,
      blend: "additive",
      zBias: 2,
      fade: {
        zoomInStart: 110,
        zoomInEnd: 20,
        hoverBoost: 0,
        minOpacity: 0.1,
        maxOpacity: 0.4,
      },
    }),
    center: base?.center ?? mapPointToDomeCenter(center),
    radius: base?.radius && base.radius > 1 ? base.radius : estimateRadiusForBook(book),
    rotationDeg: base?.rotationDeg ?? 0,
    opacity: base?.opacity ?? 0.01,
    lineColor: base?.lineColor ?? divisionTriangulationColor(book.divisionName),
    linePaths: base?.linePaths ?? [],
    lineSegments: base?.lineSegments ?? [],
  };
}

function ensureConstellationsForBooks(config: ConstellationConfig | null, books: BookGeometry[]): ConstellationConfig {
  const existing = new Map<string, ConstellationItem>();
  for (const item of config?.constellations ?? []) {
    existing.set(bookKeyFromConstellation(item), item);
  }

  return {
    version: config?.version ?? BASE_CONSTELLATION_CONFIG.version,
    atlasBasePath: config?.atlasBasePath ?? BASE_CONSTELLATION_CONFIG.atlasBasePath,
    constellations: books.map((book) => {
      const item = existing.get(book.bookKey) ?? makeFallbackConstellationItem(book);
      const hasLines = (item.lineSegments?.length ?? 0) > 0 || (item.linePaths?.length ?? 0) > 0;
      return {
        ...item,
        center: hasLines ? item.center ?? mapPointToDomeCenter(centroidForBook(book)) : item.center,
      };
    }),
  };
}

function hasAuthoredConstellationContent(item: ConstellationItem): boolean {
  return (
    (item.lineSegments?.length ?? 0) > 0 ||
    (item.linePaths?.length ?? 0) > 0 ||
    item.radius > 1 ||
    item.rotationDeg !== 0
  );
}

function buildAuthoredConstellationConfig(config: ConstellationConfig): ConstellationConfig {
  return {
    ...config,
    constellations: config.constellations.filter(hasAuthoredConstellationContent),
  };
}

export default function CuratePage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const zoomRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });
  const spinRef = useRef(0);
  const dragRef = useRef<DragState>({ type: "none" });
  const imagesRef = useRef<Map<string, HTMLImageElement>>(new Map());

  const [arrangement, setArrangement] = useState<StarArrangement | null>(null);
  const [constellationConfig, setConstellationConfig] = useState<ConstellationConfig | null>(null);
  const [selectedBookKey, setSelectedBookKey] = useState("");
  const [showOtherBooks, setShowOtherBooks] = useState(true);
  const [showOtherArtwork, setShowOtherArtwork] = useState(false);
  const [showLines, setShowLines] = useState(true);
  const [status, setStatus] = useState("Load the Constellate autosave or import arrangement and constellations JSON.");
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);

  useEffect(() => {
    const storedArrangement = loadStoredArrangement();
    const storedConstellations = loadStoredConstellations();
    if (storedArrangement) {
      setArrangement(storedArrangement);
      setConstellationConfig(storedConstellations);
      setStatus(storedConstellations ? "Restored Curate inputs from Constellate autosave." : "Restored arrangement autosave. Import constellations to curate artwork.");
    }
  }, []);

  const books = useMemo(() => buildBookGeometry(arrangement), [arrangement]);
  const curatedConfig = useMemo(() => ensureConstellationsForBooks(constellationConfig, books), [books, constellationConfig]);
  const authoredConfig = useMemo(() => buildAuthoredConstellationConfig(curatedConfig), [curatedConfig]);
  const selectedBook = useMemo(
    () => books.find((book) => book.bookKey === selectedBookKey) ?? books[0] ?? null,
    [books, selectedBookKey],
  );
  const selectedItem = useMemo(
    () => curatedConfig.constellations.find((item) => bookKeyFromConstellation(item) === selectedBook?.bookKey) ?? null,
    [curatedConfig, selectedBook],
  );
  const selectedCenter = useMemo(() => centerToMapPoint(selectedItem, selectedBook), [selectedBook, selectedItem]);
  const selectedLineCount = selectedItem ? (selectedItem.lineSegments?.length ?? 0) + (selectedItem.linePaths?.length ?? 0) : 0;
  const lastSavedLabel = lastSavedAt !== null
    ? new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(lastSavedAt)
    : null;

  useEffect(() => {
    if (!selectedBookKey && books[0]) setSelectedBookKey(books[0].bookKey);
  }, [books, selectedBookKey]);

  useEffect(() => {
    if (!arrangement || books.length === 0) return;
    saveStoredConstellations(authoredConfig);
    setLastSavedAt(Date.now());
  }, [arrangement, authoredConfig, books.length]);

  useEffect(() => {
    const basePath = curatedConfig.atlasBasePath.replace(/\/$/, "");
    for (const item of curatedConfig.constellations) {
      const src = `${basePath}/${item.image}`;
      if (imagesRef.current.has(src)) continue;
      const img = new Image();
      img.src = src;
      imagesRef.current.set(src, img);
    }
  }, [curatedConfig]);

  const resetView = useCallback(() => {
    zoomRef.current = 1;
    panRef.current = { x: 0, y: 0 };
    spinRef.current = 0;
  }, []);

  const updateConstellationItem = useCallback((bookKey: string, patch: Partial<ConstellationItem>) => {
    setConstellationConfig((current) => {
      const base = ensureConstellationsForBooks(current, books);
      return {
        ...base,
        constellations: base.constellations.map((item) => {
          if (bookKeyFromConstellation(item) !== bookKey) return item;
          const book = books.find((candidate) => candidate.bookKey === bookKey);
          return {
            ...item,
            center: item.center ?? (book ? mapPointToDomeCenter(centroidForBook(book)) : item.center),
            ...patch,
          };
        }),
      };
    });
  }, [books]);

  const handleImportArrangement = useCallback(async (file: File) => {
    try {
      const imported = JSON.parse(await file.text()) as StarArrangement;
      const nextBooks = buildBookGeometry(imported);
      if (nextBooks.length === 0) throw new Error("No chapter positions found.");
      setArrangement(imported);
      setSelectedBookKey(nextBooks[0]?.bookKey ?? "");
      setStatus(`Loaded arrangement from ${file.name}.`);
      resetView();
    } catch {
      setStatus(`Could not load ${file.name}.`);
    }
  }, [resetView]);

  const handleImportConstellations = useCallback(async (file: File) => {
    try {
      const imported = JSON.parse(await file.text()) as ConstellationConfig;
      if (!imported?.version || !Array.isArray(imported.constellations)) throw new Error("Invalid constellations file.");
      setConstellationConfig(imported);
      setStatus(`Loaded constellations from ${file.name}.`);
    } catch {
      setStatus(`Could not load ${file.name}.`);
    }
  }, []);

  const handleResetArtwork = useCallback(() => {
    if (!selectedBook) return;
    updateConstellationItem(selectedBook.bookKey, {
      center: mapPointToDomeCenter(centroidForBook(selectedBook)),
      radius: estimateRadiusForBook(selectedBook),
      rotationDeg: 0,
    });
    setStatus(`Reset ${selectedBook.bookName} artwork to its chapter center.`);
  }, [selectedBook, updateConstellationItem]);

  const handleCenterSelected = useCallback(() => {
    if (!selectedBook) return;
    const center = centerToMapPoint(selectedItem, selectedBook);
    zoomRef.current = 2.2;
    panRef.current = { x: -center.x * 360, y: -center.y * 360 };
  }, [selectedBook, selectedItem]);

  function getViewport(canvas: HTMLCanvasElement) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const baseRadius = Math.min(width, height) / 2 - 12;
    const radius = baseRadius * zoomRef.current;
    return {
      width,
      height,
      radius,
      scx: width / 2 + panRef.current.x,
      scy: height / 2 + panRef.current.y,
      cos: Math.cos(spinRef.current),
      sin: Math.sin(spinRef.current),
    };
  }

  function projectPoint(point: { x: number; y: number }, viewport: ReturnType<typeof getViewport>) {
    return {
      x: viewport.scx + projectSkyCoordinate(point.x * viewport.cos + point.y * viewport.sin) * viewport.radius,
      y: viewport.scy + projectSkyCoordinate(-point.x * viewport.sin + point.y * viewport.cos) * viewport.radius,
    };
  }

  function screenToMapPoint(x: number, y: number, viewport: ReturnType<typeof getViewport>) {
    const projectedX = ((x - viewport.scx) / viewport.radius) * SKY_FIELD_RENDER_RADIUS;
    const projectedY = ((y - viewport.scy) / viewport.radius) * SKY_FIELD_RENDER_RADIUS;
    return {
      x: projectedX * viewport.cos - projectedY * viewport.sin,
      y: projectedX * viewport.sin + projectedY * viewport.cos,
    };
  }

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !selectedBook || !selectedItem) return;
    const rect = canvas.getBoundingClientRect();
    const viewport = getViewport(canvas);
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const artCenter = centerToMapPoint(selectedItem, selectedBook);
    const artScreen = projectPoint(artCenter, viewport);
    const artHitRadius = Math.max(26, (selectedItem.radius / ARRANGEMENT_RADIUS / SKY_FIELD_RENDER_RADIUS) * viewport.radius);

    if (Math.hypot(x - artScreen.x, y - artScreen.y) <= artHitRadius) {
      const pointerMap = screenToMapPoint(x, y, viewport);
      dragRef.current = {
        type: "art",
        bookKey: selectedBook.bookKey,
        offsetX: artCenter.x - pointerMap.x,
        offsetY: artCenter.y - pointerMap.y,
      };
    } else {
      dragRef.current = {
        type: event.shiftKey ? "spin" : "pan",
        lastX: event.clientX,
        lastY: event.clientY,
      };
    }
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [selectedBook, selectedItem]);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (drag.type === "none") return;
    if (drag.type === "pan" || drag.type === "spin") {
      const dx = event.clientX - drag.lastX;
      const dy = event.clientY - drag.lastY;
      drag.lastX = event.clientX;
      drag.lastY = event.clientY;
      if (drag.type === "spin") spinRef.current += dx * 0.005;
      else panRef.current = { x: panRef.current.x + dx, y: panRef.current.y + dy };
      return;
    }
    if (drag.type !== "art") return;
    const artDrag = drag;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const viewport = getViewport(canvas);
    const pointerMap = screenToMapPoint(event.clientX - rect.left, event.clientY - rect.top, viewport);
    updateConstellationItem(artDrag.bookKey, {
      center: mapPointToDomeCenter({ x: pointerMap.x + artDrag.offsetX, y: pointerMap.y + artDrag.offsetY }),
    });
  }, [updateConstellationItem]);

  const handlePointerUp = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    dragRef.current = { type: "none" };
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }, []);

  const handleWheel = useCallback((event: React.WheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    zoomRef.current = Math.max(0.35, Math.min(6, zoomRef.current * (event.deltaY > 0 ? 0.93 : 1.07)));
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !arrangement) return;

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

      const viewport = getViewport(canvas);
      ctx.fillStyle = "#05060a";
      ctx.fillRect(0, 0, viewport.width, viewport.height);

      ctx.beginPath();
      ctx.arc(viewport.scx, viewport.scy, viewport.radius, 0, Math.PI * 2);
      ctx.fillStyle = "#080d18";
      ctx.fill();
      ctx.strokeStyle = "rgba(92,113,176,0.34)";
      ctx.lineWidth = 1.5;
      ctx.stroke();

      const itemByBookKey = new Map(curatedConfig.constellations.map((item) => [bookKeyFromConstellation(item), item]));

      if (showLines) {
        for (const book of books) {
          if (!showOtherBooks && book.bookKey !== selectedBook?.bookKey) continue;
          const item = itemByBookKey.get(book.bookKey);
          const pointById = new Map(book.points.map((point) => [point.id, point]));
          for (const segment of item?.lineSegments ?? []) {
            const from = pointById.get(segment.from);
            const to = pointById.get(segment.to);
            if (!from || !to) continue;
            const a = projectPoint(from, viewport);
            const b = projectPoint(to, viewport);
            const selected = book.bookKey === selectedBook?.bookKey;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.strokeStyle = selected ? "rgba(255,236,179,0.88)" : segment.color ?? divisionTriangulationColor(book.divisionName);
            ctx.lineWidth = selected ? 2.2 : 1.25;
            ctx.shadowBlur = selected ? 14 : 7;
            ctx.shadowColor = selected ? "rgba(255,236,179,0.65)" : segment.color ?? divisionTriangulationColor(book.divisionName);
            ctx.stroke();
            ctx.shadowBlur = 0;
          }
        }
      }

      const basePath = curatedConfig.atlasBasePath.replace(/\/$/, "");
      for (const book of books) {
        const item = itemByBookKey.get(book.bookKey);
        if (!item) continue;
        const selected = book.bookKey === selectedBook?.bookKey;
        if (!selected && !showOtherArtwork) continue;
        const center = centerToMapPoint(item, book);
        const screen = projectPoint(center, viewport);
        const src = `${basePath}/${item.image}`;
        const img = imagesRef.current.get(src);
        const radiusPx = (item.radius / ARRANGEMENT_RADIUS / SKY_FIELD_RENDER_RADIUS) * viewport.radius;
        const aspect = item.aspectRatio ?? (img?.complete && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 1);
        const widthPx = radiusPx * 2 * Math.sqrt(aspect);
        const heightPx = radiusPx * 2 / Math.sqrt(aspect);

        ctx.save();
        ctx.translate(screen.x, screen.y);
        ctx.rotate((item.rotationDeg * Math.PI) / 180 + spinRef.current);
        ctx.globalAlpha = selected ? Math.max(0.22, Math.min(0.82, item.opacity * 22)) : Math.max(0.08, Math.min(0.32, item.opacity * 14));
        ctx.globalCompositeOperation = item.blend === "additive" ? "lighter" : "source-over";
        if (img?.complete && img.naturalWidth > 0) {
          ctx.drawImage(img, -widthPx / 2, -heightPx / 2, widthPx, heightPx);
        } else {
          ctx.strokeStyle = selected ? "rgba(255,236,179,0.6)" : "rgba(180,200,255,0.24)";
          ctx.lineWidth = selected ? 1.5 : 1;
          ctx.strokeRect(-widthPx / 2, -heightPx / 2, widthPx, heightPx);
        }
        ctx.restore();

        if (selected) {
          ctx.beginPath();
          ctx.arc(screen.x, screen.y, 5, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(255,246,214,0.9)";
          ctx.fill();
          ctx.beginPath();
          ctx.arc(screen.x, screen.y, Math.max(18, radiusPx), 0, Math.PI * 2);
          ctx.strokeStyle = "rgba(255,246,214,0.36)";
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }

      for (const book of books) {
        const visibleBook = showOtherBooks || book.bookKey === selectedBook?.bookKey;
        if (!visibleBook) continue;
        for (const point of book.points) {
          const screen = projectPoint(point, viewport);
          const inBook = point.bookKey === selectedBook?.bookKey;
          const r = chapterRadius(point.verseCount);
          const prominence = chapterProminence(point.verseCount);
          const glowRadius = r * (2.2 + prominence * 1.4);
          const glow = ctx.createRadialGradient(screen.x, screen.y, 0, screen.x, screen.y, glowRadius);
          const glowOpacity = inBook ? 0.18 + prominence * 0.36 : 0.06 + prominence * 0.16;
          glow.addColorStop(0, `rgba(255,238,190,${glowOpacity.toFixed(3)})`);
          glow.addColorStop(1, "rgba(255,238,190,0)");
          ctx.fillStyle = glow;
          ctx.fillRect(screen.x - glowRadius, screen.y - glowRadius, glowRadius * 2, glowRadius * 2);

          ctx.beginPath();
          ctx.arc(screen.x, screen.y, r, 0, Math.PI * 2);
          ctx.fillStyle = inBook
            ? `rgba(255,248,230,${(0.72 + prominence * 0.28).toFixed(3)})`
            : `rgba(185,202,255,${(0.24 + prominence * 0.24).toFixed(3)})`;
          ctx.fill();
        }
      }
    };

    draw();
    return () => cancelAnimationFrame(animRef.current);
  }, [arrangement, books, curatedConfig, selectedBook, showLines, showOtherArtwork, showOtherBooks]);

  return (
    <BuilderWorkspace
      route="curate"
      title="Curate"
      subtitle="Place, size, and rotate constellation artwork over the 2D sky map before opening Preview."
      sidebarWidthClass="w-80"
      sidebar={
        <>
          <p className="text-xs leading-relaxed text-white/45">
            Curate consumes Constellate autosaves and updates `constellations.json` artwork placement for Preview.
          </p>

          {!arrangement ? (
            <BuilderSection label="Load Inputs">
              <FileInput label="Load arrangement" filename="arrangement.json" onChange={handleImportArrangement} />
              <FileInput label="Load constellations" filename="constellations.json" onChange={handleImportConstellations} />
            </BuilderSection>
          ) : (
            <>
              <BuilderSection label="Source">
                <div className="rounded-md border border-white/8 bg-white/[0.03] px-2.5 py-2">
                  <div className="flex items-center justify-between text-xs text-white/48">
                    <span>Books</span>
                    <span className="tabular-nums text-white/72">{books.length}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between text-xs text-white/48">
                    <span>Atlas</span>
                    <span className="max-w-36 truncate text-white/72">{curatedConfig.atlasBasePath}</span>
                  </div>
                  {lastSavedLabel && <p className="mt-1 text-[10px] text-white/28">Autosave: {lastSavedLabel}</p>}
                </div>
                <div className="flex gap-2">
                  <FileInput label="Arrangement" filename="arrangement.json" onChange={handleImportArrangement} compact />
                  <FileInput label="Constellations" filename="constellations.json" onChange={handleImportConstellations} compact />
                </div>
              </BuilderSection>

              <BuilderSection label="Book">
                <SelectRow
                  label="Book"
                  value={selectedBook?.bookKey ?? ""}
                  onChange={setSelectedBookKey}
                  options={books.map((book) => ({ value: book.bookKey, label: book.bookName }))}
                />
                {selectedBook && selectedItem && (
                  <div className="rounded-md border border-white/8 bg-white/[0.03] px-2.5 py-2">
                    <p className="text-sm font-medium text-white/78">{selectedBook.bookName}</p>
                    <p className="mt-1 text-xs text-white/38">{selectedItem.image}</p>
                    <p className="mt-1 text-[10px] text-white/28">Lines: {selectedLineCount}</p>
                  </div>
                )}
              </BuilderSection>

              {selectedBook && selectedItem && (
                <BuilderSection label="Artwork">
                  <SliderRow
                    label="Size"
                    value={selectedItem.radius}
                    min={80}
                    max={1200}
                    step={10}
                    display={Math.round(selectedItem.radius).toString()}
                    onChange={(value) => updateConstellationItem(selectedBook.bookKey, { radius: value })}
                  />
                  <SliderRow
                    label="Rotate"
                    value={selectedItem.rotationDeg}
                    min={-180}
                    max={180}
                    step={1}
                    display={`${Math.round(selectedItem.rotationDeg)} deg`}
                    onChange={(value) => updateConstellationItem(selectedBook.bookKey, { rotationDeg: value })}
                  />
                  <SliderRow
                    label="Opacity"
                    value={selectedItem.opacity}
                    min={0}
                    max={0.08}
                    step={0.001}
                    display={selectedItem.opacity.toFixed(3)}
                    onChange={(value) => updateConstellationItem(selectedBook.bookKey, { opacity: value })}
                  />
                  <button onClick={handleResetArtwork} className="text-left text-xs text-white/45 transition-colors hover:text-white/70">
                    Reset selected artwork
                  </button>
                  <button onClick={handleCenterSelected} className="text-left text-xs text-white/45 transition-colors hover:text-white/70">
                    Center selected artwork
                  </button>
                </BuilderSection>
              )}

              <BuilderSection label="View">
                <label className="flex items-center justify-between text-xs text-white/52">
                  <span>Show other books</span>
                  <input type="checkbox" checked={showOtherBooks} onChange={(event) => setShowOtherBooks(event.target.checked)} className="accent-amber-400" />
                </label>
                <label className="flex items-center justify-between text-xs text-white/52">
                  <span>Show other artwork</span>
                  <input type="checkbox" checked={showOtherArtwork} onChange={(event) => setShowOtherArtwork(event.target.checked)} className="accent-amber-400" />
                </label>
                <label className="flex items-center justify-between text-xs text-white/52">
                  <span>Show lines</span>
                  <input type="checkbox" checked={showLines} onChange={(event) => setShowLines(event.target.checked)} className="accent-amber-400" />
                </label>
                <button onClick={resetView} className="text-left text-xs text-white/45 transition-colors hover:text-white/70">
                  Reset view
                </button>
              </BuilderSection>

              <BuilderSection label="Export">
                <div className="rounded-md border border-white/8 bg-white/[0.03] px-2.5 py-2">
                  <p className="text-[10px] uppercase tracking-widest text-white/22">Status</p>
                  <p className="mt-1 text-xs text-white/52">{status}</p>
                </div>
                <button onClick={() => downloadJson(authoredConfig, "constellations.json")} className="text-left text-xs text-white/45 transition-colors hover:text-white/70">
                  Export constellations.json
                </button>
                <Link href="/preview" className="text-left text-xs text-white/45 transition-colors hover:text-white/70">
                  Open Preview
                </Link>
              </BuilderSection>
            </>
          )}
        </>
      }
    >
      <div className="relative h-full">
        {arrangement ? (
          <>
            <canvas
              ref={canvasRef}
              className="h-full w-full cursor-move"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerLeave={() => { dragRef.current = { type: "none" }; }}
              onWheel={handleWheel}
              onDoubleClick={resetView}
            />
            <div className="pointer-events-none absolute bottom-5 left-5 rounded-md border border-white/10 bg-[#0b0f1a]/88 px-3 py-2">
              <p className="text-[10px] uppercase tracking-[0.24em] text-white/28">Curate Controls</p>
              <p className="mt-1 text-xs text-white/52">Drag selected artwork to position it.</p>
              <p className="mt-1 text-[10px] text-white/34">Drag empty space to pan. Shift-drag to spin. Scroll to zoom.</p>
            </div>
          </>
        ) : (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <p className="text-sm text-white/10">load Constellate outputs to begin curating</p>
          </div>
        )}
      </div>
    </BuilderWorkspace>
  );
}

function FileInput({ label, filename, onChange, compact = false }: {
  label: string;
  filename: string;
  onChange: (file: File) => void;
  compact?: boolean;
}) {
  return (
    <label className={`flex ${compact ? "flex-1" : "flex-col gap-1"} cursor-pointer`}>
      {!compact && <span className="text-[10px] uppercase tracking-widest text-white/30">{label}</span>}
      <div className={`text-xs text-white/55 bg-white/5 border border-white/10 rounded px-3 py-2 hover:bg-white/8 transition-colors text-center ${compact ? "w-full" : ""}`}>
        {compact ? label : filename}
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

function SelectRow({ label, value, onChange, options }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="flex items-center justify-between gap-3 text-xs text-white/52">
      <span>{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-w-0 flex-1 rounded border border-white/10 bg-white/[0.03] px-2 py-1 text-xs text-white/78"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

function SliderRow({ label, value, min, max, step, display, onChange }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-white/52">
      <div className="flex items-center justify-between">
        <span>{label}</span>
        <span className="tabular-nums text-white/72">{display}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full accent-amber-400"
      />
    </label>
  );
}
