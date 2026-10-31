'use strict';
// Patrols and sight, shared by the server (which decides) and the client (which only draws).
// A guard's place is a pure function of time: where it is at `now` follows from its route, the
// beat length, when the day's patrol began (anchorAt) and the beats it lost checking a noise
// (offset, detour). Nothing is stored per beat, so the server only computes when it must judge,
// and the client draws the same walk from the server's clock.
//
// Loaded by the server as a CommonJS module and by the page as a plain script (window.Patrol).
(function (root) {
  const DIRS = { n: [0, -1], ne: [1, -1], e: [1, 0], se: [1, 1], s: [0, 1], sw: [-1, 1], w: [-1, 0], nw: [-1, -1] };
  const dirOf = (dx, dy) => Object.keys(DIRS).find((k) => DIRS[k][0] === Math.sign(dx) && DIRS[k][1] === Math.sign(dy)) ?? 's';

  // Route points may be the two ends of a straight run; the cells between are filled in. A point
  // is { x, y, wait?, look? }: wait beats spent there, looking at each `look` direction in turn.
  function expandRoute(route) {
    const cells = [];
    route.forEach((p, i) => {
      if (i > 0) {
        const prev = route[i - 1];
        const dx = Math.sign(p.x - prev.x);
        const dy = Math.sign(p.y - prev.y);
        for (let x = prev.x + dx, y = prev.y + dy; x !== p.x || y !== p.y; x += dx, y += dy) cells.push({ x, y });
      }
      cells.push({ x: p.x, y: p.y, wait: p.wait ?? 0, look: p.look ?? null });
    });
    return cells;
  }

  // A route is valid when each point lies on a straight (row, column or 45°) line from the one before.
  function routeProblem(route) {
    if (!Array.isArray(route) || route.length < 2) return '경로는 2칸 이상이어야 해요';
    for (let i = 1; i < route.length; i++) {
      const dx = route[i].x - route[i - 1].x;
      const dy = route[i].y - route[i - 1].y;
      if (!dx && !dy) return `경로 ${i}번째 칸이 앞 칸과 같아요`;
      if (dx && dy && Math.abs(dx) !== Math.abs(dy)) return `경로 ${i}번째 칸이 앞 칸과 직선으로 이어지지 않아요`;
    }
    return null;
  }

  // One entry per beat over a whole round of the patrol: where the guard stands and which way it looks.
  const slotCache = new WeakMap();
  function slots(config) {
    if (slotCache.has(config)) return slotCache.get(config);
    let cells = expandRoute(config.route);
    if ((config.loop ?? 'bounce') === 'bounce') cells = [...cells, ...cells.slice(1, -1).reverse()];
    else {
      // loop: walk back to the first cell along a straight line if the route does not close itself
      const first = cells[0];
      const last = cells[cells.length - 1];
      if (first.x !== last.x || first.y !== last.y) cells = [...cells, ...expandRoute([last, first]).slice(1, -1)];
    }
    const out = [];
    cells.forEach((c, i) => {
      const next = cells[(i + 1) % cells.length];
      const moving = dirOf(next.x - c.x, next.y - c.y);
      out.push({ x: c.x, y: c.y, facing: moving });
      const looks = c.look?.length ? c.look : null;
      for (let k = 0; k < (c.wait ?? 0); k++) out.push({ x: c.x, y: c.y, facing: looks ? looks[k % looks.length] : moving });
    });
    slotCache.set(config, out);
    return out;
  }

  const beatsAt = (beatMs, anchorAt, now) => Math.max(0, Math.floor((now - anchorAt) / beatMs));

  // A noise check: walk the path to the noise one beat a cell, look around for `hold` beats, walk back
  // to the cell next to where it left the route; the round then picks up on that very cell.
  const detourLength = (d) => d.path.length * 2 - 1 + (d.hold ?? 3);

  function positionAt(config, state, now, beatMs) {
    const ring = slots(config);
    if (state?.anchorAt == null) return { ...ring[0], beat: 0, checking: false };
    const beat = beatsAt(beatMs, state.anchorAt, now);
    const d = state.detour;
    if (d && beat >= d.startBeat && beat < d.startBeat + detourLength(d)) {
      const k = beat - d.startBeat;
      const n = d.path.length;
      const hold = d.hold ?? 3;
      const from = d.from;
      if (k < n) {
        const cell = d.path[k];
        const prev = k ? d.path[k - 1] : from;
        return { x: cell.x, y: cell.y, facing: dirOf(cell.x - prev.x, cell.y - prev.y), beat, checking: true };
      }
      if (k < n + hold) {
        const at = d.path[n - 1] ?? from;
        const looks = ['n', 'e', 's', 'w'];
        return { x: at.x, y: at.y, facing: looks[(k - n) % 4], beat, checking: true };
      }
      const back = [...d.path].reverse().slice(1);
      const cell = back[k - n - hold];
      const prev = k - n - hold ? back[k - n - hold - 1] : d.path[n - 1];
      return { x: cell.x, y: cell.y, facing: dirOf(cell.x - prev.x, cell.y - prev.y), beat, checking: true };
    }
    // the round goes on, minus the beats spent checking (a finished detour counts too)
    const lost = (state.offset ?? 0) + (d && beat >= d.startBeat + detourLength(d) ? detourLength(d) : 0);
    const k = (((beat - lost) % ring.length) + ring.length) % ring.length;
    return { ...ring[k], beat, checking: false };
  }

  // Where a camera looks at `now`: fixed on its first direction, or turning through them.
  function cameraFacing(config, state, now) {
    const facings = config.facings;
    if ((config.mode ?? 'fixed') !== 'sweep' || state?.anchorAt == null) return facings[0];
    const dwell = state.dwellMs ?? config.dwellMs ?? 4000;
    return facings[Math.floor(Math.max(0, now - state.anchorAt) / dwell) % facings.length];
  }

  // The cells a viewer at (x, y) facing `facing` can see: a cone `range` deep, narrow (half width
  // floor(d/2) at distance d) or wide (d−1), cut off by walls and blockers along a straight line.
  // `blocked(x, y)` says whether a cell stops sight (wall, solid object, closed door).
  function visionCells(from, facing, vision, blocked, width, height) {
    const range = vision?.range ?? 4;
    const wide = (vision?.cone ?? 'narrow') === 'wide';
    const [fx, fy] = DIRS[facing] ?? DIRS.s;
    const diagonal = fx !== 0 && fy !== 0;
    const out = [];
    for (let ry = -range; ry <= range; ry++) {
      for (let rx = -range; rx <= range; rx++) {
        if (!rx && !ry) continue;
        let d;
        let side;
        if (diagonal) {
          if (rx * fx < 0 || ry * fy < 0) continue;
          d = Math.max(Math.abs(rx), Math.abs(ry));
          side = Math.abs(Math.abs(rx) - Math.abs(ry));
        } else {
          d = rx * fx + ry * fy; // distance straight ahead
          side = Math.abs(rx * fy + ry * fx); // distance to the side
        }
        if (d < 1 || d > range) continue;
        const half = wide ? d - 1 : Math.floor(d / 2);
        if (side > half) continue;
        const x = from.x + rx;
        const y = from.y + ry;
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        if (blocked(x, y) || !clearLine(from.x, from.y, x, y, blocked)) continue;
        out.push({ x, y });
      }
    }
    return out;
  }

  // Bresenham: true when no cell strictly between the two ends stops sight.
  function clearLine(x0, y0, x1, y1, blocked) {
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    let x = x0;
    let y = y0;
    for (;;) {
      if (x === x1 && y === y1) return true;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y += sy;
      }
      if ((x !== x1 || y !== y1) && blocked(x, y)) return false;
    }
  }

  const sees = (from, facing, vision, blocked, width, height, target) =>
    visionCells(from, facing, vision, blocked, width, height).some((c) => c.x === target.x && c.y === target.y);

  // Shortest walk on the floor (4 directions), for a guard going to check a noise.
  function walkPath(from, to, walkable, limit = 60) {
    const key = (x, y) => `${x}:${y}`;
    const prev = new Map([[key(from.x, from.y), null]]);
    const queue = [from];
    for (let i = 0; i < queue.length && prev.size < 4000; i++) {
      const c = queue[i];
      if (c.x === to.x && c.y === to.y) {
        const path = [];
        for (let k = key(c.x, c.y); prev.get(k); k = prev.get(k).from) path.unshift(prev.get(k).cell);
        return path.length <= limit ? path : null;
      }
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const n = { x: c.x + dx, y: c.y + dy };
        const k = key(n.x, n.y);
        if (prev.has(k) || !walkable(n.x, n.y)) continue;
        prev.set(k, { from: key(c.x, c.y), cell: n });
        queue.push(n);
      }
    }
    return null;
  }

  const api = { DIRS, expandRoute, routeProblem, slots, positionAt, detourLength, cameraFacing, visionCells, clearLine, sees, walkPath, beatsAt };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Patrol = api;
})(typeof window !== 'undefined' ? window : globalThis);
