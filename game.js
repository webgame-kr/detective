import { api, seats, Connection, h } from './net.js';
import { drawMap, pickTarget, TILE, ART_SCALE } from './map.js';
import { looksReady, lookSet, lookThumb, spriteThumb, animLength, findLook } from './sprites.js';
import { caseFolder, caseSheet, clueCard, stepIndicator, icon, playersText, withParticle, DIFFICULTY, drawerGroup, pageStrip, onPageKeys } from './ui.js';
import { drawMinimap, focusOf } from './minimap.js';
import { mountNoteUI } from './noteui.js';
import { DialogueBox, portrait } from './dialogue.js';
import { SPEED, savedSpeed, saveSpeed } from './typewriter.js';
import { recordCase } from './casebook.js';
import { briefingAnim } from './briefing-anim.js';
import { toast, clueToast } from './toast.js';

const code = location.hash.slice(1).toUpperCase(); // artifact: the room code rides in the hash
const $ = (id) => document.getElementById(id);

let conn = null;
let state = null;
let clockOffset = 0;
let tab = null;
let notebookTab = 'clues';
let activeClue = null;
let hadMap = false;
let seenNotice = null;
let facing = [0, 1];
const memo = new Map();

// The goal box under the scene: what this stage is for and how to play it.
const GOALS = {
  lobby: { icon: 'users', title: '수사본부 대기실', text: '참가자가 모두 준비하면 방장이 게임을 시작해요.', note: '외형을 고르고 준비 완료를 눌러 주세요.' },
  intro: { icon: 'file', title: '사건 소개', text: '사건 소개를 읽고 준비 완료를 눌러 주세요.', note: '5일 동안 낮에는 조사하고, 밤에는 증거를 함께 정리해요.' },
  day: { icon: 'search', title: '오늘의 조사', text: '맵을 돌아다니며 물건을 조사하고 인물과 대화하세요. 찾은 단서는 내 수첩에만 들어와요.', note: '방향키·WASD 이동 · E/Space 조사 · 숫자 1~7 노트 · Esc 닫기' },
  night: { icon: 'moon', title: '기록을 맞춰볼 시간', text: '이동과 조사는 아침까지 쉬어요. 서로 발견한 것과 아직 확실하지 않은 것을 구분해 보세요.', note: '수첩의 단서를 공유하고, 보드에 메모·가설을 남겨요.' },
  final: { icon: 'message', title: '최종 추리', text: '팀 답안을 함께 고른 뒤 방장이 최종 제출해요.', note: '제출한 뒤에는 바꿀 수 없어요.' },
  result: { icon: 'file', title: '수사 종료', text: '결과와 해설을 확인하세요.', note: '' },
};
// alone, the same stages read as one person's work: no team, no host, nothing to share
const SOLO_GOALS = {
  lobby: { text: '준비가 되면 게임을 시작하세요.', note: '외형을 고르고 시작을 눌러 주세요.' },
  intro: { note: '5일 동안 낮에는 조사하고, 밤에는 모은 증거를 정리해요.' },
  day: { text: '맵을 돌아다니며 물건을 조사하고 인물과 대화하세요. 찾은 단서는 수첩과 공동 보드에 바로 올라가요.' },
  night: { text: '이동과 조사는 아침까지 쉬어요. 확실한 것과 아직 확실하지 않은 것을 구분해 보세요.', note: '보드에 메모·가설을 남겨요.' },
  final: { text: '답과 근거를 고른 뒤 최종 제출해요.' },
};
const goalFor = (stage) => ({ ...GOALS[stage], ...(solo() ? SOLO_GOALS[stage] : null) });

// Shortcuts, in the order the brief lists them. Notes 1~7 only work on the field when no
// dialogue or window is open; during a dialogue the number keys pick its choices instead.
const KEY_HELP = [
  [['←↑↓→', 'WASD'], '이동'],
  [['E', 'Space'], '조사 · 말 걸기'],
  [['1~7'], '노트 열기·닫기 (수첩 · 인물 · 보드 · 채팅 · 오늘 · 참가자 · 저장)'],
  [['M'], '전체 지도 열기·닫기'],
  [['Esc'], '노트 · 대화 · 창 닫기'],
  [['Space', 'E'], '대화: 글 바로 보기 → 다음 · 첫 선택지'],
  [['1~9'], '대화 중 선택지 고르기'],
  [['←→'], '단서 보여 주기에서 카드 고르기'],
];

// ---------- small helpers ----------

// a new clue: pressing the toast opens that clue in my notebook
function badgeToast(c) {
  clueToast([clueCard(c, { mini: true }), h('div', {}, h('strong', {}, '새 단서!'), h('div', { class: 'small' }, '내 수첩에 추가됐어요'))], () => {
    markSeen(c.id);
    activeClue = c.id;
    if (fieldMode() && !dialogueBox.isActive()) hud.open('notebook');
    else if (!fieldMode()) tab = 'notebook';
    render();
  });
}

// Badges stay marked NEW until opened; remembered per tab so a reload keeps the marks.
const seenKey = `mystery:seen:${code}`;
let seenClues = null;
function loadSeen() {
  try {
    const saved = sessionStorage.getItem(seenKey);
    if (saved) return new Set(JSON.parse(saved));
  } catch {
    // storage unavailable
  }
  return null;
}
function markSeen(id) {
  if (!seenClues || seenClues.has(id)) return;
  seenClues.add(id);
  try {
    sessionStorage.setItem(seenKey, JSON.stringify([...seenClues]));
  } catch {
    // storage unavailable
  }
}

const errorText = (res) => res.body?.error?.message ?? '요청을 처리하지 못했어요.';
const playerName = (id) => state.players.find((p) => p.id === id)?.nickname ?? (id ? '알 수 없음' : '사건 기록');
const kindLabel = (kind) => (kind === 'testimony' ? '증언' : kind === 'deduction' ? '추론' : '증거');

function ago(iso) {
  const sec = Math.max(0, Math.round((Date.now() + clockOffset - Date.parse(iso)) / 1000));
  if (sec < 60) return '방금';
  if (sec < 3600) return `${Math.floor(sec / 60)}분 전`;
  return `${Math.floor(sec / 3600)}시간 전`;
}

function nextStageLabel(s) {
  const { stage, day } = s.room;
  if (stage === 'intro') return '1일 차 낮';
  if (stage === 'day') return `${day}일 차 밤`;
  if (stage === 'night') return day < 5 ? `${day + 1}일 차 낮` : '최종 추리';
  return null;
}

// Rebuilds a container only when its inputs changed, so typing and scrolling are not disturbed.
function renderInto(container, key, build) {
  if (memo.get(container) === key) return;
  memo.set(container, key);
  const scroll = container.scrollTop;
  container.replaceChildren(...[build()].flat(Infinity).filter(Boolean));
  container.scrollTop = scroll;
}

async function act(type, payload = {}, { quiet = false } = {}) {
  const res = await conn.act(type, payload);
  if (res.status !== 200 && !quiet) toast(errorText(res), 'error');
  if (res.status === 200) {
    for (const c of res.body.gained ?? []) badgeToast(c);
  }
  return res;
}

function openModal(...children) {
  $('modalCard').replaceChildren(...children.filter(Boolean));
  $('modal').hidden = false;
  $('modalCard').querySelector('input, textarea, button')?.focus();
}

function closeModal() {
  $('modal').hidden = true;
  $('modalCard').replaceChildren();
}

function confirmModal(title, body, okLabel, onOk) {
  openModal(
    h('h3', {}, title),
    typeof body === 'string' ? h('p', {}, body) : body,
    h('div', { class: 'row end' },
      h('button', { class: 'ghost', onclick: closeModal }, '취소'),
      h('button', { class: 'primary', onclick: () => (closeModal(), onOk()) }, okLabel)),
  );
}

// ---------- joining ----------

async function showJoin(message) {
  $('app').hidden = true;
  const info = await api('GET', `/api/rooms/${code}`);
  const box = $('join');
  box.hidden = false;
  if (info.status !== 200) {
    box.replaceChildren(h('div', { class: 'card narrow' }, h('h2', {}, '방을 찾을 수 없어요'), h('p', {}, errorText(info)), h('a', { href: '#', class: 'button' }, '처음 화면으로')));
    return;
  }
  const room = info.body;
  const saved = seats.list(code);
  const nick = h('input', { id: 'joinNick', maxlength: 12, placeholder: '닉네임 (최대 12자)', autocomplete: 'off', 'aria-label': '닉네임' });
  // a room opened from a save file: each newcomer takes one of the saved seats
  const free = (room.seats ?? []).filter((x) => !x.taken);
  const seatPick = free.length
    ? h('label', { class: 'field' }, '내 자리 (저장 파일의 탐정)', h('select', { id: 'joinSeat', onchange: (e) => (nick.value = free.find((x) => x.id === e.target.value)?.nickname ?? nick.value) }, ...free.map((x) => h('option', { value: x.id }, `${x.nickname}의 자리`))))
    : null;
  if (free.length) nick.value = free[0].nickname;
  const join = async (e) => {
    e.preventDefault();
    const body = { nickname: nick.value };
    if (seatPick) body.seatId = seatPick.querySelector('select').value;
    const res = await api('POST', `/api/rooms/${code}/join`, { body });
    if (res.status !== 201) return toast(errorText(res), 'error');
    seats.save(code, { token: res.body.token, playerId: res.body.playerId, nickname: nick.value.trim() });
    box.hidden = true;
    begin(res.body.token);
  };
  box.replaceChildren(
    h('div', { class: 'card narrow' },
      h('p', { class: 'eyebrow' }, `방 ${room.code} · ${room.stageLabel}`),
      h('h2', {}, room.case?.title ?? '케이스 고르는 중'),
      room.case ? h('p', { class: 'muted' }, room.case.summary) : null,
      message ? h('p', { class: 'warn' }, message) : null,
      saved.length
        ? h('div', { class: 'stack' },
            h('h3', {}, '이 브라우저에서 참가했던 자리'),
            ...saved.map((s) => h('button', { class: 'seat-resume', onclick: () => (seats.setActive(code, s.token), (box.hidden = true), begin(s.token)) }, `‘${s.nickname}’(으)로 이어서 하기`)))
        : null,
      room.joinable
        ? h('form', { class: 'stack', onsubmit: join }, h('h3', {}, '새로 참가하기'), seatPick, nick, h('button', { class: 'primary', type: 'submit' }, '참가하기'))
        : h('p', { class: 'muted' }, room.stage === 'lobby' ? (room.locked ? '방장이 새 참가를 잠가 두었어요.' : '방이 가득 찼어요.') : '이미 시작한 방이라 새로 참가할 수 없어요. 원래 참가자라면 처음 쓰던 브라우저에서 이어서 하기를 눌러 주세요.'),
      h('a', { href: '#', class: 'link' }, '처음 화면으로'),
    ),
  );
  nick.focus();
}

function begin(token) {
  $('app').hidden = false;
  conn?.stop();
  conn = new Connection(code, token, {
    onState(s) {
      clockOffset = Date.parse(s.serverTime) - Date.now();
      state = s;
      viewStamp += 1;
      // a drawing bug must not look like a dropped connection (the stream loop would reconnect)
      try {
        keepPrediction();
        syncMotion();
        render();
      } catch (err) {
        console.error('render failed', err);
      }
    },
    onPos(p) {
      if (p.id === state?.me.id) {
        // a step event older than one already confirmed is from the past: drop it
        if (!noteServerMe({ location: p.location, x: p.x, y: p.y, facing: p.facing }, p.stateVersion ?? 0)) return;
        if (ahead > 0) return; // our own step is already drawn
      }
      const mp = state?.map?.players.find((x) => x.id === p.id);
      if (!mp || state.map.id !== p.location) return;
      Object.assign(mp, { x: p.x, y: p.y, facing: p.facing });
      if (p.id === state.me.id) state.me.position = { location: p.location, x: p.x, y: p.y };
      viewStamp += 1;
      syncMotion();
      renderMapHud();
    },
    onAnim({ id, action }) {
      const m = motion.get(id);
      if (m) Object.assign(m, { action, actionT0: performance.now() });
    },
    onStatus(st) {
      const el = $('conn');
      el.className = `conn ${st}`;
      el.textContent = { connecting: '연결 중…', open: '연결됨', polling: '연결됨 (보조 모드)', retrying: '재연결 중…', rejected: '연결 끊김' }[st];
      el.title = st === 'polling' ? '실시간 연결이 중간에서 막혀, 바뀔 때마다 새로 받아 오는 방식으로 이어져 있어요.' : '';
    },
    onRejected(status, message) {
      if (status === 401) seats.forget(code, token);
      if (status === 410) for (const seat of seats.list(code)) seats.forget(code, seat.token);
      showJoin(message);
    },
  });
  conn.start();
}

// ---------- rendering ----------

function render() {
  if (!state) return;
  const s = state;
  document.body.dataset.stage = s.room.stage;
  $('caseTitle').textContent = s.case?.title ?? '케이스 미선택';
  $('roomName').textContent = s.room.settings.name;
  const steps = $('steps');
  steps.hidden = s.room.stage === 'lobby';
  if (!steps.hidden) renderInto(steps, `${s.room.stage}:${s.room.day}`, () => stepIndicator(s.room.stage, s.room.day));
  const goal = s.room.broken ? { icon: 'file', title: '진행할 수 없는 방', text: '이 방은 지금 진행할 수 없어요.', note: '' } : goalFor(s.room.stage);
  // the stage's buttons live in the docked action bar on every stage (docs/ui-onescreen-spec.md 원칙 3)
  const callout = false;
  // at night the day's checklist comes first, above the board the team is reviewing
  const goalEl = $('goal');
  const goalFirst = s.room.stage === 'night' && Boolean(s.goals?.length);
  if (goalFirst !== (goalEl.parentElement.firstElementChild === goalEl)) {
    if (goalFirst) goalEl.parentElement.prepend(goalEl);
    else goalEl.parentElement.insertBefore(goalEl, $('stage').nextSibling);
  }
  document.body.classList.toggle('callout-actions', callout);
  renderInto($('goal'), JSON.stringify([goal, callout ? [s.room, s.players, s.me.isHost, s.case?.id] : null, s.goals, hintsOn]), () => [
    h('span', { class: 'goal__icon' }, icon(goal.icon)),
    h('div', { class: 'goal__text' }, h('strong', {}, goal.title), h('p', {}, goal.text), goal.note ? h('span', { class: 'muted small' }, goal.note) : null, s.goals?.length ? goalChecklist() : null),
    callout ? h('div', { class: 'goal__actions' }, ...[actionItems()].flat().filter(Boolean)) : null,
  ]);
  // the first view sets the baselines: earlier clues and messages are not "new"
  if (seenClues === null) seenClues = loadSeen() ?? new Set(s.notebook?.clues.map((c) => c.id) ?? []);
  $('stageBadge').textContent = s.room.stageLabel;
  if ($('codeBtn').dataset.code !== s.room.code) {
    $('codeBtn').dataset.code = s.room.code;
    $('codeBtn').replaceChildren(icon('link'), h('span', { class: 'code-label' }, '초대 링크 '), s.room.code); // phones show the code alone
  }
  const banner = $('banner');
  const problem = s.room.broken?.message ?? s.room.caseError;
  banner.hidden = !problem;
  banner.textContent = problem ?? '';

  noticeGoals();
  noteSolved();
  // what a guard or camera just said also comes up as a toast (it may have walked you out of its room)
  for (const b of s.barks ?? []) if (!barksSeen.has(b.id)) {
    barksSeen.add(b.id);
    if (Date.now() - b.at < 4000) toast(b.text, 'error');
  }
  if (seenNotice === null) seenNotice = s.notices.at(-1)?.id ?? 0;
  for (const n of s.notices) {
    if (n.id <= seenNotice) continue;
    if (n.scene) queueScene({ kicker: `DAY ${n.day}`, ...n.scene });
    else toast(n.text, 'notice');
  }
  seenNotice = Math.max(seenNotice, s.notices.at(-1)?.id ?? 0);

  // the notebook opens by default once the map (and so the notebook) first appears
  if (!tab || !visibleTabs().includes(tab) || (s.map && !hadMap)) tab = defaultTab();
  hadMap = Boolean(s.map);
  renderStage();
  renderTabs();
  if (!fieldMode()) renderChat(s.room.stage === 'lobby' && lobbyChatBox?.isConnected ? lobbyChatBox : $('chatBox'));
  renderActionbar();
  renderDialogue();
  renderField();
  renderTouchpad();
  noticeChatBubbles();
  loadPlan();
  stageShift();
  tick();
}

// ---------- stage change animation ----------
// When the day or phase moves on (never on the first view), a card announces it and a marker moves
// along the five-day track from the old stop to the new one. The case's theme decides the look: a
// train on a rail, a comet across a star chart, a flame lighting a string of lanterns, footprints
// past the windows of a snowed-in manor. Click, Esc
// or any key skips it.
let shownStage = null;
let shiftTimer = null;
const THEME_INTRO = {
  train: '열차에 오를 시간이에요. 사건 소개를 읽어 주세요.',
  stars: '천문관의 문이 열렸어요. 사건 소개를 읽어 주세요.',
  festival: '축제장에 불이 들어왔어요. 사건 소개를 읽어 주세요.',
  snow: '눈 덮인 저택의 문이 열렸어요. 사건 소개를 읽어 주세요.',
  radio: 'ON AIR 램프가 켜졌어요. 사건 소개를 읽어 주세요.',
};
const SHIFT_TEXT = {
  intro: (d, theme) => ['CASE BRIEFING', '사건 소개', THEME_INTRO[theme] ?? '사건 파일이 열렸어요. 사건 소개를 읽어 주세요.'],
  day: (d) => [`DAY ${d}`, `${d}일 차 · 낮 조사`, '맵을 돌아다니며 조사하고 인물과 대화해요.'],
  night: (d) => [`NIGHT ${d}`, `${d}일 차 · 밤 ${solo() ? '정리' : '토의'}`, solo() ? '이동은 쉬고, 모은 증거를 맞춰 봐요.' : '이동은 쉬고, 모은 증거를 함께 맞춰 봐요.'],
  final: () => ['FINAL', '최종 추리', `5일간의 수사가 끝났어요. ${solo() ? '답' : '팀 답안'}을 골라 주세요.`],
  result: () => ['CASE CLOSED', '수사 종료', '결과와 해설을 확인하세요.'],
};
// where the train stands on the rail: stops at 0~100% for days 1~5, nights halfway to the next stop
const railAt = (stage, day) => (stage === 'lobby' || stage === 'intro' ? -6 : stage === 'final' || stage === 'result' ? 106 : (day - 1) * 25 + (stage === 'night' ? 12.5 : 0));

function stageShift() {
  const s = state;
  const key = `${s.room.stage}:${s.room.day}`;
  const prev = shownStage;
  shownStage = key;
  if (!prev || prev === key || s.room.broken || !SHIFT_TEXT[s.room.stage]) return;
  const [fromStage, fromDay] = prev.split(':');
  // the case is solved: after the card, the ending plays
  if (s.room.stage === 'result' && fromStage === 'final') playEnding();
  const theme = s.case.theme ?? 'plain';
  const [kicker, title, fallback] = SHIFT_TEXT[s.room.stage](s.room.day, theme);
  // the case's own line for this day or night, when it wrote one
  const sub = s.case.stageCards?.[s.room.stage]?.[s.room.day - 1] ?? fallback;
  const to = railAt(s.room.stage, s.room.day);
  const el = $('shift');
  el.replaceChildren(h('div', { class: 'shift-card' },
    h('span', { class: 'shift-kicker', 'aria-hidden': 'true' }, kicker),
    h('strong', { class: 'shift-title' }, title),
    h('span', { class: 'shift-sub' }, sub),
    h('div', { class: 'shift-rail', 'aria-hidden': 'true' },
      ...[0, 1, 2, 3, 4].map((i) => h('span', { class: `shift-stop${i * 25 < to - 1 ? ' is-past' : i * 25 === to ? ' is-now' : ''}`, style: `left:${i * 25}%` })),
      h('span', { class: 'shift-train', style: `--from:${Math.max(-6, railAt(fromStage, Number(fromDay)))}%;--to:${to}%` }, h('i'))),
    h('span', { class: 'shift-hint', 'aria-hidden': 'true' }, '누르면 바로 넘어가요')));
  el.dataset.stage = s.room.stage;
  el.dataset.theme = theme;
  el.hidden = false;
  el.classList.remove('play');
  void el.offsetWidth; // restart the animation
  el.classList.add('play');
  clearTimeout(shiftTimer);
  shiftTimer = setTimeout(endShift, matchMedia('(prefers-reduced-motion: reduce)').matches ? 1400 : 2400);
}

function endShift() {
  clearTimeout(shiftTimer);
  $('shift').hidden = true;
  $('shift').classList.remove('play');
  playScenes();
}

// ---------- scenes ----------
// A moment the case wants everyone to see (an event's scene, the ending) is read one line at a time
// on a card over the game: click, Space or Enter for the next line, Esc to skip. Scenes wait for
// the stage card to go first.
const sceneEl = document.body.appendChild(h('div', { id: 'scene', class: 'stage-shift scene', hidden: true, role: 'dialog', 'aria-modal': 'true', 'aria-label': '장면' }));
const sceneQueue = [];
let sceneAt = null; // { scene, line }

