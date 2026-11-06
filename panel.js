// The switchboard window (tilestate:v1): an object of kind "panel" opens a row of circuit switches
// and, beside it, the zones they light. The server flips the devices and says which zones are lit;
// the window only draws what it is told and sends which switch was pressed. It sits in the puzzle
// window's layer (puzzle.css .pz-*), with its own pieces (.sb-*).
// Mouse or touch: tap a switch. Keyboard: ←→ choose a switch, Enter or Space flips it, Esc closes.
import { h } from './net.js';

export class PanelWindow {
  constructor({ send, onOpenChange }) {
    Object.assign(this, { send, onOpenChange });
    this.view = null;
    this.closing = null;
    this.busy = false;
    this.status = '';
    this.root = h('div', { class: 'nui pz-layer sb-layer', hidden: true });
    document.body.append(this.root);
    this.onKey = this.onKey.bind(this);
    window.addEventListener('keydown', this.onKey, true);
  }

  isOpen() {
    return Boolean(this.view);
  }

  // every new room state: open, refresh or close to match the panel the server says is open for me
  sync(view) {
    if (this.closing && (!view || view.objectId !== this.closing)) this.closing = null;
    if (!view || this.closing === view.objectId) {
      if (this.view) this.hide();
      return;
    }
    const fresh = !this.view || this.view.objectId !== view.objectId;
    this.view = view;
    if (fresh) {
      this.status = '';
      this.root.hidden = false;
      this.onOpenChange?.(true);
    }
    this.draw(fresh ? 'first' : null);
  }

  hide() {
    this.view = null;
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

  async press(payload, focus) {
    if (this.busy || !this.view) return;
    this.busy = true;
    try {
      const res = await this.send({ objectId: this.view.objectId, ...payload });
      if (res.status !== 200) this.status = res.body?.error?.message ?? '스위치가 움직이지 않았어요.';
      else if (res.body.panel && this.view && res.body.panel.objectId === this.view.objectId) {
        this.view = res.body.panel;
        const s = this.view.switches.find((x) => x.device === payload.device);
        this.status = s ? `${s.label} 회로를 ${s.on ? '켰어요' : '껐어요'}. ${s.name} ${s.lit ? '불이 들어왔어요' : '불이 꺼졌어요'}.` : '모든 회로를 다시 켰어요.';
      }
    } finally {
      this.busy = false;
    }
    if (this.view) this.draw(focus);
  }

  onKey(e) {
    if (!this.view || this.root.hidden) return;
    // the window owns the keyboard while it is open: nothing reaches the map or the notes
    e.stopImmediatePropagation();
    if (e.key === 'Tab') return;
    if (e.key === 'Escape') {
      e.preventDefault();
      this.close();
      return;
    }
    if (e.repeat && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      return;
    }
    const dir = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[e.key];
    if (!dir) return; // Enter and Space press the focused button as buttons always do
    e.preventDefault();
    const list = [...this.root.querySelectorAll('[data-key]')];
    const i = list.indexOf(document.activeElement);
    list[i < 0 ? (dir > 0 ? 0 : list.length - 1) : (i + dir + list.length) % list.length]?.focus();
  }

  draw(focus = null) {
    const v = this.view;
    const before = document.activeElement;
    const keep = focus ?? (this.root.contains(before) ? before?.dataset.key : null);
    const sw = (s) => h('button', {
      type: 'button',
      class: `sb-switch${s.on ? ' is-on' : ' is-off'}`,
      'data-key': `sw:${s.device}`,
      'aria-pressed': s.on ? 'true' : 'false',
      'aria-label': `${s.label} 회로, ${s.name}, ${s.on ? '켜짐' : '꺼짐'}. 누르면 ${s.on ? '꺼요' : '켜요'}`,
      disabled: this.busy,
      onclick: () => this.press({ op: 'toggle', device: s.device }, `sw:${s.device}`),
    },
    h('span', { class: 'sb-lever', 'aria-hidden': 'true' }, h('span', { class: 'sb-knob' })),
    h('b', { class: 'sb-letter' }, s.label),
    h('span', { class: 'sb-name' }, s.name),
    h('span', { class: 'sb-state' }, s.on ? '켜짐' : '꺼짐'));
    const panel = h('section', { class: 'px drop pz sb', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'sbTitle' },
      h('header', { class: 'pz-head' },
        h('div', { class: 'sb-title' }, h('h2', { id: 'sbTitle' }, v.title), v.intro ? h('span', { class: 'sb-intro' }, v.intro) : null),
        h('button', { type: 'button', class: 'px pz-btn pz-close', 'data-key': 'close', onclick: () => this.close() }, '닫기', h('kbd', {}, 'Esc'))),
      h('div', { class: 'sb-body' },
        h('div', { class: 'sb-board', role: 'group', 'aria-label': '회로 스위치' }, ...v.switches.map(sw)),
        // the zones as the map shows them now: lit or dark (what the server keeps, not the switch)
        h('ul', { class: 'sb-zones', 'aria-label': '구역 불빛' }, ...v.switches.map((s) => h('li', { class: `sb-zone${s.lit ? ' is-lit' : ' is-dark'}` }, h('span', {}, s.name), h('small', { class: 'sb-sr' }, s.lit ? ' 밝음' : ' 어두움'))))),
      h('footer', { class: 'pz-foot sb-foot' },
        h('p', { class: 'sb-note' }, v.footer ?? '', v.allOn ? h('button', { type: 'button', class: 'px pz-btn sb-all', 'data-key': 'all', disabled: this.busy, onclick: () => this.press({ op: 'allOn' }, 'all') }, '모두 켜기') : null),
        h('p', { class: 'pz-status', role: 'status', 'aria-live': 'polite' }, this.status),
        h('p', { class: 'pz-keys' }, '←→ 스위치 고르기 · Enter 켜고 끄기 · Esc 닫기')));
    this.root.replaceChildren(h('div', { class: 'pz-dim', onclick: () => this.close() }), panel);
    const target = keep === 'first' ? panel.querySelector('[data-key^="sw:"]') : keep ? panel.querySelector(`[data-key="${keep}"]`) : null;
    target?.focus({ preventScroll: true });
  }
}
