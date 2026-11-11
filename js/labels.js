// 名札（ピンの名前）が、ほかの名札や点に重ならないように置き場所を決める。
// 答え合わせのマップ（screen-reveal.js）と結果画像（result-image.js）で使う。
// 長さはすべて px。点の中心を (x, y) として、名札の左上の位置を返す。

// 名札どうしのすきま
const SPACE = 3;
// 点から上下に、何段先まで探すか（半段ずつ）
const ROWS = 16;
// 左右に、何歩先まで探すか（1歩 STEP px）
const COLS = 24;
const STEP = 7;
// 重なりが残ったときの点数（ほかの何よりも重い）
const HIT = 100000;

/**
 * @param {Array<{ x: number, y: number, w: number, h: number, gap: number, dot: number, top?: number, topW?: number }>} items
 *   置く順にならべる（先のものほど、点のすぐそばの良い場所を取る）。
 *   w・h：名札の大きさ。gap：点の中心から名札までのすきま。dot：点の半径。
 *   top・topW：名札の上（真ん中）に付くもの（「そこ置く!?」）の高さと幅
 * @param {{ width: number, height: number, margin?: number }} area 名札を収める枠（左上が 0, 0）
 * @param {Array<{ x: number, y: number, w: number, h: number }>} [soft] なるべく重ねたくないもの（軸の言葉など）
 * @returns {Array<{ x: number, y: number, far: boolean }>} 名札の左上と、点から離れたか（離れたら線でつなぐ）
 */
export function arrangeLabels(items, area, soft = []) {
  // まずは決められた順で置く。重なりが残ったら、ほかの順もためして、いちばん重なりの少ないものにする
  let best = arrange(items, items.map((_, i) => i), area, soft);
  if (best.hits === 0 || items.length < 2) return best.spots;
  const [first, ...rest] = items.map((_, i) => i);
  const center = { x: area.width / 2, y: area.height / 2 };
  const orders = [
    // 長い名札から
    [first, ...[...rest].sort((a, b) => items[b].w - items[a].w)],
    // 枠の端や角にある点から（置ける場所が少ないので）
    [first, ...[...rest].sort((a, b) => edge(items[a], area) - edge(items[b], area))],
    // 混み合っている点から
    [first, ...[...rest].sort((a, b) => crowd(items, b) - crowd(items, a))],
    // 真ん中から遠い点から
    [first, ...[...rest].sort((a, b) => far(items[b], center) - far(items[a], center))],
  ];
  for (const order of orders) {
    const tried = arrange(items, order, area, soft);
    if (tried.hits < best.hits) best = tried;
    if (best.hits === 0) break;
  }
  return best.spots;
}

function edge(it, area) {
  return Math.min(it.x, area.width - it.x) + Math.min(it.y, area.height - it.y);
}

function crowd(items, i) {
  return items.filter((it, j) => j !== i && Math.hypot(it.x - items[i].x, it.y - items[i].y) < 60).length;
}

function far(it, center) {
  return Math.hypot(it.x - center.x, it.y - center.y);
}

// order の順に、1つずつ、いちばん良い場所に置く
function arrange(items, order, area, soft) {
  const margin = area.margin ?? 4;
  const dots = items.map((it) => ({ x: it.x - it.dot, y: it.y - it.dot, w: it.dot * 2, h: it.dot * 2 }));
  const placed = [];
  const spots = [];
  let hits = 0;
  for (const i of order) {
    const it = items[i];
    let best = null;
    for (const [cx, cy] of candidates(it)) {
      const { label, box } = fit(it, it.x + cx, it.y + cy, area, margin);
      // 点から名札までの長さ（近いほどよい。点のすぐ上がいちばんよい）
      const near = distance(it, label);
      let cost = near * 3 + Math.abs(label.x + label.w / 2 - it.x) * 0.05;
      if (near < it.gap) cost += (it.gap - near) * 50;
      if (label.y > it.y) cost += 6;
      if (best && cost >= best.cost) continue;
      // 重なり：ほかの名札と点には重ねない。軸の言葉には、なるべく重ねない
      let hard = 0;
      for (const p of placed) hard += overlap(box, p, SPACE);
      dots.forEach((d, j) => {
        hard += overlap(box, d, 1) * (j === i ? 3 : 1);
      });
      if (hard > 0) cost += HIT + hard * 10;
      for (const s of soft) cost += overlap(box, s, 0) * 0.3;
      if (!best || cost < best.cost) best = { cost, box, label, hard };
    }
    placed.push(best.box);
    if (best.hard > 0) hits += best.hard;
    spots[i] = { x: best.label.x, y: best.label.y, far: distance(it, best.label) > it.gap + 6 };
  }
  return { spots, hits };
}

// 名札を (x, y) に置いたときの、名札の四角と、上に付くものも入れた四角（枠からはみ出さないように寄せる）
function fit(it, x, y, area, margin) {
  const top = it.top ?? 0;
  const topW = top ? Math.max(it.w, it.topW ?? it.w) : it.w;
  const left = x + it.w / 2 - topW / 2;
  const box = { x: left, y: y - top, w: topW, h: it.h + top };
  const dx = Math.min(Math.max(box.x, margin), area.width - box.w - margin) - box.x;
  const dy = Math.min(Math.max(box.y, margin), area.height - box.h - margin) - box.y;
  box.x += dx;
  box.y += dy;
  return { box, label: { x: x + dx, y: y + dy, w: it.w, h: it.h } };
}

// 名札を置いてみる場所（点から見た名札の左上）。点のまわりを、上下に半段ずつ、左右に少しずつずらして探す
function candidates({ w, h, gap }) {
  const rows = [-h / 2];
  for (let k = 0; k < ROWS; k++) rows.push(-gap - h - (k * (h + SPACE)) / 2, gap + (k * (h + SPACE)) / 2);
  const cols = [gap, -w - gap];
  for (let c = -COLS; c <= COLS; c++) cols.push(-w / 2 + c * STEP);
  const list = [];
  for (const y of rows) for (const x of cols) list.push([x, y]);
  return list;
}

// 点の中心から名札のいちばん近いところまでの長さ
function distance(it, box) {
  const nx = Math.min(Math.max(it.x, box.x), box.x + box.w) - it.x;
  const ny = Math.min(Math.max(it.y, box.y), box.y + box.h) - it.y;
  return Math.hypot(nx, ny);
}

// 2つの四角が重なる面積（pad だけ広げて測る）
function overlap(a, b, pad) {
  const w = Math.min(a.x + a.w, b.x + b.w + pad) - Math.max(a.x, b.x - pad);
  const h = Math.min(a.y + a.h, b.y + b.h + pad) - Math.max(a.y, b.y - pad);
  return w > 0 && h > 0 ? w * h : 0;
}
