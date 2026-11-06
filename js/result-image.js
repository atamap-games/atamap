// 結果画像を作る（横1200×縦675、Xで切れずに表示される大きさ）。
// 主役は「今日のズレ大賞」のワード。左にそのワードのマップ、右に賞を並べる。
import { awards, wordResult, NEAR, CLOSE } from './score.js';
import { playerById } from './game.js';

const W = 1200;
const H = 675;

// 色と文字は、画面（css/style.css）のポップな見た目にそろえる
const COLOR = {
  bg: '#FFF3D1',
  dot: '#FFE6A3',
  surface: '#FFFFFF',
  ink: '#22203A',
  inkSoft: '#57536B',
  line: '#E9DABA',
  axis: '#C9B994',
  primary: '#F24E2E',
  accent: '#0E7F6A',
  yellow: '#FFD23F',
  quarters: ['#FFF6D6', '#FFEAF3', '#E6FAF3', '#E8F4FF'], // 左上・右上・左下・右下
};
const FONT = '"M PLUS Rounded 1c", "Hiragino Maru Gothic ProN", "Hiragino Sans", "Noto Sans JP", "Noto Sans CJK JP", "Yu Gothic", "Meiryo", sans-serif';
const FONT_ROUND = `"Mochiy Pop One", ${FONT}`;

/**
 * 結果画像を描く。
 * @param {object} game ゲーム
 * @param {object[]} topics お題の一覧
 * @returns {Promise<{ blob: Blob, summary: { word: string, mainName: string, topicTitle: string } | null }>}
 */
export async function drawResultImage(game, topics) {
  await document.fonts?.ready;
  // 画像に使うポップな文字を、読みこんでおく（読みこめなくても、ほかの文字で描く）
  await Promise.all([document.fonts?.load(`40px "Mochiy Pop One"`), document.fonts?.load(`800 24px "M PLUS Rounded 1c"`)].map((p) => p?.catch(() => {})));
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const result = awards(game);

  ctx.fillStyle = COLOR.bg;
  ctx.fillRect(0, 0, W, H);
  // 水玉もよう
  ctx.fillStyle = COLOR.dot;
  for (let y = 12; y < H; y += 26) {
    for (let x = 12; x < W; x += 26) {
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  let summary = null;
  const zure = result.zure;
  if (zure) {
    const main = playerById(game, zure.mainId);
    const topic = topics.find((t) => t.id === game.maps[zure.mainId].topicId);
    drawMap(ctx, { x: 40, y: 95, size: 540 }, topic, wordResult(game, zure.mainId, zure.word), game);
    drawText(ctx, `お題「${topic.title}」の「${zure.word}」`, 40, 70, { size: 26, weight: 800, color: COLOR.ink, maxWidth: 540 });
    summary = { word: zure.word, mainName: main.name, topicTitle: topic.title };

    // 右側：今日のズレ大賞
    const x = 630;
    drawText(ctx, '今日のズレ大賞', x, 130, { size: 28, weight: 800, color: COLOR.primary });
    drawText(ctx, `「${zure.word}」`, x - 14, 215, { size: 76, weight: 800, font: FONT_ROUND, color: COLOR.ink, maxWidth: 540 });
    drawText(ctx, `主役：${main.name}さん　みんなの予想と平均${Math.round(zure.average)}ズレ`, x, 265, { size: 24, weight: 700, color: COLOR.inkSoft, maxWidth: 530 });
  } else {
    drawText(ctx, 'アタマップの結果', 40, 120, { size: 64, weight: 800, font: FONT_ROUND, color: COLOR.ink });
  }

  // 右側：ほかの賞
  const x = 630;
  ctx.strokeStyle = COLOR.line;
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
    drawText(ctx, label, x, y, { size: 22, weight: 700, color: COLOR.inkSoft });
    drawText(ctx, value, x + 190, y + 2, { size: 32, weight: 800, font: FONT_ROUND, color: COLOR.ink, maxWidth: W - 40 - (x + 190) });
  });

  drawText(ctx, 'あなたならどこに置く？', x, 600, { size: 30, weight: 800, color: COLOR.accent });
  drawText(ctx, 'アタマップ  #アタマップ', W - 40, 645, { size: 24, weight: 800, color: COLOR.primary, align: 'right' });

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  return { blob, summary };
}

