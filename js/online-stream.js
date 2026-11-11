// 配信で遊ぶ（見ている人が参加する）ときの流れ。部屋を作る・入るところまでは online.js が受け持つ。
//   配信者（ホスト）：待合室 →（お題ごとに：ワードを置いてロック → みんなの予想を待つ → 1ワードずつ答え合わせ → このお題の結果）… → ランキング
//   見ている人：自分のスマホで予想する。答え合わせは配信で見る。スマホには、自分の点数と順位だけを出す
//   配信用の画面：配信ソフトに映す画面。別の窓で開く（?cast=部屋の番号）。配信者の置き場所は映さない
// 人数が多くても動くように、見ている人のスマホは、部屋のデータのうち meta・state・自分の分だけを見る。
import { showToast } from './ui.js';
import { useEmulator } from './net.js';
import { encodePlacements } from './room.js';
import { showLobby, showWait, stopWait } from './screen-room.js';
import { runPlace, stopPlace } from './screen-place.js';
import { showMaking, stopMaking } from './screen-round.js';
import { showCast, stopCast } from './screen-cast.js';
import { openTopicMode, openMyTopics } from './screen-mytopics.js';
import { chosenMyTopics, isCustomTopic } from './custom.js';
import { setQuiet } from './sound.js';
import { burstAt } from './fx.js';
import {
  STREAM_MAX_VIEWERS, STREAMER_COLOR, VIEWER_COLOR, onlineViewers, roundKey, streamerAnswer, currentGuesses,
  nextScores, rankingOf, roundRankingOf, pickStreamTopic,
} from './stream.js';

// 締め切りのあと、遅れて届く予想を待つ時間
const GRACE_MS = 3000;
// 制限時間に足す、画面が切りかわるあいだの時間
const START_BUFFER_MS = 1500;
// ロックしたあと、次の画面へ移るまで少し待つ（「ロックしました！」が見えるように）
const AFTER_LOCK_MS = 600;

/** この部屋に入るためのアドレス */
export function joinUrl(code) {
  return pageUrl({ room: code });
}

/** 配信用の画面のアドレス */
export function castUrl(code) {
  return pageUrl({ cast: code });
}

function pageUrl(values) {
  const params = new URLSearchParams(values);
  if (useEmulator()) params.set('emulator', '');
  return `${location.origin}${location.pathname}?${params.toString().replace(/=$|=(?=&)/g, '')}`;
}

// ---------- 部屋を作る・入る ----------

/** 配信用の部屋を作る（online.js から呼ぶ） */
export async function createStreamRoom(net, code, name, timeLimit) {
  await net.set(`rooms/${code}/meta`, { hostUid: net.uid, createdAt: net.serverTime(), status: 'lobby', timeLimit, type: 'stream', streamer: name });
  await net.set(`rooms/${code}/players/${net.uid}`, { name, joinedAt: net.serverTime(), online: true });
}

/**
 * 配信用の部屋に、見ている人として入る（online.js から呼ぶ）。ゲームのとちゅうでも入れる。
 * @returns {Promise<string|null>} 入れなかったときの理由（入れたら null）
 */
export async function joinStreamRoom(net, code, meta, name) {
  if (meta.hostUid === net.uid) {
    // 配信者が開き直したとき
    await net.update(`rooms/${code}/players/${net.uid}`, { online: true });
    return null;
  }
  const viewers = (await net.get(`rooms/${code}/viewers`)) ?? {};
  const already = viewers[net.uid];
  const count = Object.values(viewers).filter((v) => v && v.online !== false).length;
  if (!already && count >= STREAM_MAX_VIEWERS) return `満員です（${STREAM_MAX_VIEWERS}人まで）。配信を見て楽しんでね`;
  await net.set(`rooms/${code}/viewers/${net.uid}`, { name, joinedAt: already?.joinedAt ?? net.serverTime(), online: true });
  return null;
}

