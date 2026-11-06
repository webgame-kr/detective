'use strict';
// A dance show (gimmick dance), shared by the server (which judges songs and slots) and the client
// (which draws the dancers and the song banner). Like a guard's patrol, everything is a pure function
// of time: the show began at anchorAt and plays its songs one after another, each `beats` beats long,
// then starts again from the first. Nothing is stored per beat.
//
// Loaded by the server as a CommonJS module and by the page as a plain script (window.Dance), after
// shared/patrol.js (routes are walked the way a guard walks a loop).
(function (root) {
  const P = typeof module !== 'undefined' && module.exports ? require('./patrol') : root.Patrol;

  const showBeats = (songs) => songs.reduce((n, s) => n + s.beats, 0);

  // The song playing at `now`: number (1-based), index, loop (how many times the show has ended),
  // round (a counter over every song played since anchorAt: it tells two plays of a song apart),
  // beat (beats into the song), beats, and when it began and ends (ms). null before the show starts.
  function songAt(songs, anchorAt, now, beatMs) {
    if (anchorAt == null || !Array.isArray(songs) || !songs.length) return null;
    const total = showBeats(songs);
    const beat = Math.max(0, Math.floor((now - anchorAt) / beatMs));
    const loop = Math.floor(beat / total);
    let rest = beat - loop * total;
    for (let i = 0; i < songs.length; i++) {
      if (rest < songs[i].beats) {
        const startBeat = beat - rest;
        return {
          number: i + 1,
          index: i,
          loop,
          round: loop * songs.length + i,
          beat: rest,
          beats: songs[i].beats,
          startAt: anchorAt + startBeat * beatMs,
          endAt: anchorAt + (startBeat + songs[i].beats) * beatMs,
        };
      }
      rest -= songs[i].beats;
    }
    return null;
  }

  // When a given round (see songAt) begins.
  function roundStart(songs, anchorAt, round, beatMs) {
    const loop = Math.floor(round / songs.length);
    const i = round % songs.length;
    return anchorAt + (loop * showBeats(songs) + songs.slice(0, i).reduce((n, s) => n + s.beats, 0)) * beatMs;
  }

  // The first round at or after `now` in which song `number` plays (the one playing now counts).
  function nextRound(songs, anchorAt, now, beatMs, number) {
    const cur = songAt(songs, anchorAt, now, beatMs);
    if (!cur) return null;
    const ahead = (number - 1 - cur.index + songs.length) % songs.length;
    return cur.round + ahead;
  }

  // The route a dancer follows in song `number` (routes["3"] for song 3, else route), and whether
  // the dancer is on the floor in that song at all (songs omitted: every song).
  const routeFor = (dancer, number) => dancer.routes?.[String(number)] ?? dancer.route ?? null;
  const dancing = (dancer, number) => (!Array.isArray(dancer.songs) || dancer.songs.includes(number)) && Boolean(routeFor(dancer, number));

  // A route is walked as a loop (back to its first point along a straight line), one cell a beat,
  // from its first point when the song starts. A point may wait some beats (as a guard's does).
  const wrappers = new WeakMap();
  function ring(route) {
    if (!wrappers.has(route)) wrappers.set(route, { route, loop: 'loop' });
    return route.length === 1 ? [{ x: route[0].x, y: route[0].y, facing: 's' }] : P.slots(wrappers.get(route));
  }

  // A route a dancer can walk: 1 point (standing in place) or more, each on a straight line from the
  // one before, and the last back to the first.
  function routeProblem(route) {
    if (!Array.isArray(route) || route.length < 1 || route.length > 40) return '경로는 1~40칸이어야 해요';
    if (!route.every((p) => p && Number.isInteger(p.x) && Number.isInteger(p.y))) return '경로의 칸은 { "x", "y" } 정수여야 해요';
    if (route.length === 1) return null;
    const problem = P.routeProblem(route);
    if (problem) return problem;
    const first = route[0];
    const last = route[route.length - 1];
    const dx = Math.abs(first.x - last.x);
    const dy = Math.abs(first.y - last.y);
    return dx && dy && dx !== dy ? '마지막 칸에서 첫 칸으로 직선(가로·세로·45도)으로 돌아올 수 없어요' : null;
  }

  // Where a dancer stands at `now` in the song `info` (from songAt), and the cell it came from (for a
  // slide between beats). null when the dancer is off the floor this song.
  function dancerAt(dancer, info, now, beatMs) {
    if (!info || !dancing(dancer, info.number)) return null;
    const cells = ring(routeFor(dancer, info.number));
    const k = Math.max(0, Math.floor((now - info.startAt) / beatMs));
    const cur = cells[k % cells.length];
    const prev = k > 0 ? cells[(k - 1) % cells.length] : cur;
    return { x: cur.x, y: cur.y, facing: cur.facing, prevX: prev.x, prevY: prev.y };
  }

  // Every cell a route covers (validation: each must be floor).
  const routeCells = (route) => (route.length === 1 ? [route[0]] : ring(route));

  // dance:v2 — the way a step goes: e, w, n or s (a slant counts as its side), null for no step
  const stepDir = (dx, dy) => (dx > 0 ? 'e' : dx < 0 ? 'w' : dy < 0 ? 'n' : dy > 0 ? 's' : null);
  const inArea = (at, [x, y, w, h]) => at.x >= x && at.x < x + w && at.y >= y && at.y < y + h;

  // dance:v2 — the look a dancer wears where it stands now (a look: { song, area, sprite }), or null
  const lookAt = (dancer, info, at) => (info && at ? (dancer.looks ?? []).find((l) => l.song === info.number && inArea(at, l.area)) ?? null : null);

  // dance:v2 — which frame of a dancer's sheet shows at `now` in the song `info` (from songAt).
  // sheet: { walk: [frame…], walkMs, turn?: { e|w|n|s: frame }, end?: [frame…] }
  //   - the song's last beats play `end`, one frame a beat (a spin, then a bow)
  //   - a beat whose step goes another way than the step before shows that way's `turn` frame
  //   - otherwise the walk cycle, a frame every walkMs (in place too: they dance where they wait)
  // Reduced motion holds the first walk frame.
  function sheetFrame(sheet, dancer, info, now, beatMs, reduce = false) {
    const walk = Array.isArray(sheet.walk) && sheet.walk.length ? sheet.walk : [0];
    if (reduce || !info) return walk[0];
    const end = sheet.end ?? [];
    const left = info.beats - Math.floor(Math.max(0, now - info.startAt) / beatMs);
    if (end.length && left <= end.length) return end[end.length - left];
    if (sheet.turn) {
      const at = dancerAt(dancer, info, now, beatMs);
      const before = now - beatMs >= info.startAt ? dancerAt(dancer, info, now - beatMs, beatMs) : null;
      const way = at && stepDir(at.x - at.prevX, at.y - at.prevY);
      const was = before && stepDir(before.x - before.prevX, before.y - before.prevY);
      if (way && way !== was && sheet.turn[way] !== undefined) return sheet.turn[way];
    }
    return walk[Math.floor(Math.max(0, now - info.startAt) / (sheet.walkMs ?? 200)) % walk.length];
  }

  const api = { showBeats, songAt, roundStart, nextRound, routeFor, dancing, dancerAt, routeProblem, routeCells, stepDir, lookAt, sheetFrame };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Dance = api;
})(typeof window !== 'undefined' ? window : globalThis);
