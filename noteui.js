import { h } from './net.js';

// The field HUD (train-note handoff): during day investigation only the map, the date plate and
// the inspect prompt stay on screen. Everything else opens as one note from the index tabs on the
// right. State is a single openId. The game fills the open note through onRender.

export const NOTES = [
  { id: 'notebook', title: '내 수첩', icon: 'notebook' },
  { id: 'people', title: '인물', icon: 'person' },
  { id: 'board', title: '공동 보드', icon: 'board' },
  { id: 'chat', title: '팀 채팅', icon: 'chat' },
  { id: 'brief', title: '오늘의 조사', icon: 'brief' },
  { id: 'party', title: '참가자', icon: 'party' },
  { id: 'menu', title: '설정·저장', icon: 'menu' },
];

// 12×12 dot icons from the handoff. Fixed markup only, never fed with game text.
const ICONS = {
  notebook: '<path d="M2 1h8v1H2zM2 10h8v1H2zM2 1h1v10H2zM9 1h1v10H9zM4 1h1v10H4z"/><path d="M6 4h2v1H6zM6 6h2v1H6z"/>',
  board: '<path d="M1 2h10v1H1zM1 9h10v1H1zM1 2h1v8H1zM10 2h1v8H10z"/><path d="M3 4h3v3H3zM7 4h2v1H7zM7 6h2v1H7z"/>',
  chat: '<path d="M1 2h10v1H1zM1 8h10v1H1zM1 2h1v7H1zM10 2h1v7H10z"/><path d="M3 9h2v1H3zM3 10h1v1H3zM3 5h1v1H3zM5 5h1v1H5zM7 5h1v1H7z"/>',
  brief: '<path d="M3 1h4v1H3zM2 2h1v1H2zM7 2h1v1H7zM1 3h1v4H1zM8 3h1v4H8zM2 7h1v1H2zM7 7h1v1H7zM3 8h4v1H3z"/><path d="M8 8h1v1H8zM9 9h1v1H9zM10 10h1v1H10z"/>',
  party: '<path d="M3 2h3v3H3zM2 6h5v4H2z"/><path d="M8 3h2v2H8zM8 6h3v3H8z"/>',
  menu: '<path d="M2 3h8v1H2zM2 6h8v1H2zM2 9h8v1H2z"/>',
  close: '<path d="M2 2h2v2H2zM4 4h2v2H4zM6 6h2v2H6zM8 8h2v2H8zM8 2h2v2H8zM6 4h2v2H6zM4 6h2v2H4zM2 8h2v2H2z"/>',
  person: '<path d="M4 1h4v1H4zM3 2h1v3H3zM8 2h1v3H8zM4 5h4v1H4zM2 7h8v1H2zM1 8h1v3H1zM10 8h1v3H10z"/>',
  left: '<path d="M1 6h1v1H1zM2 5h1v3H2zM3 4h1v5H3zM4 6h7v1H4z"/>',
  right: '<path d="M10 6h1v1H10zM9 5h1v3H9zM8 4h1v5H8zM1 6h7v1H1z"/>',
  down: '<path d="M2 3h8v2H2zM3 5h6v2H3zM4 7h4v2H4zM5 9h2v1H5z"/>',
  up: '<path d="M5 2h2v1H5zM4 3h4v2H4zM3 5h6v2H3zM2 7h8v2H2z"/>',
};

export function dotIcon(name) {
  const span = document.createElement('span');
  span.className = 'nui-icon';
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = `<svg viewBox="0 0 12 12" fill="currentColor" shape-rendering="crispEdges">${ICONS[name] ?? ''}</svg>`;
  return span;
}