/**
 * 配信で遊ぶ流れを始める（部屋に入ったあと、online.js から呼ぶ）。
 * @param {object} me online.js の、今の部屋の情報（net, uid, code, topics など）
 * @param {object} deps { leave, enterView }
 */
export function startStream(me, deps) {
  me.deps = deps;
  me.timers = [];
  const base = `rooms/${me.code}`;
  if (me.isHost) {
    setQuiet('all'); // 音は配信用の画面から出す（二重に聞こえないように）
    me.net.onDisconnectSet(`${base}/players/${me.uid}/online`, false);
    me.unwatch = me.net.watch(base, (room) => onHostRoom(me, room));
    return;
  }
  setQuiet('bgm'); // 配信の音とまざらないように、見ている人のスマホでは BGM を流さない
  me.net.onDisconnectSet(`${base}/viewers/${me.uid}/online`, false);
  me.local = { meta: undefined, state: undefined, self: undefined, score: undefined };
  const watch = (path, key) => me.net.watch(`${base}/${path}`, (value) => {
    me.local[key] = value;
    onViewerData(me);
  });
  const stops = [watch('meta', 'meta'), watch('state', 'state'), watch(`viewers/${me.uid}`, 'self'), watch(`scores/${me.uid}`, 'score')];
  me.unwatch = () => stops.forEach((stop) => stop());
}

/** 配信で遊ぶ流れの後片づけ（画面の分） */
export function stopStream(me) {
  for (const t of me.timers ?? []) window.clearTimeout(t);
  window.clearTimeout(me.holdTimer);
  stopCast();
  setQuiet('');
}

/** 「←」で出るときの確かめの文 */
export function streamLeaveTexts(me) {
  return me.isHost
    ? { title: '部屋を閉じますか？', text: '見ている人のゲームも終わります。', ok: '閉じる' }
    : { title: '部屋を出ますか？', text: 'あとからもう一度入ることもできます。', ok: '出る' };
}

/** 部屋を出るときに、データを片づける（online.js の leave から呼ぶ） */
export async function leaveStreamRoom(me) {
  const base = `rooms/${me.code}`;
  if (me.isHost) {
    await me.net.cancelOnDisconnect(`${base}/players/${me.uid}/online`);
    await me.net.update(`${base}/meta`, { status: 'closed' });
  } else {
    await me.net.cancelOnDisconnect(`${base}/viewers/${me.uid}/online`);
    await me.net.set(`${base}/viewers/${me.uid}/online`, false);
  }
}

function remainingSeconds(me, deadline) {
  return deadline ? Math.max(0, (deadline - me.net.now()) / 1000) : null;
}

function deadlineFrom(me, meta) {
  return meta.timeLimit ? me.net.now() + meta.timeLimit * 1000 + START_BUFFER_MS : null;
}

// ---------- 配信用の画面に出すもの（配信者の操作の画面と、配信用の画面で同じ） ----------

/**
 * 部屋のデータから、screen-cast.js に渡すものを作る。
 * @param {object} room 部屋のデータ（全部）
 * @param {object} options { mode: 'cast'|'op', now: () => number, handlers }
 */
export function castModel(room, { mode, now, handlers = {} }) {
  const meta = room?.meta ?? {};
  const s = room?.state ?? {};
  const code = room?.code ?? '';
  const phase = meta.status === 'lobby' || !s.phase ? 'lobby' : s.phase;
  return {
    mode,
    phase,
    key: roundKey(s),
    streamer: room?.players?.[meta.hostUid]?.name ?? '配信者',
    code,
    url: joinUrl(code),
    viewers: onlineViewers(room),
    topic: s.topic ?? null,
    roundNo: s.roundNo ?? 1,
    remaining: s.deadline ? Math.max(0, (s.deadline - now()) / 1000) : null,
    deadline: s.deadline ?? null,
    total: meta.timeLimit ?? 0,
    answer: streamerAnswer(room),
    guesses: currentGuesses(room),
    wordIndex: s.wordIndex ?? 0,
    answerShown: Boolean(s.answerShown),
    ranking: rankingOf(room),
    roundRanking: roundRankingOf(room),
    handlers,
  };
}

