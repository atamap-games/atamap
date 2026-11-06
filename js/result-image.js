// 結果画像を作る（横1200×縦675、Xで切れずに表示される大きさ）。
// 主役は「今日のズレ大賞」のワード。左にそのワードのマップ、右に賞を並べる。
import { awards, wordResult, NEAR, CLOSE } from './score.js';
import { playerById } from './game.js';
import { arrangeLabels } from './labels.js';

const W = 1200;
const H = 675;

// 色と文字は、画面（css/style.css）のポップな見た目にそろえる（印刷の4色と白）
const COLOR = {
  bg: '#FFD60A',
  surface: '#FFFFFF',
  ink: '#161616',
  inkSoft: '#4F4B45',
  lip: '#CC9600',
  grid: '#E6EAF2',
  primary: '#E5007F', // マゼンタ
  accent: '#19B4F0', // シアン（水色）
};
const FONT = '"M PLUS Rounded 1c", "Hiragino Maru Gothic ProN", "Hiragino Sans", "Noto Sans JP", "Noto Sans CJK JP", "Yu Gothic", "Meiryo", sans-serif';
// 見出しと大きな文字（太いゴシック）
const FONT_DISPLAY = '"Dela Gothic One", "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Yu Gothic", sans-serif';

/**
 * 結果画像を描く。
 * @param {object} game ゲーム
 * @param {object[]} topics お題の一覧
 * @returns {Promise<{ blob: Blob, summary: { word: string, mainName: string, topicTitle: string } | null }>}
 */
