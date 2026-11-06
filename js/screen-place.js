// ワードを置く画面。「自分のマップを作る」と「主役のマップを予想する」の両方で使う。
import { createBoard } from './board.js';
import { showScreen, showToast, el } from './ui.js';
import { createTimer } from './timer.js';

const screen = document.querySelector('[data-screen="place"]');
const part = (name) => screen.querySelector(`[data-place="${name}"]`);
const lockButton = () => part('actions').querySelector('[data-action="lock"]');
const rerollButton = () => part('actions').querySelector('[data-action="reroll"]');

// 引き直しを押してから、もう一度押すまで待つ時間（置いたワードが消えるときだけ確かめる）
const CONFIRM_MS = 2500;
// 残りがこの秒数になったら、残り時間の表示を目立たせる
const HURRY_SECONDS = 10;
// 時間切れのとき、主役のマップでまだ置いていないワードを置く場所（真ん中）
const CENTER = { x: 50, y: 50 };

let board = null;
let current = null; // 今の画面の設定と状態
let confirmTimer = 0;
let timer = null;

/**
 * ワードを置いてもらう。
 * @param {object} options
 * @param {'make'|'guess'} options.mode 自分のマップを作る／主役のマップを予想する
 * @param {{ name: string, color: string }} options.player 置く人
 * @param {{ name: string }} [options.main] 主役（予想のとき）
 * @param {object} options.topic お題
 * @param {() => object} [options.reroll] 引き直したときの新しいお題を返す関数（自分のマップのときだけ）
 * @param {number} [options.timeLimit] 制限時間（秒）。0 なら制限なし
 * @param {number} [options.timeTotal] 円のまわりの長さの元になる、制限時間の全体（秒）。部屋で遊ぶとき、途中から入っても円の減り方がそろうように
 * @param {boolean} [options.pausable] 別窓が開いているあいだ時間を止めるか（部屋で遊ぶときは、みんなで時間をそろえるので止めない）
 * @returns {Promise<{ topicId: number, placements: object[], rerolled: boolean, timeUp: boolean }>}
 */
export function runPlace({ mode, player, main = null, topic, reroll = null, timeLimit = 0, timeTotal = timeLimit, pausable = true }) {
  stopPlace();
  current = { mode, player, main, topic, reroll, rerolled: false, placed: 0, resolve: null };

  part('who').replaceChildren(
    el('span', 'who__dot'),
    mode === 'make' ? `${player.name}さんのマップ` : `${player.name}さんの予想（主役：${main.name}さん）`,
  );
  screen.style.setProperty('--player-color', player.color);
  part('actions').classList.toggle('actions--split', Boolean(reroll));
  rerollButton().hidden = !reroll;
  setTopic(topic);
  renderReroll();
  showScreen('place');
  startTimer(timeLimit, timeTotal, pausable);

  return new Promise((resolve) => {
    current.resolve = resolve;
  });
}

/** 画面を離れるときの後片づけ */
export function stopPlace() {
  timer?.stop();
  timer = null;
  board?.destroy();
  board = null;
  resetConfirm();
}

// 右上に残り時間を出す（制限時間がないときは「?」を出す）
function startTimer(seconds, total, pausable) {
  timer?.stop();
  timer = null;
  const box = part('timer');
  box.hidden = !seconds;
  part('help').hidden = Boolean(seconds);
  if (!seconds) return;
  timer = createTimer({
    seconds,
    pausable,
    onTick: (left) => {
      part('seconds').textContent = left;
      box.style.setProperty('--left', String(Math.min(1, left / (total || seconds))));
      box.classList.toggle('is-hurry', left <= HURRY_SECONDS);
      box.setAttribute('aria-label', `残り${left}秒`);
    },
    onEnd: timeUp,
  });
}

