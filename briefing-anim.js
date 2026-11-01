// Briefing animation: a short pixel scene above the case briefing text.
// The scene is drawn in code at 160x90 and scaled up by CSS with no smoothing, so it needs no image
// files. Each case picks its scene by meta.theme; a theme without a scene shows nothing.
// Reduced motion: the last frame is shown at once, with the captions as plain text.

const W = 160;
const H = 90;

const STYLE = `
.brief-anim { margin: 14px 0 20px; }
.brief-anim__frame { position: relative; max-width: 640px; }
.brief-anim canvas { display: block; width: 100%; aspect-ratio: 16 / 9; image-rendering: pixelated; image-rendering: crisp-edges; background: #202330; border: 3px solid #2a2622; box-shadow: 4px 4px 0 #2a2622; }
.brief-anim__caption { min-height: 1.6em; margin: 10px 0 0; font-size: 15px; line-height: 1.6; }
.brief-anim__caption.quote { font-style: normal; }
.brief-anim__bar { display: flex; gap: 8px; margin-top: 8px; }
.brief-anim__bar button[hidden] { display: none; }
`;

function injectStyle() {
  if (document.getElementById('brief-anim-style')) return;
  const s = document.createElement('style');
  s.id = 'brief-anim-style';
  s.textContent = STYLE;
  document.head.append(s);
}

// ---------- small pixel helpers ----------
function px(ctx, x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ease = (t) => t * t * (3 - 2 * t);
// a ridge line that repeats smoothly, for mountains that scroll forever
const ridge = (x, seed, amp) => amp * (Math.sin(x * 0.045 + seed) * 0.55 + Math.sin(x * 0.11 + seed * 2.3) * 0.3 + Math.sin(x * 0.23 + seed * 0.7) * 0.15);
const hash = (n) => {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
};

// ---------- 001 · 종착역에 없는 객차 ----------
// palette sampled from the case's own map tiles and the auditor's sprite
const T = {
  night: '#202330', dusk: '#303647', far: '#40475e', void: '#141620', haze: '#31516b', horizon: '#71829a', snow: '#a9c1ce',
  rock: '#382d36', rockLit: '#594039', pine: '#192e48', rail: '#71829a', tie: '#594039',
  body: '#884452', bodyDark: '#542d40', trim: '#d2a26c', window: '#e7d6ae', windowDim: '#997748',
  under: '#382d36', wheel: '#202330', lamp: '#edbf72', paper: '#e3d4bb', folder: '#997748',
  table: '#805344', coat: '#40475e', coatDark: '#292b40', skin: '#efbc9c', hair: '#494253',
  scarf: '#f6edd8', tie2: '#b86672', brass: '#edbf72', brassDark: '#997748', ink: '#2a2622',
};

const CAR_W = 30;
const CAR_H = 15;
const RAIL_Y = 76;

function sky(ctx, t) {
  const bands = [T.night, T.night, T.dusk, T.dusk, T.haze, T.horizon];
  const bh = 60 / bands.length;
  bands.forEach((c, i) => px(ctx, 0, i * bh, W, bh + 1, c));
  // dithered seams between bands keep the pixel look
  for (let i = 1; i < bands.length; i++) {
    const y = Math.round(i * bh);
    for (let x = (i % 2); x < W; x += 2) px(ctx, x, y - 1, 1, 1, bands[i]);
  }
  for (let i = 0; i < 18; i++) {
    const x = Math.floor(hash(i) * W);
    const y = Math.floor(hash(i + 40) * 24);
    const on = Math.sin(t * 3 + i * 1.7) > -0.3;
    if (on) px(ctx, x, y, 1, 1, i % 4 === 0 ? T.window : T.snow);
  }
}

function mountains(ctx, scroll) {
  // far range, dusk-blue, with snow on the high peaks
  for (let x = 0; x < W; x++) {
    const wx = x + scroll * 0.15;
    const top = Math.round(42 - ridge(wx, 1.2, 16));
    px(ctx, x, top, 1, 70 - top, T.far);
    if (top < 34) px(ctx, x, top, 1, 1 + Math.floor((34 - top) / 4), T.snow);
  }
  // near range, the dark rock of the valley
  for (let x = 0; x < W; x++) {
    const wx = x + scroll * 0.4;
    const top = Math.round(56 - ridge(wx, 4.1, 9));
    px(ctx, x, top, 1, 80 - top, T.rock);
  }
}

function pines(ctx, scroll) {
  const off = (scroll * 1.0) % 14;
  for (let i = -1; i < W / 14 + 2; i++) {
    const x = i * 14 - off;
    const h = 8 + Math.floor(hash(i + Math.floor(scroll / 14)) * 6);
    for (let r = 0; r < h; r++) px(ctx, x + 4 - Math.floor(r / 2), 70 - h + r, 1 + Math.floor(r / 2) * 2, 1, T.pine);
  }
  px(ctx, 0, 70, W, 20, T.pine);
}

function track(ctx, scroll) {
  px(ctx, 0, RAIL_Y + 3, W, 11, T.night);
  const off = (scroll * 2.2) % 6;
  for (let x = -off; x < W; x += 6) px(ctx, x, RAIL_Y + 4, 3, 2, T.tie);
  px(ctx, 0, RAIL_Y + 3, W, 1, T.rail);
}

// one car; kind = 'staff' | 'cabin' | 'dining' | 'view' | 'view02'
function car(ctx, x, t, kind, lit = 1) {
  const bob = Math.floor((t * 4 + x * 0.07) % 2);
  const y = RAIL_Y - CAR_H - 2 + bob * 0;
  px(ctx, x, y + 2, CAR_W, CAR_H - 2, T.body);
  px(ctx, x + 1, y, CAR_W - 2, 2, T.bodyDark); // roof
  px(ctx, x, y + CAR_H - 3, CAR_W, 1, T.trim); // trim line
  px(ctx, x + 2, y + CAR_H - 1, CAR_W - 4, 2, T.under);
  // wheels
  for (const wx of [x + 4, x + 9, x + CAR_W - 12, x + CAR_W - 7]) px(ctx, wx, y + CAR_H + 1, 3, 2, T.wheel);
  const win = lit ? T.window : T.windowDim;
  if (kind === 'view') {
    // observation car: one long glass band and round-cornered windows
    for (let i = 0; i < 4; i++) {
      const wx = x + 3 + i * 6;
      px(ctx, wx + 1, y + 4, 3, 5, win);
      px(ctx, wx, y + 5, 5, 3, win);
    }
  } else if (kind === 'view02') {
    // the other observation car: square windows with a hooked latch, a brass corner
    for (let i = 0; i < 4; i++) {
      const wx = x + 3 + i * 6;
      px(ctx, wx, y + 4, 5, 5, win);
      px(ctx, wx + 4, y + 6, 1, 1, T.ink);
    }
    px(ctx, x + CAR_W - 3, y + 9, 2, 2, T.brass);
  } else {
    const n = kind === 'staff' ? 3 : 5;
    const gap = Math.floor((CAR_W - 4) / n);
    for (let i = 0; i < n; i++) px(ctx, x + 3 + i * gap, y + 5, gap - 2, 3, win);
    if (kind === 'dining') px(ctx, x + 3, y + 9, CAR_W - 6, 1, T.trim);
  }
  if (kind === 'staff') {
    // front of the train: headlamp and a soft beam
    px(ctx, x + CAR_W - 1, y + 9, 2, 2, T.lamp);
    for (let i = 0; i < 10; i++) if ((i + Math.floor(t * 8)) % 3) px(ctx, x + CAR_W + 2 + i * 2, y + 9 + Math.floor(i / 3), 1, 1, T.lamp);
  }
}

function train(ctx, t, { hideFrom = W + 40, rear = 'view' } = {}) {
  const left = 17;
  const kinds = [rear, 'dining', 'cabin', 'staff']; // left (rear) to right (front)
  kinds.forEach((k, i) => {
    const x = left + i * (CAR_W + 2);
    if (x >= hideFrom) return;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, hideFrom, H);
    ctx.clip();
    car(ctx, x, t, k);
    if (i < 3) px(ctx, x + CAR_W, RAIL_Y - 8, 2, 3, T.under); // coupler
    ctx.restore();
  });
}

