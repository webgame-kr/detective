// Talks to the server. The seat token rides in an Authorization header, so the event stream is read
// with fetch instead of EventSource. Each browser tab keeps its own active seat in sessionStorage,
// so two tabs can be two players; localStorage remembers seats so a closed tab can resume.

export async function api(method, url, { body, token } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    return { status: 0, body: { error: { code: 'network', message: '서버에 연결할 수 없어요. 잠시 뒤 다시 시도해 주세요.' } } };
  }
  let json = null;
  try {
    json = await res.json();
  } catch {
    // empty body
  }
  return { status: res.status, body: json };
}

const SEATS_KEY = 'mystery:seats';
const activeKey = (code) => `mystery:active:${code}`;

function readSeats() {
  try {
    return JSON.parse(localStorage.getItem(SEATS_KEY)) ?? {};
  } catch {
    return {};
  }
}

function writeSeats(all) {
  try {
    localStorage.setItem(SEATS_KEY, JSON.stringify(all));
  } catch {
    // storage unavailable: the tab still works for this session
  }
}

export const seats = {
  list: (code) => readSeats()[code] ?? [],
  all: () => readSeats(),
  save(code, seat) {
    const all = readSeats();
    all[code] = [{ ...seat, at: Date.now() }, ...(all[code] ?? []).filter((s) => s.token !== seat.token)].slice(0, 6);
    writeSeats(all);
    this.setActive(code, seat.token);
  },
  forget(code, token) {
    const all = readSeats();
    all[code] = (all[code] ?? []).filter((s) => s.token !== token);
    if (!all[code].length) delete all[code];
    writeSeats(all);
    try {
      if (sessionStorage.getItem(activeKey(code)) === token) sessionStorage.removeItem(activeKey(code));
    } catch {
      // ignore
    }
  },
  active(code) {
    try {
      return sessionStorage.getItem(activeKey(code));
    } catch {
      return null;
    }
  },
  setActive(code, token) {
    try {
      sessionStorage.setItem(activeKey(code), token);
    } catch {
      // ignore
    }
  },
};

// Keeps one stream open, reconnecting with backoff. onState/onPos get server events;
// onStatus gets 'connecting' | 'open' | 'polling' | 'retrying' | 'rejected'.
export class Connection {
  constructor(code, token, { onState, onPos, onAnim, onStatus, onRejected }) {
    Object.assign(this, { code, token, onState, onPos, onAnim, onStatus, onRejected });
    this.stopped = false;
    this.retry = 0;
  }

  start() {
    this.loop();
  }

  // Every view goes through here. Views carry the room's change counter, so an older one arriving
  // late (a held-back stream flushing, a slow request) never rolls the screen back.
  deliver(view) {
    if (view.stateEpoch !== this.epoch) {
      this.epoch = view.stateEpoch;
      this.applied = -1;
    }
    if (typeof view.stateVersion === 'number') {
      if (view.stateVersion < this.applied) return;
      this.applied = view.stateVersion;
    }
    this.onState(view);
  }

  stop() {
    this.stopped = true;
    this.controller?.abort();
    this.stopPolling();
  }

  // Some tunnels (seen with Cloudflare quick tunnels) hold the event stream back. The stream stays
  // open so the server still counts us as connected, and the view comes by long-poll instead: each
  // request waits until the room changes, so steps arrive one by one rather than in 0.6 s batches.
  // One-shot motion events are not replayed in this mode; state is.
  armWatchdog() {
    clearTimeout(this.watchdog);
    this.gotData = false;
    this.watchdog = setTimeout(() => {
      if (!this.gotData && !this.stopped) this.startPolling();
    }, 3000);
  }

  // Draw the room right away instead of waiting for the stream's first event, which a tunnel may hold.
  async firstView() {
    const res = await api('GET', `/api/rooms/${this.code}/state`, { token: this.token });
    if (res.status === 200 && !this.gotData && !this.stopped) this.deliver(res.body);
  }

  startPolling() {
    if (this.polling) return;
    this.polling = true;
    this.onStatus('polling');
    this.pollLoop();
  }

  stopPolling() {
    this.polling = false;
    this.pollAbort?.abort();
  }

