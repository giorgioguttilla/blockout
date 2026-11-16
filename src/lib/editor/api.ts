import type { Level, LevelSummary, Project, VersionInfo } from '$lib/model/types';

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

export const api = {
  session: () => req<Session>('GET', 'session'),
  open: (path: string, opts: { create?: boolean; demo?: boolean } = {}) => req<{ root: string; project: Project; levels: LevelSummary[] }>('POST', 'open', { path, ...opts }),
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
  handoff: (id: string, files: { name: string; text?: string; base64?: string }[]) => req<{ dir: string }>('POST', `levels/${id}/handoff`, { files }),
  reveal: (path?: string) => req('POST', 'reveal', { path })
};
