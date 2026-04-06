// Session serialisation — localStorage auto-save, export, import, snapshots.

import type { SkyField } from "@project-skymap/library";
import type { ShapeArchetype } from "./archetypes";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Snapshot {
  name:           string;
  assignments:    Record<number, number>; // chapterGlobalIndex → starId
  cursor:         number;
  undoStack:      number[];
  bookArchetypes: Record<number, ShapeArchetype>;
}

export interface Session {
  skyField:    SkyField;
  /** chapterGlobalIndex → starId.  Any chapter can be assigned in any order. */
  assignments: Record<number, number>;
  /** Index of the chapter currently being placed (0–1188). */
  cursor:      number;
  /** Ordered list of chapterGlobalIndices, most-recently-assigned last. */
  undoStack:   number[];
  /** bookIndex → chosen shape archetype for that book. */
  bookArchetypes: Record<number, ShapeArchetype>;
  snapshots:   Snapshot[];
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

const STORAGE_KEY = "skymap-assign-session";

// Persisted shape — union of new + legacy (v1 used `history: number[]`).
interface Persisted {
  skyField:       SkyField;
  // Current format:
  assignments?:   Record<number, number>;
  cursor?:        number;
  undoStack?:     number[];
  bookArchetypes?: Record<number, ShapeArchetype>;
  // Legacy format (v1 used `history: number[]`):
  history?:       number[];
  snapshots:      Array<{
    name: string;
    assignments?:   Record<number, number>;
    cursor?:        number;
    undoStack?:     number[];
    bookArchetypes?: Record<number, ShapeArchetype>;
    history?:       number[];
  }>;
}

function convertSnapshotData(snap: Persisted["snapshots"][number]): Snapshot {
  if (snap.assignments !== undefined) {
    return {
      name:           snap.name,
      assignments:    snap.assignments,
      cursor:         snap.cursor ?? 0,
      undoStack:      snap.undoStack ?? [],
      bookArchetypes: snap.bookArchetypes ?? {},
    };
  }
  // Convert legacy history[]
  const history = snap.history ?? [];
  const assignments: Record<number, number> = {};
  for (let i = 0; i < history.length; i++) {
    assignments[i] = history[i]!;
  }
  return {
    name:           snap.name,
    assignments,
    cursor:         history.length,
    undoStack:      history.map((_, i) => i),
    bookArchetypes: {},
  };
}

function parseData(data: Persisted): {
  assignments:    Record<number, number>;
  cursor:         number;
  undoStack:      number[];
  bookArchetypes: Record<number, ShapeArchetype>;
} | null {
  if (data.assignments !== undefined) {
    return {
      assignments:    data.assignments,
      cursor:         data.cursor ?? 0,
      undoStack:      data.undoStack ?? [],
      bookArchetypes: data.bookArchetypes ?? {},
    };
  }
  if (Array.isArray(data.history)) {
    const assignments: Record<number, number> = {};
    for (let i = 0; i < data.history.length; i++) {
      assignments[i] = data.history[i]!;
    }
    return {
      assignments,
      cursor:         data.history.length,
      undoStack:      data.history.map((_, i) => i),
      bookArchetypes: {},
    };
  }
  return null;
}

export function saveSession(session: Session): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Storage quota — silently ignore.
  }
}

export function loadSession(): Session | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Persisted;
    if (!data.skyField) return null;
    const parsed = parseData(data);
    if (!parsed) return null;
    return {
      skyField:  data.skyField,
      snapshots: (data.snapshots ?? []).map(convertSnapshotData),
      ...parsed,
    };
  } catch {
    return null;
  }
}

export function clearSession(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
}

// ---------------------------------------------------------------------------
// New session from a freshly loaded SkyField
// ---------------------------------------------------------------------------

export function createSession(skyField: SkyField): Session {
  return { skyField, assignments: {}, cursor: 0, undoStack: [], bookArchetypes: {}, snapshots: [] };
}

// ---------------------------------------------------------------------------
// Snapshot management
// ---------------------------------------------------------------------------

export function saveSnapshot(session: Session, name: string): Session {
  const snapshot: Snapshot = {
    name:           name.trim() || `Chapter ${session.cursor}`,
    assignments:    { ...session.assignments },
    cursor:         session.cursor,
    undoStack:      [...session.undoStack],
    bookArchetypes: { ...session.bookArchetypes },
  };
  return { ...session, snapshots: [...session.snapshots, snapshot] };
}

export function restoreSnapshot(session: Session, index: number): Session {
  const snapshot = session.snapshots[index];
  if (!snapshot) return session;
  return {
    ...session,
    assignments:    { ...snapshot.assignments },
    cursor:         snapshot.cursor,
    undoStack:      [...snapshot.undoStack],
    bookArchetypes: { ...snapshot.bookArchetypes },
  };
}

export function deleteSnapshot(session: Session, index: number): Session {
  return {
    ...session,
    snapshots: session.snapshots.filter((_, i) => i !== index),
  };
}

// ---------------------------------------------------------------------------
// Export / import
// ---------------------------------------------------------------------------

export function exportSession(session: Session): void {
  const blob = new Blob([JSON.stringify(session, null, 2)], { type: "application/json" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = "skymap-session.json";
  a.click();
  URL.revokeObjectURL(url);
}

export async function importSession(file: File): Promise<Session> {
  const text = await file.text();
  const data = JSON.parse(text) as Persisted;
  if (!data.skyField) throw new Error("Invalid session file.");
  const parsed = parseData(data);
  if (!parsed) throw new Error("Invalid session file.");
  return {
    skyField:  data.skyField,
    snapshots: (data.snapshots ?? []).map(convertSnapshotData),
    ...parsed,
  };
}

/** Load just a SkyField (from the generator's export). */
export async function importSkyField(file: File): Promise<SkyField> {
  const text = await file.text();
  const data = JSON.parse(text) as SkyField;
  if (!data.stars || !Array.isArray(data.stars)) {
    throw new Error("Invalid sky field file.");
  }
  return data;
}
