import { json, error, type RequestHandler } from '@sveltejs/kit';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { store, PROJECT_FILE } from '$lib/server/store';

type Ctx = { params: string[]; url: URL; body: any };
type Handler = (c: Ctx) => Promise<unknown> | unknown;

const routes: [string, string, Handler][] = [
  ['GET', 'session', async () => ({
    root: store.root,
    recent: await store.recent(),
    home: os.homedir(),
    project: store.root ? await store.readProject() : null,
    levels: store.root ? await store.listLevels() : []
  })],
  ['POST', 'open', async ({ body }) => {
    const root = await store.open(body.path, { create: !!body.create, demo: !!body.demo });
    return { root, project: await store.readProject(), levels: await store.listLevels() };
  }],
  ['POST', 'close', () => {
    store.root = null;
    return { ok: true };
  }],
  ['GET', 'browse', async ({ url }) => {
    let p = url.searchParams.get('path') || os.homedir();
    p = path.resolve(p.replace(/^~(?=$|\/)/, os.homedir()));
    const entries = await fsp.readdir(p, { withFileTypes: true }).catch(() => []);
    const dirs = entries
      .filter((d) => d.isDirectory() && !d.name.startsWith('.') && d.name !== 'node_modules')
      .map((d) => {
        const full = path.join(p, d.name);
        return { name: d.name, path: full, isProject: fs.existsSync(path.join(full, PROJECT_FILE)) };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    return { path: p, parent: path.dirname(p) === p ? null : path.dirname(p), dirs, home: os.homedir(), isProject: fs.existsSync(path.join(p, PROJECT_FILE)) };
  }],
  ['GET', 'project', () => store.readProject()],
  ['PUT', 'project', async ({ body }) => {
    if (!body || typeof body !== 'object' || !body.tags) throw new Error('Refusing to write an invalid project');
    await store.writeProject(body);
    return { ok: true };
  }],
  ['GET', 'levels', () => store.listLevels()],
  ['POST', 'levels', async ({ body }) => ({ id: await store.createLevel(body.name || 'New level', body.from) })],
  ['GET', 'levels/*', ({ params }) => store.readLevel(params[0])],
  ['PUT', 'levels/*', async ({ params, body }) => {
    if (!body || !Array.isArray(body.elements) || typeof body.name !== 'string') throw new Error('Refusing to write an invalid level');
    await store.writeLevel(params[0], body);
    return { ok: true, time: new Date().toISOString() };
  }],
  ['DELETE', 'levels/*', async ({ params }) => {
    await store.deleteLevel(params[0]);
    return { ok: true };
  }],
  ['GET', 'levels/*/versions', ({ params }) => store.listVersions(params[0])],
  ['POST', 'levels/*/versions', ({ params, body }) => store.saveVersion(params[0], body.level, body.message, !!body.handoff)],
  ['GET', 'levels/*/versions/*', ({ params }) => store.readVersion(params[0], Number(params[1]))],
  ['POST', 'levels/*/baseline', async ({ params, body }) => {
    await store.setBaseline(params[0], Number(body.n));
    return { ok: true };
  }],
  ['POST', 'levels/*/handoff', async ({ params, body }) => ({ dir: await store.writeHandoff(params[0], body.files) })],
  ['POST', 'reveal', ({ body }) => {
    const target = body.path ? path.resolve(store.root ?? '/', body.path) : store.root;
    if (!target) throw new Error('nothing to reveal');
    const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
    spawn(cmd, [target], { detached: true, stdio: 'ignore' }).unref();
    return { ok: true };
  }]
];

function match(method: string, parts: string[]) {
  for (const [m, pattern, h] of routes) {
    if (m !== method) continue;
    const pp = pattern.split('/');
    if (pp.length !== parts.length) continue;
    const params: string[] = [];
    let ok = true;
    for (let i = 0; i < pp.length; i++) {
      if (pp[i] === '*') params.push(decodeURIComponent(parts[i]));
      else if (pp[i] !== parts[i]) ok = false;
    }
    if (ok) return { h, params };
  }
  return null;
}

const handle: RequestHandler = async ({ request, params, url }) => {
  const parts = (params.path ?? '').split('/').filter(Boolean);
  if (request.method === 'GET' && parts[0] === 'events') return events();
  const r = match(request.method, parts);
  if (!r) error(404, 'Not found');
  let body: any = null;
  if (request.method !== 'GET' && request.method !== 'DELETE') {
    const text = await request.text().catch(() => null);
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      return json({ error: 'Request body was not valid JSON (nothing was written)' }, { status: 400 });
    }
  }
  try {
    return json(await r.h({ params: r.params, url, body }));
  } catch (e: any) {
    return json({ error: e?.message ?? String(e) }, { status: 400 });
  }
};

function events() {
  let unsub: () => void = () => {};
  let ping: ReturnType<typeof setInterval>;
  const stream = new ReadableStream({
    start(ctrl) {
      const enc = new TextEncoder();
      const send = (d: unknown) => {
        try {
          ctrl.enqueue(enc.encode(`data: ${JSON.stringify(d)}\n\n`));
        } catch {}
      };
      send({ kind: 'hello' });
      unsub = store.subscribe(send);
      ping = setInterval(() => send({ kind: 'ping' }), 20000);
    },
    cancel() {
      unsub();
      clearInterval(ping);
    }
  });
  return new Response(stream, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' } });
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;
