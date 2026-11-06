// The puzzle window (puzzle:v1): a board opened from an object of kind "puzzle". The server holds
// the board; every move is sent and the window redraws from the view it gets back, so another
// player can carry on where someone left off. The answer is never here: the server judges.
// Works with the mouse (click, or drag a card onto a slot), touch (tap a card, tap a slot) and the
// keyboard alone (arrows choose, Enter picks up and puts down, Esc lets go or closes).
// Types: sort (cards into slots) and shunt (a track board: choose a car, slide it one cell at a time
// with the arrows or a tap on a lit cell; the times on the worksheet are confirmed one by one).
import { h } from './net.js';

// 을/를 after a card name: by the last syllable's final consonant, digits read aloud (E-3 → 삼 → 을)
const OBJ = (word) => {
  const last = word.at(-1) ?? '';
  const code = last.charCodeAt(0) - 0xac00;
  if (code >= 0 && code <= 11171) return code % 28 ? '을' : '를';
  if (/\d/.test(last)) return '013678'.includes(last) ? '을' : '를';
  return '을(를)';
};
const withObj = (word) => `${word}${OBJ(word)}`;

const KEY_HELP = '끌어서 놓기 · 키보드: 방향키로 상자 고르기, Enter로 집기·놓기, Esc로 내려놓기';
const SHUNT_HELP = '방향키로 블록 고르기 · Enter로 잡기 · 잡은 뒤 방향키로 밀기 · 분기점에서만 선로를 바꿀 수 있어요';
// the paint of the cars (ui_shunt): the fixed train navy, slate, wine, brown; the cars that move green, blue, grey
const FIXED_CARS = ['#2A2D40', '#5E6470', '#7A3F44', '#8A5C48'];
const FREE_CARS = ['#2F6A5E', '#3A6FD8', '#8A8F9A', '#7A5A9A'];
// the slots' colour chips by order (ui_sort): blue, yellow, grey, red (the star case's "어디에도 맞지 않음")
const SLOT_TONES = ['#3A6FD8', '#E2B04A', '#8A8F9A', '#C84A40', '#2F6A5E', '#7A5A9A'];
// 이/가 after a car name, the same way as 을/를 above
const SUBJ = (word) => (OBJ(word) === '을' ? '이' : OBJ(word) === '를' ? '가' : '이(가)');
const withSubj = (word) => `${word}${SUBJ(word)}`;
// 으로/로 after a cell name ("… 3번 칸" → 으로)
const withTo = (word) => {
  const code = (word.at(-1) ?? '').charCodeAt(0) - 0xac00;
  if (code < 0 || code > 11171) return `${word}(으)로`;
  const fin = code % 28;
  return `${word}${fin && fin !== 8 ? '으로' : '로'}`;
};

// the cells of a track board and who neighbours whom (the server checks every move again)
function yard(board) {
  const cells = new Map();
  for (const t of board.tracks) for (let i = 0; i < t.cells; i++) cells.set(`${t.id}:${i}`, { track: t, i, col: t.x + i, row: t.row, key: `${t.id}:${i}` });
  const links = new Map([...cells.keys()].map((k) => [k, []]));
  for (const l of board.links) {
    const a = `${l.a[0]}:${l.a[1]}`;
    const b = `${l.b[0]}:${l.b[1]}`;
    links.get(a)?.push(b);
    links.get(b)?.push(a);
  }
  const at = new Map(board.blocks.map((bl) => [`${bl.at[0]}:${bl.at[1]}`, bl]));
  // one step from a cell: along the track sideways, across a junction up or down
  const step = (from, dir) => {
    const c = cells.get(from);
    if (!c) return null;
    if (dir === 'left' || dir === 'right') return cells.get(`${c.track.id}:${c.i + (dir === 'right' ? 1 : -1)}`) ?? null;
    return links.get(from).map((k) => cells.get(k)).find((n) => (dir === 'down' ? n.row > c.row : n.row < c.row)) ?? null;
  };
  const near = (from) => ['left', 'right', 'up', 'down'].map((d) => step(from, d)).filter(Boolean);
  return { cells, links, at, step, near };
}

