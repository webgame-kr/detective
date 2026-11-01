import { h } from './net.js';

// Shared pieces for the home page and the game screen: case file folders and sheets, clue cards,
// the five-day step indicator and a few line icons.

// 12×12 dot icons from the UI handoff. Fixed markup only; never fed with case or player text.
const ICONS = {
  search: '<path d="M3 1h4v1H3zM2 2h1v1H2zM7 2h1v1H7zM1 3h1v4H1zM8 3h1v4H8zM2 7h1v1H2zM7 7h1v1H7zM3 8h4v1H3z"/><path d="M8 8h1v1H8zM9 9h1v1H9zM10 10h1v1H10z"/>',
  users: '<path d="M3 2h3v3H3zM2 6h5v4H2z"/><path d="M8 3h2v2H8zM8 6h3v3H8z"/>',
  user: '<path d="M4 1h4v4H4zM2 6h8v5H2z"/>',
  clock: '<path d="M4 1h4v1H4zM2 2h2v1H2zM8 2h2v1H8zM1 3h1v6H1zM10 3h1v6H10zM2 9h2v1H2zM8 9h2v1H8zM4 10h4v1H4z"/><path d="M6 3h1v4H6zM7 6h2v1H7z"/>',
  calendar: '<path d="M1 2h10v1H1zM1 10h10v1H1zM1 2h1v9H1zM10 2h1v9H10zM1 4h10v1H1zM3 1h1v2H3zM8 1h1v2H8z"/><path d="M3 6h2v2H3zM6 6h2v2H6z"/>',
  file: '<path d="M2 1h6v1H2zM2 1h1v10H2zM2 10h8v1H2zM9 3h1v8H9zM8 1h1v2H8zM8 3h2v1H8z"/><path d="M4 5h4v1H4zM4 7h4v1H4z"/>',
  message: '<path d="M1 2h10v1H1zM1 8h10v1H1zM1 2h1v7H1zM10 2h1v7H10z"/><path d="M3 9h2v1H3zM3 10h1v1H3zM3 5h1v1H3zM5 5h1v1H5zM7 5h1v1H7z"/>',
  moon: '<path d="M4 1h4v1H4zM2 2h2v1H2zM1 3h1v6H1zM2 9h2v1H2zM4 10h4v1H4zM8 9h2v1H8zM6 2h2v1H6zM7 3h1v4H7zM8 7h2v1H8zM10 8h1v1H10z"/>',
  bell: '<path d="M5 1h2v1H5zM3 2h6v1H3zM2 3h1v5H2zM9 3h1v5H9zM1 8h10v1H1z"/><path d="M5 10h2v1H5z"/>',
  link: '<path d="M1 4h4v1H1zM1 7h4v1H1zM1 4h1v4H1zM7 4h4v1H7zM7 7h4v1H7zM10 4h1v4H10zM4 5h4v2H4z"/>',
  save: '<path d="M1 1h9v1H1zM1 1h1v10H1zM1 10h10v1H1zM10 2h1v9H10z"/><path d="M3 2h5v3H3zM3 7h6v3H3z"/>',
  door: '<path d="M3 1h6v1H3zM3 1h1v10H3zM8 1h1v10H8zM2 10h8v1H2z"/><path d="M6 6h1v1H6z"/>',
  check: '<path d="M2 6h1v1H2zM3 7h1v1H3zM4 8h1v1H4zM5 7h1v1H5zM6 6h1v1H6zM7 5h1v1H7zM8 4h1v1H8zM9 3h1v1H9z"/>',
  plus: '<path d="M5 2h2v8H5zM2 5h8v2H2z"/>',
};

// How much the game helps (room setting; the server leaves out what a level hides)
export const DIFFICULTY = {
  guide: { name: '입문', text: '오늘 할 일과 힌트를 모두 보여 줘요.' },
  detective: { name: '탐정', text: '목표는 질문으로만 보여 주고, 누구에게 무엇을 보여 줄지는 알려 주지 않아요.' },
  master: { name: '명탐정', text: '목표와 힌트 없이 수사해요. 날이 넘어가기 전에 놓친 것이 있으면 경고만 해요.' },
};

// A word with the particle its last sound takes (the same rule as src/util.js withParticle).
export const withParticle = (word, consonant, vowel) => {
  const code = String(word).trim().slice(-1).charCodeAt(0) - 0xac00;
  if (!(code >= 0 && code < 11172)) return `${word}${consonant}(${vowel})`;
  return word + (code % 28 ? consonant : vowel);
};

export function icon(name) {
  const el = document.createElement('span');
  el.className = 'icon';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = `<svg viewBox="0 0 12 12" fill="currentColor" shape-rendering="crispEdges">${ICONS[name] ?? ''}</svg>`;
  return el;
}

export const playersText = (p) => (p.min === p.max ? `${p.min}명` : `${p.min}~${p.max}명`);
const minutesText = (m) => `${m.min}–${m.max}분`;
const fileNo = (index) => String(index + 1).padStart(3, '0');

