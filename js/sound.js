// BGM と効果音。ブラウザの中（Web Audio）で鳴らす。
// ・BGM と一部の効果音は、ブラウザの中で音を作る
// ・ほかの効果音は「効果音ラボ」の音（sounds/ のファイル。2026-11-11 にユーザーがえらんだ）。読みこめるまでは、作った音で鳴らす
// ・スマホは、画面を一度さわるまで音を出せないので、最初にさわったときに準備する
// ・「音 オン／オフ」は、このスマホに覚えておく
// ・音が出せないブラウザでは、何もしない（遊ぶのには困らない）
const KEY = 'atamap.sound';
// BGM と効果音の大きさ（0〜1。このパソコン・スマホに覚えておく）
const VOLUME_KEY = 'atamap.volume';

// 音の大きさ（全体・BGM・効果音）
const MASTER = 0.8;
const BGM_VOLUME = 0.2;
const SFX_VOLUME = 0.55;

let ctx = null;
let master = null;
let bgmGain = null;
let sfxGain = null;
let noise = null;
let on = loadOn();
let volume = loadVolume();
let bgmWanted = false;
let scheduler = 0;
let nextStep = 0;
let nextTime = 0;
let duckUntil = 0;
// この画面だけ音を小さくする（設定には覚えない）。'' ：ふつう、'bgm'：BGM だけ消す、'all'：全部消す
// 配信で遊ぶとき、配信者の操作の画面は音を出さず（配信用の画面から出す）、見ている人のスマホは BGM を流さない
let quiet = '';

// 効果音ラボの音（sounds/ のファイル名）。ここにない効果音（ワードをえらぶ・残りわずか）は、作った音のまま
const FILES = {
  tap: 'cursor7', // ボタンを押す
  place: 'peta1', // ワードを置く
  lock: 'decision4', // ロック
  timeUp: 'beep4', // 時間切れ
  topic: 'question1', // お題が出る
  pin: 'pa1', // みんなのピンが出る
  drumroll: 'tympani-roll1', // ドキドキ
  reveal: 'jajean1', // 答えの発表
  sparkle: 'correct1', // ど真ん中
  shout: 'boyoyon1', // そこ置く!?
  fanfare: 'levelup1', // 最終結果
};
// 新しい場面の音。決まるまでは、ほかの場面の音を使う（2026-11-11 に答え合わせとラウンドの結果を変えたときに足した）
const ALIAS = {
  pinsCue: 'topic', // 「みんなの予想を見る！」
  rankRow: 'pin', // ラウンドの結果を1人ずつ出す
  rankDrum: 'drumroll', // 1位の前のドキドキ
  rankTop: 'reveal', // 1位の発表（このあとファンファーレも鳴らす）
  rankZero: 'shout', // 全員0点
};
const buffers = {};
let filesLoading = false;
// 鳴っているドラムロール（とちゅうで止められるように）
let drum = null;

function loadOn() {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

function loadVolume() {
  const clamp = (v) => (typeof v === 'number' && v >= 0 && v <= 1 ? v : 1);
  try {
    const saved = JSON.parse(localStorage.getItem(VOLUME_KEY) ?? '{}') ?? {};
    return { bgm: clamp(saved.bgm), sfx: clamp(saved.sfx) };
  } catch {
    return { bgm: 1, sfx: 1 };
  }
}

/** BGM と効果音の大きさ（{ bgm, sfx }。0〜1） */
export function getVolume() {
  return { ...volume };
}

/**
 * BGM か効果音の大きさを変える（このパソコン・スマホに覚える）。
 * 同じパソコンで開いている、ほかの窓（配信用の画面）にも伝わる。
 * @param {'bgm'|'sfx'} kind
 * @param {number} value 0〜1
 */
export function setVolume(kind, value) {
  volume = { ...volume, [kind]: Math.min(1, Math.max(0, value)) };
  try {
    localStorage.setItem(VOLUME_KEY, JSON.stringify(volume));
  } catch {
    // 覚えられなくても、今は変わる
  }
  applyVolume();
}

function bgmLevel() {
  return BGM_VOLUME * volume.bgm;
}

function applyVolume() {
  if (!ctx) return;
  const t = ctx.currentTime;
  sfxGain.gain.setTargetAtTime(SFX_VOLUME * volume.sfx, t, 0.05);
  bgmGain.gain.cancelScheduledValues(t);
  if (duckUntil > t) {
    bgmGain.gain.setTargetAtTime(bgmLevel() * 0.15, t, 0.08);
    bgmGain.gain.setTargetAtTime(bgmLevel(), duckUntil, 0.4);
  } else {
    bgmGain.gain.setTargetAtTime(bgmLevel(), t, 0.05);
  }
}

// 配信者の操作の画面で大きさを変えたら、配信用の画面（同じパソコンの別の窓）の音も変える。
// 効果音を変えたときは、大きさがわかるように1つ鳴らす
window.addEventListener('storage', (event) => {
  if (event.key !== VOLUME_KEY) return;
  const before = volume;
  volume = loadVolume();
  applyVolume();
  if (volume.sfx !== before.sfx) sfx('tap');
});

/** 音が出る設定か */
export function soundOn() {
  return on;
}

/** 音のオン・オフを切りかえる（このスマホに覚える） */
export function setSoundOn(value) {
  on = value;
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    // 覚えられなくても、今は切りかわる
  }
  if (!ctx) return;
  master.gain.setTargetAtTime(on && quiet !== 'all' ? MASTER : 0, ctx.currentTime, 0.05);
  if (on && bgmWanted && !quiet) startScheduler();
  // オフのあいだは、BGM の音も作らない（電池のため）
  if (!on) {
    window.clearInterval(scheduler);
    scheduler = 0;
  }
}