function queueScene(scene) {
  if (!scene?.lines?.length) return;
  sceneQueue.push(scene);
  playScenes();
}

function playScenes() {
  if (sceneAt || !$('shift').hidden || !sceneQueue.length) return;
  sceneAt = { scene: sceneQueue.shift(), line: 0 };
  drawScene();
}

function drawScene() {
  const { scene, line } = sceneAt;
  const last = line === scene.lines.length - 1;
  sceneEl.dataset.theme = state?.case?.theme ?? 'plain';
  sceneEl.dataset.stage = scene.mood ?? 'scene';
  sceneEl.replaceChildren(h('div', { class: 'shift-card scene-card' },
    h('span', { class: 'shift-kicker', 'aria-hidden': 'true' }, scene.kicker ?? 'SCENE'),
    h('strong', { class: 'scene-title' }, scene.title),
    h('p', { class: 'scene-line', 'aria-live': 'polite' }, scene.lines[line]),
    h('div', { class: 'scene-dots', 'aria-hidden': 'true' }, ...scene.lines.map((_, i) => h('i', { class: i <= line ? 'is-on' : '' }))),
    h('span', { class: 'shift-hint' }, last ? '누르면 닫혀요' : '누르면 다음 장면 · Esc 건너뛰기')));
  sceneEl.hidden = false;
}

function nextScene(skip = false) {
  if (!sceneAt) return;
  if (!skip && sceneAt.line < sceneAt.scene.lines.length - 1) {
    sceneAt.line += 1;
    return drawScene();
  }
  sceneAt = null;
  sceneEl.hidden = true;
  playScenes();
}

sceneEl.addEventListener('click', () => nextScene());
window.addEventListener('keydown', (e) => {
  if (!sceneAt) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  if (e.repeat) return;
  if (e.key === 'Escape') nextScene(true);
  else if ([' ', 'Enter', 'ArrowRight', 'e', 'E', 'ㄷ'].includes(e.key)) nextScene();
}, true);

const barksSeen = new Set();

// A finished case goes into this browser's casebook once (the office shelf on the home page).
function noteSolved() {
  const r = state.final?.result;
  if (state.room.stage !== 'result' || !r) return;
  const key = `mystery:recorded:${code}`;
  try {
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, '1');
  } catch {
    // storage blocked: record once per page instead
    if (noteSolved.done) return;
    noteSolved.done = true;
  }
  recordCase(state.case, r);
}

// The ending: the explanation's opening, a sentence at a time, then its paragraphs.
function endingScene() {
  const r = state.final?.result;
  if (!r?.explanation) return null;
  const [first, ...rest] = r.explanation.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const beats = (first.match(/[^.!?。]+[.!?。]?["”’]?/g) ?? [first]).map((x) => x.trim()).filter(Boolean);
  return { kicker: 'CASE CLOSED', title: state.case.title, mood: 'ending', lines: [...beats, ...rest].slice(0, 6) };
}

// After the truth, what became of everyone: the case's epilogue for how the team did.
function playEnding() {
  queueScene(endingScene());
  const ep = state.final?.result?.epilogue;
  if (ep) queueScene({ kicker: 'EPILOGUE', title: ep.title, mood: 'ending', lines: ep.lines });
}

// ---------- field HUD (day investigation) ----------
// The map fills the screen; the date plate and inspect prompt stay, the rest opens as one note.

const fieldMode = () => Boolean(state && !state.room.broken && state.room.stage === 'day' && state.map);

// ---------- people note ----------
// What this player has heard of each character (server-kept, private, part of save files).

let selectedPerson = null;
let guessFrom = null; // a guess line being drawn: the other end is picked in the form
let peopleBadge = 0;
const seenRecords = { set: null, held: new Map() };
const recordKey = (cid, lineId) => `${cid}|${lineId}`;

// New entries get a toast and raise the tab badge. A keyword line's entry waits until the
// highlighted words have typed out (see onKeyword below).
function noticeRecords() {
  const cast = state.people?.cast ?? [];
  if (!seenRecords.set) {
    seenRecords.set = new Set(cast.flatMap((c) => c.logs.map((l) => recordKey(c.id, l.lineId))));
    return;
  }
  const d = state.dialogue;
  for (const c of cast) {
    for (const l of c.logs) {
      const key = recordKey(c.id, l.lineId);
      if (seenRecords.set.has(key)) continue;
      seenRecords.set.add(key);
      if (l.kind === 'keyword' && d && l.lineId === `${d.dialogueId}:${d.nodeId}`) seenRecords.held.set(key, () => recordToast(c, l));
      else recordToast(c, l);
    }
  }
}

function recordToast(c, l) {
  const text = l.kind === 'meet' ? '처음 만남' : l.kind === 'keyword' ? state.dialogue?.record?.toast ?? l.text : l.text;
  hud.showToast(c.id, c.name, text, portrait(c.portrait, 36));
  if (hud.current() !== 'people') hud.setBadge('people', (peopleBadge += 1));
}

function releaseKeyword(d) {
  if (!d) return;
  const key = recordKey(d.characterId, `${d.dialogueId}:${d.nodeId}`);
  seenRecords.held.get(key)?.();
  seenRecords.held.delete(key);
}

// Where each met character sits on the board: four on top, four below, fixed by case order, so
// no line between two people has to cross the centre box.
const SLOTS = [[93, 108], [279, 108], [465, 108], [651, 108], [93, 444], [279, 444], [465, 444], [651, 444]];
const CENTER = [372, 300];

function peopleNoteView() {
  const pv = state.people ?? { cast: [], unmet: 0, links: [], guesses: [] };
  if (!pv.cast.length) return h('p', { class: 'ig-empty' }, '아직 이야기를 나눈 인물이 없어요. 맵에서 인물에게 다가가 E로 말을 걸어 보세요.');
  if (!pv.cast.some((c) => c.id === selectedPerson)) selectedPerson = pv.cast[0].id;
  const pos = new Map(pv.cast.map((c, i) => [c.id, SLOTS[c.slot % SLOTS.length] ?? SLOTS[i]]));
  const pick = (id) => {
    selectedPerson = id;
    hud.rerender();
  };
  return h('div', { class: 'pp' },
    h('div', { class: 'pp-boardcol' },
      h('div', { class: 'pp-board' },
        ...[...pv.links.map((l) => ({ ...l, kind: 'confirmed' })), ...pv.guesses.map((g) => ({ ...g, kind: 'guess' }))].flatMap((l) => routeLink(l, pos)),
        h('span', { class: 'px drop pp-center', style: `left:${CENTER[0]}px;top:${CENTER[1]}px` }, solo() ? '나의 수사' : '우리 기록단'),
        ...pv.cast.map((c) => {
          const [x, y] = pos.get(c.id);
          return h('button', { type: 'button', class: 'pp-node', 'aria-pressed': c.id === selectedPerson ? 'true' : 'false', style: `left:${x}px;top:${y - 45}px`, onclick: () => pick(c.id) },
            h('span', { class: 'px drop pp-node__frame' }, portrait(c.portrait, 78)),
            h('span', { class: 'px pp-node__name' }, c.name, c.starred ? h('span', { class: 'pp-star', 'aria-label': '주목' }, '★') : null));
        })),
      h('div', { class: 'pp-unmet' }, h('span', {}, '아직 만나지 않은 인물'), ...Array.from({ length: pv.unmet }, () => h('span', { class: 'px pp-unmet__slot', 'aria-hidden': 'true' }, '?')))),
    personCard(pv, pv.cast.find((c) => c.id === selectedPerson)));
}

// Lines only bend at right angles: above the centre go across then down, below go down then across.
function routeLink(l, pos) {
  const seg = (x, y, w, hgt, dir) => h('span', { class: `pp-seg${l.kind === 'guess' ? ` pp-seg--guess is-${dir}` : ''}`, 'aria-hidden': 'true', style: `left:${x}px;top:${y}px;width:${w}px;height:${hgt}px` });
  const H = (x1, x2, y) => seg(Math.min(x1, x2), y - 1, Math.abs(x2 - x1), 3, 'h');
  const V = (x, y1, y2) => seg(x - 1, Math.min(y1, y2), 3, Math.abs(y2 - y1), 'v');
  const tag = (x, y) => h('span', { class: `px pp-linktag${l.kind === 'guess' ? ' pp-linktag--guess' : ''}`, style: `left:${x}px;top:${y}px` }, l.label, l.kind === 'guess' ? '?' : '');
  const b = pos.get(l.b);
  if (!b) return [];
  const [bx, by] = b;
  if (l.a === 'me') {
    const [cx, cy] = CENTER;
    if (by < cy) {
      const sx = bx < cx ? cx - 66 : bx > cx ? cx + 66 : cx;
      return sx === cx ? [V(cx, cy - 30, by + 81), tag(cx, (cy - 30 + by + 81) / 2)] : [H(sx, bx, cy), V(bx, cy, by + 81), tag((sx + bx) / 2, cy)];
    }
    if (Math.abs(by - cy) < 10) {
      const ex = bx < cx ? bx + 45 : bx - 45;
      const sx = bx < cx ? cx - 66 : cx + 66;
      return [H(sx, ex, cy), tag((sx + ex) / 2, cy)];
    }
    const ex = bx < cx ? bx + 45 : bx > cx ? bx - 45 : bx;
    return [V(cx, cy + 30, by), H(cx, ex, by), tag(cx, (cy + 30 + by) / 2)];
  }
  const a = pos.get(l.a);
  if (!a) return [];
  const [ax, ay] = a;
  if (Math.abs(ay - by) < 10) {
    const x1 = ax < bx ? ax + 45 : ax - 45;
    const x2 = ax < bx ? bx - 45 : bx + 45;
    return [H(x1, x2, ay), tag((x1 + x2) / 2, ay)];
  }
  const hx = ax < bx ? ax + 45 : ax - 45;
  const vy = ay < by ? by - 45 : by + 81;
  return [H(hx, bx, ay), V(bx, ay, vy), tag((hx + bx) / 2, ay)];
}

function personCard(pv, c) {
  const others = pv.cast.filter((x) => x.id !== c.id);
  const trait = h('input', { maxlength: 20, placeholder: '특징 한 줄 (20자)', 'aria-label': '특징 추가' });
  const guessTo = h('select', { 'aria-label': '추측 선의 상대' }, ...others.map((x) => h('option', { value: x.id }, x.name)));
  const guessLabel = h('input', { maxlength: 12, placeholder: '관계 (12자)', 'aria-label': '추측한 관계' });
  const mine = pv.guesses.filter((g) => g.a === c.id || g.b === c.id);
  const nameOf = (id) => pv.cast.find((x) => x.id === id)?.name ?? '?';
  return h('article', { class: 'pp-card', 'aria-label': `${c.name} 기록` },
    h('div', { class: 'pp-card__head' },
      h('span', { class: 'px pp-node__frame' }, portrait(c.portrait, 72)),
      h('div', { class: 'pp-card__who' },
        h('span', { class: 'pp-card__name' }, c.name),
        h('span', { class: 'pp-card__role' }, c.role || '역할 미확인'),
        h('span', { class: 'pp-card__chips' }, h('span', { class: 'px pp-chip pp-chip--met' }, '만남'), h('span', { class: 'px pp-chip' }, `대화 ${c.talks}회`))),
      h('button', { type: 'button', class: `px pp-starbtn${c.starred ? ' is-on' : ''}`, 'aria-pressed': c.starred ? 'true' : 'false', 'aria-label': '주목 표시', onclick: () => act('personStar', { characterId: c.id, starred: !c.starred }) }, '★')),
    h('h3', { class: 'pp-h3' }, '조사 기록 · 자동으로 쌓여요'),
    h('ol', { class: 'pp-logs' }, ...(c.logs.length ? c.logs.map((l) => h('li', { class: `pp-log pp-log--${l.kind}` }, h('span', { class: 'pp-log__when' }, l.when), h('span', { class: 'pp-log__text' }, l.text))) : [h('li', { class: 'pp-log__when' }, '아직 기록이 없어요.')])),
    h('h3', { class: 'pp-h3' }, '내가 적은 특징'),
    h('div', { class: 'pp-traits' }, ...(c.traits.length ? c.traits.map((t, i) => h('button', { type: 'button', class: 'px pp-trait', title: '눌러서 지우기', onclick: () => act('personTrait', { characterId: c.id, remove: i }) }, t, ' ✕')) : [h('span', { class: 'pp-log__when' }, '아직 적은 특징이 없어요.')])),
    h('form', { class: 'pp-form', onsubmit: async (e) => {
      e.preventDefault();
      if (!trait.value.trim()) return;
      const res = await act('personTrait', { characterId: c.id, text: trait.value });
      if (res.status === 200) trait.value = '';
    } }, trait, h('button', { type: 'submit', class: 'px' }, '추가')),
    h('h3', { class: 'pp-h3' }, '내 추측 선 · 점선으로 그려져요'),
    mine.length ? h('div', { class: 'pp-traits' }, ...mine.map((g) => h('button', { type: 'button', class: 'px pp-trait pp-trait--guess', title: '눌러서 지우기', onclick: () => act('guessRemove', { guessId: g.id }) }, `${nameOf(g.a === c.id ? g.b : g.a)} · ${g.label}? ✕`))) : null,
    others.length
      ? h('form', { class: 'pp-form', onsubmit: async (e) => {
          e.preventDefault();
          if (!guessLabel.value.trim()) return;
          const res = await act('guessAdd', { a: c.id, b: guessTo.value, label: guessLabel.value });
          if (res.status === 200) guessLabel.value = '';
        } }, guessTo, guessLabel, h('button', { type: 'submit', class: 'px' }, '긋기'))
      : h('p', { class: 'pp-log__when' }, '두 명 이상 만나면 추측 선을 그을 수 있어요.'),
    h('button', { type: 'button', class: 'px drop pp-share', onclick: () => sharePerson(c) }, '이 인물 기록을 공동 보드에 공유'));
}

// Sharing copies the record into a board memo; the note itself stays private.
async function sharePerson(c) {
  const body = [...c.logs.map((l) => `· ${l.when} — ${l.text}`), ...(c.traits.length ? ['', `특징: ${c.traits.join(', ')}`] : [])].join('\n').slice(0, 2000);
  const res = await act('noteCreate', { kind: 'memo', title: `${c.name} 기록`.slice(0, 60), body, links: [] });
  if (res.status === 200) toast(`‘${c.name}’ 기록을 공동 보드에 메모로 올렸어요.`, 'good');
}

let textSpeed = savedSpeed();
// auto: only where fingers are the main pointer (phones, tablets), not touch-screen laptops
const TOUCHPAD_KEY = 'mystery:touchpad';
let touchpadMode = (() => {
  try {
    return ['auto', 'on', 'off'].includes(localStorage.getItem(TOUCHPAD_KEY)) ? localStorage.getItem(TOUCHPAD_KEY) : 'auto';
  } catch {
    return 'auto';
  }
})();
// how much the day HUD lets the map show through: solid, normal or light (field.css --hud-alpha)
const HUD_KEY = 'mystery:hud';
const HUD_ALPHA = { solid: 1, normal: 0.7, light: 0.45 };
let hudLook = (() => {
  try {
    return HUD_ALPHA[localStorage.getItem(HUD_KEY)] ? localStorage.getItem(HUD_KEY) : 'normal';
  } catch {
    return 'normal';
  }
})();
const applyHudLook = () => document.getElementById('hud')?.style.setProperty('--hud-alpha', String(HUD_ALPHA[hudLook]));
applyHudLook();
const HINTS_KEY = 'mystery:hints';
let hintsOn = (() => {
  try {
    return localStorage.getItem(HINTS_KEY) !== 'off';
  } catch {
    return true;
  }
})();
const padWanted = () => (touchpadMode === 'auto' ? matchMedia('(pointer: coarse)').matches : touchpadMode === 'on');
// One row of mutually exclusive buttons for a setting.
function segmented(label, names, current, pick) {
  return h('div', { class: 'speed' }, h('h3', {}, label), h('div', { class: 'subtabs speed-seg' }, ...Object.keys(names).map((k) => h('button', {
    type: 'button',
    class: current === k ? 'active' : '',
    'aria-pressed': current === k ? 'true' : 'false',
    onclick: () => {
      pick(k);
      if (fieldMode()) hud.rerender();
      else renderTabs();
    },
  }, names[k]))));
}

// Settings live in this browser only (localStorage), never on the server.
function settingsView() {
  return [
    segmented('대사 속도', { slow: '느리게', normal: '보통', fast: '빠르게', instant: '바로' }, textSpeed, (k) => {
      textSpeed = k;
      saveSpeed(k);
      dialogueBox.setSpeed(k);
    }),
    segmented('화면 방향 패드', { auto: '자동', on: '켜기', off: '끄기' }, touchpadMode, (k) => {
      touchpadMode = k;
      try {
        localStorage.setItem(TOUCHPAD_KEY, k);
      } catch {
        // private windows: the choice lasts until the page closes
      }
      renderTouchpad();
    }),
    h('p', { class: 'muted small' }, '자동은 손가락으로 조작하는 휴대폰·태블릿에서만 패드를 보여 줘요.'),
    segmented('화면 정보 (낮 조사)', { solid: '진하게', normal: '보통', light: '흐리게' }, hudLook, (k) => {
      hudLook = k;
      try {
        localStorage.setItem(HUD_KEY, k);
      } catch {
        // private windows: the choice lasts until the page closes
      }
      applyHudLook();
    }),
    h('p', { class: 'muted small' }, '날짜·목표·지도·노트 탭이 맵을 가리는 정도예요. 마우스를 올리면 진해지고, 인물이 밑에 오면 더 옅어져요.'),
    segmented('힌트', { on: '보기', off: '끄기' }, hintsOn ? 'on' : 'off', (k) => {
      hintsOn = k === 'on';
      try {
        localStorage.setItem(HINTS_KEY, k);
      } catch {
        // private windows: the choice lasts until the page closes
      }
    }),
    h('p', { class: 'muted small' }, '단서를 누구에게 보여 줄지, 누구에게 새 질문이 생겼는지, 어떤 단서에 겹쳐 볼 짝이 있는지 알려 줘요. 끄면 혼자 추리해요.'),
    segmented('글자 크기', { normal: '보통', large: '크게' }, a11y.text, (k) => setA11y('text', k)),
    segmented('증거 그림', { normal: '보통', strong: '또렷하게' }, a11y.pictures, (k) => setA11y('pictures', k)),
    h('p', { class: 'muted small' }, '또렷하게: 그림의 대비를 높이고 크게 보여 줘요. 색을 구분하기 어려울 때 도움이 돼요.'),
  ];
}

// Accessibility: larger text, and evidence pictures with more contrast. Kept per browser.
const A11Y_KEY = 'mystery:a11y';
const a11y = (() => {
  try {
    return { text: 'normal', pictures: 'normal', ...JSON.parse(localStorage.getItem(A11Y_KEY)) };
  } catch {
    return { text: 'normal', pictures: 'normal' };
  }
})();
function applyA11y() {
  document.documentElement.classList.toggle('a11y-large', a11y.text === 'large');
  document.documentElement.classList.toggle('a11y-pictures', a11y.pictures === 'strong');
}
function setA11y(key, value) {
  a11y[key] = value;
  try {
    localStorage.setItem(A11Y_KEY, JSON.stringify(a11y));
  } catch {
    // private windows: the choice lasts until the page closes
  }
  applyA11y();
}
applyA11y();
const hudSeen = { board: null, chat: null, notices: null };

function renderField() {
  const on = fieldMode();
  document.body.classList.toggle('field', on);
  $('hud').hidden = !on;
  placeToasts();
  if (!on) {
    if (hud.current()) hud.close();
    return;
  }
  const s = state;
  hud.setDate({ day: s.room.day, phase: '낮 조사', location: s.map.name });
  hud.setGoal(goalProgress());
  hud.setEndDay(endDayButton());
  renderSecurity();
  hud.setCount('notebook', s.notebook.clues.length);
  hud.setCount('party', `${s.players.filter((p) => p.connected).length}/${s.room.settings.capacity}`);
  // what arrived while its note was closed; the first view sets the baseline
  hudSeen.board ??= new Set(s.board.clues.map((c) => c.id));
  hudSeen.chat ??= s.chat.at(-1)?.id ?? 0;
  hudSeen.notices ??= s.notices.at(-1)?.id ?? 0;
  const open = hud.current();
  if (open === 'board') for (const c of s.board.clues) hudSeen.board.add(c.id);
  if (open === 'chat') hudSeen.chat = s.chat.at(-1)?.id ?? hudSeen.chat;
  if (open === 'menu') hudSeen.notices = s.notices.at(-1)?.id ?? hudSeen.notices;
  hud.setBadge('board', s.board.clues.filter((c) => !hudSeen.board.has(c.id) && c.sharedBy !== s.me.id).length);
  hud.setBadge('chat', s.chat.filter((m) => m.id > hudSeen.chat && m.from !== s.me.id).length);
  hud.setBadge('menu', s.notices.filter((n) => n.id > hudSeen.notices).length);
  noticeRecords();
  hud.rerender();
}

function renderNote(id, body) {
  // a note opened again is emptied first, so whatever was drawn before no longer counts
  if (body.dataset.note !== id || !body.firstChild) {
    memo.delete(body);
    body.dataset.note = id;
  }
  const s = state;
  if (!s) return;
  if (id === 'chat') return renderChat(body);
  if (body.firstChild === chatPanel) memo.delete(body);
  const minute = Math.floor(Date.now() / 60000);
  const notes = {
    notebook: [[s.notebook, notebookTab, activeClue, s.hints, hintsOn], notebookView],
    people: [[s.people, selectedPerson, guessFrom], peopleNoteView],
    board: [[s.board, s.players, minute], () => boardView({})],
    brief: [[s.room, s.players, s.me, s.goals, s.summary, hintsOn], briefView],
    party: [[s.players, s.me, s.room.stage, s.characters], () => [playersView(), s.characters?.length ? [h('h3', {}, '만난 인물'), peopleView()] : null]],
    menu: [[s.room.saves, s.room.stage, s.me.isHost, s.notices, minute, textSpeed, touchpadMode, hintsOn, hudLook, a11y.text, a11y.pictures], () => [settingsView(), savesView(), h('h3', {}, '알림'), noticesView()]],
  };
  const [key, build] = notes[id];
  renderInto(body, `${id}:${JSON.stringify(key)}`, build);
}

// ---------- goals ----------
// The case's to-do list for today (case.goals), ticked by the server as the team gets there.
const goalProgress = (goals = state?.goals ?? []) => {
  const required = goals.filter((g) => !g.optional);
  const next = required.find((g) => !g.done) ?? goals.find((g) => !g.done && g.optional);
  return { done: required.filter((g) => g.done).length, total: required.length, next: next?.text ?? null };
};

function goalChecklist() {
  const goals = state.goals ?? [];
  if (!goals.length) return null;
  const { done, total } = goalProgress(goals);
  return h('div', { class: 'goal-check' },
    h('div', { class: 'goal-check__head' }, h('strong', {}, '오늘의 목표'), h('span', { class: 'chip' }, `${done}/${total}`)),
    h('ol', { class: 'goal-check__list' }, ...goals.map((g) => h('li', { class: `goal-item${g.done ? ' is-done' : ''}${g.optional ? ' is-optional' : ''}` },
      h('span', { class: 'goal-item__box', 'aria-hidden': 'true' }, g.done ? '✓' : ''),
      h('div', { class: 'goal-item__body' },
        h('span', { class: 'goal-item__text' }, g.text, g.optional ? h('span', { class: 'goal-item__tag' }, '선택') : null),
        // how to get there, only while it is still to do and hints are on
        !g.done && g.hint && hintsOn ? h('span', { class: 'goal-item__hint' }, g.hint) : null),
      h('span', { class: 'sr-only' }, g.done ? '완료' : '남음')))));
}

// A goal ticked since the last view gets a toast; the first view only sets the baseline.
let goalsSeen = null;
function noticeGoals() {
  const goals = state.goals ?? []; // none in the waiting room
  const done = new Set(goals.filter((g) => g.done).map((g) => g.id));
  if (goalsSeen) for (const g of goals) if (done.has(g.id) && !goalsSeen.has(g.id)) toast(`목표 달성 · ${g.text}`, 'good');
  goalsSeen = new Set([...(goalsSeen ?? []), ...done]);
}

// The morning look back: what reached the board yesterday and what was left undone.
function summaryView() {
  const s = state.summary;
  if (!s) return null;
  return h('section', { class: 'summary-card' },
    h('strong', {}, `${s.day}일 차 요약`),
    h('p', { class: 'small' }, s.shared.length ? `새로 보드에 오른 자료 ${s.shared.length}개: ${s.shared.join(', ')}` : '어제는 보드에 새로 오른 자료가 없어요.'),
    s.open.length ? h('div', { class: 'small' }, '아직 못 끝낸 일', h('ul', {}, ...s.open.map((t) => h('li', {}, t)))) : null,
    h('span', { class: 'muted small' }, `보드에 모인 자료 모두 ${s.total}개`));
}

// Above the guide level hints are hidden; the liaison gives one when asked, and the result counts it.
function hintAsk() {
  if ((state.room.settings.difficulty ?? 'guide') === 'guide' || !['day', 'night'].includes(state.room.stage)) return null;
  const ask = () => confirmModal('윤서하에게 힌트 받기', '힌트를 받으면 결과 화면과 업적에 기록돼요. 받을까요?', '힌트 받기', async () => {
    const res = await act('askHint', {}, { quiet: true });
    if (res.status !== 200) return toast(errorText(res), 'error');
    const x = res.body.hint;
    if (!x) return toast('윤서하: 지금은 드릴 말이 없어요. 모은 자료를 다시 맞춰 보세요.', 'info');
    const said = x.kind === 'show' ? `‘${x.clue}’을 ${x.who}에게 보여 주세요 (${x.place})` : x.kind === 'share' ? `‘${x.clue}’을 보드에 올리면 ${x.who}에게 물어볼 게 생겨요` : `${x.who}에게 새로 물어볼 게 있어요 (${x.place})`;
    openModal(h('p', { class: 'eyebrow' }, '윤서하의 힌트'), h('p', {}, said), h('p', { class: 'muted small' }, `지금까지 힌트 ${res.body.used}번`), h('div', { class: 'row end' }, h('button', { class: 'primary', onclick: closeModal }, '알겠어요')));
  });
  return h('button', { type: 'button', class: 'small', onclick: ask }, '윤서하에게 힌트 받기');
}

function briefView() {
  return [
    summaryView(),
    goalChecklist(),
    hintAsk(),
    briefingView(),
    h('p', {}, goalFor('day').text),
    h('p', { class: 'muted', id: 'briefTimer' }, timerText()),
    h('ul', { class: 'brief-keys', 'aria-label': '단축키' }, ...KEY_HELP.map(([keys, what]) => h('li', {}, ...keys.map((k) => h('kbd', {}, k)), ' ', what))),
    h('div', { class: 'brief-actions' }, ...actionItems()),
  ];
}

// Night and the final deduction show the board in the scene, so the side keeps the notebook.
function visibleTabs() {
  if (!state.map) return ['players', 'notices'];
  const boardInScene = state.room.stage === 'night';
  return ['notebook', boardInScene ? null : 'board', state.characters?.length ? 'people' : null, 'players', 'saves', 'notices'].filter(Boolean);
}

function defaultTab() {
  return state.map ? 'notebook' : 'players';
}

function renderStage() {
  const s = state;
  const area = $('stage');
  const stage = s.room.broken ? 'broken' : s.room.stage;
  if (area.dataset.mode !== stage) {
    area.dataset.mode = stage;
    memo.delete(area);
  }
  if (stage === 'day') {
    if (!$('mapCanvas')) {
      area.replaceChildren(h('div', { class: 'mapbox' },
        h('div', { class: 'mapbar' }, h('strong', { id: 'mapName' }), h('span', { id: 'devices' })),
        h('div', { class: 'map-wrap' }, h('canvas', { id: 'mapCanvas', tabindex: 0, 'aria-label': '게임 맵. 방향키로 이동, E로 조사' })),
        h('div', { id: 'focusHint', class: 'map-prompt', 'aria-live': 'polite' }),
      ));
    }
    renderMapHud();
    return;
  }
  const builders = { broken: brokenView, lobby: lobbyView, intro: introView, night: nightView, final: finalView, result: resultView };
  const keyData = stage === 'night' ? [s.board, s.players, s.notebook?.clues.length] : stage === 'final' ? [s.final, s.players, s.me, finalPage] : stage === 'lobby' ? [s.case, s.players, s.room, s.me, lobbyCases, Boolean(lookSet()), s.chat.length] : [s.case, s.final, s.room.broken, resultPage];
  renderInto(area, JSON.stringify(keyData), builders[stage]);
}

// ---------- map motion ----------
// The server moves players a tile at a time; the client slides each step over STEP_MS and plays the
// walk while sliding. Turning, walking and one-shot motions are all drawn from this table.
const STEP_MS = 150;
const motion = new Map();
let motionMapId = null;

function slide(m, now) {
  const k = Math.min(1, (now - m.t0) / (m.dur ?? STEP_MS));
  return { x: m.fx + (m.x - m.fx) * k, y: m.fy + (m.y - m.fy) * k };
}

function syncMotion() {
  if (!state?.map) return;
  const now = performance.now();
  if (motionMapId !== state.map.id) {
    motion.clear();
    motionMapId = state.map.id;
  }
  const here = new Set();
  for (const p of state.map.players) {
    here.add(p.id);
    const m = motion.get(p.id);
    if (!m) {
      motion.set(p.id, { x: p.x, y: p.y, fx: p.x, fy: p.y, t0: 0, facing: p.facing ?? 's', walkUntil: 0, action: null, actionT0: 0 });
      continue;
    }
    if (m.x !== p.x || m.y !== p.y) {
      const cur = slide(m, now);
      // Steps that arrive bunched up (a slow connection, or a batch of steps sent together) are
      // walked over, a step's time per tile; only real teleports (doors, far jumps) skip the slide.
      const dist = Math.abs(p.x - cur.x) + Math.abs(p.y - cur.y);
      const jump = dist > STEP_BATCH + 2;
      const dur = STEP_MS * Math.max(1, Math.min(dist, STEP_BATCH + 2)) * (dist > 1.5 ? 0.75 : 1);
      Object.assign(m, { fx: jump ? p.x : cur.x, fy: jump ? p.y : cur.y, x: p.x, y: p.y, t0: now, dur, walkUntil: jump ? 0 : now + dur + 170, action: null });
    }
    m.facing = p.facing ?? m.facing;
  }
  for (const id of motion.keys()) if (!here.has(id)) motion.delete(id);
}

// Full redraws only while something moves or right after a new view; otherwise ~10 per second,
// enough for idle loops and the sparkles. Keeps laptops cool and input snappy.
const IDLE_REDRAW_MS = 100;
let lastDraw = 0;
let drawnStamp = -1;
let viewStamp = 0;

function drawLoop() {
  const canvas = $('mapCanvas');
  if (canvas && state?.map && state.room.stage === 'day') {
    const now = performance.now();
    const busy = viewStamp !== drawnStamp || now - lastDraw >= IDLE_REDRAW_MS || [...motion.values()].some((m) => now < m.walkUntil || (m.action && now - m.actionT0 < 2000)) || (state.dialogue && !dialogueBox.tw.done);
    if (!busy) return requestAnimationFrame(drawLoop);
    lastDraw = now;
    drawnStamp = viewStamp;
    const view = new Map();
    for (const [id, m] of motion) {
      const pos = slide(m, now);
      const look = findLook(state.players.find((p) => p.id === id)?.avatar);
      const actionT = now - m.actionT0;
      const acting = m.action && look?.actions[m.action] && actionT < animLength(look.actions[m.action]);
      view.set(id, { rx: pos.x, ry: pos.y, facing: m.facing, moving: now < m.walkUntil, action: acting ? m.action : null, actionT });
    }
    fitCanvas(canvas);
    const anchors = drawMap(canvas, state, { focusId: pickTarget(state, facing)?.id, now, motion: view, talkingId: dialogueBox.tw.done ? null : state.dialogue?.objectId, worldLabels: fieldMode(), news: hintsOn ? new Set(state.hints?.news ?? []) : null, serverNow: Date.now() + clockOffset, barks: (state.barks ?? []).filter((b) => Date.now() - b.at < 4000), reduce: reduceMotion });
    drawPings(canvas, now);
    drawNoise(canvas, performance.now());
    followCamera(canvas, view);
    if (fieldMode()) placeWorld(canvas, anchors);
  }
  requestAnimationFrame(drawLoop);
}
requestAnimationFrame(drawLoop);

// ---------- minimap ----------
// The whole case as one pixel plan (fetched once per case version): a small one under the goals
// that follows you, and the full one with every room's name on M or a click. ~5 frames a second
// is enough for the blinking marker; positions in your room slide with everyone's steps.
let plan = null;
let planFor = null;
const miniCanvas = h('canvas', { class: 'nui-mini__map', width: 168, height: 112 });
const miniName = h('span', { class: 'nui-mini__name' });
// The team's warnings (rules.security) as a row of boxes under the goals; full ends the day.
const securityBox = h('div', { class: 'px drop nui-security', hidden: true, role: 'status', 'aria-live': 'polite' });
function renderSecurity() {
  const s = state.security;
  const show = Boolean(s && fieldMode());
  if (!securityBox.isConnected && hud.corner) hud.corner.append(securityBox);
  if (securityBox.hidden === show) securityBox.hidden = !show;
  if (!show) return;
  const key = `${s.strikes}/${s.max}/${s.active}`;
  if (securityBox.dataset.key === key) return;
  securityBox.dataset.key = key;
  securityBox.replaceChildren(
    h('span', { class: 'nui-security__label' }, s.label),
    h('span', { class: 'nui-security__boxes', 'aria-label': `${s.label} ${s.strikes}/${s.max}` }, ...Array.from({ length: s.max }, (_, i) => h('i', { class: i < s.strikes ? 'is-on' : '' }))),
    ...(s.active ? [] : [h('span', { class: 'nui-security__note' }, '아직 쌓이지 않아요')]));
}

const miniBox = h('button', { type: 'button', class: 'px drop nui-mini', hidden: true, title: '전체 지도 (M)', 'aria-label': '전체 지도 열기 (M)', onclick: () => toggleFullMap(true) },
  miniCanvas, h('span', { class: 'nui-mini__foot' }, miniName, h('kbd', {}, 'M')));
const fullCanvas = h('canvas', { class: 'full-map__canvas' });
const fullMap = h('div', { class: 'full-map', hidden: true, role: 'dialog', 'aria-label': '전체 지도', onclick: (e) => e.target === fullMap && toggleFullMap(false) },
  h('div', { class: 'px drop full-map__card' },
    h('div', { class: 'full-map__head' }, h('strong', {}, '전체 지도'),
      h('span', { class: 'full-map__legend' }, h('i', { class: 'is-me' }), '나', h('i', { class: 'is-mate' }), '동료', h('i', { class: 'is-here' }), '지금 있는 곳', h('i', { class: 'is-locked' }), '잠긴 길'),
      h('button', { type: 'button', class: 'px full-map__close', 'aria-label': '지도 닫기', onclick: () => toggleFullMap(false) }, '닫기 Esc')),
    fullCanvas));
document.body.append(fullMap);

function toggleFullMap(open = fullMap.hidden) {
  fullMap.hidden = !open || !plan;
}

async function loadPlan() {
  const key = state?.case ? `${state.case.id}@${state.case.version}` : null;
  if (!key || key === planFor || !['intro', 'day', 'night', 'final'].includes(state.room.stage)) return;
  planFor = key;
  const res = await api('GET', `/api/rooms/${code}/minimap`, { token: conn.token });
  if (res.status === 200 && res.body.case === key) plan = res.body;
  else planFor = null;
}

function livePositions(now) {
  const view = new Map();
  for (const [id, m] of motion) {
    const pos = slide(m, now);
    view.set(id, { rx: pos.x, ry: pos.y });
  }
  return view;
}

let miniDrawn = 0;
function minimapLoop() {
  const now = performance.now();
  if (!miniBox.isConnected) hud.corner.append(miniBox); // the HUD is mounted by the time frames run
  if (state && plan && now - miniDrawn > 180) {
    miniDrawn = now;
    const positions = livePositions(now);
    const showMini = fieldMode();
    if (miniBox.hidden === showMini) miniBox.hidden = !showMini;
    if (showMini) {
      drawMinimap(miniCanvas, plan, state, { px: 2, center: focusOf(plan, state, positions), motion: positions, now, serverNow: Date.now() + clockOffset });
      miniName.textContent = state.map?.name ?? '';
    }
    if (!fullMap.hidden) {
      // the largest whole-pixel scale that fits the window
      const px = Math.max(2, Math.min(8, Math.floor(Math.min((innerWidth - 64) / plan.width, (innerHeight - 140) / plan.height))));
      if (fullCanvas.width !== plan.width * px) {
        fullCanvas.width = plan.width * px;
        fullCanvas.height = plan.height * px;
      }
      drawMinimap(fullCanvas, plan, state, { px, labels: true, motion: positions, now, serverNow: Date.now() + clockOffset });
    }
  }
  requestAnimationFrame(minimapLoop);
}
requestAnimationFrame(minimapLoop);

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !fullMap.hidden) {
    e.stopImmediatePropagation();
    return toggleFullMap(false);
  }
  if ((e.key === 'm' || e.key === 'M' || e.key === 'ㅡ') && !e.repeat && plan && !e.target.closest('input, textarea, select') && $('modal').hidden && !dialogueBox.isActive()) {
    e.preventDefault();
    toggleFullMap();
  }
}, true);