// opts.enabled(): whether shortcuts apply right now (e.g. not during a dialogue or a modal)
// opts.onRender(id, body): fill the open note; opts.onChange(id): after it opens or closes
// opts.onPrompt(): the E bubble was clicked; opts.onToast(characterId): a record toast was clicked
export function mountNoteUI(root, { totalDays = 5, enabled = () => true, onRender = () => {}, onChange = () => {}, onPrompt = () => {}, onToast = () => {} } = {}) {
  let openId = null;
  let lastPhaseKey = null;
  let locked = false;

  const dayNum = h('b', { class: 'nui-date__num' });
  const phase = h('span', { class: 'nui-date__phase' });
  const loc = h('span', { class: 'nui-date__loc' });
  const days = h('div', { class: 'nui-date__days', role: 'img' });
  // today's goals under the date plate: progress and the next thing to do; opens the brief
  const goalCount = h('span', { class: 'nui-goal__count' });
  const goalText = h('span', { class: 'nui-goal__text' });
  const goalBox = h('button', { type: 'button', class: 'px drop nui-goal', hidden: true, title: '오늘의 목표 (5)', onclick: () => open('brief') },
    h('span', { class: 'nui-goal__head' }, dotIcon('brief'), '오늘의 목표', goalCount), goalText);
  const promptKey = h('span', { class: 'px nui-key' }, 'E');
  const promptText = h('span', { class: 'nui-prompt__text' });
  const prompt = h('div', { class: 'px drop nui-prompt', role: 'status', hidden: true }, promptKey, promptText);
  const title = h('h2', { class: 'nui-note__title', id: 'nuiTitle' });
  const body = h('div', { class: 'nui-note__body' });
  const closeBtn = h('button', { type: 'button', class: 'px nui-note__close', 'aria-label': '노트 닫기', onclick: () => close() }, dotIcon('close'));
  const note = h('section', { class: 'nui-note', id: 'nuiNote', role: 'region', 'aria-labelledby': 'nuiTitle', hidden: true },
    h('span', { class: 'px brass drop nui-note__clip', 'aria-hidden': 'true' }),
    h('div', { class: 'nui-note__head' }, title, closeBtn),
    body);
  const tabs = NOTES.map((n, i) => h('button', {
    type: 'button',
    class: `px nui-tab${n.id === 'menu' ? ' nui-tab--menu' : ''}`,
    'data-note': n.id,
    'aria-expanded': 'false',
    'aria-controls': 'nuiNote',
    'aria-keyshortcuts': String(i + 1),
    'aria-label': n.title,
    title: `${n.title} (${i + 1})`,
    onclick: () => toggle(n.id),
  }, h('span', { class: 'nui-tab__key', 'aria-hidden': 'true' }, String(i + 1)), dotIcon(n.icon), h('span', { class: 'nui-tab__label' }, n.title), h('span', { class: 'nui-tab__count' }), h('span', { class: 'nui-tab__badge', hidden: true })));

  // world labels live outside the scaled layer: they follow the map in screen pixels
  const world = h('div', { class: 'ig-world', 'aria-hidden': 'true' });
  const bubbleKey = h('span', { class: 'px ig-key' }, 'E');
  const bubbleTarget = h('span', { class: 'ig-prompt__target' });
  const bubbleVerb = h('span', { class: 'ig-prompt__verb' });
  const bubble = h('button', { type: 'button', class: 'px drop ig-prompt', hidden: true, onclick: () => onPrompt() }, bubbleKey, h('span', { class: 'ig-prompt__text' }, bubbleTarget, bubbleVerb));
  const toastFace = h('span', { class: 'ig-toast__face' });
  const toastName = h('span', { class: 'ig-toast__name' });
  const toast = h('button', { type: 'button', class: 'px drop ig-toast', role: 'status', hidden: true, onclick: () => {
    toast.hidden = true;
    onToast(toast.dataset.id);
  } }, toastFace, h('span', { class: 'ig-toast__text' }, h('span', { class: 'ig-toast__head' }, '인물 기록에 추가됨'), toastName));
  let toastTimer = null;
  // the top-left column: date plate, today's goals, and whatever the game adds below (the minimap).
  // It folds to the date plate alone (with the goal count on it), so the map gets the whole width
  // (docs/ui-onescreen-spec.md 5.4); folded is the default, and the choice is kept in this browser.
  const foldGoal = h('span', { class: 'nui-fold__goal' });
  const foldBtn = h('button', { type: 'button', class: 'px nui-fold', 'aria-controls': 'nuiCornerMore', onclick: () => setFold(!folded) },
    foldGoal, h('span', { class: 'nui-fold__arrow', 'aria-hidden': 'true' }));
  const corner = h('div', { class: 'nui-corner' },
    h('section', { class: 'px drop nui-date', 'aria-label': '진행 날짜' },
      h('div', { class: 'nui-date__day' }, h('small', {}, 'DAY'), dayNum),
      h('div', { class: 'nui-date__info' }, h('div', { class: 'nui-date__row' }, phase, loc), days),
      foldBtn),
    goalBox);
  let folded = true;
  try {
    folded = localStorage.getItem('mystery:hud-fold') !== '0';
  } catch {
    // storage unavailable: folded
  }
  function setFold(on) {
    folded = on;
    corner.classList.toggle('is-folded', on);
    foldBtn.setAttribute('aria-expanded', on ? 'false' : 'true');
    foldBtn.setAttribute('aria-label', on ? '목표와 지도 펼치기' : '목표와 지도 접기');
    foldBtn.querySelector('.nui-fold__arrow').textContent = on ? '▸' : '◂';
    try {
      localStorage.setItem('mystery:hud-fold', on ? '1' : '0');
    } catch {
      // ignore
    }
    onChange(openId);
  }
  setFold(folded);
  root.replaceChildren(world, bubble, h('div', { class: 'nui-layer' },
    corner,
    prompt,
    h('nav', { class: 'nui-tabs', 'aria-label': '노트' }, ...tabs),
    toast,
    note));

  const tabOf = (id) => tabs.find((t) => t.dataset.note === id);

  function paint() {
    for (const t of tabs) t.setAttribute('aria-expanded', t.dataset.note === openId ? 'true' : 'false');
    note.hidden = !openId;
    note.classList.toggle('nui-note--wide', openId === 'people');
    root.dataset.open = openId ?? '';
    if (openId) {
      title.textContent = NOTES.find((n) => n.id === openId).title;
      onRender(openId, body);
    }
  }

  function open(id) {
    if (!NOTES.some((n) => n.id === id)) return;
    openId = id;
    setBadge(id, 0);
    body.replaceChildren();
    paint();
    onChange(openId);
  }
  // Focus inside the HUD goes back to the tab, so keyboard users keep their place.
  function close() {
    const was = openId;
    if (!was) return;
    const hadFocus = root.contains(document.activeElement);
    openId = null;
    paint();
    if (hadFocus) tabOf(was)?.focus();
    onChange(null);
  }
  const toggle = (id) => (openId === id ? close() : open(id));

  function setBadge(id, n) {
    const b = tabOf(id)?.querySelector('.nui-tab__badge');
    if (!b) return;
    b.hidden = !n;
    b.textContent = n > 9 ? '9+' : String(n || '');
  }
  function setCount(id, text) {
    const c = tabOf(id)?.querySelector('.nui-tab__count');
    if (c) c.textContent = text === null || text === undefined ? '' : String(text);
  }

  // A new day or phase (not the first call, not a move between rooms) opens today's brief once.
  let shownDate = null;
  function setDate(d) {
    const key = `${d.day}|${d.phase}`;
    const changed = lastPhaseKey !== null && key !== lastPhaseKey;
    lastPhaseKey = key;
    const full = `${key}|${d.location}`;
    if (full === shownDate) return;
    shownDate = full;
    dayNum.textContent = d.day;
    phase.textContent = d.phase;
    loc.textContent = d.location ?? '';
    days.replaceChildren(...Array.from({ length: totalDays }, (_, i) => h('i', { class: i + 1 < d.day ? 'is-past' : i + 1 === d.day ? 'is-today' : null })));
    days.setAttribute('aria-label', `${totalDays}일 중 ${d.day}일차`);
    if (changed) open('brief');
  }

  // g: { done, total, next } or null when the case has no goals for today
  function setGoal(g) {
    goalBox.hidden = !g?.total;
    foldGoal.textContent = g?.total ? `목표 ${g.done}/${g.total}` : '';
    if (!g?.total) return;
    goalCount.textContent = `${g.done}/${g.total}`;
    goalText.textContent = g.next ?? '오늘 목표를 모두 마쳤어요. 날을 넘길 수 있어요.';
    goalBox.classList.toggle('is-done', !g.next);
  }

  function setPrompt(text, key = 'E') {
    prompt.hidden = !text;
    if (text) {
      promptText.textContent = text;
      promptKey.textContent = key;
    }
  }

  const isTyping = () => {
    const a = document.activeElement;
    return Boolean(a && root.contains(a) && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT'));
  };

  // Number keys 1~6 by physical key (e.code), so they work with a Korean IME too. Typing,
  // modifier combinations and key repeat are left alone.
  function onKey(e) {
    if (locked || e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || isTyping() || !enabled()) return;
    if (e.target.closest?.('input, textarea, select')) return;
    const m = /^(?:Digit|Numpad)([1-7])$/.exec(e.code || '');
    if (!m) return;
    e.preventDefault();
    toggle(NOTES[Number(m[1]) - 1].id);
  }
  window.addEventListener('keydown', onKey);

  // Keeps the HUD at a whole-number scale of its 1440×900 design so the 3px steps stay crisp.
  function rescale() {
    const scale = Math.max(1, Math.floor(Math.min(innerWidth / 1440, innerHeight / 900)));
    root.style.setProperty('--nui-scale', String(scale));
  }
  window.addEventListener('resize', rescale);
  rescale();
  paint();

  // During a dialogue the number keys pick choices: shortcuts off and the tab rail dimmed.
  function setShortcutsEnabled(on) {
    locked = !on;
    root.querySelector('.nui-tabs').classList.toggle('is-locked', locked);
  }

  // Labels on the map. `anchors` come from drawMap in canvas pixels; `at` maps them to the screen.
  // Elements are kept per id and only moved, so this can run every frame.
  const labels = new Map();
  // only touch the style when the pixel position actually changes
  function moveTo(el, x, y) {
    const pos = `${Math.round(x)},${Math.round(y)}`;
    if (el.dataset.pos === pos) return;
    el.dataset.pos = pos;
    el.style.left = `${Math.round(x)}px`;
    el.style.top = `${Math.round(y)}px`;
  }
  const mark = h('span', { class: 'ig-speaker-mark', hidden: true }, dotIcon('down'));
  world.append(mark);
  // chat: Map(playerId → text) said just now, shown as a speech bubble over that player's head
  let myChat = null;
  // Door signs slide out from under the date plate, goals and note tabs so they stay readable:
  // to whichever side of the panel is the shorter move. Panels are measured once per frame.
  const tabRail = root.querySelector('.nui-tabs');
  function clearOfPanels(el, x, y, panels) {
    const w = el.offsetWidth;
    const hgt = el.offsetHeight;
    for (const r of panels) {
      if (x + w / 2 <= r.left || x - w / 2 >= r.right || y <= r.top || y - hgt >= r.bottom) continue;
      const moves = [[r.right + w / 2 + 6 - x, 0], [r.left - w / 2 - 6 - x, 0], [0, r.bottom + hgt + 6 - y]]
        .filter(([dx]) => x + dx - w / 2 >= 0 && x + dx + w / 2 <= root.clientWidth);
      const [dx, dy] = moves.sort((a, b) => Math.abs(a[0]) + Math.abs(a[1]) - Math.abs(b[0]) - Math.abs(b[1]))[0] ?? [0, 0];
      x += dx;
      y += dy;
    }
    return [x, y];
  }

  function setWorld(anchors, at, { speakingId = null, chat = new Map() } = {}) {
    myChat = null;
    const base = root.getBoundingClientRect();
    const panels = [corner, tabRail].filter((p) => p && p.offsetParent).map((p) => {
      const r = p.getBoundingClientRect();
      return { left: r.left - base.left, right: r.right - base.left, top: r.top - base.top, bottom: r.bottom - base.top };
    });
    // people too: a door sign never sits on someone's name or body
    for (const a of anchors ?? []) {
      if (a.kind !== 'npc' && a.kind !== 'player') continue;
      const [x, y] = at(a.x, a.y);
      panels.push({ left: x - 30, right: x + 30, top: y - 26, bottom: y + 64 });
    }
    const seen = new Set();
    let focus = null;
    let markShown = false;
    for (const a of anchors ?? []) {
      if (a.focus) focus = a;
      if (a.kind === 'spot') continue;
      const key = `${a.kind}:${a.id}`;
      seen.add(key);
      let el = labels.get(key);
      const text = a.kind === 'door' ? `${a.text}${a.open ? '' : ' (잠김)'}` : a.text;
      if (!el) {
        el = h('span', { class: `px ig-label ig-label--${a.kind === 'player' ? 'npc' : a.kind}` });
        labels.set(key, el);
        world.append(el);
      }
      const shown = `${text}${a.news ? '|!' : ''}`;
      if (el.dataset.text !== shown) {
        el.dataset.text = shown;
        // a person with a question waiting gets a red mark (hints)
        const news = a.news ? [h('b', { class: 'ig-label__news', title: '새 질문이 있어요' }, '!')] : [];
        el.replaceChildren(...(a.kind === 'door' && a.side === 'left' ? [dotIcon('left'), text] : a.kind === 'door' ? [text, dotIcon(a.side)] : [...news, text]));
      }
      const said = (a.kind === 'me' || a.kind === 'player') ? chat.get(a.id) : null;
      if (said) {
        const bkey = `chat:${a.id}`;
        seen.add(bkey);
        let b = labels.get(bkey);
        if (!b) {
          b = h('span', { class: 'px drop ig-chat' });
          labels.set(bkey, b);
          world.append(b);
        }
        if (b.textContent !== said) b.textContent = said;
        const [bx, by] = at(a.x, a.head);
        // a player's name sits over the head too; the bubble goes above it
        // above a name tag for others; mine is stacked over the E bubble in setBubble
        moveTo(b, bx, by - (a.kind === 'player' ? 30 : 6));
        if (a.kind === 'me') myChat = { el: b, x: bx, y: by - 6 };
      }
      if (a.kind === 'player' && el.dataset.color !== a.color) {
        el.dataset.color = a.color;
        el.style.boxShadow = `inset 0 -3px 0 0 ${a.color}`;
      }
      const [x, y] = a.kind === 'door' ? clearOfPanels(el, ...at(a.x, a.y), panels) : at(a.x, a.y);
      moveTo(el, x, y);
      // the bubble or the speaking mark stands in for the name
      const hide = a.kind === 'npc' && ((a.focus && !speakingId) || a.id === speakingId);
      if (el.hidden !== hide) el.hidden = hide;
      if (a.kind === 'npc' && a.id === speakingId) {
        markShown = true;
        moveTo(mark, x, y);
      }
    }
    if (mark.hidden === markShown) mark.hidden = !markShown;
    for (const [key, el] of labels) {
      if (!seen.has(key)) {
        el.remove();
        labels.delete(key);
      }
    }
    return focus;
  }

  // The E bubble over the nearest target; null hides it.
  function setBubble(target, at) {
    if (bubble.hidden !== !target) bubble.hidden = !target;
    if (!target) return;
    bubble.classList.toggle('ig-prompt--talk', target.kind === 'npc');
    if (bubbleTarget.textContent !== target.text) bubbleTarget.textContent = target.text;
    if (bubbleVerb.textContent !== target.verb) bubbleVerb.textContent = target.verb;
    const [x, y] = at(target.x, target.y);
    moveTo(bubble, x, y - 18);
    // my own chat line never covers the E bubble: it sits just above it
    if (myChat) moveTo(myChat.el, myChat.x, Math.min(myChat.y, bubble.getBoundingClientRect().top - 18));
  }

  function showToast(id, name, text, face) {
    toast.dataset.id = id;
    toastName.textContent = `${name} · ${text}`;
    toastFace.replaceChildren(...(face ? [face] : []));
    toast.hidden = false;
    toast.classList.remove('is-in');
    void toast.offsetWidth;
    toast.classList.add('is-in');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast.hidden = true), 3600);
  }

  return {
    corner,
    open,
    close,
    setShortcutsEnabled,
    setWorld,
    setBubble,
    showToast,
    clearWorld: () => {
      for (const el of labels.values()) el.remove();
      labels.clear();
      bubble.hidden = true;
    },
    toggle,
    current: () => openId,
    rerender: () => openId && onRender(openId, body),
    setBadge,
    setCount,
    setDate,
    setGoal,
    setPrompt,
    isTyping,
    destroy() {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', rescale);
    },
  };
}