function tunnel(ctx, edge) {
  // a rock shoulder the line runs into; the portal's left jamb is the edge the cars vanish behind
  for (let x = Math.floor(edge) - 8; x < W; x++) {
    const d = x - (edge - 8);
    const top = Math.round(Math.max(13 + ridge(x * 1.5, 5.5, 4), 50 - d * 0.9 - ridge(x * 2, 3.3, 3)));
    px(ctx, x, top, 1, RAIL_Y + 3 - top, T.rock);
    // a few lit flecks so the rock reads as stone, not a flat wall
    for (let y = top + 3; y < RAIL_Y - 2; y += 5) if (hash(x * 13 + y) > 0.86) px(ctx, x, y, 2, 1, T.rockLit);
    px(ctx, x, top, 1, 1, T.rockLit);
  }
  // the opening: dark inside, a stone arch around it
  const ox = Math.floor(edge), ow = 30, oy = 50;
  px(ctx, ox - 3, oy - 4, ow + 6, 4, T.rockLit);
  for (let i = 0; i < ow + 6; i += 4) px(ctx, ox - 3 + i, oy - 4, 1, 4, T.rock);
  px(ctx, ox - 3, oy, 3, RAIL_Y + 3 - oy, T.rockLit);
  px(ctx, ox + ow, oy, 3, RAIL_Y + 3 - oy, T.rockLit);
  px(ctx, ox, oy, ow, RAIL_Y + 3 - oy, T.void);
  px(ctx, ox + 1, oy - 1, ow - 2, 1, T.void);
}

function diningCloseUp(ctx, t) {
  // the dining car's side, close: Han at a table behind the glass
  px(ctx, 0, 0, W, H, T.body);
  px(ctx, 0, 0, W, 6, T.bodyDark);
  px(ctx, 0, 74, W, 2, T.trim);
  px(ctx, 0, 76, W, 14, T.under);
  const wx = 30, wy = 12, ww = 100, wh = 56;
  px(ctx, wx - 3, wy - 3, ww + 6, wh + 6, T.rockLit);
  px(ctx, wx, wy, ww, wh, T.window);
  px(ctx, wx, wy + wh - 18, ww, 18, T.trim);
  // lamp on the wall inside
  px(ctx, wx + 12, wy + 6, 4, 6, T.lamp);
  // Han, seated, from the waist up
  const hx = wx + 52, hy = wy + 14;
  const look = t > 1.6 ? 1 : 0; // after closing the file he looks up, toward us
  px(ctx, hx + 2, hy - 2, 12, 4, T.hair);
  px(ctx, hx + 2, hy + 2, 12, 10, T.skin);
  px(ctx, hx + 2, hy + 2, 12, 2, T.hair);
  px(ctx, hx + 5 + look, hy + 6 - look, 2, 2, T.ink);
  px(ctx, hx + 10 + look, hy + 6 - look, 2, 2, T.ink);
  px(ctx, hx - 2, hy + 12, 20, 14, T.coat);
  px(ctx, hx + 4, hy + 12, 8, 3, T.scarf);
  px(ctx, hx + 7, hy + 15, 2, 6, T.tie2);
  px(ctx, hx - 2, hy + 12, 2, 14, T.coatDark);
  // the table and the file
  px(ctx, wx + 18, wy + 38, 64, 4, T.table);
  px(ctx, wx + 20, wy + 42, 4, 14, T.table);
  px(ctx, wx + 76, wy + 42, 4, 14, T.table);
  px(ctx, wx + 70, wy + 33, 5, 5, T.scarf); // teacup
  px(ctx, wx + 75, wy + 34, 1, 2, T.scarf);
  const close = clamp((t - 0.7) / 0.6, 0, 1);
  const fw = Math.round(30 - 15 * ease(close));
  px(ctx, wx + 34, wy + 34, fw, 4, close < 1 ? T.paper : T.folder);
  if (close < 1) for (let i = 0; i < 3; i++) px(ctx, wx + 36, wy + 35 + i, Math.max(0, fw - 6), 1, i === 1 ? T.ink : T.paper);
  // hands on the file
  px(ctx, wx + 34 + fw - 4, wy + 32, 4, 3, T.skin);
  // the departure bell rings near the end of the shot
  const ring = t - 1.9;
  const bx = 142, by = 8;
  const swing = ring > 0 ? Math.round(Math.sin(ring * 18) * 2 * Math.max(0, 1 - ring / 0.8)) : 0;
  px(ctx, bx + swing, by, 2, 3, T.brassDark);
  px(ctx, bx - 3 + swing, by + 3, 8, 6, T.brass);
  px(ctx, bx - 4 + swing, by + 9, 10, 2, T.brassDark);
  if (ring > 0 && ring < 0.9) {
    const r = Math.floor(ring * 14);
    for (let a = 0; a < 12; a++) {
      const ang = (a / 12) * Math.PI * 2;
      px(ctx, bx + 1 + Math.cos(ang) * (8 + r), by + 6 + Math.sin(ang) * (8 + r) * 0.6, 1, 1, T.brass);
    }
  }
}

const trainScene = {
  duration: 9.4,
  captions: [
    [0, '산악 순환 노선 백록선의 마지막 운행.', false],
    [3.2, '“확인할 것이 조금 남았습니다.”', true],
    [5.1, '출발을 알리는 종이 울린다.', false],
    [6.6, '그리고 터널로 들어서는 순간, 맨 끝 객차가…', false],
  ],
  draw(ctx, t) {
    if (t < 3.2 || t >= 5.6) {
      // wide shot; the scenery scrolls while the train holds the frame
      const speed = 30;
      const scroll = t * speed;
      sky(ctx, t);
      mountains(ctx, scroll);
      pines(ctx, scroll);
      track(ctx, scroll);
      let edge = W + 40;
      let rear = 'view';
      if (t >= 5.6) {
        edge = clamp(W + 12 - (t - 5.8) * 58, 14, W + 12);
        // the rear car flickers between two cars as it slips into the dark
        const f = t - 7.85;
        if (f > 0 && f < 0.75) rear = Math.floor(f / 0.12) % 2 ? 'view02' : 'view';
      }
      train(ctx, t, { hideFrom: edge, rear });
      if (edge < W + 12) tunnel(ctx, edge);
      // one last flicker inside the tunnel on the held frame
      if (t > 8.9) {
        const on = Math.floor((t - 8.9) / 0.15) % 2 === 0 && t < 9.3;
        if (on) for (let i = 0; i < 4; i++) px(ctx, 18 + i * 6, RAIL_Y - 12, 3, 2, T.windowDim);
      }
    } else {
      diningCloseUp(ctx, t - 3.2);
    }
  },
};


// ---------- shared: a 3x5 pixel font for the few digits a scene shows ----------
const DIGITS = {
  0: '111101101101111', 1: '010110010010111', 2: '111001111100111', 3: '111001111001111', 4: '101101111001001',
  5: '111100111001111', 6: '111100111101111', 7: '111001001001001', 8: '111101111101111', 9: '111101111001111', ':': '000010000010000',
};
function digits(ctx, str, x, y, color) {
  let cx = x;
  for (const ch of str) {
    const g = DIGITS[ch];
    if (g) for (let i = 0; i < 15; i++) if (g[i] === '1') px(ctx, cx + (i % 3), y + Math.floor(i / 3), 1, 1, color);
    cx += ch === ':' ? 3 : 4;
  }
}

// ---------- 002 · 백야제: 세 개의 경보 ----------
const F = {
  top: '#14102d', night: '#18234e', navy: '#293871', skyline: '#3a3750', skylineLit: '#4b3737',
  brick: '#935442', brickDark: '#64342f', brickLit: '#b36945', stone: '#ad978d', water: '#244b8d', waterLit: '#81a9db',
  string: '#3a3750', lantern: '#f2c46b', lanternOff: '#64342f', glow: '#a0884e', canvas: '#efd9bd',
  alarm: '#d4524a', alarmDim: '#6d346d', vault: '#1e3a2a', vaultLit: '#2e5440', shelf: '#7e5e42', shelfLit: '#a07a58',
  box: '#878b9e', boxDark: '#646775', label: '#efd9bd', seal: '#d4524a', lamp: '#efd9bd', dark: '#0c0a1c',
};