// Map labels and the E bubble follow the canvas: canvas pixels → screen pixels.
// Chat lines appear over the speaker's head on the map for a few seconds (longer for longer lines).
const chatBubbles = new Map(); // playerId → { text, until }
let bubbleSeenChat = null;
function noticeChatBubbles() {
  const last = state.chat.at(-1)?.id ?? 0;
  if (bubbleSeenChat === null) bubbleSeenChat = last; // older lines never pop up
  for (const m of state.chat) {
    if (m.id <= bubbleSeenChat) continue;
    chatBubbles.set(m.from, { text: m.text.length > 60 ? `${m.text.slice(0, 58)}…` : m.text, until: performance.now() + Math.min(8000, 3500 + m.text.length * 60) });
  }
  bubbleSeenChat = Math.max(bubbleSeenChat, last);
}
function liveBubbles() {
  const now = performance.now();
  const out = new Map();
  for (const [id, b] of chatBubbles) {
    if (b.until > now) out.set(id, b.text);
    else chatBubbles.delete(id);
  }
  return out;
}

// The canvas only moves when the window, the map size or the space around it changes (fitCanvas
// records that in dataset.fit: the corner folding or opening slides the map), so its box is
// measured then.
let canvasBox = { key: null, r: null };
function placeWorld(canvas, anchors) {
  const key = `${canvas.dataset.fit}:${canvas.style.width}:${canvas.style.transform}`;
  if (canvasBox.key !== key) canvasBox = { key, r: canvas.getBoundingClientRect() };
  const r = canvasBox.r;
  const k = r.width / canvas.width;
  const at = (x, y) => [r.left + x * k, r.top + y * k];
  const talking = state.dialogue?.objectId ?? null;
  const focus = hud.setWorld(anchors, at, { speakingId: talking, chat: liveBubbles() });
  fadeHudOver(anchors, at);
  const target = !state.dialogue && focus ? pickTarget(state, facing) : null;
  hud.setBubble(target ? { kind: focus.kind, text: target.label, verb: target.kind === 'talk' ? '대화하기' : target.kind === 'hide' ? (state.me.hiddenIn === target.id ? '나오기' : '숨기') : target.kind === 'station' ? '앉기' : target.done ? '다시 보기' : '조사하기', x: focus.x, y: focus.y } : null, at);
}

// A HUD panel turns nearly clear while you, a teammate or a person you can talk to stands under it.
const HUD_MARGIN = 18;
function fadeHudOver(anchors, at) {
  const people = anchors.filter((a) => a.kind === 'me' || a.kind === 'player' || a.kind === 'npc');
  for (const panel of [hud.corner, document.querySelector('#hud .nui-tabs')]) {
    if (!panel) continue;
    const r = panel.getBoundingClientRect();
    const under = people.some((a) => [a.y, a.head ?? a.y].some((y) => {
      const [x, sy] = at(a.x, y);
      return x > r.left - HUD_MARGIN && x < r.right + HUD_MARGIN && sy > r.top - HUD_MARGIN && sy < r.bottom + HUD_MARGIN;
    }));
    panel.classList.toggle('is-behind', under);
  }
}

