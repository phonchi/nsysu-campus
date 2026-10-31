/** Versioned local saves: a save from a newer build is never overwritten, and the last good copy survives a corrupt write. */

export interface SaveStorage { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem?(key: string): void }
export const SAVE_VERSION = 1;
export const backupKey = (key: string) => `${key}:backup`;

export interface SaveRead { value?: unknown; existed: boolean; corrupt: boolean; recovered: boolean; locked: boolean }

const locked = new Set<string>();
/** Keys holding a save from a newer build; nothing is written to them this visit. */
export const lockedSaves = () => [...locked];
const isNewer = (value: unknown) => {
  const v = (value as { saveVersion?: unknown } | null)?.saveVersion;
  return typeof v === 'number' && v > SAVE_VERSION;
};
const parse = (raw: string | null) => {
  if (raw === null) return { ok: false as const };
  try { return { ok: true as const, value: JSON.parse(raw) as unknown }; } catch { return { ok: false as const }; }
};

/** Throws only when the storage itself refuses. */
export function readSave(storage: SaveStorage | undefined, key: string): SaveRead {
  const raw = storage?.getItem(key) ?? null;
  if (raw === null) return { existed: false, corrupt: false, recovered: false, locked: false };
  const main = parse(raw);
  if (main.ok) {
    if (isNewer(main.value)) { locked.add(key); return { existed: true, corrupt: false, recovered: false, locked: true }; }
    locked.delete(key);
    return { value: main.value, existed: true, corrupt: false, recovered: false, locked: false };
  }
  const backup = parse(storage?.getItem(backupKey(key)) ?? null);
  if (backup.ok && !isNewer(backup.value)) return { value: backup.value, existed: true, corrupt: true, recovered: true, locked: false };
  return { existed: true, corrupt: true, recovered: false, locked: false };
}

/** Keeps the previous good save as the backup, then writes. Returns false when a newer save blocked the write. */
export function writeSave(storage: SaveStorage | undefined, key: string, value: object) {
  if (!storage || locked.has(key)) return false;
  const previous = storage.getItem(key);
  if (previous !== null && parse(previous).ok) {
    try { storage.setItem(backupKey(key), previous); } catch { /* full storage: the save below matters more */ }
  }
  storage.setItem(key, JSON.stringify({ ...value, saveVersion: SAVE_VERSION }));
  return true;
}

/** Deliberate wipes also release the lock and forget the backup. */
export function removeSave(storage: SaveStorage | undefined, key: string) {
  locked.delete(key);
  storage?.removeItem?.(key);
  storage?.removeItem?.(backupKey(key));
}