function festivalSkyline(ctx) {
  // theater fly tower (left), the workshop's power pylon (middle), the sluice gate (right)
  px(ctx, 6, 30, 30, 32, F.skyline);
  px(ctx, 12, 20, 16, 12, F.skyline);
  px(ctx, 10, 28, 20, 2, F.skylineLit);
  px(ctx, 70, 34, 22, 28, F.skyline);
  for (let i = 0; i < 18; i++) px(ctx, 80 - Math.floor(i / 3), 16 + i, 1 + Math.floor(i / 3) * 2, 1, F.skyline);
  px(ctx, 74, 24, 14, 1, F.skylineLit);
  px(ctx, 124, 36, 30, 26, F.skyline);
  px(ctx, 128, 26, 6, 12, F.skyline);
  px(ctx, 144, 26, 6, 12, F.skyline);
  px(ctx, 126, 26, 26, 3, F.skylineLit);
}

const DISTRICTS = [
  { x: 20, y: 17, at: 0.3, hand: 3 }, // theater, its clock runs ahead
  { x: 80, y: 13, at: 0.9, hand: 0 }, // workshop
  { x: 139, y: 22, at: 1.5, hand: -2 }, // sluice, its clock runs behind
];

function festivalLanterns(ctx, t, darkLeft) {
  for (const row of [{ y: 40, sag: 6, phase: 0 }, { y: 48, sag: 5, phase: 0.4 }]) {
    for (let x = 0; x < W; x++) {
      const y = row.y + Math.round(Math.sin((x / W) * Math.PI) * row.sag);
      px(ctx, x, y, 1, 1, F.string);
      if (x % 12 === 6) {
        const lit = t > row.phase + (x / W) * 2.6 && !(darkLeft && x < 110);
        px(ctx, x - 1, y + 1, 3, 3, lit ? F.lantern : F.lanternOff);
        if (lit) px(ctx, x, y + 4, 1, 1, F.glow);
      }
    }
  }
}

function festivalPlaza(ctx, t) {
  [F.top, F.top, F.night, F.night, F.navy].forEach((c, i) => px(ctx, 0, i * 13, W, 14, c));
  for (let i = 0; i < 14; i++) {
    const x = Math.floor(hash(i + 7) * W);
    const y = Math.floor(hash(i + 70) * 22);
    if (Math.sin(t * 2.5 + i) > -0.2) px(ctx, x, y, 1, 1, F.canvas);
  }
  festivalSkyline(ctx);
  // brick plaza
  px(ctx, 0, 62, W, 28, F.brick);
  for (let y = 64; y < H; y += 4) {
    px(ctx, 0, y, W, 1, F.brickDark);
    for (let x = (y / 4) % 2 ? 0 : 4; x < W; x += 8) px(ctx, x, y - 3, 1, 3, F.brickDark);
  }
  // market tents
  for (const tx of [4, 136]) {
    for (let r = 0; r < 9; r++) px(ctx, tx + 10 - r, 52 + r, r * 2 + 1, 1, r % 2 ? F.canvas : F.brickLit);
    px(ctx, tx + 1, 61, 18, 6, F.brickDark);
  }
  // the fountain
  px(ctx, 62, 66, 36, 8, F.stone);
  px(ctx, 64, 66, 32, 4, F.water);
  px(ctx, 78, 58, 4, 9, F.stone);
  const jet = Math.floor(t * 6) % 3;
  px(ctx, 79, 54 + jet, 2, 3, F.waterLit);
  px(ctx, 74 + jet * 2, 64, 1, 1, F.waterLit);
  px(ctx, 84 - jet * 2, 63, 1, 1, F.waterLit);
}

function festivalAlarms(ctx, t) {
  // t is time since the alarms began; each district fires at its own beat
  DISTRICTS.forEach((d, i) => {
    const on = t > d.at && Math.floor((t - d.at) / 0.18) % 2 === 0;
    px(ctx, d.x, d.y, 3, 3, on ? F.alarm : F.alarmDim);
    if (on) {
      px(ctx, d.x - 2, d.y + 1, 1, 1, F.alarm);
      px(ctx, d.x + 4, d.y + 1, 1, 1, F.alarm);
    }
    // a tiny clock face beside each lamp; the hands do not agree
    const cx = d.x + (i === 2 ? -10 : 6), cy = d.y - 1;
    px(ctx, cx, cy, 5, 5, F.canvas);
    px(ctx, cx + 2, cy + 1, 1, 2, F.skyline);
    px(ctx, cx + 2 + Math.sign(d.hand), cy + 2 + (Math.abs(d.hand) > 1 ? 1 : 0), 1, 1, F.skyline);
  });
  // the broadcast from the sluice: rings from its loudspeaker
  const b = t - DISTRICTS[2].at;
  if (b > 0) for (let k = 0; k < 2; k++) {
    // two clean arcs opening toward the plaza
    const r = ((b * 9 + k * 6) % 12) + 4;
    for (let a = -4; a <= 4; a++) px(ctx, 136 - Math.round(Math.cos(a * 0.22) * r), 23 + Math.round(Math.sin(a * 0.22) * r), 1, 1, F.alarm);
  }
}

function festivalVault(ctx, t) {
  // t: time in the shot. 0.6 power fails, 1.9 power returns, the box is gone
  const dark = t > 0.6 && t < 1.9;
  px(ctx, 0, 0, W, H, F.vault);
  for (let x = 0; x < W; x += 10) px(ctx, x, 0, 1, 64, F.vaultLit);
  px(ctx, 0, 64, W, 26, F.shelf);
  px(ctx, 20, 52, 120, 4, F.shelfLit);
  px(ctx, 22, 56, 4, 8, F.shelf);
  px(ctx, 134, 56, 4, 8, F.shelf);
  // other boxes that stay
  px(ctx, 26, 40, 18, 12, F.boxDark);
  px(ctx, 112, 42, 16, 10, F.boxDark);
  const gone = t >= 1.9;
  if (!gone) {
    px(ctx, 66, 34, 28, 18, F.box);
    px(ctx, 66, 34, 28, 3, F.boxDark);
    px(ctx, 76, 40, 8, 4, F.label);
    px(ctx, 92, 36, 2, 14, F.seal);
  } else {
    // the clean patch left in the dust where it stood
    px(ctx, 66, 51, 28, 1, F.label);
    for (let x = 66; x < 94; x += 3) px(ctx, x, 50, 1, 1, F.label);
  }
  // the lamp overhead
  px(ctx, 77, 4, 6, 4, dark ? F.boxDark : F.lamp);
  if (!dark) for (let i = 0; i < 18; i++) if (i % 2 === 0) px(ctx, 79 - i, 9 + i * 2, 1, 1, F.vaultLit);
  if (dark) {
    ctx.globalAlpha = 0.82;
    px(ctx, 0, 0, W, H, F.dark);
    ctx.globalAlpha = 1;
    // the red alarm sweeps across the dark room
    const sweep = Math.floor(((t - 0.6) * 140) % (W + 40)) - 20;
    for (let i = 0; i < 20; i++) px(ctx, sweep + i, 10 + i * 3, 2, 1, F.alarm);
  } else if (gone) {
    // a slow red pulse after the lights return
    if (Math.floor(t / 0.5) % 2 === 0) px(ctx, 0, 0, W, 2, F.alarm);
  }
}

const festivalScene = {
  duration: 9.6,
  captions: [
    [0, '축제 전날 밤, 광장에 하나둘 등불이 켜진다.', false],
    [3.6, '극장, 작업장, 수문. 세 구역에서 경보가 어긋난 박자로 울렸다.', false],
    [6.6, '불이 다시 들어왔을 때, 공동 기금 보관함은 없었다.', false],
  ],
  draw(ctx, t) {
    if (t < 6.6) {
      festivalPlaza(ctx, t);
      const a = t - 3.6;
      // the workshop's power cut takes the lanterns on its side with it
      festivalLanterns(ctx, t, a > DISTRICTS[1].at && a < 2.6);
      if (a > 0) festivalAlarms(ctx, a);
    } else {
      festivalVault(ctx, t - 6.6);
    }
  },
};