export class PuzzleWindow {
  constructor({ send, onGained, onOpenChange }) {
    Object.assign(this, { send, onGained, onOpenChange });
    this.view = null;
    this.held = null; // card id picked up
    this.status = '';
    this.closing = null; // object id being closed, until the server agrees
    this.busy = false;
    this.root = h('div', { class: 'nui pz-layer', hidden: true });
    document.body.append(this.root);
    this.onKey = this.onKey.bind(this);
    window.addEventListener('keydown', this.onKey, true);
  }

  isOpen() {
    return Boolean(this.view);
  }

  // every new room state: open, refresh or close to match what the server says is open for me
  sync(view) {
    if (this.closing && (!view || view.objectId !== this.closing)) this.closing = null;
    if (!view || this.closing === view.objectId) {
      if (this.view) this.hide();
      return;
    }
    const fresh = !this.view || this.view.objectId !== view.objectId;
    this.view = view;
    if (fresh) {
      this.held = null;
      this.status = view.solved ? '이미 다 맞춘 판이에요.' : '';
      this.root.hidden = false;
      this.onOpenChange?.(true);
    }
    const pieces = view.type === 'shunt' ? view.board.blocks.filter((b) => !b.fixed) : view.board.cards;
    if (this.held && (view.solved || !pieces.some((c) => c.id === this.held))) this.held = null;
    this.draw(fresh ? 'first' : null);
  }

  hide() {
    this.view = null;
    this.held = null;
    this.root.hidden = true;
    this.root.replaceChildren();
    this.onOpenChange?.(false);
  }

  async close() {
    if (!this.view) return;
    this.closing = this.view.objectId;
    this.hide();
    await this.send({ op: 'close' });
  }

  async move(payload) {
    if (this.busy || !this.view) return null;
    this.busy = true;
    try {
      const res = await this.send({ objectId: this.view.objectId, ...payload });
      if (res.status !== 200) {
        this.say(res.body?.error?.message ?? '판을 움직이지 못했어요.');
        return res;
      }
      if (res.body.gained?.length) this.onGained?.(res.body.gained);
      if (res.body.puzzle && this.view && res.body.puzzle.objectId === this.view.objectId) this.view = res.body.puzzle;
      return res;
    } finally {
      this.busy = false;
    }
  }

  say(text) {
    this.status = text;
    const el = this.root.querySelector('.pz-status');
    if (el) el.textContent = text;
  }

  cardName(id) {
    return this.view.board.cards.find((c) => c.id === id)?.title ?? '';
  }

  slotName(id) {
    return id ? this.view.board.slots.find((s) => s.id === id)?.label ?? '' : this.view.board.tray;
  }

  async pick(cardId) {
    if (this.view.solved) return;
    if (this.held === cardId) {
      this.held = null;
      this.status = `${withObj(this.cardName(cardId))} 내려놓았어요.`;
    } else {
      this.held = cardId;
      this.status = `${withObj(this.cardName(cardId))} 들었어요. 놓을 칸을 고르세요.`;
    }
    this.draw(this.held ? `slot:${this.view.board.places[cardId] ?? ''}` : `card:${cardId}`);
  }

  async place(slotId, cardId = this.held) {
    if (!cardId || this.view.solved) {
      if (!this.view.solved) this.say('먼저 옮길 카드를 골라 주세요.');
      return;
    }
    this.held = null;
    const res = await this.move({ op: 'place', card: cardId, slot: slotId || null });
    if (res?.status === 200) this.status = `${withObj(this.cardName(cardId))} ‘${this.slotName(slotId)}’에 놓았어요.`;
    this.draw(`card:${cardId}`);
  }

  async clear() {
    if (this.view.solved) return;
    this.held = null;
    const res = await this.move({ op: 'clear' });
    if (res?.status === 200) this.status = '카드를 모두 꺼냈어요.';
    this.draw('first');
  }