/**
 * この画面だけ音を小さくする（設定には覚えない）。
 * @param {''|'bgm'|'all'} mode ''：ふつう、'bgm'：BGM だけ消す、'all'：全部消す
 */
export function setQuiet(mode) {
  quiet = mode || '';
  if (!ctx) return;
  master.gain.setTargetAtTime(on && quiet !== 'all' ? MASTER : 0, ctx.currentTime, 0.05);
  if (quiet) {
    window.clearInterval(scheduler);
    scheduler = 0;
  } else if (on && bgmWanted) {
    startScheduler();
  }
}

/** 画面を最初にさわったときに呼ぶ（音の準備） */
export function unlockSound() {
  if (!ctx) {
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) return;
    // iPhone：ゲームの音として鳴らす（マナーモードのスイッチが入っていても鳴る。消したいときは「音 オフ」）
    try {
      if (navigator.audioSession) navigator.audioSession.type = 'playback';
    } catch {
      // 使えないブラウザでは、ふつうに鳴らす
    }
    try {
      ctx = new Context();
    } catch {
      return;
    }
    master = ctx.createGain();
    master.gain.value = on && quiet !== 'all' ? MASTER : 0;
    master.connect(ctx.destination);
    bgmGain = ctx.createGain();
    bgmGain.gain.value = bgmLevel();
    bgmGain.connect(master);
    sfxGain = ctx.createGain();
    sfxGain.gain.value = SFX_VOLUME * volume.sfx;
    sfxGain.connect(master);
    noise = makeNoise();
    loadFiles();
    // 画面が見えていないあいだは、音を止める
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) ctx.suspend?.();
      else ctx.resume?.();
    });
  }
  if (ctx.state !== 'running') {
    // iPhone は、さわったその場で音を一度鳴らさないと、音が出せるようにならないことがある（無音を一瞬だけ鳴らす）
    try {
      const silent = ctx.createBufferSource();
      silent.buffer = ctx.createBuffer(1, 1, 22050);
      silent.connect(ctx.destination);
      silent.start(0);
    } catch {
      // 鳴らせなくても、つぎにさわったときにもう一度ためす
    }
    ctx.resume?.().then(() => bgmWanted && startScheduler()).catch(() => {});
  }
  if (bgmWanted) startScheduler();
}

/** 音が出せる状態か（まだなら、つぎにさわったときにもう一度準備する） */
export function soundReady() {
  return Boolean(ctx && ctx.state === 'running');
}

/** BGM を流す（流れていれば、そのまま） */
export function startBgm() {
  bgmWanted = true;
  if (ctx) startScheduler();
}

/** BGM を止める */
export function stopBgm() {
  bgmWanted = false;
  window.clearInterval(scheduler);
  scheduler = 0;
}

/**
 * BGM を少しのあいだ小さくする（ドキドキや答えの発表を聞こえやすくする）。
 * @param {number} ms 小さくしておく時間
 * @param {number} [level] そのあいだの大きさ（0〜1）
 */