// ---------- 003 · 설원 저택의 마지막 손님 ----------
const S = {
  top: '#2c3139', sky: '#374e6b', skyLow: '#4a678a', snow: '#eaf6ff', snowShade: '#c2cfde', snowDeep: '#95a4b4',
  wall: '#5a3a28', wallDark: '#3a2418', roof: '#454c58', trim: '#8e3b4a', window: '#edd6b6', windowWarm: '#dec26d',
  windowOff: '#2a1c14', glass: '#b2d0ed', glassLit: '#e4f3ff', frame: '#5b7a97', figure: '#2a1c14', bundle: '#6f4938',
  box: '#7a5a3a', boxDark: '#3a2418', floor: '#89a6c3',
};

function snowfall(ctx, t, layer, count, speed) {
  for (let i = 0; i < count; i++) {
    const x = (hash(i + layer * 100) * W + Math.sin(t * 1.3 + i) * 3 + t * 6) % W;
    const y = (hash(i + layer * 100 + 50) * H + t * speed) % H;
    px(ctx, x, y, layer, layer, layer > 1 ? S.snow : S.snowShade);
  }
}

// windows: [x, y, w, h, light-up time]; the last is the study at the end of the glass gallery
const MANOR_WINDOWS = [
  [34, 40, 5, 6, 0.4], [44, 40, 5, 6, 0.7], [54, 40, 5, 6, 1.0], [64, 40, 5, 6, 1.3],
  [34, 52, 5, 6, 1.6], [44, 52, 5, 6, 0.5], [54, 52, 5, 6, 1.9], [64, 52, 5, 6, 0.9],
  [49, 28, 6, 6, 2.2],
];
const STUDY = [138, 50, 8, 7];

function manorWide(ctx, t, studyLit) {
  px(ctx, 0, 0, W, 30, S.top);
  px(ctx, 0, 30, W, 20, S.sky);
  px(ctx, 0, 50, W, 20, S.skyLow);
  // the main house
  px(ctx, 28, 34, 48, 32, S.wall);
  for (let r = 0; r < 14; r++) px(ctx, 26 + r, 34 - r, 52 - r * 2, 1, r < 2 ? S.snow : S.roof);
  px(ctx, 26, 33, 52, 2, S.snow);
  px(ctx, 47, 24, 10, 12, S.wall);
  px(ctx, 46, 23, 12, 2, S.snow);
  // the glass gallery running east to the study
  px(ctx, 76, 50, 56, 12, S.frame);
  px(ctx, 76, 49, 56, 1, S.snow);
  for (let x = 78; x < 130; x += 6) px(ctx, x, 51, 4, 9, t > 2.4 ? S.glassLit : S.glass);
  // the study at the far end
  px(ctx, 132, 44, 20, 22, S.wallDark);
  for (let r = 0; r < 6; r++) px(ctx, 131 + r, 44 - r, 22 - r * 2, 1, r < 1 ? S.snow : S.roof);
  px(ctx, STUDY[0], STUDY[1], STUDY[2], STUDY[3], studyLit ? S.windowWarm : S.windowOff);
  MANOR_WINDOWS.forEach(([x, y, w, h, at]) => px(ctx, x, y, w, h, t > at ? S.window : S.windowOff));
  // snowbanks
  px(ctx, 0, 64, W, 26, S.snowShade);
  for (let x = 0; x < W; x++) px(ctx, x, 62 + Math.round(Math.sin(x * 0.15) * 1.5 + Math.sin(x * 0.04) * 2), 1, 4, S.snow);
}

function galleryClose(ctx, t) {
  // inside the glass gallery: the figure carries a bundle from the study end and leaves it in the mending box
  px(ctx, 0, 0, W, H, S.top);
  px(ctx, 0, 62, W, 28, S.floor);
  for (let x = 0; x < W; x += 4) px(ctx, x, 62, 2, 1, S.glass);
  // glass panes with the snow outside
  for (let x = 4; x < W; x += 26) {
    px(ctx, x, 8, 22, 52, S.sky);
    px(ctx, x + 2, 10, 18, 48, S.skyLow);
  }
  snowfall(ctx, t, 1, 26, 14);
  for (let x = 0; x < W; x += 26) px(ctx, x, 6, 4, 56, S.frame);
  px(ctx, 0, 6, W, 3, S.frame);
  // the mending box against the wall
  px(ctx, 40, 50, 20, 14, S.box);
  px(ctx, 40, 50, 20, 3, S.boxDark);
  const lid = t > 1.6 && t < 2.2;
  if (lid) px(ctx, 40, 44, 3, 8, S.boxDark);
  // the figure, a shape with no face, from right to left
  let fx;
  if (t < 1.4) fx = 150 - t * 52;
  else if (t < 2.3) fx = 77;
  else fx = 77 - (t - 2.3) * 60;
  const step = Math.floor(t * 6) % 2;
  if (fx > -14) {
    px(ctx, fx + 3, 26, 6, 6, S.figure);
    px(ctx, fx + 1, 32, 10, 18, S.figure);
    px(ctx, fx + 2 + step, 50, 3, 12, S.figure);
    px(ctx, fx + 7 - step, 50, 3, 12, S.figure);
    if (t < 1.9) px(ctx, fx - 4, 38, 7, 6, S.bundle); // the bundle, until it goes in the box
  }
  // the warm light of the study door goes out behind
  px(ctx, 152, 20, 8, 42, t < 2.6 ? S.windowWarm : S.windowOff);
  snowfall(ctx, t, 2, 8, 22);
}

const snowScene = {
  duration: 9.6,
  captions: [
    [0, '폭설 속 저택, 재개관을 축하하는 저녁 식사.', false],
    [3.4, '회랑을 지나간 누군가. 얼굴은 보이지 않았다.', false],
    [6.6, '그리고 회랑 끝 서재의 불만 꺼져 있었다.', false],
  ],
  draw(ctx, t) {
    if (t < 3.4) {
      manorWide(ctx, t, true);
      snowfall(ctx, t, 1, 30, 12);
      snowfall(ctx, t, 2, 10, 20);
    } else if (t < 6.6) {
      galleryClose(ctx, t - 3.4);
    } else {
      manorWide(ctx, 9, false);
      snowfall(ctx, t, 1, 30, 12);
      snowfall(ctx, t, 2, 10, 20);
      // the one dark window, marked by a slow outline
      if (Math.floor((t - 6.6) / 0.45) % 2 === 0) {
        const [x, y, w, h] = STUDY;
        px(ctx, x - 1, y - 1, w + 2, 1, S.snow);
        px(ctx, x - 1, y + h, w + 2, 1, S.snow);
      }
    }
  },
};

// ---------- 004 · 별이 사라진 전시실 ----------
const R = {
  deep: '#101535', night: '#18224c', blue: '#29356d', dusk: '#49476d', hill: '#212b5c', hillLit: '#394678',
  wall: '#e2d2ae', wallDark: '#cdba92', dome: '#a3aebc', domeDark: '#5e6a7c', star: '#efe3c8', gold: '#c9a24a',
  plate: '#29356d', plateLine: '#81a9db', red: '#d64a3a', glass: '#81a9db', case: '#8e6a4a', caseDark: '#3a2e28',
  room: '#2c3a6b', flash: '#ffffff', tag: '#efe3c8', ink: '#231c2b', seal: '#efe3c8', sun: '#e8d9b6',
};

const CHART = [[54, 30], [60, 26], [66, 31], [72, 28], [62, 40], [76, 44], [84, 38], [90, 46], [96, 34], [102, 42], [70, 50], [88, 54]];
const CHART_LINES = [[0, 1], [1, 2], [2, 3], [4, 5], [5, 6], [6, 7], [8, 9], [10, 11]];