// A case in the folder list: file number, title, players and time. Pressed when it is the open file.
export function caseFolder(c, { selected = false, onOpen = null, index = 0 } = {}) {
  const parts = [
    h('small', {}, `사건 ${fileNo(index)}`),
    h('b', {}, c.title),
    h('span', { class: 'muted' }, `${playersText(c.players)} · ${minutesText(c.estimatedMinutes)}`),
  ];
  if (!onOpen) return h('div', { class: 'folder', 'aria-current': selected ? 'true' : null }, ...parts);
  return h('button', { type: 'button', class: 'folder', 'aria-pressed': selected ? 'true' : 'false', onclick: onOpen }, ...parts);
}

// The open file: picture, title, the public summary and the facts a host needs to set up a room.
// The picture is the case cover, or else the room everyone starts in. `compact` lays it out sideways.
export function caseSheet(c, { index = 0, note = '낮에는 조사하고, 밤에는 증거를 함께 정리해요.', compact = false } = {}) {
  const picture = c.coverUrl ?? c.previewUrl;
  return h('article', { class: `case-sheet${compact ? ' compact' : ''}` },
    picture
      ? h('div', { class: 'thumb' }, h('img', { class: 'cover', src: picture, alt: `${c.title} 첫 장소` }))
      : h('div', { class: 'thumb' }, h('div', { class: 'cover blank', 'aria-hidden': 'true' }, `사건 파일 ${fileNo(index)}`)),
    h('div', { class: 'case-sheet__text' },
      h('div', { class: 'row wrap' }, h('span', { class: 'tag tag--brass' }, `사건 파일 ${fileNo(index)}`), h('span', { class: 'muted small' }, `v${c.version}`)),
      h('h2', {}, c.title),
      h('div', { class: 'metadata' },
        h('span', { class: 'tag tag--sky' }, icon('users'), playersText(c.players)),
        h('span', { class: 'tag tag--paper2' }, icon('clock'), minutesText(c.estimatedMinutes)),
        h('span', { class: 'tag tag--brass-l' }, icon('calendar'), '5일간의 수사'),
        c.solo ? h('span', { class: 'tag tag--teal-l' }, icon('check'), c.soloMinutes ? `혼자 ${minutesText(c.soloMinutes)}` : '혼자 가능') : null),
      h('p', { class: 'pre' }, c.summary),
      note && !compact ? h('span', { class: 'muted small' }, note) : null));
}

// The state written on a clue card's badge. Text, not color alone, carries it.
export function clueStatus(c, isNew) {
  if (c.shared) return { cls: 'shared', text: '✓ 공유됨' };
  if (isNew) return { cls: 'new', text: 'NEW' };
  return { cls: '', text: '나만 보유' };
}

// A collected clue as a selectable card: kind icon, name and a status badge.
// hint: someone can still do something with it (a red mark in the corner)
export function clueCard(c, { isNew = false, selected = false, onClick = null, mini = false, hint = false } = {}) {
  const status = clueStatus(c, isNew);
  const parts = [
    icon(c.kind === 'testimony' ? 'message' : c.kind === 'deduction' ? 'search' : 'file'),
    h('span', { class: 'clue-name' }, c.name),
    hint ? h('span', { class: 'clue-hint', title: '쓸 곳이 있어요' }, '!') : null,
    h('span', { class: `badge ${status.cls}` }, mini ? ({ testimony: '증언', deduction: '추론' }[c.kind] ?? '증거') : status.text),
  ];
  if (!onClick) return h('div', { class: `clue${mini ? ' mini' : ''}` }, ...parts);
  return h('button', { type: 'button', class: 'clue', 'aria-pressed': selected ? 'true' : 'false', onclick: onClick, 'aria-label': `${c.name}, ${{ testimony: '증언', deduction: '추론' }[c.kind] ?? '증거'}, ${status.text}` }, ...parts);
}

// Five days, each marked done, current (with day or night) or still ahead. The intro sits before
// day 1 and the final deduction after day 5; a note under the bar says so.
export function stepIndicator(stage, day) {
  const after = stage === 'final' || stage === 'result';
  const items = [1, 2, 3, 4, 5].map((d) => {
    const current = (stage === 'day' || stage === 'night') && d === day;
    const done = after || ((stage === 'day' || stage === 'night') && d < day);
    const state = current ? `${stage === 'night' ? '☾ 밤 · 토의 중' : '☀ 낮 · 조사 중'}` : done ? '수사 완료' : '낮 / 밤';
    return h('li', { class: `step${done ? ' done' : ''}${current ? ` current ${stage}` : ''}`, 'aria-current': current ? 'step' : null },
      h('strong', {}, `${done ? '✓ ' : ''}${d}일 차`),
      h('span', {}, state));
  });
  const note = stage === 'intro' ? '사건 소개 · 1일 차 낮이 곧 시작돼요' : stage === 'final' ? '5일간의 수사 끝 · 최종 추리 중' : stage === 'result' ? '수사 종료 · 결과 확인' : null;
  return [h('ol', { class: 'stepper', 'aria-label': '수사 진행 단계' }, ...items), note ? h('p', { class: 'stepper-note' }, note) : null];
}

