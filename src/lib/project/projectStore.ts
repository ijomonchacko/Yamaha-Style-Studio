/**
 * Project save / load — IndexedDB + downloadable .yssproj JSON.
 * Binaries are base64 so a single file round-trips offline.
 */

import { StyleMetaState } from "../../components/StyleMetadataForm";
import { StyleRole } from "../../components/ChannelMatrix";
import { KeySnapState } from "../../components/LivePreview";
import { StyleSection } from "../binary/sff2Writer";

const DB_NAME = "yamaha-style-studio";
const DB_VERSION = 1;
const STORE = "projects";
const AUTO_KEY = "autosave";

export interface ProjectSnapshot {
  version: 1;
  savedAt: string;
  ausName: string | null;
  ausB64: string | null;
  midis: {
    name: string;
    b64: string;
    trackIndex: number;
  }[];
  assignments: Record<number, StyleRole | "unassigned">;
  meta: StyleMetaState;
  keySnap: KeySnapState;
  roleSounds: Partial<Record<StyleRole, string>>;
  roleVolumes: Partial<Record<StyleRole, number>>;
  rolePans: Partial<Record<StyleRole, number>>;
  roleSections: Partial<Record<StyleRole, StyleSection>>;
  activeSection: string;
  requireAusCasm: boolean;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
  });
}

export async function saveProjectToIdb(key: string, snap: ProjectSnapshot): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(snap, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IDB write failed"));
  });
  db.close();
}

export async function loadProjectFromIdb(key: string): Promise<ProjectSnapshot | null> {
  const db = await openDb();
  const snap = await new Promise<ProjectSnapshot | null>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve((req.result as ProjectSnapshot) ?? null);
    req.onerror = () => reject(req.error ?? new Error("IDB read failed"));
  });
  db.close();
  return snap;
}

export async function autosaveProject(snap: ProjectSnapshot): Promise<void> {
  try {
    await saveProjectToIdb(AUTO_KEY, snap);
  } catch {
    /* ignore quota / private mode */
  }
}

export async function loadAutosave(): Promise<ProjectSnapshot | null> {
  try {
    return await loadProjectFromIdb(AUTO_KEY);
  } catch {
    return null;
  }
}

export function bytesToB64(bytes: Uint8Array): string {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(s);
}

export function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function downloadProjectFile(snap: ProjectSnapshot, name: string) {
  const safe = name.replace(/[^\w\-]+/g, "_") || "style_project";
  const blob = new Blob([JSON.stringify(snap)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${safe}.yssproj`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function readProjectFile(file: File): Promise<ProjectSnapshot> {
  const text = await file.text();
  const data = JSON.parse(text) as ProjectSnapshot;
  if (!data || data.version !== 1) throw new Error("Unsupported project file version.");
  return data;
}