function observatory(ctx, t) {
  const dusk = clamp(1 - t / 2.4, 0, 1);
  px(ctx, 0, 0, W, H, R.deep);
  px(ctx, 0, 30, W, 30, dusk > 0.5 ? R.dusk : R.night);
  px(ctx, 0, 44, W, 20, dusk > 0.2 ? R.dusk : R.blue);
  for (let i = 0; i < 40; i++) {
    const appear = hash(i + 300) * 2.6;
    if (t > appear) px(ctx, Math.floor(hash(i + 3) * W), Math.floor(hash(i + 30) * 50), 1, 1, i % 6 ? R.star : R.gold);
  }
  // the hill
  for (let x = 0; x < W; x++) {
    const top = Math.round(62 - Math.sin((x / W) * Math.PI) * 12);
    px(ctx, x, top, 1, H - top, R.hill);
    px(ctx, x, top, 1, 1, R.hillLit);
  }
  // the building and its dome, with the slit opening
  px(ctx, 64, 40, 32, 12, R.wall);
  px(ctx, 64, 50, 32, 2, R.wallDark);
  for (let r = 0; r < 12; r++) {
    const w = Math.round(Math.sqrt(144 - r * r) * 2.3);
    px(ctx, 80 - w / 2, 40 - r, w, 1, r > 9 ? R.domeDark : R.dome);
  }
  const slit = Math.round(clamp((t - 1.2) / 1.2, 0, 1) * 3);
  if (slit) px(ctx, 80 - Math.floor(slit / 2), 28, slit, 12, R.deep);
  px(ctx, 74, 44, 4, 5, t > 0.6 ? R.gold : R.domeDark);
  px(ctx, 82, 44, 4, 5, t > 0.9 ? R.gold : R.domeDark);
}

function chart(ctx, withRed) {
  px(ctx, 44, 20, 72, 42, R.plate);
  CHART_LINES.forEach(([a, b]) => {
    const [x1, y1] = CHART[a];
    const [x2, y2] = CHART[b];
    const n = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
    for (let i = 0; i <= n; i += 2) px(ctx, x1 + ((x2 - x1) * i) / n, y1 + ((y2 - y1) * i) / n, 1, 1, R.plateLine);
  });
  CHART.forEach(([x, y]) => px(ctx, x, y, 1, 1, R.star));
  if (withRed) px(ctx, 64, 24, 2, 2, R.red);
}

function caseClose(ctx, t, { plate, red, tag, flash, seal, morning }) {
  px(ctx, 0, 0, W, H, morning ? R.wallDark : R.room);
  if (morning) for (let i = 0; i < 30; i++) px(ctx, 118 + i, i * 3, 14, 3, R.sun);
  px(ctx, 0, 72, W, 18, morning ? R.case : R.caseDark);
  // the case on its stand
  px(ctx, 36, 12, 88, 58, R.case);
  px(ctx, 40, 16, 80, 50, R.blue);
  if (plate) chart(ctx, red);
  else px(ctx, 44, 20, 72, 42, R.plate); // only the blue backing board is left
  // glass glint
  px(ctx, 100, 18, 1, 10, R.glass);
  px(ctx, 103, 18, 1, 6, R.glass);
  px(ctx, 56, 70, 48, 6, R.caseDark);
  if (seal) {
    // the paper seal across the front door, untouched
    px(ctx, 34, 40, 92, 4, R.seal);
    for (let x = 70; x < 90; x += 2) px(ctx, x, 41 + (x % 4 ? 1 : 0), 1, 1, R.ink);
  }
  if (tag) {
    px(ctx, 126, 78, 26, 9, R.tag);
    digits(ctx, tag, 129, 80, R.ink);
  }
  if (flash > 0) {
    ctx.globalAlpha = flash;
    px(ctx, 0, 0, W, H, R.flash);
    ctx.globalAlpha = 1;
  }
}

const starsScene = {
  duration: 9.6,
  captions: [
    [0, '폐관을 닷새 앞둔 언덕 위 청람천문관.', false],
    [3.2, '오후와 저녁, 같은 자리에서 찍은 두 장의 사진.', false],
    [6.6, '아침, 봉인은 그대로인데 성도가 사라졌다.', false],
  ],
  draw(ctx, t) {
    if (t < 3.2) return observatory(ctx, t);
    if (t < 6.6) {
      const s = t - 3.2;
      const evening = s >= 1.7;
      const shot = evening ? s - 1.7 : s;
      const flash = shot > 0.7 && shot < 1.0 ? 1 - (shot - 0.7) / 0.3 : 0;
      return caseClose(ctx, s, { plate: true, red: !evening, tag: evening ? '18:00' : '15:30', flash });
    }
    caseClose(ctx, t - 6.6, { plate: false, seal: true, morning: true });
  },
};


// ---------- 생방송에 없던 15분 (radio) ----------
// colours from the station cover, the studio map and the DJ sprite
const Q = {
  sky0: '#141626', sky1: '#181b2e', sky2: '#1d2236', sky3: '#232a42', far: '#2b3352', farLit: '#3a4466',
  wall: '#3b3a4d', wallLit: '#4d4c63', wallDark: '#2e2d3e', win: '#252736', lit: '#e7c879', litGlow: '#8a7a54',
  red: '#d4524a', redDark: '#2a1218', redGlow: '#6a2a32', tower: '#7d8593', beacon: '#ff5a4a', street: '#20212c', rain: '#5d6788',
  panel: '#4a3f52', panelLit: '#5a4d62', desk: '#8a6240', deskLit: '#a87b52', mic: '#2c2b3a', micLit: '#4a4b55',
  hair: '#5a3a2e', skin: '#efbc9c', cardigan: '#e6d6b2', glass: '#5b7a97', glassLit: '#9ec3df', console: '#3b3a4d',
  meter: '#7fe0a0', reel: '#2a2b33', reelLit: '#c9c9c9', clock: '#f3e8cf', ink: '#2a2622',
  conc: '#5d5e66', concDark: '#45464f', shelf: '#5e6470', box: '#b8925e', boxDark: '#8a6a46', label: '#f6edd8', beam: '#fff0b8',
};

function radioExterior(ctx, t) {
  [Q.sky0, Q.sky1, Q.sky2, Q.sky3].forEach((c, i) => px(ctx, 0, i * 15, W, 16, c));
  for (let i = 1; i < 4; i++) for (let x = i % 2; x < W; x += 2) px(ctx, x, i * 15 - 1, 1, 1, [Q.sky0, Q.sky1, Q.sky2, Q.sky3][i]);   // dithered seams
  for (let i = 0; i < 16; i++) if (Math.sin(t * 2 + i) > -0.4) px(ctx, Math.floor(hash(i + 900) * W), Math.floor(hash(i + 950) * 30), 1, 1, '#9aa3c0');
  // far skyline (대기 원근: paler, bluer)
  for (const [x0, w, h] of [[0, 30, 34], [26, 18, 24], [118, 20, 28], [134, 26, 36]]) {
    px(ctx, x0, 74 - h, w, h, Q.far);
    for (let y = 74 - h + 4; y < 70; y += 6) for (let x = x0 + 3; x < x0 + w - 3; x += 5) if (hash(x * 7 + y) > .6) px(ctx, x, y, 2, 2, Q.farLit);
  }
  // the station
  const bx = 42, by = 26, bw = 74, bh = 48;
  px(ctx, bx, by, bw, bh, Q.wall); px(ctx, bx, by, bw, 1, Q.wallLit); px(ctx, bx + bw - 3, by, 3, bh, Q.wallDark);
  const lit = [[1, 1], [2, 3], [0, 2]];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 6; c++) {
    const x = bx + 5 + c * 11, y = by + 6 + r * 14;
    const on = lit.some(([a, b]) => a === r && b === c) && t > 0.5 + c * 0.25;
    if (on) { for (let k = 0; k < 12; k += 2) px(ctx, x - 2 + k, y - 2, 1, 1, Q.litGlow); }   // 이미시브: spill on the wall
    px(ctx, x, y, 7, 8, on ? Q.lit : Q.win); px(ctx, x + 3, y, 1, 8, Q.wall);
  }
  // ON AIR sign switches on, with a red halo on the wall
  const onAir = t > 1.6;
  const sx = bx + 14, sy = by + 15;
  if (onAir) for (let k = -3; k < 21; k += 2) { px(ctx, sx + k, sy - 2, 1, 1, Q.redGlow); px(ctx, sx + k + 1, sy + 6, 1, 1, Q.redGlow); }
  px(ctx, sx - 1, sy - 1, 20, 7, Q.redDark); px(ctx, sx, sy, 18, 5, onAir ? Q.red : '#4a2a30');
  if (onAir) for (let k = 2; k < 16; k += 3) px(ctx, sx + k, sy + 2, 2, 1, '#ffe3dc');
  // the transmitter tower and its beacon
  const tx = bx + 56;
  for (let i = 0; i < 22; i++) { const w = Math.max(1, 5 - Math.floor(i / 5)); px(ctx, tx - w, by - 1 - i, 1, 1, Q.tower); px(ctx, tx + w, by - 1 - i, 1, 1, Q.tower); if (i % 5 === 0) px(ctx, tx - w, by - 1 - i, w * 2 + 1, 1, Q.tower); }
  const blink = Math.floor(t * 2) % 2 === 0;
  px(ctx, tx - 1, by - 24, 3, 2, blink ? Q.beacon : '#7a2a30');
  if (blink) { px(ctx, tx - 3, by - 24, 1, 1, Q.redGlow); px(ctx, tx + 3, by - 24, 1, 1, Q.redGlow); }
  px(ctx, 0, 74, W, 16, Q.street); px(ctx, 0, 74, W, 1, '#3a3b4c');
  for (let x = (t * 20) % 12 - 12; x < W; x += 12) px(ctx, x, 82, 6, 1, '#4a4a5e');
  // rain
  for (let i = 0; i < 46; i++) {
    const x = (hash(i + 400) * W + t * 18) % W, y = (hash(i + 470) * 90 + t * 70) % 90;
    px(ctx, x, y, 1, 1, Q.rain); px(ctx, x - 1, y + 1, 1, 1, Q.rain);
  }
}

