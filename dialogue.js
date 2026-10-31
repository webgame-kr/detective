import { h } from './net.js';
import { Typewriter, savedSpeed } from './typewriter.js';
import { dotIcon } from './noteui.js';

// The dialogue box (UI handoff, part 3), driven by the server's dialogue state: the current line
// types out, then its choices appear, plus "단서 보여 주기", which opens a clue picker. Keys are taken
// first (capture phase) while it is open, so walking and note shortcuts never leak through.
//   line → choices → (clue picker → reaction) → next line or end

// A portrait cut from its sheet: one column, still face on top and talking face below.
export function portrait(pt, size, talking = false) {
  const box = h('span', { class: 'ig-face', style: `width:${size}px;height:${size}px` });
  if (!pt) return box;
  const k = size / pt.size;
  const img = h('img', { src: pt.url, alt: '', style: `left:${-pt.col * size}px;top:${talking ? -size : 0}px;width:${8 * size}px;height:${2 * size}px` });
  // sheets may have any number of columns; size the image from its real width once loaded
  img.addEventListener('load', () => {
    img.style.width = `${img.naturalWidth * k}px`;
    img.style.height = `${img.naturalHeight * k}px`;
  });
  box.append(img);
  box.setTalking = (on) => (img.style.top = `${on ? -size : 0}px`);
  return box;
}

const keycap = (label, cls = '') => h('span', { class: `px ig-key ${cls}`, 'aria-hidden': 'true' }, label);

export class DialogueBox {
  // opts: { act(type, payload), clues() -> [{id,name,description,where}], onOpenPerson(id), onKeyword(dialogue), onStart(), onEnd() }
  constructor(root, opts) {
    this.opts = opts;
    this.d = null; // the server's dialogue view
    this.key = null; // which line is on screen
    this.mode = 'line'; // 'line' | 'reaction' | 'clues'
    this.picked = 0;
    this.goPerson = null;
    this.face = null;
    this.dim = h('div', { class: 'ig-dim', hidden: true });
    this.nameEl = h('button', { type: 'button', class: 'px ig-name', title: '대화가 끝나면 이 인물의 기록을 열어요', onclick: () => (this.goPerson = this.d?.characterId ?? null) });
    this.frame = h('span', { class: 'px drop ig-portrait' });
    this.lineEl = h('p', { class: 'ig-line', 'aria-live': 'polite' });
    this.choicesEl = h('div', { class: 'ig-choices', hidden: true });
    this.hintEl = h('button', { type: 'button', class: 'ig-hint', onclick: () => this.hintAction() });
    // while cornering someone: how many wrong cards they will still sit through
    this.livesEl = h('span', { class: 'ig-lives', hidden: true });
    this.box = h('section', { class: 'px drop ig-dialog', role: 'dialog', 'aria-label': '대화', hidden: true }, this.frame, this.nameEl, this.livesEl, this.lineEl, this.choicesEl, this.hintEl);
    this.grid = h('div', { class: 'ig-clues__grid', role: 'listbox', 'aria-label': '단서' });
    this.cluesEl = h('section', { class: 'px drop ig-clues', 'aria-label': '보여 줄 단서 고르기', hidden: true },
      h('div', { class: 'ig-clues__head' },
        h('h2', { class: 'ig-clues__title' }, dotIcon('notebook'), '내 수첩에서 고르기'),
        h('span', { class: 'ig-clues__keys' }, '←→ 고르기 · E 보여 주기 · Esc 돌아가기')),
      this.grid);
    root.replaceChildren(this.dim, this.cluesEl, this.box);
    this.tw = new Typewriter(this.lineEl, {
      speed: savedSpeed(),
      onMouth: (open) => this.face?.setTalking?.(open),
      onKeyword: () => this.mode === 'line' && this.opts.onKeyword?.(this.d),
    });
    this.onKey = this.onKey.bind(this);
    window.addEventListener('keydown', this.onKey, true);
  }

