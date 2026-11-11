// 1台のスマホを順番に回して遊ぶゲームの流れ。
// 名前を入れる → 主役を順番に回す（主役がマップを作ってロック → ほかの人が順に予想 → 1ワードずつ答え合わせ）→ 最終結果
import { showToast } from './ui.js';
import { loadTopics } from './topics.js';
import { createGame, setMap, setGuess, guessersFor, dealTopic } from './game.js';
import { askPlayers } from './screen-players.js';
import { showPass } from './screen-pass.js';
import { runPlace, stopPlace } from './screen-place.js';
import { showReveal, stopReveal } from './screen-reveal.js';
import { showEnd } from './screen-end.js';
import { connect } from './net.js';
import { recordMaps } from './stats.js';
import { editTopic, closeEditor } from './screen-maketopic.js';
import { assignMadeTopics, chosenMyTopics, shuffle } from './custom.js';

// ロックしたあと、次の画面へ移るまで少し待つ（「ロックしました！」が見えるように）
const AFTER_LOCK_MS = 700;
// 時間切れのときは、何が起きたか読めるように長めに待つ
const AFTER_TIMEUP_MS = 2200;

class GameQuit extends Error {}

let running = null;

/** ゲームのとちゅうか */
export function isPlaying() {
  return Boolean(running);
}

/** ゲームを終わる（とちゅうで「終わる」を押したときなど） */
export function quitGame() {
  running?.quit(new GameQuit());
}

/**
 * 1台で遊ぶゲームを始める。
 * @param {object} options
 * @param {(next: 'home') => void} options.onExit ゲームを出るときに呼ばれる
 */
export async function startSoloGame({ onExit }) {
  if (running) return;
  let quit;
  const quitted = new Promise((_, reject) => {
    quit = reject;
  });
  quitted.catch(() => {});
  running = { quit };
  // 画面の操作を待つ。とちゅうで終わったら、そこで止まる
  const step = (promise) => Promise.race([promise, quitted]);

  try {
    const topics = await step(loadTopics());
    const settings = await step(askPlayers());
    for (;;) {
      const next = await step(playOneGame(settings, topics, step));
      if (next !== 'again') break;
    }
  } catch (error) {
    if (!(error instanceof GameQuit)) {
      console.error(error);
      showToast('うまく動きませんでした。もう一度ためしてね');
    }
  } finally {
    stopPlace();
    stopReveal();
    closeEditor();
    running = null;
  }
  onExit('home');
}

async function playOneGame({ names, timeLimit, topicMode = 'standard' }, topics, step) {
  const game = createGame(names, { timeLimit });
  const count = game.players.length;
  // オリジナルのお題：主役ごとに、先に決めておく（決まっていない主役には、いつものお題を配る）
  const planned = await step(planCustomTopics(game, topicMode, step));
  const allTopics = [...topics, ...Object.values(planned).filter(Boolean)];

  // 主役を順番に回す：主役がマップを作ってロック → ほかの人が順に予想 → 答え合わせ
  for (const [index, main] of game.players.entries()) {
    // 主役のお題を先に決めて、スマホを渡す画面で大きく発表する
    const custom = planned[main.id];
    const dealt = custom ?? dealTopic(game, topics);
    await step(showPass({
      player: main,
      step: `ラウンド ${index + 1}/${count}・主役`,
      text: 'あなたが主役！自分のマップを作る番です',
      note: 'ほかの人は画面を見ないでね',
      topic: dealt,
      topicLabel: topicLabel(dealt),
    }));
    const made = await step(runPlace({
      mode: 'make',
      player: main,
      timeLimit: game.timeLimit,
      topic: dealt,
      // オリジナルのお題は引き直さない（作った人の気持ちがこもっているので）
      reroll: custom ? null : (now) => dealTopic(game, topics, [now.id]),
    }));
    setMap(game, main.id, made);
    await step(wait(made.timeUp ? AFTER_TIMEUP_MS : AFTER_LOCK_MS));
    const topic = allTopics.find((t) => t.id === made.topicId);

    const guessers = guessersFor(game, main.id);
    for (const [g, guesser] of guessers.entries()) {
      await step(showPass({
        player: guesser,
        step: `ラウンド ${index + 1}/${count}・予想 ${g + 1}/${guessers.length}`,
        text: `${main.name}さんのマップを予想する番です`,
        note: 'ほかの人の予想は見ないでね',
        topic,
        topicLabel: `${main.name}さんのお題`,
      }));
      const result = await step(runPlace({ mode: 'guess', player: guesser, main, topic, timeLimit: game.timeLimit }));
      setGuess(game, main.id, guesser.id, result.placements);
      await step(wait(result.timeUp ? AFTER_TIMEUP_MS : AFTER_LOCK_MS));
    }

    await step(showReveal({ game, main, topic, isLast: index === count - 1 }));
  }

  recordSoloMaps(game, topics);
  return step(showEnd({ game, topics: allTopics }));
}

/**
 * オリジナルのお題を、主役ごとに決める。
 * ・みんなで作る：スマホを順に回して1人1つ作り、自分のお題が自分に当たらないように配る
 * ・マイお題：えらんであるマイお題を、まぜて順に配る
 * @returns {Promise<Record<string, object|null>>} 主役の id → お題（いつものお題を配るときは null）
 */
async function planCustomTopics(game, topicMode, step) {
  const planned = {};
  if (topicMode === 'make') {
    const made = {};
    for (const [i, player] of game.players.entries()) {
      await step(showPass({
        player,
        step: `お題づくり ${i + 1}/${game.players.length}`,
        text: 'お題を1つ作ってね',
        note: 'ほかの人のお題になります。作っているところは見ないでね',
      }));
      const topic = await step(editTopic({ heading: `${player.name}さんのお題づくり`, canCancel: false }));
      if (topic) made[player.id] = { ...topic, author: player.name };
    }
    Object.assign(planned, assignMadeTopics(game.players.map((p) => p.id), made));
  } else if (topicMode === 'mine') {
    const mine = shuffle(chosenMyTopics());
    game.players.forEach((player, i) => {
      planned[player.id] = mine[i] ?? null;
    });
  }
  return planned;
}

// お題の札の文字（だれが作ったお題か）
function topicLabel(topic) {
  if (!topic.custom) return '今回のお題';
  return topic.author ? `${topic.author}さんが作ったお題` : 'マイお題から';
}

// ワードごとの置き場所を記録する（お題の見直しに使う）。つながらなくても、遊ぶのには困らないので何もしない
function recordSoloMaps(game, topics) {
  connect()
    .then((net) => recordMaps(net, Object.values(game.maps), topics))
    .catch(() => {});
}

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