// ---------- 配信者（ホスト） ----------

function onHostRoom(me, room) {
  if (me.closed) return;
  me.room = room;
  if (!room?.meta || room.meta.status === 'closed') {
    showToast('部屋を閉じました');
    me.deps.leave({ silent: true });
    return;
  }
  room.code = me.code;
  directStream(me, room);
  if (me.room !== room) return;
  renderHost(me, room);
}

function renderHost(me, room) {
  const hold = (me.holdUntil ?? 0) - Date.now();
  if (hold > 0 && me.view.startsWith('place:')) {
    window.clearTimeout(me.holdTimer);
    me.holdTimer = window.setTimeout(() => !me.closed && me.room && renderHost(me, me.room), hold + 20);
    return;
  }
  const meta = room.meta;
  const s = room.state ?? {};
  const viewers = onlineViewers(room);

  if (meta.status === 'lobby' || !s.phase) {
    me.deps.enterView('lobby');
    showLobby({
      code: me.code,
      url: joinUrl(me.code),
      members: [...viewers].reverse().map((v) => ({ ...v, color: VIEWER_COLOR })),
      uid: me.uid,
      isHost: true,
      timeOn: Boolean(meta.timeLimit),
      topicMode: meta.topicMode === 'mine' ? 'マイお題' : 'いつものお題',
      stream: { count: viewers.length, max: STREAM_MAX_VIEWERS },
      handlers: {
        start: () => hostStart(me),
        setTime: (on) => me.deps.setTime(on),
        topic: () => hostChooseTopicMode(me),
        openCast: () => openCastWindow(me),
      },
    });
    return;
  }

  // 配信者がワードを置く（配信用の画面には映らない）
  if (s.phase === 'make') {
    const key = roundKey(s);
    if (me.deps.enterView(`place:make:${key}`)) startMake(me, room);
    return;
  }

  me.deps.enterView('cast:op');
  showCast(castModel(room, {
    mode: 'op',
    now: me.net.now,
    handlers: {
      close: () => hostClose(me),
      answer: () => hostAnswer(me),
      next: () => hostNext(me),
      finish: () => hostFinish(me),
      again: () => hostStart(me),
      quit: () => me.deps.leave(),
      openCast: () => openCastWindow(me),
    },
  }));
}

// 配信用の画面を、別の窓で開く（配信ソフトでは、この窓だけを映してもらう）
function openCastWindow(me) {
  const opened = window.open(castUrl(me.code), `atamap-cast-${me.code}`, 'popup,width=1280,height=720');
  if (!opened) showToast('窓が開けませんでした。ブラウザの「ポップアップ」を許可してね');
}

// 同じ進め方を2回しないように、進めた場所を覚えておく
function once(me, key) {
  if (me.advanced === key) return false;
  me.advanced = key;
  return true;
}

function stateKey(room) {
  const s = room?.state ?? {};
  return `${s.gameNo ?? 0}:${s.roundNo ?? 0}:${s.phase ?? 'lobby'}:${s.wordIndex ?? 0}:${s.answerShown ? 1 : 0}`;
}

function write(me, values, message = 'うまく進められませんでした。もう一度押してね') {
  return me.net.update(`rooms/${me.code}`, values).catch((err) => {
    console.error(err);
    me.advanced = null;
    showToast(message);
  });
}

// 予想の締め切りを過ぎたら、答え合わせへ。全員が予想したときも進める
function directStream(me, room) {
  for (const t of me.timers) window.clearTimeout(t);
  me.timers = [];
  const s = room.state ?? {};
  if (s.phase !== 'guess') return;
  const now = me.net.now();
  const viewers = onlineViewers(room);
  const done = new Set(currentGuesses(room).map((g) => g.uid));
  const allDone = viewers.length > 0 && viewers.every((v) => done.has(v.uid));
  const late = s.deadline && now > s.deadline + GRACE_MS;
  if (allDone || late) {
    hostClose(me);
  } else if (s.deadline) {
    me.timers.push(window.setTimeout(() => me.room && !me.closed && directStream(me, me.room), s.deadline + GRACE_MS - now + 100));
  }
}

