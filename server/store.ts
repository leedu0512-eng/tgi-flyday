// Saves the session setup, pilots, heat slots and the session clock to data/flyday.json,
// so a restart carries on where it was.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { SavedData } from './types.ts';

export function load(file: string): Partial<SavedData> {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (err: any) {
    if (err?.code !== 'ENOENT') console.warn(`Could not read ${file}, starting fresh:`, err.message);
    return {};
  }
}

/** Returns a save function that writes at most a few times a second. */
export function saver(file: string, get: () => SavedData) {
  let timer: NodeJS.Timeout | null = null;
  const write = () => {
    timer = null;
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(get(), null, 2));
    renameSync(tmp, file); // atomic replace, so a crash never leaves half a file
  };
  return {
    soon() {
      if (!timer) timer = setTimeout(write, 300);
    },
    now() {
      if (timer) clearTimeout(timer);
      write();
    },
  };
}
