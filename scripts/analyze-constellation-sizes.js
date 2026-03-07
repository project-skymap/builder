#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readPngSize(filePath) {
  const buf = fs.readFileSync(filePath);
  const sig = "89504e470d0a1a0a";
  if (buf.length < 24 || buf.subarray(0, 8).toString("hex") !== sig) {
    throw new Error(`Not a PNG: ${filePath}`);
  }
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
  };
}

function loadVerseMap(bible) {
  const map = new Map();
  for (const testament of bible.testaments) {
    for (const division of testament.divisions) {
      for (const book of division.books) {
        const verses = (book.verses || []).reduce((sum, v) => sum + v, 0);
        map.set(book.key, {
          key: book.key,
          name: book.name,
          verses,
          chapters: book.chapters,
        });
      }
    }
  }
  return map;
}

function parseBookKeyFromAnchor(anchor) {
  if (typeof anchor !== "string") return null;
  const parts = anchor.split(":");
  if (parts.length < 3) return null;
  return parts[1];
}

function fmt(n, digits = 2) {
  return Number.isFinite(n) ? n.toFixed(digits) : "n/a";
}

function pct(n) {
  return `${fmt(n, 2)}%`;
}

function main() {
  const root = path.resolve(__dirname, "..");
  const constellationsPath = path.join(root, "public", "constellations.json");
  const biblePath = path.join(root, "public", "bible.json");
  const artPath = path.join(root, "public", "constellations", "art");

  const config = readJson(constellationsPath);
  const bible = readJson(biblePath);
  const versesByBook = loadVerseMap(bible);

  const rows = [];
  const issues = [];

  for (const c of config.constellations) {
    const anchor = Array.isArray(c.anchors) ? c.anchors[0] : null;
    const bookKey = parseBookKeyFromAnchor(anchor);
    if (!bookKey) {
      issues.push(`Missing/invalid anchor for ${c.id}`);
      continue;
    }
    const book = versesByBook.get(bookKey);
    if (!book) {
      issues.push(`No bible book found for anchor key ${bookKey} (${c.id})`);
      continue;
    }

    const imageFile = path.join(artPath, c.image);
    if (!fs.existsSync(imageFile)) {
      issues.push(`Missing image file ${c.image} (${c.id})`);
      continue;
    }

    const { width, height } = readPngSize(imageFile);
    const aspectComp = Math.max(width, height) / Math.sqrt(width * height);
    const feature = Math.sqrt(book.verses) * aspectComp;

    rows.push({
      id: c.id,
      title: c.title,
      bookKey,
      verses: book.verses,
      chapters: book.chapters,
      width,
      height,
      aspectComp,
      configuredRadius: c.radius,
      feature,
    });
  }

  if (rows.length === 0) {
    console.error("No rows to analyze.");
    process.exit(1);
  }

  // Best-fit scale k minimizing squared error: radius ~= k * feature.
  const sumXY = rows.reduce((s, r) => s + r.configuredRadius * r.feature, 0);
  const sumXX = rows.reduce((s, r) => s + r.feature * r.feature, 0);
  const kFit = sumXX === 0 ? 0 : sumXY / sumXX;

  // Verse-only model: display radius proportional only to sqrt(verses).
  // This is useful for checking whether visual size ranking matches verse weight.
  const verseFeatureXX = rows.reduce((s, r) => s + r.verses, 0);
  const verseFeatureXY = rows.reduce(
    (s, r) => s + r.configuredRadius * Math.sqrt(r.verses),
    0
  );
  const kVerseOnly = verseFeatureXX === 0 ? 0 : verseFeatureXY / verseFeatureXX;

  for (const r of rows) {
    r.expectedRadius = kFit * r.feature;
    r.delta = r.configuredRadius - r.expectedRadius;
    r.deltaPct = r.expectedRadius === 0 ? 0 : (r.delta / r.expectedRadius) * 100;
    r.absDeltaPct = Math.abs(r.deltaPct);
    r.expectedVerseOnlyRadius = kVerseOnly * Math.sqrt(r.verses);
    r.verseOnlyDeltaPct =
      r.expectedVerseOnlyRadius === 0
        ? 0
        : ((r.configuredRadius - r.expectedVerseOnlyRadius) / r.expectedVerseOnlyRadius) * 100;
  }

  const byAbsDrift = [...rows].sort((a, b) => b.absDeltaPct - a.absDeltaPct);
  const byVerses = [...rows].sort((a, b) => b.verses - a.verses);
  const byRadius = [...rows].sort((a, b) => b.configuredRadius - a.configuredRadius);

  const verseRank = new Map(byVerses.map((r, i) => [r.id, i + 1]));
  const radiusRank = new Map(byRadius.map((r, i) => [r.id, i + 1]));

  const rankMismatch = rows
    .map((r) => ({
      ...r,
      verseRank: verseRank.get(r.id),
      radiusRank: radiusRank.get(r.id),
      rankGap: (radiusRank.get(r.id) || 0) - (verseRank.get(r.id) || 0),
    }))
    .sort((a, b) => Math.abs(b.rankGap) - Math.abs(a.rankGap));

  const rmsPct = Math.sqrt(
    rows.reduce((s, r) => s + r.deltaPct * r.deltaPct, 0) / rows.length
  );
  const meanAbsPct =
    rows.reduce((s, r) => s + Math.abs(r.deltaPct), 0) / rows.length;
  const meanAbsVerseOnlyPct =
    rows.reduce((s, r) => s + Math.abs(r.verseOnlyDeltaPct), 0) / rows.length;
  const rmsVerseOnlyPct = Math.sqrt(
    rows.reduce((s, r) => s + r.verseOnlyDeltaPct * r.verseOnlyDeltaPct, 0) / rows.length
  );
  const byVerseOnlyDrift = [...rows].sort(
    (a, b) => Math.abs(b.verseOnlyDeltaPct) - Math.abs(a.verseOnlyDeltaPct)
  );

  const genesis = rows.find((r) => r.id === "GENESIS");
  const exodus = rows.find((r) => r.id === "EXODUS");

  console.log("Constellation Size Accuracy Report");
  console.log("==================================");
  console.log(`Books analyzed: ${rows.length}`);
  console.log(`Best-fit scale k: ${fmt(kFit, 6)}`);
  console.log(`Mean absolute drift: ${pct(meanAbsPct)}`);
  console.log(`RMS drift: ${pct(rmsPct)}`);
  console.log(`Verse-only scale k: ${fmt(kVerseOnly, 6)}`);
  console.log(`Verse-only mean absolute drift: ${pct(meanAbsVerseOnlyPct)}`);
  console.log(`Verse-only RMS drift: ${pct(rmsVerseOnlyPct)}`);
  console.log("");

  if (genesis && exodus) {
    const verseRatio = exodus.verses / genesis.verses;
    const expectedRatio = exodus.expectedRadius / genesis.expectedRadius;
    const currentRatio = exodus.configuredRadius / genesis.configuredRadius;
    const currentVerseOnlyRatio = exodus.configuredRadius / genesis.configuredRadius;
    const expectedVerseOnlyRatio =
      exodus.expectedVerseOnlyRadius / genesis.expectedVerseOnlyRadius;
    console.log("Genesis vs Exodus");
    console.log("-----------------");
    console.log(`Verses: Genesis=${genesis.verses}, Exodus=${exodus.verses}`);
    console.log(`Verse ratio (Exo/Gen): ${fmt(verseRatio, 4)}`);
    console.log(`Expected radius ratio (Exo/Gen): ${fmt(expectedRatio, 4)}`);
    console.log(`Current radius ratio (Exo/Gen): ${fmt(currentRatio, 4)}`);
    console.log(
      `Difference vs expected: ${pct(((currentRatio - expectedRatio) / expectedRatio) * 100)}`
    );
    console.log(`Expected verse-only radius ratio (Exo/Gen): ${fmt(expectedVerseOnlyRatio, 4)}`);
    console.log(`Current verse-only radius ratio (Exo/Gen): ${fmt(currentVerseOnlyRatio, 4)}`);
    console.log(
      `Verse-only difference vs expected: ${pct(
        ((currentVerseOnlyRatio - expectedVerseOnlyRatio) / expectedVerseOnlyRatio) * 100
      )}`
    );
    console.log("");
  }

  console.log("Top 12 absolute drifts (configured vs expected)");
  console.log("-----------------------------------------------");
  for (const r of byAbsDrift.slice(0, 12)) {
    console.log(
      `${r.id.padEnd(14)} radius=${fmt(r.configuredRadius).padStart(8)} expected=${fmt(
        r.expectedRadius
      ).padStart(8)} drift=${pct(r.deltaPct).padStart(8)}`
    );
  }
  console.log("");

  console.log("Top 12 verse-only drifts (configured radius vs verse-only expectation)");
  console.log("----------------------------------------------------------------------");
  for (const r of byVerseOnlyDrift.slice(0, 12)) {
    console.log(
      `${r.id.padEnd(14)} radius=${fmt(r.configuredRadius).padStart(8)} expected=${fmt(
        r.expectedVerseOnlyRadius
      ).padStart(8)} drift=${pct(r.verseOnlyDeltaPct).padStart(8)}`
    );
  }
  console.log("");

  console.log("Top 12 verse-rank vs radius-rank mismatches");
  console.log("-------------------------------------------");
  for (const r of rankMismatch.slice(0, 12)) {
    const sign = r.rankGap > 0 ? "+" : "";
    console.log(
      `${r.id.padEnd(14)} verseRank=${String(r.verseRank).padStart(2)} radiusRank=${String(
        r.radiusRank
      ).padStart(2)} gap=${sign}${r.rankGap}`
    );
  }

  if (issues.length > 0) {
    console.log("");
    console.log("Data issues");
    console.log("-----------");
    for (const issue of issues) console.log(`- ${issue}`);
  }
}

main();
