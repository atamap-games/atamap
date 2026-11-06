// 最終結果。4つの賞と、予想で取った点の合計の順位を出す。
import { showScreen, showToast, el, openSheet, closeSheet } from './ui.js';
import { totalPoints, awards } from './score.js';
import { playerById } from './game.js';
import { drawResultImage } from './result-image.js';
import { popIn, slideIn, confetti, burstAt } from './fx.js';

const sheet = document.getElementById('share');
const sheetPart = (name) => sheet.querySelector(`[data-share="${name}"]`);

const screen = document.querySelector('[data-screen="end"]');
const part = (name) => screen.querySelector(`[data-end="${name}"]`);

let resolveCurrent = null;
let ended = null; // { game, topics }
let image = null; // { blob, url, file, summary }

/**
 * @param {object} options
 * @param {object} options.game ゲーム
 * @param {object[]} options.topics お題の一覧（結果画像に使う）
 * @param {boolean} [options.canRestart] 「もう一度」を出すか（部屋で遊ぶときはホストだけ）
 * @returns {Promise<'again'|'home'>} 次にすること
 */
export function showEnd({ game, topics, canRestart = true }) {
  ended = { game, topics };
  forgetImage();
  part('again').hidden = !canRestart;
  screen.querySelector('[data-action="end-share"]').parentElement.classList.toggle('actions--split', canRestart);
  const totals = totalPoints(game);
  const sorted = [...game.players].sort((a, b) => totals[b.id] - totals[a.id]);
  // 同じ点なら同じ順位
  let rank = 0;
  let last = null;
  const rows = sorted.map((player, index) => {
    if (totals[player.id] !== last) {
      rank = index + 1;
      last = totals[player.id];
    }
    const row = el('li', `rank-row${rank === 1 ? ' rank-row--top' : ''}`);
    row.style.setProperty('--player-color', player.color);
    row.append(el('span', 'rank-row__rank', `${rank}位`), el('span', 'rank-row__name', player.name), el('span', 'rank-row__points', `${totals[player.id]}点`));
    return row;
  });
  const list = el('ol', `ranking${rows.length > 3 ? ' ranking--two' : ''}`);
  list.append(...rows);
  const awardList = renderAwards(game);
  part('body').replaceChildren(awardList, list);
  showScreen('end');
  // 演出：紙ふぶき → 賞のカードが1枚ずつ出る → 順位がすべりこむ
  confetti();
  [...awardList.children].forEach((card, i) => popIn(card, { delay: 200 + i * 140, from: 'scale(0.4) rotate(-6deg)' }));
  [...list.children].forEach((row, i) => slideIn(row, { delay: 800 + i * 70 }));
  window.setTimeout(() => burstAt(list.querySelector('.rank-row--top'), { count: 14, spread: 70, stars: true }), 1200);
  return new Promise((resolve) => {
    resolveCurrent = resolve;
  });
}

// 受賞した人の名前。3人以上が同点なら「〇人が同点」とまとめる
function winnerNames(game, ids) {
  if (ids.length >= 3) return `${ids.length}人が同点`;
  return ids.map((id) => playerById(game, id).name).join('・');
}