// マップ（軸・軸の言葉・3点と1点の輪・主役の答え・みんなの予想）を描く
function drawMap(ctx, box, topic, result, game) {
  const { x, y, size } = box;
  const toX = (v) => x + (v / 100) * size;
  const toY = (v) => y + (v / 100) * size;

  // ずらした影
  roundRect(ctx, x, y + 8, size, size, 28);
  ctx.fillStyle = COLOR.ink;
  ctx.fill();

  ctx.save();
  roundRect(ctx, x, y, size, size, 28);
  ctx.fillStyle = COLOR.surface;
  ctx.fill();
  ctx.clip();
  // 4つの角を、うすく色分け
  const half = size / 2;
  [[0, 0], [half, 0], [0, half], [half, half]].forEach(([qx, qy], i) => {
    ctx.fillStyle = COLOR.quarters[i];
    ctx.fillRect(x + qx, y + qy, half, half);
  });

  // 軸
  ctx.strokeStyle = COLOR.axis;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x + size / 2, y);
  ctx.lineTo(x + size / 2, y + size);
  ctx.moveTo(x, y + size / 2);
  ctx.lineTo(x + size, y + size / 2);
  ctx.stroke();

  // 3点・1点の輪
  if (result.answer) {
    const cx = toX(result.answer.x);
    const cy = toY(result.answer.y);
    for (const [radius, fill, stroke] of [[CLOSE, 'rgba(224,70,42,0.08)', 'rgba(224,70,42,0.5)'], [NEAR, 'rgba(224,70,42,0.16)', 'rgba(224,70,42,0.7)']]) {
      ctx.beginPath();
      ctx.arc(cx, cy, (radius / 100) * size, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  // 軸の言葉
  const label = (text, lx, ly, align, baseline) => drawText(ctx, text, lx, ly, { size: 20, weight: 700, color: COLOR.inkSoft, align, baseline, pad: COLOR.surface });
  label(topic.axes.top, x + size / 2, y + 16, 'center', 'top');
  label(topic.axes.bottom, x + size / 2, y + size - 16, 'center', 'bottom');
  label(topic.axes.left, x + 12, y + size / 2, 'left', 'middle');
  label(topic.axes.right, x + size - 12, y + size / 2, 'right', 'middle');

  // みんなの予想
  for (const r of result.results) {
    if (!r.pos) continue;
    const player = playerById(game, r.playerId);
    drawPin(ctx, toX(r.pos.x), toY(r.pos.y), { text: player.name, color: player.color, radius: 9, box });
  }
  // 主役の答え（いちばん上に）
  if (result.answer) {
    drawPin(ctx, toX(result.answer.x), toY(result.answer.y), { text: '答え', color: COLOR.primary, radius: 14, box, dark: true });
  }
  ctx.restore();

  // 枠
  roundRect(ctx, x, y, size, size, 28);
  ctx.strokeStyle = COLOR.ink;
  ctx.lineWidth = 5;
  ctx.stroke();
}

// 点と名札。名札は点の上（上が狭いときは下）に出し、マップからはみ出さないようにずらす
function drawPin(ctx, px, py, { text, color, radius, box, dark = false }) {
  ctx.beginPath();
  ctx.arc(px, py, radius + 3, 0, Math.PI * 2);
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(px, py, radius, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();

  const size = dark ? 22 : 18;
  ctx.font = `800 ${size}px ${FONT}`;
  const w = ctx.measureText(text).width + 20;
  const h = size + 12;
  const gap = radius + 8;
  let lx = Math.min(Math.max(px - w / 2, box.x + 6), box.x + box.size - w - 6);
  let ly = py - gap - h;
  if (ly < box.y + 6) ly = py + gap;
  roundRect(ctx, lx, ly, w, h, h / 2);
  ctx.fillStyle = dark ? COLOR.ink : '#FFFFFF';
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = dark ? COLOR.ink : color;
  ctx.stroke();
  ctx.fillStyle = dark ? '#FFFFFF' : COLOR.ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, lx + w / 2, ly + h / 2 + 1);
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
    ctx.fillStyle = pad;
    ctx.fillRect(left, top, w, h);
  }
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
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
