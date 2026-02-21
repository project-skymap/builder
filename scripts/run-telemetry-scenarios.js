#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHttp(url, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { redirect: "manual" });
      if (res.status >= 200 && res.status < 500) return;
    } catch {
      // keep polling
    }
    await sleep(400);
  }
  throw new Error(`Server did not become ready within ${timeoutMs}ms: ${url}`);
}

function ensurePlaywright() {
  try {
    // eslint-disable-next-line global-require
    return require("@playwright/test");
  } catch (error) {
    console.error("Missing @playwright/test in builder.");
    console.error("Install with: cd builder && npm i -D @playwright/test && npx playwright install chromium");
    throw error;
  }
}

async function setCheckbox(page, testId, checked) {
  const locator = page.getByTestId(testId);
  await locator.waitFor({ state: "visible", timeout: 15000 });
  if (await locator.isDisabled()) return;
  const current = await locator.isChecked();
  if (current === checked) return;
  if (checked) await locator.check({ force: true });
  else await locator.uncheck({ force: true });
}

async function performInteractionFlow(page) {
  const mapContainer = page.getByTestId("starmap-canvas");
  await mapContainer.waitFor({ state: "visible", timeout: 30000 });
  const box = await mapContainer.boundingBox();
  if (!box) throw new Error("Could not find starmap container bounds");

  const cx = box.x + box.width * 0.5;
  const cy = box.y + box.height * 0.5;

  async function drag(dx, dy, steps = 24, stepDelayMs = 12) {
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    for (let i = 1; i <= steps; i++) {
      await page.mouse.move(cx + (dx * i) / steps, cy + (dy * i) / steps);
      await sleep(stepDelayMs);
    }
    await page.mouse.up();
  }

  await drag(320, -140);
  await sleep(250);
  await drag(-260, 180);
  await sleep(250);

  for (let i = 0; i < 16; i++) {
    await page.mouse.wheel(0, -120);
    await sleep(55);
  }
  await sleep(250);
  for (let i = 0; i < 12; i++) {
    await page.mouse.wheel(0, 120);
    await sleep(55);
  }

  await page.mouse.click(cx + 100, cy - 40);
  await sleep(500);

  await drag(180, 120, 20, 14);
  await sleep(500);

  // Ensure we get enough 1Hz telemetry samples.
  await sleep(9000);
}

async function recordScenario(page, config) {
  await page.goto(config.url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => {
    return (
      typeof window.__skymapTelemetryExport === "function" &&
      typeof window.__skymapTelemetryStart === "function" &&
      typeof window.__skymapTelemetryStop === "function" &&
      typeof window.__skymapTelemetryClear === "function" &&
      typeof window.__skymapGetDebugState === "function"
    );
  }, { timeout: 30000 });
  try {
    await page.waitForFunction(() => {
      const get = window.__skymapGetDebugState;
      if (typeof get !== "function") return false;
      const debug = get();
      return Boolean(debug && typeof debug === "object");
    }, { timeout: 12000 });
  } catch {
    console.warn("Debug state not ready in time; continuing telemetry run.");
  }

  await setCheckbox(page, "toggle-engine-next", config.useEngineNext);
  await setCheckbox(page, "toggle-tile-streaming", config.useEngineNext && config.useTileStreaming);

  const sessionInput = page.getByTestId("input-telemetry-session-name");
  await sessionInput.fill(config.sessionName);

  await page.evaluate(() => {
    const clear = window.__skymapTelemetryClear;
    const start = window.__skymapTelemetryStart;
    if (typeof clear === "function") clear();
    if (typeof start !== "function") throw new Error("window.__skymapTelemetryStart is unavailable");
    start();
  });

  const startedAt = Date.now();
  let pollRunning = true;
  const debugSamples = [];
  const poller = (async () => {
    while (pollRunning) {
      const debug = await page.evaluate(() => {
        const get = window.__skymapGetDebugState;
        if (typeof get !== "function") return null;
        return get();
      });
      debugSamples.push({
        tMs: Date.now() - startedAt,
        debug: debug && typeof debug === "object" ? debug : null,
      });
      await sleep(1000);
    }
  })();

  await performInteractionFlow(page);

  await page.evaluate(() => {
    const stop = window.__skymapTelemetryStop;
    if (typeof stop !== "function") throw new Error("window.__skymapTelemetryStop is unavailable");
    stop();
  });
  pollRunning = false;
  await poller;
  await sleep(1200);

  const payload = await page.evaluate(() => {
    const fn = window.__skymapTelemetryExport;
    if (typeof fn !== "function") return null;
    return fn();
  });

  if (!payload || typeof payload !== "object") {
    throw new Error("Telemetry payload unavailable on window.__skymapTelemetryExport");
  }

  if (Array.isArray(payload.samples)) {
    for (let i = 0; i < payload.samples.length; i++) {
      const sample = payload.samples[i];
      if (!sample || typeof sample !== "object") continue;
      if (sample.debug && typeof sample.debug === "object") continue;
      const fallback = debugSamples[Math.min(i, debugSamples.length - 1)]?.debug ?? null;
      sample.debug = fallback;
    }
  }

  const debugCount = Array.isArray(payload.samples)
    ? payload.samples.filter((s) => s && typeof s.debug === "object" && s.debug !== null).length
    : 0;
  if (debugCount === 0) {
    throw new Error(
      `No debug samples were captured for scenario \"${config.sessionName}\". ` +
      "This usually means WebGL/engine init failed in automation mode.",
    );
  }

  return payload;
}

