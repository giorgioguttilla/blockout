/** Minimal file system a project store needs. Paths are relative to the project root, '/'-separated. */
export interface VFS {
  /** display name / location of the root (absolute path for local, folder name in the browser) */
  readonly label: string;
  read(path: string): Promise<string | null>;
  write(path: string, data: string | Uint8Array): Promise<void>;
  exists(path: string): Promise<boolean>;
  /** immediate children of a directory */
  list(dir: string): Promise<{ name: string; dir: boolean }[]>;
  /** last modified time (ms) or null */
  mtime(path: string): Promise<number | null>;
  /** move a file or directory (used for "delete" into .trash) */
  move(from: string, to: string): Promise<void>;
}

export const join = (...parts: string[]) => parts.filter(Boolean).join('/').replace(/\/+/g, '/');
export const dirname = (p: string) => p.split('/').slice(0, -1).join('/');
export const basename = (p: string) => p.split('/').pop() ?? p;

export function b64ToBytes(b64: string) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
