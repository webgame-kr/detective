import { api, seats, h } from './net.js';
import { caseFolder, caseSheet, icon, playersText, staticDrawers, DIFFICULTY } from './ui.js';
import { officeCard } from './casebook.js';

const $ = (id) => document.getElementById(id);
let cases = [];
let chosen = null;

// The right column: one drawer open at a time, '새 수사' first (docs/ui-onescreen-spec.md 5.1)
const drawers = staticDrawers($('homeDrawers'), { open: 'new', remember: 'home' });
staticDrawers($('settingsDrawers'));
function settingsSummary() {
  const d = DIFFICULTY[$('roomDifficulty').value]?.name ?? '입문';
  $('settingsSummary').textContent = `${d} · ${$('roomCapacity').value || '-'}명 · 채팅 ${$('roomChat').checked ? '켬' : '끔'}`;
}
for (const id of ['roomDifficulty', 'roomCapacity', 'roomChat']) $(id).addEventListener('change', settingsSummary);

function toast(text, kind = 'error') {
  const el = h('div', { class: `toast ${kind}` }, text);
  $('toasts').append(el);
  setTimeout(() => el.remove(), 4000);
}

function renderFolders() {
  if (!cases.length) {
    $('folders').replaceChildren(h('p', { class: 'warn' }, '설치된 사건 파일이 없어요. 서버 로그의 콘텐츠 불러오기 오류를 확인해 주세요.'));
    return;
  }
  $('folders').replaceChildren(...cases.map((c, i) => caseFolder(c, { index: i, selected: chosen === c.id, onOpen: () => openCase(c.id, true) })));
}

// Opening a folder lays its file on the desk and fits the room settings to it.
function openCase(id, focus = false) {
  chosen = id;
  renderFolders();
  const i = cases.findIndex((c) => c.id === id);
  const c = cases[i];
  $('caseSheet').replaceChildren(caseSheet(c, { index: i }));
  const max = Math.min(8, c.players.max);
  $('roomCapacity').replaceChildren(...Array.from({ length: 8 }, (_, i) => h('option', { value: i + 1 }, `${i + 1}명${i + 1 >= c.players.min && i + 1 <= c.players.max ? ' (권장)' : ''}`)));
  $('roomCapacity').value = String(max);
  capacityHint();
  $('soloBox').hidden = !c.solo;
  $('createBtn').disabled = false;
  $('newSummary').textContent = c.title;
  settingsSummary();
  if (focus) {
    $('folders').querySelector('[aria-pressed="true"]')?.focus();
    // picking a case leads straight to starting it
    drawers.open('new');
    if (matchMedia('(max-width: 640px)').matches) $('homeDrawers').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

// What the chosen size means for the open case.
function capacityHint() {
  const c = cases.find((x) => x.id === chosen);
  if (!c) return;
  const n = Number($('roomCapacity').value);
  const el = $('capacityHint');
  el.className = 'small muted';
  if (n < c.players.min && !c.solo) {
    el.className = 'small warn';
    el.textContent = `이 사건은 ${c.players.min}명 이상이 함께해야 시작할 수 있어요.`;
  } else if (n < c.players.min) {
    el.textContent = `권장 ${playersText(c.players)}. 인원이 적으면 여럿이 함께 하는 장치가 하나씩 켜는 방식으로 바뀌어요.`;
  } else if (n > c.players.max) {
    el.textContent = `권장 ${playersText(c.players)}보다 많아요. 단서를 나눠 찾게 돼요.`;
  } else {
    el.textContent = `권장 ${playersText(c.players)} · 이 사건에 맞는 인원이에요.`;
  }
}
$('roomCapacity').addEventListener('change', capacityHint);

async function loadCases() {
  const res = await api('GET', '/api/cases');
  cases = res.body?.cases ?? [];
  $('caseCount').textContent = `사건 파일 ${cases.length}건`;
  renderFolders();
  $('office').replaceChildren(officeCard(cases));
  if (cases.length) openCase(cases[0].id);
}

$('createNick').addEventListener('input', () => {
  const nick = $('createNick').value.trim();
  $('roomName').placeholder = nick ? `${nick}의 수사본부`.slice(0, 20) : '닉네임의 수사본부';
});

$('createForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!chosen) return toast('먼저 사건 파일을 골라 주세요.');
  const nickname = $('createNick').value.trim();
  const settings = { chat: $('roomChat').checked, capacity: Number($('roomCapacity').value), difficulty: $('roomDifficulty').value };
  if ($('roomName').value.trim()) settings.name = $('roomName').value.trim();
  const res = await api('POST', '/api/rooms', { body: { nickname, caseId: chosen, settings } });
  if (res.status !== 201) return toast(res.body?.error?.message ?? '방을 만들지 못했어요.');
  seats.save(res.body.code, { token: res.body.token, playerId: res.body.playerId, nickname });
  location.hash = res.body.code;
});

$('soloBtn').addEventListener('click', async () => {
  const nickname = $('createNick').value.trim();
  if (!nickname) {
    $('createNick').focus();
    return toast('닉네임을 먼저 적어 주세요.');
  }
  const settings = { difficulty: $('roomDifficulty').value, ...($('roomName').value.trim() ? { name: $('roomName').value.trim() } : {}) };
  const res = await api('POST', '/api/rooms', { body: { nickname, caseId: chosen, settings, solo: true } });
  if (res.status !== 201) return toast(res.body?.error?.message ?? '방을 만들지 못했어요.');
  seats.save(res.body.code, { token: res.body.token, playerId: res.body.playerId, nickname });
  location.hash = res.body.code;
});

// ---------- save files ----------
let saveFile = null;
$('loadFile').addEventListener('change', async () => {
  saveFile = null;
  $('loadSummary').hidden = true;
  $('loadSeatField').hidden = true;
  const f = $('loadFile').files[0];
  if (!f) return;
  try {
    if (f.size > 2 * 1024 * 1024) throw new Error('size');
    saveFile = JSON.parse(await f.text());
    if (saveFile?.format !== 'baekrok-save') throw new Error('format');
  } catch {
    saveFile = null;
    return toast('저장 파일을 읽지 못했어요. 게임에서 내려받은 .json 파일을 골라 주세요.');
  }
  // the summary is only for showing; the server checks the sealed contents
  const sm = saveFile.summary ?? {};
  $('loadSummary').hidden = false;
  $('loadSummary').replaceChildren(
    h('strong', {}, String(sm.caseTitle ?? '알 수 없는 사건')),
    h('span', { class: 'muted small' }, `${sm.stageLabel ?? ''} · ${sm.roomName ?? ''} · 참가 ${(sm.players ?? []).length}명`),
    sm.savedAt ? h('span', { class: 'muted small' }, `저장 ${new Date(sm.savedAt).toLocaleString('ko-KR')}`) : null);
  const seats = Array.isArray(sm.seats) ? sm.seats : [];
  if (seats.length) {
    $('loadSeat').replaceChildren(...seats.map((x) => h('option', { value: String(x.id) }, `${x.nickname}의 자리`)));
    $('loadSeatField').hidden = false;
    if (!$('loadNick').value) $('loadNick').value = String(seats[0].nickname ?? '').slice(0, 12);
  }
});
$('loadSeat').addEventListener('change', () => {
  const seat = saveFile?.summary?.seats?.find((x) => x.id === $('loadSeat').value);
  if (seat) $('loadNick').value = String(seat.nickname).slice(0, 12);
});
$('loadForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!saveFile) return toast('저장 파일을 먼저 골라 주세요.');
  const nickname = $('loadNick').value.trim();
  const body = { nickname, file: saveFile };
  if (!$('loadSeatField').hidden) body.seatId = $('loadSeat').value;
  const res = await api('POST', '/api/rooms/import', { body });
  if (res.status !== 201) return toast(res.body?.error?.message ?? '저장 파일로 방을 열지 못했어요.');
  seats.save(res.body.code, { token: res.body.token, playerId: res.body.playerId, nickname });
  location.hash = res.body.code;
});

