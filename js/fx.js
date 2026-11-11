// 演出の部品：はじける粒・波紋・ハンコ・紙ふぶき・ぽんっと出る動き。
// スマホが「動きを減らす」設定のときは、何もしない。
// どれも画面のじゃまをしない（指の操作をさえぎらない）ように作る。

const COLORS = ['#E5007F', '#19B4F0', '#FFFFFF', '#6E36E0', '#FFD60A'];

/** 動きを減らす設定になっているか */
export function reduced() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

let layer = null;

function fxLayer() {
  if (!layer || !layer.isConnected) {
    layer = document.createElement('div');
    layer.className = 'fx-layer';
    layer.setAttribute('aria-hidden', 'true');
    document.body.append(layer);
  }
  return layer;
}

/**
 * 画面の (x, y) から、色つきの粒がはじける。
 * @param {number} x 画面の左からの位置（px）
 * @param {number} y 画面の上からの位置（px）
 * @param {object} [options]
 * @param {number} [options.count] 粒の数
 * @param {number} [options.spread] 飛ぶ距離（px）
 * @param {boolean} [options.stars] 星の形もまぜる
 */
export function burst(x, y, { count = 12, spread = 60, stars = false } = {}) {
  if (reduced()) return;
  const root = fxLayer();
  for (let i = 0; i < count; i++) {
    const bit = document.createElement('span');
    const star = stars && i % 2 === 0;
    bit.className = `fx-bit${star ? ' fx-bit--star' : ''}`;
    const size = star ? 14 : 8 + Math.random() * 6;
    bit.style.width = bit.style.height = `${size}px`;
    bit.style.left = `${x}px`;
    bit.style.top = `${y}px`;
    bit.style.background = COLORS[i % COLORS.length];
    root.append(bit);
    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.5;
    const distance = spread * (0.6 + Math.random() * 0.6);
    const dx = Math.cos(angle) * distance;
    const dy = Math.sin(angle) * distance;
    bit.animate(
      [
        { transform: 'translate(0, 0) scale(0.4) rotate(0deg)', opacity: 1 },
        { transform: `translate(${dx}px, ${dy}px) scale(1) rotate(${Math.random() * 180}deg)`, opacity: 1, offset: 0.6 },
        { transform: `translate(${dx * 1.15}px, ${dy * 1.15 + 18}px) scale(0.6)`, opacity: 0 },
      ],
      { duration: 650 + Math.random() * 250, easing: 'cubic-bezier(0.2, 0.8, 0.3, 1)' },
    ).finished.then(() => bit.remove(), () => bit.remove());
  }
}

/** 要素のまんなかから、粒がはじける */
export function burstAt(element, options) {
  if (!element || reduced()) return;
  const rect = element.getBoundingClientRect();
  burst(rect.left + rect.width / 2, rect.top + rect.height / 2, options);
}

/**
 * マップの上の場所に、波紋を出す（ワードを置いたとき）。
 * @param {HTMLElement} map マップ
 * @param {{ x: number, y: number }} pos マップの座標（0〜100）
 */
export function ripple(map, pos) {
  if (reduced() || !map) return;
  const ring = document.createElement('span');
  ring.className = 'fx-ripple';
  ring.style.left = `${pos.x}%`;
  ring.style.top = `${pos.y}%`;
  map.append(ring);
  ring.animate(
    [
      { width: '0px', height: '0px', margin: '0px', opacity: 0.9 },
      { width: '64px', height: '64px', margin: '-32px 0 0 -32px', opacity: 0 },
    ],
    { duration: 520, easing: 'ease-out' },
  ).finished.then(() => ring.remove(), () => ring.remove());
}

/**
 * ぽんっと大きくなって出てくる。
 * @param {Element} element
 * @param {object} [options]
 * @param {number} [options.delay] 始まるまでの時間（ミリ秒）
 * @param {string} [options.from] はじめの大きさなど（transform の書き方）
 * @param {string} [options.base] もともと付いている位置ずらし（例：'translate(-50%, -50%)'）
 */
