// Session serialisation — localStorage auto-save, export, import, snapshots.

import type { SkyField } from "@project-skymap/library";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Snapshot {
  name:    string;
  history: number[]; // history[i] = starId assigned to chapter i
}

export interface Session {
  skyField:  SkyField;
  /** history[i] = starId of the (i+1)-th chapter assigned.
   *  history.length === number of chapters assigned so far (0–1189). */
  history:   number[];
  snapshots: Snapshot[];
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

const STORAGE_KEY = "skymap-assign-session";

interface Persisted {
  skyField:  SkyField;
  history:   number[];
  snapshots: Snapshot[];
}

export function saveSession(session: Session): void {
  if (typeof window === "undefined") return;
  try {
    const data: Persisted = {
      skyField:  session.skyField,
      history:   session.history,
      snapshots: session.snapshots,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
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
    if (!data.skyField || !Array.isArray(data.history)) return null;
    return {
      skyField:  data.skyField,
      history:   data.history,
      snapshots: data.snapshots ?? [],
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
  return { skyField, history: [], snapshots: [] };
}

// ---------------------------------------------------------------------------
// Snapshot management
// ---------------------------------------------------------------------------

export function saveSnapshot(session: Session, name: string): Session {
  const snapshot: Snapshot = {
    name:    name.trim() || `Chapter ${session.history.length}`,
    history: [...session.history],
  };
  return { ...session, snapshots: [...session.snapshots, snapshot] };
}

export function restoreSnapshot(session: Session, index: number): Session {
  const snapshot = session.snapshots[index];
  if (!snapshot) return session;
  return { ...session, history: [...snapshot.history] };
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
  const data: Persisted = {
    skyField:  session.skyField,
    history:   session.history,
    snapshots: session.snapshots,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url;
  a.download = "skymap-session.json";
  a.click();
  URL.revokeObjectURL(url);
}

export async function importSession(file: File): Promise<Session> {
  const text = await file.text();
  const data = JSON.parse(text) as Persisted;
  if (!data.skyField || !Array.isArray(data.history)) {
    throw new Error("Invalid session file.");
  }
  return {
    skyField:  data.skyField,
    history:   data.history,
    snapshots: data.snapshots ?? [],
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
