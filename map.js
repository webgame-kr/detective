import { loadImage, frameAt, drawFrame, findLook, lookSet, lookFrame } from './sprites.js';

// Canvas drawing for the map. A location with `art` shows its painted background at an integer
// scale (ART_SCALE) with characters at the same scale; one without art falls back to flat tiles.
// Either way the server's tile grid decides where people can walk.

export const TILE = 40;
export const ART_SCALE = 3;

const C = {
  wall: '#3d3550',
  wallTop: '#574c70',
  floorA: '#efe5cf',
  floorB: '#e7dcc3',
  exitOpen: '#6dbb63',
  exitLocked: '#c8564b',
  text: '#2b2533',
  plate: '#e2b33c',
  plateOn: '#ffd84d',
  plateSolved: '#7cc46f',
  plateOff: '#b9b2a4',
  focus: '#2b6fd6',
};

// Client renderers for gimmick types, keyed by the server module's clientRenderer.
export const GIMMICK_RENDERERS = {
  pressure_plates(ctx, gm, { occupied, T, art }) {
    gm.plates.forEach((p, i) => {
      // alone, a plate stays lit once stepped on; together, it is lit while someone stands on it
      const on = gm.solo ? gm.lit.includes(i) : occupied(p.x, p.y);
      const pad = art ? 3 : 6;
      // over painted pads only a tinted overlay, so the art still shows through
      ctx.globalAlpha = art ? 0.55 : 1;
      ctx.fillStyle = gm.solved ? C.plateSolved : !gm.active ? C.plateOff : on ? C.plateOn : C.plate;
      ctx.fillRect(p.x * T + pad, p.y * T + pad, T - pad * 2, T - pad * 2);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#8a6a12';
      ctx.lineWidth = 2;
      ctx.strokeRect(p.x * T + pad, p.y * T + pad, T - pad * 2, T - pad * 2);
      ctx.fillStyle = '#4d3a08';
      ctx.font = 'bold 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(gm.solved ? '완료' : !gm.active ? '꺼짐' : on ? (gm.solo ? '켜짐' : '눌림') : '발판', p.x * T + T / 2, p.y * T + T / 2 + 4);
    });
  },

  // A guard walking its route (shared/patrol.js gives the same place the server judges by), its
  // sight as pale yellow cells, and a "?" over it while it checks a noise.
  guard_patrol(ctx, gm, { T, S, now, blocked, m, barks, reduce, fronts }) {
    const P = window.Patrol;
    if (!P || !gm.active || gm.anchorAt == null) return;
    const state = { anchorAt: gm.anchorAt, offset: gm.offset, detour: gm.detour };
    const cur = P.positionAt(gm, state, now, gm.beatMs);
    const prev = P.positionAt(gm, state, now - gm.beatMs, gm.beatMs);
    // the step into this beat's cell takes the first half of the beat
    const f = reduce ? 1 : Math.min(1, (((now - gm.anchorAt) % gm.beatMs) / gm.beatMs) * 2);
    const x = (prev.x + (cur.x - prev.x) * f) * T;
    const y = (prev.y + (cur.y - prev.y) * f) * T;
    seeCells(ctx, P.visionCells(cur, cur.facing, gm.vision, blocked, m.width, m.height), T, 'rgba(246, 216, 90, 0.28)');
    // the case's patrol sheet when it has one (and it has loaded), else a plain guard
    const sp = gm.sprite;
    const drawn = drawBehind(ctx, fronts, S, Math.round(y / T), [x - T, y - 2 * T - 4 * S, 3 * T, 3 * T + 8 * S], (c) => {
      const ok = sp && drawFrame(c, loadImage(sp.url), guardFrame(sp, cur, prev, now, reduce), sp.frameSize, sp.anchor, x + T / 2, y + T - 3 * S, S);
      if (!ok) plainGuard(c, x, y, T);
      return ok;
    });
    if (cur.checking) {
      ctx.fillStyle = '#d4524a';
      ctx.font = `bold ${Math.round(T * 0.5)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('?', x + T / 2, drawn ? y + T - 3 * S - (sp.anchor[1] + 2) * S : y - T * 0.1);
    }
    const said = barks?.filter((b) => b.gimmick === gm.id).at(-1);
    if (said) label(ctx, said.text, x + T / 2, y - T * 0.35, { font: '12px system-ui, sans-serif', bg: 'rgba(255,246,222,0.95)' });
    else label(ctx, gm.label, x + T / 2, y + T + 9, { font: '11px system-ui, sans-serif' });
  },

  // A camera on the wall and what it sees now (pale red cells).
  camera(ctx, gm, { T, now, blocked, m, barks }) {
    const P = window.Patrol;
    if (!P || !gm.active) return;
    const facing = P.cameraFacing(gm, { anchorAt: gm.anchorAt, dwellMs: gm.dwellMs }, now);
    seeCells(ctx, P.visionCells({ x: gm.x, y: gm.y }, facing, gm.vision, blocked, m.width, m.height), T, 'rgba(212, 82, 74, 0.22)');
    const [dx, dy] = P.DIRS[facing];
    ctx.fillStyle = '#3a3750';
    ctx.fillRect(gm.x * T + T * 0.25, gm.y * T + T * 0.3, T * 0.5, T * 0.4);
    ctx.fillStyle = '#d4524a';
    ctx.fillRect(gm.x * T + T * (0.42 + dx * 0.2), gm.y * T + T * (0.42 + dy * 0.15), T * 0.16, T * 0.16);
    const said = barks?.filter((b) => b.gimmick === gm.id).at(-1);
    if (said) label(ctx, said.text, gm.x * T + T / 2, gm.y * T - 4, { font: '12px system-ui, sans-serif', bg: 'rgba(255,246,222,0.95)' });
  },
};

// Painted maps are drawn from the front and a little above, so a shelf's top rises into the floor row
// behind it. People standing behind it must go under that part. For each wall tile with open floor
// above, the pixels joined to it going up (at most one tile, until a floor color) are cut out into a
// strip of their own, at the art's size. The floor colors are the common ones on open floor whose tile
// below is open too. Kept per picture; a picture we may not read back gets none.
const fronts = new Map();

function frontLayers(img, m) {
  if (!fronts.has(img.src)) {
    let layers = [];
    try {
      layers = cutFronts(img, m);
    } catch {
      // unreadable picture: people are drawn over it as before
    }
    fronts.set(img.src, layers);
  }
  return fronts.get(img.src);
}

function cutFronts(img, m) {
  const t = m.art.tile;
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const cx = c.getContext('2d', { willReadFrequently: true });
  cx.drawImage(img, 0, 0);
  const d = cx.getImageData(0, 0, w, h).data;
  const wall = (x, y) => m.tiles[y]?.[x] === '#';
  const open = (x, y) => y >= 0 && y < m.height && x >= 0 && x < m.width && !wall(x, y);
  const color = (i) => (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];

  const seen = new Map();
  let total = 0;
  for (let ty = 0; ty < m.height; ty++) {
    for (let tx = 0; tx < m.width; tx++) {
      if (!open(tx, ty) || !open(tx, ty + 1)) continue;
      for (let y = ty * t; y < (ty + 1) * t; y++) {
        for (let x = tx * t; x < (tx + 1) * t; x++) {
          const k = color((y * w + x) * 4);
          seen.set(k, (seen.get(k) ?? 0) + 1);
          total++;
        }
      }
    }
  }
  const floor = new Set([...seen].filter(([, n]) => n >= total * 0.004).map(([k]) => k));

  const layers = [];
  for (let ty = 1; ty < m.height; ty++) {
    const top = (ty - 1) * t;
    const strip = new ImageData(w, ty * t - top);
    let any = false;
    for (let tx = 0; tx < m.width; tx++) {
      // the map's own edge walls hold doors and frames, not furniture
      if (!wall(tx, ty) || !open(tx, ty - 1) || tx === 0 || tx === m.width - 1 || ty === m.height - 1) continue;
      // how far the picture rises above this tile, column by column
      const rise = [];
      for (let x = tx * t; x < (tx + 1) * t; x++) {
        let y = ty * t - 1;
        while (y >= top && open(tx, Math.floor(y / t)) && d[(y * w + x) * 4 + 3] !== 0 && !floor.has(color((y * w + x) * 4))) y--;
        // all the way up is a floor color we did not count, not a furniture top
        rise.push(ty * t - 1 - y < t ? ty * t - 1 - y : 0);
      }
      // a wall's edge line or a doorframe is not furniture: most of the tile must rise
      if (rise.filter((r) => r >= 2).length < t / 2) continue;
      rise.forEach((r, k) => {
        const x = tx * t + k;
        for (let y = ty * t - r; y < ty * t; y++) strip.data.set(d.subarray((y * w + x) * 4, (y * w + x) * 4 + 4), ((y - top) * w + x) * 4);
        if (r) any = true;
      });
    }
    if (!any) continue;
    const layer = document.createElement('canvas');
    layer.width = w;
    layer.height = strip.height;
    layer.getContext('2d').putImageData(strip, 0, 0);
    layers.push({ row: ty, y: top, canvas: layer });
  }
  return layers;
}

// Draws one person standing on tile row `row` (paint draws them in canvas pixels inside box
// [x, y, w, h]) under the furniture fronts of rows further down. Most of the time none reaches
// them and they are drawn straight onto the map.
let scratch = null;
function drawBehind(ctx, fronts, S, row, [x, y, w, h], paint) {
  const over = fronts?.filter((f) => f.row > row && f.y * S < y + h && (f.y + f.canvas.height) * S > y);
  if (!over?.length) return paint(ctx);
  x = Math.floor(x);
  y = Math.floor(y);
  w = Math.ceil(w) + 1;
  h = Math.ceil(h) + 1;
  scratch ??= document.createElement('canvas');
  if (scratch.width < w || scratch.height < h) {
    scratch.width = Math.max(scratch.width, w);
    scratch.height = Math.max(scratch.height, h);
  }
  const sc = scratch.getContext('2d');
  sc.setTransform(1, 0, 0, 1, 0, 0);
  sc.globalCompositeOperation = 'source-over';
  sc.clearRect(0, 0, w, h);
  sc.imageSmoothingEnabled = false;
  sc.translate(-x, -y);
  sc.globalAlpha = ctx.globalAlpha;
  const drawn = paint(sc);
  sc.globalAlpha = 1;
  sc.globalCompositeOperation = 'destination-out';
  for (const f of over) sc.drawImage(f.canvas, 0, f.y * S, f.canvas.width * S, f.canvas.height * S);
  sc.setTransform(1, 0, 0, 1, 0, 0);
  sc.globalCompositeOperation = 'source-over';
  const alpha = ctx.globalAlpha;
  ctx.globalAlpha = 1;
  ctx.drawImage(scratch, 0, 0, w, h, x, y, w, h);
  ctx.globalAlpha = alpha;
  return drawn;
}

// a plain guard: cap, face, navy coat, torch beam toward where it looks
function plainGuard(ctx, x, y, T) {
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(x + T * 0.2, y + T * 0.85, T * 0.6, T * 0.12);
  ctx.fillStyle = '#2b3a67';
  ctx.fillRect(x + T * 0.25, y + T * 0.38, T * 0.5, T * 0.5);
  ctx.fillStyle = '#efbc9c';
  ctx.fillRect(x + T * 0.32, y + T * 0.12, T * 0.36, T * 0.28);
  ctx.fillStyle = '#1b2240';
  ctx.fillRect(x + T * 0.28, y + T * 0.06, T * 0.44, T * 0.12);
  ctx.fillStyle = '#f6d88a';
  ctx.fillRect(x + T * 0.44, y + T * 0.46, T * 0.12, T * 0.12);
}

// Which patrol frame shows: walking the way it steps, sweeping the torch while it checks a noise,
// and standing still looking around (facing down) or turned toward where it looks.
// Diagonal facings show as their side (e/w); reduced motion holds first frames.
function guardFrame(sp, cur, prev, now, reduce) {
  const a = sp.animations;
  const side = (d) => (d.length > 1 ? d[1] : d);
  const pick = (anim) => (reduce ? anim.frames[0] : frameAt(anim, now));
  if (cur.x !== prev.x || cur.y !== prev.y) return pick(a[`walk_${side(cur.facing)}`]);
  if (cur.checking && (a.flashlight_sweep ?? a.alert)) return pick(a.flashlight_sweep ?? a.alert);
  if (cur.facing === 's' && a.look) return pick(a.look);
  return a[`walk_${side(cur.facing)}`].frames[0];
}

function seeCells(ctx, cells, T, color) {
  ctx.fillStyle = color;
  for (const c of cells) ctx.fillRect(c.x * T, c.y * T, T, T);
}

// What stops sight here, for drawing the same cones the server judges by: walls, solid things, shut doors.
function sightBlocker(m) {
  const solid = new Set(m.objects.filter((o) => (o.blocks ?? o.solid) && o.kind !== 'hide').map((o) => `${o.x}:${o.y}`));
  const shut = new Set(m.exits.filter((e) => !e.open).map((e) => `${e.x}:${e.y}`));
  return (x, y) => m.tiles[y]?.[x] !== '.' || solid.has(`${x}:${y}`) || shut.has(`${x}:${y}`);
}

// Tile layers (tilestate:v1): a light zone that is off is darkened with a black checker dither over
// the painted floor, under furniture, things and people. The dots are two art pixels across so they
// stay a dither, not a grey blur, when the map is shown small on a phone. No fades: on or off.
const dithers = new Map();
function ditherPattern(ctx, dot) {
  if (!dithers.has(dot)) {
    const c = document.createElement('canvas');
    c.width = dot * 2;
    c.height = dot * 2;
    const pc = c.getContext('2d');
    pc.fillStyle = '#000';
    pc.fillRect(0, 0, dot, dot);
    pc.fillRect(dot, dot, dot, dot);
    dithers.set(dot, c);
  }
  return ctx.createPattern(dithers.get(dot), 'repeat');
}

// Footprints (prints layers) come first: one cell of their sheet per print, the column for its
// direction, the clear row or the smudged one below it. A covered print is not sent at all.
export function drawTileLayers(ctx, m, T, S) {
  for (const l of (m.tileLayers ?? []).filter((x) => x.kind === 'prints')) {
    const sheet = loadImage(l.image);
    if (!sheet.complete || !sheet.naturalWidth) continue;
    for (const [x, y, dir, value] of l.cells) {
      const col = l.frames[dir];
      if (col === undefined) continue;
      ctx.drawImage(sheet, col * l.size, value === 'smudged' ? l.size : 0, l.size, l.size, x * T, y * T, T, T);
    }
  }
  const dark = (m.tileLayers ?? []).filter((l) => l.kind === 'light').flatMap((l) => l.zones.filter((z) => z.value === 'off'));
  if (!dark.length) return;
  ctx.fillStyle = ditherPattern(ctx, S > 1 ? 2 * S : 4);
  for (const z of dark) for (const [x, y, w, h] of z.rects) ctx.fillRect(x * T, y * T, w * T, h * T);
}

// Loud floors marked faintly so they can be seen before stepping on them: wood grain, metal grid.
function drawFloor(ctx, m, T) {
  if (!m.floor) return;
  m.floor.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch === 'w') {
      ctx.fillStyle = 'rgba(156, 107, 67, 0.35)';
      for (let i = 1; i < 4; i++) ctx.fillRect(x * T + 2, y * T + (T * i) / 4, T - 4, 2);
    } else if (ch === 'm') {
      ctx.strokeStyle = 'rgba(170, 180, 190, 0.55)';
      ctx.lineWidth = 2;
      ctx.strokeRect(x * T + 3, y * T + 3, T - 6, T - 6);
      ctx.beginPath();
      ctx.moveTo(x * T + T / 2, y * T + 3);
      ctx.lineTo(x * T + T / 2, y * T + T - 3);
      ctx.moveTo(x * T + 3, y * T + T / 2);
      ctx.lineTo(x * T + T - 3, y * T + T / 2);
      ctx.stroke();
    }
  }));
}

function label(ctx, text, x, y, { color = C.text, bg = 'rgba(255,255,255,0.88)', font = '11px system-ui, sans-serif' } = {}) {
  ctx.font = font;
  ctx.textAlign = 'center';
  const w = ctx.measureText(text).width + 8;
  // keep the whole label inside the canvas (exits sit on the edge)
  x = Math.min(Math.max(x, w / 2), ctx.canvas.width - w / 2);
  y = Math.min(Math.max(y, 12), ctx.canvas.height - 2);
  ctx.fillStyle = bg;
  ctx.fillRect(x - w / 2, y - 11, w, 14);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

function drawTiles(ctx, m, T) {
  for (let y = 0; y < m.height; y++) {
    for (let x = 0; x < m.width; x++) {
      if (m.tiles[y][x] === '#') {
        ctx.fillStyle = C.wall;
        ctx.fillRect(x * T, y * T, T, T);
        ctx.fillStyle = C.wallTop;
        ctx.fillRect(x * T, y * T, T, 6);
      } else {
        ctx.fillStyle = (x + y) % 2 ? C.floorA : C.floorB;
        ctx.fillRect(x * T, y * T, T, T);
      }
    }
  }
}

// `motion` gives each visible player's drawn position and pose (see game.js); without it players sit on their tiles.
// With `worldLabels`, names, door signs and the focus box are left to the HUD: the return value
// lists where each one belongs, in canvas pixels (bottom centre of the label).
// news: ids of people with a question waiting (hints), marked on their labels
// serverNow: the server's clock (guards and cameras are drawn from it); barks: what they just said
export function drawMap(canvas, state, { focusId, now = 0, motion = new Map(), talkingId = null, worldLabels = false, news = null, serverNow = Date.now(), barks = [], reduce = false } = {}) {
  const m = state.map;
  const art = m.art;
  const S = art ? ART_SCALE : 1;
  const T = art ? art.tile * S : TILE;
  const w = m.width * T;
  const hgt = m.height * T;
  if (canvas.width !== w || canvas.height !== hgt) {
    canvas.width = w;
    canvas.height = hgt;
  }
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  const bg = art ? loadImage(art.url) : null;
  if (bg?.complete && bg.naturalWidth) ctx.drawImage(bg, 0, 0, bg.naturalWidth * S, bg.naturalHeight * S);
  else drawTiles(ctx, m, T);
  // floor → tile layers → furniture fronts, things and people (the fronts are cut from the plain
  // picture but only ever erase people, so a dark zone stays dark over a shelf's top too)
  drawTileLayers(ctx, m, T, S);

  for (const e of m.exits) {
    // a locked door with its own picture shows only that picture, standing on the tile's bottom edge
    const leaf = art && e.image ? loadImage(e.image) : null;
    if (leaf) {
      if (leaf.complete && leaf.naturalWidth) ctx.drawImage(leaf, e.x * T, (e.y + 1) * T - leaf.naturalHeight * S, leaf.naturalWidth * S, leaf.naturalHeight * S);
      continue;
    }
    if (art) {
      // painted doorways: only a small open / locked marker
      ctx.globalAlpha = 0.8;
      ctx.fillStyle = e.open ? C.exitOpen : C.exitLocked;
      ctx.fillRect(e.x * T + T / 2 - 9, e.y * T + T / 2 - 9, 18, 18);
      ctx.globalAlpha = 1;
    } else {
      ctx.fillStyle = e.open ? C.exitOpen : C.exitLocked;
      ctx.fillRect(e.x * T + 4, e.y * T + 4, T - 8, T - 8);
    }
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 14px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(e.open ? '↦' : '■', e.x * T + T / 2, e.y * T + T / 2 + 5);
  }

  const players = state.players;
  const here = m.players.map((mp) => ({ ...mp, info: players.find((p) => p.id === mp.id) })).filter((p) => p.info);
  const occupied = (x, y) => here.some((p) => p.x === x && p.y === y && p.info.connected);
  drawFloor(ctx, m, T);
  const blocked = sightBlocker(m);
  // painted furniture that people behind it are drawn under (see cutFronts)
  const fronts = bg?.complete && bg.naturalWidth ? frontLayers(bg, m) : null;
  const box = (fx, fy) => [fx - T, fy - 3 * T, 2 * T, 3 * T + 4 * S];
  for (const gm of m.gimmicks) GIMMICK_RENDERERS[gm.renderer]?.(ctx, gm, { occupied, T, S, art: Boolean(art), now: serverNow, blocked, m, barks, reduce, fronts });

  const foot = (x, y) => [x * T + T / 2, y * T + T - 3 * S];
  for (const o of m.objects) {
    const cx = o.x * T + T / 2;
    const cy = o.y * T + T / 2;
    ctx.fillStyle = o.color ?? '#888';
    const sp = o.sprite;
    // NPCs with art: idle loop, or the talk loop while their line is being printed
    if (sp && drawBehind(ctx, fronts, S, o.y, box(...foot(o.x, o.y)), (c) => drawFrame(c, loadImage(sp.url), frameAt(sp.animations[o.id === talkingId && sp.animations.talk ? 'talk' : 'idle'], now), sp.frameSize, sp.anchor, ...foot(o.x, o.y), S))) {
      // drawn
    } else if (o.kind === 'talk') {
      ctx.beginPath();
      ctx.arc(cx, cy, T / 2 - 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 14px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('…', cx, cy + 4);
    } else if (art && o.image) {
      // its own picture (a closed door leaf), standing on the tile's bottom edge; nothing until loaded
      const img = loadImage(o.image);
      if (img.complete && img.naturalWidth) ctx.drawImage(img, o.x * T, (o.y + 1) * T - img.naturalHeight * S, img.naturalWidth * S, img.naturalHeight * S);
    } else if (art && o.solid) {
      // a closed door or barrier drawn over the painted (open) background
      ctx.fillStyle = 'rgba(70, 48, 32, 0.82)';
      ctx.fillRect(o.x * T + T * 0.3, o.y * T, T * 0.4, T);
      ctx.fillStyle = '#e2b33c';
      ctx.fillRect(o.x * T + T / 2 - 3, cy - 3, 6, 6);
    } else if (art) {
      // investigation spot: a small sparkle, dimmed once this player has looked
      const pulse = o.done ? 0.35 : 0.65 + 0.35 * Math.sin(now / 300 + o.x);
      ctx.globalAlpha = pulse;
      ctx.fillStyle = o.done ? '#ffffff' : '#ffe27a';
      ctx.beginPath();
      ctx.moveTo(cx, cy - 8);
      ctx.lineTo(cx + 5, cy);
      ctx.lineTo(cx, cy + 8);
      ctx.lineTo(cx - 5, cy);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
    } else {
      ctx.fillRect(o.x * T + 5, o.y * T + 5, T - 10, T - 10);
      if (o.done) {
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 14px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('✓', cx, cy + 5);
      }
    }
    if (o.id === focusId && !worldLabels) {
      ctx.strokeStyle = C.focus;
      ctx.lineWidth = 3;
      ctx.setLineDash([5, 3]);
      ctx.strokeRect(o.x * T + 1.5, o.y * T + 1.5, T - 3, T - 3);
      ctx.setLineDash([]);
    }
  }

  // draw back to front so lower players overlap the ones above them
  const placed = here.map((p) => {
    const mo = motion.get(p.id);
    return { ...p, rx: mo?.rx ?? p.x, ry: mo?.ry ?? p.y, mo };
  }).sort((a, b) => a.ry - b.ry);
  const looks = lookSet();
  for (const p of placed) {
    const me = p.id === state.me.id;
    // someone hidden shows as a faint outline (to the team; guards and cameras do not see them)
    ctx.globalAlpha = p.hidden ? 0.35 : p.info.connected ? 1 : 0.4;
    const [fx, fy] = foot(p.rx, p.ry);
    drawBehind(ctx, fronts, S, Math.round(p.ry), box(fx, fy), (c) => {
      // a colored ring at the feet keeps each player's color even when two share a look
      c.fillStyle = p.info.color;
      c.beginPath();
      c.ellipse(fx, fy - 1, 4 * S + 7, 1.5 * S + 2.5, 0, 0, Math.PI * 2);
      c.fill();
      if (me) {
        c.strokeStyle = '#1b1726';
        c.lineWidth = 2;
        c.stroke();
      }
      const look = findLook(p.info.avatar);
      const pose = look && lookFrame(look, { facing: p.mo?.facing ?? p.facing, moving: p.mo?.moving, action: p.mo?.action, actionT: p.mo?.actionT, now });
      if (!look || !drawFrame(c, loadImage(`avatars/${look.image}`), pose, looks.frameSize, looks.anchor, fx, fy, S)) {
        c.fillStyle = p.info.color;
        c.fillRect(p.rx * T + 8, p.ry * T + 8, T - 16, T - 16);
        c.fillStyle = '#fff';
        c.fillRect(p.rx * T + 13, p.ry * T + 15, 4, 4);
        c.fillRect(p.rx * T + 23, p.ry * T + 15, 4, 4);
      }
    });
    ctx.globalAlpha = 1;
  }

  // labels last so they sit on top; on painted maps spots are named only when in reach
  const spriteTop = (y) => y * T + T - 3 * S - (lookSet()?.anchor[1] ?? 33) * S - 4;
  if (worldLabels) {
    const anchors = [];
    for (const o of m.objects) {
      const top = o.kind === 'talk' && o.sprite ? spriteTop(o.y) : o.y * T + 3 * S;
      anchors.push({ kind: o.kind === 'talk' ? 'npc' : 'spot', id: o.id, text: o.label, x: o.x * T + T / 2, y: top, focus: o.id === focusId, news: Boolean(news?.has(o.id)) });
    }
    // a door several tiles wide is one label, centred on its tiles
    const doors = new Map();
    for (const e of m.exits) {
      const key = `${e.toName}|${e.open}`;
      const d = doors.get(key);
      if (d && Math.abs(d.lastX - e.x) + Math.abs(d.lastY - e.y) === 1) Object.assign(d, { sx: d.sx + e.x, sy: d.sy + e.y, n: d.n + 1, lastX: e.x, lastY: e.y });
      else doors.set(d ? `${key}|${e.id}` : key, { e, sx: e.x, sy: e.y, n: 1, lastX: e.x, lastY: e.y });
    }
    for (const { e, sx, sy, n } of doors.values()) {
      const x = sx / n;
      const y = sy / n;
      // the arrow points to the nearest map edge: a door set a tile or two into the top wall still leads up
      const side = [['up', y], ['down', m.height - 1 - y], ['left', x], ['right', m.width - 1 - x]].reduce((a, b) => (b[1] < a[1] ? b : a))[0];
      anchors.push({ kind: 'door', id: e.id, text: e.toName, open: e.open, side, x: x * T + T / 2, y: y * T });
    }
    for (const p of placed) {
      const me = p.id === state.me.id;
      anchors.push({ kind: me ? 'me' : 'player', id: p.id, text: p.info.nickname + (p.hidden ? ' (숨음)' : '') + (p.info.connected ? '' : ' (끊김)'), color: p.info.color, x: p.rx * T + T / 2, y: me ? p.ry * T + T + 3 : spriteTop(p.ry), head: spriteTop(p.ry) });
    }
    return anchors;
  }
  for (const o of m.objects) {
    if (art && (o.kind === 'inspect' || o.kind === 'puzzle' || o.kind === 'panel') && o.id !== focusId) continue;
    if (art && o.kind === 'talk' && o.sprite) label(ctx, o.label, o.x * T + T / 2, spriteTop(o.y), { font: '12px system-ui, sans-serif' });
    else label(ctx, o.label, o.x * T + T / 2, o.y * T + T + 9, { font: art ? '12px system-ui, sans-serif' : undefined });
  }
  for (const e of m.exits) {
    const ly = e.y === 0 ? e.y * T + T + 12 : e.y * T - 3;
    label(ctx, `${e.toName}${e.open ? '' : ' (잠김)'}`, e.x * T + T / 2, ly, { color: e.open ? '#1f5d1a' : '#8a1f16' });
  }
  for (const p of placed) {
    label(ctx, p.info.nickname + (p.info.connected ? '' : ' (끊김)'), p.rx * T + T / 2, art ? spriteTop(p.ry) : p.ry * T - 6, {
      color: '#fff',
      bg: p.info.color,
      font: `${p.id === state.me.id ? 'bold ' : ''}${art ? 12 : 11}px system-ui, sans-serif`,
    });
  }
}

// The object the player would interact with: in reach, preferring the one underfoot, then the one faced.
export function pickTarget(state, facing) {
  if (!state.map || !state.me.position) return null;
  const { x, y } = state.me.position;
  const near = state.map.objects.filter((o) => Math.max(Math.abs(o.x - x), Math.abs(o.y - y)) <= 1);
  if (!near.length) return null;
  // what you face first, then what you stand on, then side by side before corners; on a tie a
  // person comes before a thing, so a clerk at a desk is not lost behind the desk
  const rank = (o) => {
    if (facing && o.x === x + facing[0] && o.y === y + facing[1]) return 0;
    if (o.x === x && o.y === y) return 1;
    return (o.x === x || o.y === y ? 2 : 4) + (o.kind === 'talk' ? 0 : 1);
  };
  return near.reduce((best, o) => (rank(o) < rank(best) ? o : best));
}