// On the field the map grows by whole numbers to fill the screen, so its pixels stay square;
// one that does not fit at 1× shrinks to fit instead.
// On the field the note tabs stand along the right edge (a bar along the bottom on phones); the map
// keeps clear of them so no door or person ends up under a tab.
function fitCanvas(canvas) {
  const rail = fieldMode() ? document.querySelector('#hud .nui-tabs') : null;
  const side = rail && getComputedStyle(rail).flexDirection === 'column';
  const right = rail && side ? rail.offsetWidth + 9 : 0;
  // upright with the touch pad showing, the map keeps above the pad
  const pad = fieldMode() && !$('touchpad').hidden && innerHeight > innerWidth ? $('touchpad').querySelector('.pad').offsetHeight + 24 : 0;
  const bottom = (rail && !side ? rail.offsetHeight : 0) + pad;
  // the date, goals and minimap column on the left too (unless folded to the date plate): the map
  // shrinks into the space between, as long as that space is still a usable width
  const corner = rail && side ? document.querySelector('#hud .nui-corner:not(.is-folded)') : null;
  const leftWant = corner ? corner.offsetWidth + 18 : 0;
  const left = leftWant && innerWidth - right - leftWant >= 480 ? leftWant : 0;
  const key = `${canvas.width}x${canvas.height}:${innerWidth}x${innerHeight}:${fieldMode()}:${right}:${bottom}:${left}`;
  if (canvas.dataset.fit === key) return;
  canvas.dataset.fit = key;
  Object.assign($('stage').style, { right: right ? `${right}px` : '', bottom: bottom ? `${bottom}px` : '', left: left ? `${left}px` : '' });
  const availW = innerWidth - right - left;
  const availH = innerHeight - bottom;
  const fitW = availW / canvas.width;
  const fitH = availH / canvas.height;
  // A phone and a room much wider than the screen (a phone held upright, or a long train car held
  // sideways): fitting the width would leave a thin strip.
  // Zoom in to use the height instead (at most 2.5×) and let the camera follow the player across.
  camera = fieldMode() && Math.min(innerWidth, innerHeight) <= 520 && fitH > fitW * 1.4 ? { zoom: Math.min(fitH * 0.92, fitW * 2.5), availW } : null;
  $('stage').classList.toggle('is-follow', Boolean(camera));
  canvas.style.transform = '';
  if (camera) {
    canvas.style.width = `${Math.round(canvas.width * camera.zoom)}px`;
    canvas.style.height = `${Math.round(canvas.height * camera.zoom)}px`;
    return;
  }
  const room = Math.min(fitW, fitH);
  const k = fieldMode() && room >= 1 ? Math.floor(room) : null;
  canvas.style.width = k ? `${canvas.width * k}px` : '';
  canvas.style.height = k ? `${canvas.height * k}px` : '';
}

// The follow camera (tall screens): the map slides so the player stays in the middle, never past
// the map's edges.
let camera = null;
function followCamera(canvas, view) {
  if (!camera) return;
  const me = view.get(state.me.id);
  if (!me) return;
  const T = canvas.width / state.map.width;
  const cssW = canvas.width * camera.zoom;
  const x = (me.rx + 0.5) * T * camera.zoom;
  const offset = Math.round(Math.max(camera.availW - cssW, Math.min(0, camera.availW / 2 - x)));
  const t = `translateX(${offset}px)`;
  if (canvas.style.transform !== t) canvas.style.transform = t;
}

function renderMapHud() {
  if (!$('mapCanvas') || !state.map) return;
  const target = pickTarget(state, facing);
  $('mapName').textContent = state.map.name;
  $('devices').textContent = [...state.devices.map((d) => `${d.label}: ${d.value}`), state.room.stageLabel].join(' · ');
  $('focusHint').replaceChildren(
    target
      ? h('span', {}, h('kbd', {}, 'E'), ` ${target.label} ${target.kind === 'talk' ? '말 걸기' : target.done ? '다시 보기' : '조사'}`)
      : h('span', { class: 'muted' }, '가까이에 조사할 대상이 없어요. 대상 옆 칸으로 가 보세요.'),
  );
}

function brokenView() {
  return h('div', { class: 'sheet' }, h('h2', {}, '케이스를 불러올 수 없어요'), h('p', {}, state.room.broken.message), h('p', { class: 'muted' }, '운영자가 같은 버전을 다시 설치하면 이 방은 그대로 이어서 할 수 있어요.'));
}

let lobbyCases = null;
async function loadCases() {
  const res = await api('GET', '/api/cases');
  lobbyCases = res.body?.cases ?? [];
  if (state) render();
}

// Cases with teams: each player picks one in the lobby (or is put in the smallest at the start).
// Alone, one player plays every team, so there is nothing to pick.
const teamName = (id) => (id === '*' ? '모든 팀' : state.case?.teams?.find((t) => t.id === id)?.name ?? null);

function teamPicker() {
  const s = state;
  const teams = s.case?.teams ?? [];
  if (!teams.length) return null;
  if (s.room.settings.solo) return h('p', { class: 'muted small' }, `이 사건은 ${teams.length}팀으로 나눠 수사해요. 혼자 하면 모든 팀을 겸해요.`);
  const pick = (team) => act('chooseTeam', { team });
  const mine = s.players.find((p) => p.id === s.me.id)?.team ?? null;
  return h('div', { class: 'teams' },
    h('h3', {}, '팀 고르기'),
    h('p', { class: 'muted small' }, '팀마다 다른 구역에서 시작하고, 그 팀만 아는 정보가 있어요. 고르지 않으면 시작할 때 인원이 적은 팀에 들어가요.'),
    h('div', { class: 'team-grid' }, ...teams.map((t) => {
      const members = s.players.filter((p) => p.team === t.id);
      const on = mine === t.id;
      return h('button', { type: 'button', class: `team-card${on ? ' is-on' : ''}`, 'aria-pressed': on ? 'true' : 'false', onclick: () => pick(on ? null : t.id) },
        h('strong', {}, t.name),
        h('span', { class: 'muted small' }, `${t.place}에서 시작`),
        h('span', { class: 'small' }, members.length ? members.map((p) => p.nickname).join(', ') : '아직 아무도 없어요'));
    })));
}

// The team's own briefing: what only this team was told (the server sends no other team's).
function briefingView() {
  const list = state.me.briefings ?? [];
  if (!list.length) return null;
  return h('section', { class: 'briefing' },
    h('span', { class: 'tag tag--rose' }, state.me.team === '*' ? '모든 팀의 비밀 안내' : `${teamName(state.me.team)} 비밀 안내`),
    ...list.map((b) => h('div', { class: 'briefing__item' }, list.length > 1 ? h('strong', {}, b.name) : null, h('p', { class: 'pre' }, b.text))),
    h('p', { class: 'muted small' }, state.me.team === '*' ? '혼자 하는 수사라 모든 팀의 안내를 받았어요.' : '다른 팀은 이 내용을 몰라요. 필요하면 밤 토의 때 알려 주세요.'));
}

function lobbyView() {
  const s = state;
  const link = `${location.href.split('#')[0]}#${s.room.code}`;
  const isHost = s.me.isHost;
  const others = s.players.filter((p) => !p.isHost);
  const readyCount = others.filter((p) => p.ready && p.connected).length;
  if (!lobbyCases) loadCases();
  const looks = lookSet();
  const mine = s.players.find((p) => p.id === s.me.id)?.avatar;
  const capacity = Math.max(s.players.length, s.room.settings.capacity);
  const restore = s.room.restore;
  const seat = (p) => h('div', { class: `seat filled${p.id === s.me.id ? ' me' : ''}` },
    h('div', { class: 'portrait' }, lookThumb(p.avatar, 3) ?? h('span', { class: 'dot', style: `background:${p.color}` })),
    h('strong', {}, p.nickname, p.id === s.me.id ? ' (나)' : ''),
    h('div', { class: 'seat-tags' },
      p.isHost ? h('span', { class: 'tag tag--brass' }, '방장') : h('span', { class: `tag ${p.ready ? 'tag--teal-l' : 'tag--paper2'}` }, p.ready ? '준비 완료' : '준비 전'),
      p.team && teamName(p.team) ? h('span', { class: 'tag tag--sky' }, teamName(p.team)) : null,
      p.connected ? null : h('span', { class: 'tag tag--rose' }, '연결 끊김')));
  // while friends can still come in, an empty seat hands out the invite link
  const open = !s.room.settings.solo && !s.room.settings.locked;
  const emptySeat = (name) => h(open ? 'button' : 'div', { class: 'seat empty', ...(open ? { type: 'button', onclick: () => invite(link), title: '초대 링크 복사' } : {}) },
    h('div', { class: 'portrait' }, icon('user')), name ? h('strong', {}, name) : null, h('span', { class: 'muted' }, name ? '이 자리 비어 있음' : '친구 대기 중'),
    open ? h('span', { class: 'tag tag--teal-l' }, icon('link'), '초대 링크 복사') : null);
  const seatList = restore
    ? restore.seats.map((x) => {
        const p = s.players.find((pl) => pl.id === x.id);
        return p ? seat(p) : emptySeat(`${x.nickname}의 자리`);
      })
    : [...s.players.map(seat), ...Array.from({ length: Math.max(0, capacity - s.players.length) }, () => emptySeat())];
  const caseIndex = Math.max(0, (lobbyCases ?? []).findIndex((c) => c.id === s.case?.id));
  const st = s.room.settings;
  const lookIndex = looks ? looks.characters.findIndex((c) => c.id === mine) : -1;
  const unread = Math.max(0, s.chat.length - lobbyChatSeen);
  // the right column: what is changed now and then, folded to one line each (one open at a time)
  const drawers = drawerGroup([
    looks ? {
      id: 'looks',
      title: '내 탐정 외형',
      summary: lookIndex >= 0 ? `외형 ${lookIndex + 1}` : '아직 고르지 않음',
      body: () => [
        h('p', { class: 'muted small' }, '외형은 모습만 바뀌어요. 능력이나 역할 차이는 없고, 다른 사람과 같은 외형도 고를 수 있어요.'),
        h('div', { class: 'look-picker' }, ...looks.characters.map((c, i) => h('button', {
          class: `look${mine === c.id ? ' selected' : ''}`,
          title: `외형 ${i + 1}`,
          'aria-pressed': mine === c.id ? 'true' : 'false',
          'aria-label': `외형 ${i + 1}`,
          onclick: () => act('chooseAvatar', { avatar: c.id }),
        }, lookThumb(c.id, 3)))),
      ],
    } : null,
    {
      id: 'case',
      title: '사건',
      summary: s.case ? s.case.title : '아직 고르지 않음',
      body: () => [
        s.case ? caseSheet(s.case, { index: caseIndex, compact: true }) : h('p', { class: 'muted' }, isHost ? '사건 파일을 골라 주세요.' : '방장이 사건 파일을 고르고 있어요.'),
        isHost && !restore ? h('div', { class: 'row' }, h('button', { type: 'button', class: s.case ? '' : 'primary', onclick: casePickerModal }, s.case ? '사건 바꾸기' : '사건 고르기')) : null,
        s.case && isHost && lobbyCases?.some((c) => c.id === s.case.id && c.version !== s.case.version)
          ? h('p', { class: 'muted small' }, `이 방은 v${s.case.version}로 고정돼 있어요. 최신 버전으로 바꾸려면 파일을 다시 고르세요.`)
          : null,
      ],
    },
    {
      id: 'settings',
      title: '방 설정',
      summary: `${DIFFICULTY[st.difficulty ?? 'guide'].name} · ${st.capacity}명 · 채팅 ${st.chat ? '켬' : '끔'}${st.locked && !st.solo ? ' · 잠김' : ''}`,
      body: () => roomSettingsCard(),
    },
    st.chat ? {
      id: 'chat',
      title: '팀 채팅',
      summary: unread ? `새 메시지 ${unread}` : s.chat.length ? `메시지 ${s.chat.length}` : '아직 조용해요',
      body: () => {
        lobbyChatSeen = s.chat.length;
        lobbyChatBox = h('div', { class: 'lobby-chat' });
        renderChat(lobbyChatBox);
        return lobbyChatBox;
      },
    } : null,
  ].filter(Boolean), { open: isHost && !s.case ? 'case' : looks && !isHost ? 'looks' : 'case', remember: s.room.code, onToggle: () => render() });
  return h('div', { class: 'lobby-two' },
    h('section', { class: 'lobby' },
      h('span', { class: 'tag tag--rose' }, restore ? '저장 파일에서 이어하기' : s.room.settings.solo ? '단독 수사' : '수사본부'),
      // the host names the headquarters right here (also under 방 설정)
      h('div', { class: 'row wrap lobby-title' }, h('h2', {}, s.room.settings.name),
        isHost ? h('button', { type: 'button', class: 'small', onclick: renameRoom, 'aria-label': '수사본부 이름 짓기' }, '이름 짓기') : null),
      h('p', {}, s.case ? s.case.title : '방장이 사건 파일을 고르고 있어요.'),
      h('div', { class: 'metadata' },
        h('span', { class: 'tag tag--sky' }, icon('users'), `참가 ${s.players.length}/${capacity}명`),
        s.room.settings.solo ? h('span', { class: 'tag tag--teal-l' }, icon('door'), '혼자 하는 방') : h('span', { class: 'tag tag--teal-l' }, icon('check'), `준비 ${readyCount}/${others.length}`),
        s.case ? h('span', { class: 'tag tag--brass-l' }, `권장 ${playersText(s.case.players)}`) : null,
        restore ? h('span', { class: 'tag tag--rose' }, '저장 파일에서 이어하기') : null,
        s.room.settings.locked && !s.room.settings.solo ? h('span', { class: 'tag tag--rose' }, '새 참가 잠김') : null),
      s.room.settings.solo ? null : h('div', { class: 'stack tight lobby-invite' },
        h('span', { class: 'field' }, '초대 링크 — 친구에게 보내 주세요'),
        h('div', { class: 'row' }, h('code', { class: 'invite' }, link), h('button', { type: 'button', class: 'small primary', onclick: () => invite(link) }, icon('link'), canShare() ? '보내기' : '링크 복사'))),
      h('div', { class: 'seats' }, ...seatList),
      teamPicker(),
      restore ? h('p', { class: 'muted small' }, '저장 파일의 자리마다 한 명씩 들어와요. 친구는 초대 링크로 들어와 자기 자리를 골라요. 비어 있는 자리는 시작할 때 빠지고, 그 자리의 공유하지 않은 단서는 다시 찾을 수 있게 돼요.') : null,
      s.room.settings.solo
        ? h('p', { class: 'muted small' }, '다른 사람은 들어올 수 없어요. 여럿이 함께 해야 하는 장치는 혼자서도 풀 수 있게 바뀌어요. 예: 동시에 밟아야 하는 발판은 하나씩 밟아 불을 켜면 열려요.')
        : null),
    drawers,
  );
}

// the lobby's chat drawer borrows the chat panel; render() hands it back elsewhere
let lobbyChatBox = null;
let lobbyChatSeen = 0;

// Choosing the case in a window (the host, in the lobby): search by title, one press picks it.
function casePickerModal() {
  const s = state;
  const all = (lobbyCases ?? []).map((c, i) => [c, i]).filter(([c]) => !s.room.settings.solo || c.solo);
  let words = '';
  const list = h('nav', { class: 'case-list picker__list', 'aria-label': '사건 파일철' });
  const draw = () => {
    const shown = all.filter(([c]) => !words || `${c.title} ${c.summary ?? ''}`.includes(words));
    list.replaceChildren(...(shown.length ? shown.map(([c, i]) => caseFolder(c, { index: i, selected: s.case?.id === c.id && s.case?.version === c.version, onOpen: async () => {
      await act('selectCase', { caseId: c.id });
      closeModal();
    } })) : [h('p', { class: 'muted' }, '맞는 사건이 없어요.')]));
  };
  const search = h('input', { type: 'search', placeholder: '사건 이름으로 찾기', 'aria-label': '사건 찾기', oninput: (e) => ((words = e.target.value.trim()), draw()) });
  draw();
  openModal(h('p', { class: 'eyebrow' }, '사건 파일철'), h('h3', {}, s.case ? '사건 바꾸기' : '사건 고르기'), h('div', { class: 'row picker__tools' }, search), list,
    h('div', { class: 'row end' }, h('button', { type: 'button', onclick: closeModal }, '닫기')));
  search.focus();
}

// Room settings: the host edits them, everyone else sees them.
function roomSettingsCard() {
  const st = state.room.settings;
  if (!state.me.isHost) {
    return h('div', { class: 'card room-settings' }, h('h3', {}, '방 설정'),
      h('p', { class: 'small' }, `방 이름: ${st.name} · 정원 ${st.capacity}명 · 난이도 ${DIFFICULTY[st.difficulty ?? 'guide'].name} · 채팅 ${st.chat ? '켜짐' : '꺼짐'} · 새 참가 ${st.locked ? '잠김' : '열림'}`),
      h('p', { class: 'muted small' }, '방 설정은 방장이 바꿀 수 있어요.'));
  }
  const toggle = (key, label, hint) => h('label', { class: 'check' },
    h('input', { type: 'checkbox', checked: st[key], onchange: (e) => act('updateSettings', { settings: { [key]: e.target.checked } }) }),
    h('span', {}, label, h('span', { class: 'muted small' }, hint)));
  return h('div', { class: 'card room-settings' },
    h('div', { class: 'row' }, h('h3', { class: 'grow' }, '방 설정'), h('button', { class: 'small', onclick: renameRoom }, '이름 짓기')),
    h('p', { class: 'small' }, `방 이름: ${st.name}`),
    capacityField(st),
    segmented('난이도', Object.fromEntries(Object.entries(DIFFICULTY).map(([k, d]) => [k, d.name])), st.difficulty ?? 'guide', (k) => act('updateSettings', { settings: { difficulty: k } })),
    h('p', { class: 'muted small' }, DIFFICULTY[st.difficulty ?? 'guide'].text),
    h('div', { class: 'stack tight' },
      toggle('chat', '채팅 사용', ' — 게임 중에도 바꿀 수 있어요'),
      st.solo ? h('p', { class: 'muted small' }, '혼자 하는 방이라 다른 사람은 들어올 수 없어요.') : toggle('locked', '새 참가 잠금', ' — 지금 있는 사람만 함께해요')),
    h('button', { class: 'small danger', onclick: deleteRoom }, '방 삭제'));
}

// The host picks the room size (1~8) in the lobby. The case only suggests one.
function capacityField(st) {
  const c = state.case;
  const fixed = st.solo || state.room.restore || state.room.stage !== 'lobby';
  const select = h('select', {
    'aria-label': '정원',
    disabled: Boolean(fixed),
    onchange: async (e) => {
      const res = await act('updateSettings', { settings: { capacity: Number(e.target.value) } }, { quiet: true });
      if (res.status !== 200) {
        toast(errorText(res), 'error');
        memo.delete($('stage'));
        render();
      }
    },
  }, ...Array.from({ length: 8 }, (_, i) => h('option', { value: i + 1, selected: st.capacity === i + 1 }, `${i + 1}명${c && i + 1 >= c.players.min && i + 1 <= c.players.max ? ' (권장)' : ''}`)));
  const why = st.solo ? '혼자 하는 방이에요.' : state.room.restore ? '저장 파일의 인원으로 정해져 있어요.' : c && st.capacity < c.players.min
    ? (c.solo ? '권장보다 적어요. 여럿이 함께 하는 장치는 하나씩 켜는 방식으로 바뀌어요.' : `이 사건은 ${c.players.min}명 이상이 함께해야 시작할 수 있어요.`)
    : c && st.capacity > c.players.max ? '권장보다 많아요. 단서를 나눠 찾게 돼요.' : '';
  return h('div', { class: 'stack tight' }, h('label', { class: 'field' }, '정원', select), why ? h('span', { class: `small ${c && st.capacity < c.players.min && !c.solo ? 'warn' : 'muted'}` }, why) : null);
}

function renameRoom() {
  const input = h('input', { maxlength: 20, value: state.room.settings.name, 'aria-label': '방 이름' });
  openModal(h('form', { class: 'stack', onsubmit: async (e) => {
    e.preventDefault();
    const res = await act('updateSettings', { settings: { name: input.value } }, { quiet: true });
    if (res.status === 200) closeModal();
    else toast(errorText(res), 'error');
  } }, h('h3', {}, '수사본부 이름 짓기'), input,
    h('div', { class: 'row end' }, h('button', { type: 'button', class: 'ghost', onclick: closeModal }, '취소'), h('button', { class: 'primary', type: 'submit' }, '저장'))));
}

// Briefing text: one paragraph per line, a gap for a blank line, and a line that opens with a
// quotation mark is a character speaking.
function storyLines(text) {
  return String(text ?? '').split('\n').map((line) => {
    const t = line.trim();
    if (!t) return h('div', { class: 'gap', 'aria-hidden': 'true' });
    return h('p', { class: `body${/^["“‘「]/.test(t) ? ' quote' : ''}` }, t);
  });
}

function introView() {
  const c = state.case;
  return h('article', { class: 'case-sheet intro-sheet' },
    h('span', { class: 'tag tag--brass' }, `사건 브리핑 · v${c.version}`),
    h('h2', {}, c.title),
    c.coverUrl ? h('img', { src: c.coverUrl, alt: `${c.title} 표지`, class: 'cover' }) : null,
    // the case's opening scene (briefing-anim.js), picked by its theme; none for a theme without one
    briefingAnim(c.theme),
    ...storyLines(c.intro),
    briefingView(),
    h('p', { class: 'muted' }, `게임은 5일 동안 진행돼요. 낮에는 맵을 돌아다니며 조사하고, 밤에는 공동 보드에서 정리해요. 예상 플레이 시간 ${c.estimatedMinutes.min}~${c.estimatedMinutes.max}분.`),
  );
}

function nightView() {
  return boardView({ wide: true });
}

const solo = () => Boolean(state?.room.settings?.solo);

// Each player's own vote beside the team answer: who backs which option, and whether the team agrees.
function voteChips(q, o) {
  if (solo()) return null;
  const votes = state.final.votes ?? {};
  const who = state.players.filter((p) => votes[p.id]?.[q.id] === o.id);
  return who.length ? h('span', { class: 'votes' }, ...who.map((p) => h('span', { class: 'vote', style: `border-color:${p.color}`, title: p.nickname }, p.nickname))) : null;
}

