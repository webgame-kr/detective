// Dialogue typewriter (UI handoff, part 3). Script marks: {keyword} · ~shake~ · a whole line in
// (parentheses) is stage direction. Every letter is laid out first and shown one by one with
// visibility, so line breaks never move while typing. Text is set with textContent only.

export const SPEED = { slow: 70, normal: 40, fast: 22, instant: 0 };
const SPEED_KEY = 'mystery:textSpeed';
const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function savedSpeed() {
  try {
    const s = localStorage.getItem(SPEED_KEY);
    return s in SPEED ? s : 'normal';
  } catch {
    return 'normal';
  }
}

export function saveSpeed(s) {
  try {
    localStorage.setItem(SPEED_KEY, s);
  } catch {
    // storage unavailable: this tab keeps the choice
  }
}

export function parse(text) {
  const t = String(text ?? '');
  if (/^\(.*\)$/s.test(t.trim())) return [...t].map((ch) => ({ ch, t: 'act' }));
  const out = [];
  let mode = 'n';
  for (const ch of t) {
    if (ch === '{' && mode === 'n') mode = 'k';
    else if (ch === '}' && mode === 'k') mode = 'n';
    else if (ch === '~') mode = mode === 's' ? 'n' : 's';
    else out.push({ ch, t: mode });
  }
  return out;
}

export const plain = (text) => parse(text).map((c) => c.ch).join('');

export class Typewriter {
  // opts: { speed, onMouth(open), onKeyword(word) }
  constructor(el, opts = {}) {
    Object.assign(this, { el, opts, timer: null, cells: [], n: 0, done: true, skippedAt: 0 });
  }

  play(text, onDone) {
    this.stop();
    const el = this.el;
    el.textContent = '';
    el.setAttribute('aria-label', plain(text));
    const cells = [];
    let word = null;
    for (const c of parse(text)) {
      if (c.ch === '\n') {
        word = null;
        el.append(document.createElement('br'));
        continue;
      }
      // a space inside a keyword stays highlighted and never breaks the line
      if (c.ch === ' ' && c.t === 'k' && word) {
        const ks = Object.assign(document.createElement('span'), { className: 'tw-c tw-key', textContent: ' ' });
        word.append(ks);
        cells.push({ el: ks, t: 'k', ch: ' ' });
        continue;
      }
      if (c.ch === ' ') {
        word = null;
        const sp = Object.assign(document.createElement('span'), { textContent: ' ' });
        sp.setAttribute('aria-hidden', 'true');
        el.append(sp);
        continue;
      }
      if (!word) {
        word = Object.assign(document.createElement('span'), { className: 'tw-w' });
        word.setAttribute('aria-hidden', 'true');
        el.append(word);
      }
      const s = Object.assign(document.createElement('span'), { className: `tw-c${c.t === 'k' ? ' tw-key' : ''}${c.t === 'act' ? ' tw-act' : ''}`, textContent: c.ch });
      word.append(s);
      cells.push({ el: s, t: c.t, ch: c.ch });
    }
    Object.assign(this, { cells, n: 0, done: false, onDone, wait: 0 });
    const ms = SPEED[this.opts.speed ?? 'normal'];
    const isAct = cells[0]?.t === 'act';
    if (!ms || isAct || !cells.length) return this.finish(isAct);
    this.timer = setInterval(() => this.tick(), ms);
  }

  setSpeed(s) {
    this.opts.speed = s;
  }

  reveal(i, fresh) {
    const c = this.cells[i];
    c.el.classList.add('is-on');
    if (reduce()) return;
    if (c.t === 'k' && fresh) c.el.classList.add('tw-pop');
    if (c.t === 's') c.el.classList.add('tw-shake');
  }

  // fires once at the last letter of each keyword
  keywordEndsAt(i) {
    const c = this.cells[i];
    const next = this.cells[i + 1];
    if (c.t !== 'k' || (next && next.t === 'k')) return;
    let w = '';
    for (let j = i; j >= 0 && this.cells[j].t === 'k'; j--) w = this.cells[j].ch + w;
    this.opts.onKeyword?.(w.trim());
  }

  tick() {
    if (this.wait > 0) {
      this.wait -= 1;
      return;
    }
    if (this.n >= this.cells.length) return this.finish();
    const i = this.n;
    const c = this.cells[i];
    this.reveal(i, true);
    this.n += 1;
    this.opts.onMouth?.(Math.floor(this.n / 2) % 2 === 1);
    if ('.?!…'.includes(c.ch)) this.wait = 8;
    else if (c.ch === ',') this.wait = 5;
    this.keywordEndsAt(i);
  }

  // Skip: show the rest at once. Keywords not yet reached still report.
  finish(isAct = false) {
    this.stop();
    for (let i = this.n; i < this.cells.length; i++) {
      this.reveal(i, false);
      this.keywordEndsAt(i);
      if (isAct && !reduce()) this.cells[i].el.classList.add('tw-fade');
    }
    this.n = this.cells.length;
    this.done = true;
    this.skippedAt = Date.now();
    this.opts.onMouth?.(false);
    const cb = this.onDone;
    this.onDone = null;
    cb?.();
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }
}
