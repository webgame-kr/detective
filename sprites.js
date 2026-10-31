// Pixel sprites: shared player looks (/avatars) and case NPC sprites (case assets).
// Frames keep their own durations, loops follow the data, and drawing is integer-scaled with no
// smoothing so the pixel art stays crisp.

const images = new Map();

export function loadImage(url) {
  let img = images.get(url);
  if (!img) {
    img = new Image();
    img.src = url;
    images.set(url, img);
  }
  return img;
}

let looks = null;
export const looksReady = fetch('avatars/avatars.json')
  .then((r) => (r.ok ? r.json() : null))
  .catch(() => null)
  .then((data) => {
    looks = data;
    for (const c of data?.characters ?? []) loadImage(`avatars/${c.image}`);
    return data;
  });

export const lookSet = () => looks;
export const findLook = (id) => looks?.characters.find((c) => c.id === id) ?? null;

export const animLength = (anim) => anim.frames.reduce((sum, f) => sum + f.ms, 0);

// The frame showing at time t (ms). Non-looping animations hold their last frame.
export function frameAt(anim, t) {
  const total = animLength(anim);
  let rest = anim.loop ? ((t % total) + total) % total : Math.min(t, total - 1);
  for (const f of anim.frames) {
    if (rest < f.ms) return f;
    rest -= f.ms;
  }
  return anim.frames.at(-1);
}

// Draws a frame so its anchor (the feet) lands on (footX, footY).
export function drawFrame(ctx, img, frame, size, anchor, footX, footY, scale = 1) {
  if (!img.complete || !img.naturalWidth) return false;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, frame.x, frame.y, size[0], size[1], Math.round(footX - anchor[0] * scale), Math.round(footY - anchor[1] * scale), size[0] * scale, size[1] * scale);
  return true;
}

// Which frame a player look shows. There is no idle per direction: facing south uses the idle
// loop, other directions hold the first frame of that direction's walk. Inspect and pickup face
// right and write faces front, as delivered.
export function lookFrame(look, { facing = 's', moving = false, action = null, actionT = 0, now = 0 }) {
  const a = look.actions;
  if (action && a[action] && actionT < animLength(a[action])) return frameAt(a[action], actionT);
  if (moving) return frameAt(a[`walk_${facing}`], now);
  if (facing === 's') return frameAt(a.idle, now);
  return a[`walk_${facing}`].frames[0];
}

// A small still canvas of one frame, for pickers and lists.
export function spriteThumb(url, frame, size, scale = 2) {
  const canvas = document.createElement('canvas');
  canvas.width = size[0] * scale;
  canvas.height = size[1] * scale;
  canvas.className = 'sprite-thumb';
  const img = loadImage(url);
  const draw = () => {
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, frame.x, frame.y, size[0], size[1], 0, 0, size[0] * scale, size[1] * scale);
  };
  if (img.complete && img.naturalWidth) draw();
  else img.addEventListener('load', draw, { once: true });
  return canvas;
}

export function lookThumb(id, scale = 2) {
  const look = findLook(id);
  return look ? spriteThumb(`avatars/${look.image}`, look.actions.idle.frames[0], looks.frameSize, scale) : null;
}