export function duckBgm(ms, level = 0.15) {
  if (!ctx) return;
  const t = ctx.currentTime;
  duckUntil = Math.max(duckUntil, t + ms / 1000);
  bgmGain.gain.cancelScheduledValues(t);
  bgmGain.gain.setTargetAtTime(bgmLevel() * level, t, 0.08);
  bgmGain.gain.setTargetAtTime(bgmLevel(), duckUntil, 0.4);
}

// ---------- BGM（このゲームのために作った、明るい8小節のくり返し） ----------

const BPM = 128;
const STEP = 60 / BPM / 2; // 8分音符の長さ（秒）
const BARS = 8;
// メロディ（MIDI の番号。null は休み）。1小節に8分音符8つ
const MELODY = [
  [76, null, 79, null, 84, null, 79, 76],
  [81, null, 79, null, 76, null, 72, null],
  [77, null, 81, null, 84, null, 81, 77],
  [79, null, null, 83, 86, null, null, null],
  [76, 79, 76, 72, 74, 76, null, null],
  [81, null, 84, null, 83, null, 81, null],
  [77, null, 81, null, 79, null, 83, null],
  [84, null, 79, null, 84, null, null, null],
];
// 和音（小節ごと。7小節目は後ろ半分で変わる）と、ベースの音
const CHORDS = [
  [60, 64, 67], [57, 60, 64], [57, 60, 65], [55, 59, 62],
  [60, 64, 67], [57, 60, 64], [57, 60, 65], [60, 64, 67],
];
const ROOTS = [48, 45, 41, 43, 48, 45, 41, 48];

function startScheduler() {
  if (scheduler || !on || quiet) return;
  nextStep = 0;
  nextTime = ctx.currentTime + 0.1;
  scheduler = window.setInterval(schedule, 25);
}

// 少し先までの音を、まとめて予約する
function schedule() {
  if (!ctx || ctx.state !== 'running') return;
  while (nextTime < ctx.currentTime + 0.15) {
    playStep(nextStep, nextTime);
    nextStep = (nextStep + 1) % (BARS * 8);
    nextTime += STEP;
  }
}

function playStep(step, t) {
  const bar = Math.floor(step / 8);
  const beat = step % 8;
  let chord = CHORDS[bar];
  let root = ROOTS[bar];
  if (bar === 6 && beat >= 4) {
    chord = [55, 59, 62];
    root = 43;
  }
  // メロディ
  const note = MELODY[bar][beat];
  if (note) tone({ freq: midi(note), type: 'square', at: t, dur: STEP * 0.9, vol: 0.18, out: bgmGain, cut: 2600 });
  // ベース（ド・ド↑・ソ・ド↑）
  const bass = [root, null, root + 12, null, root + 7, null, root + 12, null][beat];
  if (bass) tone({ freq: midi(bass), type: 'triangle', at: t, dur: STEP * 1.6, vol: 0.5, out: bgmGain });
  // 裏拍の和音（ッチャ）
  if (beat % 2 === 1) chord.forEach((n) => tone({ freq: midi(n), type: 'square', at: t, dur: STEP * 0.35, vol: 0.05, out: bgmGain, cut: 1800 }));
  // リズム：1・3拍目にバスドラム、2・4拍目にスネア、8分でハイハット
  if (beat === 0 || beat === 4) kick(t, 0.5, bgmGain);
  if (beat === 2 || beat === 6) snare(t, 0.25, bgmGain);
  hat(t, beat % 2 ? 0.05 : 0.09, bgmGain);
}

// ---------- 効果音 ----------