// ---------- one-screen pieces (docs/ui-onescreen-spec.md 4절) ----------

// A stack of drawers: each has a name line (with a short summary of what is inside) that opens it.
// One open at a time; pressing the open one closes it. With `remember`, the open drawer is kept in
// sessionStorage under that key (a room code), so it stays open across redraws and reloads.
// items: [{ id, title, summary?, body: () => node | [nodes] }]; open: the id open at first.
export function drawerGroup(items, { open = null, remember = null, onToggle = null } = {}) {
  const key = remember ? `mystery:drawer:${remember}` : null;
  let current = open;
  try {
    const saved = key ? sessionStorage.getItem(key) : null;
    if (saved !== null) current = saved || null;
  } catch {
    // storage unavailable: start from `open`
  }
  if (!items.some((it) => it.id === current)) current = items.some((it) => it.id === open) ? open : null;
  const group = h('div', { class: 'drawers' });
  const draw = () => {
    group.replaceChildren(...items.map((it) => {
      const isOpen = it.id === current;
      const body = isOpen ? h('div', { class: 'drawer__body', id: `drawer-${it.id}` }, ...[it.body()].flat().filter(Boolean)) : null;
      return h('section', { class: `drawer${isOpen ? ' is-open' : ''}`, 'data-drawer': it.id },
        h('button', { type: 'button', class: 'drawer__head', 'aria-expanded': isOpen ? 'true' : 'false', 'aria-controls': `drawer-${it.id}`, onclick: () => {
          current = isOpen ? null : it.id;
          try {
            if (key) sessionStorage.setItem(key, current ?? '');
          } catch {
            // ignore
          }
          draw();
          onToggle?.(current);
        } },
          h('span', { class: 'drawer__title' }, it.title),
          it.summary ? h('span', { class: 'drawer__summary' }, it.summary) : null,
          h('span', { class: 'drawer__arrow', 'aria-hidden': 'true' }, isOpen ? '▾' : '▸')),
        body);
    }));
  };
  draw();
  return group;
}

// Numbered pages along the top (like the day steps): one page shown at a time. marks[i] says
// whether page i is done (a check, not only a color). Left and right arrow keys turn pages while
// nothing is being typed.
export function pageStrip(labels, index, onChange, { marks = [], flags = [] } = {}) {
  return h('nav', { class: 'pager', 'aria-label': '장 넘김' },
    ...labels.map((label, i) => h('button', {
      type: 'button',
      class: `pager__tab${i === index ? ' is-current' : ''}${marks[i] ? ' is-done' : ''}`,
      'aria-current': i === index ? 'page' : null,
      'aria-label': `${label}${marks[i] ? ' (답함)' : ''}${flags[i] ? ' (의견이 갈림)' : ''}`,
      onclick: () => onChange(i),
    }, marks[i] ? `${label}✓` : label, flags[i] ? h('span', { class: 'pager__flag', 'aria-hidden': 'true' }, '!') : null)));
}

let pageKeys = null;
// one listener for the arrows; the screen that shows pages sets what they do
export function onPageKeys(handler) {
  pageKeys = handler;
  if (onPageKeys.bound) return;
  onPageKeys.bound = true;
  document.addEventListener('keydown', (e) => {
    if (!pageKeys || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.target.closest?.('input, textarea, select, [contenteditable]')) return;
    if (document.querySelector('#modal:not([hidden])')) return;
    if (e.key === 'ArrowLeft' && pageKeys(-1)) e.preventDefault();
    if (e.key === 'ArrowRight' && pageKeys(1)) e.preventDefault();
  });
}

// Drawers already in the page (the home screen's forms keep their ids): sections with
// .drawer__head buttons and .drawer__body parts. Same rules as drawerGroup: one open at a time,
// remembered under `remember`. Returns open(id) to open one from outside (after picking a case).
export function staticDrawers(container, { open = null, remember = null } = {}) {
  const key = remember ? `mystery:drawer:${remember}` : null;
  const parts = [...container.querySelectorAll(':scope > .drawer')];
  let current = open;
  try {
    const saved = key ? sessionStorage.getItem(key) : null;
    if (saved !== null) current = saved || null;
  } catch {
    // storage unavailable
  }
  const set = (id) => {
    current = id;
    for (const d of parts) {
      const on = d.dataset.drawer === id;
      d.classList.toggle('is-open', on);
      d.querySelector(':scope > .drawer__head').setAttribute('aria-expanded', on ? 'true' : 'false');
      d.querySelector(':scope > .drawer__head .drawer__arrow').textContent = on ? '▾' : '▸';
      d.querySelector(':scope > .drawer__body').hidden = !on;
    }
    try {
      if (key) sessionStorage.setItem(key, id ?? '');
    } catch {
      // ignore
    }
  };
  for (const d of parts) d.querySelector(':scope > .drawer__head').addEventListener('click', () => set(current === d.dataset.drawer ? null : d.dataset.drawer));
  set(parts.some((d) => d.dataset.drawer === current) ? current : null);
  return { open: set };
}
