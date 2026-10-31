// The detective agency's casebook: each solved case leaves a souvenir on the office shelf, a few
// achievements give a reason to play again, and the agency's liaison says a word between cases.
// Kept in this browser only (localStorage); nothing here is sent anywhere.
import { h } from './net.js';

const KEY = 'mystery:casebook';

export function readCasebook() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    return saved && typeof saved === 'object' ? saved : {};
  } catch {
    return {};
  }
}

// Called once a room's result is in; keeps each case's best run.
export function recordCase(c, r) {
  const book = readCasebook();
  const run = {
    title: c.title,
    theme: c.theme ?? null,
    correct: r.correct,
    total: r.total,
    proved: r.proved ?? 0,
    proofTotal: r.proofTotal ?? 0,
    clues: r.stats?.clues ?? 0,
    clueTotal: r.stats?.clueTotal ?? 0,
    minutes: r.stats?.minutes ?? null,
    difficulty: r.stats?.difficulty ?? 'guide',
    hints: r.stats?.hints ?? 0,
    at: new Date().toISOString(),
  };
  const old = book[c.id];
  const better = !old || run.correct + run.proved > old.correct + old.proved;
  // achievements count every run, so keep what each run reached even when it was not the best
  const reached = new Set([...(old?.reached ?? []), ...ACHIEVEMENTS.filter((a) => a.test(run)).map((a) => a.id)]);
  book[c.id] = { ...(better ? run : old), runs: (old?.runs ?? 0) + 1, reached: [...reached] };
  try {
    localStorage.setItem(KEY, JSON.stringify(book));
  } catch {
    // storage blocked: the shelf stays as it was
  }
  return book;
}

// Achievements earned by a single run of any case
export const ACHIEVEMENTS = [
  { id: 'solved', name: '첫 해결', text: '사건 하나를 끝까지 풀었어요.', test: () => true },
  { id: 'perfect', name: '빈틈없는 추리', text: '최종 추리를 모두 맞혔어요.', test: (r) => r.correct === r.total },
  { id: 'proof', name: '증거로 말하기', text: '근거 카드를 모두 맞게 골랐어요.', test: (r) => r.proofTotal > 0 && r.proved === r.proofTotal },
  { id: 'nohints', name: '힌트 없이', text: '탐정 이상 난이도에서 힌트를 받지 않고 절반 넘게 맞혔어요.', test: (r) => r.difficulty !== 'guide' && !r.hints && r.correct * 2 > r.total },
  { id: 'master', name: '명탐정', text: '명탐정 난이도로 모두 맞혔어요.', test: (r) => r.difficulty === 'master' && r.correct === r.total },
  { id: 'thorough', name: '모든 단서', text: '사건의 단서를 하나도 빠짐없이 찾았어요.', test: (r) => r.clueTotal > 0 && r.clues === r.clueTotal },
];

// One keepsake per case world, drawn on a 9×9 pixel grid
const SOUVENIRS = {
  train: { name: '마지막 운행 승차권', color: '#C9A640', rows: ['.........', '#########', '#.......#', '#.##.#..#', '#.......#', '#.#.###.#', '#.......#', '#########', '.........'] },
  stars: { name: '별자리 지도 조각', color: '#7FA7D9', rows: ['##.......', '####.....', '###..#...', '####...#.', '#####....', '###..#..#', '####.....', '######...', '#########'] },
  festival: { name: '축제 팔찌', color: '#C2453C', rows: ['..#####..', '.##...##.', '##.....##', '#.......#', '#.......#', '##.....##', '.##...##.', '..##.##..', '...###...'] },
  snow: { name: '저택 열쇠', color: '#9FB8C8', rows: ['.###.....', '#...#....', '#...#....', '.###.....', '..#......', '..#......', '..###....', '..#......', '..##.....'] },
  plain: { name: '사건 파일', color: '#A9832C', rows: ['.######..', '.#....##.', '.#.....#.', '.#.###.#.', '.#.....#.', '.#.###.#.', '.#.....#.', '.#######.', '.........'] },
};

function pixelSvg(rows, color) {
  let d = '';
  rows.forEach((r, y) => [...r].forEach((ch, x) => {
    if (ch === '#') d += `M${x} ${y}h1v1h-1z`;
  }));
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 9 9');
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'souvenir__art');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', color);
  svg.append(path);
  return svg;
}

// The liaison who hands out the files, a line for where the agency stands
function liaisonLine(book, cases) {
  const solved = cases.filter((c) => book[c.id]);
  const last = Object.entries(book).sort((a, b) => (b[1].at ?? '').localeCompare(a[1].at ?? ''))[0]?.[1];
  if (!solved.length) return '어서 와요, 백록 탐정단 연락 담당 윤서하예요. 의뢰 파일은 책상 위에 펼쳐 뒀어요. 마음에 드는 것부터 열어 보세요.';
  if (solved.length >= cases.length) return '들어온 의뢰가 전부 닫혔어요. 다들 고생했어요. 새 파일이 오면 제일 먼저 연락할게요.';
  const lead = last ? `‘${last.title}’ 보고서는 잘 받았어요. ` : '';
  return solved.length === 1
    ? `${lead}첫 사건치고 훌륭했어요. 다음 파일도 준비해 뒀어요.`
    : `${lead}이제 남은 파일은 ${cases.length - solved.length}건이에요. 쉬엄쉬엄 해요.`;
}

// The office card on the home page
export function officeCard(cases) {
  const book = readCasebook();
  const reached = new Set(Object.values(book).flatMap((x) => x.reached ?? []));
  const allDone = cases.length > 0 && cases.every((c) => book[c.id]);
  return h('section', { class: 'card office', 'aria-labelledby': 'officeTitle' },
    h('h3', { id: 'officeTitle' }, '탐정단 사무실'),
    h('p', { class: 'office__liaison' }, h('strong', {}, '윤서하 '), liaisonLine(book, cases)),
    h('h4', {}, '기념품 선반'),
    h('ul', { class: 'office__shelf' }, ...cases.map((c) => {
      const run = book[c.id];
      const s = SOUVENIRS[c.theme] ?? SOUVENIRS.plain;
      return h('li', { class: `souvenir${run ? '' : ' is-empty'}`, title: run ? `${c.title} · 최고 ${run.correct}/${run.total}` : '아직 해결하지 않은 사건' },
        pixelSvg(s.rows, run ? s.color : 'currentColor'),
        h('span', { class: 'small' }, run ? s.name : '빈 자리'),
        run ? h('span', { class: 'muted small' }, `${run.correct}/${run.total}`) : null);
    })),
    h('h4', {}, `업적 ${reached.size + (allDone ? 1 : 0)}/${ACHIEVEMENTS.length + 1}`),
    h('ul', { class: 'office__badges' },
      ...ACHIEVEMENTS.map((a) => h('li', { class: reached.has(a.id) ? 'is-on' : '' }, h('strong', {}, a.name), h('span', { class: 'muted small' }, a.text))),
      h('li', { class: allDone ? 'is-on' : '' }, h('strong', {}, '모든 의뢰 해결'), h('span', { class: 'muted small' }, '지금 있는 사건을 모두 풀었어요.'))),
    h('p', { class: 'muted small' }, '기록은 이 브라우저에만 남아요.'));
}
