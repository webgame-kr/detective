// Toasts as the HUD's pixel boxes (docs/pixel-toast-spec.md; looks in pxtoast.css). A toast is an
// icon cell for its kind and one line of text. The same toast again (same kind, same words) shows
// once with a count. At most three stay up at a time, not counting new clues, which sit on top.
// Errors stay longer and close when pressed. Time stops while a toast is pointed at or focused.
import { h } from './net.js';

// cold / freeze: warmth in the snow (playerstat:v1); prints / prints_blur: footprints photographed
// stop_warn / stop_missed: the train's departure broadcast and the train gone without you (stops:v1)
// dance_slot / dance_done / dance_loop: a dance's empty place stepped on, danced through, the show starting over (gimmick dance)
const KINDS = ['info', 'good', 'notice', 'error', 'cold', 'freeze', 'prints', 'prints_blur', 'stop_warn', 'stop_missed', 'dance_slot', 'dance_done', 'dance_loop'];
const SHOWN_MS = 3800;
const ERROR_MS = 6000;
const MAX = 3;
const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// 12×12 dot icons, fixed markup only: no entry (info), check (good), bell (notice), "!" (error)
const ICONS = {
  info: '<path d="M4 1h4v1H4zM2 2h2v1H2zM8 2h2v1H8zM1 3h1v6H1zM10 3h1v6H10zM2 9h2v1H2zM8 9h2v1H8zM4 10h4v1H4z"/><path d="M3 5h6v2H3z"/>',
  good: '<path d="M1 6h2v1H1zM2 7h2v1H2zM3 8h2v1H3zM4 9h2v1H4zM5 8h2v1H5zM6 7h2v1H6zM7 6h2v1H7zM8 5h2v1H8zM9 4h2v1H9zM10 3h1v1H10z"/>',
  notice: '<path d="M5 1h2v1H5zM3 2h6v1H3zM2 3h8v5H2zM1 8h10v1H1z"/><path d="M5 10h2v1H5z"/>',
  error: '<path d="M5 1h2v7H5zM5 9h2v2H5z"/>',
};
// 16×16 dot icons of the snow HUD (ui_snowhud): a snowflake, two footprints
const FLAKE16 = '<path d="M7 0h2v16H7zM0 7h16v2H0zM3 3h2v2H3zM11 3h2v2h-2zM3 11h2v2H3zM11 11h2v2h-2z"/>';
const PRINTS16 = '<path d="M3 1h4v7H3zM3 9h4v3H3zM9 4h4v7H9zM9 12h4v3H9z"/>';
// a train from the front (ui_station): body with a window, bumper, wheels
const TRAIN16 = '<path fill-rule="evenodd" d="M4 1h8v1H4zM3 2h10v9H3zM5 3v2h6V3zM2 11h12v1H2zM4 12h2v2H4zM10 12h2v2h-2z"/>';
// an eighth note (ui_hud): stem, flag, head
const NOTE16 = '<path d="M9 2h2v10H9zM11 3h2v2h-2zM13 5h1v3h-1zM5 10h4v4H5zM4 11h1v2H4z"/>';
const ICONS16 = { cold: FLAKE16, freeze: FLAKE16, prints: PRINTS16, prints_blur: PRINTS16, stop_warn: TRAIN16, stop_missed: TRAIN16, dance_slot: NOTE16, dance_done: NOTE16, dance_loop: NOTE16 };
export const NOTE_ICON = `<svg viewBox="0 0 16 16" aria-hidden="true">${NOTE16}</svg>`;

function kindIcon(kind) {
  const cell = h('span', { class: 'toast__icon', 'aria-hidden': 'true' });
  cell.innerHTML = ICONS16[kind] ? `<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">${ICONS16[kind]}</svg>` : `<svg viewBox="0 0 12 12" xmlns="http://www.w3.org/2000/svg">${ICONS[kind]}</svg>`;
  return cell;
}

export function toast(text, kind = 'info') {
  if (!KINDS.includes(kind)) kind = 'info';
  const box = document.getElementById('toasts');
  if (!box) return;
  const same = [...box.children].find((el) => el.dataset.kind === kind && el.dataset.text === text && !el.classList.contains('out'));
  if (same) return again(same);
  const count = h('span', { class: 'toast__count', hidden: true });
  const el = h('div', { class: `toast ${kind}`, role: kind === 'error' ? 'alert' : 'status', 'aria-live': kind === 'error' ? 'assertive' : null },
    kind === 'error' ? h('button', { type: 'button', class: 'toast__hit', 'aria-label': '알림 닫기', onclick: () => dismiss(el) }) : null,
    kindIcon(kind), h('span', { class: 'toast__text' }, text), count);
  Object.assign(el.dataset, { kind, text });
  el.toastMs = kind === 'error' ? ERROR_MS : SHOWN_MS;
  el.toastCount = 1;
  show(box, el);
}

// A new clue: what to show inside (the clue card and a line), and what pressing it opens.
export function clueToast(content, onOpen) {
  const box = document.getElementById('toasts');
  if (!box) return;
  const el = h('button', { type: 'button', class: 'toast badge-pop', onclick: () => {
    dismiss(el);
    onOpen?.();
  } }, ...content);
  el.toastMs = SHOWN_MS;
  show(box, el);
}

function show(box, el) {
  box.prepend(el);
  el.addEventListener('pointerenter', () => pause(el));
  el.addEventListener('focusin', () => pause(el));
  el.addEventListener('pointerleave', () => resume(el));
  el.addEventListener('focusout', () => setTimeout(() => resume(el)));
  arm(el, el.toastMs);
  // a fourth one pushes the oldest out at once
  const plain = [...box.children].filter((x) => !x.classList.contains('badge-pop') && !x.classList.contains('out'));
  for (const old of plain.slice(MAX)) {
    clearTimeout(old.toastTimer);
    old.remove();
  }
}

function again(el) {
  el.toastCount += 1;
  const count = el.querySelector('.toast__count');
  count.hidden = false;
  count.textContent = `×${el.toastCount}`;
  count.classList.remove('is-bump');
  void count.offsetWidth; // restart the bump
  count.classList.add('is-bump');
  arm(el, el.toastMs);
}

function arm(el, ms) {
  clearTimeout(el.toastTimer);
  el.toastLeft = ms;
  el.toastAt = Date.now();
  if (!el.toastHeld) el.toastTimer = setTimeout(() => dismiss(el), ms);
}

function pause(el) {
  if (el.toastHeld || el.classList.contains('out')) return;
  el.toastHeld = true;
  clearTimeout(el.toastTimer);
  el.toastLeft -= Date.now() - el.toastAt;
}

function resume(el) {
  if (!el.toastHeld || el.matches(':hover') || el.contains(document.activeElement)) return;
  el.toastHeld = false;
  arm(el, Math.max(el.toastLeft, 1200));
}

function dismiss(el) {
  if (el.classList.contains('out')) return;
  clearTimeout(el.toastTimer);
  el.classList.add('out');
  setTimeout(() => el.remove(), reduce() ? 0 : 300);
}