function radioStudio(ctx, t) {
  // soundproofed wall, the ON AIR lamp, a clock, the window into the control room
  px(ctx, 0, 0, W, H, '#33303f');
  for (let x = 0; x < 96; x += 8) { px(ctx, x, 0, 8, 58, x % 16 ? Q.panel : Q.panelLit); px(ctx, x + 3, 4, 2, 50, '#3e3446'); }
  px(ctx, 96, 0, 64, 58, '#2a2938');
  px(ctx, 100, 10, 56, 36, Q.glass); px(ctx, 102, 12, 52, 32, '#2f4a62'); px(ctx, 102, 12, 52, 2, Q.glassLit);
  // the control room beyond the glass: console and a reel deck turning
  px(ctx, 104, 34, 48, 8, Q.console);
  for (let x = 106; x < 150; x += 3) px(ctx, x, 36, 1, 3, '#a3aebc');
  const rx = 140, ry = 22, ang = t * 6;
  px(ctx, rx - 8, ry - 6, 18, 12, '#5a4d42');
  for (const cx of [rx - 4, rx + 5]) {
    for (let a = 0; a < 6; a++) { const th = ang + a * Math.PI / 3; px(ctx, Math.round(cx + Math.cos(th) * 3), Math.round(ry + Math.sin(th) * 3), 1, 1, Q.reelLit); }
    px(ctx, cx, ry, 1, 1, Q.reel);
  }
  // ON AIR lamp with a red spill
  px(ctx, 30, 6, 30, 9, Q.redDark); px(ctx, 31, 7, 28, 7, Q.red);
  for (let k = 33; k < 56; k += 4) px(ctx, k, 9, 2, 3, '#ffe3dc');
  for (let k = 26; k < 64; k += 2) px(ctx, k, 17, 1, 1, Q.redGlow);
  // clock reading 22:04
  px(ctx, 72, 6, 18, 9, Q.ink); digits(ctx, '22:04', 72, 8, Q.clock);
  // desk and the microphone
  px(ctx, 0, 58, W, 32, '#2a2733');
  px(ctx, 10, 60, 100, 8, Q.desk); px(ctx, 10, 60, 100, 2, Q.deskLit); px(ctx, 10, 68, 100, 2, '#5a3a28');
  px(ctx, 62, 38, 2, 22, Q.mic); px(ctx, 58, 32, 9, 7, Q.micLit); px(ctx, 59, 33, 2, 5, '#6a6b78');
  // the DJ seen from behind, facing the mic: wavy hair over the shoulders, headphone band, cream cardigan
  px(ctx, 31, 29, 16, 3, Q.hair); px(ctx, 29, 32, 20, 12, Q.hair); px(ctx, 27, 38, 3, 12, Q.hair); px(ctx, 48, 38, 3, 12, Q.hair);
  px(ctx, 33, 31, 4, 2, '#7a5444'); px(ctx, 31, 34, 2, 1, '#7a5444');            // 애니소트로픽 하이라이트 on the hair
  px(ctx, 30, 28, 18, 2, '#2c2b33'); px(ctx, 28, 33, 3, 6, '#2c2b33'); px(ctx, 47, 33, 3, 6, '#2c2b33'); px(ctx, 48, 35, 2, 2, '#b86672');
  px(ctx, 26, 44, 26, 16, Q.cardigan); px(ctx, 26, 44, 2, 16, '#f3e8cf'); px(ctx, 49, 44, 3, 16, '#c9b791');
  px(ctx, 30, 44, 18, 2, '#c9b791');                                               // AO under the hair
  // the level meter keeps moving: the voice is on air
  px(ctx, 76, 46, 20, 10, '#1c1f2a');
  for (let i = 0; i < 6; i++) {
    const h = 1 + Math.floor((Math.sin(t * 11 + i * 1.7) * 0.5 + 0.5) * 7);
    px(ctx, 78 + i * 3, 55 - h, 2, h, i > 4 ? Q.red : Q.meter);
  }
}

function radioBasement(ctx, t) {
  // dark basement stairs and the archive shelf; a flashlight sweeps once, then the slot is empty
  px(ctx, 0, 0, W, H, '#191a24');
  for (let i = 0; i < 7; i++) { px(ctx, 6 + i * 6, 10 + i * 9, 30, 4, '#4a4e5a'); px(ctx, 6 + i * 6, 14 + i * 9, 30, 1, '#2a2b33'); }
  px(ctx, 4, 6, 2, 76, '#5e6470'); px(ctx, 36, 6, 2, 30, '#5e6470');
  // 쇳소리: two short strokes ring off the iron stairs
  const clank = t > 0.3 && t < 1.2;
  if (clank) for (let k = 0; k < 3; k++) { const r = 4 + k * 3 + Math.floor((t - 0.3) * 8); px(ctx, 22 + r, 34 - k, 2, 1, '#c9c9c9'); px(ctx, 22 - r, 36 - k, 2, 1, '#c9c9c9'); }
  // the shelf
  const sx = 70, sy = 26;
  px(ctx, sx, sy, 80, 46, Q.shelf); px(ctx, sx, sy, 80, 2, '#7d8593');
  for (let row = 0; row < 3; row++) {
    px(ctx, sx + 2, sy + 15 + row * 14, 76, 2, '#454a56');
    for (let c = 0; c < 7; c++) {
      const bxx = sx + 4 + c * 11, byy = sy + 4 + row * 14;
      const slot = row === 1 && c === 3;
      if (slot && t > 1.9) {
        px(ctx, bxx, byy, 9, 11, '#262833');               // empty slot
        for (let k = 0; k < 9; k += 2) px(ctx, bxx + k, byy + 10, 1, 1, '#6a6e7a');   // dust edge
        continue;
      }
      px(ctx, bxx, byy, 9, 11, c % 2 ? Q.box : Q.boxDark); px(ctx, bxx + 2, byy + 3, 5, 3, Q.label);
      if (slot) px(ctx, bxx + 2, byy + 3, 5, 3, '#edbf72');
    }
  }
  digits(ctx, '1997', sx + 36, sy + 48, '#9aa3c0');
  // ambient: the whole basement sits in cool dark; a flashlight crosses once
  const beamX = -30 + (t - 0.9) * 140;
  if (t > 0.9 && t < 2.2) {
    for (let y = 0; y < H; y++) for (let x = Math.floor(beamX); x < beamX + 26; x++) {
      if (x < 0 || x >= W) continue;
      const d = Math.abs(x - (beamX + 13 + (y - 45) * 0.15)) / 13;
      if (d < 1 && (d < 0.55 || (x + y) % 2 === 0)) { ctx.globalAlpha = d < .55 ? 0.22 : 0.12; px(ctx, x, y, 1, 1, Q.beam); ctx.globalAlpha = 1; }
    }
  }
  if (t > 1.9) { const k = Math.floor((t - 1.9) / 0.5) % 2; if (k === 0) { px(ctx, sx + 36, sy + 17, 11, 1, Q.label); px(ctx, sx + 36, sy + 31, 11, 1, Q.label); } }
}