// マイお題（部屋に上げたもの）
function mineTopics(room) {
  return Object.values(room?.custom ?? {}).filter(isCustomTopic).map((t) => ({ ...t, custom: true }));
}

function hostStart(me) {
  const room = me.room;
  if (!room) return;
  const viewers = onlineViewers(room);
  if (!viewers.length) {
    showToast('見ている人が1人入ると、はじめられます');
    return;
  }
  if (!once(me, `start:${stateKey(room)}`)) return;
  const s = room.state ?? {};
  // 前のゲームの点数・答え・マイお題を消す（データベースのルールに合わせて、1つずつ消す）
  const values = { 'meta/status': 'playing', scores: null };
  for (const uid of Object.keys(room.maps ?? {})) values[`maps/${uid}`] = null;
  for (const id of Object.keys(room.custom ?? {})) values[`custom/${id}`] = null;
  // マイお題：このパソコンに保存した、✓を付けたお題を部屋に上げる
  const mine = room.meta.topicMode === 'mine' ? chosenMyTopics() : [];
  for (const t of mine) values[`custom/${t.id}`] = t;
  // 前のゲームで使ったお題は、なるべく出さない
  const used = s.used ?? [];
  const topic = pickStreamTopic(me.topics, mine, used);
  values.state = {
    phase: 'make',
    gameNo: (s.gameNo ?? 0) + 1,
    roundNo: 1,
    wordIndex: 0,
    answerShown: false,
    deadline: deadlineFrom(me, room.meta),
    topic,
    used: [...used, topic.id].slice(-60),
  };
  write(me, values, 'はじめられませんでした。もう一度押してね');
}

function hostChooseTopicMode(me) {
  const room = me.room;
  openTopicMode({
    mode: room?.meta?.topicMode ?? 'standard',
    mineLabel: 'マイお題',
    modes: ['standard', 'mine'],
    onPick: async (mode) => {
      if (mode === 'mine' && !chosenMyTopics().length) await openMyTopics();
      const next = mode === 'mine' && !chosenMyTopics().length ? 'standard' : mode;
      me.net.update(`rooms/${me.code}/meta`, { topicMode: next }).catch((err) => console.error(err));
    },
  });
}

function startMake(me, room) {
  const s = room.state;
  const key = roundKey(s);
  const remaining = remainingSeconds(me, s.deadline);
  runPlace({
    mode: 'make',
    player: { id: me.uid, name: room.players?.[me.uid]?.name ?? '配信者', color: STREAMER_COLOR },
    topic: s.topic,
    // 引き直し：まだ使っていないお題にする（配信用の画面と、見ている人のスマホのお題も変わる）
    reroll: s.topic.custom ? null : () => {
      const cur = me.room.state;
      const next = pickStreamTopic(me.topics, [], cur.used ?? []);
      write(me, { 'state/topic': next, 'state/used': [...(cur.used ?? []), next.id].slice(-60) });
      return next;
    },
    timeLimit: remaining === null ? 0 : Math.max(0.2, remaining),
    timeTotal: room.meta.timeLimit,
    pausable: false,
    intro: (remaining === null || remaining > (room.meta.timeLimit || 90) - 10) && 'あなたのお題',
  }).then((result) => {
    if (me.closed || roundKey(me.room?.state) !== key) return;
    me.holdUntil = Date.now() + AFTER_LOCK_MS;
    write(me, {
      [`maps/${me.uid}`]: {
        gameNo: s.gameNo,
        roundNo: s.roundNo,
        done: true,
        timeUp: result.timeUp,
        placements: encodePlacements(result.placements),
      },
      'state/phase': 'guess',
      'state/deadline': deadlineFrom(me, me.room.meta),
    }, 'マップを送れませんでした。通信を確かめてね');
  });
}

