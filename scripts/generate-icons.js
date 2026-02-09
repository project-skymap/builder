#!/usr/bin/env node
/**
 * Icon Generation Script
 *
 * Generates PNG icons from the SVG source for PWA manifest.
 *
 * Usage:
 *   node scripts/generate-icons.js
 *
 * Requirements:
 *   npm install sharp
 *
 * Or use an online tool like https://realfavicongenerator.net/
 * with the SVG at public/icons/icon.svg
 */

const fs = require('fs');
const path = require('path');

// Check if sharp is available
let sharp;
try {
  sharp = require('sharp');
} catch (e) {
  console.log('Sharp not installed. Install with: npm install sharp');
  console.log('');
  console.log('Alternative: Use an online favicon generator with public/icons/icon.svg');
  console.log('Recommended: https://realfavicongenerator.net/');
  process.exit(0);
}

const sizes = [192, 512];
const inputSvg = path.join(__dirname, '../public/icons/icon.svg');
const outputDir = path.join(__dirname, '../public/icons');

async function generateIcons() {
  console.log('Generating PNG icons from SVG...');

  for (const size of sizes) {
    const outputPath = path.join(outputDir, `icon-${size}.png`);

    await sharp(inputSvg)
      .resize(size, size)
      .png()
      .toFile(outputPath);

    console.log(`Created: icon-${size}.png`);
  }

  // Also create apple-touch-icon (180x180)
  await sharp(inputSvg)
    .resize(180, 180)
    .png()
    .toFile(path.join(outputDir, 'apple-touch-icon.png'));

  console.log('Created: apple-touch-icon.png');
  console.log('Done!');
}

generateIcons().catch(console.error);