// 時間切れ：自分のマップは、置いていないワードを真ん中に置いて決める。予想は、置いていないワードが0点になる
function timeUp() {
  if (!current?.resolve || !board) return;
  resetConfirm();
  const guessing = current.mode === 'guess';
  const left = board.getPlacements().filter((p) => !p.pos).length;
  if (!guessing && left) board.placeRemaining(CENTER);
  board.lock({ message: '時間切れ！' });
  if (left) showToast(guessing ? `時間切れ！置いていない${left}つは0点です` : `時間切れ！置いていない${left}つは真ん中に置きました`);
  else showToast('時間切れ！このまま決めます');
  finish(true);
}

function finish(timeUpFlag) {
  timer?.stop();
  timer = null;
  // 決まったあとは、次の画面へ移るまでボタンを押せないようにする
  lockButton().disabled = true;
  lockButton().textContent = timeUpFlag ? '時間切れ' : current.mode === 'guess' ? '決定しました' : 'ロックしました';
  rerollButton().disabled = true;
  const { resolve, topic, rerolled } = current;
  current.resolve = null;
  resolve({ topicId: topic.id, placements: board.getPlacements(), rerolled, timeUp: timeUpFlag });
}

function setTopic(topic) {
  board?.destroy();
  current.topic = topic;
  part('genre').textContent = topic.genre;
  part('title').textContent = topic.title;
  board = createBoard(part('board'), topic, { onChange: render });
}

// 置いた数などに合わせて、案内の文とボタンを変える（案内は1行に収まる長さにする）
function render({ placed, total, selected, locked }) {
  if (!current) return;
  const guide = part('guide');
  const left = total - placed;
  const guessing = current.mode === 'guess';
  current.placed = placed;

  if (locked) {
    guide.textContent = guessing ? 'この予想で決まり！' : 'このマップで決まり！';
  } else if (selected) {
    guide.textContent = 'マップの置きたいところをタップ';
  } else if (placed === 0) {
    if (guessing) guide.textContent = '主役ならココらへん？と置いてね';
    else guide.textContent = current.reroll && !current.rerolled ? 'お題が苦手なら1回だけ引き直せます' : 'ワードを指でマップへ動かそう';
  } else if (left > 0) {
    guide.textContent = guessing ? `あと${left}つ。主役の気持ちで置いてね` : `あと${left}つ。自分の感覚で置いてね`;
  } else {
    guide.textContent = '外へ出すと、下に戻せます';
  }

  lockButton().disabled = left > 0;
  lockButton().textContent = left > 0 ? `あと${left}つ置いてね` : guessing ? '決定する' : 'ロックする';
}

// 引き直しボタンの見た目（使ったら押せなくする）
function renderReroll(confirming = false) {
  const button = rerollButton();
  const used = current?.rerolled;
  button.disabled = used;
  button.classList.toggle('is-confirm', confirming);
  const small = el('small', '', confirming ? 'もう一度押す' : used ? '使用済み' : 'あと1回');
  button.replaceChildren(confirming ? '本当に？' : '引き直す', small);
  if (confirming) part('guide').textContent = '引き直すと、置いたワードは消えます';
}

function resetConfirm() {
  window.clearTimeout(confirmTimer);
  confirmTimer = 0;
}

export const placeActions = {
  reroll: () => {
    if (!current?.reroll || current.rerolled || !current.resolve || !board) return;
    // ワードを置いたあとなら、置いたものが消えるので、もう一度押してもらう
    if (current.placed > 0 && !confirmTimer) {
      renderReroll(true);
      confirmTimer = window.setTimeout(() => {
        resetConfirm();
        renderReroll();
        board?.refresh();
      }, CONFIRM_MS);
      return;
    }
    resetConfirm();
    current.rerolled = true;
    setTopic(current.reroll(current.topic));
    renderReroll();
    showToast(`お題を引き直しました：「${current.topic.title}」`);
  },
  lock: () => {
    if (!board?.isComplete() || !current?.resolve) return;
    resetConfirm();
    board.lock({ message: current.mode === 'guess' ? '予想を決めました！' : 'ロックしました！' });
    finish(false);
  },
};