// 予想を締め切って、答え合わせへ
function hostClose(me) {
  const room = me.room;
  if (room?.state?.phase !== 'guess' || !once(me, `close:${stateKey(room)}`)) return;
  write(me, {
    'state/phase': 'reveal',
    'state/wordIndex': 0,
    'state/answerShown': false,
    'state/deadline': null,
    'state/closedAt': me.net.serverTime(),
  });
}

function hostAnswer(me) {
  const room = me.room;
  const s = room?.state ?? {};
  if (s.phase !== 'reveal' || s.answerShown || !once(me, `answer:${stateKey(room)}`)) return;
  write(me, { 'state/answerShown': true });
}

// 次のワードへ・このお題の結果へ・次のお題へ
function hostNext(me) {
  const room = me.room;
  const s = room?.state ?? {};
  if (!once(me, `next:${stateKey(room)}`)) return;
  if (s.phase === 'reveal') {
    const count = s.topic?.words.length ?? 5;
    if ((s.wordIndex ?? 0) < count - 1) {
      write(me, { 'state/wordIndex': (s.wordIndex ?? 0) + 1, 'state/answerShown': false });
    } else {
      // このお題の結果：見ている人の点数と順位を書く
      write(me, { 'state/phase': 'summary', scores: { ...(room.scores ?? {}), ...nextScores(room) } });
    }
  } else if (s.phase === 'summary') {
    const topic = pickStreamTopic(me.topics, mineTopics(room), s.used ?? []);
    write(me, {
      state: {
        ...s,
        phase: 'make',
        roundNo: (s.roundNo ?? 1) + 1,
        wordIndex: 0,
        answerShown: false,
        deadline: deadlineFrom(me, room.meta),
        topic,
        used: [...(s.used ?? []), topic.id].slice(-60),
        closedAt: null,
      },
    });
  }
}

function hostFinish(me) {
  const room = me.room;
  if (room?.state?.phase !== 'summary' || !once(me, `finish:${stateKey(room)}`)) return;
  write(me, { 'state/phase': 'end', 'state/deadline': null });
}

// ---------- 見ている人 ----------

function onViewerData(me) {
  if (me.closed) return;
  const { meta, state, self, score } = me.local;
  if (meta === undefined || state === undefined || self === undefined) return; // まだ全部とどいていない
  if (!meta || meta.status === 'closed') {
    showToast('配信の部屋が閉じました');
    me.deps.leave({ silent: true });
    return;
  }
  if (!self) {
    showToast('部屋から出ました');
    me.deps.leave({ silent: true });
    return;
  }
  const hold = (me.holdUntil ?? 0) - Date.now();
  if (hold > 0 && me.view.startsWith('place:')) {
    window.clearTimeout(me.holdTimer);
    me.holdTimer = window.setTimeout(() => onViewerData(me), hold + 20);
    return;
  }
  renderViewer(me, meta, state ?? {}, score);
}

