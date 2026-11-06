// お題を作る別窓（画面いっぱい）。2つの段階で作る。
//   1/2：お題の名前と、縦・横の軸（用意した軸からえらぶか、自由に書く）
//   2/2：5つのワード
// 「みんなで作る」のゲームのはじめ、「マイお題」を作るとき、の両方で使う。
import { el, openSheet, closeSheet } from './ui.js';
import { createMap } from './mapview.js';
import { createTimer } from './timer.js';
import { buildTopic, AXIS_PRESETS, WORD_COUNT, WORD_MAX } from './custom.js';
import { sfx } from './sound.js';

const sheet = document.getElementById('maketopic');
const part = (name) => sheet.querySelector(`[data-mt="${name}"]`);
const field = (id) => document.getElementById(id);

let current = null; // { resolve, step, options }
let timer = null;

/**
 * お題を作ってもらう。
 * @param {object} [options]
 * @param {string} [options.heading] 上に出す名前（例：「お題を作る」「あおいさんのお題づくり」）
 * @param {object} [options.initial] 直すときの元のお題
 * @param {number} [options.timeLimit] 制限時間（秒）。0 ならなし。時間が来たら、そこまでで作れていれば決める
 * @param {number} [options.timeTotal] 円の長さの元になる制限時間の全体（秒）
 * @param {boolean} [options.canCancel] 「やめる」ができるか（ゲームのとちゅうでは「←」で部屋を出る／ゲームを終わる）
 * @param {string} [options.doneLabel] 最後のボタンの文字
 * @returns {Promise<object|null>} 作ったお題（やめたとき、時間切れで作れていなかったときは null）
 */
export function editTopic({ heading = 'お題を作る', initial = null, timeLimit = 0, timeTotal = timeLimit, canCancel = true, doneLabel = 'できた！' } = {}) {
  closeEditor();
  part('heading').textContent = heading;
  field('mt-title').value = initial?.title ?? '';
  for (const side of ['top', 'bottom', 'left', 'right']) field(`mt-${side}`).value = initial?.axes?.[side] ?? '';
  const words = [];
  for (let i = 0; i < WORD_COUNT; i++) {
    const input = el('input', 'mt-word');
    input.type = 'text';
    input.id = `mt-word-${i + 1}`;
    input.maxLength = WORD_MAX;
    input.autocomplete = 'off';
    input.enterKeyHint = i === WORD_COUNT - 1 ? 'done' : 'next';
    input.placeholder = `ワード${i + 1}`;
    input.value = initial?.words?.[i] ?? '';
    input.setAttribute('aria-label', `${i + 1}つ目のワード（8文字まで）`);
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      const next = field(`mt-word-${i + 2}`);
      if (next) next.focus();
      else input.blur();
    });
    const label = el('label', 'name-field');
    label.append(el('span', 'name-field__num', String(i + 1)), input);
    words.push(label);
  }
  part('words').replaceChildren(...words);
  // ゲームのとちゅうでは、「←」は部屋を出る（ゲームを終わる）ボタンにする
  part('back').dataset.action = canCancel ? 'mt-back' : 'quit';
  current = { resolve: null, step: 1, canCancel, doneLabel, initialId: initial?.id ?? '' };
  part('count').hidden = Boolean(timeLimit);
  setStep(1);
  updatePreview();
  startTimer(timeLimit, timeTotal);
  if (!sheet.open) sheet.showModal();
  return new Promise((resolve) => {
    current.resolve = resolve;
  });
}

/** 別窓を閉じる（部屋のゲームが先に進んだときなど。作っていたお題は使わない） */
export function closeEditor() {
  timer?.stop();
  timer = null;
  closeSheet('axis-pick');
  if (sheet.open) sheet.close();
  const resolve = current?.resolve;
  current = null;
  resolve?.(null);
}

/** 作っているとちゅうか */
export function isEditing() {
  return Boolean(current);
}

function setStep(step) {
  current.step = step;
  part('step1').hidden = step !== 1;
  part('step2').hidden = step !== 2;
  part('count').textContent = `${step}/2`;
  part('error').textContent = '';
  // 残り時間を出すときは、右上がせまいので、何段階目かは案内の文の頭に出す
  const prefix = part('count').hidden ? `${step}/2　` : '';
  part('guide').textContent = prefix + (step === 1 ? 'お題の名前と、縦と横の軸を決めよう' : '主役が置く5つのワードを決めよう');
  part('prev').textContent = step === 1 ? (current.canCancel ? 'やめる' : 'ワードへ') : 'もどる';
  part('prev').hidden = step === 1 && !current.canCancel;
  part('next').textContent = step === 1 ? '次へ' : current.doneLabel;
  if (step === 2) {
    const v = read();
    part('summary').replaceChildren(
      el('b', '', v.title || '（お題の名前）'),
      el('span', '', `　縦：${v.axes.top}↔${v.axes.bottom}　横：${v.axes.left}↔${v.axes.right}`),
    );
  }
  sheet.querySelector('.foot .actions').classList.toggle('actions--one', step === 1 && !current.canCancel);
}