  async submit() {
    if (this.view.solved) return;
    this.held = null;
    const res = await this.move({ op: 'submit' });
    if (res?.status === 200) this.status = res.body.solved ? '다 맞췄어요!' : res.body.message ?? '';
    this.draw(res?.body?.solved ? 'close' : this.view.type === 'shunt' ? 'submit' : null);
  }

  // ---------- keyboard ----------
  onKey(e) {
    if (!this.view || this.root.hidden) return;
    // the window owns the keyboard while it is open: nothing reaches the map or the notes
    e.stopImmediatePropagation();
    if (e.key === 'Tab') return; // focus moves on its own
    const el = document.activeElement;
    if (e.key === 'Escape') {
      e.preventDefault();
      if (this.held && this.view.type === 'shunt') this.grab(this.held);
      else if (this.held) this.pick(this.held);
      else this.close();
      return;
    }
    if (e.repeat && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      return;
    }
    if (this.view.type === 'shunt' && e.key.startsWith('Arrow')) {
      e.preventDefault();
      this.shuntKey(e.key.slice(5).toLowerCase(), el);
      return;
    }
    const dir = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[e.key];
    if (dir) {
      e.preventDefault();
      // holding a card: arrows go through the places to put it; otherwise through the cards
      const list = [...this.root.querySelectorAll(this.held ? '[data-slot-target]' : '[data-card]:not([disabled])')];
      if (!list.length) return;
      const i = list.indexOf(el);
      const next = list[(i < 0 ? (dir > 0 ? 0 : list.length - 1) : (i + dir + list.length) % list.length)];
      next.focus();
    }
    // Enter and Space press the focused button as buttons always do
  }

  // ---------- shunt: a track board ----------
  blockName(id) {
    return this.view.board.blocks.find((b) => b.id === id)?.label ?? '';
  }

  cellName(key) {
    const [track, i] = key.split(':');
    return `${this.view.board.tracks.find((t) => t.id === track)?.label ?? track} ${Number(i) + 1}번 칸`;
  }

  grab(blockId, tapped = false) {
    if (this.view.solved) return;
    const name = this.blockName(blockId);
    // a tap that lands on the car just slid under the finger is not a letting go
    if (tapped && this.held === blockId && Date.now() - (this.slidAt ?? 0) < 450) return;
    if (this.held === blockId) {
      this.held = null;
      this.status = `${withObj(name)} 놓았어요.`;
    } else {
      this.held = blockId;
      this.status = `${withObj(name)} 잡았어요. 방향키나 밝게 표시된 칸으로 옮겨요.`;
    }
    this.draw(`block:${blockId}`);
  }

  async slide(to) {
    const id = this.held;
    if (!id || this.view.solved) return;
    const [track, i] = to.split(':');
    const res = await this.move({ op: 'move', block: id, to: [track, Number(i)] });
    this.slidAt = Date.now();
    if (res?.status === 200) this.status = `${withSubj(this.blockName(id))} ${withTo(this.cellName(to))} 갔어요.`;
    this.draw(`block:${id}`);
  }

  async resetBoard() {
    if (this.view.solved) return;
    this.held = null;
    const res = await this.move({ op: 'reset' });
    if (res?.status === 200) this.status = '객차를 오늘 아침 자리로 돌려놓았어요.';
    this.draw('first');
  }

