// Playing together in the GitHub Pages build (scripts/build-artifact.js --pages). There is no game
// server: the browser that made a room runs it (runtime.js) and serves it to the others while that
// room's page is open. Browsers find each other through PeerJS's free public broker and then talk
// directly (WebRTC). The room's peer name is fixed by its code, so whoever opens the room first is
// its host; another tab or device that opens it becomes a guest of that host.
// A guest's requests for the room travel to the host, which answers them with its own in-page
// server, so a guest only ever receives what the server would send that player. The host's browser
// holds the whole case (answers included), the same as the single-player test build.
(function () {
  'use strict';
  const LOCAL = window.__MYSTERY_LOCAL__;
  const local = window.fetch; // runtime.js: the in-page server
  if (!LOCAL) return;
  if (typeof window.Peer !== 'function') {
    console.warn('[함께 하기] 연결 도구를 불러오지 못했어요. 혼자 하기만 할 수 있어요.');
    return;
  }
  const PREFIX = 'baekrok-tamjeong-';
  const CODE_RE = /^\/api\/rooms\/([A-Za-z0-9]{4,10})(?:\/|$)/;
  const LINK_TIMEOUT_MS = 8000;
  // a closed tab does not always say goodbye: guests ping, and give up on a host silent this long
  const PING_MS = 4000;
  const SILENT_MS = 12000;
  const pageCode = /^#([A-Za-z0-9]{4,10})$/.exec(location.hash)?.[1]?.toUpperCase() ?? null;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------- a small note on the room page saying which side of the link this tab is ----------
  function note(text) {
    if (!pageCode) return;
    const show = () => {
      let el = document.getElementById('p2p-note');
      if (!el) {
        el = document.createElement('div');
        el.id = 'p2p-note';
        el.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:50;max-width:min(320px,calc(100vw - 16px));padding:4px 8px;background:rgba(42,38,34,.85);color:#F6D88A;font:11px/1.4 "Galmuri11","Malgun Gothic",sans-serif;pointer-events:none';
        document.body.append(el);
      }
      el.textContent = text;
    };
    if (document.body) show();
    else document.addEventListener('DOMContentLoaded', show);
  }

  // ---------- hosting: answer guests with the in-page server ----------
  // Resolves 'host' (this tab now serves the room), 'taken' (another tab or device does) or
  // 'offline' (the broker cannot be reached: play goes on here, nobody else can come in).
  function host(code) {
    return new Promise((resolve) => {
      const peer = new window.Peer(PREFIX + code, { debug: 0 });
      let settled = false;
      const settle = (v) => {
        if (!settled) (settled = true), resolve(v);
      };
      peer.on('open', () => settle('host'));
      peer.on('error', (err) => {
        if (err.type === 'unavailable-id') {
          peer.destroy();
          settle('taken');
        } else if (!settled) settle('offline');
      });
      // the line to the broker dropped: guests already linked stay; come back for new ones
      peer.on('disconnected', () => {
        if (!peer.destroyed) setTimeout(() => !peer.destroyed && peer.reconnect(), 2000);
      });
      peer.on('connection', (conn) => serve(conn, code));
      // leaving the page: tell the guests now rather than let them wait for the silence
      window.addEventListener('pagehide', () => peer.destroy());
      setTimeout(() => settle('offline'), LINK_TIMEOUT_MS);
    });
  }

  function serve(conn, code) {
    const open = new Map(); // request id -> AbortController
    const send = (msg) => {
      if (conn.open) conn.send(msg);
    };
    conn.on('data', async (msg) => {
      if (!msg || typeof msg !== 'object') return;
      if (msg.t === 'ping') return send({ t: 'pong' });
      if (msg.t === 'abort') return open.get(msg.id)?.abort();
      if (msg.t !== 'req' || typeof msg.path !== 'string') return;
      const { id } = msg;
      // a guest reaches this room only: no other rooms, no making rooms on the host
      const m = CODE_RE.exec(msg.path.split('?')[0]);
      if (!m || m[1].toUpperCase() !== code) return send({ t: 'res', id, status: 404, body: JSON.stringify({ error: { code: 'not_found', message: '찾을 수 없어요.' } }) });
      const ac = new AbortController();
      open.set(id, ac);
      try {
        const headers = {};
        if (typeof msg.auth === 'string') headers.Authorization = msg.auth;
        if (msg.body !== undefined) headers['Content-Type'] = 'application/json';
        const res = await local(msg.path, { method: msg.method, headers, body: msg.body, signal: ac.signal });
        if ((res.headers.get('Content-Type') ?? '').includes('event-stream')) {
          send({ t: 'head', id, status: res.status });
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          ac.signal.addEventListener('abort', () => reader.cancel().catch(() => {}));
          for (;;) {
            const { value, done } = await reader.read();
            if (done || !conn.open) break;
            send({ t: 'chunk', id, data: decoder.decode(value, { stream: true }) });
          }
          send({ t: 'end', id });
        } else {
          send({ t: 'res', id, status: res.status, body: await res.text() });
        }
      } catch {
        send({ t: 'res', id, status: 500, body: JSON.stringify({ error: { code: 'server_error', message: '방장 브라우저에서 문제가 생겼어요.' } }) });
      } finally {
        open.delete(id);
      }
    });
    // the guest left: close its streams so the room counts it as gone
    conn.on('close', () => open.forEach((ac) => ac.abort()));
  }

  // ---------- joining: send this room's requests to its host ----------
  let guestPeer = null;
  function guest() {
    if (guestPeer && !guestPeer.destroyed) return guestPeer;
    guestPeer = new window.Peer({ debug: 0 });
    guestPeer.on('disconnected', () => {
      if (!guestPeer.destroyed) setTimeout(() => !guestPeer.destroyed && guestPeer.reconnect(), 2000);
    });
    return guestPeer;
  }

  const links = new Map(); // code -> Promise<link>
  function link(code) {
    if (links.has(code)) return links.get(code);
    const p = new Promise((resolve, reject) => {
      const peer = guest();
      const start = () => {
        const conn = peer.connect(PREFIX + code, { reliable: true });
        const pending = new Map(); // id -> { onMsg, onClose }
        let seq = 0;
        const timer = setTimeout(() => (conn.close(), reject(new Error('timeout'))), LINK_TIMEOUT_MS);
        let heard = Date.now();
        let beat = null;
        conn.on('open', () => {
          clearTimeout(timer);
          beat = setInterval(() => {
            if (Date.now() - heard > SILENT_MS) conn.close();
            else if (conn.open) conn.send({ t: 'ping' });
          }, PING_MS);
          resolve({
            request(msg, handlers) {
              const id = ++seq;
              pending.set(id, handlers);
              conn.send({ ...msg, t: 'req', id });
              return {
                abort: () => conn.open && conn.send({ t: 'abort', id }),
                done: () => pending.delete(id),
              };
            },
          });
        });
        conn.on('data', (msg) => {
          heard = Date.now();
          if (msg?.t !== 'pong') pending.get(msg?.id)?.onMsg(msg);
        });
        conn.on('close', () => {
          clearTimeout(timer);
          clearInterval(beat);
          note('방장과 연결이 끊겼어요. 다시 연결하는 중이에요.');
          links.delete(code);
          pending.forEach((h) => h.onClose());
          pending.clear();
          reject(new Error('closed'));
        });
        conn.on('error', () => conn.close());
      };
      if (peer.open) start();
      else {
        peer.once('open', start);
        peer.once('error', (err) => reject(err));
      }
    });
    links.set(code, p);
    p.catch(() => links.delete(code));
    return p;
  }

  const failed = () => new TypeError('Failed to fetch');
  async function remote(code, path, init) {
    let l;
    try {
      l = await link(code);
    } catch {
      note('방장 브라우저에 연결하지 못했어요. 방장이 이 방 화면을 열어 두었는지 확인해 주세요.');
      throw failed();
    }
    note('방장 브라우저에 연결됐어요.');
    const headers = new Headers(init.headers);
    const msg = { method: (init.method || 'GET').toUpperCase(), path, auth: headers.get('authorization') ?? undefined, body: typeof init.body === 'string' ? init.body : undefined };
    return new Promise((resolve, reject) => {
      let ctrl = null; // set once the answer turns out to be a stream
      const enc = new TextEncoder();
      const req = l.request(msg, {
        onMsg(m) {
          if (m.t === 'res') {
            req.done();
            resolve(new Response(m.status === 204 ? null : m.body, { status: m.status, headers: { 'Content-Type': 'application/json' } }));
          } else if (m.t === 'head') {
            const body = new ReadableStream({ start: (c) => (ctrl = c), cancel: () => (req.abort(), req.done()) });
            resolve(new Response(body, { status: m.status, headers: { 'Content-Type': 'text/event-stream' } }));
          } else if (m.t === 'chunk') {
            ctrl?.enqueue(enc.encode(m.data));
          } else if (m.t === 'end') {
            req.done();
            try {
              ctrl?.close();
            } catch {
              // already closed
            }
          }
        },
        onClose() {
          if (ctrl) ctrl.error(failed());
          else reject(failed());
        },
      });
      init.signal?.addEventListener('abort', () => {
        req.abort();
        req.done();
        const err = new DOMException('Aborted', 'AbortError');
        if (ctrl) {
          try {
            ctrl.error(err);
          } catch {
            // already closed
          }
        } else reject(err);
      });
    });
  }

  // ---------- which way each room's requests go ----------
  const roles = new Map(); // code -> Promise<'local' | 'remote'>
  async function decide(code) {
    if (!LOCAL.has(code)) return 'remote';
    // a room this browser holds: its own page hosts it; any other page only reads it here
    if (code !== pageCode) return 'local';
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const r = await host(code);
      if (r === 'host') {
        note('이 브라우저가 방을 열고 있어요. 이 탭을 닫으면 모두의 게임이 멈춰요.');
        return 'local';
      }
      if (r === 'offline') {
        note('연결 서버에 닿지 않아 다른 사람은 들어올 수 없어요. 혼자서는 계속할 수 있어요.');
        return 'local';
      }
      // taken: maybe this tab's own earlier life (a reload) has not let go yet
      if (attempt === 0) await sleep(2500);
    }
    return 'remote';
  }
  const role = (code) => {
    if (!roles.has(code)) roles.set(code, decide(code));
    return roles.get(code);
  };

  window.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    const path = url.pathname.replace(/^.*?(\/api\/)/, '/api/');
    const m = CODE_RE.exec(path);
    if (!m || m[1] === 'import') return local(input, init);
    const code = m[1].toUpperCase();
    if ((await role(code)) === 'local') return local(input, init);
    return remote(code, path + url.search, init);
  };
  // start finding the room's host (or becoming it) before the page asks
  if (pageCode) role(pageCode);
})();
