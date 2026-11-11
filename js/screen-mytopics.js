// マイお題（このスマホに保存したオリジナルのお題）の一覧と、お題のえらび方の別窓。
// ・一覧は画面いっぱいの別窓。✓を付けたお題を、次のゲームで使う
// ・「お題のえらび方」：いつものお題／みんなで作る／マイお題
import { el, openSheet, closeSheet, showToast } from './ui.js';
import { editTopic } from './screen-maketopic.js';
import { loadMyTopics, saveMyTopics, MY_TOPICS_MAX } from './custom.js';
import { sfx } from './sound.js';

const sheet = document.getElementById('mytopics');
const part = (name) => sheet.querySelector(`[data-my="${name}"]`);

// お題のえらび方の名前（画面に出す文字）
export const TOPIC_MODES = {
  standard: 'いつものお題',
  make: 'みんなで作る',
  mine: 'マイお題',
};

let list = [];
let page = 0;
let perPage = 4;
let resolveCurrent = null;
let deleteArmed = '';
let deleteTimer = 0;

/**
 * マイお題の一覧を開く。
 * @returns {Promise<void>} 閉じたら終わる
 */
export function openMyTopics() {
  list = loadMyTopics();
  page = 0;
  if (!sheet.open) sheet.showModal();
  render();
  return new Promise((resolve) => {
    resolveCurrent = resolve;
  });
}

/** 一覧を閉じる */
export function closeMyTopics() {
  if (sheet.open) sheet.close();
  const resolve = resolveCurrent;
  resolveCurrent = null;
  resolve?.();
}

// 1ページに出せる数を、あいている高さから決める（スクロールさせない）
function measure() {
  const box = part('list');
  const height = box.clientHeight;
  return Math.max(1, Math.floor((height + 8) / 62));
}

function render() {
  part('count').textContent = `${list.length}/${MY_TOPICS_MAX}`;
  const used = list.filter((item) => item.use).length;
  part('guide').textContent = list.length ? `✓を付けたお題を使います（今 ${used}個）` : 'まだありません。「＋ 新しく作る」から作ろう';
  part('new').disabled = list.length >= MY_TOPICS_MAX;
  // まず空にして高さを測ってから、入るだけ並べる
  part('list').replaceChildren();
  perPage = measure();
  const pages = Math.max(1, Math.ceil(list.length / perPage));
  page = Math.min(page, pages - 1);
  const rows = list.slice(page * perPage, page * perPage + perPage).map((item, i) => row(item, page * perPage + i));
  part('list').replaceChildren(...rows);
  part('pager').hidden = pages <= 1;
  part('page').textContent = `${page + 1}/${pages}`;
  sheet.querySelector('[data-action="my-prev"]').disabled = page === 0;
  sheet.querySelector('[data-action="my-next"]').disabled = page >= pages - 1;
}

function row(item, index) {
  const li = el('li', `my-row${item.use ? ' is-on' : ''}`);
  const check = el('button', 'my-row__check', item.use ? '✓' : '');
  check.type = 'button';
  check.setAttribute('aria-label', item.use ? '使う（押すと使わない）' : '使わない（押すと使う）');
  check.addEventListener('click', () => {
    item.use = !item.use;
    saveMyTopics(list);
    sfx('select');
    render();
  });
  const text = el('div', 'my-row__text');
  text.append(
    el('p', 'my-row__title', item.topic.title),
    el('p', 'my-row__axes', `${item.topic.axes.top}↔${item.topic.axes.bottom}・${item.topic.axes.left}↔${item.topic.axes.right}`),
  );
  const edit = el('button', 'btn btn--secondary btn--small', '直す');
  edit.type = 'button';
  edit.addEventListener('click', async () => {
    const topic = await editTopic({ heading: 'マイお題を直す', initial: item.topic, doneLabel: '保存する' });
    if (!topic) return;
    list[index] = { ...item, topic };
    saveMyTopics(list);
    render();
  });
  const del = el('button', 'my-row__delete', '×');
  del.type = 'button';
  del.setAttribute('aria-label', 'このお題を消す');
  del.addEventListener('click', () => {
    // 2回押すと消す（まちがえて消さないように）
    if (deleteArmed !== item.topic.id) {
      deleteArmed = item.topic.id;
      window.clearTimeout(deleteTimer);
      deleteTimer = window.setTimeout(() => (deleteArmed = ''), 2500);
      showToast('もう一度「×」を押すと消します');
      return;
    }
    deleteArmed = '';
    list.splice(index, 1);
    saveMyTopics(list);
    render();
  });
  li.append(check, text, edit, del);
  return li;
}

async function addNew() {
  if (list.length >= MY_TOPICS_MAX) return;
  const topic = await editTopic({ heading: 'マイお題を作る', doneLabel: '保存する' });
  if (!topic) return;
  list.unshift({ topic, use: true });
  if (!saveMyTopics(list)) showToast('保存できませんでした');
  page = 0;
  render();
}

sheet.addEventListener('cancel', (event) => {
  event.preventDefault();
  closeMyTopics();
});

// ---------- お題のえらび方 ----------

let modeHandler = null;

/**
 * お題のえらび方の別窓を開く。
 * @param {object} options
 * @param {string} options.mode 今のえらび方
 * @param {string} [options.mineLabel] 「マイお題」の名前（部屋では「ホストのマイお題」）
 * @param {string[]} [options.modes] 出すえらび方（配信で遊ぶときは、いつものお題とマイお題だけ）
 * @param {(mode: string) => void} options.onPick えらんだとき
 */
export function openTopicMode({ mode, mineLabel = TOPIC_MODES.mine, modes = Object.keys(TOPIC_MODES), onPick }) {
  modeHandler = onPick;
  const box = document.getElementById('topic-mode');
  // 配信で遊ぶときは「みんなで作る」を出さない
  box.querySelectorAll('[data-action="topic-mode"]').forEach((button) => {
    button.hidden = !modes.includes(button.dataset.mode);
  });
  box.querySelector('[data-mode-mine-title]').textContent = mineLabel;
  box.querySelectorAll('[data-action="topic-mode"]').forEach((button) => {
    button.classList.toggle('is-on', button.dataset.mode === mode);
    button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
  });
  openSheet('topic-mode');
}

export const myTopicsActions = {
  'my-close': () => closeMyTopics(),
  'my-new': () => addNew(),
  'my-prev': () => {
    page = Math.max(0, page - 1);
    render();
  },
  'my-next': () => {
    page += 1;
    render();
  },
  'my-open': () => openMyTopics(),
  'topic-mode': (button) => {
    closeSheet('topic-mode');
    modeHandler?.(button.dataset.mode);
  },
  'topic-mode-close': () => closeSheet('topic-mode'),
};
