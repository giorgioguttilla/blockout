import type { Level, LevelSummary, Project, VersionInfo } from '$lib/model/types';
import { browserBackend } from '$lib/store/browser';

/** true in the hosted (Firebase) build: no server, projects live in folders you grant or in the browser */
export const WEB = import.meta.env.VITE_BLOCKOUT_WEB === '1';

async function req<T>(method: string, url: string, body?: unknown, keepalive = false): Promise<T> {
  const r = await fetch('/api/' + url, {
    method,
    keepalive,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || (data && typeof data === 'object' && 'error' in data && data.error)) throw new Error(data?.error ?? r.statusText);
  return data as T;
}

export interface Session {
  root: string | null;
  label?: string;
  recent: string[];
  home: string;
  project: Project | null;
  levels: LevelSummary[];
}
export interface BrowseResult {
  path: string;
  parent: string | null;
  home: string;
  isProject: boolean;
  dirs: { name: string; path: string; isProject: boolean }[];
}
type Files = { name: string; text?: string; base64?: string }[];
type Ev = { kind: string; id?: string };

const server = {
  session: () => req<Session>('GET', 'session'),
  open: (path: string, opts: { create?: boolean; demo?: boolean } = {}) => req<{ root: string; label?: string; project: Project; levels: LevelSummary[] }>('POST', 'open', { path, ...opts }),
  close: () => req('POST', 'close', {}),
  browse: (path?: string) => req<BrowseResult>('GET', 'browse' + (path ? '?path=' + encodeURIComponent(path) : '')),
  project: () => req<Project>('GET', 'project'),
  saveProject: (p: Project) => req('PUT', 'project', p),
  levels: () => req<LevelSummary[]>('GET', 'levels'),
  createLevel: (name: string, from?: Level) => req<{ id: string }>('POST', 'levels', { name, from }),
  level: (id: string) => req<Level>('GET', 'levels/' + id),
  saveLevel: (id: string, level: Level, keepalive = false) => req('PUT', 'levels/' + id, level, keepalive && JSON.stringify(level).length < 60000),
  deleteLevel: (id: string) => req('DELETE', 'levels/' + id),
  versions: (id: string) => req<VersionInfo[]>('GET', `levels/${id}/versions`),
  saveVersion: (id: string, level: Level, message: string, handoff = false) => req<VersionInfo>('POST', `levels/${id}/versions`, { level, message, handoff }),
  version: (id: string, n: number) => req<Level>('GET', `levels/${id}/versions/${n}`),
  setBaseline: (id: string, n: number) => req('POST', `levels/${id}/baseline`, { n }),
  handoff: (id: string, files: Files) => req<{ dir: string }>('POST', `levels/${id}/handoff`, { files }),
  reveal: (path?: string) => req('POST', 'reveal', { path }),
  subscribe(fn: (ev: Ev) => void) {
    const es = new EventSource('/api/events');
    es.onmessage = (m) => fn(JSON.parse(m.data));
    return () => es.close();
  },
  watchLevel(_id: string) {}
};

const b = browserBackend;
const web: typeof server = {
  session: async () => ({ root: null, recent: [], home: '', project: null, levels: [] }),
  open: async (path, opts = {}) => {
    const r = await b.open(path, opts);
    return { root: r.root, label: r.label, project: await b.core.readProject(), levels: await b.core.listLevels() };
  },
  close: async () => b.close(),
  browse: async () => {
    throw new Error('Not available in the web version');
  },
  project: () => b.core.readProject(),
  saveProject: async (p) => b.core.writeProject(p),
  levels: () => b.core.listLevels(),
  createLevel: async (name, from) => ({ id: await b.core.createLevel(name, from) }),
  level: (id) => b.core.readLevel(id),
  saveLevel: async (id, level) => {
    if (!Array.isArray(level?.elements)) throw new Error('Refusing to write an invalid level');
    await b.core.writeLevel(id, level);
  },
  deleteLevel: (id) => b.core.deleteLevel(id),
  versions: (id) => b.core.listVersions(id),
  saveVersion: (id, level, message, handoff = false) => b.core.saveVersion(id, level, message, handoff),
  version: (id, n) => b.core.readVersion(id, n),
  setBaseline: (id, n) => b.core.setBaseline(id, n),
  handoff: async (id, files) => ({ dir: await b.core.writeHandoff(id, files) }),
  reveal: async () => {},
  subscribe: (fn) => b.subscribe(fn),
  watchLevel: (id) => {
    b.watchLevel = id;
  }
};

export const api = WEB ? web : server;

/** web build: download a level's handoff (brief, screenshots, data) as a zip */
export async function downloadHandoffZip(levelId: string, name: string) {
  const blob = await browserBackend.handoffZip(levelId);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name}-handoff.zip`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