function voteBar(q) {
  if (solo()) return null;
  const votes = state.final.votes ?? {};
  const mine = votes[state.me.id]?.[q.id] ?? null;
  const cast = new Set(state.players.map((p) => votes[p.id]?.[q.id]).filter(Boolean));
  const vote = h('select', { 'aria-label': '내 표', onchange: (e) => act('finalVote', { questionId: q.id, optionId: e.target.value || null }) },
    h('option', { value: '' }, '내 표 없음'), ...q.options.map((o) => h('option', { value: o.id, selected: mine === o.id }, o.label)));
  return h('div', { class: 'vote-bar' }, h('label', { class: 'small' }, '내 생각 ', vote), cast.size > 1 ? h('span', { class: 'tag tag--rose' }, '의견이 갈려요 · 이야기해 보세요') : null);
}

function finalView() {
  const f = state.final;
  const isHost = state.me.isHost;
  const answers = f.draft.answers;
  const evidence = f.draft.evidence ?? {};
  const proofOk = (q) => !q.pick || (evidence[q.id]?.length ?? 0) === q.pick;
  const complete = f.questions.every((q) => answers[q.id] && proofOk(q));
  const save = async (next) => {
    const res = await act('finalDraft', { baseRev: f.draft.rev, answers, evidence, ...next }, { quiet: true });
    if (res.status === 409) toast('다른 사람이 먼저 답안을 바꿨어요. 최신 답안을 보여 드릴게요.', 'notice');
    else if (res.status !== 200) toast(errorText(res), 'error');
  };
  const pick = (qid, oid) => save({ answers: { ...answers, [qid]: oid } });
  // a card toggles; when the question already has its cards, the oldest one makes room
  const prove = (q, clueId) => {
    const now = evidence[q.id] ?? [];
    const next = now.includes(clueId) ? now.filter((c) => c !== clueId) : [...now, clueId].slice(-q.pick);
    save({ evidence: { ...evidence, [q.id]: next } });
  };
  const cards = state.board.clues;
  const clueName = (id) => cards.find((c) => c.id === id)?.name ?? '-';
  const submit = () => {
    const summary = h('ul', {}, ...f.questions.map((q) => h('li', {}, `${q.prompt} → ${q.options.find((o) => o.id === answers[q.id])?.label}`,
      q.pick ? h('span', { class: 'muted' }, ` (근거: ${(evidence[q.id] ?? []).map(clueName).join(', ')})`) : null)));
    confirmModal('최종 답안을 제출할까요?', h('div', {}, summary, h('p', { class: 'warn' }, '제출하면 답안을 바꿀 수 없어요.')), '제출하기', async () => {
      const res = await act('finalSubmit', { rev: f.draft.rev }, { quiet: true });
      if (res.status !== 200) toast(errorText(res), 'error');
    });
  };
  const missing = f.questions.filter((q) => !answers[q.id]).length;
  const unproved = f.questions.filter((q) => answers[q.id] && !proofOk(q)).length;
  // one question a page, then a page that checks them all (docs/ui-onescreen-spec.md 5.6)
  const n = f.questions.length;
  finalPage = Math.min(finalPage, n);
  finalNav = { pages: n + 1, submit: isHost && complete ? submit : null, blocked: complete ? null : missing ? `${missing}문항 남음` : `근거 부족 ${unproved}문항` };
  const votes = f.votes ?? {};
  const split = (q) => !solo() && new Set(state.players.map((p) => votes[p.id]?.[q.id]).filter(Boolean)).size > 1;
  const strip = pageStrip([...f.questions.map((_, i) => String(i + 1)), '확인'], finalPage, (i) => goFinalPage(i),
    { marks: [...f.questions.map((q) => Boolean(answers[q.id] && proofOk(q))), complete], flags: [...f.questions.map(split), false] });
  const question = (q, i) => h('fieldset', { class: 'question' },
    h('legend', {}, `${i + 1} / ${n}  ${q.prompt}`),
    ...q.options.map((o) => h('label', { class: `option${answers[q.id] === o.id ? ' chosen' : ''}` },
      h('input', { type: 'radio', name: q.id, checked: answers[q.id] === o.id, onchange: () => pick(q.id, o.id) }), o.label, voteChips(q, o))),
    voteBar(q),
    q.pick ? h('div', { class: 'proof' },
      h('div', { class: 'proof__head' }, h('strong', {}, '근거 카드'), h('span', { class: 'chip' }, `${evidence[q.id]?.length ?? 0}/${q.pick}`), h('span', { class: 'muted small' }, `이 답을 증명하는 단서 ${q.pick}장을 골라요`)),
      h('div', { class: 'proof__cards' },
        ...(evidence[q.id] ?? []).map((id) => h('span', { class: 'proof-card is-on' }, clueName(id), h('button', { type: 'button', class: 'proof-card__x', 'aria-label': `${clueName(id)} 빼기`, onclick: () => prove(q, id) }, '✕'))),
        cards.length
          ? h('button', { type: 'button', class: 'small', onclick: () => cardPicker(q, evidence[q.id] ?? [], (id) => prove(q, id)) }, (evidence[q.id]?.length ?? 0) ? '근거 바꾸기' : '근거 고르기')
          : h('p', { class: 'muted small' }, '공동 보드에 단서가 있어야 근거로 고를 수 있어요.'))) : null);
  const review = () => h('div', { class: 'stack' },
    h('h3', {}, '답안 확인'),
    h('ol', { class: 'final-review' }, ...f.questions.map((q, i) => h('li', {},
      h('button', { type: 'button', class: 'linkish', onclick: () => goFinalPage(i) }, q.prompt),
      h('div', {}, answers[q.id] ? `→ ${q.options.find((o) => o.id === answers[q.id])?.label}` : h('span', { class: 'warn' }, '아직 답하지 않았어요')),
      q.pick ? h('div', { class: `small ${proofOk(q) ? 'muted' : 'warn'}` }, `근거: ${(evidence[q.id] ?? []).map(clueName).join(', ') || '없음'} (${evidence[q.id]?.length ?? 0}/${q.pick})`) : null))),
    isHost
      ? h('p', { class: complete ? 'muted' : 'warn' }, complete ? '모두 답했어요. 아래 막대의 ‘최종 제출’로 제출해요.' : missing ? '모든 문항에 답해야 제출할 수 있어요.' : `근거 카드를 다 고르지 않은 문항이 ${unproved}개 있어요.`)
      : h('p', { class: 'muted' }, '답이 정해지면 방장이 확인하고 제출해요.'));
  return h('div', { class: 'sheet final-sheet' },
    h('div', { class: 'row wrap' }, h('span', { class: 'tag tag--crim' }, '최종 추리'),
      h('span', { class: 'muted small' }, solo()
        ? '답을 고르고, 근거를 묻는 문항에는 그 답을 뒷받침하는 단서 카드도 골라 주세요.'
        : f.draft.updatedBy ? `마지막 수정: ${playerName(f.draft.updatedBy)} (${ago(f.draft.updatedAt)})` : '아직 아무도 답을 고르지 않았어요. 누구나 답을 고를 수 있어요.')),
    strip,
    finalPage < n ? question(f.questions[finalPage], finalPage) : review(),
  );
}

// the open page of the final deduction (a question, or the last page that checks them all)
let finalPage = 0;
let finalNav = null;
function goFinalPage(i) {
  if (!finalNav) return false;
  const next = Math.max(0, Math.min(finalNav.pages - 1, i));
  if (next === finalPage) return false;
  finalPage = next;
  render();
  $('stage')?.scrollIntoView?.({ block: 'nearest' });
  document.querySelector('.scene-col')?.scrollTo?.({ top: 0 });
  return true;
}

// Choosing proof cards for one question in a window: search by words, narrow by kind or by who said it.
function cardPicker(q, chosen, toggle) {
  const cards = state.board.clues;
  let words = '';
  let kind = 'all';
  let who = 'all';
  let picked = [...chosen];
  const speakers = [...new Set(cards.map((c) => c.speaker).filter(Boolean))];
  const list = h('div', { class: 'picker__list', role: 'list' });
  const count = h('span', { class: 'chip' });
  const draw = () => {
    const shown = cards.filter((c) => (kind === 'all' || c.kind === kind) && (who === 'all' || c.speaker === who)
      && (!words || `${c.name} ${c.description} ${c.speaker ?? ''} ${c.time ?? ''}`.includes(words)));
    count.textContent = `${picked.length}/${q.pick}`;
    list.replaceChildren(...(shown.length ? shown.map((c) => {
      const on = picked.includes(c.id);
      return h('button', { type: 'button', role: 'listitem', class: `picker__card${on ? ' is-on' : ''}`, 'aria-pressed': on ? 'true' : 'false', onclick: () => {
        picked = on ? picked.filter((x) => x !== c.id) : [...picked, c.id].slice(-q.pick);
        toggle(c.id);
        draw();
      } },
      h('span', { class: 'eyebrow' }, [kindLabel(c.kind), c.time, c.speaker].filter(Boolean).join(' · ')),
      h('strong', {}, c.name),
      h('span', { class: 'muted small clamp' }, c.description));
    }) : [h('p', { class: 'muted' }, '맞는 카드가 없어요.')]));
  };
  const search = h('input', { type: 'search', placeholder: '이름·내용·사람·시각으로 찾기', 'aria-label': '근거 카드 찾기', oninput: (e) => ((words = e.target.value.trim()), draw()) });
  const kindSel = h('select', { 'aria-label': '종류', onchange: (e) => ((kind = e.target.value), draw()) },
    h('option', { value: 'all' }, '모든 종류'), h('option', { value: 'evidence' }, '증거'), h('option', { value: 'testimony' }, '증언'), h('option', { value: 'deduction' }, '추론'));
  const whoSel = h('select', { 'aria-label': '인물', onchange: (e) => ((who = e.target.value), draw()) },
    h('option', { value: 'all' }, '모든 인물'), ...speakers.map((s) => h('option', { value: s }, s)));
  draw();
  openModal(
    h('p', { class: 'eyebrow' }, '근거 카드'),
    h('h3', {}, q.prompt),
    h('div', { class: 'row picker__tools' }, search, kindSel, whoSel, count),
    list,
    h('div', { class: 'row end' }, h('button', { class: 'primary', onclick: closeModal }, '다 골랐어요')),
  );
  search.focus();
}

function resultView() {
  const r = state.final.result;
  const q = state.final.questions;
  const label = (qid, oid) => q.find((x) => x.id === qid)?.options.find((o) => o.id === oid)?.label ?? '-';
  const mark = (ok) => h('span', { class: `mark mark--${ok ? 'ok' : 'bad'}`, role: 'img', 'aria-label': ok ? '맞음' : '틀림' });
  // three pages: the summary, each question (folded), the story (docs/ui-onescreen-spec.md 5.7)
  resultNav = { pages: 3 };
  resultPage = Math.min(resultPage, 2);
  const tile = (big, small) => h('div', { class: 'result-tile' }, h('strong', {}, big), h('span', { class: 'muted small' }, small));
  const summary = () => h('div', { class: 'result-tiles' },
    tile(`${r.correct} / ${r.total}`, '정답'),
    r.proofTotal ? tile(`${r.proved} / ${r.proofTotal}`, '근거까지 맞힌 문항') : null,
    r.statements?.total ? tile(`${r.statements.matched} / ${r.statements.total}`, `진술 판정 일치${r.statements.judged < r.statements.total ? ` (판정 ${r.statements.judged})` : ''}`) : null,
    r.stats ? tile(`${r.stats.clues} / ${r.stats.clueTotal}`, '모은 단서') : null,
    r.stats?.minutes ? tile(`${r.stats.minutes}분`, '걸린 시간') : null,
    r.stats ? tile(`${r.stats.hints ?? 0}번`, `힌트 · 난이도 ${DIFFICULTY[r.stats.difficulty]?.name ?? '입문'}`) : null);
  const perQuestion = () => drawerGroup(r.questions.map((x, i) => ({
    id: x.id,
    title: `${i + 1}번 ${x.correct ? '✓' : '✗'}${x.evidence ? ` 근거 ${x.evidence.proved ? '✓' : '✗'}` : ''}`,
    summary: x.prompt,
    body: () => [
      h('strong', { class: 'result-row__head' }, mark(x.correct), x.prompt),
      h('div', {}, `${solo() ? '내 답' : '우리 답'}: ${label(x.id, x.chosen)}`),
      x.correct ? null : h('div', {}, `정답: ${label(x.id, x.answer)}`),
      !x.correct && !solo() ? (() => {
        const right = state.players.filter((p) => (state.final.votes ?? {})[p.id]?.[x.id] === x.answer);
        return right.length ? h('div', { class: 'small' }, `${right.map((p) => p.nickname).join(', ')}님은 정답에 표를 던졌어요.`) : null;
      })() : null,
      x.evidence ? h('div', { class: 'result-proof' }, mark(x.evidence.proved),
        `근거: ${x.evidence.chosen.map((c) => c.name).join(', ') || '-'}`,
        x.evidence.proved ? null : h('span', { class: 'muted' }, ` · 인정되는 근거: ${x.evidence.accepted.map((c) => c.name).join(', ')}`)) : null,
      x.explanation ? h('p', { class: 'muted' }, x.explanation) : null,
    ],
  })), { open: r.questions.find((x) => !x.correct)?.id ?? null, remember: `${state.room.code}:result` });
  const story = () => h('div', { class: 'stack' },
    h('p', { class: 'pre' }, r.explanation),
    h('button', { type: 'button', class: 'px', onclick: playEnding }, '엔딩 다시 보기'));
  return h('div', { class: 'sheet result-sheet' },
    h('div', { class: 'row wrap' }, h('span', { class: 'tag tag--brass' }, '수사 종료'), h('h2', { class: 'score' }, `${r.correct} / ${r.total} 정답`)),
    pageStrip(['요약', '문항별', '해설'], resultPage, (i) => goResultPage(i), { marks: [] }),
    [summary, perQuestion, story][resultPage](),
  );
}

let resultPage = 0;
let resultNav = null;
function goResultPage(i) {
  if (!resultNav) return false;
  const next = Math.max(0, Math.min(resultNav.pages - 1, i));
  if (next === resultPage) return false;
  resultPage = next;
  render();
  document.querySelector('.scene-col')?.scrollTo?.({ top: 0 });
  return true;
}
// the arrow keys turn whichever pages the stage shows
onPageKeys((d) => (state?.room.stage === 'final' ? goFinalPage(finalPage + d) : state?.room.stage === 'result' ? goResultPage(resultPage + d) : false));

// ---------- side tabs ----------

function renderTabs() {
  const names = { players: '참가자', notebook: '내 수첩', board: '공동 보드', people: '인물', saves: '설정·저장', notices: '알림' };
  renderInto($('tabs'), JSON.stringify([visibleTabs(), tab]), () => visibleTabs().map((t) => h('button', { class: t === tab ? 'active' : '', 'aria-pressed': t === tab ? 'true' : 'false', onclick: () => ((tab = t), render()) }, names[t])));
  const body = $('tabBody');
  if (tab === 'players') renderInto(body, JSON.stringify([state.players, state.me, state.room.stage]), playersView);
  if (tab === 'notebook') renderInto(body, JSON.stringify([state.notebook, notebookTab, activeClue, state.hints, hintsOn]), notebookView);
  if (tab === 'board') renderInto(body, JSON.stringify([state.board, state.players, Math.floor(Date.now() / 60000)]), () => boardView({}));
  if (tab === 'notices') renderInto(body, JSON.stringify(state.notices), noticesView);
  if (tab === 'saves') renderInto(body, JSON.stringify([state.room.saves, state.room.stage, state.me.isHost, Math.floor(Date.now() / 60000), textSpeed, touchpadMode, hintsOn, hudLook, a11y.text, a11y.pictures]), () => [settingsView(), savesView()]);
  if (tab === 'people') renderInto(body, JSON.stringify(state.characters), peopleView);
}

function playersView() {
  const s = state;
  return h('ul', { class: 'players' }, ...s.players.map((p) => h('li', {},
    h('span', { class: 'avatar-slot', style: `border-color:${p.color}` }, lookThumb(p.avatar, 1) ?? h('span', { class: 'dot', style: `background:${p.color}` })),
    h('div', { class: 'grow' },
      h('div', {}, h('strong', {}, p.nickname), p.id === s.me.id ? ' (나)' : '', p.isHost ? h('span', { class: 'chip host' }, '방장') : null, p.team && teamName(p.team) ? h('span', { class: 'chip' }, teamName(p.team)) : null),
      h('div', { class: 'muted small' },
        h('span', { class: p.connected ? 'online' : 'offline' }, p.connected ? '● 연결됨' : '○ 연결 끊김'),
        p.ready ? ' · 준비 완료' : '',
        p.locationName ? ` · ${p.locationName}` : '')),
    s.me.isHost && p.id !== s.me.id && p.connected ? h('button', { class: 'small ghost', onclick: () => confirmModal('방장 넘기기', `${p.nickname}님에게 방장을 넘길까요?`, '넘기기', () => act('transferHost', { playerId: p.id })) }, '방장 넘기기') : null,
    s.me.isHost && s.room.stage === 'lobby' && !p.connected ? h('button', { class: 'small ghost', onclick: () => act('kick', { playerId: p.id }) }, '내보내기') : null)),
    h('li', { class: 'muted small aside' }, '방장의 연결이 30초 넘게 끊기면 먼저 들어온 연결된 참가자가 방장이 돼요.'));
}

// People the team has spoken with, with their public introductions only.
function peopleView() {
  return h('ul', { class: 'entries' }, ...state.characters.map((c) => h('li', { class: 'entry person' },
    c.sprite ? spriteThumb(c.sprite.url, c.sprite.animations.idle.frames[0], c.sprite.frameSize, 2) : null,
    h('div', { class: 'grow' }, h('div', {}, h('strong', {}, c.name), ' ', h('span', { class: 'muted small' }, c.role)), h('p', { class: 'small' }, c.intro)))),
    h('li', { class: 'muted small aside' }, '대화를 나눈 인물이 여기에 기록돼요.'));
}

// ---------- hints ----------
// Who a clue matters to, worked out by the server from the case's dialogue (engine/hints.js).
const HINT_TEXT = {
  show: (x) => `${x.who}에게 보여 주세요 · ${x.place}`,
  ask: (x) => `${x.who}에게 새 질문이 생겼어요 · ${x.place}`,
  share: (x) => `공동 보드에 공유하면 ${x.who}에게 물어볼 것이 생겨요`,
  react: (x) => `${x.who}도 이 단서에 대해 할 말이 있어요 · ${x.place}`,
  combine: () => '수첩이나 공동 보드에 이 단서와 겹쳐 볼 짝이 있어요 · 다른 단서와 겹쳐 보기',
};
// clues with a conclusion card still to be made from them (the pair is not named)
const hasPair = (clueId) => hintsFor(clueId).some((x) => x.kind === 'combine');
const hintsFor = (clueId) => (hintsOn ? state.hints?.clues?.[clueId] ?? [] : []);
// a card gets a mark only for hints that move things on
const strongHint = (clueId) => hintsFor(clueId).some((x) => x.kind !== 'react');

function hintLines(clueId) {
  const list = hintsFor(clueId);
  if (!list.length) return null;
  return h('ul', { class: 'hints', 'aria-label': '힌트' }, ...list.map((x) => h('li', { class: `hint hint--${x.kind}` }, HINT_TEXT[x.kind](x))));
}

// ---------- evidence pictures ----------
// A clue with a picture (a photo, a plan) shows it large, and can be laid next to another picture
// the player can see, since the cases turn on comparing two images.
const seeable = () => {
  const all = new Map();
  for (const c of [...(state.notebook?.clues ?? []), ...(state.board?.clues ?? [])]) if (c.imageUrl) all.set(c.id, c);
  return [...all.values()];
};

function evidencePicture(c) {
  if (!c.imageUrl) return null;
  const others = seeable().filter((x) => x.id !== c.id);
  // pictures with something to find: point at it, and the server says whether anything is there
  const found = (state.notebook?.log ?? []).filter((l) => l.key?.startsWith(`spot:${c.id}:`));
  const img = h('img', { src: c.imageUrl, alt: `${c.name} 그림`, class: c.spots ? 'is-spottable' : '' });
  if (c.spots) {
    img.addEventListener('click', async (e) => {
      if (!img.naturalWidth) return toast('그림을 불러오는 중이에요. 잠시 뒤에 다시 눌러 주세요.', 'info');
      const r = img.getBoundingClientRect();
      const x = Math.floor(((e.clientX - r.left) / r.width) * img.naturalWidth);
      const y = Math.floor(((e.clientY - r.top) / r.height) * img.naturalHeight);
      const res = await act('spot', { clueId: c.id, x, y }, { quiet: true });
      if (res.status !== 200) return toast(errorText(res), 'error');
      if (!res.body.found) return toast('여기에는 눈에 띄는 것이 없어요.', 'info');
      toast(res.body.fresh ? `관찰 메모: ${res.body.found}` : `이미 적어 둔 곳이에요: ${res.body.found}`, res.body.fresh ? 'good' : 'info');
    });
  }
  return h('figure', { class: 'evidence-pic' },
    img,
    h('figcaption', {},
      c.spots ? h('span', { class: 'muted small' }, '그림에서 눈여겨볼 곳을 눌러 보세요.') : null,
      found.length ? h('ul', { class: 'spot-notes' }, ...found.map((l) => h('li', {}, l.text))) : null,
      others.length ? h('button', { type: 'button', class: 'small', onclick: () => compareView(c) }, '다른 그림과 나란히 보기') : null));
}

