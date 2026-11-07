// メダルプッシャーの中身（物理と得点）。画面とは切り離してあり、ブラウザでも Node でも動く。
// 上から見た2D。押し出し台（プッシャー）が前後に動き、メダルの列を押す。
// 手前のふちから落ちたメダルは払い出し（中央）か、取られる（左右の端）。
// ・投入：左右の固定発射口から狙いを変え、上段に着地。上段の縁から下段へ落ちて、下段を押す
// ・CHANCE：左右2個の固定ボール専用ゲート。奥から手前への通過でスロット抽選（保留は4つまで）
// ・ボール：台に混ざっている大きな玉。手前から落ちるとボールルーレット
(function (root) {
  'use strict';

  const CFG = {
    W: 420,            // 台の幅
    D: 620,            // 台の奥行き（奥 y=0 → 手前 y=D）
    R: 13,             // メダルの半径
    PUSH_MIN: 140,     // プッシャー前面のいちばん奥
    PUSH_AMP: 55,      // プッシャーが前に出る量
    PUSH_T: 3.0,       // プッシャーの往復の時間（秒）
    AIM_RANGE: [[35, 385], [35, 385]], // 左右それぞれの発射口で狙える着地点の範囲
    AIM_START: [125, 295],
    UPPER_BACK: 32,    // 上段の奥にある固定の壁
    UPPER_START: 48,   // 最初から上段に載っているメダル
    STEP_HEIGHT: 22,   // 上段の前縁から下段へ落ちる段差
    SHOT_TIME: 0.48,   // 横の発射口から上段へ届く時間
    FALL_TIME: 0.28,   // 上段から下段へ落ちる時間
    END_WAIT_CYCLES: 2, // 0枚になったら抽選・落下完了後に待つプッシャーの往復数
    GUTTER: 100,        // 手前の左右の端：ここから落ちると取られる
    DT: 1 / 60,
    ITER: 4,           // 重なりを直す回数
    COOLDOWN: 0.3,     // 同じ投入口から続けて入れられる間隔（秒）
    SPECIAL_INITIAL: 10, // 最初から下段に混ぜる色メダル
    SPECIAL_EVERY: 36,  // 投入36枚ごとに色メダル。景品は通常色にして無限連鎖を防ぐ
    DROP_JITTER: 12,   // 落ちる位置のばらつき（左右）
    // CHANCE（左右2個の固定ボール専用ゲート）
    CHANCE_Y: 570,     // ゲートの位置（手前のふち D の少し奥）
    CHANCE_W: 70,     // ゲートの開口幅（ボールの中心がこの内側を通ると入賞）
    CHANCE_X: [115, 305], // 左右の固定位置
    BALL_RETURN_MARGIN: 50, // 返却先の左右の余白
    STOCK_MAX: 4,      // 保留の上限
    // スロット
    SLOT_TIME: 2.6,    // 1回の抽選の時間（秒）
    SLOT_TABLE: [      // 出目と確率と景品
      { sym: '7', p: 0.02, prize: { medal: 30, super: true }, label: '７７７ → 上位抽選＋30枚' },
      { sym: '★', p: 0.10, prize: { medal: 8 }, label: '★★★ → メダル16枚' },
      { sym: 'Ｆ', p: 0.015, prize: { medal: 30, fever: true }, label: 'ＦＦＦ → 30枚＋３回連チャン' },
      { sym: '●', p: 0.055, prize: { ball: 1 }, label: '●●● → ボールを1個追加' },
    ],
    SYMBOLS: ['7', '★', '●', 'Ｆ', '◆'],
    // ボール
    BALL_R: 21,
    BALL_WEIGHT: 8,    // メダルより重い（押されにくい）
    BALLS: 4,          // 最初に台にあるボール
    BALL_MIN: 4,      // 1個落ちた時点で早めに4個へ補充（返却中は台上3個が目安）
    BALL_REFILL_TIME: 0.45, // 最低数の補充は短いレーン移動で戻す
    BALL_MAX: 4,
    ROULETTE_TIME: 3.2,
    ROULETTE: [0, 0, 10, 20, 0, 30, 50, 'JP'],
    ROULETTE_WEIGHTS: [0.27,0.25,0.15,0.07,0.15,0.07,0.037,0.003], // ボールルーレットの目（等しい確率）
    FEED_EVERY: 2,     // 当たりのメダルを台に出す間隔（コマ数）
    MODE: 'normal',
    PRIZE_SCALE: 1,
    JP_BASE: 100,
    JP_STEP: 1,
    SUPER_TIME: 3.4,
    SUPER_TABLE: [{value:0,p:0.78},{value:30,p:0.18},{value:100,p:0.035},{value:'JP',p:0.005}],
    PRIZE_FLIGHT_TIME: 0.6,
    BALL_RETURN_TIME: 2.6,
    START_CREDIT: 150,  // 最初の手持ち
    START_FIELD: 210,  // 最初に並べるメダル
    WARMUP: 120,       // さらに足して台を満杯にする枚数
  };

  function rng(seed) { // mulberry32
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const BALL_TYPES = {
    red: {label:'赤',symbol:'R',description:'通常ルーレット',color:'#ff6b6b',dark:'#8a0010'},
    blue: {label:'青',symbol:'×2',description:'数字の当たり２倍',color:'#55c4ff',dark:'#134e9a'},
    purple: {label:'紫',symbol:'★',description:'ルーレット＋上位抽選',color:'#c788ff',dark:'#572884'},
    rainbow: {label:'虹',symbol:'JP',description:'JP確率アップの専用抽選',color:'#ffe39a',dark:'#785971'},
  };
  const MODES = {
    normal: { label: '通常', description: '150枚スタート。大きな当たりを待ちながら長く遊ぶ。' },
    festival: { label: 'お祭り', description: '200枚スタート、景品メダル２倍！大きな当たりを楽しもう。', PRIZE_SCALE: 2, START_CREDIT: 200, JP_BASE: 200, JP_STEP: 1, GUTTER: 40, FEED_EVERY: 1 },
  };
  function create(seed = 1, opts = {}) {
    const mode = MODES[opts.MODE] ? opts.MODE : 'normal';
    const C = Object.assign({}, CFG, MODES[mode], opts, {MODE: mode});
    C.SLOT_TABLE = C.SLOT_TABLE.map(row => {
      const prize = {...row.prize}; if (prize.medal) prize.medal *= C.PRIZE_SCALE;
      const desc = [prize.super ? '上位抽選' : '', prize.medal ? `${prize.medal}枚` : '', prize.fever ? '３回連チャン' : '', prize.ball ? `ボール補充／満杯${10*C.PRIZE_SCALE}枚` : ''].filter(Boolean).join('＋');
      return {...row, prize, label: `${row.sym.repeat(3)} → ${desc}`};
    });
    C.ROULETTE = C.ROULETTE.map(v => typeof v === 'number' ? v * C.PRIZE_SCALE : v);
    C.SUPER_TABLE = C.SUPER_TABLE.map(row => ({...row, value:typeof row.value === 'number' ? row.value * C.PRIZE_SCALE : row.value}));
    const rand = rng(seed);
    const newStats = () => ({ inserted: 0, paid: 0, lost: 0, chance: 0, chanceOver: 0, chanceLeft: 0, chanceRight: 0, slot: 0, slotWin: 0, slotMedals: 0, ballOut: 0, rouletteMedals: 0, upperFalls: 0, landed: 0, awarded: 0, fed: 0, jackpots: 0, jackpotMedals: 0, superSpins: 0, chainBonus: 0, bestChain: 0, ballReturned: 0, ballAutoSupplied: 0, specialBlue: 0, specialPurple: 0, specialRainbow: 0 });
    const g = {
      C, t: 0, medals: [], upper: [], shots: [], falling: [], prizeFlights: [], ballReturns: [], credit: C.START_CREDIT, stats: newStats(),
      cool: [0, 0], events: [], aim: C.AIM_START.slice(),
      stock: 0, slot: null,         // slot = {t0, t1, result:[a,b,c], win}
      ballQueue: 0, ballTickets: [], roulette: null, // roulette = {t0, t1, index, value}
      feed: 0, superQueue: 0, superSlot: null, feverLeft: 0, chain: 0, stars: 0, jackpot: Math.max(C.JP_BASE, Number.isSafeInteger(opts.JACKPOT_START) ? opts.JACKPOT_START : C.JP_BASE), lastAward: null, awards: [], awardSerial: 0, frame: 0, paused: false, status: 'playing', drainSince: null,
    };
    let initializing = true;
    const pending = () => !!(g.shots.length || g.falling.length || g.slot || g.stock || g.roulette || g.ballQueue || g.feed || g.prizeFlights.length || g.ballReturns.length || g.superSlot || g.superQueue || g.feverLeft);
    g.drainRemaining = () => Math.max(0, C.PUSH_T * C.END_WAIT_CYCLES - (g.drainSince === null ? 0 : g.t - g.drainSince));
    function updateRound() {
      if (g.credit > 0) {
        if (g.status === 'draining') g.events.push({ type: 'credit_recovered', credit: g.credit, t: g.t });
        g.status = 'playing'; g.drainSince = null;
      } else {
        if (g.status !== 'draining') {
          g.status = 'draining'; g.drainSince = g.t;
          g.events.push({ type: 'credit_empty', t: g.t });
        }
        // 保留抽選・景品の追加・発射・段差の落下は最後まで処理してから待つ。
        if (pending()) g.drainSince = g.t;
        if (!pending() && g.drainRemaining() <= 0) {
          g.status = 'over'; g.events.push({ type: 'game_over', t: g.t });
        }
      }
    }

    const pusherFront = (t) => C.PUSH_MIN + C.PUSH_AMP * (0.5 - 0.5 * Math.cos(2 * Math.PI * t / C.PUSH_T));
    const chanceX = (side = 0) => C.CHANCE_X[side];
    g.pusherFront = () => pusherFront(g.t);
    g.chanceX = (side = 0) => chanceX(side);
    g.chanceGates = () => C.CHANCE_X.map((x, id) => ({id, x, y:C.CHANCE_Y, width:C.CHANCE_W}));
    g.setPaused = (paused) => (g.paused = g.status !== 'over' && !!paused);

    let nextId = 1;
    function add(x, y, ball, kind = 'gold', ballKind = 'red') { g.medals.push({ x, y, py: y, id: nextId++, r: ball ? C.BALL_R : C.R, ball: !!ball, passed: false, kind, ballKind }); }
    let ballBag = [];
    function nextBallKind() {
      if(!ballBag.length){ballBag=Object.keys(BALL_TYPES);for(let i=ballBag.length-1;i>0;i--){const j=Math.floor(rand()*(i+1));[ballBag[i],ballBag[j]]=[ballBag[j],ballBag[i]];}}
      return ballBag.pop();
    }
    g.rouletteValues = (kind='red') => {
      if(kind==='rainbow'){const base=C.ROULETTE.find(v=>typeof v==='number'&&v>0)||10*C.PRIZE_SCALE;return[0,base*2,'JP',0,base*4,'JP',base*3,'JP'];}
      return C.ROULETTE.map(v=>kind==='blue'&&typeof v==='number'?v*2:v);
    };
    function rouletteWeights(kind, n) {
      if(kind==='rainbow')return[0.35,0.20,0.0033,0.25,0.10,0.0033,0.09,0.0034];
      return C.ROULETTE_WEIGHTS.length===n?C.ROULETTE_WEIGHTS:Array(n).fill(1/n);
    }
    const randX = (r) => r + rand() * (C.W - 2 * r);
    const backY = (r) => pusherFront(g.t) + C.STEP_HEIGHT + r + 2 + rand() * 40;
    function addUpper(x, y, id, kind = 'gold') {
      const m = { x, y, py: y, id: id === undefined ? nextId++ : id, r: C.R, ball: false, passed: false, kind };
      g.upper.push(m); return m;
    }
    function inputKind(n) {
      if (!(C.SPECIAL_EVERY > 0) || n % C.SPECIAL_EVERY) return 'gold';
      const ticket = n / C.SPECIAL_EVERY;
      return ticket % 8 === 0 ? 'rainbow' : ticket % 3 === 0 ? 'purple' : 'blue';
    }
    function shotPosition(side) { return { x: side ? C.W - 12 : 12, y: C.UPPER_BACK + 22 }; }
    g.shotPosition = shotPosition;
    g.aimTarget = (side) => ({ x: g.aim[side], y: C.UPPER_BACK + C.R + 24 });

    // 最初の台：すき間を少し残してメダルを並べる
    const pf0 = pusherFront(0);
    for (let i = 0; i < C.START_FIELD * 3 && g.medals.length < C.START_FIELD; i++) {
      const x = randX(C.R), y = pf0 + C.STEP_HEIGHT + C.R + rand() * (C.D - pf0 - C.STEP_HEIGHT - 3 * C.R);
      if (g.medals.every((m) => (m.x - x) ** 2 + (m.y - y) ** 2 > (2 * C.R * 0.92) ** 2)) add(x, y);
    }
    for (let i = 0; i < C.BALLS; i++) add(C.W * (i + 1) / (C.BALLS + 1), pf0 + 150 + rand() * 80, true);

    // 上段の着地点を狙う（左右の発射口自体は固定。範囲外は端に寄せる）
    g.setAim = function (side, x) {
      if (g.paused || g.status === 'over') return g.aim[side];
      const [a, b] = C.AIM_RANGE[side];
      g.aim[side] = Math.min(b, Math.max(a, +x));
      return g.aim[side];
    };

    // 投入：side 0=左 1=右。x を渡すとその位置に合わせてから入れる。入れられたら true
    g.drop = function (side, x) {
      if (g.paused || g.status === 'over') return false;
      if (x !== undefined) g.setAim(side, x);
      if (g.credit <= 0 || g.cool[side] > 0) return false;
      g.credit--; g.stats.inserted++; g.jackpot += C.JP_STEP; g.cool[side] = C.COOLDOWN;
      const mx = Math.min(C.W - C.R, Math.max(C.R, g.aim[side] + (rand() - 0.5) * C.DROP_JITTER));
      const from = shotPosition(side), target = g.aimTarget(side);
      const shot = { id: nextId++, side, kind:inputKind(g.stats.inserted), x0: from.x, y0: from.y, x: mx, y: target.y + (rand() - 0.5) * 10, t0: g.t, t1: g.t + C.SHOT_TIME };
      g.shots.push(shot);
      g.events.push({ type: 'drop', side, x: mx, y: shot.y, t: g.t });
      return true;
    };

    function awardMedals(amount, source, special = null) {
      amount = Math.max(0, Math.floor(amount));
      g.feed += amount; g.stats.awarded += amount;
      g.lastAward = {id:++g.awardSerial, amount, source, special, t:g.t}; g.awards.push(g.lastAward); if(g.awards.length>24)g.awards.shift();
      g.events.push({type:'award', amount, source, t:g.t});
    }
    function announce(source,text,special=null){
      const notice={id:++g.awardSerial,amount:0,source,text,special,t:g.t};g.awards.push(notice);if(g.awards.length>24)g.awards.shift();
    }
    function chargeJackpot(source,special){
      const added=5*C.JP_STEP;g.jackpot+=added;announce(source,`JP＋${added}`,special);return added;
    }
    function collectSpecial(kind) {
      if (kind === 'blue') {
        g.stats.specialBlue++; awardMedals(10 * C.PRIZE_SCALE, '青メダル', kind);
      } else if (kind === 'purple' || kind === 'rainbow') {
        if (kind === 'purple') { g.stats.specialPurple++; g.superQueue++; }
        else { g.stats.specialRainbow++; g.feverLeft += 3; }
        announce(kind==='purple'?'紫メダル':'虹メダル',kind==='purple'?'上位抽選へ':'３回当たり確定',kind);
      } else return;
      g.events.push({type:'special_collect',kind,t:g.t});
    }
    function jackpotWin(source) {
      const value = g.jackpot; g.jackpot = C.JP_BASE;
      g.stats.jackpots++; g.stats.jackpotMedals += value;
      g.events.push({type:'jackpot', value, source, t:g.t});
      return value;
    }
    function returnBall(source, duration = C.BALL_RETURN_TIME) {
      // 下段の途中へ、右側の専用レーンを通して戻す。台の上にはまだ存在しない。
      g.ballReturns.push({id:nextId++, ballKind:nextBallKind(), x:C.BALL_RETURN_MARGIN + rand() * (C.W - C.BALL_RETURN_MARGIN * 2), y:C.D * 0.50, t0:g.t, t1:g.t + duration, source});
    }
    function startSlot() {
      g.stock--; g.stats.slot++;
      let u = rand(), hit = null;
      if (g.feverLeft > 0) {
        g.feverLeft--; hit = C.SLOT_TABLE.find(row => row.sym === '★') || null;
      } else for (const row of C.SLOT_TABLE) { if (u < row.p) { hit = row; break; } u -= row.p; }
      let result;
      if (hit) result = [hit.sym, hit.sym, hit.sym];
      else {
        const S = C.SYMBOLS, a = S[(rand() * S.length) | 0];
        let c; do { c = S[(rand() * S.length) | 0]; } while (c === a);
        result = rand() < 0.35 ? [a, a, c] : [a, S[(rand() * S.length) | 0], c];
      }
      g.slot = { t0:g.t, t1:g.t + C.SLOT_TIME, result, hit };
      g.events.push({type:'slot_start', result, t:g.t});
    }
    function endSlot() {
      const {hit, result} = g.slot; g.slot = null;
      let label = hit ? hit.label : 'ハズレ';
      if (hit) {
        g.stats.slotWin++; g.chain++; g.stats.bestChain = Math.max(g.stats.bestChain, g.chain);
        if (hit.prize.medal) { awardMedals(hit.prize.medal, 'スロット'); g.stats.slotMedals += hit.prize.medal; }
        if (hit.prize.super) g.superQueue++;
        if (hit.sym === '★') {
          g.stars++;
          if (g.stars >= 3) { g.stars = 0; g.superQueue++; }
        }
        if (g.chain >= 2) {
          const bonus = Math.min(5, g.chain - 1) * 5 * C.PRIZE_SCALE;
          awardMedals(bonus, `${g.chain}連チャン`); g.stats.chainBonus += bonus;
        }
        if (hit.prize.fever) { g.feverLeft += 3; g.events.push({type:'fever', t:g.t}); }
        if (hit.prize.ball) {
          if (countBalls() < C.BALL_MAX) returnBall('スロット');
          else { const fallback=10*C.PRIZE_SCALE; awardMedals(fallback,'ボール満杯ボーナス'); label=`●●● → ボール満杯につき${fallback}枚`; }
        }
      } else g.chain = 0;
      g.events.push({type:'slot_result', result, win:!!hit, prize:hit ? hit.prize : null, label, t:g.t});
    }
    function startSuper() {
      g.superQueue--; g.stats.superSpins++;
      let u=rand(), index=C.SUPER_TABLE.length-1;
      for(let i=0;i<C.SUPER_TABLE.length;i++){ if(u<C.SUPER_TABLE[i].p){index=i;break;}u-=C.SUPER_TABLE[i].p; }
      const value=C.SUPER_TABLE[index].value;
      g.superSlot={t0:g.t,t1:g.t+C.SUPER_TIME,index,value};
      g.events.push({type:'super_start',t:g.t});
    }
    function endSuper() {
      const raw=g.superSlot.value, index=g.superSlot.index; g.superSlot=null;
      const value=raw==='JP' ? jackpotWin('上位スロット') : raw;
      const charge=value===0?chargeJackpot('上位スロット',null):0;
      if(value>0)awardMedals(value,raw==='JP' ? 'JACKPOT' : '上位スロット');
      g.events.push({type:'super_result',value,index,charge,jackpot:raw==='JP',t:g.t});
    }
    function startRoulette() {
      g.ballQueue--;
      const requested=g.ballTickets.shift()?.ballKind||'red',ballKind=BALL_TYPES[requested]?requested:'red', values=g.rouletteValues(ballKind), weights=rouletteWeights(ballKind,values.length);
      let u=rand()*weights.reduce((a,b)=>a+b,0),index=weights.length-1;
      for(let i=0;i<weights.length;i++){if(u<weights[i]){index=i;break;}u-=weights[i];}
      g.roulette={t0:g.t,t1:g.t+C.ROULETTE_TIME,index,value:values[index],values,ballKind};
      g.events.push({type:'roulette_start',index,value:values[index],values,ballKind,t:g.t});
    }
    function endRoulette() {
      const {value:raw,index,ballKind}=g.roulette;g.roulette=null;
      const value=raw==='JP'?jackpotWin('ボールルーレット'):raw,source=BALL_TYPES[ballKind].label+'ボール';
      const charge=value===0?chargeJackpot(source,ballKind):0;
      if(value>0)awardMedals(value,raw==='JP'?'JACKPOT':source,ballKind==='red'?null:ballKind);
      g.stats.rouletteMedals+=value;
      if(ballKind==='purple'){g.superQueue++;announce('紫ボール','上位抽選へ','purple');}
      if(countBalls()<C.BALL_MAX)returnBall('ルーレット');
      g.events.push({type:'roulette_result',value,index,ballKind,charge,jackpot:raw==='JP',t:g.t});
    }
    // 抽選待ちは入賞券として扱う。物理的な在庫は台上＋返却レーンだけで数える。
    const countBalls = () => g.medals.filter(m=>m.ball).length + g.ballReturns.length;
    function refillBalls() {
      const minimum = Math.min(C.BALL_MIN, C.BALLS, C.BALL_MAX);
      // 1個落ちた時点で4個へ戻す準備を始め、連続落下で台が寂しくなるのを防ぐ。
      if (g.medals.filter(m=>m.ball).length < minimum) {
        while (countBalls() < Math.min(C.BALLS, C.BALL_MAX)) {
          returnBall('自動補充', C.BALL_REFILL_TIME); g.stats.ballAutoSupplied++;
        }
        for (const b of g.ballReturns) b.t1 = Math.min(b.t1, g.t + C.BALL_REFILL_TIME);
      }
    }

    // 同じ段のメダル同士だけ衝突させる（上下に重なっていても接触しない）。
    function settle(ms, pf) {
      const cell = 2 * C.BALL_R;
      for (let it = 0; it < C.ITER; it++) {
        // 押し出し台と壁
        for (const m of ms) {
          if (m.y - m.r < pf) m.y = pf + m.r;
          if (m.x < m.r) m.x = m.r; else if (m.x > C.W - m.r) m.x = C.W - m.r;
        }
        // 重なりを直す（升目で近いものだけ調べる）
        const grid = new Map();
        for (let i = 0; i < ms.length; i++) {
          const k = ((ms[i].x / cell) | 0) * 1000 + ((ms[i].y / cell) | 0);
          let a = grid.get(k); if (!a) grid.set(k, (a = [])); a.push(i);
        }
        for (let i = 0; i < ms.length; i++) {
          const a = ms[i], gx = (a.x / cell) | 0, gy = (a.y / cell) | 0;
          for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
            const list = grid.get((gx + dx) * 1000 + gy + dy); if (!list) continue;
            for (const j of list) {
              if (j <= i) continue;
              const b = ms[j], rr = a.r + b.r; let ex = b.x - a.x, ey = b.y - a.y; const d2 = ex * ex + ey * ey;
              if (d2 >= rr * rr || d2 === 0) continue;
              const d = Math.sqrt(d2), o = rr - d; ex /= d; ey /= d;
              // 押し出し台に当たっている方は動かさない。重いボールはあまり動かない
              const aw = a.y - a.r <= pf + 0.5, bw = b.y - b.r <= pf + 0.5;
              let ia = aw ? 0 : 1 / (a.ball ? C.BALL_WEIGHT : 1), ib = bw ? 0 : 1 / (b.ball ? C.BALL_WEIGHT : 1);
              if (ia + ib === 0) { ia = ib = 1; }
              const ka = ia / (ia + ib), kb = ib / (ia + ib);
              a.x -= ex * o * ka; a.y -= ey * o * ka; b.x += ex * o * kb; b.y += ey * o * kb;
            }
          }
        }
      }
    }

    // 1コマ進める
    g.step = function () {
      if (g.paused || g.status === 'over') return;
      const prevFront = pusherFront(g.t);
      g.t += C.DT; g.frame++;
      g.cool[0] = Math.max(0, g.cool[0] - C.DT); g.cool[1] = Math.max(0, g.cool[1] - C.DT);
      // 当たりのメダルを少しずつ台に出す
      if (g.feed > 0 && g.frame % C.FEED_EVERY === 0) {
        g.feed--;
        g.prizeFlights.push({id:nextId++,x0:C.W*(0.30+rand()*0.40),y0:14,x:C.W*(0.12+rand()*0.76),y:C.UPPER_BACK+C.R+18,t0:g.t,t1:g.t+C.PRIZE_FLIGHT_TIME});
      }
      for(let i=g.prizeFlights.length-1;i>=0;i--){
        const m=g.prizeFlights[i];
        if(g.t>=m.t1){g.prizeFlights.splice(i,1);addUpper(m.x,m.y,m.id);g.stats.fed++;}
      }
      for(let i=g.ballReturns.length-1;i>=0;i--){
        const b=g.ballReturns[i];
        if(g.t>=b.t1){g.ballReturns.splice(i,1);g.medals.push({id:b.id,x:b.x,y:b.y,py:b.y,r:C.BALL_R,ball:true,passed:false,ballKind:b.ballKind});g.stats.ballReturned++;g.events.push({type:'ball_return',x:b.x,y:b.y,t:g.t});}
      }

      const pf = pusherFront(g.t);
      // 発射→上段に着地。着地までは下段に存在しない。
      for (let i = g.shots.length - 1; i >= 0; i--) {
        const shot = g.shots[i];
        if (g.t >= shot.t1) {
          g.shots.splice(i, 1); addUpper(shot.x, shot.y, shot.id, shot.kind); g.stats.landed++;
          g.events.push({ type: 'land', id: shot.id, x: shot.x, y: shot.y, t: g.t });
        }
      }
      // 上段は台に運ばれる。奥の固定壁でメダルをせき止め、縁から下段へ落とす。
      for (const m of g.upper) m.y += (pf - prevFront) * 0.8;
      settle(g.upper, C.UPPER_BACK);
      for (let i = g.upper.length - 1; i >= 0; i--) {
        const m = g.upper[i];
        if (m.y > pf - m.r * 0.2) {
          g.upper.splice(i, 1); g.stats.upperFalls++;
          g.falling.push({ id:m.id, kind:m.kind, x:m.x, y0:pf - 3, t0:g.t, t1:g.t + C.FALL_TIME });
          g.events.push({ type:'upper_fall', id:m.id, x:m.x, y:pf, t:g.t });
        }
      }
      for (let i = g.falling.length - 1; i >= 0; i--) {
        const fall = g.falling[i];
        if (g.t >= fall.t1) {
          g.falling.splice(i, 1);
          g.medals.push({ id:fall.id, kind:fall.kind, x:fall.x, y:pf + C.STEP_HEIGHT + C.R + 2, py:pf + C.STEP_HEIGHT + C.R + 2, r:C.R, ball:false, passed:false });
          g.events.push({ type:'lower_land', id:fall.id, x:fall.x, y:pf + C.STEP_HEIGHT + C.R + 2, t:g.t });
        }
      }
      const ms = g.medals;
      for (const m of ms) { m.py = m.y; m.px = m.x; }
      settle(ms, pf + C.STEP_HEIGHT);
      // CHANCE ゲートの通過と、手前のふちから落ちる
      for (let i = ms.length - 1; i >= 0; i--) {
        const m = ms[i];
        if (m.ball && !m.passed && m.py < C.CHANCE_Y && m.y >= C.CHANCE_Y) {
          // その1コマのうち、ボールが判定線を横切った瞬間の位置で判定する。
          // 成功したボールは同じ周回で1回だけ。左右どちらを通ったかも記録する。
          const part = (C.CHANCE_Y - m.py) / (m.y - m.py);
          const crossX = m.px + (m.x - m.px) * part;
          const gate = C.CHANCE_X.findIndex(x => Math.abs(crossX - x) <= C.CHANCE_W / 2);
          if (gate >= 0) {
            m.passed = true; g.stats.chance++; g.stats[gate === 0 ? 'chanceLeft' : 'chanceRight']++;
            if (g.stock < C.STOCK_MAX) { g.stock++; g.events.push({ type: 'chance', gate, id: m.id, x: crossX, y: C.CHANCE_Y, queued: !!g.slot || g.stock > 1, t: g.t }); }
            else { g.stats.chanceOver++; g.events.push({ type: 'chance_over', gate, id: m.id, x: crossX, y: C.CHANCE_Y, t: g.t }); }
          }
        }
        if (m.y > C.D) {
          ms.splice(i, 1);
          if (m.ball) { g.stats.ballOut++; g.ballQueue++; g.ballTickets.push({ballKind:m.ballKind||'red'}); g.events.push({ type: 'ball', ballKind:m.ballKind||'red', x: m.x, t: g.t }); }
          else if (m.x > C.GUTTER && m.x < C.W - C.GUTTER) { g.credit++; g.stats.paid++; g.events.push({ type: 'pay', x: m.x, t: g.t }); if(!initializing)collectSpecial(m.kind); }
          else { g.stats.lost++; g.events.push({ type: 'lost', x: m.x, t: g.t }); }
        }
      }
      if (!initializing) refillBalls();
      // 抽選
      if (!initializing && g.slot && g.t >= g.slot.t1) endSlot();
      if (!initializing && !g.slot && (g.stock > 0 || g.feverLeft > 0)) { if(!g.stock)g.stock=1; startSlot(); }
      if (!initializing && g.roulette && g.t >= g.roulette.t1) endRoulette();
      if (!initializing && !g.roulette && g.ballQueue > 0) startRoulette();
      if(!initializing && g.superSlot && g.t>=g.superSlot.t1) endSuper();
      if(!initializing && !g.superSlot && g.superQueue>0) startSuper();
      if (!initializing) updateRound();
      if (g.events.length > 300) g.events.splice(0, g.events.length - 300);
    };

    g.advance = function (sec) { const n = Math.round(sec / C.DT); for (let i = 0; i < n; i++) g.step(); };

    // 台を満杯にしてから始める（本物の台と同じ状態。ここまでの記録は0に戻す）
    for (let i = 0; i < C.WARMUP; i++) {
      add(randX(C.R), backY(C.R));
      for (let k = 0; k < 18; k++) g.step();
    }
    // ウォームアップ中に落ちたボールは戻しておく
    g.ballQueue=0; g.ballTickets=[]; g.roulette=null; g.ballReturns=[];
    while (countBalls() < C.BALLS) add(randX(C.BALL_R), backY(C.BALL_R), true);
    g.t = 0; g.frame = 0; g.credit = C.START_CREDIT; g.events = []; g.cool = [0, 0];
    g.stock = 0; g.slot = null; g.ballQueue = 0; g.roulette = null; g.feed = 0; g.prizeFlights=[]; g.superSlot=null; g.superQueue=0; g.feverLeft=0; g.chain=0;g.stars=0;
    // 上段も最初からメダルを配置。初期姿勢を最小位置へ戻してから整える。
    g.upper = []; g.shots = []; g.falling = [];
    const cols = 12;
    for (let i = 0; i < C.UPPER_START; i++) {
      const row = Math.floor(i / cols), col = i % cols;
      addUpper(40 + col * 30 + (row % 2 ? 6 : 0), C.UPPER_BACK + C.R + 8 + row * 25);
    }
    g.stats = newStats();
    for (let k = 0; k < 6; k++) g.step();
    g.medals.filter(m=>m.ball).sort((a,b)=>a.x-b.x).forEach((m,i)=>{m.ballKind=Object.keys(BALL_TYPES)[i%4];});
    if (C.SPECIAL_INITIAL > 0) {
      const candidates = g.medals.filter(m=>!m.ball && m.x>C.GUTTER+15 && m.x<C.W-C.GUTTER-15 && m.y>C.D*0.58).sort((a,b)=>b.y-a.y);
      const kinds = ['blue','blue','purple','blue','purple','rainbow','blue','purple','blue','blue'];
      const n = Math.min(C.SPECIAL_INITIAL, candidates.length);
      for(let i=0;i<n;i++) candidates[Math.floor((i+0.5)*candidates.length/n)].kind=kinds[i%kinds.length];
      for(const [i,kind] of [[6,'blue'],[23,'purple'],[39,'blue']]) if(g.upper[i])g.upper[i].kind=kind;
    }
    initializing = false;

    // AI に渡す「いまの様子」
    g.state = function () {
      const near = (x0, x1) => g.medals.filter((m) => !m.ball && m.x >= x0 && m.x < x1 && m.y > C.D - 60).length;
      return {
        time: +g.t.toFixed(2), paused: g.paused, credit: g.credit, status: g.status,
        drainRemaining: g.status === 'draining' ? +g.drainRemaining().toFixed(2) : null, pending: pending(),
        mode:C.MODE,jackpot:g.jackpot,chain:g.chain,feverLeft:g.feverLeft,stars:g.stars,superSpinning:!!g.superSlot,superQueue:g.superQueue,prizesInFlight:g.prizeFlights.length,ballReturns:g.ballReturns.length,feed:g.feed,
        onField: g.medals.length + g.upper.length,
        upperCount: g.upper.length, lowerCount: g.medals.length, inFlight: g.shots.length, betweenDecks: g.falling.length,
        upperMedals: g.upper.map(m => ({x:+m.x.toFixed(1), y:+m.y.toFixed(1),kind:m.kind||'gold'})),
        specialMedals:g.medals.filter(m=>!m.ball && m.kind && m.kind!=='gold').map(m=>({x:+m.x.toFixed(1),y:+m.y.toFixed(1),kind:m.kind})),
        nextSpecialIn:C.SPECIAL_EVERY>0 ? C.SPECIAL_EVERY-(g.stats.inserted%C.SPECIAL_EVERY) : null,
        aim: g.aim.slice(), aimRange: C.AIM_RANGE.map((r) => r.slice()), cooldown: g.cool.map((c) => +c.toFixed(2)),
        pusherFront: +pusherFront(g.t).toFixed(1), pusherPhase: +((g.t % C.PUSH_T) / C.PUSH_T).toFixed(3),
        chance: { x: chanceX(), y: C.CHANCE_Y, width: C.CHANCE_W, target:'ball', moving:false, gates:g.chanceGates() },
        ballsOnField:g.medals.filter(m=>m.ball).length, ballStock:countBalls(),
        stock: g.stock, slotSpinning: !!g.slot, rouletteSpinning: !!g.roulette,
        balls: g.medals.filter((m) => m.ball).map((m) => ({ x: +m.x.toFixed(1), y: +m.y.toFixed(1), ballKind:m.ballKind||'red' })),
        nearEdge: { left: near(0, C.W / 3), center: near(C.W / 3, 2 * C.W / 3), right: near(2 * C.W / 3, C.W) },
        stats: Object.assign({}, g.stats),
      };
    };
    return g;
  }

  const api = { create, CFG, MODES, BALL_TYPES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.PusherCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
