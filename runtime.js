// In-browser stand-in for the game server, for the single-player Claude artifact build
// (scripts/build-artifact.js). The packed server modules (rooms, engine, case schema) run here
// unchanged; this file supplies what they expect from Node and answers the client's /api requests
// in place of the HTTP server, so the real client code runs as is. Rooms are kept in localStorage,
// so moving between the home page and the game page (or reloading) keeps the game.
// The whole case, answers included, is inside this page: a test build, not the real game.
(function () {
  'use strict';
  const MODULES = window.__MYSTERY_MODULES__;
  const CASES = window.__MYSTERY_CASES__;
  const AVATAR_IDS = window.__MYSTERY_AVATARS__;
  const STORE_KEY = 'mystery:artifact:rooms';

  // ---------- what the server modules expect from Node ----------
  const enc = new TextEncoder();
  const toHex = (u8) => [...u8].map((b) => b.toString(16).padStart(2, '0')).join('');
  const toB64url = (u8) => btoa(String.fromCharCode(...u8)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const bytes = (u8) => Object.assign(u8, { toString: (e) => (e === 'hex' ? toHex(u8) : e === 'base64url' ? toB64url(u8) : new TextDecoder().decode(u8)) });

  // SHA-256 (tokens are stored hashed; synchronous like node:crypto)
  const K = new Uint32Array([0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
  function sha256(data) {
    const msg = typeof data === 'string' ? enc.encode(data) : data;
    const l = msg.length;
    const n = (((l + 9) >> 6) + 1) << 6;
    const m = new Uint8Array(n);
    m.set(msg);
    m[l] = 0x80;
    const dv = new DataView(m.buffer);
    dv.setUint32(n - 4, l * 8);
    dv.setUint32(n - 8, Math.floor(l / 0x20000000));
    const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    const W = new Uint32Array(64);
    const r = (x, s) => (x >>> s) | (x << (32 - s));
    for (let o = 0; o < n; o += 64) {
      for (let i = 0; i < 16; i++) W[i] = dv.getUint32(o + i * 4);
      for (let i = 16; i < 64; i++) W[i] = (r(W[i - 15], 7) ^ r(W[i - 15], 18) ^ (W[i - 15] >>> 3)) + W[i - 16] + (r(W[i - 2], 17) ^ r(W[i - 2], 19) ^ (W[i - 2] >>> 10)) + W[i - 7];
      let [a, b, c, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) {
        const t1 = (h + (r(e, 6) ^ r(e, 11) ^ r(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + W[i]) >>> 0;
        const t2 = ((r(a, 2) ^ r(a, 13) ^ r(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
        [h, g, f, e, d, c, b, a] = [g, f, e, (d + t1) >>> 0, c, b, a, (t1 + t2) >>> 0];
      }
      H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
    }
    const out = new Uint8Array(32);
    const odv = new DataView(out.buffer);
    H.forEach((w, i) => odv.setUint32(i * 4, w));
    return bytes(out);
  }

  const unavailable = () => {
    throw new Error('이 기능은 브라우저 체험판에서 쓸 수 없어요.');
  };
  const NODE = {
    'node:crypto': {
      randomBytes: (n) => bytes(crypto.getRandomValues(new Uint8Array(n))),
      createHash: () => {
        const parts = [];
        const h = { update: (d) => (parts.push(typeof d === 'string' ? enc.encode(d) : d), h), digest: (e) => sha256(concat(parts)).toString(e) };
        return h;
      },
      timingSafeEqual: (a, b) => a.length === b.length && a.every((v, i) => v === b[i]),
      createCipheriv: unavailable,
      createDecipheriv: unavailable,
      randomUUID: () => crypto.randomUUID(),
    },
    'node:fs': { readFileSync: unavailable, writeFileSync: unavailable, existsSync: () => false, mkdirSync: () => {} },
    'node:path': { join: (...p) => p.join('/'), dirname: (p) => p.split('/').slice(0, -1).join('/'), extname: (p) => /\.[^./]*$/.exec(p)?.[0] ?? '' },
    'node:zlib': { gzipSync: unavailable, gunzipSync: unavailable },
  };
  const concat = (parts) => {
    const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
    let i = 0;
    for (const p of parts) (out.set(p, i), (i += p.length));
    return out;
  };
  // only what the packed modules touch at load time and for comparing strings
  const Buffer = {
    from: (v, e) => bytes(typeof v === 'string' ? (e === 'hex' ? new Uint8Array(v.match(/../g).map((x) => parseInt(x, 16))) : enc.encode(v)) : new Uint8Array(v)),
    concat: (list) => bytes(concat(list)),
  };
  // Node timers have unref(); browser ones are plain numbers
  const timer = (make) => (fn, ms, ...rest) => {
    const id = make(fn, ms, ...rest);
    return { unref: () => {}, ref: () => {}, [Symbol.toPrimitive]: () => id };
  };
  const clear = (fn) => (t) => fn(t && typeof t === 'object' ? +t : t);
  const GLOBALS = {
    Buffer,
    setInterval: timer(window.setInterval.bind(window)),
    setTimeout: timer(window.setTimeout.bind(window)),
    clearInterval: clear(window.clearInterval.bind(window)),
    clearTimeout: clear(window.clearTimeout.bind(window)),
  };

  // ---------- the module loader ----------
  const cache = new Map();
  function load(id) {
    if (cache.has(id)) return cache.get(id).exports;
    const module = { exports: {} };
    cache.set(id, module);
    const [deps, fn] = MODULES[id];
    const req = (spec) => {
      if (NODE[spec]) return NODE[spec];
      if (spec === '__avatars__') return { AVATAR_IDS, FACINGS: ['s', 'n', 'e', 'w'] };
      if (!deps[spec]) throw new Error(`${id}: 알 수 없는 모듈 ${spec}`);
      return load(deps[spec]);
    };
    fn(module, module.exports, req, GLOBALS.Buffer, GLOBALS.setInterval, GLOBALS.setTimeout, GLOBALS.clearInterval, GLOBALS.clearTimeout);
    return module.exports;
  }
  const { RoomManager } = load('src/rooms.js');
  const { compileCase, validateCase } = load('src/content/caseSchema.js');
  const { caseSummary } = load('src/engine/view.js');
  const { overview } = load('src/engine/overview.js');
  const { AppError } = load('src/util.js');

  // ---------- cases and rooms ----------
  const compiled = new Map();
  for (const pkg of CASES) {
    const res = validateCase(pkg);
    if (!res.ok) {
      console.error(`[체험판] ${pkg.id}@${pkg.version}`, res.errors);
      continue;
    }
    compiled.set(`${pkg.id}@${pkg.version}`, compileCase(pkg));
  }
  const content = {
    get: (id, version) => compiled.get(`${id}@${version}`) ?? null,
    latest: (id) => [...compiled.values()].find((c) => c.id === id) ?? null,
    versionsOf: (id) => [...compiled.values()].filter((c) => c.id === id).map((c) => c.version),
    listedIds: () => [...new Set([...compiled.values()].map((c) => c.id))].sort(),
    ids: () => [...new Set([...compiled.values()].map((c) => c.id))].sort(),
    listed: () => true,
  };

  const readStore = () => {
    try {
      return JSON.parse(localStorage.getItem(STORE_KEY)) ?? {};
    } catch {
      return {};
    }
  };
  const db = {
    saveRoom(room) {
      const all = readStore();
      all[room.id] = { id: room.id, code: room.code, state: JSON.stringify(room), created_at: room.createdAt };
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify(all));
      } catch {
        // storage full or blocked: the game goes on for this page
      }
    },
    loadRooms: () => Object.values(readStore()).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))),
    deleteRoom(id) {
      const all = readStore();
      delete all[id];
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify(all));
      } catch {
        // ignore
      }
    },
    close() {},
  };
  const rooms = new RoomManager({ db, content, saveKey: null, log: (m) => console.debug(`[체험판] ${m}`), moveIntervalMs: 110, hostGraceMs: 30000, flushMs: 1500 });
  rooms.loadAll();
  // positions and chat are saved in batches; keep them when the page goes away
  window.addEventListener('pagehide', () => rooms.flushDirty());

  // ---------- the /api routes, answered in the page ----------
  const json = (status, body) => new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const bearer = (init) => /^Bearer (\S+)$/.exec(String(new Headers(init?.headers).get('authorization') || ''))?.[1] ?? null;
  const body = (init) => {
    try {
      return init?.body ? JSON.parse(init.body) : {};
    } catch {
      throw new AppError(400, 'bad_json', '잘못된 요청 형식이에요.');
    }
  };
  const offline = () => {
    throw new AppError(501, 'artifact_only', '브라우저 체험판에서는 저장 파일을 쓸 수 없어요. 저장 칸은 그대로 쓸 수 있어요.');
  };

  // the event stream: the room manager writes server-sent events into this as if it were a response
  function stream(entry, pid, signal) {
    const closers = [];
    let ctrl;
    const res = {
      writableEnded: false,
      destroyed: false,
      writeHead() {},
      write(s) {
        if (!res.writableEnded) ctrl.enqueue(enc.encode(s));
      },
      end() {
        if (res.writableEnded) return;
        res.writableEnded = true;
        try {
          ctrl.close();
        } catch {
          // already closed
        }
        closers.splice(0).forEach((f) => f());
      },
      on(ev, f) {
        if (ev === 'close') closers.push(f);
      },
    };
    const body = new ReadableStream({ start: (c) => (ctrl = c), cancel: () => res.end() });
    signal?.addEventListener('abort', () => res.end());
    queueMicrotask(() => rooms.openStream(entry, pid, res));
    return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  }

  const C = '([A-Za-z0-9]{4,10})';
  const routes = [
    ['GET', /^\/api\/cases$/, () => json(200, { cases: content.listedIds().map((id) => ({ ...caseSummary(content.latest(id)), versions: content.versionsOf(id) })) })],
    ['POST', /^\/api\/rooms$/, (m, init) => json(201, rooms.createRoom(body(init)))],
    ['POST', /^\/api\/rooms\/import$/, offline],
    ['GET', new RegExp(`^/api/rooms/${C}$`), ([code]) => json(200, rooms.publicInfo(code))],
    ['DELETE', new RegExp(`^/api/rooms/${C}$`), ([code], init) => {
      const { entry, pid } = rooms.authenticate(code, bearer(init));
      return json(200, rooms.deleteRoom(entry, pid));
    }],
    ['GET', new RegExp(`^/api/rooms/${C}/save-file$`), offline],
    ['POST', new RegExp(`^/api/rooms/${C}/join$`), ([code], init) => json(201, rooms.join(code, body(init)))],
    ['GET', new RegExp(`^/api/rooms/${C}/stream$`), ([code], init) => {
      const { entry, pid } = rooms.authenticate(code, bearer(init));
      return stream(entry, pid, init?.signal);
    }],
    ['GET', new RegExp(`^/api/rooms/${C}/state$`), ([code], init, url) => {
      const { entry, pid } = rooms.authenticate(code, bearer(init));
      const since = url.searchParams.get('since');
      if (since === null || !/^\d{1,15}$/.test(since)) return json(200, rooms.viewFor(entry, pid));
      return new Promise((resolve) => rooms.waitForChange(entry, pid, Number(since), {
        onChange: (view) => resolve(json(200, view)),
        onTimeout: () => resolve(json(204)),
        onClose: (cleanup) => init?.signal?.addEventListener('abort', cleanup),
      }));
    }],
    ['GET', new RegExp(`^/api/rooms/${C}/minimap$`), ([code], init) => {
      const { entry } = rooms.authenticate(code, bearer(init));
      if (!entry.caseDef) throw new AppError(409, 'no_case', '아직 사건을 고르지 않았어요.');
      return json(200, { case: `${entry.caseDef.id}@${entry.caseDef.version}`, ...overview(entry.caseDef) });
    }],
    ['POST', new RegExp(`^/api/rooms/${C}/actions$`), ([code], init) => {
      const { entry, pid } = rooms.authenticate(code, bearer(init));
      return json(200, rooms.act(entry, pid, body(init)));
    }],
  ];

  // for p2p.js (the GitHub Pages build): which rooms this page holds
  window.__MYSTERY_LOCAL__ = { has: (code) => rooms.byCode.has(String(code).toUpperCase()) };

  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    const path = url.pathname.replace(/^.*?(\/api\/)/, '/api/');
    if (!path.startsWith('/api/')) return realFetch(input, init);
    const method = (init.method || 'GET').toUpperCase();
    try {
      for (const [m, re, handler] of routes) {
        const match = re.exec(path);
        if (match && m === method) return await handler(match.slice(1), init, url);
      }
      throw new AppError(404, 'not_found', '찾을 수 없어요.');
    } catch (err) {
      if (err instanceof AppError) return json(err.status, { error: { code: err.code, message: err.message, ...(err.extra ?? {}) } });
      console.error('[체험판]', err);
      return json(500, { error: { code: 'server_error', message: `체험판에서 문제가 생겼어요: ${err.message}` } });
    }
  };
})();
