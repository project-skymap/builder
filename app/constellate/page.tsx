"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ConstellationConfig, StarArrangement } from "@project-skymap/library";
import baseConstellationConfig from "../../public/constellations.json";
import { CANON } from "../assign/canon";
import { BuilderSection, BuilderWorkspace } from "../components/BuilderWorkspace";
import { ARRANGEMENT_RADIUS, VERSE_COUNTS, chapterNodeToGlobalIndex, divisionTriangulationColor } from "../skymap/shared";
import {
  loadPipelineArrangement,
  loadPipelineConstellations,
  savePipelineArrangement,
  savePipelineConstellations,
} from "../skymap/pipeline";

const ARRANGEMENT_STORAGE_KEY = "skymap-constellate-arrangement";
const CONSTELLATION_STORAGE_KEY = "skymap-constellate-constellations";
const SKY_FIELD_RENDER_RADIUS = 1.25;
const STAR_HIT_RADIUS = 13;

type ChapterPoint = {
  id: string;
  bookKey: string;
  bookName: string;
  divisionName: string;
  chapterNumber: number;
  x: number;
  y: number;
  verseCount: number;
};

type BookGeometry = {
  bookKey: string;
  bookName: string;
  divisionName: string;
  chapterCount: number;
  points: ChapterPoint[];
};

type LineSegment = {
  from: string;
  to: string;
  weight?: "thin" | "normal" | "bold";
  color?: string;
};

type CustomConstellationConfig = ConstellationConfig;

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
  return loadPipelineArrangement() ?? safeParseJson<StarArrangement>(localStorage.getItem(ARRANGEMENT_STORAGE_KEY));
}

function loadStoredConstellations(): CustomConstellationConfig | null {
  if (typeof window === "undefined") return null;
  const data = loadPipelineConstellations() ?? safeParseJson<CustomConstellationConfig>(localStorage.getItem(CONSTELLATION_STORAGE_KEY));
  return data?.version && Array.isArray(data.constellations) ? data : null;
}

function saveStoredArrangement(arrangement: StarArrangement): void {
  savePipelineArrangement(arrangement);
}

function saveStoredConstellations(config: CustomConstellationConfig): void {
  savePipelineConstellations(config);
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

function lineKey(from: string, to: string): string {
  return from < to ? `${from}|${to}` : `${to}|${from}`;
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
      verseCount: VERSE_COUNTS[chapterGlobalIndex] ?? 1,
    });
  }

  return [...books.values()].map((book) => ({
    ...book,
    points: book.points.sort((a, b) => a.chapterNumber - b.chapterNumber),
  }));
}

const BASE_CONSTELLATION_CONFIG = baseConstellationConfig as unknown as ConstellationConfig;

function getBaseConstellationItem(bookKey: string): CustomConstellationConfig["constellations"][number] | null {
  return BASE_CONSTELLATION_CONFIG.constellations.find((constellation) => {
    const anchorBookKey = constellation.anchors[0]?.split(":")[1] ?? constellation.id;
    return anchorBookKey === bookKey;
  }) ?? null;
}