  isActive() {
    return Boolean(this.d);
  }

  setSpeed(s) {
    this.tw.setSpeed(s);
  }

  // Called with every new view. A new line types out; the same line is left alone.
  update(d) {
    if (!d) {
      if (this.d) this.close();
      return;
    }
    const starting = !this.d;
    const speakerChanged = this.d?.characterId !== d.characterId;
    this.d = d;
    this.livesEl.hidden = !d.confront;
    if (d.confront) {
      const { lives, max } = d.confront;
      this.livesEl.textContent = `인내심 ${'●'.repeat(lives)}${'○'.repeat(Math.max(0, max - lives))}`;
      this.livesEl.setAttribute('aria-label', `틀린 단서를 ${lives}번 더 내밀 수 있어요`);
      this.livesEl.title = '틀린 단서를 내밀 때마다 한 칸씩 줄어요. 다 줄면 더는 말하지 않아요.';
    }
    const key = `${d.dialogueId}:${d.nodeId}:${d.text}`;
    if (starting) {
      this.box.hidden = false;
      this.dim.hidden = false;
      this.goPerson = null;
      this.opts.onStart?.();
    }
    if (starting || speakerChanged) {
      this.nameEl.textContent = d.speaker;
      this.nameEl.classList.remove('tw-drop');
      void this.nameEl.offsetWidth;
      this.nameEl.classList.add('tw-drop');
      this.face = portrait(d.portrait, 144);
      this.frame.replaceChildren(this.face);
    }
    if (key !== this.key) {
      this.key = key;
      this.showLine(d.text);
    } else if (this.mode === 'line' && this.tw.done) {
      this.showChoices(); // the choices on screen may change with conditions
    }
  }

  showLine(text, mode = 'line') {
    this.mode = mode;
    this.cluesEl.hidden = true;
    this.choicesEl.hidden = true;
    this.choicesEl.replaceChildren();
    this.setHint('skip');
    this.tw.play(text, () => (mode === 'reaction' ? this.setHint('back') : this.showChoices()));
  }

  showChoices() {
    const d = this.d;
    const items = [
      ...d.choices.map((c, i) => h('button', { type: 'button', class: 'px drop ig-choice', onclick: () => this.choose(i) }, keycap(String(i + 1)), c.text)),
      h('button', { type: 'button', class: 'px drop ig-choice ig-choice--clue', onclick: () => this.choose(d.choices.length) }, keycap(String(d.choices.length + 1)), dotIcon('notebook'), '단서 보여 주기'),
    ];
    this.choicesEl.replaceChildren(...items);
    this.choicesEl.hidden = false;
    this.setHint(d.choices.length ? 'esc' : 'close');
  }

  setHint(kind) {
    this.hintEl.dataset.kind = kind;
    this.hintEl.hidden = kind === 'none';
    const label = { skip: [keycap('Space', 'ig-key--space'), '건너뛰기'], back: [keycap('Space', 'ig-key--space'), '돌아가기', h('span', { class: 'tw-bob' }, '▼')], close: [keycap('Space', 'ig-key--space'), '대화 끝내기'], esc: [keycap('Esc', 'ig-key--wide'), '대화 끝내기'] }[kind] ?? [];
    this.hintEl.replaceChildren(...label);
  }

  hintAction() {
    const kind = this.hintEl.dataset.kind;
    if (kind === 'esc' || kind === 'close') this.end();
    else this.primary();
  }

  choose(i) {
    const d = this.d;
    if (!d || this.mode !== 'line' || !this.tw.done) return;
    if (i === d.choices.length) return this.openClues();
    const c = d.choices[i];
    if (c) this.opts.act('choose', { choiceId: c.id });
  }