function read() {
  return {
    title: field('mt-title').value,
    axes: { top: field('mt-top').value, bottom: field('mt-bottom').value, left: field('mt-left').value, right: field('mt-right').value },
    words: [...sheet.querySelectorAll('.mt-word')].map((input) => input.value),
  };
}

// 1/2 のまちがいだけを確かめる（ワードはまだ入れていないので）
function stepOneError() {
  const v = read();
  const { error } = buildTopic({ ...v, words: ['a', 'b', 'c', 'd', 'e'] });
  return error;
}

// 入れた軸で、マップの見本を出す
function updatePreview() {
  const v = read();
  const axes = {
    top: v.axes.top.trim() || '上',
    bottom: v.axes.bottom.trim() || '下',
    left: v.axes.left.trim() || '左',
    right: v.axes.right.trim() || '右',
  };
  part('preview').replaceChildren(createMap({ axes }, 'map--static map--preview'));
}

function startTimer(seconds, total) {
  timer?.stop();
  timer = null;
  const box = part('timer');
  box.hidden = !seconds;
  if (!seconds) return;
  timer = createTimer({
    seconds,
    pausable: false,
    onTick: (left) => {
      part('seconds').textContent = left;
      box.style.setProperty('--left', String(Math.min(1, left / (total || seconds))));
      box.classList.toggle('is-hurry', left <= 10);
      if (left > 0 && left <= 5) sfx('tick');
    },
    // 時間切れ：そこまでで作れていれば、そのお題に決める。作れていなければ、いつものお題を使う
    onEnd: () => {
      if (!current) return;
      const { topic } = buildTopic(read(), current.initialId);
      sfx('timeUp');
      finish(topic);
    },
  });
}

function finish(topic) {
  const resolve = current?.resolve;
  current.resolve = null;
  closeEditor();
  resolve?.(topic);
}

// 用意した軸の別窓
function openPicker(kind) {
  const vertical = kind === 'vertical';
  const pick = document.getElementById('axis-pick');
  pick.querySelector('[data-axis-pick="title"]').textContent = vertical ? '縦の軸をえらぶ' : '横の軸をえらぶ';
  pick.querySelector('[data-axis-pick="text"]').textContent = vertical
    ? '縦は「気持ち」の軸がおすすめ'
    : '横は「その人の経験」の軸がおすすめ（安い↔高い のように、だれが置いても同じになる軸は避けよう）';
  const buttons = AXIS_PRESETS[kind].map(([a, b]) => {
    const button = el('button', 'axis-pick__item', `${a} ↔ ${b}`);
    button.type = 'button';
    button.addEventListener('click', () => {
      field(vertical ? 'mt-top' : 'mt-left').value = a;
      field(vertical ? 'mt-bottom' : 'mt-right').value = b;
      updatePreview();
      closeSheet('axis-pick');
      sfx('select');
    });
    return button;
  });
  pick.querySelector('[data-axis-pick="list"]').replaceChildren(...buttons);
  openSheet('axis-pick');
}

sheet.addEventListener('input', (event) => {
  if (event.target.closest('[data-mt="step1"]')) updatePreview();
  part('error').textContent = '';
});
// 「Esc」で閉じたとき（パソコン）：やめられるときだけ、やめる
sheet.addEventListener('cancel', (event) => {
  event.preventDefault();
  if (current?.canCancel) finish(null);
});

export const makeTopicActions = {
  'mt-pick': (button) => openPicker(button.dataset.axis),
  'axis-pick-close': () => closeSheet('axis-pick'),
  'mt-back': () => {
    if (!current) return;
    if (current.step === 2) setStep(1);
    else if (current.canCancel) finish(null);
  },
  'mt-prev': () => {
    if (!current) return;
    if (current.step === 2) setStep(1);
    else if (current.canCancel) finish(null);
  },
  'mt-next': () => {
    if (!current) return;
    if (current.step === 1) {
      const error = stepOneError();
      if (error) {
        part('error').textContent = error;
        return;
      }
      setStep(2);
      field('mt-word-1')?.focus({ preventScroll: true });
      return;
    }
    const { topic, error } = buildTopic(read(), current.initialId);
    if (!topic) {
      part('error').textContent = error;
      return;
    }
    sfx('lock');
    finish(topic);
  },
};
