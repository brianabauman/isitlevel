/* The Better Eye - challenge scenes (Agent B).
   Defines window.CHALLENGES: five domestic perception tasks, each built as pure
   DOM + CSS inside the shell's div.challenge-stage. No modules, no network. */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ *
   * tiny helpers
   * ------------------------------------------------------------------ */

  function el(tag, cls, parent) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (parent) parent.appendChild(n);
    return n;
  }

  function setv(node, style) {
    if (style) {
      for (var k in style) {
        if (Object.prototype.hasOwnProperty.call(style, k)) node.style.setProperty(k, style[k]);
      }
    }
    return node;
  }

  function box(cls, parent, style) { return setv(el('div', cls, parent), style); }

  function rnd(rng, a, b) { return a + rng() * (b - a); }
  function pickOne(rng, arr) { return arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))]; }
  function coin(rng) { return rng() < 0.5 ? -1 : 1; }
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function num(n) { return Math.round(n * 1000) / 1000; }
  function pc(n) { return num(n) + '%'; }
  function dg(n) { return num(n) + 'deg'; }

  function hsl(h, s, l, a) {
    h = Math.round(((h % 360) + 360) % 360);
    s = Math.round(clamp(s, 0, 100));
    l = Math.round(clamp(l, 0, 100));
    if (a === undefined) return 'hsl(' + h + ',' + s + '%,' + l + '%)';
    return 'hsla(' + h + ',' + s + '%,' + l + '%,' + num(a) + ')';
  }

  /* Force style flush so a class-driven transition starts from the current value. */
  function reflow(node) { return node.offsetWidth; }

  /* Scoring tolerance. The contract's maxError is the difficulty-1 value; the
     window tightens as the scenes get subtler, so a careless attempt still
     scores near zero in the late rounds instead of coasting on a small
     starting perturbation. */
  var TOL_SCALE = [1, 0.86, 0.72];
  function tol(base, d) { return Math.round(base * TOL_SCALE[d - 1] * 100) / 100; }

  /* ------------------------------------------------------------------ *
   * Kit - per-instance lifecycle: listeners, timers, freeze, teardown.
   * Every listener the scene adds goes through kit.on so destroy() can
   * guarantee nothing survives the stage being reused.
   * ------------------------------------------------------------------ */

  function Kit(container, rng, difficulty) {
    this.container = container;
    this.rng = rng;
    this.d = clamp(Math.round(difficulty || 1), 1, 3);
    this.frozen = false;
    this._binds = [];
    this._timers = [];
    this._enders = [];
  }

  Kit.prototype.on = function (target, type, fn, opts) {
    var o = opts || false;
    target.addEventListener(type, fn, o);
    this._binds.push([target, type, fn, o]);
  };

  Kit.prototype.after = function (ms, fn) {
    this._timers.push(setTimeout(fn, ms));
  };

  Kit.prototype.rect = function () { return this.container.getBoundingClientRect(); };

  Kit.prototype.freeze = function () {
    this.frozen = true;
    for (var i = 0; i < this._enders.length; i++) this._enders[i]();
  };

  Kit.prototype.destroy = function () {
    var i;
    for (i = 0; i < this._binds.length; i++) {
      this._binds[i][0].removeEventListener(this._binds[i][1], this._binds[i][2], this._binds[i][3]);
    }
    for (i = 0; i < this._timers.length; i++) clearTimeout(this._timers[i]);
    this._binds.length = 0;
    this._timers.length = 0;
    this._enders.length = 0;
    this.frozen = true;
    while (this.container.firstChild) this.container.removeChild(this.container.firstChild);
  };

  /* Pointer drag. Move/up live on document so a drag that leaves the object (or
     the window) still tracks and still ends; both are torn down by destroy(). */
  Kit.prototype.drag = function (node, handlers) {
    var kit = this;
    var active = false;
    var sx = 0, sy = 0, data = null;

    node.classList.add('cs-grab');

    function stop() {
      if (!active) return;
      active = false;
      data = null;
      node.classList.remove('cs-grabbing');
      if (handlers.end) handlers.end();
    }

    this.on(node, 'pointerdown', function (e) {
      if (kit.frozen || active) return;
      if (e.button !== undefined && e.button !== 0) return;
      active = true;
      sx = e.clientX;
      sy = e.clientY;
      data = handlers.start ? handlers.start(e) : null;
      node.classList.add('cs-grabbing');
      e.preventDefault();
    });

    this.on(document, 'pointermove', function (e) {
      if (!active) return;
      if (kit.frozen) { stop(); return; }
      handlers.move(e.clientX - sx, e.clientY - sy, data, e);
      if (e.cancelable) e.preventDefault();
    });

    this.on(document, 'pointerup', stop);
    this.on(document, 'pointercancel', stop);
    this.on(window, 'blur', stop);
    this._enders.push(stop);
  };

  var ARROWS = { ArrowLeft: 1, ArrowRight: 1, ArrowUp: 1, ArrowDown: 1 };

  /* Arrow keys only. Enter / Escape / Tab / Space belong to the shell and are
     never observed here. */
  Kit.prototype.arrows = function (fn) {
    var kit = this;
    this.on(window, 'keydown', function (e) {
      if (kit.frozen) return;
      if (!ARROWS[e.key]) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (fn(e.key, e.shiftKey === true) !== false) e.preventDefault();
    });
  };

  /* ------------------------------------------------------------------ *
   * Room scenery
   * ------------------------------------------------------------------ */

  var WALL_PALETTES = [
    { h: 24, s: 16, l: 33 },   /* warm clay   */
    { h: 38, s: 17, l: 35 },   /* oat         */
    { h: 148, s: 10, l: 29 },  /* sage        */
    { h: 208, s: 14, l: 30 },  /* dusty blue  */
    { h: 348, s: 11, l: 30 },  /* faded rose  */
    { h: 44, s: 7, l: 28 }     /* greige      */
  ];

  function buildRoom(kit, o) {
    o = o || {};
    var rng = kit.rng;
    var room = el('div', 'cs-room', kit.container);
    var p = pickOne(rng, WALL_PALETTES);
    var h = p.h + rnd(rng, -7, 7);
    var s = clamp(p.s + rnd(rng, -3, 5), 4, 30);
    var l = clamp(p.l + rnd(rng, -4, 5), 20, 42);
    var wood = rnd(rng, 16, 32);
    var floorTop = o.floorTop === undefined ? 80 : o.floorTop;
    var baseH = o.baseH === undefined ? 4.2 : o.baseH;

    setv(room, {
      '--w-hi': hsl(h, s, l + 9),
      '--w-mid': hsl(h, s, l),
      '--w-lo': hsl(h, s, l - 9),
      '--w-deep': hsl(h, s, l - 17),
      '--trim': hsl(h + 8, s - 6, l + 30),
      '--trim-lo': hsl(h + 8, s - 6, l + 14),
      '--floor-a': hsl(wood, 32, 21),
      '--floor-b': hsl(wood - 5, 30, 11),
      '--glow-x': pc(rnd(rng, 22, 78)),
      '--glow-y': pc(o.glowY === undefined ? 70 : o.glowY),
      '--floor-top': pc(floorTop),
      '--base-h': pc(baseH)
    });

    box('cs-wall', room);

    /* Layered soft blobs read as plaster/paint mottling. Deliberately
       directionless: any repeating stripe would hand the player a level. */
    var spots = [];
    var n = 7;
    for (var i = 0; i < n; i++) {
      var light = rng() < 0.5;
      spots.push('radial-gradient(' + num(rnd(rng, 18, 46)) + '% ' + num(rnd(rng, 12, 34)) +
        '% at ' + num(rnd(rng, -5, 105)) + '% ' + num(rnd(rng, -5, 105)) + '%, ' +
        (light ? 'rgba(255,244,226,' : 'rgba(20,10,4,') + num(rnd(rng, 0.03, 0.075)) +
        '), rgba(0,0,0,0) 70%)');
    }
    box('cs-mottle', room).style.backgroundImage = spots.join(',');

    box('cs-glow', room);

    if (o.ceiling) {
      box('cs-ceiling', room, { height: pc(o.ceiling) });
    }
    if (o.floor !== false) {
      box('cs-floor', room);
      box('cs-baseboard', room);
    }

    room.__floorTop = floorTop;
    return room;
  }

  /* Motes are pure decoration, so Math.random is allowed here per the contract. */
  function addMotes(room, count) {
    var g = box('cs-motes', room);
    for (var i = 0; i < count; i++) {
      box('cs-mote', g, {
        left: pc(Math.random() * 100),
        top: pc(Math.random() * 82),
        '--sz': (1.6 + Math.random() * 2.4).toFixed(1) + 'px',
        '--op': (0.08 + Math.random() * 0.2).toFixed(2),
        '--dur': (9 + Math.random() * 13).toFixed(1) + 's',
        '--dly': (-Math.random() * 16).toFixed(1) + 's',
        '--dx': (-14 + Math.random() * 28).toFixed(0) + 'px'
      });
    }
  }

  function finishRoom(kit, room) {
    addMotes(room, kit.d >= 3 ? 16 : 10);
    box('cs-vignette', room);
  }

  /* ------------------------------------------------------------------ *
   * Furniture. Everything is positioned in % of the room box: x/width use
   * width, y/height use height.
   * ------------------------------------------------------------------ */

  var SOFA_COLORS = [
    { h: 32, s: 44, l: 34 },   /* rust      */
    { h: 186, s: 26, l: 28 },  /* teal      */
    { h: 84, s: 22, l: 27 },   /* olive     */
    { h: 42, s: 46, l: 40 },   /* mustard   */
    { h: 232, s: 14, l: 30 },  /* slate     */
    { h: 12, s: 20, l: 26 }    /* cocoa     */
  ];

  function makeSofa(kit, parent, o) {
    var rng = kit.rng;
    var c = pickOne(rng, SOFA_COLORS);
    var g = box('cs-sofa', parent, {
      left: pc(o.cx), top: pc(o.top), width: pc(o.w), height: pc(o.h),
      '--s-hi': hsl(c.h, c.s, c.l + 10),
      '--s-mid': hsl(c.h, c.s, c.l),
      '--s-lo': hsl(c.h, c.s, c.l - 11),
      '--s-deep': hsl(c.h, c.s, c.l - 19)
    });
    box('cs-shadow-pool', g, { left: '-6%', right: '-6%', bottom: '-5%', height: '22%' });
    box('cs-sofa-back', g);

    /* Three back cushions: symmetric, so the sofa's centre stays honest. */
    var i;
    for (i = 0; i < 3; i++) {
      box('cs-sofa-cush', g, { left: pc(11 + i * 26), width: '26%' });
    }
    box('cs-sofa-seat', g);
    box('cs-sofa-arm cs-l', g);
    box('cs-sofa-arm cs-r', g);
    var pill = hsl(c.h + rnd(rng, 90, 220), 30, 62);
    box('cs-sofa-pillow cs-l', g, { '--c': pill });
    box('cs-sofa-pillow cs-r', g, { '--c': pill });
    box('cs-sofa-leg cs-l', g);
    box('cs-sofa-leg cs-r', g);
    return g;
  }

  function makeConsole(kit, parent, o) {
    var rng = kit.rng;
    var t = rnd(rng, 12, 30);
    var g = box('cs-console', parent, {
      left: pc(o.cx), top: pc(o.top), width: pc(o.w), height: pc(o.h),
      '--c-hi': hsl(t, 30, 31),
      '--c-mid': hsl(t, 32, 23),
      '--c-lo': hsl(t, 30, 14)
    });
    box('cs-shadow-pool', g, { left: '-5%', right: '-5%', bottom: '-6%', height: '20%' });
    box('cs-console-top', g);
    var body = box('cs-console-body', g);
    box('cs-console-door', body, { left: '3%', width: '45%' });
    box('cs-console-door', body, { left: '52%', width: '45%' });
    box('cs-console-leg cs-l', g);
    box('cs-console-leg cs-r', g);
    return g;
  }

  /* Table lamp. The shade's lower rim is an ellipse rather than a straight
     edge, so it never doubles as a spirit level near the target. */
  function makeLamp(kit, parent, o) {
    var rng = kit.rng;
    var warm = rnd(rng, 32, 44);
    var g = box('cs-lamp', parent, {
      left: pc(o.cx), top: pc(o.y - o.h), width: pc(o.w || 12), height: pc(o.h),
      '--sh': hsl(warm, 52, 62),
      '--sh-lo': hsl(warm - 6, 44, 40)
    });
    box('cs-lamp-halo', g);
    box('cs-lamp-shade', g);
    box('cs-lamp-rim', g);
    box('cs-lamp-neck', g);
    box('cs-lamp-base', g);
    return g;
  }

  function makePlant(kit, parent, o) {
    var rng = kit.rng;
    var g = box('cs-plant', parent, {
      left: pc(o.cx), top: pc(o.y - o.h), width: pc(o.w || 12), height: pc(o.h)
    });
    box('cs-shadow-pool', g, { left: '-14%', right: '-14%', bottom: '-4%', height: '16%' });
    var leaves = 6 + Math.floor(rng() * 4);
    for (var i = 0; i < leaves; i++) {
      var t = i / (leaves - 1);
      box('cs-leaf', g, {
        left: pc(50 + (t - 0.5) * rnd(rng, 60, 96)),
        top: pc(rnd(rng, 2, 34)),
        width: pc(rnd(rng, 34, 52)),
        '--r': dg((t - 0.5) * rnd(rng, 90, 150) + rnd(rng, -12, 12)),
        '--c': hsl(rnd(rng, 96, 148), rnd(rng, 22, 38), rnd(rng, 22, 38))
      });
    }
    box('cs-pot', g);
    return g;
  }

  function makeRug(kit, parent, o) {
    var rng = kit.rng;
    return box('cs-rug', parent, {
      left: pc(o.cx), top: pc(o.top), width: pc(o.w), height: pc(o.h),
      '--r-a': hsl(rnd(rng, 8, 40), 26, 26),
      '--r-b': hsl(rnd(rng, 8, 40), 20, 17)
    });
  }

  /* A round mirror is the one piece of wall decor with no straight edge, so it
     can sit at the target's height without leaking level. */
  function makeMirror(kit, parent, o) {
    var g = box('cs-mirror', parent, { left: pc(o.cx), top: pc(o.cy), width: pc(o.w) });
    box('cs-mirror-glass', g);
    return g;
  }

  /* Globe sconce: warm, round, and free of straight edges, so it can decorate a
     wall in a levelling or plumbing task without answering it. */
  function makeSconce(kit, parent, o) {
    var g = box('cs-sconce', parent, { left: pc(o.cx), top: pc(o.cy), width: pc(o.w || 8) });
    box('cs-sconce-arm', g);
    box('cs-sconce-globe', g);
    return g;
  }

  function makeBooks(kit, parent, o) {
    var rng = kit.rng;
    var g = box('cs-books', parent, {
      left: pc(o.cx), top: pc(o.y - o.h), width: pc(o.w || 7), height: pc(o.h)
    });
    var n = 3 + Math.floor(rng() * 3);
    for (var i = 0; i < n; i++) {
      box('cs-book', g, {
        bottom: pc(i * (100 / n)),
        left: pc(rnd(rng, 0, 14)),
        right: pc(rnd(rng, 0, 14)),
        height: pc(100 / n - 1),
        '--c': hsl(rnd(rng, 0, 360), rnd(rng, 16, 34), rnd(rng, 26, 46))
      });
    }
    return g;
  }

  function makeVase(kit, parent, o) {
    var rng = kit.rng;
    var g = box('cs-vase', parent, {
      left: pc(o.cx), top: pc(o.y - o.h), width: pc(o.w || 6), height: pc(o.h),
      '--c': hsl(rnd(rng, 10, 210), rnd(rng, 10, 26), rnd(rng, 40, 62))
    });
    box('cs-vase-body', g);
    box('cs-vase-stem', g);
    return g;
  }

  function makeHangingPlant(kit, parent, o) {
    var rng = kit.rng;
    var g = box('cs-hanger', parent, {
      left: pc(o.cx), top: '0%', width: pc(o.w || 9), height: pc(o.h || 40)
    });
    box('cs-hanger-rope', g);
    box('cs-hanger-pot', g);
    for (var i = 0; i < 5; i++) {
      box('cs-vine', g, {
        left: pc(rnd(rng, 12, 88)),
        top: pc(rnd(rng, 52, 66)),
        height: pc(rnd(rng, 16, 40)),
        '--r': dg(rnd(rng, -26, 26)),
        '--c': hsl(rnd(rng, 96, 140), 26, rnd(rng, 24, 36))
      });
    }
    return g;
  }

  /* ------------------------------------------------------------------ *
   * Artwork - each canvas is built from gradients and simple shapes so no
   * two plays look alike. Nothing inside a frame is tilted relative to the
   * frame, so the art can never argue with the frame's own edges.
   * ------------------------------------------------------------------ */

  var ART_STYLES = ['dusk', 'bands', 'peaks', 'botanical', 'circles', 'harbor'];
  var FINISHES = ['oak', 'walnut', 'gold', 'black', 'ivory'];

  function paintArt(kit, art) {
    var rng = kit.rng;
    var style = pickOne(rng, ART_STYLES);
    var i, h;
    art.classList.add('cs-a-' + style);

    if (style === 'dusk') {
      h = rnd(rng, 4, 44);
      art.style.background = 'linear-gradient(180deg,' + hsl(h + 22, 68, 76) + ',' +
        hsl(h, 76, 62) + ' 42%,' + hsl(h - 16, 54, 40) + ' 72%,' + hsl(h - 28, 44, 24) + ')';
      box('cs-a-sun', art, {
        left: pc(rnd(rng, 26, 74)), top: pc(rnd(rng, 24, 44)),
        width: pc(rnd(rng, 16, 27)), '--c': hsl(h + 26, 96, 84)
      });
      box('cs-a-hill', art, { bottom: '-6%', height: pc(rnd(rng, 26, 40)), '--c': hsl(h - 30, 36, 21) });
      box('cs-a-hill', art, { bottom: '-10%', height: pc(rnd(rng, 13, 22)), '--c': hsl(h - 44, 32, 12) });

    } else if (style === 'bands') {
      h = rnd(rng, 0, 360);
      var c1 = hsl(h, 42, 64), c2 = hsl(h + 26, 48, 44), c3 = hsl(h + 54, 30, 26);
      var m1 = rnd(rng, 26, 38), m2 = rnd(rng, 58, 72);
      art.style.background = 'linear-gradient(180deg,' + c1 + ' 0%,' + c1 + ' ' + num(m1 - 5) + '%,' +
        c2 + ' ' + num(m1 + 5) + '%,' + c2 + ' ' + num(m2 - 5) + '%,' +
        c3 + ' ' + num(m2 + 5) + '%,' + c3 + ' 100%)';

    } else if (style === 'peaks') {
      h = rnd(rng, 190, 280);
      art.style.background = 'linear-gradient(180deg,' + hsl(h, 44, 24) + ',' +
        hsl(h - 18, 40, 46) + ' 62%,' + hsl(h - 34, 34, 64) + ')';
      box('cs-a-sun', art, {
        left: pc(rnd(rng, 20, 78)), top: pc(rnd(rng, 16, 32)),
        width: pc(rnd(rng, 11, 18)), '--c': hsl(48, 60, 92)
      });
      for (i = 0; i < 3; i++) {
        box('cs-a-peak', art, {
          left: pc(rnd(rng, 8, 92)), width: pc(rnd(rng, 46, 84)),
          height: pc(rnd(rng, 38, 74)),
          '--c': hsl(h + i * 6, 26, 16 + i * 7)
        });
      }

    } else if (style === 'botanical') {
      art.style.background = 'linear-gradient(180deg,' + hsl(40, 26, 90) + ',' + hsl(36, 22, 79) + ')';
      box('cs-a-stem', art, { '--c': hsl(rnd(rng, 96, 130), 24, 28) });
      var lv = 5 + Math.floor(rng() * 4);
      for (i = 0; i < lv; i++) {
        var t = i / (lv - 1);
        box('cs-a-leaf', art, {
          left: pc(50 + (i % 2 ? 1 : -1) * rnd(rng, 10, 24)),
          top: pc(18 + t * 56),
          width: pc(rnd(rng, 22, 34)),
          '--r': dg((i % 2 ? 1 : -1) * rnd(rng, 20, 48)),
          '--c': hsl(rnd(rng, 92, 138), rnd(rng, 20, 34), rnd(rng, 26, 42))
        });
      }

    } else if (style === 'circles') {
      h = rnd(rng, 0, 360);
      art.style.background = hsl(h + 200, 18, 88);
      for (i = 0; i < 3; i++) {
        box('cs-a-circle', art, {
          left: pc(rnd(rng, 24, 76)), top: pc(rnd(rng, 24, 76)),
          width: pc(rnd(rng, 34, 62)),
          '--c': hsl(h + i * rnd(rng, 40, 110), rnd(rng, 42, 66), rnd(rng, 42, 60), 0.72)
        });
      }

    } else {
      h = rnd(rng, 186, 224);
      art.style.background = 'linear-gradient(180deg,' + hsl(h - 26, 46, 74) + ',' +
        hsl(h - 8, 40, 60) + ' 52%,' + hsl(h, 44, 34) + ' 52%,' + hsl(h + 6, 46, 22) + ')';
      box('cs-a-sun', art, {
        left: pc(rnd(rng, 28, 72)), top: '34%', width: pc(rnd(rng, 12, 20)),
        '--c': hsl(38, 92, 84)
      });
      box('cs-a-sail', art, {
        left: pc(rnd(rng, 26, 70)), width: pc(rnd(rng, 14, 24)), height: pc(rnd(rng, 20, 30))
      });
    }
  }

  /* o: { x, y, w | h, ar, finish, mat } - x/y are the frame's centre. */
  function makeFrame(kit, parent, o) {
    var rng = kit.rng;
    var fin = o.finish || pickOne(rng, FINISHES);
    var f = el('div', 'cs-frame cs-fin-' + fin, parent);
    var st = { left: pc(o.x), top: pc(o.y), 'aspect-ratio': num(o.ar) + '' };
    if (o.w !== undefined) st.width = pc(o.w); else st.height = pc(o.h);
    setv(f, st);
    var mat = el('div', 'cs-mat' + (o.mat === false ? ' cs-mat-none' : ''), f);
    paintArt(kit, el('div', 'cs-art', mat));
    return f;
  }

  /* ------------------------------------------------------------------ *
   * Reveal furniture
   * ------------------------------------------------------------------ */

  function ghostOf(node, parent, vars) {
    var g = node.cloneNode(true);
    g.classList.remove('cs-grab');
    g.classList.remove('cs-grabbing');
    var handles = g.querySelectorAll('.cs-grab');
    for (var i = 0; i < handles.length; i++) handles[i].classList.remove('cs-grab');
    g.classList.add('cs-ghost');
    setv(g, vars);
    parent.insertBefore(g, node);
    return g;
  }

  function turnOn(kit, node, delay) {
    kit.after(delay, function () { node.classList.add('cs-on'); });
  }

  /* ------------------------------------------------------------------ *
   * 1. Hang the Frame
   * ------------------------------------------------------------------ */

  var hangTheFrame = {
    id: 'hang-the-frame',
    title: 'Hang the Frame',
    instruction: 'Drag the painting, or use ← → (Shift for coarse), until it hangs perfectly level.',
    create: function (container, rng, difficulty) {
      var kit = new Kit(container, rng, difficulty);
      var d = kit.d;
      var room = buildRoom(kit, { floorTop: 79, glowY: 72 });

      var cx = rnd(rng, 45, 55);
      var cy = 34;
      var fh = [31, 26, 21][d - 1];
      var ar = rnd(rng, 0.74, 1.3);

      /* Everything else lives well below the picture: the console top and the
         baseboard are the honest horizontals, and they are far away. */
      var conCx = clamp(cx + coin(rng) * rnd(rng, 2, 9), 28, 72);
      makeConsole(kit, room, { cx: conCx, top: 61, w: 40, h: 18 });
      makeLamp(kit, room, { cx: conCx + rnd(rng, 13, 17) * coin(rng), y: 61.5, h: 23, w: 13 });
      makePlant(kit, room, { cx: clamp(conCx + coin(rng) * rnd(rng, 26, 34), 8, 92), y: 79.5, h: 21, w: 15 });
      makeVase(kit, room, { cx: conCx + rnd(rng, -7, 7), y: 61.5, h: 8, w: 5 });

      if (d >= 2) {
        makeRug(kit, room, { cx: rnd(rng, 40, 60), top: 84, w: 74, h: 14 });
        makeBooks(kit, room, { cx: conCx + coin(rng) * rnd(rng, 10, 14), y: 61.5, h: 6, w: 7 });
      }
      /* Only round wall decor near the picture's height: a rectangle hung level
         would hand over the answer. */
      if (d >= 3) {
        makeMirror(kit, room, { cx: cx < 50 ? rnd(rng, 78, 88) : rnd(rng, 12, 22), cy: rnd(rng, 26, 36), w: 13 });
        makeSconce(kit, room, { cx: cx < 50 ? rnd(rng, 14, 20) : rnd(rng, 80, 86), cy: rnd(rng, 22, 30), w: 8 });
      }

      var frame = makeFrame(kit, room, { x: cx, y: cy, h: fh, ar: ar });
      finishRoom(kit, room);

      var band = [[3.2, 6.0], [2.3, 4.6], [1.6, 3.3]][d - 1];
      var state = { a: coin(rng) * rnd(rng, band[0], band[1]) };
      var revealed = false;

      function apply() { frame.style.setProperty('--rot', dg(state.a)); }
      apply();

      kit.drag(frame, {
        start: function (e) {
          var r = frame.getBoundingClientRect();
          var px = r.left + r.width / 2;
          var py = r.top + r.height / 2;
          return { px: px, py: py, a0: state.a, t0: Math.atan2(e.clientY - py, e.clientX - px) };
        },
        move: function (dx, dy, data, e) {
          var t = Math.atan2(e.clientY - data.py, e.clientX - data.px);
          var delta = t - data.t0;
          while (delta > Math.PI) delta -= 2 * Math.PI;
          while (delta < -Math.PI) delta += 2 * Math.PI;
          state.a = clamp(data.a0 + delta * 180 / Math.PI, -24, 24);
          apply();
        }
      });

      kit.arrows(function (key, shift) {
        if (key !== 'ArrowLeft' && key !== 'ArrowRight') return false;
        var step = shift ? 1 : 0.1;
        state.a = clamp(state.a + (key === 'ArrowRight' ? step : -step), -24, 24);
        apply();
      });

      return {
        getScore: function () {
          return { error: Math.abs(state.a), unit: '°', maxError: tol(5, d) };
        },
        reveal: function () {
          if (revealed) return;
          revealed = true;
          kit.freeze();

          /* Spirit level clamped to the frame's top rail: it tilts with the
             frame, so the bubble reads the player's own error. */
          var tool = box('cs-level-tool', frame);
          var tube = box('cs-level-tube', tool);
          box('cs-level-mark cs-l', tube);
          box('cs-level-mark cs-r', tube);
          var bubble = box('cs-bubble', tube);

          var ghost = ghostOf(frame, room, { '--rot': '0deg' });
          var laser = box('cs-laser', room, { top: pc(cy), left: pc(cx) });

          turnOn(kit, tool, 60);
          kit.after(200, function () {
            bubble.style.setProperty('--bx', pc(clamp(-state.a / 5, -1, 1) * 172));
          });
          turnOn(kit, laser, 380);
          turnOn(kit, ghost, 480);
          kit.after(880, function () {
            frame.classList.add('cs-settle-rot');
            bubble.style.setProperty('--bx', '0%');
            tool.classList.add('cs-true');
          });
        },
        destroy: function () { kit.destroy(); }
      };
    }
  };

  /* ------------------------------------------------------------------ *
   * 2. Centre the Art
   * ------------------------------------------------------------------ */

  var centerTheArt = {
    id: 'center-the-art',
    title: 'Center the Art',
    instruction: 'Drag the picture, or use ← → (Shift for coarse), until it is centered over the sofa.',
    create: function (container, rng, difficulty) {
      var kit = new Kit(container, rng, difficulty);
      var d = kit.d;
      var room = buildRoom(kit, { floorTop: 82, glowY: 74 });

      /* The sofa is deliberately off-centre in the room: the answer is the
         sofa's middle, never the middle of the screen. */
      var sofaCx = 50 + coin(rng) * rnd(rng, 3, 13);
      var sofaW = rnd(rng, 42, 50);

      makeRug(kit, room, { cx: sofaCx + rnd(rng, -9, 9), top: 84, w: 78, h: 15 });
      var sofa = makeSofa(kit, room, { cx: sofaCx, top: 55, w: sofaW, h: 30 });
      var side = sofaCx + coin(rng) * (sofaW / 2 + rnd(rng, 5, 9));
      if (side > 8 && side < 92) {
        makeConsole(kit, room, { cx: side, top: 66, w: 13, h: 13 });
        makeLamp(kit, room, { cx: side, y: 66.5, h: 21, w: 12 });
      }
      /* The plant's distance is drawn independently of the side table's, so the
         midpoint between the two flanking objects is never the sofa's centre. */
      var away = -Math.sign(side - sofaCx) || 1;
      makePlant(kit, room, {
        cx: clamp(sofaCx + away * (sofaW / 2 + rnd(rng, 3, 16)), 8, 92), y: 84, h: 22, w: 15
      });
      if (d >= 3) {
        makeHangingPlant(kit, room, { cx: side > sofaCx ? rnd(rng, 8, 15) : rnd(rng, 85, 92), h: 30, w: 9 });
        makeBooks(kit, room, { cx: sofaCx + coin(rng) * rnd(rng, 10, 18), y: 88, h: 5, w: 7 });
      }

      var band = [[5, 11], [4, 9], [3, 7]][d - 1];
      var artH = [26, 23, 20][d - 1];
      var state = { x: clamp(sofaCx + coin(rng) * rnd(rng, band[0], band[1]), 13, 87) };
      var cy = 27;
      var art = makeFrame(kit, room, { x: state.x, y: cy, h: artH, ar: rnd(rng, 1.05, 1.5) });
      finishRoom(kit, room);

      var revealed = false;
      function apply() { art.style.setProperty('left', pc(state.x)); }
      apply();

      kit.drag(art, {
        start: function () { return { x0: state.x, w: kit.rect().width || 1 }; },
        move: function (dx, dy, data) {
          state.x = clamp(data.x0 + (dx / data.w) * 100, 8, 92);
          apply();
        }
      });

      kit.arrows(function (key, shift) {
        if (key !== 'ArrowLeft' && key !== 'ArrowRight') return false;
        var step = shift ? 1.1 : 0.12;
        state.x = clamp(state.x + (key === 'ArrowRight' ? step : -step), 8, 92);
        apply();
      });

      return {
        getScore: function () {
          return { error: Math.abs(state.x - sofaCx), unit: '% of width', maxError: tol(6, d) };
        },
        reveal: function () {
          if (revealed) return;
          revealed = true;
          kit.freeze();

          var ghost = ghostOf(art, room, { left: pc(sofaCx) });
          var plumb = box('cs-laser-v', room, { left: pc(sofaCx), top: '50%' });
          var lo = Math.min(state.x, sofaCx);
          var cal = box('cs-caliper', room, {
            left: pc(lo), width: pc(Math.abs(state.x - sofaCx)), top: pc(cy + artH / 2 + 4)
          });
          box('cs-caliper-tick cs-l', cal);
          box('cs-caliper-tick cs-r', cal);

          sofa.classList.add('cs-lit');
          turnOn(kit, plumb, 60);
          turnOn(kit, ghost, 340);
          turnOn(kit, cal, 460);
          kit.after(860, function () {
            art.classList.add('cs-slide');
            reflow(art);
            art.style.setProperty('left', pc(sofaCx));
            cal.classList.add('cs-true');
            cal.style.setProperty('left', pc(sofaCx));
            cal.style.setProperty('width', '0%');
          });
        },
        destroy: function () { kit.destroy(); }
      };
    }
  };

  /* ------------------------------------------------------------------ *
   * 3. Even the Spacing
   * ------------------------------------------------------------------ */

  var evenTheSpacing = {
    id: 'even-the-spacing',
    title: 'Even the Spacing',
    instruction: 'Slide the middle frame, or use ← → (Shift for coarse), until both gaps are equal.',
    create: function (container, rng, difficulty) {
      var kit = new Kit(container, rng, difficulty);
      var d = kit.d;
      var room = buildRoom(kit, { floorTop: 80, glowY: 72 });

      var conCx = 50 + coin(rng) * rnd(rng, 0, 7);
      makeConsole(kit, room, { cx: conCx, top: 62, w: 46, h: 17 });
      makeLamp(kit, room, { cx: conCx + coin(rng) * rnd(rng, 15, 19), y: 62.5, h: 21, w: 12 });
      makeVase(kit, room, { cx: conCx + rnd(rng, -10, 10), y: 62.5, h: 9, w: 5 });
      makePlant(kit, room, { cx: clamp(conCx + coin(rng) * rnd(rng, 30, 38), 8, 92), y: 80.5, h: 20, w: 14 });
      if (d >= 2) makeRug(kit, room, { cx: conCx + rnd(rng, -6, 6), top: 85, w: 72, h: 13 });
      if (d >= 3) makeBooks(kit, room, { cx: conCx + coin(rng) * rnd(rng, 12, 18), y: 62.5, h: 6, w: 7 });

      /* Different widths on purpose: the task is judging the gaps between the
         frames, not lining up their centres. */
      var wA = rnd(rng, 11, 15);
      var wB = rnd(rng, 10, 14);
      var wC = rnd(rng, 11, 15);
      var band = [[2.3, 4.5], [1.8, 3.5], [1.5, 2.8]][d - 1];
      var off = coin(rng) * rnd(rng, band[0], band[1]);
      var gap = rnd(rng, Math.abs(off) + 3.2, Math.abs(off) + 6.4);

      var span = wA + wB + wC + gap * 2;
      var rowCx = clamp(50 + coin(rng) * rnd(rng, 0, 5), span / 2 + 4, 100 - span / 2 - 4);
      var left = rowCx - span / 2;
      var innerL = left + wA;
      var innerR = left + span - wC;
      var trueX = (innerL + innerR) / 2;
      var cy = 36;

      makeFrame(kit, room, { x: left + wA / 2, y: cy, w: wA, ar: rnd(rng, 0.72, 1.25) });
      makeFrame(kit, room, { x: left + span - wC / 2, y: cy, w: wC, ar: rnd(rng, 0.72, 1.25) });

      var state = { x: trueX + off };
      var mid = makeFrame(kit, room, { x: state.x, y: cy, w: wB, ar: rnd(rng, 0.72, 1.25) });
      finishRoom(kit, room);

      var loX = innerL + wB / 2 + 0.6;
      var hiX = innerR - wB / 2 - 0.6;
      var revealed = false;

      function apply() { mid.style.setProperty('left', pc(state.x)); }
      apply();

      kit.drag(mid, {
        start: function () { return { x0: state.x, w: kit.rect().width || 1 }; },
        move: function (dx, dy, data) {
          state.x = clamp(data.x0 + (dx / data.w) * 100, loX, hiX);
          apply();
        }
      });

      kit.arrows(function (key, shift) {
        if (key !== 'ArrowLeft' && key !== 'ArrowRight') return false;
        var step = shift ? 0.6 : 0.08;
        state.x = clamp(state.x + (key === 'ArrowRight' ? step : -step), loX, hiX);
        apply();
      });

      return {
        getScore: function () {
          var gl = state.x - wB / 2 - innerL;
          var gr = innerR - (state.x + wB / 2);
          return { error: Math.abs(gl - gr), unit: '% of width', maxError: tol(5, d) };
        },
        reveal: function () {
          if (revealed) return;
          revealed = true;
          kit.freeze();

          var barL = box('cs-gapbar', room, { top: pc(cy) });
          var barR = box('cs-gapbar', room, { top: pc(cy) });

          function layout() {
            barL.style.setProperty('left', pc(innerL));
            barL.style.setProperty('width', pc(Math.max(0, state.x - wB / 2 - innerL)));
            barR.style.setProperty('left', pc(state.x + wB / 2));
            barR.style.setProperty('width', pc(Math.max(0, innerR - (state.x + wB / 2))));
          }
          layout();

          var ghost = ghostOf(mid, room, { left: pc(trueX) });
          turnOn(kit, barL, 60);
          turnOn(kit, barR, 140);
          turnOn(kit, ghost, 380);
          kit.after(820, function () {
            mid.classList.add('cs-slide');
            barL.classList.add('cs-move');
            barR.classList.add('cs-move');
            reflow(mid);
            state.x = trueX;
            apply();
            layout();
            barL.classList.add('cs-true');
            barR.classList.add('cs-true');
          });
        },
        destroy: function () { kit.destroy(); }
      };
    }
  };

  /* ------------------------------------------------------------------ *
   * 4. Match the Heights
   * ------------------------------------------------------------------ */

  var matchTheHeights = {
    id: 'match-the-heights',
    title: 'Match the Heights',
    instruction: 'Drag the lit frame, or use ↑ ↓ (Shift for coarse), until its middle matches the other frame’s.',
    create: function (container, rng, difficulty) {
      var kit = new Kit(container, rng, difficulty);
      var d = kit.d;
      var room = buildRoom(kit, { floorTop: 81, glowY: 76 });

      makeConsole(kit, room, { cx: 50 + coin(rng) * rnd(rng, 0, 8), top: 64, w: 34, h: 16 });
      makePlant(kit, room, { cx: coin(rng) > 0 ? rnd(rng, 8, 14) : rnd(rng, 86, 92), y: 81.5, h: 22, w: 15 });
      if (d >= 2) makeRug(kit, room, { cx: rnd(rng, 44, 56), top: 86, w: 70, h: 12 });
      if (d >= 3) {
        makeBooks(kit, room, { cx: rnd(rng, 40, 60), y: 64.5, h: 6, w: 7 });
        makeVase(kit, room, { cx: rnd(rng, 40, 60), y: 64.5, h: 9, w: 5 });
      }

      var movingLeft = rng() < 0.5;
      var xFixed = movingLeft ? rnd(rng, 70, 78) : rnd(rng, 22, 30);
      var xMove = movingLeft ? rnd(rng, 22, 30) : rnd(rng, 70, 78);
      var hFixed = rnd(rng, 21, 27);
      var hMove = hFixed * (rng() < 0.5 ? rnd(rng, 0.66, 0.84) : rnd(rng, 1.16, 1.38));
      var band = [[4.5, 9], [3.4, 7], [2.4, 5]][d - 1];
      var loY = Math.max(hMove / 2 + 3, 8);
      var hiY = 62 - hMove / 2;
      // keep the whole perturbation band inside [loY, hiY]; clamping the start
      // instead would let a do-nothing attempt begin closer than band[0]
      var yFixed = clamp(rnd(rng, 33, 40), loY + band[1], hiY - band[1]);

      makeFrame(kit, room, { x: xFixed, y: yFixed, h: hFixed, ar: rnd(rng, 0.76, 1.24) });

      var state = { y: yFixed + coin(rng) * rnd(rng, band[0], band[1]) };
      var mover = makeFrame(kit, room, { x: xMove, y: state.y, h: hMove, ar: rnd(rng, 0.76, 1.24) });
      mover.classList.add('cs-active');
      finishRoom(kit, room);

      var revealed = false;
      function apply() { mover.style.setProperty('top', pc(state.y)); }
      apply();

      kit.drag(mover, {
        start: function () { return { y0: state.y, h: kit.rect().height || 1 }; },
        move: function (dx, dy, data) {
          state.y = clamp(data.y0 + (dy / data.h) * 100, loY, hiY);
          apply();
        }
      });

      kit.arrows(function (key, shift) {
        if (key !== 'ArrowUp' && key !== 'ArrowDown') return false;
        var step = shift ? 0.9 : 0.1;
        state.y = clamp(state.y + (key === 'ArrowDown' ? step : -step), loY, hiY);
        apply();
      });

      return {
        getScore: function () {
          return { error: Math.abs(state.y - yFixed), unit: '% of height', maxError: tol(5, d) };
        },
        reveal: function () {
          if (revealed) return;
          revealed = true;
          kit.freeze();

          var ghost = ghostOf(mover, room, { top: pc(yFixed) });
          var laser = box('cs-laser', room, { top: pc(yFixed), left: pc(xFixed) });
          var lo = Math.min(state.y, yFixed);
          var cal = box('cs-caliper cs-vert', room, {
            left: pc(xMove), top: pc(lo), height: pc(Math.abs(state.y - yFixed))
          });
          box('cs-caliper-tick cs-t', cal);
          box('cs-caliper-tick cs-b', cal);

          turnOn(kit, laser, 60);
          turnOn(kit, ghost, 360);
          turnOn(kit, cal, 460);
          kit.after(860, function () {
            mover.classList.add('cs-slide');
            reflow(mover);
            mover.style.setProperty('top', pc(yFixed));
            cal.classList.add('cs-true');
            cal.style.setProperty('top', pc(yFixed));
            cal.style.setProperty('height', '0%');
          });
        },
        destroy: function () { kit.destroy(); }
      };
    }
  };

  /* ------------------------------------------------------------------ *
   * 5. Plumb the Pendant (Agent B's own)
   *
   * A dining pendant hangs from a ceiling rose, nudged off true. The room is
   * built with no straight verticals anywhere near it - round mirror, curved
   * chair backs, a table cropped above its legs - so plumb has to be judged
   * by eye. Reveal drops a real plumb line and lets the lamp swing to rest.
   * ------------------------------------------------------------------ */

  var plumbThePendant = {
    id: 'plumb-the-pendant',
    title: 'Plumb the Pendant',
    instruction: 'Swing the pendant with the mouse, or use ← → (Shift for coarse), until it hangs dead plumb.',
    create: function (container, rng, difficulty) {
      var kit = new Kit(container, rng, difficulty);
      var d = kit.d;
      var room = buildRoom(kit, { floor: false, ceiling: 6, glowY: 58 });
      room.classList.add('cs-room-nook');

      var ax = rnd(rng, 43, 57);
      var ay = 6;
      var cordLen = [45, 48, 51][d - 1];
      var shadeW = [17, 15, 13][d - 1];

      /* Chairs first: they are tucked in behind the table. */
      if (d >= 2) {
        box('cs-chairback', room, { left: pc(clamp(ax - rnd(rng, 26, 34), 6, 94)), top: '78%' });
        box('cs-chairback', room, { left: pc(clamp(ax + rnd(rng, 26, 34), 6, 94)), top: '78.6%' });
      }

      /* Table is cropped by the bottom edge: no visible legs, no verticals. */
      var table = box('cs-dining', room, { top: '84%', left: pc(ax + rnd(rng, -6, 6)) });
      box('cs-dining-top', table);
      box('cs-dining-apron', table);
      box('cs-runner', table);
      box('cs-bowl', table, { left: pc(rnd(rng, 20, 42)) });
      /* Round decor only: a hanging rope or a picture edge would be plumb by
         definition and would answer the question for the player. */
      if (d >= 3) {
        makeMirror(kit, room, { cx: ax < 50 ? rnd(rng, 78, 88) : rnd(rng, 12, 22), cy: rnd(rng, 30, 40), w: 15 });
        makeSconce(kit, room, { cx: ax < 50 ? rnd(rng, 12, 18) : rnd(rng, 82, 88), cy: rnd(rng, 26, 36), w: 8 });
      }

      box('cs-rose', room, { left: pc(ax), top: pc(ay) });

      var pend = box('cs-pendant', room, {
        left: pc(ax), top: pc(ay), width: pc(shadeW), height: pc(cordLen + 16)
      });
      var cordPct = (cordLen / (cordLen + 16)) * 100;
      box('cs-cord', pend, { height: pc(cordPct) });
      var shade = box('cs-shade', pend, { top: pc(cordPct) });
      box('cs-shade-cone', shade);
      box('cs-shade-rim', shade);
      box('cs-bulb', shade);
      box('cs-beam', shade);
      box('cs-pool', shade);

      finishRoom(kit, room);

      var band = [[2.6, 6.0], [2.0, 4.6], [1.5, 3.2]][d - 1];
      var state = { a: coin(rng) * rnd(rng, band[0], band[1]) };
      var revealed = false;

      function apply() { pend.style.setProperty('--rot', dg(state.a)); }
      apply();

      kit.drag(shade, {
        start: function (e) {
          var r = kit.rect();
          var px = r.left + (ax / 100) * r.width;
          var py = r.top + (ay / 100) * r.height;
          return { px: px, py: py, a0: state.a, t0: Math.atan2(e.clientX - px, Math.max(1, e.clientY - py)) };
        },
        move: function (dx, dy, data, e) {
          var t = Math.atan2(e.clientX - data.px, Math.max(1, e.clientY - data.py));
          // Positive rotation moves the below-pivot shade LEFT on screen, so the
          // shade only follows the pointer if the azimuth delta is subtracted.
          state.a = clamp(data.a0 - (t - data.t0) * 180 / Math.PI, -18, 18);
          apply();
        }
      });

      kit.arrows(function (key, shift) {
        if (key !== 'ArrowLeft' && key !== 'ArrowRight') return false;
        var step = shift ? 0.8 : 0.1;
        // Negative rotation swings the shade right (see drag handler above).
        state.a = clamp(state.a + (key === 'ArrowRight' ? -step : step), -18, 18);
        apply();
      });

      return {
        getScore: function () {
          return { error: Math.abs(state.a), unit: '°', maxError: tol(4, d) };
        },
        reveal: function () {
          if (revealed) return;
          revealed = true;
          kit.freeze();

          var ghost = ghostOf(pend, room, { '--rot': '0deg' });
          var line = box('cs-plumb', room, { left: pc(ax), top: pc(ay), '--len': pc(cordLen + 18) });
          var bob = box('cs-plumb-bob', line);
          box('cs-plumb-bob-tip', bob);

          turnOn(kit, line, 60);
          turnOn(kit, ghost, 420);
          kit.after(820, function () {
            pend.classList.add('cs-swing');
          });
        },
        destroy: function () { kit.destroy(); }
      };
    }
  };

  window.CHALLENGES = [
    hangTheFrame,
    centerTheArt,
    evenTheSpacing,
    matchTheHeights,
    plumbThePendant
  ];
})();