const radioScene = {
  duration: 9.6,
  captions: [
    [0, '개국 30주년, 특집 생방송 첫날 밤의 청운FM.', false],
    [3.2, '“오늘 밤도 이 목소리와 함께해요.”', true],
    [6.4, '그 시각, 지하 계단에서 쇳소리가 울렸다.', false],
    [8.2, '그리고 1997년 여름의 테이프가 사라졌다.', false],
  ],
  draw(ctx, t) {
    if (t < 3.2) return radioExterior(ctx, t);
    if (t < 6.4) return radioStudio(ctx, t - 3.2);
    radioBasement(ctx, t - 6.4);
  },
};


// ---------- 컷과 컷 사이 (film) ----------
// colours from the film cast sheets, the stage maps and the cover
const FM = {
  black: '#121218', curtain: '#1a1a20', curtain2: '#22222a', floor: '#3a3a42', floorD: '#2e2e34',
  wall: '#4a2e2a', wallD: '#3e2622', counter: '#7a4a34', counterLit: '#a8704c', glass: '#cfe2ea', drink: '#c98a3a',
  clockRim: '#c9a24a', clockFace: '#f3ead6', ink: '#2a2622', lamp: '#f2d080', lampGlow: '#6a5030',
  windowDay: '#f0e2b0', windowNight: '#1e2236', actor: '#3a3446', actorSkin: '#d9a07a', actorHair: '#2a2230',
  monitor: '#0e0e12', bezel: '#2a2a32', tally: '#ff3b30', tallyDim: '#5a1414', slate: '#1e1e22', slateTop: '#e8e8e8',
  batten: '#6a5a40', battenLit: '#8a7550', flat: '#2c2a26', stencil: '#d9d0b8', work: '#f2e6b0', workGlow: '#5a5444', stand: '#8a8f9a', tape: '#3a6fd8',
};

function filmBar(ctx, x0, y0, w, h, { day = false, actor = true, glassDown = 0 } = {}) {
  px(ctx, x0, y0, w, h, FM.wall);
  for (let x = x0; x < x0 + w; x += 6) px(ctx, x, y0, 1, Math.floor(h * 0.62), FM.wallD);
  const wx = x0 + 4, wy = y0 + 4, ww = Math.floor(w / 4), wh = Math.floor(h / 2.2);
  px(ctx, wx - 1, wy - 1, ww + 2, wh + 2, FM.ink); px(ctx, wx, wy, ww, wh, day ? FM.windowDay : FM.windowNight);
  px(ctx, wx + Math.floor(ww / 2), wy, 1, wh, FM.ink); px(ctx, wx, wy + Math.floor(wh / 2), ww, 1, FM.ink);
  const cx = x0 + Math.floor(w * 0.76), cy = y0 + 8;                       // the wall clock at ten past three
  for (let a = 0; a < 360; a += 15) px(ctx, cx + Math.round(Math.cos(a * Math.PI / 180) * 4), cy + Math.round(Math.sin(a * Math.PI / 180) * 4), 1, 1, FM.clockRim);
  px(ctx, cx - 3, cy - 2, 7, 5, FM.clockFace); px(ctx, cx - 2, cy - 3, 5, 7, FM.clockFace);
  px(ctx, cx, cy, 2, 1, FM.ink); px(ctx, cx, cy - 2, 1, 2, FM.ink);
  const by = y0 + Math.floor(h * 0.66);
  px(ctx, x0, by, w, y0 + h - by, FM.counter); px(ctx, x0, by, w, 2, FM.counterLit);
  const gx = x0 + Math.floor(w / 2) + 6, gy = by - 7 + glassDown;
  px(ctx, gx, gy, 5, 7, FM.glass); px(ctx, gx + 1, gy + 2, 3, 5, FM.drink);
  if (actor) {
    const ax = x0 + Math.floor(w / 2) - 10, ay = by - 18;
    px(ctx, ax + 3, ay, 7, 6, FM.actorHair); px(ctx, ax + 6, ay + 2, 4, 5, FM.actorSkin); px(ctx, ax + 10, ay + 4, 1, 1, FM.actorSkin);
    px(ctx, ax, ay + 7, 12, 11, FM.actor); px(ctx, ax + 9, ay + 10 + glassDown, 5, 2, FM.actor); px(ctx, ax + 13, ay + 10 + glassDown, 2, 2, FM.actorSkin);
  }
}

function filmStage(ctx, t) {
  px(ctx, 0, 0, W, H, FM.black);
  for (let x = 0; x < W; x += 8) { px(ctx, x, 0, 8, 58, x % 16 ? FM.curtain : FM.curtain2); px(ctx, x + 3, 0, 2, 58, '#141418'); }
  px(ctx, 0, 70, W, 20, FM.floor);
  for (let i = 0; i < 26; i++) if (hash(i + 700) > 0.5) px(ctx, Math.floor(hash(i + 710) * W), 70 + Math.floor(hash(i + 720) * 20), 2, 1, FM.floorD);
  // the bar set comes up out of the dark, light by light
  const up = clamp((t - 0.4) / 1.4, 0, 1);
  filmBar(ctx, 28, 22, 104, 48, { day: false, actor: false });
  if (up < 1) { ctx.globalAlpha = 1 - up; px(ctx, 28, 22, 104, 48, FM.black); ctx.globalAlpha = 1; }
  // the pendant over the bar
  px(ctx, 80, 0, 1, 26, '#2a2a32'); px(ctx, 76, 26, 9, 2, FM.clockRim);
  if (up > 0.3) for (let k = 0; k < 14; k += 2) px(ctx, 74 + k, 30 + (k % 4), 1, 1, FM.lampGlow);
  // camera with its red tally on the left
  px(ctx, 10, 44, 18, 10, '#24242c'); px(ctx, 28, 46, 6, 6, '#34343e'); px(ctx, 17, 54, 3, 14, '#3a3a44'); px(ctx, 8, 68, 22, 3, '#2a2a32');
  const rec = t > 2.6;
  px(ctx, 12, 46, 3, 3, rec ? FM.tally : FM.tallyDim);
  if (rec) { px(ctx, 11, 45, 1, 1, '#7a2a30'); px(ctx, 15, 45, 1, 1, '#7a2a30'); }
  // the slate claps once
  const sx = 120, sy = 70;
  px(ctx, sx, sy, 28, 14, FM.slate);
  const open = t < 2.4 ? 5 : t < 2.6 ? 2 : 0;
  for (let k = 0; k < 28; k += 2) px(ctx, sx + k, sy - 4 - Math.round(open * (k / 28)), 2, 3, (k / 2) % 2 ? FM.slate : FM.slateTop);
  digits(ctx, '23', sx + 3, sy + 3, FM.slateTop); digits(ctx, '4', sx + 18, sy + 3, FM.slateTop);
  if (t > 2.6 && t < 2.9) for (let i = 0; i < 4; i++) px(ctx, sx + 30 + i * 2, sy - 6 + i, 1, 1, FM.slateTop);   // the clap
}