  shuntKey(dir, el) {
    const b = this.view.board;
    const y = yard(b);
    if (this.held) {
      const from = b.blocks.find((x) => x.id === this.held);
      const to = y.step(`${from.at[0]}:${from.at[1]}`, dir);
      if (!to) {
        this.say(dir === 'up' || dir === 'down' ? '여기에는 다른 선로로 가는 분기점이 없어요.' : '선로가 여기서 끝나요.');
        return;
      }
      const there = y.at.get(to.key);
      if (there) {
        this.say(`${this.cellName(to.key)}에는 ${withSubj(there.label)} 있어요.`);
        return;
      }
      this.slide(to.key);
      return;
    }
    // nothing held: the arrows go through the cars that can move
    const list = [...this.root.querySelectorAll('[data-block]:not([disabled])')];
    if (!list.length) return;
    const step = dir === 'left' || dir === 'up' ? -1 : 1;
    const i = list.indexOf(el);
    list[i < 0 ? (step > 0 ? 0 : list.length - 1) : (i + step + list.length) % list.length].focus();
  }

  shuntBody(v) {
    const b = v.board;
    const y = yard(b);
    const cols = Math.max(...b.tracks.map((t) => t.x + t.cells));
    const rows = Math.max(...b.tracks.map((t) => t.row)) + 1;
    const held = this.held ? b.blocks.find((x) => x.id === this.held) : null;
    const targets = new Set(held ? y.near(`${held.at[0]}:${held.at[1]}`).filter((c) => !y.at.has(c.key)).map((c) => c.key) : []);
    const marks = new Map(b.marks.map((m) => [`${m.at[0]}:${m.at[1]}`, m.label]));
    // the cars' paint (ui_shunt): the fixed train in its own colours, the cars that move in theirs
    const fixed = b.blocks.filter((bl) => bl.fixed).map((bl) => bl.id);
    const free = b.blocks.filter((bl) => !bl.fixed).map((bl) => bl.id);
    const paint = (bl) => (bl.fixed ? FIXED_CARS[fixed.indexOf(bl.id) % FIXED_CARS.length] : FREE_CARS[free.indexOf(bl.id) % FREE_CARS.length]);
    // the junctions between tracks, in cell units over the grid (the first column holds the names);
    // the tracks themselves are strips of sleepers and rails under their cells
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'pz-rails');
    svg.setAttribute('viewBox', `0 0 ${cols + 1} ${rows}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = b.links.map((l) => {
      const a = y.cells.get(`${l.a[0]}:${l.a[1]}`);
      const c = y.cells.get(`${l.b[0]}:${l.b[1]}`);
      const xy = `x1="${a.col + 1.5}" y1="${a.row + 0.5}" x2="${c.col + 1.5}" y2="${c.row + 0.5}"`;
      return `<line class="pz-rail--bed" ${xy} /><line class="pz-rail--link" ${xy} />`;
    }).join('');
    const strips = b.tracks.map((t) => h('span', { class: 'pz-strip', 'aria-hidden': 'true', style: `grid-column: ${t.x + 2} / span ${t.cells}; grid-row: ${t.row + 1}` }));
    const labels = [];
    for (let r = 0; r < rows; r++) {
      const names = b.tracks.filter((t) => t.row === r).map((t) => t.label).join(' · ');
      if (names) labels.push(h('span', { class: 'pz-track-name', style: `grid-column: 1; grid-row: ${r + 1}` }, names));
    }
    const cells = [...y.cells.values()].map((c) => {
      const bl = y.at.get(c.key);
      const place = `grid-column: ${c.col + 2}; grid-row: ${c.row + 1}`;
      const mark = marks.get(c.key);
      const junction = y.links.get(c.key).length > 0;
      if (bl) {
        const isHeld = this.held === bl.id;
        return h('button', {
          type: 'button',
          class: `pz-cell pz-car${bl.fixed ? ' is-fixed' : ''}${isHeld ? ' is-held' : ''}${v.solved ? ' is-solved' : ''}${junction ? ' is-junction' : ''}`,
          style: `${place}; --car: ${paint(bl)}`,
          'data-block': bl.fixed ? null : bl.id,
          'data-key': `block:${bl.id}`,
          disabled: bl.fixed || v.solved,
          'aria-pressed': bl.fixed ? null : isHeld ? 'true' : 'false',
          'aria-label': `${bl.label}, ${this.cellName(c.key)}${mark ? ` (${mark})` : ''}${bl.fixed ? ', 움직일 수 없음' : ''}`,
          onclick: (e) => this.grab(bl.id, e.detail > 0),
        }, h('span', { class: 'pz-car__name' }, bl.label), mark ? h('small', { class: 'pz-cell__mark' }, mark) : null);
      }
      const lit = targets.has(c.key);
      return h('button', {
        type: 'button',
        class: `pz-cell pz-track${lit ? ' is-target' : ''}${junction ? ' is-junction' : ''}${mark ? ' is-marked' : ''}`,
        style: place,
        'data-key': `cell:${c.key}`,
        disabled: !lit,
        tabindex: lit ? null : '-1',
        'aria-label': lit ? `${withObj(held.label)} ${withTo(this.cellName(c.key))} 옮기기` : `${this.cellName(c.key)}, 비어 있음${mark ? ` (${mark})` : ''}`,
        onclick: () => this.slide(c.key),
      }, lit ? h('span', { class: 'pz-cell__go' }, '여기로') : mark ? h('span', { class: 'pz-cell__spot' }, mark) : null);
    });
    return h('div', { class: 'px pz-yard-wrap' },
      h('div', { class: 'pz-yard', style: `--cols: ${cols}; --rows: ${rows}` }, ...strips, svg, ...labels, ...cells));
  }

  // the times to lay out, as chips: done (green, ✓), now (sand, bold), later (faded)
  shuntSteps(v) {
    const b = v.board;
    return h('ol', { class: 'pz-steps', 'aria-label': '맞출 시각' }, ...b.steps.map((st, i) => {
      const done = st.done || v.solved;
      const now = !v.solved && i === b.current;
      return h('li', { class: `px pz-step${done ? ' is-done' : now ? ' is-now' : ''}`, 'aria-current': now ? 'step' : null },
        h('span', { class: 'pz-step__no', 'aria-hidden': 'true' }, String.fromCodePoint(0x2460 + i)),
        h('b', {}, st.time), h('span', {}, st.label),
        done ? h('span', { class: 'pz-step__ok', 'aria-hidden': 'true' }, '✓') : null,
        h('span', { class: 'pz-sr' }, done ? ' 맞췄어요' : now ? ' 지금 맞출 시각' : ' 다음'));
    }));
  }

  // the window's frame, the same for every board: title with its line, what is missing, the result,
  // the body, then the status and keys on the left of the buttons, and the records it asks for
  frame(v, { cls, body, buttons, keys, missingLine }) {
    const records = v.records ?? [];
    const needs = v.missing.length && !v.solved
      ? h('div', { class: 'px pz-needs', role: 'note' }, h('b', {}, v.notice ?? '아직 맞출 기록이 부족해요'), h('span', {}, missingLine), h('ul', {}, ...v.missing.map((n) => h('li', {}, `‘${n}’`))))
      : null;
    const result = v.solved
      ? h('div', { class: 'px pz-result', role: 'status' }, h('b', {}, v.solvedBy ? `${v.solvedBy}님이 다 맞췄어요` : '다 맞췄어요'), v.result?.text ? h('span', {}, v.result.text) : null, v.result?.clues.length ? h('span', { class: 'pz-result__clues' }, `얻은 기록: ${v.result.clues.map((n) => `‘${n}’`).join(', ')}`) : null)
      : null;
    const left = v.attemptsLeft === null ? null : `남은 기회 ${v.attemptsLeft}번`;
    return h('section', { class: `px drop pz ${cls}`, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'pzTitle' },
      h('header', { class: 'pz-head' },
        h('div', { class: 'pz-title' }, h('h2', { id: 'pzTitle' }, v.title), v.intro ? h('span', { class: 'pz-intro' }, v.intro) : null),
        h('button', { type: 'button', class: 'px pz-btn pz-close', 'data-key': 'close', 'aria-label': `${v.label} 닫기`, onclick: () => this.close() }, '닫기', h('kbd', {}, 'Esc'))),
      needs,
      result,
      body,
      h('footer', { class: 'pz-foot' },
        h('div', { class: 'pz-foot__text' },
          h('p', { class: 'pz-status', role: 'status', 'aria-live': 'polite' }, this.status),
          h('p', { class: 'pz-keys' }, keys)),
        h('div', { class: 'pz-actions' }, left ? h('span', { class: 'pz-left' }, left) : null, ...buttons)),
      records.length
        ? h('p', { class: 'pz-records', 'aria-label': '맞출 기록' }, h('b', {}, '맞출 기록'),
          ...records.map((r) => h('span', { class: r.have ? 'is-have' : 'is-missing' }, ` · ${r.name} `, h('i', { 'aria-label': r.have ? '있음' : '없음' }, r.have ? '✓' : '✗'))))
        : null);
  }

  drawShunt(focus) {
    const v = this.view;
    const before = document.activeElement;
    const keep = focus ?? (this.root.contains(before) ? before?.dataset.key : null);
    // a narrow screen scrolls the yard sideways: keep where it was, or start where the cars move
    const scrolled = this.root.querySelector('.pz-yard-wrap')?.scrollLeft;
    const b = v.board;
    const body = h('div', { class: 'pz-body pz-body--shunt' },
      this.shuntSteps(v),
      b.sheet ? h('aside', { class: 'px pz-sheet', 'aria-label': b.sheet.title }, h('b', {}, b.sheet.title), h('ol', {}, ...b.sheet.rows.map((r) => h('li', {}, r)))) : null,
      this.shuntBody(v));
    const panel = this.frame(v, {
      cls: 'pz--shunt',
      body,
      missingLine: '객차는 옮겨 볼 수 있지만, 이 기록이 있어야 맞춰 볼 수 있어요.',
      keys: SHUNT_HELP,
      buttons: [
        h('button', { type: 'button', class: 'px pz-btn pz-btn--plain', 'data-key': 'reset', disabled: v.solved || this.busy, onclick: () => this.resetBoard() }, '처음부터'),
        h('button', { type: 'button', class: 'px pz-btn pz-btn--go', 'data-key': 'submit', disabled: v.solved || this.busy, 'aria-label': b.steps[b.current] && !v.solved ? `${b.steps[b.current].time} 편성 확인` : null, onclick: () => this.submit() }, '이 시각 편성 확인'),
      ],
    });
    this.root.replaceChildren(h('div', { class: 'pz-dim', onclick: () => this.close() }), panel);
    const wrap = panel.querySelector('.pz-yard-wrap');
    if (wrap.scrollWidth > wrap.clientWidth) {
      const first = panel.querySelector('[data-block]');
      wrap.scrollLeft = scrolled ?? (first ? Math.max(0, first.offsetLeft - 60) : 0);
    }
    const target = keep === 'first' ? panel.querySelector('[data-block]:not([disabled])') ?? panel.querySelector('.pz-close')
      : keep === 'close' ? panel.querySelector('.pz-close')
        : keep ? panel.querySelector(`[data-key="${CSS.escape(keep)}"]`) : null;
    target?.focus({ preventScroll: true });
    if (target && wrap.contains(target)) target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  // ---------- drawing ----------
  draw(focus = null) {
    const v = this.view;
    if (!v) return;
    if (v.type === 'shunt') {
      this.drawShunt(focus);
      return;
    }
    const before = document.activeElement;
    const keep = focus ?? (this.root.contains(before) ? before?.dataset.key : null);
    const b = v.board;
    const lying = (slot) => b.cards.filter((c) => (b.places[c.id] ?? '') === slot);
    // a card (ui_sort): its number with the first line beside it, the other lines under it
    const card = (c) => h('button', {
      type: 'button',
      class: `px pz-card${this.held === c.id ? ' is-held' : ''}${v.solved ? ' is-solved' : ''}`,
      'data-card': c.id,
      'data-key': `card:${c.id}`,
      'aria-pressed': this.held === c.id ? 'true' : 'false',
      'aria-label': `${c.title}, ${c.lines.join(', ')}, ${this.slotName(b.places[c.id] ?? '')}`,
      draggable: v.solved ? 'false' : 'true',
      disabled: v.solved,
      onclick: () => this.pick(c.id),
      ondragstart: (e) => {
        e.dataTransfer.setData('text/plain', c.id);
        e.dataTransfer.effectAllowed = 'move';
      },
    },
    h('span', { class: 'pz-card__top' }, h('b', { class: 'pz-card__title' }, c.title), c.lines[0] ? h('span', { class: 'pz-card__name' }, c.lines[0]) : null),
    c.lines.length > 1 ? h('span', { class: 'pz-card__line' }, c.lines.slice(1).join(' · ')) : null);
    const zone = (slotId, label, cls, tone = null) => {
      const cards = lying(slotId);
      return h('div', {
        class: `px pz-zone ${cls}${this.held ? ' is-target' : ''}`,
        style: tone ? `--tone: ${tone}` : null,
        ondragover: (e) => !v.solved && e.preventDefault(),
        ondrop: (e) => {
          e.preventDefault();
          const id = e.dataTransfer.getData('text/plain');
          if (id) this.place(slotId, id);
        },
      },
      h('button', {
        type: 'button',
        class: 'pz-zone__head',
        'data-slot-target': slotId,
        'data-key': `slot:${slotId}`,
        disabled: v.solved,
        'aria-label': this.held ? `${withObj(this.cardName(this.held))} ‘${label}’에 놓기` : `${label}, 카드 ${cards.length}장`,
        onclick: () => this.place(slotId),
      }, tone ? h('i', { class: 'pz-zone__chip', 'aria-hidden': 'true' }) : null, h('span', {}, label), h('small', {}, `${cards.length}장`)),
      h('div', { class: 'pz-zone__cards' }, ...(cards.length ? cards.map(card) : [h('span', { class: 'pz-zone__empty' }, this.held ? '여기에 놓기' : '비어 있어요')])));
    };
    const body = h('div', { class: `pz-body${b.sheet ? '' : ' pz-body--wide'}` },
      b.sheet ? h('aside', { class: 'px pz-sheet', 'aria-label': b.sheet.title }, h('b', {}, b.sheet.title), h('ol', {}, ...b.sheet.rows.map((r) => h('li', {}, r)))) : null,
      zone('', b.tray, 'pz-zone--tray'),
      h('div', { class: 'pz-slots', style: `--slots: ${b.slots.length}` }, ...b.slots.map((s, i) => zone(s.id, s.label, `pz-zone--slot${i === b.slots.length - 1 && b.slots.length > 2 ? ' is-last' : ''}`, SLOT_TONES[i % SLOT_TONES.length]))));
    const panel = this.frame(v, {
      cls: 'pz--sort',
      body,
      missingLine: '판은 옮겨 볼 수 있지만, 이 기록이 있어야 맞춰 볼 수 있어요.',
      keys: KEY_HELP,
      buttons: [
        h('button', { type: 'button', class: 'px pz-btn pz-btn--plain', 'data-key': 'clear', disabled: v.solved || this.busy, onclick: () => this.clear() }, '모두 꺼내기'),
        h('button', { type: 'button', class: 'px pz-btn pz-btn--go', 'data-key': 'submit', disabled: v.solved || this.busy, onclick: () => this.submit() }, '분류 마치기'),
      ],
    });
    this.root.replaceChildren(h('div', { class: 'pz-dim', onclick: () => this.close() }), panel);
    const target = keep === 'first' ? panel.querySelector('[data-card]:not([disabled])') ?? panel.querySelector('.pz-close')
      : keep === 'close' ? panel.querySelector('.pz-close')
        : keep ? panel.querySelector(`[data-key="${CSS.escape(keep)}"]`) : null;
    target?.focus({ preventScroll: keep === null });
  }
}