export function popIn(element, { delay = 0, from = 'scale(0.3)', base = '' } = {}) {
  if (!element || reduced()) return;
  element.animate(
    [
      { transform: `${base} ${from}`, opacity: 0 },
      { transform: `${base} scale(1.12)`, opacity: 1, offset: 0.65 },
      { transform: `${base} scale(1)`, opacity: 1 },
    ],
    { duration: 460, delay, easing: 'cubic-bezier(0.2, 0.9, 0.3, 1.3)', fill: 'backwards' },
  );
}

/** 上から落ちてきて、はねる（答え合わせの、主役の答え） */
export function dropIn(element, { delay = 0 } = {}) {
  if (!element || reduced()) return;
  element.animate(
    [
      { transform: 'translateY(-120px)', opacity: 0 },
      { transform: 'translateY(0)', opacity: 1, offset: 0.55 },
      { transform: 'translateY(-14px)', offset: 0.75 },
      { transform: 'translateY(0)' },
    ],
    { duration: 700, delay, easing: 'ease-out', fill: 'backwards' },
  );
}

/** 横からすべりこむ（順位やまとめの行） */
export function slideIn(element, { delay = 0 } = {}) {
  if (!element || reduced()) return;
  element.animate(
    [
      { transform: 'translateX(-30px)', opacity: 0 },
      { transform: 'translateX(4px)', opacity: 1, offset: 0.7 },
      { transform: 'translateX(0)', opacity: 1 },
    ],
    { duration: 420, delay, easing: 'ease-out', fill: 'backwards' },
  );
}

/** ぶるっとふるえる */
export function shake(element) {
  if (!element || reduced()) return;
  element.animate(
    [
      { transform: 'translateX(0)' },
      { transform: 'translateX(-6px) rotate(-2deg)' },
      { transform: 'translateX(6px) rotate(2deg)' },
      { transform: 'translateX(-4px)' },
      { transform: 'translateX(0)' },
    ],
    { duration: 380, easing: 'ease-in-out' },
  );
}

/** 数字などを、少しだけ大きくしてもどす（残り時間が1秒へったとき） */
export function bump(element) {
  if (!element || reduced()) return;
  element.animate([{ transform: 'scale(1.25)' }, { transform: 'scale(1)' }], { duration: 260, easing: 'ease-out' });
}

/**
 * マップの上に、ハンコをどんっと押す（ロックしたとき）。
 * @param {HTMLElement} container ハンコを押す場所（マップ）
 * @param {string} text ハンコの文字
 */
export function stamp(container, text) {
  if (!container) return;
  container.querySelector('.fx-stamp')?.remove();
  const mark = document.createElement('span');
  mark.className = 'fx-stamp';
  mark.textContent = text;
  mark.setAttribute('aria-hidden', 'true');
  container.append(mark);
  if (reduced()) return;
  mark.animate(
    [
      { transform: 'translate(-50%, -50%) rotate(-12deg) scale(2.4)', opacity: 0 },
      { transform: 'translate(-50%, -50%) rotate(-12deg) scale(0.92)', opacity: 1, offset: 0.55 },
      { transform: 'translate(-50%, -50%) rotate(-12deg) scale(1)', opacity: 1 },
    ],
    { duration: 380, easing: 'cubic-bezier(0.3, 0.7, 0.4, 1)' },
  );
  const rect = container.getBoundingClientRect();
  window.setTimeout(() => burst(rect.left + rect.width / 2, rect.top + rect.height / 2, { count: 14, spread: 90, stars: true }), 200);
}

/** 紙ふぶきを降らせる（最終結果） */
export function confetti({ duration = 2600, count = 110 } = {}) {
  if (reduced()) return;
  const canvas = document.createElement('canvas');
  canvas.className = 'fx-confetti';
  canvas.setAttribute('aria-hidden', 'true');
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = window.innerWidth;
  const height = window.innerHeight;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  document.body.append(canvas);
  const ctx = canvas.getContext('2d');
  ctx.scale(ratio, ratio);
  const pieces = Array.from({ length: count }, (_, i) => ({
    x: Math.random() * width,
    y: -20 - Math.random() * height * 0.6,
    w: 7 + Math.random() * 7,
    h: 10 + Math.random() * 8,
    vx: (Math.random() - 0.5) * 2.2,
    vy: 2 + Math.random() * 3,
    angle: Math.random() * Math.PI,
    spin: (Math.random() - 0.5) * 0.3,
    color: COLORS[i % COLORS.length],
  }));
  const start = performance.now();
  function frame(now) {
    const t = now - start;
    ctx.clearRect(0, 0, width, height);
    ctx.globalAlpha = t > duration - 500 ? Math.max(0, (duration - t) / 500) : 1;
    for (const p of pieces) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.04;
      p.angle += p.spin;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.strokeStyle = '#161616';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    if (t < duration) requestAnimationFrame(frame);
    else canvas.remove();
  }
  requestAnimationFrame(frame);
}

