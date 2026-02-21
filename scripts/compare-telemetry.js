#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

function toNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function loadJson(filePath) {
  const absolute = path.resolve(process.cwd(), filePath);
  const raw = fs.readFileSync(absolute, "utf8");
  const data = JSON.parse(raw);
  if (!data || typeof data !== "object") {
    throw new Error(`Invalid JSON object in ${filePath}`);
  }
  if (!Array.isArray(data.samples)) {
    throw new Error(`Missing samples array in ${filePath}`);
  }
  if (!Array.isArray(data.events)) {
    throw new Error(`Missing events array in ${filePath}`);
  }
  return { absolute, data };
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function mean(values) {
  if (!values.length) return null;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

function min(values) {
  if (!values.length) return null;
  let m = values[0];
  for (let i = 1; i < values.length; i++) m = Math.min(m, values[i]);
  return m;
}

function max(values) {
  if (!values.length) return null;
  let m = values[0];
  for (let i = 1; i < values.length; i++) m = Math.max(m, values[i]);
  return m;
}

function numericStats(values) {
  return {
    n: values.length,
    mean: mean(values),
    min: min(values),
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    max: max(values),
  };
}

function trimmedMean(values, trimRatio = 0.1) {
  if (!values.length) return null;
  if (values.length < 10) return mean(values);
  const sorted = [...values].sort((a, b) => a - b);
  const trim = Math.max(0, Math.floor(sorted.length * trimRatio));
  const sliced = sorted.slice(trim, Math.max(trim + 1, sorted.length - trim));
  return mean(sliced);
}

function eventCounts(events) {
  const counts = Object.create(null);
  for (const ev of events) {
    const key = ev && typeof ev.type === "string" ? ev.type : "unknown";
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function durationMs(samples, events) {
  let maxT = 0;
  for (const s of samples) {
    const t = toNumber(s?.tMs);
    if (t !== null) maxT = Math.max(maxT, t);
  }
  for (const e of events) {
    const t = toNumber(e?.tMs);
    if (t !== null) maxT = Math.max(maxT, t);
  }
  return maxT;
}

function collectFromSamples(samples, getter) {
  const out = [];
  for (const s of samples) {
    const v = getter(s);
    if (v !== null && Number.isFinite(v)) out.push(v);
  }
  return out;
}

function summarizeSession(payload) {
  const samples = payload.samples;
  const events = payload.events;

  const fpsValues = collectFromSamples(samples, (s) => toNumber(s?.fps));
  const frameMsValues = collectFromSamples(samples, (s) => toNumber(s?.frameMs));
  const updateMsValues = collectFromSamples(samples, (s) => toNumber(s?.debug?.updateMs));
  const renderMsValues = collectFromSamples(samples, (s) => toNumber(s?.debug?.renderMs));
  const fovDegValues = collectFromSamples(samples, (s) => toNumber(s?.debug?.fovDeg));

  const tileDesired = collectFromSamples(samples, (s) => toNumber(s?.debug?.tile?.desiredCount ?? s?.debug?.tile?.desired));
  const tileActive = collectFromSamples(samples, (s) => toNumber(s?.debug?.tile?.activeCount ?? s?.debug?.tile?.active));
  const tileLoaded = collectFromSamples(samples, (s) => toNumber(s?.debug?.tile?.loadedCount ?? s?.debug?.tile?.loaded));
  const tileInFlight = collectFromSamples(samples, (s) => toNumber(s?.debug?.tile?.inFlightCount ?? s?.debug?.tile?.inFlight));
  const tileQueue = collectFromSamples(samples, (s) => toNumber(s?.debug?.tile?.queueCount ?? s?.debug?.tile?.queue));
  const tileTransitioning = collectFromSamples(samples, (s) => {
    const value = s?.debug?.tile?.transitioning;
    if (typeof value === "boolean") return value ? 1 : 0;
    return toNumber(value);
  });

  return {
    meta: {
      version: payload.version,
      engineVariant: payload.engineVariant,
      tileStreamingEnabled: Boolean(payload.tileStreamingEnabled),
      sampleCount: samples.length,
      eventCount: events.length,
      durationMs: durationMs(samples, events),
      exportedAt: payload.exportedAt,
      sessionName: payload.sessionName || null,
    },
    perf: {
      fps: numericStats(fpsValues),
      frameMs: numericStats(frameMsValues),
      frameMsRobustMean: trimmedMean(frameMsValues),
      updateMs: numericStats(updateMsValues),
      updateMsRobustMean: trimmedMean(updateMsValues),
      renderMs: numericStats(renderMsValues),
      renderMsRobustMean: trimmedMean(renderMsValues),
      fovDeg: numericStats(fovDegValues),
    },
    tile: {
      desired: numericStats(tileDesired),
      active: numericStats(tileActive),
      loaded: numericStats(tileLoaded),
      inFlight: numericStats(tileInFlight),
      queue: numericStats(tileQueue),
      transitioning: numericStats(tileTransitioning),
    },
    events: eventCounts(events),
  };
}

function fmtNum(value, digits = 2) {
  return value === null || value === undefined ? "n/a" : value.toFixed(digits);
}

function fmtMs(ms) {
  if (ms === null || ms === undefined) return "n/a";
  if (ms < 1000) return `${ms.toFixed(0)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function deltaPercent(base, candidate, higherIsBetter = true) {
  if (base === null || candidate === null || base === 0) return null;
  const raw = ((candidate - base) / base) * 100;
  return higherIsBetter ? raw : -raw;
}

function fmtDelta(base, candidate, digits = 2, higherIsBetter = true) {
  if (base === null || candidate === null) return "n/a";
  const diff = candidate - base;
  const pct = deltaPercent(base, candidate, higherIsBetter);
  const sign = diff > 0 ? "+" : "";
  const abs = `${sign}${diff.toFixed(digits)}`;
  if (pct === null) return abs;
  const signPct = pct > 0 ? "+" : "";
  return `${abs} (${signPct}${pct.toFixed(1)}%)`;
}

function compareMetric(name, baseStats, candStats, options = {}) {
  const digits = options.digits ?? 2;
  const higherIsBetter = options.higherIsBetter ?? true;
  const baseValue = baseStats.mean;
  const candValue = candStats.mean;
  return {
    name,
    base: baseValue,
    candidate: candValue,
    delta: fmtDelta(baseValue, candValue, digits, higherIsBetter),
  };
}

function printSession(label, summary, source) {
  console.log(`\n${label}`);
  console.log(`  file: ${source}`);
  console.log(`  engine: ${summary.meta.engineVariant || "unknown"}`);
  console.log(`  tile streaming: ${summary.meta.tileStreamingEnabled ? "on" : "off"}`);
  console.log(`  duration: ${fmtMs(summary.meta.durationMs)}`);
  console.log(`  samples/events: ${summary.meta.sampleCount}/${summary.meta.eventCount}`);
  console.log(`  fps mean/p95: ${fmtNum(summary.perf.fps.mean, 2)} / ${fmtNum(summary.perf.fps.p95, 2)}`);
  console.log(`  frame mean/p95: ${fmtNum(summary.perf.frameMs.mean, 2)} / ${fmtNum(summary.perf.frameMs.p95, 2)} ms`);
  if (summary.perf.updateMs.n > 0 || summary.perf.renderMs.n > 0) {
    console.log(`  update/render mean: ${fmtNum(summary.perf.updateMs.mean, 2)} / ${fmtNum(summary.perf.renderMs.mean, 2)} ms`);
    console.log(
      `  update/render robust: ${fmtNum(summary.perf.updateMsRobustMean, 2)} / ${fmtNum(summary.perf.renderMsRobustMean, 2)} ms`,
    );
  }
  if (summary.tile.active.n > 0 || summary.tile.loaded.n > 0) {
    console.log(`  tile active mean/max: ${fmtNum(summary.tile.active.mean, 2)} / ${fmtNum(summary.tile.active.max, 0)}`);
    console.log(`  tile loaded mean/max: ${fmtNum(summary.tile.loaded.mean, 2)} / ${fmtNum(summary.tile.loaded.max, 0)}`);
    console.log(`  tile queue mean/max: ${fmtNum(summary.tile.queue.mean, 2)} / ${fmtNum(summary.tile.queue.max, 0)}`);
    console.log(`  tile in-flight mean/max: ${fmtNum(summary.tile.inFlight.mean, 2)} / ${fmtNum(summary.tile.inFlight.max, 0)}`);
  }
  const eventPairs = Object.entries(summary.events).sort((a, b) => b[1] - a[1]);
  if (eventPairs.length) {
    const line = eventPairs.map(([k, v]) => `${k}:${v}`).join(", ");
    console.log(`  events: ${line}`);
  }
}

function printComparison(base, candidate) {
  const metrics = [
    compareMetric("FPS (higher better)", base.perf.fps, candidate.perf.fps, { digits: 2, higherIsBetter: true }),
    {
      name: "Frame ms robust (lower better)",
      base: base.perf.frameMsRobustMean,
      candidate: candidate.perf.frameMsRobustMean,
      delta: fmtDelta(base.perf.frameMsRobustMean, candidate.perf.frameMsRobustMean, 2, false),
    },
    {
      name: "Update ms robust (lower better)",
      base: base.perf.updateMsRobustMean,
      candidate: candidate.perf.updateMsRobustMean,
      delta: fmtDelta(base.perf.updateMsRobustMean, candidate.perf.updateMsRobustMean, 2, false),
    },
    {
      name: "Render ms robust (lower better)",
      base: base.perf.renderMsRobustMean,
      candidate: candidate.perf.renderMsRobustMean,
      delta: fmtDelta(base.perf.renderMsRobustMean, candidate.perf.renderMsRobustMean, 2, false),
    },
    compareMetric("Tile queue (lower better)", base.tile.queue, candidate.tile.queue, { digits: 2, higherIsBetter: false }),
    compareMetric("Tile in-flight (context)", base.tile.inFlight, candidate.tile.inFlight, { digits: 2, higherIsBetter: false }),
    compareMetric("Tile loaded (context)", base.tile.loaded, candidate.tile.loaded, { digits: 2, higherIsBetter: true }),
  ];

  console.log("\nComparison (candidate vs baseline)");
  for (const m of metrics) {
    console.log(`  ${m.name}: ${fmtNum(m.base, 2)} -> ${fmtNum(m.candidate, 2)} | ${m.delta}`);
  }

  const keys = new Set([...Object.keys(base.events), ...Object.keys(candidate.events)]);
  if (keys.size > 0) {
    console.log("\nEvent deltas (candidate - baseline)");
    for (const key of [...keys].sort()) {
      const b = base.events[key] || 0;
      const c = candidate.events[key] || 0;
      const d = c - b;
      const sign = d > 0 ? "+" : "";
      console.log(`  ${key}: ${b} -> ${c} | ${sign}${d}`);
    }
  }
}

function markdownReport(baseLabel, baseSource, base, candLabel, candSource, cand) {
  const lines = [];
  lines.push("# Telemetry Comparison");
  lines.push("");
  lines.push("## Sessions");
  lines.push("");
  lines.push(`- Baseline: \`${baseLabel}\` (${baseSource})`);
  lines.push(`- Candidate: \`${candLabel}\` (${candSource})`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push("| Metric | Baseline | Candidate | Delta |");
  lines.push("|---|---:|---:|---:|");

  const rows = [
    ["FPS mean", base.perf.fps.mean, cand.perf.fps.mean, fmtDelta(base.perf.fps.mean, cand.perf.fps.mean, 2, true)],
    [
      "Frame ms robust",
      base.perf.frameMsRobustMean,
      cand.perf.frameMsRobustMean,
      fmtDelta(base.perf.frameMsRobustMean, cand.perf.frameMsRobustMean, 2, false),
    ],
    [
      "Update ms robust",
      base.perf.updateMsRobustMean,
      cand.perf.updateMsRobustMean,
      fmtDelta(base.perf.updateMsRobustMean, cand.perf.updateMsRobustMean, 2, false),
    ],
    [
      "Render ms robust",
      base.perf.renderMsRobustMean,
      cand.perf.renderMsRobustMean,
      fmtDelta(base.perf.renderMsRobustMean, cand.perf.renderMsRobustMean, 2, false),
    ],
    ["Tile queue mean", base.tile.queue.mean, cand.tile.queue.mean, fmtDelta(base.tile.queue.mean, cand.tile.queue.mean, 2, false)],
    ["Tile in-flight mean", base.tile.inFlight.mean, cand.tile.inFlight.mean, fmtDelta(base.tile.inFlight.mean, cand.tile.inFlight.mean, 2, false)],
    ["Tile loaded mean", base.tile.loaded.mean, cand.tile.loaded.mean, fmtDelta(base.tile.loaded.mean, cand.tile.loaded.mean, 2, true)],
  ];

  for (const [name, b, c, d] of rows) {
    lines.push(`| ${name} | ${fmtNum(b, 2)} | ${fmtNum(c, 2)} | ${d} |`);
  }

  lines.push("");
  lines.push("## Event Counts");
  lines.push("");
  lines.push("| Event | Baseline | Candidate | Delta |");
  lines.push("|---|---:|---:|---:|");
  const keys = [...new Set([...Object.keys(base.events), ...Object.keys(cand.events)])].sort();
  for (const key of keys) {
    const b = base.events[key] || 0;
    const c = cand.events[key] || 0;
    const d = c - b;
    const sign = d > 0 ? "+" : "";
    lines.push(`| ${key} | ${b} | ${c} | ${sign}${d} |`);
  }

  return `${lines.join("\n")}\n`;
}

function parseArgs(argv) {
  const args = [];
  const flags = new Set();
  for (const arg of argv) {
    if (arg.startsWith("--")) flags.add(arg);
    else args.push(arg);
  }
  return { args, flags };
}

function usage() {
  console.log("Usage: node scripts/compare-telemetry.js <baseline.json> <candidate.json> [--markdown] [--save-md=report.md]");
}

function main() {
  const { args, flags } = parseArgs(process.argv.slice(2));
  if (args.length < 2) {
    usage();
    process.exitCode = 1;
    return;
  }

  const baselinePath = args[0];
  const candidatePath = args[1];

  const baselineLoaded = loadJson(baselinePath);
  const candidateLoaded = loadJson(candidatePath);
  const baselineSummary = summarizeSession(baselineLoaded.data);
  const candidateSummary = summarizeSession(candidateLoaded.data);

  printSession("Baseline", baselineSummary, baselineLoaded.absolute);
  printSession("Candidate", candidateSummary, candidateLoaded.absolute);
  printComparison(baselineSummary, candidateSummary);

  const saveMdFlag = [...flags].find((f) => f.startsWith("--save-md="));
  const emitMarkdown = flags.has("--markdown") || Boolean(saveMdFlag);
  if (emitMarkdown) {
    const md = markdownReport(
      path.basename(baselineLoaded.absolute),
      baselineLoaded.absolute,
      baselineSummary,
      path.basename(candidateLoaded.absolute),
      candidateLoaded.absolute,
      candidateSummary,
    );
    if (saveMdFlag) {
      const target = saveMdFlag.slice("--save-md=".length);
      const out = path.resolve(process.cwd(), target);
      fs.writeFileSync(out, md, "utf8");
      console.log(`\nMarkdown report saved: ${out}`);
    } else {
      console.log("\n");
      console.log(md);
    }
  }
}

try {
  main();
} catch (error) {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
