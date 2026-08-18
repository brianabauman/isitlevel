/* The Better Eye - shell (Agent A)
   Owns: screens, seeding, scoring, scoreboard, transitions.
   Consumes challenges only through window.CHALLENGES + {getScore, reveal, destroy}. */
(function () {
  'use strict';

  var ROUND_COUNT = 6;
  var DIFFICULTY_BY_ROUND = [1, 1, 2, 2, 3, 3];
  var REVEAL_MS = 1800;
  var ENTER_MS = 420;
  // Speed multiplies accuracy points, so a fast wild guess still loses to a
  // careful eye; it only separates players whose accuracy ties.
  var SPEED_MAX_RATE = 0.30;
  var SPEED_GRACE_MS = 0;
  var SPEED_ZERO_MS = 30000;

  var JUDGMENTS = [
    { min: 960, text: 'Surgical.' },
    { min: 880, text: 'Laser eye.' },
    { min: 780, text: 'Genuinely sharp.' },
    { min: 640, text: 'Respectable.' },
    { min: 480, text: 'Close enough for a hallway.' },
    { min: 320, text: 'You eyeballed it, didn\'t you.' },
    { min: 150, text: 'Rough. Very rough.' },
    { min: 0, text: 'Were your eyes open?' }
  ];

  /* ---------------------------------------------------------------- utils */

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function add(parent) {
    for (var i = 1; i < arguments.length; i++) {
      if (arguments[i]) parent.appendChild(arguments[i]);
    }
    return parent;
  }

  function mulberry32(seed) {
    var a = seed | 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Distinct scene per (round, player) so watching an opponent's reveal teaches nothing.
  function seedFor(gameSeed, roundIndex, playerIndex) {
    var h = gameSeed | 0;
    h = Math.imul(h ^ (roundIndex + 0x1f), 0x9e3779b1);
    h = Math.imul(h ^ (playerIndex + 0x5b), 0x85ebca77);
    h ^= h >>> 13;
    return h | 0;
  }

  function newGameSeed() {
    return (Math.floor(Math.random() * 0xffffffff) ^ (Date.now() & 0xffffffff)) | 0;
  }

  function shuffle(list, rng) {
    for (var i = list.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var tmp = list[i];
      list[i] = list[j];
      list[j] = tmp;
    }
    return list;
  }

  function pointsFor(error, maxError) {
    var max = (typeof maxError === 'number' && isFinite(maxError) && maxError > 0) ? maxError : 1;
    var err = (typeof error === 'number' && isFinite(error) && error >= 0) ? error : max;
    var accuracy = 1 - Math.min(err / max, 1);
    return Math.round(1000 * Math.pow(accuracy, 1.6));
  }

  function speedRateFor(elapsedMs) {
    if (typeof elapsedMs !== 'number' || !isFinite(elapsedMs) || elapsedMs < 0) return 0;
    var t = (elapsedMs - SPEED_GRACE_MS) / (SPEED_ZERO_MS - SPEED_GRACE_MS);
    return SPEED_MAX_RATE * Math.max(0, Math.min(1, 1 - t));
  }

  function formatError(error, unit) {
    var abs = Math.abs(error);
    var value = abs.toFixed(abs < 0.1 ? 2 : 1);
    var u = typeof unit === 'string' ? unit.trim() : '';
    if (!u) return 'off by ' + value;
    return 'off by ' + value + (/^[a-z0-9]/i.test(u) ? ' ' : '') + u;
  }

  function judgmentFor(points) {
    for (var i = 0; i < JUDGMENTS.length; i++) {
      if (points >= JUDGMENTS[i].min) return JUDGMENTS[i].text;
    }
    return JUDGMENTS[JUDGMENTS.length - 1].text;
  }

  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  /* ------------------------------------------------------- screen manager */

  var app = null;
  var currentScreen = null;
  var generation = 0;
  var primaryAction = null;
  var timers = [];

  function later(fn, ms) {
    var gen = generation;
    var id = setTimeout(function () {
      if (gen !== generation) return;
      fn();
    }, ms);
    timers.push(id);
    return id;
  }

  function clearTimers() {
    for (var i = 0; i < timers.length; i++) clearTimeout(timers[i]);
    timers = [];
  }

  function showScreen(node, onSettled) {
    generation++;
    clearTimers();
    primaryAction = null;

    var stale = app.querySelectorAll('.screen.is-leaving');
    for (var i = 0; i < stale.length; i++) {
      if (stale[i].parentNode) stale[i].parentNode.removeChild(stale[i]);
    }

    var previous = currentScreen;
    node.classList.add('screen');
    app.appendChild(node);
    currentScreen = node;

    if (previous) {
      previous.classList.add('is-leaving');
      var doomed = previous;
      setTimeout(function () {
        if (doomed.parentNode) doomed.parentNode.removeChild(doomed);
      }, 320);
    }

    if (onSettled) later(onSettled, ENTER_MS);
    return node;
  }

  function setPrimary(fn) {
    primaryAction = fn;
  }

  function firePrimary() {
    var action = primaryAction;
    primaryAction = null;
    if (action) action();
  }

  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Enter' || event.repeat) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    var tag = event.target && event.target.tagName;
    // Buttons already turn Enter into a click; don't run the action twice.
    if (tag === 'BUTTON' || tag === 'A' || tag === 'TEXTAREA') return;
    if (!primaryAction) return;
    event.preventDefault();
    firePrimary();
  });

  function countUp(node, target, duration) {
    var gen = generation;
    var start = null;
    function step(now) {
      if (gen !== generation) return;
      if (start === null) start = now;
      var t = Math.min(1, (now - start) / duration);
      node.textContent = String(Math.round(target * easeOutCubic(t)));
      if (t < 1) requestAnimationFrame(step);
      else node.textContent = String(target);
    }
    node.textContent = '0';
    requestAnimationFrame(step);
  }

  /* -------------------------------------------------------- game state */

  var state = null;

  function availableChallenges() {
    var list = window.CHALLENGES;
    if (!list || typeof list.length !== 'number') return [];
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var def = list[i];
      if (def && typeof def.create === 'function') out.push(def);
    }
    return out;
  }

  // Every challenge at least once; remaining slots are random repeats; order shuffled.
  function buildPlan(gameSeed, defs) {
    var rng = mulberry32(Math.imul(gameSeed ^ 0x2c1b3c6d, 0x27d4eb2f));
    var picks = shuffle(defs.slice(), rng).slice(0, ROUND_COUNT);
    while (picks.length < ROUND_COUNT) {
      picks.push(defs[Math.floor(rng() * defs.length)]);
    }
    shuffle(picks, rng);
    return picks.map(function (def, index) {
      return { def: def, difficulty: DIFFICULTY_BY_ROUND[index] || 3 };
    });
  }

  function newGame(names) {
    var defs = availableChallenges();
    var seed = newGameSeed();
    return {
      seed: seed,
      defs: defs,
      plan: buildPlan(seed, defs),
      players: [
        { name: names[0], total: 0, wins: 0, streak: 0 },
        { name: names[1], total: 0, wins: 0, streak: 0 }
      ],
      roundIndex: 0,
      turn: 0,
      turnScores: [null, null],
      log: []
    };
  }

  function playerNames() {
    if (!state) return ['Player 1', 'Player 2'];
    return [state.players[0].name, state.players[1].name];
  }

  /* ------------------------------------------------------- shared pieces */

  function difficultyPips(level) {
    var wrap = el('span', 'pips pips--difficulty');
    wrap.setAttribute('aria-label', 'Difficulty ' + level + ' of 3');
    for (var i = 1; i <= 3; i++) {
      add(wrap, el('i', 'pip' + (i <= level ? ' is-on' : '')));
    }
    return wrap;
  }

  function hud(activePlayer) {
    var bar = el('header', 'hud');

    for (var side = 0; side < 2; side++) {
      var p = state.players[side];
      var box = el('div', 'hud__player hud__player--p' + (side + 1) +
        (activePlayer === side ? ' is-active' : ''));
      add(box,
        el('span', 'hud__name', p.name),
        el('span', 'hud__total', p.total),
        el('span', 'hud__wins', p.wins === 1 ? '1 round won' : p.wins + ' rounds won'));
      if (p.streak > 1) add(box, el('span', 'hud__streak', 'streak x' + p.streak));
      if (side === 0) add(bar, box);
      else {
        var center = el('div', 'hud__center');
        add(center, el('div', 'hud__round', 'Round ' + Math.min(state.roundIndex + 1, ROUND_COUNT) + ' of ' + ROUND_COUNT));
        var pips = el('div', 'pips pips--rounds');
        for (var r = 0; r < ROUND_COUNT; r++) {
          var done = state.log[r];
          var cls = 'pip';
          if (done) cls += done.winner === 0 ? ' is-p1' : (done.winner === 1 ? ' is-p2' : ' is-draw');
          else if (r === state.roundIndex) cls += ' is-current';
          add(pips, el('i', cls));
        }
        add(center, pips);
        add(bar, center, box);
      }
    }
    return bar;
  }

  function button(label, kind, onClick) {
    var b = el('button', 'btn ' + (kind || 'btn--primary'), label);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }

  function screenShell(modifier, activePlayer) {
    var screen = el('section', 'screen--' + modifier);
    if (state) add(screen, hud(activePlayer));
    return screen;
  }

  /* ---------------------------------------------------------- 1. title */

  function renderTitle(prefillNames) {
    var names = prefillNames || ['Player 1', 'Player 2'];
    var screen = el('section', 'screen--title');
    var card = el('div', 'title-card');

    add(card,
      el('p', 'eyebrow', 'a living-room duel'),
      el('h1', 'game-title', 'The Better Eye'),
      el('p', 'tagline', 'Six rounds of hanging, centring and levelling. Only one of you should be trusted with a hammer.'));

    var row = el('div', 'name-row');
    var inputs = [];
    for (var i = 0; i < 2; i++) {
      var field = el('label', 'name-field name-field--p' + (i + 1));
      add(field, el('span', 'name-field__label', i === 0 ? 'Player one' : 'Player two'));
      var input = el('input', 'name-input');
      input.type = 'text';
      input.value = names[i];
      input.maxLength = 14;
      input.spellcheck = false;
      input.setAttribute('autocomplete', 'off');
      input.addEventListener('focus', function () { this.select(); });
      add(field, input);
      inputs.push(input);
      add(row, field);
      if (i === 0) add(row, el('span', 'vs', 'vs'));
    }
    add(card, row);

    function start() {
      var chosen = [
        (inputs[0].value || '').trim() || 'Player 1',
        (inputs[1].value || '').trim() || 'Player 2'
      ];
      if (chosen[0].toLowerCase() === chosen[1].toLowerCase()) chosen[1] = chosen[1] + ' (2)';
      state = newGame(chosen);
      renderHandoff();
    }

    add(card,
      button('Start the duel', 'btn--primary btn--large', start),
      el('p', 'hint', 'Enter starts · arrow keys nudge inside a challenge · Enter locks your answer'));

    add(screen, card, ambientGlow());
    showScreen(screen, function () { inputs[0].focus(); });
    setPrimary(start);
  }

  function ambientGlow() {
    var glow = el('div', 'ambient');
    add(glow, el('i', 'ambient__orb ambient__orb--a'), el('i', 'ambient__orb ambient__orb--b'));
    return glow;
  }

  /* -------------------------------------------------------- 2. handoff */

  function renderHandoff() {
    var round = state.plan[state.roundIndex];
    var playerIndex = state.turn;
    var me = state.players[playerIndex];
    var other = state.players[1 - playerIndex];

    var screen = screenShell('handoff', playerIndex);
    var card = el('div', 'card card--handoff card--p' + (playerIndex + 1));

    add(card,
      el('p', 'eyebrow', 'Round ' + (state.roundIndex + 1) + ' · ' +
        (playerIndex === 0 ? 'first up' : 'second up')),
      el('h2', 'handoff__title', 'Pass the laptop'),
      el('p', 'handoff__lead', me.name + ', you\'re up.'),
      el('p', 'handoff__warn', other.name + ', look away!'));

    var brief = el('div', 'brief');
    var briefHead = el('div', 'brief__head');
    add(briefHead, el('h3', 'brief__title', round.def.title || 'Challenge'), difficultyPips(round.difficulty));
    add(brief, briefHead, el('p', 'brief__instruction', round.def.instruction || ''));
    add(card, brief);

    function go() { renderPlay(); }

    add(card,
      button('I’m ready', 'btn--primary btn--large', go),
      el('p', 'hint', 'Press Enter when the coast is clear'));

    add(screen, card);
    showScreen(screen);
    setPrimary(go);
  }

  /* ----------------------------------------------------------- 3. play */

  function renderPlay() {
    var round = state.plan[state.roundIndex];
    var playerIndex = state.turn;
    var me = state.players[playerIndex];

    var screen = screenShell('play', playerIndex);

    var bar = el('div', 'instruction');
    var left = el('div', 'instruction__text');
    add(left,
      el('h3', 'instruction__title', round.def.title || 'Challenge'),
      el('p', 'instruction__body', round.def.instruction || ''));
    var right = el('div', 'instruction__meta');
    add(right, el('span', 'instruction__turn', me.name + '’s turn'), difficultyPips(round.difficulty));
    add(bar, left, right);

    var wrap = el('div', 'stage-wrap');
    var frame = el('div', 'stage-frame');
    var stage = el('div', 'challenge-stage');
    add(frame, stage);
    add(wrap, frame);

    var footer = el('div', 'playbar');
    var hint = el('p', 'hint playbar__hint', 'Setting the scene…');
    var clock = el('div', 'speedclock');
    var clockTime = el('span', 'speedclock__time', '0.0s');
    var clockTrack = el('i', 'speedclock__track');
    var clockFill = el('i', 'speedclock__fill');
    var clockRate = el('span', 'speedclock__rate', '+' + Math.round(SPEED_MAX_RATE * 100) + '% bonus');
    add(clockTrack, clockFill);
    add(clock, clockTime, clockTrack, clockRate);
    var lockBtn = button('Lock it in', 'btn--primary btn--large', function () { lock(); });
    lockBtn.disabled = true;
    add(footer, hint, clock, lockBtn);

    add(screen, bar, wrap, footer);

    var instance = null;
    var ready = false;
    var locked = false;
    var overlayShown = false;
    var clockStart = 0;

    function tickClock(clockGen) {
      if (locked || clockGen !== generation) return;
      var elapsed = performance.now() - clockStart;
      var rate = speedRateFor(elapsed);
      var pct = Math.round(rate * 100);
      clockTime.textContent = (elapsed / 1000).toFixed(1) + 's';
      clockRate.textContent = pct > 0 ? '+' + pct + '% bonus' : 'bonus gone';
      clockFill.style.width = ((rate / SPEED_MAX_RATE) * 100).toFixed(1) + '%';
      clock.classList.toggle('is-empty', rate === 0);
      clock.classList.toggle('is-low', rate > 0 && rate < SPEED_MAX_RATE * 0.34);
      requestAnimationFrame(function () { tickClock(clockGen); });
    }

    function buildInstance() {
      var rng = mulberry32(seedFor(state.seed, state.roundIndex, playerIndex));
      try {
        instance = round.def.create(stage, rng, round.difficulty);
      } catch (err) {
        instance = null;
      }
      if (!instance || typeof instance !== 'object') {
        instance = null;
        stage.textContent = '';
        // Owned by the shell, so it lives on the frame - never inside .challenge-stage.
        add(frame, el('div', 'stage-error', 'This challenge failed to load. Lock in to move on.'));
      }
      ready = true;
      lockBtn.disabled = false;
      hint.textContent = 'Drag it, or nudge with ← → (Shift for coarse)';
      screen.classList.add('is-live');
      clockStart = performance.now();
      clock.classList.add('is-running');
      tickClock(generation);
      setPrimary(function () { lock(); });
    }

    function readScore() {
      var fallback = { error: 1, unit: '', maxError: 1 };
      if (!instance || typeof instance.getScore !== 'function') return fallback;
      var raw;
      try { raw = instance.getScore(); } catch (err) { return fallback; }
      if (!raw || typeof raw !== 'object') return fallback;
      var maxError = (typeof raw.maxError === 'number' && isFinite(raw.maxError) && raw.maxError > 0)
        ? raw.maxError : 1;
      var error = (typeof raw.error === 'number' && isFinite(raw.error) && raw.error >= 0)
        ? raw.error : maxError;
      return { error: error, unit: typeof raw.unit === 'string' ? raw.unit : '', maxError: maxError };
    }

    function teardown() {
      if (instance && typeof instance.destroy === 'function') {
        try { instance.destroy(); } catch (err) { /* a broken challenge must not strand the game */ }
      }
      instance = null;
      stage.textContent = '';
    }

    function lock() {
      if (locked || !ready) return;
      locked = true;
      lockBtn.disabled = true;
      lockBtn.textContent = 'Locked';
      hint.textContent = 'Truth incoming…';
      screen.classList.add('is-revealing');

      var elapsedMs = clockStart > 0 ? performance.now() - clockStart : Infinity;
      var measured = readScore();
      var points = pointsFor(measured.error, measured.maxError);
      var speedBonus = Math.round(points * speedRateFor(elapsedMs));
      clock.classList.add('is-locked');

      if (instance && typeof instance.reveal === 'function') {
        try { instance.reveal(); } catch (err) { /* score already taken; reveal is cosmetic */ }
      }

      var result = {
        points: points,
        speedBonus: speedBonus,
        earned: points + speedBonus,
        elapsedMs: elapsedMs,
        error: measured.error,
        unit: measured.unit,
        maxError: measured.maxError
      };

      later(function () { openOverlay(result); }, REVEAL_MS);
      setPrimary(function () { openOverlay(result); });
    }

    function openOverlay(result) {
      if (overlayShown) return;
      overlayShown = true;

      state.turnScores[playerIndex] = result;
      me.total += result.earned;

      var totalNode = screen.querySelector('.hud__player--p' + (playerIndex + 1) + ' .hud__total');
      if (totalNode) {
        totalNode.textContent = String(me.total);
        totalNode.classList.add('is-bumped');
      }

      add(screen, buildScoreOverlay(result, playerIndex, function () {
        teardown();
        advanceTurn();
      }));
    }

    showScreen(screen, buildInstance);
  }

  /* -------------------------------------------------- 4. score overlay */

  function buildScoreOverlay(result, playerIndex, onContinue) {
    var me = state.players[playerIndex];
    var overlay = el('div', 'overlay overlay--p' + (playerIndex + 1));
    var card = el('div', 'overlay__card');

    add(card, el('p', 'overlay__who', me.name));

    var scoreLine = el('div', 'overlay__score');
    var number = el('span', 'overlay__number', '0');
    add(scoreLine, number, el('span', 'overlay__unit', 'pts'));
    add(card, scoreLine);

    var meter = el('div', 'meter');
    var fill = el('i', 'meter__fill');
    add(meter, fill);
    add(card, meter);

    var speedLine;
    if (isFinite(result.elapsedMs)) {
      var secs = (result.elapsedMs / 1000).toFixed(1) + 's';
      speedLine = result.speedBonus > 0
        ? el('p', 'overlay__speed', secs + ' · +' + result.speedBonus + ' speed bonus')
        : el('p', 'overlay__speed overlay__speed--none', secs + ' · too slow for a bonus');
    }

    add(card,
      el('p', 'overlay__error', formatError(result.error, result.unit)),
      speedLine,
      el('p', 'overlay__judgment', judgmentFor(result.points)),
      el('p', 'overlay__running', me.name + '’s total: ' + me.total));

    var label = (state.turn === 0) ? 'Hand it over' : 'Round result';
    add(card, button(label, 'btn--primary', onContinue), el('p', 'hint', 'Enter to continue'));

    add(overlay, card);

    requestAnimationFrame(function () {
      fill.style.width = Math.max(2, Math.round(result.points / 10)) + '%';
    });
    countUp(number, result.earned, 900);
    setPrimary(onContinue);
    return overlay;
  }

  /* --------------------------------------------------- turn / round flow */

  function advanceTurn() {
    if (state.turn === 0) {
      state.turn = 1;
      renderHandoff();
      return;
    }
    finishRound();
  }

  function finishRound() {
    var round = state.plan[state.roundIndex];
    var a = state.turnScores[0];
    var b = state.turnScores[1];
    var winner = a.earned > b.earned ? 0 : (b.earned > a.earned ? 1 : -1);
    var bonus = 0;

    if (winner >= 0) {
      var champ = state.players[winner];
      champ.streak += 1;
      champ.wins += 1;
      state.players[1 - winner].streak = 0;
      if (champ.streak > 1) {
        bonus = 50 * (champ.streak - 1);
        champ.total += bonus;
      }
    } else {
      state.players[0].streak = 0;
      state.players[1].streak = 0;
    }

    state.log.push({
      round: state.roundIndex + 1,
      challengeId: round.def.id || round.def.title || 'challenge',
      challengeTitle: round.def.title || 'Challenge',
      difficulty: round.difficulty,
      scores: [a, b],
      winner: winner,
      bonus: bonus,
      streak: winner >= 0 ? state.players[winner].streak : 0
    });

    renderRoundResult(state.log[state.log.length - 1]);
  }

  /* --------------------------------------------------- 5. round result */

  function renderRoundResult(entry) {
    var screen = screenShell('result', -1);
    var card = el('div', 'card card--result');

    add(card,
      el('p', 'eyebrow', 'Round ' + entry.round + ' of ' + ROUND_COUNT + ' · ' + entry.challengeTitle));

    var banner = el('h2', 'result__banner');
    if (entry.winner < 0) {
      banner.textContent = 'Dead heat.';
      banner.classList.add('is-draw');
    } else {
      banner.textContent = state.players[entry.winner].name + ' takes the round';
      banner.classList.add('is-p' + (entry.winner + 1));
    }
    add(card, banner);

    var grid = el('div', 'result__grid');
    for (var i = 0; i < 2; i++) {
      var s = entry.scores[i];
      var col = el('div', 'result__col result__col--p' + (i + 1) +
        (entry.winner === i ? ' is-winner' : ''));
      add(col,
        el('span', 'result__name', state.players[i].name),
        el('span', 'result__points', s.earned),
        s.speedBonus > 0 ? el('span', 'result__speed', 'incl. +' + s.speedBonus + ' speed') : null,
        el('span', 'result__error', formatError(s.error, s.unit)),
        el('span', 'result__judgment', judgmentFor(s.points)));
      add(grid, col);
      if (i === 0) {
        var gap = Math.abs(entry.scores[0].earned - entry.scores[1].earned);
        add(grid, el('div', 'result__gap', gap === 0 ? '=' : '+' + gap));
      }
    }
    add(card, grid);

    if (entry.bonus > 0) {
      var callout = el('div', 'streak-callout');
      add(callout,
        el('span', 'streak-callout__badge', 'streak x' + entry.streak),
        el('span', 'streak-callout__text',
          state.players[entry.winner].name + ' banks a +' + entry.bonus + ' bonus'));
      add(card, callout);
    }

    var last = state.roundIndex + 1 >= ROUND_COUNT;
    function next() {
      if (last) {
        renderWinner();
        return;
      }
      state.roundIndex += 1;
      state.turn = 0;
      state.turnScores = [null, null];
      renderHandoff();
    }

    add(card,
      button(last ? 'See the verdict' : 'Next round', 'btn--primary btn--large', next),
      el('p', 'hint', 'Enter to continue'));

    add(screen, card);
    showScreen(screen);
    setPrimary(next);
  }

  /* -------------------------------------------------------- 6. winner */

  function renderWinner() {
    var p0 = state.players[0];
    var p1 = state.players[1];
    var winner = p0.total > p1.total ? 0 : (p1.total > p0.total ? 1 : -1);

    var screen = el('section', 'screen--winner');
    var confetti = el('div', 'confetti-field');
    add(screen, confetti);

    var card = el('div', 'card card--winner');
    add(card, el('p', 'eyebrow', 'Final verdict'));

    var headline = el('h2', 'winner__headline');
    if (winner < 0) {
      headline.textContent = 'Perfectly, infuriatingly tied.';
    } else {
      headline.textContent = state.players[winner].name + ' has the better eye';
      headline.classList.add('is-p' + (winner + 1));
    }
    add(card, headline);

    var totals = el('div', 'totals');
    var best = Math.max(p0.total, p1.total, 1);
    var fillJobs = [];
    for (var i = 0; i < 2; i++) {
      var p = state.players[i];
      var row = el('div', 'totals__row totals__row--p' + (i + 1) + (winner === i ? ' is-winner' : ''));
      add(row, el('span', 'totals__name', p.name));
      var track = el('div', 'totals__track');
      var fill = el('i', 'totals__fill');
      fill.style.width = '0%';
      add(track, fill);
      add(row, track, el('span', 'totals__value', p.total),
        el('span', 'totals__wins', p.wins + (p.wins === 1 ? ' round' : ' rounds')));
      add(totals, row);
      fillJobs.push([fill, Math.round((p.total / best) * 100)]);
    }
    add(card, totals);
    add(card, buildStats());

    function rematch() {
      state = newGame(playerNames());
      renderHandoff();
    }
    function newPlayers() {
      renderTitle(playerNames());
    }

    var actions = el('div', 'actions');
    add(actions,
      button('Rematch', 'btn--primary btn--large', rematch),
      button('New players', 'btn--ghost', newPlayers));
    add(card, actions, el('p', 'hint', 'Enter for a rematch · new scenes, new seed'));

    add(screen, card);
    showScreen(screen, function () {
      launchConfetti(confetti, 110);
      for (var j = 0; j < fillJobs.length; j++) {
        fillJobs[j][0].style.width = fillJobs[j][1] + '%';
      }
    });
    setPrimary(rematch);
  }

  function buildStats() {
    var stats = el('div', 'stats');

    var widest = null;
    for (var i = 0; i < state.log.length; i++) {
      var entry = state.log[i];
      var gap = Math.abs(entry.scores[0].earned - entry.scores[1].earned);
      if (!widest || gap > widest.gap) widest = { gap: gap, entry: entry };
    }

    var gapCard = el('div', 'stat');
    add(gapCard, el('span', 'stat__label', 'Biggest single-round gap'));
    if (widest && widest.gap > 0) {
      add(gapCard,
        el('span', 'stat__value', widest.gap + ' pts'),
        el('span', 'stat__note', 'Round ' + widest.entry.round + ' · ' + widest.entry.challengeTitle +
          ' · ' + state.players[widest.entry.winner].name));
    } else {
      add(gapCard, el('span', 'stat__value', 'None'), el('span', 'stat__note', 'Every round was a tie.'));
    }
    add(stats, gapCard);

    var bestCard = el('div', 'stat stat--wide');
    add(bestCard, el('span', 'stat__label', 'Best eye per challenge'));
    var list = el('ul', 'stat__list');
    var seen = {};
    for (var r = 0; r < state.log.length; r++) {
      var log = state.log[r];
      var key = log.challengeId;
      var top = seen[key];
      for (var side = 0; side < 2; side++) {
        var s = log.scores[side];
        if (!top || s.points > top.points) {
          top = { points: s.points, player: side, title: log.challengeTitle, score: s };
        }
      }
      seen[key] = top;
    }
    for (var id in seen) {
      if (!Object.prototype.hasOwnProperty.call(seen, id)) continue;
      var item = el('li', 'stat__item stat__item--p' + (seen[id].player + 1));
      add(item,
        el('span', 'stat__item-name', seen[id].title),
        el('span', 'stat__item-holder', state.players[seen[id].player].name),
        el('span', 'stat__item-points', seen[id].points));
      add(list, item);
    }
    add(bestCard, list);
    add(stats, bestCard);

    return stats;
  }

  function launchConfetti(host, count) {
    var colors = ['#f0a95c', '#6fc6bb', '#e8705a', '#f4d35e', '#f3e9df', '#c98adf'];
    for (var i = 0; i < count; i++) {
      var piece = el('i', 'confetti');
      piece.style.left = (Math.random() * 100).toFixed(2) + '%';
      piece.style.background = colors[i % colors.length];
      piece.style.width = (4 + Math.random() * 6).toFixed(1) + 'px';
      piece.style.height = (8 + Math.random() * 10).toFixed(1) + 'px';
      piece.style.animationDelay = (Math.random() * 1.4).toFixed(2) + 's';
      piece.style.animationDuration = (2.4 + Math.random() * 2.6).toFixed(2) + 's';
      piece.style.setProperty('--drift', (Math.random() * 180 - 90).toFixed(0) + 'px');
      piece.style.setProperty('--spin', (Math.random() * 900 - 450).toFixed(0) + 'deg');
      piece.style.opacity = (0.65 + Math.random() * 0.35).toFixed(2);
      add(host, piece);
    }
  }

  /* ------------------------------------------------------- error screen */

  function renderMissingChallenges() {
    var screen = el('section', 'screen--title');
    var card = el('div', 'card card--error');
    add(card,
      el('p', 'eyebrow', 'nothing to play'),
      el('h2', 'handoff__title', 'No challenges loaded'),
      el('p', 'brief__instruction',
        'The game could not find any challenges in challenges.js. Make sure the file is present next to index.html and sets window.CHALLENGES to a list of challenge definitions, then reload.'));
    add(screen, card, ambientGlow());
    showScreen(screen);
  }

  /* ------------------------------------------------------------- boot */

  function boot() {
    app = document.getElementById('app');
    if (!app) return;
    if (availableChallenges().length === 0) {
      renderMissingChallenges();
      return;
    }
    renderTitle(null);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