// Two clues laid together: the case knows which pairs make a conclusion card.
function combineView(c) {
  const all = new Map();
  for (const x of [...(state.notebook?.clues ?? []), ...(state.board?.clues ?? [])]) if (x.id !== c.id) all.set(x.id, x);
  openModal(
    h('p', { class: 'eyebrow' }, '단서 겹쳐 보기'),
    h('h3', {}, `‘${c.name}’과 함께 볼 단서`),
    h('p', { class: 'muted small' }, '두 단서가 함께 말해 주는 것이 있으면 추론 카드가 생겨요.'),
    hasPair(c.id) ? h('p', { class: 'small hint hint--combine' }, '힌트: ‘짝 있음’이 붙은 단서 가운데 이 단서와 이어지는 것이 있어요.') : null,
    h('div', { class: 'picker__list' }, ...[...all.values()].map((x) => h('button', { type: 'button', class: 'picker__card', onclick: async () => {
      const res = await act('combine', { a: c.id, b: x.id }, { quiet: true });
      if (res.status !== 200) return toast(errorText(res), 'error');
      if (!res.body.made) return toast(res.body.reaction, 'info');
      closeModal();
      toast(res.body.already ? '이미 만든 추론이에요.' : '새 추론 카드를 수첩에 넣었어요.', res.body.already ? 'info' : 'good');
    } }, h('span', { class: 'eyebrow' }, kindLabel(x.kind), hasPair(c.id) && hasPair(x.id) ? h('span', { class: 'tag tag--brass-l pair-tag' }, '짝 있음') : null), h('strong', {}, x.name)))),
    h('div', { class: 'row end' }, h('button', { onclick: closeModal }, '닫기')),
  );
}

function compareView(a, b = null) {
  const others = seeable().filter((x) => x.id !== a.id);
  const other = b ?? others[0];
  const pick = h('select', { 'aria-label': '나란히 볼 그림', onchange: (e) => compareView(a, others.find((x) => x.id === e.target.value)) },
    ...others.map((x) => h('option', { value: x.id, selected: x.id === other.id }, x.name)));
  openModal(
    h('p', { class: 'eyebrow' }, '증거 비교'),
    h('div', { class: 'compare' }, ...[a, other].map((x) => h('figure', { class: 'evidence-pic' }, h('img', { src: x.imageUrl, alt: `${x.name} 그림` }), h('figcaption', {}, x.name)))),
    h('label', { class: 'field' }, '오른쪽에 놓을 그림', pick),
    h('div', { class: 'row end' }, h('button', { onclick: closeModal }, '닫기')),
  );
}

function clueDetail(c, extra) {
  openModal(
    h('p', { class: 'eyebrow' }, kindLabel(c.kind)),
    h('h3', {}, c.name),
    c.time ? h('p', { class: 'muted small' }, `${c.day ? `${c.day}일 ` : ''}${c.time}`) : null,
    evidencePicture(c),
    c.speaker ? h('p', { class: 'muted' }, `말한 사람: ${c.speaker}`) : null,
    h('p', { class: 'pre' }, c.description),
    hintLines(c.id),
    extra,
    h('div', { class: 'row end' }, h('button', { onclick: closeModal }, '닫기')),
  );
}

// Choosing a card opens its detail under the grid; sharing stays a separate press.
// Tapping a card opens its details right under that card's row; tapping it again closes them.
function openClue(c) {
  markSeen(c.id);
  activeClue = activeClue === c.id ? null : c.id;
  render();
  requestAnimationFrame(() => document.querySelector('.detail--inline')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
}

function clueDetailPane(c) {
  return h('div', { class: 'detail detail--inline', 'aria-live': 'polite' },
    h('span', { class: 'eyebrow' }, kindLabel(c.kind)),
    h('strong', {}, c.name),
    evidencePicture(c),
    c.speaker ? h('span', { class: 'muted' }, `말한 사람: ${c.speaker}`) : null,
    h('p', { class: 'pre' }, c.description),
    h('span', { class: 'muted' }, `${c.foundLabel} · ${c.locationName}${c.source ? ` · ${c.source}` : ''}`),
    hintLines(c.id),
    h('button', { class: 'small', onclick: () => combineView(c) }, '다른 단서와 겹쳐 보기'),
    c.shared
      ? h('button', { disabled: true }, '✓ 공동 보드에 공유됨')
      : h('button', { class: 'primary', onclick: async () => {
          const r = await act('share', { clueId: c.id });
          if (r.status === 200) toast(`‘${c.name}’${withParticle(c.name, '을', '를').slice(c.name.length)} 공동 보드에 공유했어요.`, 'good');
        } }, '공동 보드에 공유하기'));
}

function notebookView() {
  const nb = state.notebook;
  const mineOnly = nb.clues.filter((c) => !c.shared).length;
  const subtabs = [['clues', `단서 ${nb.clues.length}`], ['log', `조사 기록 ${nb.log.length}`]];
  const head = [
    h('div', { class: 'notebook-title' }, h('h3', {}, '내 수첩 ', h('span', { class: 'muted' }, String(nb.clues.length))), solo() ? null : h('span', { class: 'muted small' }, `나만 보유 ${mineOnly}`)),
    h('div', { class: 'subtabs' }, ...subtabs.map(([k, label]) => h('button', { class: notebookTab === k ? 'active' : '', 'aria-pressed': notebookTab === k ? 'true' : 'false', onclick: () => ((notebookTab = k), render()) }, label))),
  ];
  if (notebookTab === 'log') {
    return [...head, h('ul', { class: 'entries' }, ...(nb.log.length
      ? [...nb.log].reverse().map((l) => h('li', { class: 'entry' },
          h('div', {}, h('span', { class: 'chip' }, l.kind === 'talk' ? '대화' : '조사'), h('strong', {}, l.label), l.count > 1 ? h('span', { class: 'muted small' }, ` ×${l.count}`) : null),
          h('div', { class: 'small' }, l.text),
          h('div', { class: 'muted small' }, `${l.foundLabel} · ${l.locationName}`)))
      : [h('li', { class: 'empty' }, '아직 조사하거나 대화한 기록이 없어요.')]))];
  }
  const ordered = [...nb.clues].reverse();
  const at = ordered.findIndex((c) => c.id === activeClue);
  // the details go after the last card of the selected card's row (two cards a row)
  const cells = ordered.map((c) => clueCard(c, { isNew: !seenClues?.has(c.id), selected: c.id === activeClue, hint: strongHint(c.id), onClick: () => openClue(c) }));
  // NEW marks what arrived since the notebook was last looked at, so once shown they count as seen
  queueMicrotask(() => ordered.forEach((c) => markSeen(c.id)));
  if (at >= 0) cells.splice(Math.min(at - (at % 2) + 2, cells.length), 0, clueDetailPane(ordered[at]));
  return [
    ...head,
    h('p', { class: 'muted small' }, solo() ? '카드를 누르면 바로 아래에 내용이 열려요. 혼자 하는 수사라 찾은 단서는 공동 보드에도 바로 올라가요.' : '카드를 누르면 바로 아래에 내용이 열려요. 수첩은 나만 볼 수 있고, 공유한 단서만 팀 보드에 올라가요.'),
    ordered.length ? h('div', { class: 'clue-grid' }, ...cells) : h('p', { class: 'empty' }, '아직 찾은 단서가 없어요. 낮에 맵을 조사하고 인물과 대화해 보세요.'),
  ];
}

// The board has three views: the shared cards with notes, the cards that carry a time laid on a
// timeline, and the statement table where the team marks each statement true or a kind of lie.
let boardTab = 'cards';
const BOARD_TABS = { cards: '자료·메모', timeline: '타임라인', statements: '진술 판정', suspects: '용의자' };
const VERDICT = { true: '사실', protect: '보호용 거짓', hide: '은폐 거짓' };

function boardView({ wide = false }) {
  const b = state.board;
  const memos = b.notes.filter((n) => n.kind === 'memo').length;
  const body = boardTab === 'timeline' ? timelineView() : boardTab === 'statements' ? statementsView() : boardTab === 'suspects' ? suspectsView() : null;
  return h('div', { class: `board${wide ? '' : ' compact'}` },
    h('div', { class: 'board-heading' },
      h('strong', { class: 'grow' }, '공동 증거 보드'),
      h('span', { class: 'muted' }, `${b.clues.length}개 공유 · 메모 ${memos} · 가설 ${b.notes.length - memos} · ${state.room.stageLabel}`),
      h('button', { class: 'small', onclick: () => noteEditor({ kind: 'memo' }) }, '+ 메모'),
      h('button', { class: 'small', onclick: () => noteEditor({ kind: 'hypothesis' }) }, '+ 가설')),
    h('div', { class: 'subtabs board-tabs', role: 'tablist' }, ...Object.entries(BOARD_TABS).map(([k, name]) => h('button', {
      type: 'button', role: 'tab', class: boardTab === k ? 'active' : '', 'aria-selected': boardTab === k ? 'true' : 'false',
      onclick: () => {
        boardTab = k;
        memo.clear();
        render();
      },
    }, name))),
    body ?? boardCards(b));
}

// Shared cards in time order, one line per day: the times the case gives, and the ones the team
// worked out and put there itself (a skewed clock converted, a time pieced together from statements).
function timelineView() {
  const placed = state.board.placements ?? {};
  const items = state.board.clues
    .map((c) => (c.time ? { c, time: c.time, day: c.day ?? 0, ours: false } : placed[c.id] ? { c, time: placed[c.id].time, day: placed[c.id].day ?? 0, ours: true } : null))
    .filter(Boolean)
    .sort((x, y) => x.day - y.day || x.time.padStart(5, '0').localeCompare(y.time.padStart(5, '0')));
  const loose = state.board.clues.filter((c) => !c.time && !placed[c.id]);
  const place = async (clueId, time, day) => {
    const res = await act('placeTime', { clueId, time, day }, { quiet: true });
    if (res.status !== 200) toast(errorText(res), 'error');
  };
  const pick = h('select', { 'aria-label': '놓을 단서' }, ...loose.map((c) => h('option', { value: c.id }, c.name)));
  const time = h('input', { type: 'text', inputmode: 'numeric', placeholder: '20:04', maxlength: 5, 'aria-label': '시각', class: 'timeline__input' });
  const day = h('select', { 'aria-label': '날짜' }, h('option', { value: '' }, '날짜 없음'), ...[1, 2, 3, 4, 5].map((d) => h('option', { value: d }, `${d}일`)));
  const days = [...new Set(items.map((x) => x.day))];
  return h('div', { class: 'timeline' },
    items.length ? null : h('p', { class: 'board-empty' }, '시각이 적힌 자료가 보드에 오르면 여기에 시간 순서로 놓여요. 시각이 없는 자료는 아래에서 직접 놓을 수 있어요.'),
    ...days.map((d) => h('section', { class: 'timeline__day' },
      d ? h('h4', {}, `${d}일`) : null,
      h('ol', { class: 'timeline__list' }, ...items.filter((x) => x.day === d).map(({ c, time: t, ours }) => h('li', { class: `timeline__item${ours ? ' is-ours' : ''}` },
        h('time', { class: 'timeline__time', title: ours ? '팀이 놓은 시각' : '기록에 적힌 시각' }, t, ours ? '*' : ''),
        h('button', { type: 'button', class: `timeline__card kind-${c.kind}`, onclick: () => clueDetail(c) }, h('strong', {}, c.name), h('span', { class: 'muted small clamp' }, c.description)),
        ours ? h('button', { type: 'button', class: 'small ghost', 'aria-label': `${c.name} 시각 빼기`, onclick: () => place(c.id, null) }, '빼기') : null))))),
    items.some((x) => x.ours) ? h('p', { class: 'muted small' }, '* 표시는 팀이 직접 놓은 시각이에요.') : null,
    loose.length ? h('form', { class: 'row timeline__form', onsubmit: (e) => {
      e.preventDefault();
      place(pick.value, time.value.trim(), day.value ? Number(day.value) : null);
    } }, h('span', { class: 'small' }, '시각 없는 자료 놓기'), pick, time, day, h('button', { type: 'submit', class: 'small' }, '놓기')) : null);
}

// The suspect table: for each person, the cards that speak to their motive, means and opportunity.
const SUSPECT_COLS = { motive: '동기', means: '수단', opportunity: '기회' };
function suspectsView() {
  const people = state.characters ?? [];
  if (!people.length) return h('p', { class: 'board-empty' }, '인물을 만나면 여기서 동기·수단·기회를 정리할 수 있어요.');
  const table = state.board.suspects ?? {};
  const cards = state.board.clues;
  const pin = async (character, column, clueId, on) => {
    const res = await act('suspectPin', { character, column, clueId, on }, { quiet: true });
    if (res.status !== 200) toast(errorText(res), 'error');
  };
  const name = (id) => cards.find((c) => c.id === id)?.name ?? id;
  return h('div', { class: 'suspects', 'aria-label': '용의자 판단표' },
    h('p', { class: 'muted small' }, '누가 할 수 있었는지 정리해요. 칸마다 그 사람의 동기·수단·기회를 보여 주는 공유 자료를 붙여요.'),
    ...people.map((p) => h('section', { class: 'suspect' },
      h('h4', {}, p.name, p.role ? h('span', { class: 'muted small' }, ` · ${p.role}`) : null),
      h('div', { class: 'suspect__cols' }, ...Object.entries(SUSPECT_COLS).map(([col, label]) => {
        const list = table[p.id]?.[col] ?? [];
        const add = h('select', { 'aria-label': `${p.name} ${label}에 붙일 자료`, onchange: (e) => e.target.value && pin(p.id, col, e.target.value, true) },
          h('option', { value: '' }, '+ 자료 붙이기'), ...cards.filter((c) => !list.includes(c.id)).map((c) => h('option', { value: c.id }, c.name)));
        return h('div', { class: 'suspect__col' },
          h('strong', { class: 'small' }, label),
          ...list.map((id) => h('span', { class: 'chip suspect__chip' }, name(id), h('button', { type: 'button', class: 'link', 'aria-label': `${name(id)} 떼기`, onclick: () => pin(p.id, col, id, false) }, '×'))),
          cards.length ? add : null);
      })))));
}

// Each shared statement, by speaker, with the team's call on it.
function statementsView() {
  const said = state.board.clues.filter((c) => c.kind === 'testimony');
  if (!said.length) return h('p', { class: 'board-empty' }, '증언이 보드에 오르면 여기서 사실인지, 누군가를 지키려는 거짓인지, 무언가를 감추는 거짓인지 표시할 수 있어요.');
  const verdicts = state.board.verdicts ?? {};
  const speakers = [...new Set(said.map((c) => c.speaker ?? '기타'))];
  const judge = async (c, mark) => {
    const res = await act('judge', { clueId: c.id, mark: verdicts[c.id]?.mark === mark ? null : mark }, { quiet: true });
    if (res.status !== 200) toast(errorText(res), 'error');
  };
  return h('div', { class: 'statements' },
    h('p', { class: 'muted small' }, '같은 판정을 다시 누르면 지워져요. 팀 모두에게 보여요.'),
    ...speakers.map((who) => h('section', { class: 'statements__who' },
      h('h4', {}, who),
      ...said.filter((c) => (c.speaker ?? '기타') === who).map((c) => {
        const v = verdicts[c.id];
        return h('div', { class: `statement${v ? ` is-${v.mark}` : ''}` },
          h('button', { type: 'button', class: 'statement__text', onclick: () => clueDetail(c) }, h('strong', {}, c.name), h('span', { class: 'small' }, c.description)),
          h('div', { class: 'statement__marks', role: 'group', 'aria-label': `${c.name} 판정` }, ...Object.entries(VERDICT).map(([k, name]) => h('button', {
            type: 'button', class: `small verdict verdict--${k}${v?.mark === k ? ' active' : ''}`, 'aria-pressed': v?.mark === k ? 'true' : 'false', onclick: () => judge(c, k),
          }, name))),
          v ? h('span', { class: 'muted small' }, `${playerName(v.by)} · ${ago(v.at)}`) : null);
      }))));
}

function boardCards(b) {
  return [
    h('div', { class: 'board-notes' },
      ...(b.clues.length
        ? b.clues.map((c) => h('button', { type: 'button', class: 'note', onclick: () => clueDetail(c, h('p', { class: 'muted small' }, `${playerName(c.sharedBy)} 공유 · ${c.sharedLabel}`)) },
            h('span', { class: 'eyebrow' }, c.kind === 'testimony' ? '공유된 증언' : '공유된 증거'),
            h('strong', {}, c.name),
            h('p', { class: 'clamp' }, c.description),
            h('span', { class: 'muted' }, `${playerName(c.sharedBy)} 공유 · ${c.sharedLabel}`)))
        : [h('p', { class: 'board-empty' }, '아직 공유된 자료가 없어요. 내 수첩에서 단서를 고르고 ‘공동 보드에 공유하기’를 눌러 주세요.')])),
    h('p', { class: 'board-section' }, '메모와 가설'),
    h('div', { class: 'board-notes' },
      ...(b.notes.length
        ? b.notes.map((n) => h('article', { class: `note ${n.kind}` },
            h('span', { class: 'eyebrow' }, n.kind === 'hypothesis' ? '가설' : '메모'),
            h('strong', {}, n.title),
            n.body ? h('p', { class: 'pre' }, n.body) : null,
            n.links.length ? h('div', { class: 'links' }, ...n.links.map((id) => {
              const c = b.clues.find((x) => x.id === id);
              return c ? h('button', { class: 'chip link', onclick: () => clueDetail(c) }, `🔗 ${c.name}`) : null;
            })) : null,
            h('span', { class: 'muted' }, `작성 ${playerName(n.authorId)} · 수정 ${playerName(n.updatedBy)} ${ago(n.updatedAt)}`),
            h('div', { class: 'row' },
              h('button', { class: 'small ghost', onclick: () => noteEditor(n) }, '수정'),
              h('button', { class: 'small ghost', onclick: () => confirmModal('메모 삭제', `‘${n.title}’${withParticle(n.title, '을', '를').slice(n.title.length)} 지울까요?`, '삭제', async () => {
                const res = await act('noteDelete', { noteId: n.id, baseRev: n.rev }, { quiet: true });
                if (res.status === 409) toast('다른 사람이 먼저 고친 메모예요. 최신 내용을 확인한 뒤 다시 지워 주세요.', 'error');
                else if (res.status !== 200) toast(errorText(res), 'error');
              }) }, '삭제'))))
        : [h('p', { class: 'board-empty' }, '공유된 자료를 연결해 메모나 가설을 남겨 보세요. 예: “감사관은 정말 스스로 내렸을까?”')])),
  ];
}

// The editor lives in a modal, apart from live re-renders. A stale save never overwrites silently:
// the server answers 409 with the latest note and the writer chooses what to do.
function noteEditor(note) {
  const editing = Boolean(note.id);
  let baseRev = note.rev;
  const kind = h('select', {}, h('option', { value: 'memo' }, '메모'), h('option', { value: 'hypothesis' }, '가설'));
  kind.value = note.kind;
  const title = h('input', { maxlength: 60, value: note.title ?? '', placeholder: '제목' });
  const body = h('textarea', { maxlength: 2000, rows: 6, placeholder: '내용' });
  body.value = note.body ?? '';
  const links = new Set(note.links ?? []);
  const linkBox = h('div', { class: 'link-picks' }, ...(state.board.clues.length
    ? state.board.clues.map((c) => h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: links.has(c.id), onchange: (e) => (e.target.checked ? links.add(c.id) : links.delete(c.id)) }), c.name))
    : [h('span', { class: 'muted small' }, '연결할 수 있는 공유 자료가 아직 없어요.')]));
  const conflict = h('div', { class: 'conflict', hidden: true });
  const save = async (e) => {
    e?.preventDefault();
    const payload = { kind: kind.value, title: title.value, body: body.value, links: [...links] };
    const res = editing ? await act('noteUpdate', { noteId: note.id, baseRev, ...payload }, { quiet: true }) : await act('noteCreate', payload, { quiet: true });
    if (res.status === 200) return closeModal();
    if (res.body?.error?.code === 'conflict') {
      const latest = res.body.error.note;
      conflict.hidden = false;
      conflict.replaceChildren(
        h('strong', {}, `${playerName(latest.updatedBy)}님이 먼저 고쳤어요. 내 수정은 아직 저장되지 않았어요.`),
        h('div', { class: 'theirs' }, h('div', {}, h('b', {}, '최신 내용: '), latest.title), h('p', { class: 'pre small' }, latest.body)),
        h('div', { class: 'row end' },
          h('button', { type: 'button', class: 'ghost', onclick: () => {
            kind.value = latest.kind;
            title.value = latest.title;
            body.value = latest.body;
            baseRev = latest.rev;
            conflict.hidden = true;
          } }, '최신 내용 불러오기'),
          h('button', { type: 'button', class: 'primary', onclick: () => ((baseRev = latest.rev), save()) }, '내 내용으로 저장')),
      );
      return;
    }
    toast(errorText(res), 'error');
  };
  openModal(h('form', { class: 'stack', onsubmit: save },
    h('h3', {}, editing ? '메모 수정' : '새 메모'),
    h('div', { class: 'row' }, kind, title),
    body,
    h('div', {}, h('div', { class: 'muted small' }, '관련 자료 연결 (공동 보드에 공유된 것만)'), linkBox),
    conflict,
    h('div', { class: 'row end' }, h('button', { type: 'button', class: 'ghost', onclick: closeModal }, '취소'), h('button', { class: 'primary', type: 'submit' }, '저장'))));
  title.focus();
}

