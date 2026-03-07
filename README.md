This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Constellation Artwork

To add constellation artwork:

1.  **Images:** Place transparent PNG images in `public/constellations/art/`.
2.  **Configuration:** Edit `public/constellations.json`.
3.  **Schema:**
    *   `id`: Unique ID (e.g., "GENESIS").
    *   `image`: Filename of the image (e.g., "genesis.png").
    *   `anchors`: Array of Node IDs (e.g., ["C:GEN:1", "C:GEN:50"]) to position the art.
    *   `radius`: Size of the artwork (approximate sky units).
    *   `rotationDeg`: Rotation in degrees.
    *   `fade`: Control zoom visibility (`zoomInStart` = start fading in, `zoomInEnd` = fully visible).

## Custom Constellation Line Topology

By default, chapter stars are connected sequentially (`1->2->3->...`) per book.
You can override this in `public/constellations.json` using `linePaths` and/or `lineSegments` on each constellation.

Example:

```json
{
  "id": "EXODUS",
  "linePaths": [
    { "weight": "bold", "nodes": ["C:EXO:1", "C:EXO:7", "C:EXO:12", "C:EXO:15"] },
    { "weight": "thin", "nodes": ["C:EXO:19", "C:EXO:20", "C:EXO:24"] }
  ],
  "lineSegments": [
    { "weight": "bold", "from": "C:EXO:7", "to": "C:EXO:20" },
    { "weight": "thin", "from": "C:EXO:12", "to": "C:EXO:31" }
  ]
}
```

Notes:
- `nodes` are chapter IDs from the scene model (`C:<BOOK_KEY>:<CHAPTER>`).
- Paths are expanded pairwise (`A->B`, `B->C`, ...).
- `lineSegments` lets you define explicit edges (`from`/`to`) for branch structures.
- `weight` is optional: `"thin" | "normal" | "bold"`.
- Duplicate edges are de-duplicated automatically (including reversed duplicates).
- If any custom topology (`linePaths` or `lineSegments`) is present for a book, sequential fallback linking is disabled for that book.