const SOUNDS = {
  // ボタンを押した
  tap(t) {
    sweep({ from: 900, to: 1400, at: t, dur: 0.06, vol: 0.25 });
  },
  // ワードをえらんだ
  select(t) {
    tone({ freq: 1320, type: 'sine', at: t, dur: 0.07, vol: 0.25 });
  },
  // ワードを置いた（ポン）
  place(t) {
    sweep({ from: 520, to: 980, at: t, dur: 0.1, vol: 0.45 });
    tone({ freq: 1960, type: 'sine', at: t + 0.02, dur: 0.06, vol: 0.1 });
  },
  // ロック・決定（ドン！とハンコ）
  lock(t) {
    kick(t, 1, sfxGain);
    burst(t, 0.12, 0.5, 1200);
    [60, 64, 67, 72].forEach((n) => tone({ freq: midi(n), type: 'square', at: t + 0.05, dur: 0.22, vol: 0.12, cut: 3000 }));
  },
  // お題の発表（デデン！）
  topic(t) {
    brass(43, t, 0.16, 0.5);
    kick(t, 0.9, sfxGain);
    brass(48, t + 0.2, 0.55, 0.6);
    kick(t + 0.2, 1, sfxGain);
    burst(t + 0.2, 0.5, 0.25, 6000);
  },
  // 予想のピンが出た（1本ごとに少しずつ高く）
  pin(t, i = 0) {
    sweep({ from: 600 * 2 ** (i / 6), to: 1100 * 2 ** (i / 6), at: t, dur: 0.08, vol: 0.4 });
  },
  // 答えの発表（ジャーン！）
  reveal(t) {
    kick(t, 1, sfxGain);
    burst(t, 1.2, 0.35, 5000);
    [48, 60, 64, 67, 72, 76].forEach((n) => tone({ freq: midi(n), type: 'sawtooth', at: t, dur: 1.1, vol: 0.09, cut: 2200 }));
  },
  // ど真ん中（キラキラ）
  sparkle(t) {
    [84, 88, 91, 96].forEach((n, i) => tone({ freq: midi(n), type: 'sine', at: t + i * 0.06, dur: 0.18, vol: 0.18 }));
  },
  // そこ置く!?（ボヨン）
  shout(t) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(420, t);
    osc.frequency.exponentialRampToValueAtTime(140, t + 0.35);
    const wobble = ctx.createOscillator();
    const depth = ctx.createGain();
    wobble.frequency.value = 18;
    depth.gain.value = 40;
    wobble.connect(depth).connect(osc.frequency);
    envelope(gain, t, 0.4, 0.5);
    osc.connect(gain).connect(sfxGain);
    osc.start(t);
    wobble.start(t);
    osc.stop(t + 0.45);
    wobble.stop(t + 0.45);
  },
  // 残りわずか（カチッ）
  tick(t) {
    tone({ freq: 1500, type: 'square', at: t, dur: 0.03, vol: 0.12, cut: 4000 });
  },
  // 時間切れ（ブー）
  timeUp(t) {
    tone({ freq: 160, type: 'square', at: t, dur: 0.55, vol: 0.25, cut: 1200 });
    tone({ freq: 168, type: 'square', at: t, dur: 0.55, vol: 0.25, cut: 1200 });
  },
  // 最終結果（パパパパーン）
  fanfare(t) {
    const notes = [[67, 0, 0.12], [67, 0.14, 0.12], [67, 0.28, 0.12], [72, 0.42, 0.9]];
    notes.forEach(([n, at, dur]) => {
      tone({ freq: midi(n), type: 'square', at: t + at, dur, vol: 0.2, cut: 3500 });
      tone({ freq: midi(n - 12), type: 'sawtooth', at: t + at, dur, vol: 0.1, cut: 1500 });
    });
    [60, 64, 67].forEach((n) => tone({ freq: midi(n), type: 'sawtooth', at: t + 0.42, dur: 0.9, vol: 0.06, cut: 2000 }));
    kick(t + 0.42, 1, sfxGain);
    burst(t + 0.42, 1, 0.3, 5000);
  },
};

// 効果音ラボの音を読みこむ（js/ と同じ場所にある sounds/ から。読みこめなかった音は、作った音で鳴らす）
function loadFiles() {
  if (filesLoading || typeof fetch !== 'function') return;
  filesLoading = true;
  for (const [name, file] of Object.entries(FILES)) {
    fetch(new URL(`../sounds/${file}.mp3`, import.meta.url))
      .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error(res.status))))
      // 古い iPhone でも動くように、結果は関数で受け取る形にする
      .then((data) => new Promise((resolve, reject) => ctx.decodeAudioData(data, resolve, reject)))
      .then((buffer) => {
        buffers[name] = buffer;
      })
      .catch(() => {
        // 読みこめなくても、作った音で鳴る
      });
  }
}

// 効果音ラボの音を鳴らす（読みこめていなければ false）
function playFile(name, t, { rate = 1, until = 0 } = {}) {
  const buffer = buffers[name];
  if (!buffer) return false;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.playbackRate.value = rate;
  if (until) {
    // 決めた時間で、すっと小さくして止める
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(1, Math.max(t, until - 0.15));
    gain.gain.linearRampToValueAtTime(0.0001, until);
    src.connect(gain).connect(sfxGain);
    src.start(t);
    src.stop(until + 0.02);
    drum = { src, gain };
  } else {
    src.connect(sfxGain);
    src.start(t);
  }
  return true;
}