function renderViewer(me, meta, s, score) {
  const streamer = meta.streamer ?? '配信者';
  const myName = me.local.self?.name ?? '';
  const main = { id: meta.hostUid, name: streamer, color: STREAMER_COLOR };
  const key = roundKey(s);
  const meChip = [{ name: myName, color: VIEWER_COLOR, done: false, online: true, isMe: true }];

  if (meta.status === 'lobby' || !s.phase) {
    me.deps.enterView('wait:lobby');
    showWait({
      step: '配信に参加中',
      title: `${streamer}さんがはじめるのを待っています`,
      text: 'はじまると、ここにお題が出ます。配信を見ながら待っててね',
      members: meChip,
      remaining: null,
      canSkip: false,
      handlers: {},
    });
    return;
  }
  const step = `${s.roundNo ?? 1}問目`;

  if (s.phase === 'make') {
    me.deps.enterView(`making:${key}`);
    showMaking({
      key,
      main,
      topic: s.topic,
      step,
      remaining: remainingSeconds(me, s.deadline),
      deadline: s.deadline ?? null,
      total: meta.timeLimit,
      canSkip: false,
      onSkip: () => {},
    });
    return;
  }

  if (s.phase === 'guess') {
    if (me.sent?.[key]) {
      me.deps.enterView(`wait:sent:${key}`);
      showWait({
        step,
        title: '予想を送りました！',
        text: '答え合わせは配信で見てね。点数は、お題の結果のときにここに出ます',
        members: meChip,
        remaining: remainingSeconds(me, s.deadline),
        deadline: s.deadline ?? null,
        total: meta.timeLimit,
        canSkip: false,
        handlers: {},
      });
    } else if (me.deps.enterView(`place:guess:${key}`)) {
      startViewerGuess(me, meta, s, main);
    }
    return;
  }

  if (s.phase === 'reveal') {
    me.deps.enterView(`wait:reveal:${key}`);
    showWait({
      step: `${step}・答え合わせ`,
      title: '配信で答え合わせ中！',
      text: me.sent?.[key] ? `いま ${(s.wordIndex ?? 0) + 1}/${s.topic?.words.length ?? 5} 個目。答えは配信で見てね` : 'このお題は予想しませんでした。次のお題で参加しよう',
      members: meChip,
      remaining: null,
      canSkip: false,
      handlers: {},
    });
    return;
  }

  const mine = score && score.game === s.gameNo ? score : null;
  if (s.phase === 'summary') {
    const fresh = me.deps.enterView(`wait:summary:${key}`);
    const got = mine?.key === key ? mine.round : 0;
    showWait({
      step: `${step}・結果`,
      title: mine ? `このお題 +${got}点！` : 'このお題の結果',
      text: mine ? `合計 ${mine.total}点・${mine.rank}位（${mine.of}人中）` : '次のお題から参加できます',
      members: meChip,
      remaining: null,
      canSkip: false,
      handlers: {},
    });
    if (fresh && got > 0) celebrate();
    return;
  }

  if (s.phase === 'end') {
    const fresh = me.deps.enterView(`wait:end:${s.gameNo}`);
    showWait({
      step: '結果発表',
      title: mine ? `${mine.rank}位！` : 'おつかれさま！',
      text: mine ? `合計 ${mine.total}点（${mine.of}人中）。遊んでくれてありがとう！` : '遊んでくれてありがとう！',
      members: meChip,
      remaining: null,
      canSkip: false,
      handlers: {},
    });
    if (fresh && mine) celebrate();
  }
}

function celebrate() {
  window.setTimeout(() => burstAt(document.querySelector('[data-screen="wait"] [data-wait="title"]'), { count: 14, spread: 70, stars: true }), 200);
}

function startViewerGuess(me, meta, s, main) {
  const key = roundKey(s);
  const remaining = remainingSeconds(me, s.deadline);
  runPlace({
    mode: 'guess',
    player: { id: me.uid, name: me.local.self?.name ?? '', color: VIEWER_COLOR },
    main,
    topic: s.topic,
    timeLimit: remaining === null ? 0 : Math.max(0.2, remaining),
    timeTotal: meta.timeLimit,
    pausable: false,
  }).then(async (result) => {
    if (me.closed) return;
    me.sent = { ...me.sent, [key]: true };
    me.holdUntil = Date.now() + AFTER_LOCK_MS;
    try {
      await me.net.set(`rooms/${me.code}/vguesses/${me.uid}`, {
        gameNo: s.gameNo,
        roundNo: s.roundNo,
        at: me.net.serverTime(),
        placements: encodePlacements(result.placements),
      });
    } catch (err) {
      console.error(err);
      me.sent[key] = false;
      showToast('予想を送れませんでした。通信を確かめてね');
    }
    onViewerData(me);
  });
}

export { stopPlace, stopWait, stopMaking };
