// お題の見直し（作る人向け）。記録した置き場所から、全員がほぼ同じ場所に置いたワードを出す。
// 1枚の画面に収まるよう、ページをめくって見る。
import { showScreen, el } from './ui.js';
import { loadTopics } from './topics.js';
import { connect } from './net.js';
import { findSameSpots, MIN_MAPS, SAME_RADIUS } from './stats.js';

const screen = document.querySelector('[data-screen="stats"]');
const part = (name) => screen.querySelector(`[data-stats="${name}"]`);
let perPage = 5;
let found = [];
let page = 0;
let loading = 0;

/** 画面を出して、記録を読み込む */
export async function showStats() {
  const ticket = ++loading;
  found = [];
  page = 0;
  part('summary').textContent = '読み込んでいます…';
  part('note').textContent = '';
  part('list').replaceChildren();
  renderPager();
  showScreen('stats');
  try {
    const [topics, net] = await Promise.all([loadTopics(), connect()]);
    const stats = await net.get('stats');
    if (ticket !== loading) return;
    // 文字（Google Fonts）の読み込みが終わってから、1ページの行数を決める（行の高さが変わるため）
    await document.fonts?.ready;
    if (ticket !== loading) return;
    const result = findSameSpots(stats, topics);
    found = result.found;
    part('summary').textContent = `記録したマップ ${result.maps}枚（お題 ${result.topics}個、調べたお題 ${result.checked}個）`;
    part('note').textContent = `${MIN_MAPS}枚以上たまったお題で、全員がほぼ同じ場所（中心から${SAME_RADIUS}以内）に置いたワードを出します。入れ替えの候補です。`;
    render();
  } catch (error) {
    console.error(error);
    if (ticket !== loading) return;
    part('summary').textContent = '記録を読み込めませんでした。通信を確かめてね';
  }
}

function rowOf(f) {
  const row = el('li', 'stats-row');
  row.append(
    el('span', 'stats-row__topic', `${f.topic.title}（${f.topic.genre}）`),
    el('b', 'stats-row__word', `「${f.word}」`),
    el('span', 'stats-row__meta', `${f.count}枚・ズレ最大${Math.round(f.spread)}・${placeName(f.center, f.topic)}`),
  );
  return row;
}

// 画面の高さに合わせて、1ページに出す数を決める（スクロールさせないため）
function fitPerPage() {
  const list = part('list');
  if (!found.length) return;
  list.replaceChildren(rowOf(found[0]));
  const rowHeight = list.firstElementChild.getBoundingClientRect().height;
  const gap = parseFloat(getComputedStyle(list).rowGap) || 0;
  const next = Math.max(1, Math.floor((list.clientHeight + gap) / (rowHeight + gap)));
  if (next !== perPage) {
    const first = page * perPage;
    perPage = next;
    page = Math.floor(first / perPage);
  }
}

function render() {
  const list = part('list');
  if (!found.length) {
    list.replaceChildren(el('li', 'stats__empty', 'まだ見つかっていません'));
  } else {
    fitPerPage();
    list.replaceChildren(...found.slice(page * perPage, (page + 1) * perPage).map(rowOf));
  }
  renderPager();
}

window.addEventListener('resize', () => {
  if (!screen.hidden && found.length) render();
});
// あとから文字が読み込まれたときも、行数を決め直す
document.fonts?.addEventListener?.('loadingdone', () => {
  if (!screen.hidden && found.length) render();
});

// まとまりの場所を、軸の言葉で言う（例：「好き・最近食べた」寄り）
function placeName(center, topic) {
  const v = center.y < 40 ? topic.axes.top : center.y > 60 ? topic.axes.bottom : '';
  const h = center.x < 40 ? topic.axes.left : center.x > 60 ? topic.axes.right : '';
  const parts = [v, h].filter(Boolean);
  return parts.length ? `${parts.join('・')}寄り` : '真ん中あたり';
}

function pages() {
  return Math.max(1, Math.ceil(found.length / perPage));
}

function renderPager() {
  const prev = screen.querySelector('[data-action="stats-prev"]');
  const next = screen.querySelector('[data-action="stats-next"]');
  prev.disabled = page <= 0;
  next.disabled = page >= pages() - 1;
  next.textContent = pages() > 1 ? `次へ（${page + 1}/${pages()}）` : '次へ';
}

export const statsActions = {
  'stats-prev': () => {
    if (page <= 0) return;
    page -= 1;
    render();
  },
  'stats-next': () => {
    if (page >= pages() - 1) return;
    page += 1;
    render();
  },
};
