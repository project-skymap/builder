// Flat canonical list of all 1,189 Bible chapters, derived from bible.json.

import bibleRaw from "../../public/bible.json";

export interface Chapter {
  globalIndex:   number;  // 0–1188
  bookIndex:     number;  // 0–65
  bookKey:       string;  // "GEN", "PSA", etc.
  bookName:      string;  // "Genesis", "Psalms", etc.
  chapterNumber: number;  // 1-based within book
  bookTotal:     number;  // total chapters in this book
  divisionName:  string;  // "The Law", "History", etc.
  testament:     "Old" | "New";
}

export interface Book {
  index:            number;
  key:              string;
  name:             string;
  chapterCount:     number;
  startGlobalIndex: number;
  endGlobalIndex:   number; // inclusive
  divisionName:     string;
  testament:        "Old" | "New";
}

// ---------------------------------------------------------------------------
// Build at module load — cheap, synchronous
// ---------------------------------------------------------------------------

function buildCanon(): { chapters: Chapter[]; books: Book[] } {
  const chapters: Chapter[] = [];
  const books: Book[] = [];
  let globalIndex = 0;
  let bookIndex = 0;

  for (const testament of bibleRaw.testaments) {
    const t = testament.name as "Old" | "New";
    for (const division of testament.divisions) {
      for (const book of division.books) {
        const startGlobalIndex = globalIndex;

        for (let ch = 1; ch <= book.chapters; ch++) {
          chapters.push({
            globalIndex,
            bookIndex,
            bookKey:       book.key,
            bookName:      book.name,
            chapterNumber: ch,
            bookTotal:     book.chapters,
            divisionName:  division.name,
            testament:     t,
          });
          globalIndex++;
        }

        books.push({
          index: bookIndex,
          key:              book.key,
          name:             book.name,
          chapterCount:     book.chapters,
          startGlobalIndex,
          endGlobalIndex:   globalIndex - 1,
          divisionName:     division.name,
          testament:        t,
        });

        bookIndex++;
      }
    }
  }

  return { chapters, books };
}

const { chapters, books } = buildCanon();

/** Flat list of all 1,189 chapters in canonical order. */
export const CANON: Chapter[] = chapters;

/** All 66 books in canonical order. */
export const BOOKS: Book[] = books;

/** Safe chapter accessor — returns undefined for out-of-range indices. */
export function getChapter(index: number): Chapter | undefined {
  if (index < 0 || index >= CANON.length) return undefined;
  return CANON[index];
}

/** Safe book accessor. */
export function getBook(index: number): Book | undefined {
  if (index < 0 || index >= BOOKS.length) return undefined;
  return BOOKS[index];
}