async function main() {
  const playwright = ensurePlaywright();
  const { chromium } = playwright;

  const repoRoot = path.resolve(__dirname, "..", "..");
  const builderDir = path.resolve(__dirname, "..");
  const miscDir = path.resolve(repoRoot, "misc");

  const port = Number(process.env.SKYMAP_TELEMETRY_PORT || 3200);
  const baseUrl = process.env.SKYMAP_TELEMETRY_URL || `http://127.0.0.1:${port}`;
  const shouldStartServer = process.env.SKYMAP_TELEMETRY_REUSE_SERVER !== "1";
  const headless = process.env.SKYMAP_TELEMETRY_HEADLESS === "1";

  let server = null;
  if (shouldStartServer) {
    server = spawn("npm", ["run", "dev", "--", "--port", String(port)], {
      cwd: builderDir,
      stdio: "inherit",
      env: { ...process.env, NEXT_PUBLIC_BASE_PATH: "" },
    });
    await waitForHttp(baseUrl, 120000);
  }

  const browser = await chromium.launch({
    headless,
    args: [
      "--use-angle=swiftshader",
      "--enable-webgl",
      "--ignore-gpu-blocklist",
    ],
  });
  const context = await browser.newContext({ viewport: { width: 1536, height: 960 } });
  const page = await context.newPage();

  try {
    const baseline = await recordScenario(page, {
      url: baseUrl,
      sessionName: "engine-next-no-tiles",
      useEngineNext: true,
      useTileStreaming: false,
    });

    fs.writeFileSync(
      path.join(miscDir, "telemetry-session-unchecked-engine-next.json"),
      `${JSON.stringify(baseline, null, 2)}\n`,
      "utf8",
    );

    const candidate = await recordScenario(page, {
      url: baseUrl,
      sessionName: "engine-next",
      useEngineNext: true,
      useTileStreaming: true,
    });

    fs.writeFileSync(
      path.join(miscDir, "telemetry-session-engine-next.json"),
      `${JSON.stringify(candidate, null, 2)}\n`,
      "utf8",
    );

    const compare = spawnSync(
      "npm",
      [
        "run",
        "telemetry:compare",
        "--",
        "../misc/telemetry-session-unchecked-engine-next.json",
        "../misc/telemetry-session-engine-next.json",
        "--save-md=../misc/telemetry-comparison-latest.md",
      ],
      {
        cwd: builderDir,
        stdio: "inherit",
      },
    );

    if (compare.status !== 0) {
      throw new Error(`telemetry:compare failed with exit code ${compare.status}`);
    }

    const guard = spawnSync(
      "npm",
      [
        "run",
        "telemetry:guard",
        "--",
        "../misc/telemetry-session-unchecked-engine-next.json",
        "../misc/telemetry-session-engine-next.json",
        "scripts/telemetry-thresholds.json",
      ],
      {
        cwd: builderDir,
        stdio: "inherit",
      },
    );

    if (guard.status !== 0) {
      throw new Error(`telemetry:guard failed with exit code ${guard.status}`);
    }

    console.log("Telemetry scenarios complete.");
    console.log(`Baseline: ${path.join(miscDir, "telemetry-session-unchecked-engine-next.json")}`);
    console.log(`Candidate: ${path.join(miscDir, "telemetry-session-engine-next.json")}`);
    console.log(`Report: ${path.join(miscDir, "telemetry-comparison-latest.md")}`);
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
    if (server) {
      server.kill("SIGTERM");
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
