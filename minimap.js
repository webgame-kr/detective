// Pixel minimap: the whole case on one plan (server: engine/overview.js), each room drawn from its
// own walk grid, corridors between doors, the room you are in lit, and everyone's position.
// The small map follows you in the HUD corner; the full map (M or a click) shows every room by name.

const C = {
  bg: '#1A1D38',
  room: '#C5CCD6',
  roomEdge: '#7C8698',
  here: '#F1E7C6',
  hereEdge: '#E5B54B',
  locked: '#6B4A52',
  lockedMark: '#E8505A',
  ink: '#2A2622',
  me: '#E5B54B',
  label: '#FFF6DE',
  plate: 'rgba(26, 29, 56, 0.82)',
};

// rooms and corridors never change for one plan and scale, so they are painted once
const layers = new Map();
function staticLayer(plan, px) {
  const key = `${plan.case}|${px}`;
  if (layers.has(key)) return layers.get(key);
  const c = document.createElement('canvas');
  c.width = plan.width * px;
  c.height = plan.height * px;
  const g = c.getContext('2d');
  const corridor = (color, grow) => {
    g.fillStyle = color;
    for (const l of plan.links) corridorRects(l, px, grow).forEach(([x, y, w, h]) => g.fillRect(x, y, w, h));
  };
  const floor = (r, color, grow) => {
    g.fillStyle = color;
    r.tiles.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) if (row[x] === '.') g.fillRect((r.x + x) * px - grow, (r.y + y) * px - grow, px + grow * 2, px + grow * 2);
    });
  };
  // edges first, slightly larger, then the floor on top: a one-pixel outline around everything
  corridor(C.roomEdge, 1);
  for (const r of plan.rooms) floor(r, C.roomEdge, 1);
  corridor(C.room, 0);
  for (const r of plan.rooms) floor(r, C.room, 0);
  layers.set(key, c);
  return c;
}

// a corridor as axis-aligned bars along its path, two tiles wide
function corridorRects(link, px, grow = 0) {
  const half = px;
  const rects = [];
  for (let i = 0; i < link.path.length - 1; i++) {
    const [x1, y1] = link.path[i].map((v) => v * px);
    const [x2, y2] = link.path[i + 1].map((v) => v * px);
    const x = Math.min(x1, x2) - half - grow;
    const y = Math.min(y1, y2) - half - grow;
    rects.push([Math.round(x), Math.round(y), Math.round(Math.abs(x2 - x1) + half * 2 + grow * 2), Math.round(Math.abs(y2 - y1) + half * 2 + grow * 2)]);
  }
  return rects;
}

// Everyone's tile on the plan: live (sliding) positions in your room, last known room spot elsewhere.
function markers(plan, state, motion) {
  const rooms = new Map(plan.rooms.map((r) => [r.id, r]));
  const here = state.map?.id;
  return (state.whereabouts ?? []).map((w) => {
    const r = rooms.get(w.location);
    if (!r) return null;
    const live = w.location === here ? motion?.get(w.id) : null;
    const info = state.players.find((p) => p.id === w.id);
    return { id: w.id, me: w.id === state.me.id, x: r.x + (live?.rx ?? w.x) + 0.5, y: r.y + (live?.ry ?? w.y) + 0.5, color: info?.color ?? '#9DB8CF', connected: info?.connected !== false };
  }).filter(Boolean);
}