/**
 * 効果音を鳴らす。
 * @param {keyof SOUNDS} name 音の名前
 * @param {number} [arg] 音によって使う数（ピンの何本目か など）
 */
export function sfx(name, arg) {
  if (!ctx || !on || quiet === 'all' || ctx.state !== 'running') return;
  try {
    const t = ctx.currentTime + 0.01;
    // ピンは、1本ごとに少しずつ高くする（高くなりすぎないように6本目まで）
    const rate = name === 'pin' || name === 'rankRow' ? 2 ** (Math.min(arg ?? 0, 5) / 6) : 1;
    if (playFile(name, t, { rate })) return;
    if (!SOUNDS[name] && ALIAS[name]) {
      // まだ音のファイルがない場面は、ほかの場面の音で鳴らす
      if (name === 'rankTop') window.setTimeout(() => sfx('fanfare'), 700);
      sfx(ALIAS[name], arg);
      return;
    }
    if (!SOUNDS[name]) return;
    SOUNDS[name](t, arg);
  } catch {
    // 音が鳴らせなくても、遊ぶのには困らない
  }
}

/**
 * ドキドキの小太鼓（だんだん大きくなる）を鳴らす。
 * @param {number} ms 鳴らす時間
 * @param {string} [name] 音のファイルの場面（'rankDrum' など。なければふつうのドラムロール）
 */
export function drumroll(ms, name = 'drumroll') {
  if (!ctx || !on || quiet === 'all' || ctx.state !== 'running') return;
  const start = ctx.currentTime + 0.02;
  const end = start + ms / 1000;
  stopDrumroll();
  if (playFile(name, start, { until: end }) || playFile('drumroll', start, { until: end })) return;
  for (let t = start; t < end; t += 0.045) {
    const progress = (t - start) / (end - start);
    burst(t, 0.05, 0.08 + progress * 0.3, 2200, 'bandpass');
  }
}

/** 鳴っているドラムロールを、すっと止める */
export function stopDrumroll() {
  if (!drum || !ctx) return;
  const { src, gain } = drum;
  drum = null;
  const t = ctx.currentTime;
  try {
    gain.gain.cancelScheduledValues(t);
    gain.gain.setValueAtTime(gain.gain.value, t);
    gain.gain.linearRampToValueAtTime(0.0001, t + 0.12);
    src.stop(t + 0.15);
  } catch {
    // もう止まっている
  }
}

// ---------- 音を作る部品 ----------

function midi(n) {
  return 440 * 2 ** ((n - 69) / 12);
}

function envelope(gain, t, dur, vol) {
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(vol, t + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
}

function tone({ freq, type = 'sine', at, dur, vol, out = sfxGain, cut = 0 }) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  envelope(gain, at, dur, vol);
  let node = osc;
  if (cut) {
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cut;
    node = osc.connect(filter);
  }
  node.connect(gain).connect(out);
  osc.start(at);
  osc.stop(at + dur + 0.02);
}

function sweep({ from, to, at, dur, vol }) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(from, at);
  osc.frequency.exponentialRampToValueAtTime(to, at + dur);
  envelope(gain, at, dur, vol);
  osc.connect(gain).connect(sfxGain);
  osc.start(at);
  osc.stop(at + dur + 0.02);
}

// 金管のような太い音（デデン）
function brass(note, at, dur, vol) {
  [0, 12, 19].forEach((add, i) => {
    tone({ freq: midi(note + add), type: 'sawtooth', at, dur, vol: vol * (i ? 0.35 : 0.6), cut: 1400 });
  });
}

function kick(at, vol, out) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.setValueAtTime(150, at);
  osc.frequency.exponentialRampToValueAtTime(45, at + 0.18);
  envelope(gain, at, 0.22, vol);
  osc.connect(gain).connect(out);
  osc.start(at);
  osc.stop(at + 0.25);
}

function snare(at, vol, out) {
  burst(at, 0.12, vol, 1800, 'highpass', out);
}

function hat(at, vol, out) {
  burst(at, 0.03, vol, 7000, 'highpass', out);
}

// ざっという音（シンバル・スネア・ハンコ）
function burst(at, dur, vol, freq, type = 'highpass', out = sfxGain) {
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = freq;
  const gain = ctx.createGain();
  envelope(gain, at, dur, vol);
  src.connect(filter).connect(gain).connect(out);
  src.start(at, Math.random() * 0.5);
  src.stop(at + dur + 0.02);
}

function makeNoise() {
  const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}