$('joinForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const code = $('joinCode').value.trim().toUpperCase();
  const nickname = $('joinNick').value.trim();
  const res = await api('POST', `/api/rooms/${encodeURIComponent(code)}/join`, { body: { nickname } });
  if (res.status !== 201) return toast(res.body?.error?.message ?? '참가하지 못했어요.');
  seats.save(res.body.code, { token: res.body.token, playerId: res.body.playerId, nickname });
  location.hash = res.body.code;
});

// ---------- rooms joined in this browser ----------
// Each row asks the server what we are there: the host may delete the room, anyone may drop it
// from this list, and rooms that are gone say so.
async function roomRole(code, list) {
  let gone = true;
  for (const seat of list) {
    const res = await api('GET', `/api/rooms/${code}/state`, { token: seat.token });
    if (res.status === 200) {
      gone = false;
      if (res.body.me.isHost) return { role: 'host', seat, stage: res.body.room.stageLabel };
    } else if (res.status === 401) {
      seats.forget(code, seat.token);
    }
  }
  return { role: gone ? 'gone' : 'member' };
}

async function removeRoom(code, list, info) {
  if (info.role === 'host') {
    if (!confirm(`방 ${code}을(를) 삭제할까요?
모든 참가자가 나가고 진행 상황과 저장 칸이 함께 지워져요. 되돌릴 수 없어요.`)) return;
    const res = await api('DELETE', `/api/rooms/${code}`, { token: info.seat.token });
    if (res.status !== 200 && res.status !== 404 && res.status !== 410) return toast(res.body?.error?.message ?? '방을 삭제하지 못했어요.');
    toast(`방 ${code}을(를) 삭제했어요.`, 'good');
  }
  for (const seat of list) seats.forget(code, seat.token);
  renderRecent();
}

let recentChecked = false;
function renderRecent() {
  const recent = Object.entries(seats.all());
  $('recentCard').hidden = !recent.length;
  $('recentSummary').textContent = recent.length ? `${recent.length}개` : '';
  if (!recentChecked) return;
  $('recent').replaceChildren(...recent.map(([code, list]) => {
    const action = h('button', { type: 'button', class: 'small', disabled: true }, '확인 중…');
    const status = h('span', { class: 'muted small' }, list.map((s) => s.nickname).join(', '));
    roomRole(code, list).then((info) => {
      action.disabled = false;
      if (info.role === 'host') {
        action.textContent = '방 삭제';
        action.classList.add('danger');
        status.textContent = `${status.textContent} · 방장 · ${info.stage}`;
      } else {
        action.textContent = '목록에서 빼기';
        if (info.role === 'gone') status.textContent = '없어진 방';
      }
      action.onclick = () => removeRoom(code, list, info);
    });
    return h('li', { class: 'room-row' },
      h('a', { href: `#${code}`, class: 'room' }, h('span', {}, h('span', { class: 'small' }, '방 '), h('span', { class: 'room__code' }, code)), status),
      action);
  }));
}
renderRecent();
// each saved room is a request (a link to a host browser in the Pages build): only when looked at
$('recentCard').querySelector('.drawer__head').addEventListener('click', () => {
  if (recentChecked) return;
  recentChecked = true;
  renderRecent();
});

$('emblem').append(icon('search'));
for (const el of document.querySelectorAll('[data-icon]')) el.replaceWith(icon(el.dataset.icon));
loadCases();
