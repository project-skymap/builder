#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

function toNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function mean(values) {
  if (!values.length) return null;
  let total = 0;
  for (const v of values) total += v;
  return total / values.length;
}

function trimmedMean(values, trimRatio = 0.1) {
  if (!values.length) return null;
  if (values.length < 10) return mean(values);
  const sorted = [...values].sort((a, b) => a - b);
  const trim = Math.max(0, Math.floor(sorted.length * trimRatio));
  const sliced = sorted.slice(trim, Math.max(trim + 1, sorted.length - trim));
  return mean(sliced);
}

function readJson(filePath) {
  const abs = path.resolve(process.cwd(), filePath);
  return { abs, data: JSON.parse(fs.readFileSync(abs, "utf8")) };
}

function extractMetrics(payload) {
  const samples = Array.isArray(payload.samples) ? payload.samples : [];
  const fps = [];
  const frameMs = [];
  const renderMs = [];
  const updateMs = [];

  for (const sample of samples) {
    const f = toNumber(sample?.fps);
    if (f !== null) fps.push(f);
    const fm = toNumber(sample?.frameMs);
    if (fm !== null) frameMs.push(fm);
    const rm = toNumber(sample?.debug?.renderMs);
    if (rm !== null) renderMs.push(rm);
    const um = toNumber(sample?.debug?.updateMs);
    if (um !== null) updateMs.push(um);
  }

  return {
    fpsMean: mean(fps),
    frameMsMean: mean(frameMs),
    frameMsRobustMean: trimmedMean(frameMs),
    renderMsMean: mean(renderMs),
    renderMsRobustMean: trimmedMean(renderMs),
    updateMsMean: mean(updateMs),
    updateMsRobustMean: trimmedMean(updateMs),
    sampleCount: samples.length,
    debugCount: samples.filter((s) => s && s.debug && typeof s.debug === "object").length,
  };
}

function pctDelta(base, candidate) {
  if (base === null || candidate === null || base === 0) return null;
  return ((candidate - base) / base) * 100;
}

function fmt(value, digits = 2) {
  return value === null ? "n/a" : value.toFixed(digits);
}

function fail(reason, details) {
  console.error(`FAIL: ${reason}`);
  if (details) console.error(details);
}

function main() {
  const baselinePath = process.argv[2] || "../misc/telemetry-session-unchecked-engine-next.json";
  const candidatePath = process.argv[3] || "../misc/telemetry-session-engine-next.json";
  const thresholdPath = process.argv[4] || "scripts/telemetry-thresholds.json";

  const baseline = readJson(baselinePath);
  const candidate = readJson(candidatePath);
  const thresholds = readJson(thresholdPath).data;

  const b = extractMetrics(baseline.data);
  const c = extractMetrics(candidate.data);

  console.log("Telemetry guard summary");
  console.log(`  baseline:  ${baseline.abs}`);
  console.log(`  candidate: ${candidate.abs}`);
  console.log(`  samples:   ${b.sampleCount} -> ${c.sampleCount}`);
  console.log(`  fps mean:        ${fmt(b.fpsMean)} -> ${fmt(c.fpsMean)}`);
  console.log(`  frame ms mean:   ${fmt(b.frameMsMean)} -> ${fmt(c.frameMsMean)}`);
  console.log(`  frame ms robust: ${fmt(b.frameMsRobustMean)} -> ${fmt(c.frameMsRobustMean)}`);
  console.log(`  render ms mean:  ${fmt(b.renderMsMean)} -> ${fmt(c.renderMsMean)}`);
  console.log(`  render ms robust:${fmt(b.renderMsRobustMean)} -> ${fmt(c.renderMsRobustMean)}`);
  console.log(`  update ms mean:  ${fmt(b.updateMsMean)} -> ${fmt(c.updateMsMean)}`);
  console.log(`  update ms robust:${fmt(b.updateMsRobustMean)} -> ${fmt(c.updateMsRobustMean)}`);

  let failed = false;

  if (thresholds.require_debug_metrics) {
    if (b.debugCount === 0 || c.debugCount === 0) {
      failed = true;
      fail("missing debug metrics in one or both sessions", `debug counts baseline/candidate: ${b.debugCount}/${c.debugCount}`);
    }
  }

  const fpsDelta = pctDelta(b.fpsMean, c.fpsMean);
  if (fpsDelta !== null && fpsDelta < thresholds.fps_mean_min_delta_pct) {
    failed = true;
    fail(
      `fps mean regression too high (${fpsDelta.toFixed(2)}% < ${thresholds.fps_mean_min_delta_pct}%)`,
      `baseline/candidate: ${fmt(b.fpsMean)} -> ${fmt(c.fpsMean)}`,
    );
  }

  const frameDelta = pctDelta(b.frameMsRobustMean, c.frameMsRobustMean);
  if (frameDelta !== null && frameDelta > thresholds.frame_ms_mean_max_delta_pct) {
    failed = true;
    fail(
      `frame ms increase too high (${frameDelta.toFixed(2)}% > ${thresholds.frame_ms_mean_max_delta_pct}%)`,
      `baseline/candidate robust means: ${fmt(b.frameMsRobustMean)} -> ${fmt(c.frameMsRobustMean)}`,
    );
  }

  const renderDelta = pctDelta(b.renderMsRobustMean, c.renderMsRobustMean);
  if (renderDelta !== null && renderDelta > thresholds.render_ms_mean_max_delta_pct) {
    failed = true;
    fail(
      `render ms increase too high (${renderDelta.toFixed(2)}% > ${thresholds.render_ms_mean_max_delta_pct}%)`,
      `baseline/candidate robust means: ${fmt(b.renderMsRobustMean)} -> ${fmt(c.renderMsRobustMean)}`,
    );
  }

  const updateDelta = pctDelta(b.updateMsRobustMean, c.updateMsRobustMean);
  if (updateDelta !== null && updateDelta > thresholds.update_ms_mean_max_delta_pct) {
    failed = true;
    fail(
      `update ms increase too high (${updateDelta.toFixed(2)}% > ${thresholds.update_ms_mean_max_delta_pct}%)`,
      `baseline/candidate robust means: ${fmt(b.updateMsRobustMean)} -> ${fmt(c.updateMsRobustMean)}`,
    );
  }

  if (failed) {
    process.exitCode = 1;
    return;
  }

  console.log("PASS: telemetry thresholds satisfied");
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
