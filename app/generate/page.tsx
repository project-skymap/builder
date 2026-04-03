"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_SKY_PARAMS } from "@project-skymap/library";
import type { SkyGenParams, StarOutput, SkyField, SkyMetrics } from "@project-skymap/library";
import type { WorkerRequest, WorkerResponse } from "./worker";

// ---------------------------------------------------------------------------
// Slider
// ---------------------------------------------------------------------------

function Slider({
  label, value, min, max, step = 0.001,
  onChange, fmt, disabled, note,
}: {
  label: string; value: number; min: number; max: number; step?: number;
  onChange: (v: number) => void; fmt?: (v: number) => string;
  disabled?: boolean; note?: string;
}) {
  return (
    <div className={`flex flex-col gap-1 ${disabled ? "opacity-40" : ""}`}>
      <div className="flex justify-between text-xs text-gray-400">
        <span>{label}{note && <span className="text-gray-600 ml-1">{note}</span>}</span>
        <span className="text-gray-200 tabular-nums">
          {fmt ? fmt(value) : value.toFixed(4)}
        </span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        disabled={disabled}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="w-full accent-indigo-400 h-1 disabled:cursor-not-allowed"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Metric badge
// ---------------------------------------------------------------------------

function MetricRow({
  label, value, fmt, color,
}: {
  label: string;
  value: number;
  fmt: (v: number) => string;
  color: "green" | "yellow" | "red";
}) {
  const colorClass =
    color === "green" ? "text-green-400" :
    color === "yellow" ? "text-yellow-400" :
    "text-red-400";
  return (
    <div className="flex justify-between text-xs">
      <span className="text-gray-500">{label}</span>
      <span className={`tabular-nums font-medium ${colorClass}`}>{fmt(value)}</span>
    </div>
  );
}

function metricsCDS(v: number): "green" | "yellow" | "red" {
  if (v < 3.5) return "green";
  if (v < 5) return "yellow";
  return "red";
}
function metricsNNCV(v: number): "green" | "yellow" | "red" {
  return v >= 0.4 && v <= 0.75 ? "green" : "yellow";
}
function metricsVoid(v: number): "green" | "yellow" | "red" {
  if (v < 0.25) return "green";
  if (v < 0.30) return "yellow";
  return "red";
}

// ---------------------------------------------------------------------------
// Stage label helpers
// ---------------------------------------------------------------------------

function stageLabel(stage: string): string {
  if (stage === "density")  return "Building density field\u2026";
  if (stage === "sampling") return "Placing 1,189 stars\u2026";
  if (stage === "relaxing") return "Relaxing\u2026";
  if (stage === "metrics")  return "Computing metrics\u2026";
  return stage;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function GeneratePage() {
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const workerRef  = useRef<Worker | null>(null);
  const animRef    = useRef<number>(0);

  // Stars from last completed generation
  const starsRef   = useRef<StarOutput[]>([]);

  // View state
  const spinRef    = useRef(0);
  const zoomRef    = useRef(1.0);
  const panRef     = useRef({ x: 0, y: 0 });
  const isDragging = useRef(false);
  const isShift    = useRef(false);
  const lastMouse  = useRef({ x: 0, y: 0 });

  // UI state
  const [params, setParams] = useState<SkyGenParams>(DEFAULT_SKY_PARAMS);
  const paramsRef           = useRef<SkyGenParams>(DEFAULT_SKY_PARAMS);

  const [generating, setGenerating] = useState(false);
  const [progressStage, setProgressStage] = useState("");
  const [progressPct, setProgressPct]     = useState(0);
  const [metrics, setMetrics]             = useState<SkyMetrics | null>(null);
  const [starCount, setStarCount]         = useState(0);
  const [exported, setExported]           = useState(false);

  // Precomputed per-star edge fade (invariant under spin)
  const edgeFadeRef = useRef<Float32Array>(new Float32Array(0));

  // -------------------------------------------------------------------------
  // Draw loop
  // -------------------------------------------------------------------------

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

      const cx     = W / 2;
      const cy     = H / 2;
      const baseR  = Math.min(W, H) / 2 - 12;
      const radius = baseR * zoomRef.current;
      const spin   = spinRef.current;
      const pan    = panRef.current;
      const scx    = cx + pan.x;
      const scy    = cy + pan.y;

      ctx.fillStyle = "#05060a";
      ctx.fillRect(0, 0, W, H);

      const stars    = starsRef.current;
      const fadeArr  = edgeFadeRef.current;
      const cos      = Math.cos(spin);
      const sin      = Math.sin(spin);

      for (let i = 0; i < stars.length; i++) {
        const s    = stars[i] as StarOutput;
        const fade = (fadeArr[i] as number | undefined) ?? 1;
        if (fade <= 0) continue;

        // Spin rotation around Y axis (in the 2D disk plane)
        const rx = s.x * cos + s.y * sin;
        const rz = -s.x * sin + s.y * cos;

        const sx = scx + rx * radius;
        const sy = scy + rz * radius;

        const mag = s.magnitude;

        if (mag < 2.5) {
          // Bright: glow + dot
          const glowR = 8;
          const grad = ctx.createRadialGradient(sx, sy, 0, sx, sy, glowR);
          grad.addColorStop(0, `rgba(255,240,210,${(0.25 * fade).toFixed(3)})`);
          grad.addColorStop(1, "rgba(255,240,210,0)");
          ctx.fillStyle = grad;
          ctx.fillRect(sx - glowR, sy - glowR, glowR * 2, glowR * 2);

          ctx.beginPath();
          ctx.arc(sx, sy, 2.2, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255,248,230,${fade.toFixed(3)})`;
          ctx.fill();
        } else if (mag < 3.5) {
          const glowR = 5;
          const grad = ctx.createRadialGradient(sx, sy, 0, sx, sy, glowR);
          grad.addColorStop(0, `rgba(255,240,210,${(0.25 * fade).toFixed(3)})`);
          grad.addColorStop(1, "rgba(255,240,210,0)");
          ctx.fillStyle = grad;
          ctx.fillRect(sx - glowR, sy - glowR, glowR * 2, glowR * 2);

          ctx.beginPath();
          ctx.arc(sx, sy, 1.8, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255,248,230,${fade.toFixed(3)})`;
          ctx.fill();
        } else if (mag < 4.5) {
          ctx.beginPath();
          ctx.arc(sx, sy, 1.4, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(220,230,255,${(0.95 * fade).toFixed(3)})`;
          ctx.fill();
        } else if (mag < 5.5) {
          ctx.beginPath();
          ctx.arc(sx, sy, 1.0, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(210,220,255,${(0.85 * fade).toFixed(3)})`;
          ctx.fill();
        } else {
          ctx.beginPath();
          ctx.arc(sx, sy, 0.7, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(200,210,255,${(0.65 * fade).toFixed(3)})`;
          ctx.fill();
        }
      }
    };

    draw();
    return () => cancelAnimationFrame(animRef.current);
  }, []);

  // -------------------------------------------------------------------------
  // Worker
  // -------------------------------------------------------------------------

  const runGeneration = useCallback((p: SkyGenParams) => {
    // Terminate any existing worker
    workerRef.current?.terminate();
    setGenerating(true);
    setProgressStage("density");
    setProgressPct(0);
    setExported(false);

    const worker = new Worker(new URL("./worker.ts", import.meta.url));
    workerRef.current = worker;

    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      if (msg.type === "progress") {
        setProgressStage(msg.stage);
        setProgressPct(msg.pct);
      } else if (msg.type === "done") {
        starsRef.current = msg.field.stars;

        // Precompute edge fade per star (stars at r>1.0 are over-horizon, invisible)
        const fadeArr = new Float32Array(msg.field.stars.length);
        for (let i = 0; i < msg.field.stars.length; i++) {
          const s = msg.field.stars[i] as StarOutput;
          const projR = Math.sqrt(s.x * s.x + s.y * s.y);
          if (projR >= 1.0) { fadeArr[i] = 0; continue; }
          fadeArr[i] = projR > 0.7 ? Math.max(0, (1 - projR) / 0.3) : 1;
        }
        edgeFadeRef.current = fadeArr;

        setMetrics(msg.field.metrics);
        setStarCount(msg.field.stars.length);
        setGenerating(false);
        worker.terminate();
      }
    };

    worker.postMessage({ type: "generate", params: p } satisfies WorkerRequest);
  }, []);

  // Auto-run on mount
  useEffect(() => {
    runGeneration(DEFAULT_SKY_PARAMS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -------------------------------------------------------------------------
  // Pointer interactions
  // -------------------------------------------------------------------------

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    isDragging.current = true;
    isShift.current = e.shiftKey;
    lastMouse.current = { x: e.clientX, y: e.clientY };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging.current) return;
    const dx = e.clientX - lastMouse.current.x;
    const dy = e.clientY - lastMouse.current.y;
    lastMouse.current = { x: e.clientX, y: e.clientY };
    if (isShift.current) {
      spinRef.current += dx * 0.005;
    } else {
      panRef.current = { x: panRef.current.x + dx, y: panRef.current.y + dy };
    }
  }, []);

  const onPointerUp = useCallback(() => { isDragging.current = false; }, []);

  const onDoubleClick = useCallback(() => {
    panRef.current = { x: 0, y: 0 };
    zoomRef.current = 1;
    spinRef.current = 0;
  }, []);

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.93 : 1.07;
    zoomRef.current = Math.max(0.3, Math.min(6, zoomRef.current * factor));
  }, []);

  // -------------------------------------------------------------------------
  // Param update helper
  // -------------------------------------------------------------------------

  const updateParam = useCallback(<K extends keyof SkyGenParams>(key: K, value: SkyGenParams[K]) => {
    setParams(prev => {
      const next = { ...prev, [key]: value };
      paramsRef.current = next;
      return next;
    });
  }, []);

  // -------------------------------------------------------------------------
  // Controls
  // -------------------------------------------------------------------------

  const handleGenerate = useCallback(() => {
    runGeneration(paramsRef.current);
  }, [runGeneration]);

  const handleExport = useCallback(() => {
    const field: SkyField = {
      version: 2,
      params: paramsRef.current,
      stars: starsRef.current,
      metrics: metrics ?? {
        clusterDominanceScore: 0,
        nearestNeighbourCV: 0,
        maxVoidRadius: 0,
        edgeGradientRatio: 0,
      },
    };
    const blob = new Blob([JSON.stringify(field, null, 2)], { type: "application/json" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = "skyfield.json"; a.click();
    URL.revokeObjectURL(url);
    setExported(true);
  }, [metrics]);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="flex h-screen w-screen bg-[#05060a] text-white overflow-hidden">

      {/* Left panel */}
      <div className="w-72 flex-shrink-0 flex flex-col gap-4 p-5 border-r border-white/10 overflow-y-auto">
        <div>
          <h1 className="text-sm font-semibold text-gray-200 tracking-widest uppercase">
            Sky Generator v2.1
          </h1>
          <p className="text-xs text-gray-500 mt-1">
            Drag to pan · Shift+drag to spin · Scroll to zoom · Double-click to reset view
          </p>
        </div>

        {/* Seed */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-400">Seed</label>
          <input
            type="number" value={params.seed}
            onChange={e => updateParam("seed", parseInt(e.target.value) || 0)}
            className="bg-white/5 border border-white/10 rounded px-2 py-1 text-sm text-white w-full"
          />
        </div>

        {/* Sliders */}
        <div className="flex flex-col gap-3">
          <p className="text-xs text-gray-500 uppercase tracking-widest">Field</p>

          <Slider label="Warp" value={params.warpStrength}
            min={0} max={0.8} step={0.01}
            onChange={v => updateParam("warpStrength", v)} />

          <Slider label="Band" value={params.bandStrength}
            min={0} max={0.3} step={0.005}
            onChange={v => updateParam("bandStrength", v)} />

          <Slider label="Band angle" value={params.bandAngle}
            min={0} max={Math.PI} step={0.01}
            onChange={v => updateParam("bandAngle", v)}
            fmt={v => `${(v * 180 / Math.PI).toFixed(0)}\u00b0`} />

          <Slider label="Edge falloff start" value={params.edgeFalloffStart}
            min={0.55} max={1.0} step={0.01}
            onChange={v => updateParam("edgeFalloffStart", v)} />

          <Slider label="Contrast" value={params.contrastGamma}
            min={1.0} max={3.0} step={0.05}
            onChange={v => updateParam("contrastGamma", v)}
            fmt={v => v.toFixed(2)} />

          <Slider label="Void count" value={params.voidCount}
            min={0} max={4} step={1}
            onChange={v => updateParam("voidCount", Math.round(v))}
            fmt={v => String(Math.round(v))} />

          <Slider label="Void strength" value={params.voidStrength}
            min={0} max={1} step={0.05}
            onChange={v => updateParam("voidStrength", v)}
            fmt={v => v.toFixed(2)} />
        </div>

        <div className="flex flex-col gap-3">
          <p className="text-xs text-gray-500 uppercase tracking-widest">Placement</p>

          <Slider label="Spacing" value={params.baseSeparation}
            min={0.018} max={0.04} step={0.0005}
            onChange={v => updateParam("baseSeparation", v)} />

          <Slider label="Relaxation passes" value={params.relaxIterations}
            min={0} max={40} step={1}
            onChange={v => updateParam("relaxIterations", Math.round(v))}
            fmt={v => String(Math.round(v))} />

          <Slider label="Close pairs" value={params.pairFraction}
            min={0} max={0.15} step={0.002}
            onChange={v => updateParam("pairFraction", v)}
            fmt={v => `${(v * 100).toFixed(1)}%`} />

          <Slider label="Spacing jitter" value={params.spacingJitter}
            min={0} max={1} step={0.05}
            onChange={v => updateParam("spacingJitter", v)}
            fmt={v => `\u00b1${(v * 100).toFixed(0)}%`} />
        </div>

        {/* Progress */}
        {generating && (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-indigo-300">{stageLabel(progressStage)}</p>
            <div className="w-full h-1 bg-white/10 rounded overflow-hidden">
              <div
                className="h-full bg-indigo-500 transition-all duration-100"
                style={{ width: `${(progressPct * 100).toFixed(1)}%` }}
              />
            </div>
          </div>
        )}

        {/* Buttons */}
        <div className="flex flex-col gap-2">
          <button onClick={handleGenerate} disabled={generating}
            className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40
                       text-white text-sm font-medium py-2 rounded transition-colors">
            {generating ? "Generating\u2026" : "Generate"}
          </button>
          <button onClick={handleExport} disabled={generating || starCount === 0}
            className="bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40
                       text-white text-sm font-medium py-2 rounded transition-colors">
            Export skyfield.json
          </button>
        </div>

        {/* Stats */}
        <div className="text-xs text-gray-600 space-y-1">
          <div className="flex justify-between">
            <span>Stars placed</span>
            <span className="text-gray-400">{starCount.toLocaleString()}</span>
          </div>
          {exported && (
            <div className="flex justify-between">
              <span>Exported</span>
              <span className="text-emerald-400">skyfield.json</span>
            </div>
          )}
        </div>

        {/* Metrics */}
        {metrics && !generating && (
          <div className="flex flex-col gap-2 pt-2 border-t border-white/10">
            <p className="text-xs text-gray-500 uppercase tracking-widest">Metrics</p>
            <MetricRow
              label="Cluster dominance"
              value={metrics.clusterDominanceScore}
              fmt={v => v.toFixed(2)}
              color={metricsCDS(metrics.clusterDominanceScore)}
            />
            <MetricRow
              label="NN uniformity (CV)"
              value={metrics.nearestNeighbourCV}
              fmt={v => v.toFixed(3)}
              color={metricsNNCV(metrics.nearestNeighbourCV)}
            />
            <MetricRow
              label="Max void radius"
              value={metrics.maxVoidRadius}
              fmt={v => v.toFixed(3)}
              color={metricsVoid(metrics.maxVoidRadius)}
            />
            <MetricRow
              label="Edge gradient ratio"
              value={metrics.edgeGradientRatio}
              fmt={v => v.toFixed(3)}
              color="yellow"
            />
          </div>
        )}
      </div>

      {/* Canvas */}
      <div className="flex-1 relative">
        <canvas
          ref={canvasRef}
          className="w-full h-full cursor-grab active:cursor-grabbing"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
          onWheel={onWheel}
          onDoubleClick={onDoubleClick}
        />
        {generating && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="text-gray-500 text-sm">{stageLabel(progressStage)}</span>
          </div>
        )}
      </div>
    </div>
  );
}
