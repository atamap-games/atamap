// 配信の設定（配信者だけが開く別窓）。
//   ・BGM と効果音の大きさ（音は配信用の画面から出るので、同じパソコンの別の窓にも伝わる）
//   ・配信用の画面に、部屋の番号とQRコードを映すか（映さないときは、参加のリンクをコメント欄などで知らせる）
//   ・見ている人を外す（外した人は、この部屋にもう入れない）
// 名前がたくさんでも別窓がスクロールしないように、見ている人は何ページかに分けて出す。
import { el, openSheet, closeSheet, showToast } from './ui.js';
import { getVolume, setVolume } from './sound.js';
import { VIEWER_COLOR } from './stream.js';

const settings = document.getElementById('stream-settings');
const viewersBox = document.getElementById('stream-viewers');
const ss = (name) => settings.querySelector(`[data-ss="${name}"]`);
const sv = (name) => viewersBox.querySelector(`[data-sv="${name}"]`);

let model = { hideCode: false, url: '', viewers: [] };
let handlers = {};
let page = 0;
let picked = null;

for (const kind of ['bgm', 'sfx']) {
  ss(kind).addEventListener('input', (event) => {
    setVolume(kind, Number(event.target.value) / 100);
    showVolume();
  });
}

/**
 * 配信の設定を開く。
 * @param {object} o
 * @param {boolean} o.hideCode 部屋の番号とQRコードを映さないか
 * @param {string} o.url 参加のリンク
 * @param {{ uid: string, name: string }[]} o.viewers 今つながっている、見ている人
 * @param {object} o.handlers { hideCode(on), kick(uid) }
 */
export function openStreamSettings(o) {
  handlers = o.handlers ?? {};
  updateStreamSettings(o);
  showVolume();
  openSheet('stream-settings');
}

/** 開いている別窓の中身を、今の部屋に合わせる（部屋のデータが変わるたびに呼んでよい） */
export function updateStreamSettings(o) {
  model = { ...model, ...o };
  if (o.handlers) handlers = o.handlers;
  for (const [key, on] of [['code-show', false], ['code-hide', true]]) {
    ss(key).classList.toggle('is-on', model.hideCode === on);
    ss(key).setAttribute('aria-checked', String(model.hideCode === on));
  }
  ss('code-note').textContent = model.hideCode
    ? '参加のリンクを、コメント欄などで知らせてね'
    : '待合室では大きく、ゲーム中はすみに小さく出ます';
  ss('viewers').disabled = !model.viewers.length;
  if (viewersBox.open) renderViewers();
}

/** 別窓を閉じる（部屋を出るとき） */
export function closeStreamSettings() {
  closeSheet('stream-settings');
  closeSheet('stream-viewers');
}

function showVolume() {
  const v = getVolume();
  for (const kind of ['bgm', 'sfx']) {
    const percent = Math.round(v[kind] * 100);
    ss(kind).value = String(percent);
    ss(`${kind}-value`).textContent = percent ? `${percent}%` : '消す';
  }
}

async function copyLink() {
  try {
    await navigator.clipboard.writeText(model.url);
    showToast('参加のリンクをコピーしました');
  } catch {
    showToast(`コピーできませんでした：${model.url}`, 6000);
  }
}

// ---------- 見ている人を外す ----------

// 1ページに出す名前の数（縦が短い画面では少なく）
function perPage() {
  const columns = window.innerWidth >= 900 ? 3 : 2;
  const rows = Math.max(2, Math.min(6, Math.floor((window.innerHeight - 290) / 46)));
  return columns * rows;
}

function renderViewers() {
  const list = model.viewers;
  const size = perPage();
  const pages = Math.max(1, Math.ceil(list.length / size));
  page = Math.min(page, pages - 1);
  if (picked && !list.some((v) => v.uid === picked.uid)) picked = null;
  sv('title').textContent = `見ている人（${list.length}人）`;
  const shown = list.slice(page * size, page * size + size);
  const items = shown.map((v) => {
    const item = el('li');
    const button = el('button', `kick-list__item${picked?.uid === v.uid ? ' is-picked' : ''}`);
    button.type = 'button';
    button.dataset.action = 'sv-pick';
    button.dataset.uid = v.uid;
    button.style.setProperty('--player-color', VIEWER_COLOR);
    button.append(el('span', 'member__dot'), el('span', 'kick-list__name', v.name));
    item.append(button);
    return item;
  });
  if (!items.length) items.push(el('li', 'kick-list__empty', 'まだだれもいません'));
  sv('list').replaceChildren(...items);
  // 1ページで収まるときは、いる人の分だけの高さにする（ページがあるときは、ページをめくっても高さを変えない）
  const columns = window.innerWidth >= 900 ? 3 : 2;
  const rows = pages > 1 ? size / columns : Math.max(1, Math.ceil(list.length / columns));
  sv('list').style.setProperty('--rows', String(rows));
  sv('page').textContent = `${page + 1}/${pages}`;
  sv('pager').hidden = Boolean(picked) || pages <= 1;
  sv('confirm').hidden = !picked;
  if (picked) sv('confirm-text').textContent = `${picked.name}さんを外しますか？`;
}

function openViewers() {
  page = 0;
  picked = null;
  closeSheet('stream-settings');
  renderViewers();
  openSheet('stream-viewers');
}

export const streamSettingsActions = {
  'ss-close': () => closeSheet('stream-settings'),
  'ss-code-show': () => handlers.hideCode?.(false),
  'ss-code-hide': () => handlers.hideCode?.(true),
  'ss-copy': () => copyLink(),
  'ss-viewers': () => openViewers(),
  'sv-close': () => {
    closeSheet('stream-viewers');
    openSheet('stream-settings');
  },
  'sv-prev': () => {
    page = Math.max(0, page - 1);
    renderViewers();
  },
  'sv-next': () => {
    page += 1;
    renderViewers();
  },
  'sv-pick': (button) => {
    picked = model.viewers.find((v) => v.uid === button.dataset.uid) ?? null;
    renderViewers();
  },
  'sv-cancel': () => {
    picked = null;
    renderViewers();
  },
  'sv-kick': () => {
    if (!picked) return;
    const { uid, name } = picked;
    picked = null;
    handlers.kick?.(uid, name);
    model = { ...model, viewers: model.viewers.filter((v) => v.uid !== uid) };
    renderViewers();
  },
};