function makeConstellationItem(
  book: BookGeometry,
  lineSegments: LineSegment[],
  existing: CustomConstellationConfig["constellations"][number] | null,
): CustomConstellationConfig["constellations"][number] {
  const colour = divisionTriangulationColor(book.divisionName);
  const base = existing ?? getBaseConstellationItem(book.bookKey);
  return {
    ...(base ?? {
      id: book.bookKey,
      title: book.bookName,
      type: "book",
      image: `${book.bookName.toLowerCase().replace(/[^a-z0-9]+/g, "")}.png`,
      anchors: [
        `C:${book.bookKey}:1`,
        `C:${book.bookKey}:${book.chapterCount}`,
      ],
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
    lineColor: colour,
    linePaths: [],
    lineSegments: lineSegments.map((segment) => ({
      ...segment,
      color: segment.color ?? colour,
      weight: segment.weight ?? "normal",
    })),
  };
}

function buildConstellationConfig(
  books: BookGeometry[],
  lineMap: Record<string, LineSegment[]>,
  draft: CustomConstellationConfig | null,
): CustomConstellationConfig {
  const existing = new Map<string, CustomConstellationConfig["constellations"][number]>();
  for (const item of draft?.constellations ?? []) {
    const bookKey = item.anchors[0]?.split(":")[1] ?? item.id;
    existing.set(bookKey, item);
  }

  return {
    version: draft?.version ?? 1,
    atlasBasePath: draft?.atlasBasePath ?? BASE_CONSTELLATION_CONFIG.atlasBasePath,
    constellations: books.map((book) => makeConstellationItem(book, lineMap[book.bookKey] ?? [], existing.get(book.bookKey) ?? null)),
  };
}

function extractLineMap(config: CustomConstellationConfig | null): Record<string, LineSegment[]> {
  const next: Record<string, LineSegment[]> = {};
  if (!config) return next;
  for (const constellation of config.constellations) {
    const bookKey = constellation.anchors[0]?.split(":")[1] ?? constellation.id;
    if (!bookKey) continue;
    next[bookKey] = (constellation.lineSegments ?? [])
      .filter((segment) => typeof segment.from === "string" && typeof segment.to === "string")
      .map((segment) => ({
        from: segment.from,
        to: segment.to,
        weight: segment.weight ?? "normal",
        color: segment.color,
      }));
  }
  return next;
}

export default function ConstellatePage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const zoomRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });
  const spinRef = useRef(0);
  const hitStarsRef = useRef<Array<{ point: ChapterPoint; x: number; y: number; r: number }>>([]);
  const dragRef = useRef<{ type: "none" } | { type: "pan" | "spin"; lastX: number; lastY: number }>({ type: "none" });

  const [arrangement, setArrangement] = useState<StarArrangement | null>(null);
  const [lineMap, setLineMap] = useState<Record<string, LineSegment[]>>({});
  const [constellationDraft, setConstellationDraft] = useState<CustomConstellationConfig | null>(null);
  const [status, setStatus] = useState("Load the refined arrangement and curated constellations draft.");
  const [filename, setFilename] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [selectedBookKey, setSelectedBookKey] = useState<string>("");
  const [pendingPointId, setPendingPointId] = useState<string | null>(null);
  const [showOtherBooks, setShowOtherBooks] = useState(true);
  const [showLinesOnlyForBook, setShowLinesOnlyForBook] = useState(false);

  useEffect(() => {
    const storedArrangement = loadStoredArrangement();
    const storedConstellations = loadStoredConstellations();
    if (storedArrangement) {
      setArrangement(storedArrangement);
      setConstellationDraft(storedConstellations);
      setLineMap(extractLineMap(storedConstellations));
      setStatus(storedConstellations ? "Restored refined arrangement and curated constellations from the Builder pipeline." : "Restored refined arrangement from the Builder pipeline.");
    }
  }, []);

  const books = useMemo(() => buildBookGeometry(arrangement), [arrangement]);
  const selectedBook = useMemo(
    () => books.find((book) => book.bookKey === selectedBookKey) ?? books[0] ?? null,
    [books, selectedBookKey],
  );
  const selectedPoint = useMemo(
    () => selectedBook?.points.find((point) => point.id === pendingPointId) ?? null,
    [pendingPointId, selectedBook],
  );
  const constellationConfig = useMemo(() => buildConstellationConfig(books, lineMap, constellationDraft), [books, constellationDraft, lineMap]);
  const lineCount = useMemo(
    () => Object.values(lineMap).reduce((sum, segments) => sum + segments.length, 0),
    [lineMap],
  );
  const selectedBookLineCount = selectedBook ? (lineMap[selectedBook.bookKey] ?? []).length : 0;
  const lastSavedLabel = lastSavedAt !== null
    ? new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(lastSavedAt)
    : null;

  useEffect(() => {
    if (!arrangement) return;
    saveStoredArrangement(arrangement);
    saveStoredConstellations(constellationConfig);
    setLastSavedAt(Date.now());
  }, [arrangement, constellationConfig]);

  useEffect(() => {
    if (!selectedBookKey && books[0]) setSelectedBookKey(books[0].bookKey);
  }, [books, selectedBookKey]);

  const resetView = useCallback(() => {
    zoomRef.current = 1;
    panRef.current = { x: 0, y: 0 };
    spinRef.current = 0;
  }, []);

  const handleImportArrangement = useCallback(async (file: File) => {
    try {
      const imported = JSON.parse(await file.text()) as StarArrangement;
      const nextBooks = buildBookGeometry(imported);
      if (nextBooks.length === 0) throw new Error("No chapter positions found.");
      setArrangement(imported);
      savePipelineArrangement(imported);
      setLineMap({});
      setSelectedBookKey(nextBooks[0]?.bookKey ?? "");
      setPendingPointId(null);
      setFilename(file.name);
      setStatus(`Loaded arrangement from ${file.name}.`);
      resetView();
    } catch {
      setStatus(`Could not load ${file.name}.`);
    }
  }, [resetView]);

  const handleImportConstellations = useCallback(async (file: File) => {
    try {
      const imported = JSON.parse(await file.text()) as CustomConstellationConfig;
      if (!Array.isArray(imported.constellations)) throw new Error("Invalid constellations file.");
      setConstellationDraft(imported);
      savePipelineConstellations(imported);
      setLineMap(extractLineMap(imported));
      setStatus(`Loaded constellation lines from ${file.name}.`);
      setPendingPointId(null);
    } catch {
      setStatus(`Could not load ${file.name}.`);
    }
  }, []);

  const addOrRemoveLine = useCallback((from: ChapterPoint, to: ChapterPoint) => {
    if (from.bookKey !== to.bookKey || from.id === to.id) return;
    const key = lineKey(from.id, to.id);
    const existsNow = (lineMap[from.bookKey] ?? []).some((segment) => lineKey(segment.from, segment.to) === key);
    setLineMap((current) => {
      const segments = current[from.bookKey] ?? [];
      const exists = segments.some((segment) => lineKey(segment.from, segment.to) === key);
      const nextSegments = exists
        ? segments.filter((segment) => lineKey(segment.from, segment.to) !== key)
        : [...segments, { from: from.id, to: to.id, weight: "normal" as const }];
      return { ...current, [from.bookKey]: nextSegments };
    });
    setStatus(`${from.bookName}: ${from.chapterNumber} to ${to.chapterNumber} ${existsNow ? "removed" : "connected"}.`);
  }, [lineMap]);

  const handlePointClick = useCallback((point: ChapterPoint) => {
    if (selectedBookKey !== point.bookKey) setSelectedBookKey(point.bookKey);
    if (!pendingPointId) {
      setPendingPointId(point.id);
      return;
    }

    const from = books.flatMap((book) => book.points).find((candidate) => candidate.id === pendingPointId);
    if (!from || from.bookKey !== point.bookKey || from.id === point.id) {
      setPendingPointId(point.id);
      return;
    }

    addOrRemoveLine(from, point);
    setPendingPointId(null);
  }, [addOrRemoveLine, books, pendingPointId, selectedBookKey]);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    for (const hit of hitStarsRef.current) {
      if (Math.hypot(hit.x - x, hit.y - y) <= hit.r) {
        handlePointClick(hit.point);
        return;
      }
    }

    dragRef.current = {
      type: event.shiftKey ? "spin" : "pan",
      lastX: event.clientX,
      lastY: event.clientY,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [handlePointClick]);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (drag.type === "none") return;
    const dx = event.clientX - drag.lastX;
    const dy = event.clientY - drag.lastY;
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    if (drag.type === "spin") spinRef.current += dx * 0.005;
    else panRef.current = { x: panRef.current.x + dx, y: panRef.current.y + dy };
  }, []);

  const handlePointerUp = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    dragRef.current = { type: "none" };
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }, []);

  const handleWheel = useCallback((event: React.WheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    zoomRef.current = Math.max(0.35, Math.min(6, zoomRef.current * (event.deltaY > 0 ? 0.93 : 1.07)));
  }, []);

  const handleClearBookLines = useCallback(() => {
    if (!selectedBook) return;
    setLineMap((current) => ({ ...current, [selectedBook.bookKey]: [] }));
    setPendingPointId(null);
    setStatus(`Cleared lines for ${selectedBook.bookName}.`);
  }, [selectedBook]);

  const handleClearAllLines = useCallback(() => {
    setLineMap({});
    setPendingPointId(null);
    setStatus("Cleared all custom constellation lines.");
  }, []);

  const handleAutoConnectBook = useCallback(() => {
    if (!selectedBook) return;
    setLineMap((current) => ({
      ...current,
      [selectedBook.bookKey]: selectedBook.points.slice(1).map((point, index) => ({
        from: selectedBook.points[index]!.id,
        to: point.id,
        weight: "normal" as const,
      })),
    }));
    setStatus(`Connected ${selectedBook.bookName} in chapter order.`);
  }, [selectedBook]);

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

      const baseRadius = Math.min(width, height) / 2 - 12;
      const radius = baseRadius * zoomRef.current;
      const scx = width / 2 + panRef.current.x;
      const scy = height / 2 + panRef.current.y;
      const cos = Math.cos(spinRef.current);
      const sin = Math.sin(spinRef.current);

      function project(point: { x: number; y: number }) {
        return {
          x: scx + projectSkyCoordinate(point.x * cos + point.y * sin) * radius,
          y: scy + projectSkyCoordinate(-point.x * sin + point.y * cos) * radius,
        };
      }

      hitStarsRef.current = [];
      ctx.fillStyle = "#05060a";
      ctx.fillRect(0, 0, width, height);

      ctx.beginPath();
      ctx.arc(scx, scy, radius, 0, Math.PI * 2);
      ctx.fillStyle = "#080d18";
      ctx.fill();
      ctx.strokeStyle = "rgba(92,113,176,0.34)";
      ctx.lineWidth = 1.5;
      ctx.stroke();

      for (const book of books) {
        if (showLinesOnlyForBook && book.bookKey !== selectedBook?.bookKey) continue;
        const pointById = new Map(book.points.map((point) => [point.id, point]));
        for (const segment of lineMap[book.bookKey] ?? []) {
          const from = pointById.get(segment.from);
          const to = pointById.get(segment.to);
          if (!from || !to) continue;
          const a = project(from);
          const b = project(to);
          const selected = book.bookKey === selectedBook?.bookKey;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.strokeStyle = selected ? "rgba(255,236,179,0.88)" : divisionTriangulationColor(book.divisionName);
          ctx.lineWidth = selected ? 2.2 : 1.4;
          ctx.shadowBlur = selected ? 14 : 8;
          ctx.shadowColor = selected ? "rgba(255,236,179,0.65)" : divisionTriangulationColor(book.divisionName);
          ctx.stroke();
          ctx.shadowBlur = 0;
        }
      }

      for (const book of books) {
        const visibleBook = showOtherBooks || book.bookKey === selectedBook?.bookKey;
        if (!visibleBook) continue;
        for (const point of book.points) {
          const screen = project(point);
          const selected = point.id === pendingPointId;
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

          if (prominence > 0.28) {
            ctx.beginPath();
            ctx.arc(screen.x, screen.y, Math.max(1.5, r * 0.32), 0, Math.PI * 2);
            ctx.fillStyle = inBook ? "rgba(255,255,255,0.95)" : "rgba(235,240,255,0.55)";
            ctx.fill();
          }

          if (selected || inBook) {
            ctx.beginPath();
            ctx.arc(screen.x, screen.y, r + (selected ? 7 : 4), 0, Math.PI * 2);
            ctx.strokeStyle = selected ? "rgba(255,255,255,0.88)" : "rgba(251,191,36,0.45)";
            ctx.lineWidth = selected ? 1.8 : 1.1;
            ctx.stroke();
          }
          hitStarsRef.current.push({ point, x: screen.x, y: screen.y, r: Math.max(STAR_HIT_RADIUS, r + 6) });
        }
      }
    };

    draw();
    return () => cancelAnimationFrame(animRef.current);
  }, [arrangement, books, lineMap, pendingPointId, selectedBook, showLinesOnlyForBook, showOtherBooks]);

  return (
    <BuilderWorkspace
      route="constellate"
      title="Constellate"
      subtitle="Connect refined chapter stars into constellation lines, preserving curated artwork placement."
      sidebarWidthClass="w-80"
      sidebar={
        <>
          <p className="text-xs leading-relaxed text-white/45">
            Constellate consumes the refined `arrangement.json` and curated `constellations.json`, then adds line segments for Preview.
          </p>

          {!arrangement ? (
            <BuilderSection label="Load Inputs">
              <p className="text-[10px] leading-relaxed text-white/20">
                Upload the refined arrangement JSON and, optionally, the curated constellations JSON to begin drawing book lines.
              </p>
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
                    <span>Custom lines</span>
                    <span className="tabular-nums text-white/72">{lineCount}</span>
                  </div>
                  {filename && <div className="mt-1 text-[10px] text-white/28">{filename}</div>}
                </div>
                <div className="flex gap-2">
                  <FileInput label="Replace arrangement" filename="arrangement.json" onChange={handleImportArrangement} compact />
                  <FileInput label="Constellations" filename="constellations.json" onChange={handleImportConstellations} compact />
                </div>
              </BuilderSection>

              <BuilderSection label="Book">
                <SelectRow
                  label="Book"
                  value={selectedBook?.bookKey ?? ""}
                  onChange={(value) => {
                    setSelectedBookKey(value);
                    setPendingPointId(null);
                  }}
                  options={books.map((book) => ({ value: book.bookKey, label: book.bookName }))}
                />
                {selectedBook && (
                  <div className="rounded-md border border-white/8 bg-white/[0.03] px-2.5 py-2">
                    <p className="text-sm font-medium text-white/78">{selectedBook.bookName}</p>
                    <p className="mt-1 text-xs text-white/38">
                      {selectedBook.points.length}/{selectedBook.chapterCount} chapters · {selectedBook.divisionName}
                    </p>
                    <p className="mt-1 text-[10px] text-white/28">Lines in book: {selectedBookLineCount}</p>
                    {selectedPoint && (
                      <p className="mt-1 text-[10px] text-amber-100/58">Selected chapter: {selectedPoint.chapterNumber}</p>
                    )}
                  </div>
                )}
              </BuilderSection>

              <BuilderSection label="Drawing">
                <p className="text-[10px] leading-relaxed text-white/22">
                  Click one chapter, then click another chapter in the same book. Each completed line clears the selection, so a central chapter can be selected again for another branch.
                </p>
                <label className="flex items-center justify-between text-xs text-white/52">
                  <span>Show other books</span>
                  <input type="checkbox" checked={showOtherBooks} onChange={(event) => setShowOtherBooks(event.target.checked)} className="accent-amber-400" />
                </label>
                <label className="flex items-center justify-between text-xs text-white/52">
                  <span>Only selected lines</span>
                  <input type="checkbox" checked={showLinesOnlyForBook} onChange={(event) => setShowLinesOnlyForBook(event.target.checked)} className="accent-amber-400" />
                </label>
                <button onClick={handleAutoConnectBook} className="text-left text-xs text-white/45 transition-colors hover:text-white/70">
                  Connect selected book in order
                </button>
                <button onClick={handleClearBookLines} className="text-left text-xs text-white/45 transition-colors hover:text-white/70">
                  Clear selected book
                </button>
                <button onClick={handleClearAllLines} className="text-left text-xs text-white/45 transition-colors hover:text-white/70">
                  Clear all lines
                </button>
                <button onClick={resetView} className="text-left text-xs text-white/45 transition-colors hover:text-white/70">
                  Reset view
                </button>
              </BuilderSection>

              <BuilderSection label="Export">
                <div className="rounded-md border border-white/8 bg-white/[0.03] px-2.5 py-2">
                  <p className="text-[10px] uppercase tracking-widest text-white/22">Status</p>
                  <p className="mt-1 text-xs text-white/52">{status}</p>
                  {lastSavedLabel && <p className="mt-1 text-[10px] text-white/28">Autosave: {lastSavedLabel}</p>}
                </div>
                <button onClick={() => {
                  savePipelineConstellations(constellationConfig);
                  downloadJson(constellationConfig, "constellations.json");
                }} className="text-left text-xs text-white/45 transition-colors hover:text-white/70">
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
              className="h-full w-full cursor-crosshair"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerLeave={() => { dragRef.current = { type: "none" }; }}
              onWheel={handleWheel}
              onDoubleClick={resetView}
            />
            <div className="pointer-events-none absolute bottom-5 left-5 rounded-md border border-white/10 bg-[#0b0f1a]/88 px-3 py-2">
              <p className="text-[10px] uppercase tracking-[0.24em] text-white/28">Constellate Controls</p>
              <p className="mt-1 text-xs text-white/52">Click two stars in a book to add or remove a line.</p>
              <p className="mt-1 text-[10px] text-white/34">Drag empty space to pan. Shift-drag to spin. Scroll to zoom.</p>
            </div>
          </>
        ) : (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <p className="text-sm text-white/10">load an arrangement to begin constellating</p>
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