// Save slots: the host saves and rolls back; everyone sees the list. A file keeps a game for later.
function savesView() {
  const isHost = state.me.isHost;
  const list = [...state.room.saves].reverse();
  const canSave = ['intro', 'day', 'night', 'final'].includes(state.room.stage);
  const name = h('input', { maxlength: 20, placeholder: state.room.stageLabel, 'aria-label': '저장 이름' });
  const save = async (e) => {
    e.preventDefault();
    const res = await act('saveGame', name.value.trim() ? { name: name.value.trim() } : {}, { quiet: true });
    // the room notice already tells everyone, the host included
    if (res.status === 200) name.value = '';
    else toast(errorText(res), 'error');
  };
  const load = (x) => confirmModal('저장 불러오기', h('div', {},
    h('p', {}, `‘${x.name}’ (${x.label})로 모두의 진행 상황을 되돌릴까요?`),
    h('p', { class: 'warn' }, '지금 진행 상황은 사라져요. 남겨 두려면 먼저 저장해 두세요.')), '불러오기', () => act('loadGame', { saveId: x.id }));
  const remove = (x) => confirmModal('저장 지우기', `‘${x.name}’ 저장을 지울까요?`, '지우기', () => act('deleteSave', { saveId: x.id }));
  return [
    leaveView(canSave),
    h('div', { class: 'notebook-title' }, h('h3', {}, '저장'), h('span', { class: 'muted small' }, `직접 저장 ${state.room.saves.filter((x) => !x.auto && !x.exit).length}/5`)),
    isHost && canSave
      ? h('form', { class: 'save-form', onsubmit: save }, name, h('button', { class: 'primary', type: 'submit' }, '지금 저장'))
      : h('p', { class: 'muted small' }, isHost ? '이 단계에서는 저장할 수 없어요.' : '저장과 불러오기는 방장이 해요.'),
    h('ul', { class: 'entries' }, ...(list.length
      ? list.map((x) => h('li', { class: 'entry save-entry' },
          h('div', {}, h('span', { class: `chip${x.auto ? '' : ' host'}` }, x.auto ? '자동' : x.exit ? '나가기' : '저장'), h('strong', {}, x.name)),
          h('div', { class: 'muted small' }, `${x.label} · ${ago(x.at)}${x.byName ? ` · ${x.byName}` : ''}`),
          isHost ? h('div', { class: 'row' },
            h('button', { class: 'small', onclick: () => load(x) }, '불러오기'),
            x.auto ? null : h('button', { class: 'small ghost', onclick: () => remove(x) }, '지우기')) : null))
      : [h('li', { class: 'empty' }, '아직 저장이 없어요. 매일 아침 낮이 시작될 때 자동으로도 저장돼요.')])),
    h('div', { class: 'save-file' },
      h('span', { class: 'tag tag--brass-l' }, '저장 파일'),
      h('p', { class: 'small' }, '파일로 내려받아 두면 나중에 처음 화면의 ‘저장 파일로 이어하기’에서 새 방으로 이어서 할 수 있어요. 파일은 이 서버에서만 열려요.'),
      isHost && canSave
        ? h('button', { class: 'full', onclick: exportSave }, '저장 파일 내려받기')
        : h('p', { class: 'muted small' }, isHost ? '진행 중인 게임만 파일로 저장할 수 있어요.' : '파일 내려받기는 방장이 해요.')),
    isHost ? h('div', { class: 'save-file' }, h('span', { class: 'tag tag--rose' }, '방 삭제'), h('p', { class: 'small' }, '이 방과 모두의 진행 상황을 서버에서 지워요. 되돌릴 수 없어요.'), h('button', { class: 'full danger', onclick: deleteRoom }, '방 삭제')) : null,
  ];
}

// Leaving mid-game: the host saves into the room's own "before leaving" slot first. The room stays
// on the server, so anyone can come back from the home screen and carry on.
function leaveView(canSave) {
  const isHost = state.me.isHost;
  const others = state.players.filter((p) => p.connected && p.id !== state.me.id).length;
  const leave = () => {
    conn.stop();
    location.hash = '';
  };
  const saveAndLeave = async () => {
    const res = await act('saveGame', { exit: true }, { quiet: true });
    if (res.status !== 200) return toast(errorText(res), 'error');
    leave();
  };
  const ask = () => confirmModal(isHost && canSave ? '저장하고 나갈까요?' : '나갈까요?', h('div', {},
    h('p', {}, isHost && canSave ? '지금 진행 상황을 ‘나가기 전 저장’ 칸에 저장하고 처음 화면으로 나가요.' : '처음 화면으로 나가요. 방과 진행 상황은 그대로 남아요.'),
    h('p', { class: 'small' }, '처음 화면의 ‘내 방’ 목록에서 다시 들어오면 이어서 할 수 있어요.'),
    isHost && others ? h('p', { class: 'small muted' }, '방장이 30초 넘게 자리를 비우면 남은 사람 중 한 명이 방장을 넘겨받아요.') : null),
  isHost && canSave ? '저장하고 나가기' : '나가기', isHost && canSave ? saveAndLeave : leave);
  return h('div', { class: 'save-file leave-box' },
    h('span', { class: 'tag tag--brass-l' }, '나가기'),
    h('p', { class: 'small' }, isHost && canSave ? '저장한 뒤 나가요. 다시 들어오면 그 자리에서 이어 해요.' : '방은 그대로 남아요. 다시 들어오면 이어서 할 수 있어요.'),
    h('button', { class: 'full primary', onclick: ask }, isHost && canSave ? '저장하고 나가기' : '나가기'));
}

// The host deletes the room for everyone. Offers the save file first while a game is running.
function deleteRoom() {
  const running = ['intro', 'day', 'night', 'final'].includes(state.room.stage);
  confirmModal('방을 삭제할까요?', h('div', {},
    h('p', {}, `‘${state.room.settings.name}’(${code}) 방을 삭제하면 모든 참가자가 나가고, 진행 상황과 저장 칸이 함께 지워져요.`),
    h('p', { class: 'warn' }, '되돌릴 수 없어요.'),
    running ? h('p', { class: 'small' }, '나중에 이어 하려면 먼저 ‘저장’ 탭에서 저장 파일을 내려받아 두세요.') : null), '삭제하기', async () => {
    const res = await api('DELETE', `/api/rooms/${code}`, { token: conn.token });
    if (res.status !== 200) return toast(errorText(res), 'error');
    conn.stop();
    for (const seat of seats.list(code)) seats.forget(code, seat.token);
    location.hash = '';
  });
}