// Draws the plan into canvas. center: [x, y] tile to centre on (small map) or null to fit the plan.
export function drawMinimap(canvas, plan, state, { px, center = null, labels = false, motion = null, now = 0, serverNow = Date.now() }) {
  const g = canvas.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.fillStyle = C.bg;
  g.fillRect(0, 0, canvas.width, canvas.height);
  const ox = center ? Math.round(canvas.width / 2 - center[0] * px) : Math.round((canvas.width - plan.width * px) / 2);
  const oy = center ? Math.round(canvas.height / 2 - center[1] * px) : Math.round((canvas.height - plan.height * px) / 2);
  g.drawImage(staticLayer(plan, px), ox, oy);

  // locked links: a dark bar with a red mark in the middle
  const closed = new Set(state.closedExits ?? []);
  for (const l of plan.links) {
    if (!l.exits.some((id) => closed.has(id))) continue; // shut from either side
    g.fillStyle = C.locked;
    for (const [x, y, w, h] of corridorRects(l, px)) g.fillRect(ox + x, oy + y, w, h);
    const mid = l.path[Math.floor((l.path.length - 1) / 2)];
    const nxt = l.path[Math.floor((l.path.length - 1) / 2) + 1];
    g.fillStyle = C.lockedMark;
    g.fillRect(ox + Math.round(((mid[0] + nxt[0]) / 2) * px) - px, oy + Math.round(((mid[1] + nxt[1]) / 2) * px) - px, px * 2, px * 2);
  }

  // the room you are in, lit
  const here = plan.rooms.find((r) => r.id === state.map?.id);
  if (here) {
    g.fillStyle = C.hereEdge;
    here.tiles.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) if (row[x] === '.') g.fillRect(ox + (here.x + x) * px - 1, oy + (here.y + y) * px - 1, px + 2, px + 2);
    });
    g.fillStyle = C.here;
    here.tiles.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) if (row[x] === '.') g.fillRect(ox + (here.x + x) * px, oy + (here.y + y) * px, px, px);
    });
  }

  // guards: in your own room always, elsewhere only while someone watches the monitors
  const P = typeof window !== 'undefined' ? window.Patrol : null;
  const watchers = [...(state.map?.gimmicks ?? []).map((gm) => ({ ...gm, location: gm.location ?? state.map.id })), ...(state.surveillance ?? [])];
  const seen = new Set();
  for (const gm of watchers) {
    if (!P || seen.has(gm.id) || !gm.active) continue;
    seen.add(gm.id);
    const r = plan.rooms.find((x) => x.id === gm.location);
    if (!r) continue;
    let at;
    if (gm.type === 'guard_patrol' && gm.anchorAt != null) at = P.positionAt(gm, { anchorAt: gm.anchorAt, offset: gm.offset, detour: gm.detour }, serverNow, gm.beatMs);
    else if (gm.type === 'camera') at = { x: gm.x, y: gm.y };
    if (!at) continue;
    const s = Math.max(3, Math.round(px * 1.4));
    g.fillStyle = gm.type === 'camera' ? '#8E3B4A' : '#D4524A';
    g.fillRect(ox + Math.round((r.x + at.x + 0.5) * px - s / 2), oy + Math.round((r.y + at.y + 0.5) * px - s / 2), s, s);
  }

  // people: teammates as their colour, you as a blinking brass square on top
  const size = Math.max(3, Math.round(px * 1.6));
  const all = markers(plan, state, motion).sort((a, b) => a.me - b.me);
  for (const m of all) {
    if (m.me && Math.floor(now / 450) % 2) continue;
    const x = ox + Math.round(m.x * px - size / 2);
    const y = oy + Math.round(m.y * px - size / 2);
    g.fillStyle = C.ink;
    g.fillRect(x - 1, y - 1, size + 2, size + 2);
    g.fillStyle = m.me ? C.me : m.connected ? m.color : '#8A8FA0';
    g.fillRect(x, y, size, size);
  }

  if (labels) {
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `${Math.max(11, Math.min(16, px * 4))}px Galmuri11, 'Malgun Gothic', sans-serif`;
    for (const r of plan.rooms) {
      const text = r.id === plan.start ? `${r.name} · 시작` : r.name;
      const cx = ox + (r.x + r.w / 2) * px;
      const cy = oy + (r.y + r.h / 2) * px;
      const w = Math.ceil(g.measureText(text).width) + 10;
      const hgt = Math.max(16, px * 4 + 6);
      g.fillStyle = C.plate;
      g.fillRect(Math.round(cx - w / 2), Math.round(cy - hgt / 2), w, hgt);
      g.fillStyle = r.id === here?.id ? C.hereEdge : C.label;
      g.fillText(text, Math.round(cx), Math.round(cy) + 1);
    }
  }
  return { ox, oy };
}

// Where to centre the small map: your live tile, else the middle of your room.
export function focusOf(plan, state, motion) {
  const me = markers(plan, state, motion).find((m) => m.me);
  if (me) return [me.x, me.y];
  const r = plan.rooms.find((x) => x.id === state.map?.id) ?? plan.rooms[0];
  return [r.x + r.w / 2, r.y + r.h / 2];
}