function renderAwards(game) {
  const { telepathy, mysterious, bestPair, zure } = awards(game);
  const pairText = bestPair.pairs.length >= 2
    ? `${bestPair.pairs.length}組が同点`
    : bestPair.pairs[0].map((id) => playerById(game, id).name).join('＆');
  const cards = [
    {
      key: 'telepathy',
      title: '以心伝心王',
      winner: telepathy.points > 0 ? winnerNames(game, telepathy.playerIds) : '該当なし',
      note: telepathy.points > 0 ? `予想で合計${telepathy.points}点` : 'だれも当たらず',
    },
    {
      key: 'mysterious',
      title: 'ミステリアス賞',
      winner: winnerNames(game, mysterious.playerIds),
      note: `みんなが取れたのは${mysterious.points}点`,
    },
    {
      key: 'pair',
      title: 'ベストペア',
      winner: bestPair.points > 0 ? pairText : '該当なし',
      note: bestPair.points > 0 ? `おたがいに${bestPair.points}点` : 'おたがい当たらず',
    },
    {
      key: 'zure',
      title: '今日のズレ大賞',
      winner: zure ? `「${zure.word}」` : '該当なし',
      note: zure ? `${playerById(game, zure.mainId).name}さん・平均${Math.round(zure.average)}ズレ` : '',
    },
  ];
  const list = el('ul', 'awards');
  list.append(...cards.map(({ key, title, winner, note }) => {
    const card = el('li', `award award--${key}`);
    card.append(el('p', 'award__title', title), el('p', 'award__winner', winner), el('p', 'award__note', note));
    return card;
  }));
  return list;
}

function finish(value) {
  closeSheet('share');
  forgetImage();
  const resolve = resolveCurrent;
  resolveCurrent = null;
  resolve?.(value);
}

function forgetImage() {
  if (image) URL.revokeObjectURL(image.url);
  image = null;
  sheetPart('image').removeAttribute('src');
}

// 公開しているページのアドレス（GitHub Pages で開いているときだけ、投稿の文に入れる）
function siteUrl() {
  return location.hostname.endsWith('github.io') ? `${location.origin}${location.pathname}` : '';
}

// Xの投稿画面を開くリンク（文と #アタマップ を入れておく）
function postUrl(summary) {
  const lines = ['アタマップで遊んだよ！'];
  if (summary) lines.push(`今日のズレ大賞は「${summary.word}」（${summary.mainName}さんのお題「${summary.topicTitle}」）`);
  lines.push('あなたならどこに置く？');
  const params = new URLSearchParams({ text: lines.join('\n'), hashtags: 'アタマップ' });
  const url = siteUrl();
  if (url) params.set('url', url);
  return `https://twitter.com/intent/tweet?${params}`;
}

// 画像をファイルのまま、ほかのアプリ（Xなど）に渡せるか
function canShareFile(file) {
  try {
    return Boolean(navigator.canShare?.({ files: [file] }));
  } catch {
    return false;
  }
}

async function openShare() {
  if (!ended) return;
  openSheet('share');
  if (!image) {
    sheetPart('note').textContent = '画像を作っています…';
    try {
      const { blob, summary } = await drawResultImage(ended.game, ended.topics);
      const file = new File([blob], 'atamap.png', { type: 'image/png' });
      image = { blob, file, summary, url: URL.createObjectURL(blob) };
    } catch (error) {
      console.error(error);
      sheetPart('note').textContent = '画像を作れませんでした';
      return;
    }
  }
  sheetPart('image').src = image.url;
  sheetPart('x').href = postUrl(image.summary);
  const share = canShareFile(image.file);
  sheetPart('save').textContent = share ? '画像を共有（Xなど）' : '画像を保存';
  sheetPart('note').textContent = share
    ? '共有から、Xなどに画像をそのまま送れます'
    : '保存した画像を、Xの投稿につけてね';
}

async function saveImage() {
  if (!image) return;
  if (canShareFile(image.file)) {
    try {
      await navigator.share({ files: [image.file], text: '#アタマップ' });
      return;
    } catch (error) {
      if (error?.name === 'AbortError') return; // 共有をやめたとき
    }
  }
  // 共有できないときは、ファイルとして保存する
  const link = el('a');
  link.href = image.url;
  link.download = 'atamap.png';
  document.body.append(link);
  link.click();
  link.remove();
  showToast('画像を保存しました');
}

export const endActions = {
  'end-again': () => finish('again'),
  'end-home': () => finish('home'),
  'end-share': () => openShare(),
  'share-image': () => saveImage(),
  'close-share': () => closeSheet('share'),
};