/** スマホを短くふるわせる（できる機種だけ） */
export function haptic(pattern = 10) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // ふるえなくても困らない
  }
}

/**
 * 答え合わせのスポットライトを、なめらかな曲線でマップの上をめぐらせる。
 * 答えの場所とは関係なく、みんなの予想とランダムな場所を通る（止まる場所で答えが先にわからないように）。
 * 終わりに近づくほど、ゆっくりになる。
 * @param {HTMLElement} spot 動かすスポットライト（left・top を % で入れる）
 * @param {{ x: number, y: number }[]} guesses みんなの予想の場所（0〜100）
 * @param {number} [total] めぐる時間（ミリ秒）
 * @returns {() => void} とちゅうで止める関数
 */
// 次に通る場所としてよいか：前の場所から少しはなれていて、来た向きと逆もどりしない（角ばった動きにしない）
function goodNext(points, pos) {
  const last = points.at(-1);
  if (!last) return true;
  if (Math.hypot(pos.x - last.x, pos.y - last.y) < 22) return false;
  const before = points.at(-2);
  if (!before) return true;
  const a = Math.atan2(last.y - before.y, last.x - before.x);
  const b = Math.atan2(pos.y - last.y, pos.x - last.x);
  let turn = Math.abs(a - b);
  if (turn > Math.PI) turn = 2 * Math.PI - turn;
  return turn < (Math.PI * 100) / 180;
}

export function moveSpotlight(spot, guesses, total = 5000) {
  // 通る場所：1秒に2か所くらい（前の半分くらいの速さ）。となりの場所とは、少しはなす
  const count = Math.max(4, Math.round((total / 1000) * 2));
  const points = [];
  for (let i = 0; i <= count; i++) {
    let pos;
    let tries = 0;
    do {
      pos = guesses.length && Math.random() < 0.45
        ? guesses[Math.floor(Math.random() * guesses.length)]
        : { x: 12 + Math.random() * 76, y: 12 + Math.random() * 76 };
      tries += 1;
    } while (tries < 40 && !goodNext(points, pos));
    points.push(pos);
  }
  // 点をなめらかにつなぐ曲線（カトマル－ロム）。曲線はマップの中に収める
  const at = (u) => {
    const seg = Math.min(points.length - 2, Math.floor(u * (points.length - 1)));
    const t = u * (points.length - 1) - seg;
    const p0 = points[Math.max(0, seg - 1)];
    const p1 = points[seg];
    const p2 = points[seg + 1];
    const p3 = points[Math.min(points.length - 1, seg + 2)];
    const curve = (a, b, c, d) => 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (3 * b - a - 3 * c + d) * t * t * t);
    const clampPos = (v) => Math.min(94, Math.max(6, v));
    return { x: clampPos(curve(p0.x, p1.x, p2.x, p3.x)), y: clampPos(curve(p0.y, p1.y, p2.y, p3.y)) };
  };
  const start = performance.now();
  let frame = 0;
  const step = (now) => {
    // 最初のコマの時刻は、動かしはじめより少し前のことがあるので、0〜1 に収める
    const t = Math.min(1, Math.max(0, (now - start) / total));
    // だんだんゆっくり
    const pos = at(1 - (1 - t) ** 1.5);
    spot.style.left = `${pos.x}%`;
    spot.style.top = `${pos.y}%`;
    if (t < 1) frame = requestAnimationFrame(step);
  };
  frame = requestAnimationFrame(step);
  return () => cancelAnimationFrame(frame);
}