function filmMonitor(ctx, t) {
  // the editing room: the director's monitor receives the take
  px(ctx, 0, 0, W, H, '#1b1b22');
  for (let x = 0; x < W; x += 10) px(ctx, x, 0, 1, H, '#202028');
  px(ctx, 24, 6, 112, 70, FM.bezel); px(ctx, 28, 10, 104, 60, FM.monitor);
  const arrived = t > 0.5;
  if (!arrived) {
    for (let i = 0; i < 3; i++) if (Math.floor(t * 6) % 3 === i) px(ctx, 74 + i * 5, 38, 3, 3, '#5a5b66');   // receiving…
  } else {
    // the take plays: he lowers the glass
    const down = t > 1.4 && t < 2.4 ? 1 : 0;
    filmBar(ctx, 28, 10, 104, 60, { day: true, actor: true, glassDown: down });
    for (let y = 10; y < 70; y += 3) for (let x = 28; x < 132; x += 2) { ctx.globalAlpha = 0.14; px(ctx, x, y, 1, 1, '#000000'); ctx.globalAlpha = 1; }
    px(ctx, 100, 61, 30, 8, '#111111');
    px(ctx, 102, 63, 3, 5, FM.slateTop); px(ctx, 103, 63, 1, 1, '#111111');            // a tiny "B"
    digits(ctx, '22:02', 107, 63, FM.slateTop);
  }
  px(ctx, 74, 76, 12, 8, FM.bezel); px(ctx, 62, 84, 36, 3, FM.bezel);
  // the desk lamp and the director's hand on the jog wheel
  px(ctx, 140, 60, 14, 4, '#3a3a44'); px(ctx, 144, 52, 6, 8, '#7a5240'); px(ctx, 146, 50, 3, 2, FM.actorSkin);
}

function filmBackstage(ctx, t) {
  px(ctx, 0, 0, W, H, '#141418');
  // the work light swings a little on its cable
  const sway = Math.sin(t * 1.6) * 3;
  const lx = 104 + sway, ly = 8;
  for (let y = 0; y < 84; y++) {
    const spread = Math.max(0, (y - ly) * 0.62);
    for (let x = Math.floor(lx - spread); x <= lx + spread; x++) {
      if (x < 0 || x >= W) continue;
      const inner = Math.abs(x - lx) < spread * 0.55;
      if (!inner && (x + y) % 2) continue;
      ctx.globalAlpha = inner ? 0.22 : 0.12; px(ctx, x, y, 1, 1, FM.work); ctx.globalAlpha = 1;
    }
  }
  // flat backs: battens and stencil numbers
  for (let i = 0; i < 6; i++) {
    const fx = 6 + i * 26;
    px(ctx, fx, 0, 3, 74, FM.batten); px(ctx, fx, 0, 1, 74, FM.battenLit);
  }
  px(ctx, 0, 34, W, 3, FM.batten);
  px(ctx, 84, 14, 3, 5, FM.stencil); px(ctx, 84, 14, 5, 1, FM.stencil); px(ctx, 84, 16, 4, 1, FM.stencil);   // "F"
  digits(ctx, '6', 90, 14, FM.stencil);
  px(ctx, lx - 1, 0, 2, ly, '#5e6470'); px(ctx, lx - 3, ly, 6, 3, FM.work);
  // floor, the fallen stand, a scrap of blue tape catching the light
  px(ctx, 0, 74, W, 16, '#2a2826'); px(ctx, 0, 74, W, 1, '#3a3836');
  for (let i = 0; i < 20; i++) { px(ctx, 92 + i, 72 - Math.floor(i / 3), 1, 1, FM.stand); px(ctx, 92 + i, 73 - Math.floor(i / 3), 1, 1, '#5e6470'); }
  px(ctx, 88, 70, 7, 6, '#6a5a3a'); px(ctx, 89, 71, 5, 4, '#8a7550');
  const glint = Math.floor(t * 3) % 3 === 0;
  px(ctx, 74, 78, 6, 2, FM.tape); if (glint) px(ctx, 76, 78, 1, 1, '#e8eefc');
  if (t > 2.4) { const k = Math.floor((t - 2.4) / 0.5) % 2; if (k === 0) { px(ctx, 82, 12, 13, 1, FM.stencil); px(ctx, 82, 21, 13, 1, FM.stencil); } }
}

const filmScene = {
  duration: 9.6,
  captions: [
    [0, '드라마 「겨울의 증언」, 마지막 블록 촬영.', false],
    [3.2, '밤 10시 3분, 감독의 화면에 테이크가 도착했다.', false],
    [6.4, '밤 10시 반, 세트 뒤 통로에서 그가 발견됐다.', false],
    [8.2, '화면 속 그는, 정말 그 시각에 살아 있었을까.', false],
  ],
  draw(ctx, t) {
    if (t < 3.2) return filmStage(ctx, t);
    if (t < 6.4) return filmMonitor(ctx, t - 3.2);
    filmBackstage(ctx, t - 6.4);
  },
};

const SCENES = { train: trainScene, festival: festivalScene, snow: snowScene, stars: starsScene, radio: radioScene, film: filmScene };

// ---------- the player ----------
export function briefingAnim(theme) {
  const scene = SCENES[theme];
  if (!scene || typeof document === 'undefined') return null;
  injectStyle();
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

  const wrap = document.createElement('figure');
  wrap.className = 'brief-anim';
  const frame = document.createElement('div');
  frame.className = 'brief-anim__frame';
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', scene.captions.map((c) => c[1]).join(' '));
  frame.append(canvas);
  const caption = document.createElement('figcaption');
  caption.className = 'brief-anim__caption';
  caption.setAttribute('aria-live', 'polite');
  const bar = document.createElement('div');
  bar.className = 'brief-anim__bar';
  const skip = document.createElement('button');
  skip.type = 'button';
  skip.className = 'small';
  skip.textContent = '건너뛰기';
  const replay = document.createElement('button');
  replay.type = 'button';
  replay.className = 'small';
  replay.textContent = '다시 보기';
  bar.append(skip, replay);
  wrap.append(frame, caption, bar);

  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  let start = 0;
  let raf = 0;
  let shown = -1;

  const captionAt = (t) => {
    let idx = 0;
    scene.captions.forEach((c, i) => {
      if (t >= c[0]) idx = i;
    });
    return idx;
  };
  const paint = (t) => {
    ctx.clearRect(0, 0, W, H);
    scene.draw(ctx, t);
    const i = captionAt(t);
    if (i !== shown) {
      shown = i;
      caption.textContent = scene.captions[i][1];
      caption.classList.toggle('quote', scene.captions[i][2]);
    }
  };
  const end = () => {
    cancelAnimationFrame(raf);
    raf = 0;
    paint(scene.duration);
    skip.hidden = true;
    replay.hidden = false;
  };
  // wait while the stage-change card covers the screen, so the scene is not played unseen
  const covered = () => {
    const card = document.getElementById('shift');
    return Boolean(card && !card.hidden);
  };
  const loop = (now) => {
    if (!wrap.isConnected && start) return; // the briefing was closed: stop drawing
    if (covered()) {
      // the stage card is still up: hold the first frame and start counting once it is gone
      start = 0;
      if (shown === -1) paint(0);
      raf = requestAnimationFrame(loop);
      return;
    }
    if (!start) start = now;
    const t = (now - start) / 1000;
    if (t >= scene.duration) return end();
    paint(t);
    raf = requestAnimationFrame(loop);
  };
  const play = () => {
    cancelAnimationFrame(raf);
    start = 0;
    shown = -1;
    skip.hidden = false;
    replay.hidden = true;
    raf = requestAnimationFrame(loop);
  };
  skip.addEventListener('click', end);
  replay.addEventListener('click', play);

  if (reduce) {
    end();
    caption.textContent = scene.captions.map((c) => c[1]).join(' ');
  } else {
    replay.hidden = true;
    play();
  }
  return wrap;
}

// for tests and previews: draw one frame of a theme's scene at time t
export function drawFrame(theme, ctx, t) {
  SCENES[theme]?.draw(ctx, t);
}
export const sceneThemes = Object.keys(SCENES);
export const sceneDuration = (theme) => SCENES[theme]?.duration ?? 0;
