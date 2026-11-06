// 1台のスマホを順番に回して遊ぶゲームの流れ。
// 名前を入れる → 1人ずつ自分のマップを作る → 主役を順番に回して、ほかの人が予想 → 1ワードずつ答え合わせ → 最終結果
import { showToast } from './ui.js';
import { loadTopics } from './topics.js';
import { createGame, setMap, setGuess, guessersFor, dealTopic } from './game.js';
import { askPlayers } from './screen-players.js';
import { showPass } from './screen-pass.js';
import { runPlace, stopPlace } from './screen-place.js';
import { showRound } from './screen-round.js';
import { showReveal, stopReveal } from './screen-reveal.js';
import { showEnd } from './screen-end.js';

// ロックしたあと、次の画面へ移るまで少し待つ（「ロックしました！」が見えるように）
const AFTER_LOCK_MS = 700;

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
    let names = await step(askPlayers());
    for (;;) {
      const next = await step(playOneGame(names, topics, step));
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
    running = null;
  }
  onExit('home');
}

async function playOneGame(names, topics, step) {
  const game = createGame(names);
  const count = game.players.length;

  // 1人ずつ、自分のマップを作る
  for (const [index, player] of game.players.entries()) {
    await step(showPass({
      player,
      step: `マップ作り ${index + 1}/${count}`,
      text: '自分のマップを作る番です',
      note: 'ほかの人は画面を見ないでね',
    }));
    const result = await step(runPlace({
      mode: 'make',
      player,
      topic: dealTopic(game, topics),
      reroll: (now) => dealTopic(game, topics, [now.id]),
    }));
    setMap(game, player.id, result);
    await step(wait(AFTER_LOCK_MS));
  }

  // 主役を順番に回す
  for (const [index, main] of game.players.entries()) {
    const topic = topics.find((t) => t.id === game.maps[main.id].topicId);
    await step(showRound({ main, topic, round: index + 1, rounds: count }));

    const guessers = guessersFor(game, main.id);
    for (const [g, guesser] of guessers.entries()) {
      await step(showPass({
        player: guesser,
        step: `ラウンド ${index + 1}・予想 ${g + 1}/${guessers.length}`,
        text: `${main.name}さんのマップを予想する番です`,
        note: 'ほかの人の予想は見ないでね',
      }));
      const result = await step(runPlace({ mode: 'guess', player: guesser, main, topic }));
      setGuess(game, main.id, guesser.id, result.placements);
      await step(wait(AFTER_LOCK_MS));
    }

    await step(showReveal({ game, main, topic, isLast: index === count - 1 }));
  }

  return step(showEnd({ game }));
}

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