  openClues() {
    this.mode = 'clues';
    this.picked = 0;
    this.clues = this.opts.clues();
    this.tw.play(`${this.d.speaker}에게 무엇을 보여 줄까요?`);
    this.choicesEl.replaceChildren(
      h('button', { type: 'button', class: 'px drop ig-choice ig-choice--go', onclick: () => this.showPicked() }, keycap('E'), '보여 주기'),
      h('button', { type: 'button', class: 'px drop ig-choice', onclick: () => this.backToLine() }, keycap('Esc', 'ig-key--wide'), '돌아가기'));
    this.choicesEl.hidden = false;
    this.setHint('none');
    this.renderClues();
    this.cluesEl.hidden = false;
  }

  renderClues() {
    if (!this.clues.length) {
      this.grid.replaceChildren(h('p', { class: 'ig-empty' }, '수첩에 단서가 없어요. 먼저 조사해서 단서를 모아 보세요.'));
      return;
    }
    this.grid.replaceChildren(...this.clues.map((c, i) => h('button', {
      type: 'button',
      class: 'px drop ig-clue',
      role: 'option',
      'aria-selected': i === this.picked ? 'true' : 'false',
      onclick: () => (this.picked === i ? this.showPicked() : ((this.picked = i), this.renderClues())),
    }, h('span', { class: 'ig-clue__where' }, c.where), c.hint ? h('span', { class: `ig-clue__hint ig-clue__hint--${c.hint}` }, c.hint === 'show' ? '! 보여 줄 만해요' : '할 말이 있대요') : null, h('span', { class: 'ig-clue__name' }, c.name), h('span', { class: 'ig-clue__desc' }, c.description))));
    this.grid.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }

  async showPicked() {
    const c = this.clues?.[this.picked];
    if (!c) return;
    this.cluesEl.hidden = true;
    const res = await this.opts.act('present', { clueId: c.id });
    if (!this.d) return;
    // a reaction is said here; a clue that moves the talk on arrives as a new line instead
    if (res.status === 200 && res.body.reaction) this.showLine(res.body.reaction, 'reaction');
    else if (res.status !== 200) this.backToLine();
  }

  backToLine() {
    this.mode = 'line';
    this.cluesEl.hidden = true;
    this.tw.play(this.d.text);
    this.tw.finish();
    this.showChoices();
  }

  // Space / E / Enter: finish the line, then move on (never two steps on one press).
  primary() {
    if (!this.tw.done) return this.tw.finish();
    if (Date.now() - this.tw.skippedAt < 150) return;
    if (this.mode === 'clues') return this.showPicked();
    if (this.mode === 'reaction') return this.backToLine();
    if (this.d.choices.length) return this.choose(0);
    this.end();
  }

  end() {
    this.opts.act('closeDialogue');
  }

  close() {
    this.tw.stop();
    const go = this.goPerson;
    Object.assign(this, { d: null, key: null, mode: 'line', goPerson: null });
    this.box.hidden = true;
    this.dim.hidden = true;
    this.cluesEl.hidden = true;
    this.opts.onEnd?.(go);
  }

  onKey(e) {
    if (!this.d || document.getElementById('modal')?.hidden === false) return;
    if (e.key !== 'Escape' && e.target.closest?.('input, textarea, select')) return;
    const k = e.code;
    let handled = true;
    if (e.repeat && /^(Space|KeyE|Enter)$/.test(k)) handled = true;
    else if (k === 'Space' || k === 'KeyE' || k === 'Enter') this.primary();
    else if (k === 'Escape') {
      if (this.mode === 'clues' || this.mode === 'reaction') this.backToLine();
      else this.end();
    } else if (/^(Digit|Numpad)[1-9]$/.test(k)) {
      if (this.mode === 'line') this.choose(Number(k.slice(-1)) - 1);
    } else if ((k === 'ArrowLeft' || k === 'ArrowRight') && this.mode === 'clues' && this.clues.length) {
      this.picked = (this.picked + (k === 'ArrowRight' ? 1 : -1) + this.clues.length) % this.clues.length;
      this.renderClues();
    } else if (!/^(Key[WASD]|Arrow(Up|Down|Left|Right))$/.test(k)) handled = false; // walking stays blocked
    if (handled) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }
}