export async function drawResultImage(game, topics) {
  const result = awards(game);
  // 画像に使う文字を、読みこんでおく。日本語の文字は分けて配られるので、使う字を全部わたす
  // （読みこめなくても、ほかの文字で描く）
  await document.fonts?.ready;
  const used = [
    ...game.players.map((p) => p.name),
    ...topics.filter((t) => Object.values(game.maps).some((m) => m.topicId === t.id)).flatMap((t) => [t.title, t.genre, ...t.words, ...Object.values(t.axes)]),
    'お題「」の今日のズレ大賞主役：さん　みんなの予想と平均ズレ以心伝心王ミステリアス賞ベストペア該当なし人が同点組（）点・＆',
    'あなたならどこに置く？アタマップ#答え0123456789',
  ].join('');
  await Promise.all([
    document.fonts?.load(`40px "Dela Gothic One"`, used),
    document.fonts?.load(`800 24px "M PLUS Rounded 1c"`, used),
    document.fonts?.load(`900 24px "M PLUS Rounded 1c"`, used),
  ].map((p) => p?.catch(() => {})));
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = COLOR.bg;
  ctx.fillRect(0, 0, W, H);
  // 右上と左下のすみに、印刷のあみ点（すみほど大きい）
  ctx.fillStyle = 'rgba(229, 0, 127, 0.18)';
  for (let y = 8; y < H; y += 16) {
    for (let x = 8; x < W; x += 16) {
      const corner = Math.max(1 - Math.hypot(W - x, y) / 420, 1 - Math.hypot(x, H - y) / 420);
      if (corner <= 0) continue;
      ctx.beginPath();
      ctx.arc(x, y, 1 + corner * 4.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  let summary = null;
  const zure = result.zure;
  if (zure) {
    const main = playerById(game, zure.mainId);
    const topic = topics.find((t) => t.id === game.maps[zure.mainId].topicId);
    drawMap(ctx, { x: 40, y: 95, size: 540 }, topic, wordResult(game, zure.mainId, zure.word), game);
    drawText(ctx, `お題「${topic.title}」の「${zure.word}」`, 40, 70, { size: 26, weight: 900, color: COLOR.ink, maxWidth: 540 });
    summary = { word: zure.word, mainName: main.name, topicTitle: topic.title };

    // 右側：今日のズレ大賞
    const x = 630;
    drawTag(ctx, '今日のズレ大賞', x, 92, { color: COLOR.primary, text: COLOR.surface, angle: -0.04 });
    drawPopText(ctx, `「${zure.word}」`, x - 10, 215, { size: 72, maxWidth: 540 });
    drawText(ctx, `主役：${main.name}さん　みんなの予想と平均${Math.round(zure.average)}ズレ`, x, 265, { size: 24, weight: 800, color: COLOR.ink, maxWidth: 530 });
  } else {
    drawPopText(ctx, 'アタマップの結果', 40, 120, { size: 60 });
  }

  // 右側：ほかの賞
  const x = 630;
  ctx.strokeStyle = COLOR.ink;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x, 300);
  ctx.lineTo(W - 40, 300);
  ctx.stroke();
  const names = (ids) => (ids.length >= 3 ? `${ids.length}人が同点` : ids.map((id) => playerById(game, id).name).join('・'));
  const rows = [
    ['以心伝心王', result.telepathy.points > 0 ? `${names(result.telepathy.playerIds)}（${result.telepathy.points}点）` : '該当なし'],
    ['ミステリアス賞', names(result.mysterious.playerIds)],
    ['ベストペア', result.bestPair.points > 0
      ? (result.bestPair.pairs.length >= 2 ? `${result.bestPair.pairs.length}組が同点` : result.bestPair.pairs[0].map((id) => playerById(game, id).name).join('＆'))
      : '該当なし'],
  ];
  rows.forEach(([label, value], i) => {
    const y = 355 + i * 72;
    drawText(ctx, label, x, y, { size: 22, weight: 800, color: COLOR.inkSoft });
    drawText(ctx, value, x + 190, y + 2, { size: 30, weight: 400, font: FONT_DISPLAY, color: COLOR.ink, maxWidth: W - 40 - (x + 190) });
  });

  drawText(ctx, 'あなたならどこに置く？', x, 600, { size: 30, weight: 400, font: FONT_DISPLAY, color: COLOR.ink });
  // ロゴ（画面のトップと同じ：マゼンタの文字に黒い縁取り、水色の立体）
  ctx.font = `400 34px ${FONT_DISPLAY}`;
  const logoWidth = ctx.measureText('アタマップ').width;
  drawPopText(ctx, 'アタマップ', W - 44 - logoWidth, 652, { size: 34, fill: COLOR.primary });
  drawText(ctx, '#アタマップ', W - 60 - logoWidth, 648, { size: 22, weight: 900, color: COLOR.ink, align: 'right' });

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  return { blob, summary };
}

// マップ（方眼・軸・軸の言葉・3点と1点の輪・主役の答え・みんなの予想）を描く
function drawMap(ctx, box, topic, result, game) {
  const { x, y, size } = box;
  const toX = (v) => x + (v / 100) * size;
  const toY = (v) => y + (v / 100) * size;

  // 下にのぞく濃いふち
  roundRect(ctx, x, y + 8, size, size, 24);
  ctx.fillStyle = COLOR.lip;
  ctx.fill();

  ctx.save();
  roundRect(ctx, x, y, size, size, 24);
  ctx.fillStyle = COLOR.surface;
  ctx.fill();
  ctx.clip();
  // 方眼（1マスが10）
  ctx.strokeStyle = COLOR.grid;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 1; i < 10; i++) {
    ctx.moveTo(x + (size * i) / 10, y);
    ctx.lineTo(x + (size * i) / 10, y + size);
    ctx.moveTo(x, y + (size * i) / 10);
    ctx.lineTo(x + size, y + (size * i) / 10);
  }
  ctx.stroke();

  // 3点・1点の輪
  if (result.answer) {
    const cx = toX(result.answer.x);
    const cy = toY(result.answer.y);
    for (const [radius, fill, stroke, dash] of [[CLOSE, 'rgba(255,214,10,0.25)', 'rgba(229,0,127,0.7)', [10, 7]], [NEAR, 'rgba(229,0,127,0.14)', COLOR.primary, []]]) {
      ctx.beginPath();
      ctx.arc(cx, cy, (radius / 100) * size, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.setLineDash(dash);
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // 軸：縦は水色、横はマゼンタ
  ctx.lineWidth = 4;
  ctx.strokeStyle = COLOR.accent;
  ctx.beginPath();
  ctx.moveTo(x + size / 2, y);
  ctx.lineTo(x + size / 2, y + size);
  ctx.stroke();
  ctx.strokeStyle = COLOR.primary;
  ctx.beginPath();
  ctx.moveTo(x, y + size / 2);
  ctx.lineTo(x + size, y + size / 2);
  ctx.stroke();

  // 軸の言葉（名札は、なるべくここに重ねない）
  const label = (text, lx, ly, align, baseline, vertical) => drawText(ctx, text, lx, ly, {
    size: 20, weight: 900, align, baseline,
    color: vertical ? COLOR.ink : COLOR.surface,
    pad: vertical ? COLOR.accent : COLOR.primary,
  });
  const axisBoxes = [
    label(topic.axes.top, x + size / 2, y + 16, 'center', 'top', true),
    label(topic.axes.bottom, x + size / 2, y + size - 16, 'center', 'bottom', true),
    label(topic.axes.left, x + 12, y + size / 2, 'left', 'middle', false),
    label(topic.axes.right, x + size - 12, y + size / 2, 'right', 'middle', false),
  ].map((b) => ({ ...b, x: b.x - x, y: b.y - y }));

// 主役の答えとみんなの予想。名札がたがいに重ならないように、置き場所を先に決める（答えの名札がいちばん先）
  const pins = [];
  if (result.answer) pins.push({ pos: result.answer, text: '答え', color: COLOR.primary, radius: 14, answer: true });
  for (const r of result.results) {
    if (!r.pos) continue;
    const player = playerById(game, r.playerId);
    pins.push({ pos: r.pos, text: player.name, color: player.color, radius: 9, answer: false });
  }
  const items = pins.map((pin) => {
    pin.px = toX(pin.pos.x);
    pin.py = toY(pin.pos.y);
    pin.font = pin.answer ? 22 : 18;
    ctx.font = pin.answer ? `400 ${pin.font}px ${FONT_DISPLAY}` : `800 ${pin.font}px ${FONT}`;
    return { x: pin.px - x, y: pin.py - y, w: ctx.measureText(pin.text).width + 20, h: pin.font + 12, gap: pin.radius + 8, dot: pin.radius + 3 };
  });
  const spots = arrangeLabels(items, { width: size, height: size, margin: 6 }, axisBoxes);
  // 名札を点から離したときは、点と名札を線でつなぐ（線 → 点 → 名札の順に重ねる）
  ctx.strokeStyle = COLOR.ink;
  ctx.lineWidth = 3;
  pins.forEach((pin, i) => {
    if (!spots[i].far) return;
    const it = items[i];
    const lx = x + spots[i].x;
    const ly = y + spots[i].y;
    ctx.beginPath();
    ctx.moveTo(pin.px, pin.py);
    ctx.lineTo(Math.min(Math.max(pin.px, lx), lx + it.w), Math.min(Math.max(pin.py, ly), ly + it.h));
    ctx.stroke();
  });
  const drawOrder = [...pins.keys()].reverse(); // 予想が先、答えがいちばん上
  for (const i of drawOrder) drawDot(ctx, pins[i]);
  for (const i of drawOrder) drawLabel(ctx, pins[i], x + spots[i].x, y + spots[i].y, items[i]);
  ctx.restore();
}

// 点（白いふちと黒い線）
function drawDot(ctx, { px, py, color, radius }) {
  ctx.beginPath();
  ctx.arc(px, py, radius + 5, 0, Math.PI * 2);
  ctx.fillStyle = COLOR.ink;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(px, py, radius + 3, 0, Math.PI * 2);
  ctx.fillStyle = COLOR.surface;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(px, py, radius, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

// 名札（置き場所は arrangeLabels で決めたもの）。その人の色に白い文字。答えはマゼンタに黒いふち
function drawLabel(ctx, { text, color, answer, font }, lx, ly, { w, h }) {
  roundRect(ctx, lx, ly + 3, w, h, h / 2);
  ctx.fillStyle = answer ? COLOR.ink : 'rgba(22, 22, 22, 0.3)';
  ctx.fill();
  roundRect(ctx, lx, ly, w, h, h / 2);
  ctx.fillStyle = color;
  ctx.fill();
  if (answer) {
    ctx.lineWidth = 3;
    ctx.strokeStyle = COLOR.ink;
    ctx.stroke();
  }
  ctx.font = answer ? `400 ${font}px ${FONT_DISPLAY}` : `800 ${font}px ${FONT}`;
  ctx.fillStyle = COLOR.surface;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, lx + w / 2, ly + h / 2 + 1);
}

// 斜めに貼った札（「今日のズレ大賞」）
function drawTag(ctx, label, x, y, { color, text, angle }) {
  ctx.save();
  ctx.font = `900 26px ${FONT}`;
  const w = ctx.measureText(label).width + 28;
  const h = 42;
  ctx.translate(x, y);
  ctx.rotate(angle);
  roundRect(ctx, 0, 0, w, h, 8);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.fillStyle = text;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, 14, h / 2 + 1);
  ctx.restore();
}

// 大きな文字：白い文字に黒い縁取り、水色の立体の影（画面の答え合わせのワードと同じ）
function drawPopText(ctx, text, x, y, { size, maxWidth = 0, fill = COLOR.surface }) {
  let fontSize = size;
  ctx.font = `400 ${fontSize}px ${FONT_DISPLAY}`;
  while (maxWidth && ctx.measureText(text).width > maxWidth && fontSize > 24) {
    fontSize -= 2;
    ctx.font = `400 ${fontSize}px ${FONT_DISPLAY}`;
  }
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'round';
  const stroke = Math.max(6, fontSize * 0.14);
  // 立体の影（水色）と、そのふち（黒）
  ctx.lineWidth = stroke;
  ctx.strokeStyle = COLOR.ink;
  ctx.fillStyle = COLOR.ink;
  ctx.strokeText(text, x + 7, y + 7);
  ctx.fillText(text, x + 7, y + 7);
  ctx.strokeStyle = COLOR.accent;
  ctx.fillStyle = COLOR.accent;
  for (let i = 5; i >= 1; i--) {
    ctx.strokeText(text, x + i, y + i);
    ctx.fillText(text, x + i, y + i);
  }
  // 文字（黒い縁取りに、白）
  ctx.strokeStyle = COLOR.ink;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

// 文字を描く。幅が足りないときは、入るまで文字を小さくする
function drawText(ctx, text, x, y, { size, weight = 700, font = FONT, color, align = 'left', baseline = 'alphabetic', maxWidth = 0, pad = '' }) {
  let fontSize = size;
  ctx.font = `${weight} ${fontSize}px ${font}`;
  while (maxWidth && ctx.measureText(text).width > maxWidth && fontSize > 12) {
    fontSize -= 2;
    ctx.font = `${weight} ${fontSize}px ${font}`;
  }
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  if (pad) {
    const w = ctx.measureText(text).width + 12;
    const h = fontSize + 6;
    const left = align === 'center' ? x - w / 2 : align === 'right' ? x - w + 6 : x - 6;
    const top = baseline === 'top' ? y - 3 : baseline === 'bottom' ? y - h + 3 : y - h / 2;
    roundRect(ctx, left, top, w, h, 7);
    ctx.fillStyle = pad;
    ctx.fill();
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
    return { x: left, y: top, w, h };
  }
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  return null;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