  async pollLoop() {
    let since = null;
    while (this.polling && !this.stopped) {
      this.pollAbort = new AbortController();
      let res;
      try {
        res = await fetch(`/api/rooms/${this.code}/state${since === null ? '' : `?since=${since}`}`, { headers: { Authorization: `Bearer ${this.token}` }, signal: this.pollAbort.signal });
      } catch {
        if (!this.polling) return;
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
      if (!this.polling || this.stopped) return;
      if (res.status === 200) {
        const view = await res.json().catch(() => null);
        if (!view || !this.polling) continue;
        since = view.stateVersion;
        this.deliver(view);
      } else if (res.status === 401 || res.status === 403 || res.status === 404 || res.status === 410) {
        const body = await res.json().catch(() => null);
        this.stop();
        this.onStatus('rejected');
        this.onRejected(res.status, body?.error?.message ?? '이 방에 들어갈 수 없어요.');
        return;
      } else if (res.status !== 204) {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  async loop() {
    while (!this.stopped) {
      this.onStatus(this.retry ? 'retrying' : 'connecting');
      this.controller = new AbortController();
      try {
        const res = await fetch(`/api/rooms/${this.code}/stream`, { headers: { Authorization: `Bearer ${this.token}` }, signal: this.controller.signal });
        if (res.status === 401 || res.status === 403 || res.status === 404 || res.status === 410) {
          const body = await res.json().catch(() => null);
          this.stopped = true;
          this.onStatus('rejected');
          this.onRejected(res.status, body?.error?.message ?? '이 방에 들어갈 수 없어요.');
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        this.retry = 0;
        this.onStatus('open');
        this.armWatchdog();
        this.firstView();
        await this.read(res.body.getReader());
      } catch {
        // dropped; fall through to retry
      }
      clearTimeout(this.watchdog);
      this.stopPolling();
      if (this.stopped) return;
      this.retry += 1;
      this.onStatus('retrying');
      await new Promise((r) => setTimeout(r, Math.min(5000, 500 * 2 ** Math.min(this.retry, 4))));
    }
  }

  async read(reader) {
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      // Once a connection has fallen back to long-polling it stays there: a held-back stream that
      // later lets data through still arrives in late bursts. The stream only keeps us present.
      this.gotData = true;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const event = /^event: (.+)$/m.exec(block)?.[1];
        const data = /^data: (.+)$/m.exec(block)?.[1];
        if (!event || !data) continue;
        const parsed = JSON.parse(data);
        if (event === 'state') this.deliver(parsed);
        else if (this.polling) continue; // steps and motions come with the polled views instead
        else if (event === 'pos') {
          if (parsed.stateVersion > this.applied) this.applied = parsed.stateVersion;
          this.onPos(parsed);
        }
        else if (event === 'anim') this.onAnim?.(parsed);
        else if (event === 'left') {
          // this seat left the room for good (from another tab): the token no longer works
          this.stop();
          this.onStatus('rejected');
          this.onRejected(401, parsed.message);
          return;
        }
        else if (event === 'deleted') {
          this.stop();
          this.onStatus('rejected');
          this.onRejected(410, parsed.message);
          return;
        }
      }
    }
  }

  async act(type, payload = {}) {
    const res = await api('POST', `/api/rooms/${this.code}/actions`, { body: { type, requestId: crypto.randomUUID(), ...payload, ...(this.polling ? { withView: true } : {}) }, token: this.token });
    if (res.status === 200 && res.body?.view) {
      const { view } = res.body;
      delete res.body.view;
      this.deliver(view);
    }
    // A stream that lets some data through can still hold the rest back. If the change this action
    // made has not come down the stream shortly after, switch to long-polling for good.
    const v = res.body?.stateVersion;
    if (res.status === 200 && typeof v === 'number' && !this.polling) {
      setTimeout(() => {
        if (!this.polling && !this.stopped && this.applied < v) this.startPolling();
      }, 1500);
    }
    return res;
  }
}

// Tiny DOM builder: h('div', { class: 'x', onclick }, 'text', child)
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === false || v === null || v === undefined) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