async function exportSave() {
  const res = await api('GET', `/api/rooms/${code}/save-file`, { token: conn.token });
  if (res.status !== 200) return toast(errorText(res), 'error');
  const blob = new Blob([JSON.stringify(res.body)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const label = (res.body.summary?.stageLabel ?? '').replace(/\s+/g, '');
  const a = h('a', { href: url, download: `탐정실록-${code}-${label}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('저장 파일을 내려받았어요.', 'good');
}

function noticesView() {
  const list = [...state.notices].reverse();
  return h('ul', { class: 'entries' }, ...(list.length ? list.map((n) => h('li', { class: 'entry' }, h('div', {}, n.text), h('div', { class: 'muted small' }, ago(n.at)))) : [h('li', { class: 'muted' }, '알림이 없어요.')]));
}

// ---------- chat ----------
// The panel is built once so the message being typed survives every re-render.
const chatPanel = h('section', { class: 'chat', 'aria-label': '팀 채팅' },
  h('div', { class: 'chat-title' }, h('span', {}, '팀 채팅'), h('span', { class: 'muted', id: 'chatCount' })),
  h('div', { class: 'chat-log', id: 'chatLog', 'aria-live': 'polite' }),
  h('form', { class: 'chat-form', id: 'chatForm' },
    h('input', { id: 'chatInput', maxlength: 200, autocomplete: 'off', 'aria-label': '팀 채팅 메시지' }),
    h('button', { class: 'primary', type: 'submit' }, '전송')));
chatPanel.querySelector('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = chatPanel.querySelector('input');
  const text = input.value.trim();
  if (!text) return;
  const res = await act('chat', { text }, { quiet: true });
  if (res.status === 200) input.value = '';
  else toast(errorText(res), 'error');
});

const clock = (iso) => new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });

function renderChat(box = $('chatBox')) {
  const fresh = box.firstChild !== chatPanel;
  if (fresh) {
    memo.delete(box);
    box.replaceChildren(chatPanel);
  }
  const on = state.room.settings.chat;
  chatPanel.querySelector('#chatCount').textContent = `${state.players.filter((p) => p.connected).length}명 연결됨`;
  const input = chatPanel.querySelector('input');
  input.disabled = !on;
  chatPanel.querySelector('button').disabled = !on;
  input.placeholder = on ? '팀에게 발견한 것을 알려 주세요' : '채팅을 사용하지 않는 방이에요';
  const log = chatPanel.querySelector('.chat-log');
  const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
  renderInto(log, JSON.stringify([state.chat, state.players.map((p) => [p.id, p.nickname, p.color])]), () => (state.chat.length
    ? state.chat.map((m) => {
        const p = state.players.find((x) => x.id === m.from);
        return h('div', { class: `chat-line${m.from === state.me.id ? ' mine' : ''}` },
          h('b', { class: 'chat-who', title: p?.nickname ?? '나간 참가자' }, p?.nickname ?? '나간 참가자'),
          h('p', { class: 'chat-text' }, m.text),
          h('span', { class: 'chat-time' }, clock(m.at)));
      })
    : [h('p', { class: 'muted small' }, '아직 메시지가 없어요. 찾은 것을 바로 이야기해 보세요.')]));
  if (fresh || atBottom) log.scrollTop = log.scrollHeight;
}

// ---------- action bar ----------

function renderActionbar() {
  const s = state;
  renderInto($('actionbar'), JSON.stringify([s.room, s.players, s.me.isHost, s.case?.id, s.final?.draft, finalPage, resultPage, finalNav?.blocked, Boolean(finalNav?.submit)]), actionItems);
}

function actionItems() {
  const s = state;
  const me = s.players.find((p) => p.id === s.me.id);
  const others = s.players.filter((p) => p.id !== s.me.id && p.connected);
  const ready = others.filter((p) => p.ready).length;
  {
    if (s.room.broken) return h('span', { class: 'muted' }, '진행할 수 없는 방이에요.');
    const items = [];
    const stage = s.room.stage;
    if (['lobby', 'intro', 'day', 'night'].includes(stage) && !s.me.isHost) {
      const doneLabel = { day: '조사 마치고 준비 완료', night: '토의 마치고 준비 완료' }[stage] ?? '준비 완료';
      items.push(h('button', { class: me.ready ? '' : 'primary', 'aria-pressed': me.ready ? 'true' : 'false', onclick: () => act('ready', { ready: !me.ready }) }, me.ready ? '준비 취소' : doneLabel));
      items.push(h('span', { class: 'muted', 'aria-live': 'polite' }, me.ready ? `✓ 내 준비 완료 · 동료 준비 ${ready}/${others.length} · 방장이 진행할 때까지 기다려요` : `동료 준비 ${ready}/${others.length} · 준비되면 눌러 주세요`));
    }
    if (stage === 'lobby' && s.me.isHost) {
      const all = s.players.filter((p) => p.id !== s.me.id);
      const short = s.case && s.players.length < s.case.players.min;
      const blockers = !s.case ? '케이스를 골라 주세요' : s.room.settings.solo ? (s.case.solo ? null : '이 사건은 혼자 할 수 없어요') : short && !s.case.solo ? `이 사건은 ${s.case.players.min}명 이상 필요해요` : all.some((p) => !p.ready || !p.connected) ? `준비 ${all.filter((p) => p.ready && p.connected).length}/${all.length}` : null;
      items.push(h('button', { class: 'primary start', disabled: Boolean(blockers), onclick: () => startGame() }, s.room.restore ? '이어서 시작' : '게임 시작'));
      const emptySeats = s.room.restore ? s.room.restore.seats.filter((x) => !x.taken).length : 0;
      items.push(h('span', { class: 'muted' }, blockers ?? (emptySeats ? `비어 있는 자리 ${emptySeats}개 · 빼고 이어서 시작할 수 있어요` : '모두 준비됐어요!')));
    }
    if (['intro', 'day', 'night'].includes(stage) && s.me.isHost) {
      const next = nextStageLabel(s);
      items.push(h('button', { class: 'primary', onclick: () => advance() }, `다음: ${next}${next.endsWith('리') ? '로' : '으로'}`));
      items.push(h('span', { class: 'muted', 'aria-live': 'polite' }, s.room.settings.solo ? '혼자 하는 방이에요. 준비되면 다음 단계로 넘어가세요.' : `동료 준비 ${ready}/${others.length} (연결된 참가자 기준)`));
    }
    // the final deduction and the result turn pages from the dock
    if (stage === 'final' && finalNav && !s.final.submitted) {
      const f = s.final;
      const done = f.questions.filter((q) => f.draft.answers[q.id]).length;
      const last = finalPage >= finalNav.pages - 1;
      items.push(h('span', { class: 'muted' }, `${f.questions.length}문항 중 ${done} 답함${finalNav.blocked ? ` · ${finalNav.blocked}` : ''}`));
      items.push(h('button', { type: 'button', disabled: finalPage === 0, onclick: () => goFinalPage(finalPage - 1) }, '이전'));
      if (!last) items.push(h('button', { type: 'button', class: 'primary', onclick: () => goFinalPage(finalPage + 1) }, finalPage === finalNav.pages - 2 ? '확인으로' : '다음'));
      else if (s.me.isHost) items.push(h('button', { type: 'button', class: 'primary', disabled: !finalNav.submit, onclick: () => finalNav.submit?.() }, '최종 제출'));
    }
    if (stage === 'result') {
      if (resultNav) {
        items.push(h('button', { type: 'button', disabled: resultPage === 0, onclick: () => goResultPage(resultPage - 1) }, '이전'));
        if (resultPage < resultNav.pages - 1) items.push(h('button', { type: 'button', onclick: () => goResultPage(resultPage + 1) }, '다음'));
      }
      items.push(h('a', { class: 'button primary', href: '#' }, '처음 화면으로'));
    }
    return items;
  }
}

// An imported room may start with empty saved seats once the host agrees to drop them.
async function startGame() {
  const res = await act('start', {}, { quiet: true });
  if (res.status === 200) return;
  if (res.body?.error?.code === 'unclaimed_seats') {
    confirmModal('비어 있는 자리가 있어요', res.body.error.message, '빼고 시작', () => act('start', { dropSeats: true }));
  } else {
    toast(errorText(res), 'error');
  }
}

// ---------- the end-of-day button (field HUD, beside the goal count) ----------
// Alone it moves to the night; a member marks themself ready (준비 완료 → 준비함); the host moves
// everyone, with how many are ready. Green: press now; brass: waiting for others; grey: something
// is left today (pressing still works, after a check).
function endDayButton() {
  const s = state;
  if (s.room.stage !== 'day') return null;
  const { done, total } = goalProgress();
  const left = done < total;
  if (s.room.settings.solo) return { label: '밤으로', tone: left ? 'idle' : 'go' };
  const me = s.players.find((p) => p.id === s.me.id);
  const people = s.players.filter((p) => p.connected || p.id === s.me.id);
  const ready = people.filter((p) => p.isHost || p.ready).length;
  const count = `준비 ${ready}/${people.length}`;
  if (!s.me.isHost) {
    return me?.ready
      ? { label: '준비함', sub: `${count} · 방장을 기다려요`, tone: 'wait', icon: 'check' }
      : { label: '준비 완료', sub: count, tone: left ? 'idle' : 'go' };
  }
  return { label: '밤으로', sub: count, tone: left ? 'idle' : ready === people.length ? 'go' : 'wait' };
}

// the host pressed with someone not ready: a second press within a few seconds goes anyway
let endDayAgainUntil = 0;
async function endDay() {
  const s = state;
  if (!fieldMode() || s.room.stage !== 'day' || !$('modal').hidden) return;
  if (!s.me.isHost) {
    const wasReady = Boolean(s.players.find((p) => p.id === s.me.id)?.ready);
    const res = await act('ready', { ready: !wasReady });
    if (res.status === 200) toast(wasReady ? '준비를 취소했어요.' : '준비했어요. 방장이 밤으로 넘기면 함께 넘어가요.', wasReady ? 'info' : 'good');
    return;
  }
  const waiting = s.room.settings.solo ? [] : s.players.filter((p) => !p.isHost && p.connected && !p.ready);
  if (waiting.length && Date.now() > endDayAgainUntil) {
    endDayAgainUntil = Date.now() + 6000;
    toast(`아직 ${waiting.length}명이 준비하지 않았어요. 그래도 넘어가려면 한 번 더 누르세요.`, 'info');
    return;
  }
  endDayAgainUntil = 0;
  endDayAdvance(waiting.length ? { force: true } : {});
}

// Goals left today: say which, and what leaving them costs (the case's warning), before the night.
async function endDayAdvance(flags) {
  const res = await act('advance', flags, { quiet: true });
  if (res.status === 200) return;
  const err = res.body?.error;
  if (err?.code === 'stage_warning') {
    openModal(
      h('h3', {}, `${state.room.day}일 차 낮을 마칠까요?`),
      h('p', {}, '아직 하지 않은 목표가 있어요.'),
      h('p', { class: 'endday-left' }, (err.warnings ?? [err.message]).map((w) => `✗ ${w}`).join('\n')),
      h('div', { class: 'row end' },
        h('button', { class: 'ghost', onclick: closeModal }, '조사 계속하기'),
        h('button', { class: 'primary', onclick: () => (closeModal(), endDayAdvance({ ...flags, confirmWarnings: true })) }, '그래도 밤으로')),
    );
  } else if (err?.code === 'not_ready') {
    advance(flags);
  } else {
    toast(errorText(res), 'error');
  }
}

// Each confirmation adds its flag and retries, so a warning and missing readiness can both be confirmed.
async function advance(flags = {}) {
  const res = await act('advance', flags, { quiet: true });
  if (res.status === 200) return;
  const err = res.body?.error;
  if (err?.code === 'stage_warning') {
    confirmModal('넘어가기 전에 확인하세요', h('p', { class: 'pre' }, err.message), '그래도 진행', () => advance({ ...flags, confirmWarnings: true }));
  } else if (err?.code === 'not_ready') {
    confirmModal('아직 준비하지 않은 참가자가 있어요', `${err.waiting.map(playerName).join(', ')}님이 아직 준비하지 않았어요. 그래도 진행할까요?`, '그래도 진행', () => advance({ ...flags, force: true }));
  } else {
    toast(errorText(res), 'error');
  }
}

// ---------- dialogue ----------

function renderDialogue() {
  dialogueBox.update(fieldMode() ? state.dialogue : null);
}

// ---------- input ----------

const KEYS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', w: 'up', s: 'down', a: 'left', d: 'right', W: 'up', S: 'down', A: 'left', D: 'right' };
const DIR_VEC = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
let held = null;
let lastLockToast = 0;

// Own steps are drawn at once when the next tile is plainly walkable (floor, no exit, no solid
// object); the server confirms them in order. Up to four steps run ahead of its answers, so walking
// does not wait on the network. Exits and anything doubtful wait for the server.
const FACE = { up: 'n', down: 's', left: 'w', right: 'e' };
const MAX_AHEAD = 4;
let ahead = 0;
let predicted = null; // { location, x, y, facing } while steps are unconfirmed
// The newest place the server has put us, with the room version it was true at. Full views, step
// events and step replies travel separately (the stream may lag behind the replies, more so through
// a tunnel or a host browser), so an older one must not pull us back to where we already were.
let serverMe = null; // { location, x, y, facing, v }
let serverEpoch = null;
let moveChain = Promise.resolve();

function myMapEntry() {
  return state?.map?.players.find((p) => p.id === state.me.id) ?? null;
}

// true when this is news (as new as, or newer than, what we know)
function noteServerMe(pos, v) {
  if (serverMe && v < serverMe.v) return false;
  serverMe = { ...pos, v };
  return true;
}

// A fresh view lags behind steps still in flight: keep drawing where we already are. A view that is
// older than a step the server already confirmed draws us at that step instead.
function keepPrediction() {
  if (state.stateEpoch !== serverEpoch) {
    serverEpoch = state.stateEpoch;
    serverMe = null;
  }
  const me = myMapEntry();
  if (!me) return;
  noteServerMe({ location: state.map.id, x: me.x, y: me.y, facing: me.facing }, state.stateVersion ?? 0);
  if (ahead > 0 && predicted && predicted.location === state.map.id) Object.assign(me, { x: predicted.x, y: predicted.y, facing: predicted.facing });
  else {
    if (ahead === 0) predicted = null;
    if (serverMe.location === state.map.id) Object.assign(me, { x: serverMe.x, y: serverMe.y, facing: serverMe.facing });
  }
  state.me.position = { location: state.map.id, x: me.x, y: me.y };
}

function predictStep(dir) {
  const m = state.map;
  const me = myMapEntry();
  if (!me) return false;
  const [dx, dy] = DIR_VEC[dir];
  const x = me.x + dx;
  const y = me.y + dy;
  me.facing = FACE[dir];
  const walkable = m.tiles[y]?.[x] === '.' && !m.exits.some((e) => e.x === x && e.y === y) && !m.objects.some((o) => (o.blocks ?? o.solid) && o.x === x && o.y === y);
  if (walkable) Object.assign(me, { x, y });
  predicted = { location: m.id, x: me.x, y: me.y, facing: me.facing };
  viewStamp += 1;
  state.me.position = { location: m.id, x: me.x, y: me.y };
  syncMotion();
  renderMapHud();
  return walkable;
}

// Click (or tap) the map to walk there: the shortest way round walls, people and things, one step
// at a time like a held key. Clicking a person or a thing walks up to it and talks or looks; clicking
// a doorway walks through it. Any key press takes over.
let route = null; // { dirs: ['up', …], then: object id or null }

function routeTo(tx, ty) {
  const m = state.map;
  const me = myMapEntry();
  if (!me) return null;
  const exitAt = (x, y) => m.exits.some((e) => e.x === x && e.y === y);
  const free = (x, y) => m.tiles[y]?.[x] === '.' && !exitAt(x, y) && !m.objects.some((o) => (o.blocks ?? o.solid) && o.x === x && o.y === y);
  // a person is drawn a tile taller than where they stand, so a click on the head counts too
  const target = m.objects.find((o) => o.x === tx && o.y === ty)
    ?? m.objects.find((o) => o.kind === 'talk' && o.x === tx && o.y === ty + 1) ?? null;
  if (target) [tx, ty] = [target.x, target.y];
  // where the walk may end: next to a thing, beside a doorway (then one more step through), or the tile
  const door = exitAt(tx, ty);
  const ends = (x, y) => {
    if (target) return Math.max(Math.abs(x - tx), Math.abs(y - ty)) <= 1;
    if (door) return Math.abs(x - tx) + Math.abs(y - ty) === 1;
    return x === tx && y === ty;
  };
  if (!target && !door && !free(tx, ty)) return null;
  const prev = new Map([[`${me.x}:${me.y}`, null]]);
  const queue = [[me.x, me.y]];
  for (let i = 0; i < queue.length; i += 1) {
    const [x, y] = queue[i];
    if (ends(x, y)) {
      const dirs = [];
      for (let k = `${x}:${y}`; prev.get(k); k = prev.get(k).from) dirs.unshift(prev.get(k).dir);
      if (door) dirs.push(Object.keys(DIR_VEC).find((d) => x + DIR_VEC[d][0] === tx && y + DIR_VEC[d][1] === ty));
      // end facing the thing, so E (and the bubble) picks it
      return { dirs, then: target?.id ?? null, face: target ? [Math.sign(tx - x), Math.sign(ty - y)] : null };
    }
    for (const [dir, [dx, dy]] of Object.entries(DIR_VEC)) {
      const k = `${x + dx}:${y + dy}`;
      if (prev.has(k) || !free(x + dx, y + dy)) continue;
      prev.set(k, { from: `${x}:${y}`, dir });
      queue.push([x + dx, y + dy]);
    }
  }
  return null;
}

function walkTo(clientX, clientY) {
  const canvas = $('mapCanvas');
  if (!canvas || !fieldMode() || state.dialogue || !$('modal').hidden || hud.current()) return;
  const r = canvas.getBoundingClientRect();
  const T = state.map.art ? state.map.art.tile * ART_SCALE : TILE;
  const tx = Math.floor(((clientX - r.left) * (canvas.width / r.width)) / T);
  const ty = Math.floor(((clientY - r.top) * (canvas.height / r.height)) / T);
  route = routeTo(tx, ty);
  if (!route) toast('거기로는 갈 수 없어요.', 'info');
  else if (!route.dirs.length) arrive();
}

// at the end of a walk: turn to what was clicked and look at it or talk
function arrive() {
  const done = route;
  route = null;
  if (!done?.then) return;
  if (done.face && (done.face[0] || done.face[1])) facing = done.face[0] && done.face[1] ? [done.face[0], 0] : done.face;
  moveChain = moveChain.then(() => {
    if (state.map?.objects.some((o) => o.id === done.then)) interact(done.then);
  });
}

function step() {
  if (held) route = null;
  if (!held && !route) return;
  if (ahead >= MAX_AHEAD || state?.room.stage !== 'day' || state.dialogue || !state.map) return;
  const dir = held ?? route.dirs.shift();
  if (route && !route.dirs.length) setTimeout(arrive, 0);
  facing = DIR_VEC[dir];
  const drawn = predictStep(dir);
  // a step we could not draw (exit, wall, object) goes alone, after the ones in flight
  if (!drawn && ahead > 0) return;
  ahead += 1;
  queued.push({ dir, drawn, target: drawn ? { ...predicted } : null }); // target: where the server will agree we are
  sendSteps();
}

// Steps go out as soon as nothing is in flight; the ones drawn while waiting go together in one
// request (move.dirs), so walking keeps pace on a slow line instead of waiting a round trip a tile.
const STEP_BATCH = 6;
let queued = [];
let stepsInFlight = false;
function sendSteps() {
  if (stepsInFlight || !queued.length) return;
  // a door or anything doubtful goes alone; drawn steps go together
  const n = queued[0].drawn ? queued.findIndex((s) => !s.drawn) : 1;
  const batch = queued.splice(0, Math.min(n < 0 ? queued.length : n, STEP_BATCH));
  stepsInFlight = true;
  moveChain = moveChain.then(async () => {
    const body = batch.length === 1 ? { dir: batch[0].dir } : { dirs: batch.map((s) => s.dir) };
    const res = await conn.act('move', body);
    stepsInFlight = false;
    ahead -= batch.length;
    const ok = res.status === 200;
    const results = ok ? (res.body.results ?? [res.body]) : [];
    const done = ok ? (batch.length === 1 ? (res.body.moved || !batch[0].drawn ? 1 : 0) : res.body.steps) : 0;
    // where the server says we are now (and the steps that got us there)
    if (ok && res.body.at && typeof res.body.stateVersion === 'number') noteServerMe(res.body.at, res.body.stateVersion);
    results.forEach((r, i) => {
      if (r.noise && batch[i]?.target) noiseMarks.push({ x: batch[i].target.x, y: batch[i].target.y, at: performance.now(), kind: r.noise });
    });
    if (ok && res.body.reason === 'got_up' && res.body.message) toast(res.body.message, 'info');
    if (ok && res.body.reason === 'locked' && Date.now() - lastLockToast > 1500) {
      lastLockToast = Date.now();
      toast(res.body.message, 'error');
    } else if (!ok && res.status !== 429) {
      toast(errorText(res), 'error');
    }
    // a step that did not go through: back to where the server has us, and drop the rest of the
    // guess (queued steps were drawn on top of it) and any walk
    if (done < batch.length) {
      route = null;
      ahead -= queued.length;
      queued = [];
      const me = myMapEntry();
      if (me && serverMe && serverMe.location === state.map.id) Object.assign(me, { x: serverMe.x, y: serverMe.y, facing: serverMe.facing });
      predicted = null;
      syncMotion();
    }
    if (ahead === 0) predicted = null;
    renderMapHud();
    sendSteps();
  });
}
setInterval(step, 140);
document.addEventListener('click', (e) => {
  if (e.target.id === 'mapCanvas') walkTo(e.clientX, e.clientY);
});

// "Look here": right-click (or hold a finger on) the map to mark a tile for everyone in the room.
function tileAt(clientX, clientY) {
  const canvas = $('mapCanvas');
  const r = canvas.getBoundingClientRect();
  const T = state.map.art ? state.map.art.tile * ART_SCALE : TILE;
  return [Math.floor(((clientX - r.left) * (canvas.width / r.width)) / T), Math.floor(((clientY - r.top) * (canvas.height / r.height)) / T)];
}
async function ping(clientX, clientY) {
  if (!fieldMode() || state.room.settings.solo) return;
  const [x, y] = tileAt(clientX, clientY);
  const res = await act('ping', { x, y }, { quiet: true });
  if (res.status !== 200) toast(errorText(res), 'error');
}
document.addEventListener('contextmenu', (e) => {
  if (e.target.id !== 'mapCanvas' || state?.room.settings.solo) return;
  e.preventDefault();
  ping(e.clientX, e.clientY);
});
let pressTimer = null;
document.addEventListener('touchstart', (e) => {
  if (e.target.id !== 'mapCanvas' || e.touches.length !== 1) return;
  const t = e.touches[0];
  pressTimer = setTimeout(() => ping(t.clientX, t.clientY), 600);
}, { passive: true });
for (const ev of ['touchend', 'touchmove', 'touchcancel']) document.addEventListener(ev, () => clearTimeout(pressTimer), { passive: true });

// Marks fade after eight seconds, timed from when this screen first saw them.
const pingSeen = new Map();
// A step on a loud floor: a ripple on that tile for a moment, so the player knows they were heard.
const noiseMarks = [];
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
function drawNoise(canvas, now) {
  if (!noiseMarks.length) return;
  const ctx = canvas.getContext('2d');
  const T = state.map.art ? state.map.art.tile * ART_SCALE : TILE;
  for (let i = noiseMarks.length - 1; i >= 0; i--) {
    const n = noiseMarks[i];
    const age = (now - n.at) / 700;
    if (age >= 1 || n.x == null) {
      noiseMarks.splice(i, 1);
      continue;
    }
    ctx.save();
    ctx.globalAlpha = 1 - age;
    ctx.strokeStyle = n.kind === 'm' ? '#c9d4de' : '#c9a07a';
    ctx.lineWidth = 3;
    const r = T * (0.3 + age * 0.9);
    ctx.strokeRect(n.x * T + T / 2 - r, n.y * T + T / 2 - r, r * 2, r * 2);
    ctx.restore();
  }
}

function drawPings(canvas, now) {
  const list = state.pings ?? [];
  if (!list.length) return;
  const ctx = canvas.getContext('2d');
  const T = state.map.art ? state.map.art.tile * ART_SCALE : TILE;
  for (const p of list) {
    if (!pingSeen.has(p.id)) pingSeen.set(p.id, now);
    const age = now - pingSeen.get(p.id);
    if (age > 8000) continue;
    const pulse = (age % 1000) / 1000;
    const color = state.players.find((x) => x.id === p.by)?.color ?? '#E5B54B';
    ctx.save();
    ctx.globalAlpha = 1 - age / 8000;
    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    ctx.strokeRect(p.x * T + 2, p.y * T + 2, T - 4, T - 4);
    ctx.globalAlpha *= 1 - pulse;
    const grow = pulse * T * 0.6;
    ctx.strokeRect(p.x * T - grow, p.y * T - grow, T + grow * 2, T + grow * 2);
    ctx.restore();
  }
}

async function interact(objectId = null) {
  const target = objectId ? state.map?.objects.find((o) => o.id === objectId) : pickTarget(state, facing);
  if (!target) return toast('가까이에 조사할 대상이 없어요.', 'info');
  const res = await conn.act('interact', { objectId: target.id });
  if (res.status !== 200) return toast(errorText(res), 'error');
  // a hiding place or a monitor desk: a short line, no window
  if (res.body.kind === 'hide') return res.body.text && toast(res.body.text, 'info');
  if (res.body.kind === 'station') return toast(`${res.body.label}에 앉았어요. 감시 화면이 지도에 보여요. 움직이면 일어나요.`, 'info');
  if (res.body.kind !== 'inspect') return;
  const r = res.body;
  openModal(
    h('p', { class: 'eyebrow' }, r.revisit ? '이미 조사한 곳' : '조사'),
    h('h3', {}, r.label),
    h('p', { class: 'pre' }, r.text),
    r.gained.length ? h('div', { class: 'gain' }, h('strong', {}, solo() ? '새 단서를 수첩과 공동 보드에 넣었어요' : '새 단서를 수첩에 넣었어요'), h('div', { class: 'clue-row' }, ...r.gained.map((c) => clueCard(c, { mini: true })))) : null,
    r.taken.length ? h('p', { class: 'muted' }, `여기서 찾을 단서는 이미 ${r.taken.map((t) => t.ownerName).join(', ')}님이 가져갔어요. 공동 보드에 공유되면 볼 수 있어요.`) : null,
    h('div', { class: 'row end' }, h('button', { class: 'primary', onclick: closeModal }, '확인')),
  );
}

window.addEventListener('keydown', (e) => {
  if (!$('shift').hidden) endShift();
  if (e.key === 'Escape') {
    if (!$('modal').hidden) return closeModal();
    if (state?.dialogue) return act('closeDialogue');
    if (hud.current()) return hud.close();
  }
  if (e.target.closest('input, textarea, select') || !$('modal').hidden || !state) return;
  if (state.room.stage !== 'day' || state.dialogue || dialogueBox.isActive()) return;
  const dir = KEYS[e.key];
  if (dir) {
    e.preventDefault();
    if (held !== dir) {
      held = dir;
      step();
    }
  } else if ((e.key === 'e' || e.key === 'E' || e.key === ' ') && !e.repeat) {
    e.preventDefault();
    interact();
  }
});
window.addEventListener('keyup', (e) => {
  if (KEYS[e.key] === held) held = null;
});

// ---------- touch controls (tablet, phone) ----------
// A held direction button walks like a held arrow key; E inspects or talks. Shown on touch
// screens while on the field and out of a dialogue (the dialogue box is tapped directly).
for (const btn of document.querySelectorAll('#touchpad [data-dir]')) {
  const release = () => {
    if (held === btn.dataset.dir) held = null;
    btn.classList.remove('is-down');
  };
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    btn.setPointerCapture?.(e.pointerId);
    btn.classList.add('is-down');
    held = btn.dataset.dir;
    step();
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) btn.addEventListener(type, release);
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
}
$('padAct').addEventListener('click', () => {
  if (state?.room.stage === 'day' && !state.dialogue && !dialogueBox.isActive()) interact();
});

const compactScreen = () => matchMedia('(max-width: 760px), (max-height: 520px)').matches;
function renderTouchpad() {
  if (!state) return;
  // on a phone an open note covers the map, so the pad steps aside until it closes
  const show = fieldMode() && padWanted() && !state.dialogue && !dialogueBox.isActive() && !(compactScreen() && hud.current());
  if ($('touchpad').hidden === show) $('touchpad').hidden = !show;
  if (!show) {
    for (const b of document.querySelectorAll('#touchpad .is-down')) {
      b.classList.remove('is-down');
      held = null;
    }
  }
}
window.addEventListener('blur', () => (held = null));

function tick() {
  const t = state?.room.timing;
  const el = $('timer');
  if (!t || ['lobby', 'result'].includes(state.room.stage)) {
    el.textContent = '';
    return;
  }
  const sec = Math.max(0, Math.floor((Date.now() + clockOffset - Date.parse(t.stageStartedAt)) / 1000));
  el.textContent = timerText();
  el.classList.toggle('over', Boolean(t.recommendedMinutes && sec > t.recommendedMinutes * 60));
  const brief = document.getElementById('briefTimer');
  if (brief) brief.textContent = el.textContent;
}

function timerText() {
  const t = state?.room.timing;
  if (!t) return '';
  const sec = Math.max(0, Math.floor((Date.now() + clockOffset - Date.parse(t.stageStartedAt)) / 1000));
  const mm = String(Math.floor(sec / 60)).padStart(2, '0');
  const ss = String(sec % 60).padStart(2, '0');
  return t.recommendedMinutes ? `경과 ${mm}:${ss} / 권장 ${t.recommendedMinutes}분` : `경과 ${mm}:${ss}`;
}
setInterval(tick, 1000);

function copy(text) {
  navigator.clipboard?.writeText(text).then(() => toast('복사했어요.', 'good'), () => toast(text));
}

// Phones and tablets hand the invite to the share sheet (messenger, text); elsewhere it is copied.
const canShare = () => Boolean(navigator.share) && matchMedia('(pointer: coarse)').matches;
function invite(link) {
  const name = state?.room.settings.name;
  if (!canShare()) {
    const shown = () => toast(`복사가 막혀 있어요. 이 링크를 친구에게 보내 주세요: ${link}`);
    if (!navigator.clipboard) return shown();
    navigator.clipboard.writeText(link).then(() => toast('초대 링크를 복사했어요. 친구에게 보내 주세요.', 'good'), shown);
    return;
  }
  navigator.share({ title: '탐정실록', text: name ? `'${name}'에서 같이 추리해요.` : '같이 추리해요.', url: link }).catch((e) => e?.name !== 'AbortError' && copy(link));
}

$('codeBtn').addEventListener('click', () => invite(`${location.href.split('#')[0]}#${code}`));
$('emblem').append(icon('search'));
$('modal').addEventListener('click', (e) => e.target === $('modal') && closeModal());
$('shift').addEventListener('click', endShift);

// Looks arrive after the first render; redraw the lists that show them.
looksReady.then(() => {
  memo.clear();
  if (state) render();
});

const dialogueBox = new DialogueBox($('dialogue'), {
  act: (type, payload) => act(type, payload),
  // what can be shown: my notebook and the shared board, without duplicates
  clues: () => {
    // with hints on, what this person reacts to comes first and is marked
    const here = state.dialogue?.objectId;
    const mark = (id) => hintsFor(id).find((x) => x.objectId === here && (x.kind === 'show' || x.kind === 'react'))?.kind ?? null;
    return [...new Map([...state.notebook.clues, ...state.board.clues].map((c) => [c.id, c])).values()]
      .map((c) => ({ id: c.id, name: c.name, description: c.description, where: c.locationName ? `${c.foundLabel} · ${c.locationName}` : '공동 보드', hint: mark(c.id) }))
      .sort((a, b) => (a.hint === 'show' ? 0 : a.hint ? 1 : 2) - (b.hint === 'show' ? 0 : b.hint ? 1 : 2));
  },
  onKeyword: (d) => releaseKeyword(d),
  onStart() {
    hud.close();
    hud.setShortcutsEnabled(false);
    $('dialogue').hidden = false;
  },
  onEnd(goPerson) {
    hud.setShortcutsEnabled(true);
    for (const run of seenRecords.held.values()) run();
    seenRecords.held.clear();
    if (goPerson) {
      selectedPerson = goPerson;
      hud.open('people');
    }
  },
});

// While someone talks on the day map, toasts sit just above the dialogue box (pxtoast.css).
// On phones they also start below the HUD corner (date, goal, and the minimap when unfolded).
const toastWatch = new ResizeObserver(() => placeToasts());
const watched = new Set();
function placeToasts() {
  const box = document.querySelector('#dialogue .ig-dialog');
  const corner = document.querySelector('#hud .nui-corner');
  for (const el of [box, corner]) {
    if (el && !watched.has(el)) {
      watched.add(el);
      toastWatch.observe(el);
    }
  }
  if (corner) document.body.style.setProperty('--hud-bottom', `${Math.round(corner.getBoundingClientRect().bottom)}px`);
  const on = Boolean(box && !box.hidden && !$('dialogue').hidden && fieldMode());
  document.body.classList.toggle('talking', on);
  if (on) document.body.style.setProperty('--dlg-top', `${Math.round(box.getBoundingClientRect().top)}px`);
}
new MutationObserver(placeToasts).observe($('dialogue'), { attributes: true, attributeFilter: ['hidden'], subtree: true, childList: true });
addEventListener('resize', placeToasts);

const hud = mountNoteUI($('hud'), {
  enabled: () => fieldMode() && !state.dialogue && !dialogueBox.isActive() && $('modal').hidden,
  onRender: renderNote,
  onPrompt: () => interact(),
  onEndDay: () => endDay(),
  onToast(id) {
    if (dialogueBox.isActive()) dialogueBox.goPerson = id;
    else {
      selectedPerson = id;
      hud.open('people');
    }
  },
  onChange(id) {
    if (id === 'people') hud.setBadge('people', (peopleBadge = 0));
    if (state) {
      renderField();
      renderTouchpad();
    }
    // opening the chat note puts the cursor in its input; Esc closes it again
    if (id === 'chat' && state?.room.settings.chat) setTimeout(() => chatPanel.querySelector('input')?.focus(), 0);
  },
});

const token = seats.active(code);
if (token) begin(token);
else showJoin();
