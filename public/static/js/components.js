/* ---------------------------------------------------------------------------
   Ported components — behaviour.

   Each block below is one of the 21st.dev components the founder asked for,
   rebuilt for this stack (Jinja + vanilla JS) because the originals are React
   + Framer Motion. See components.css for the matching styles.

   House rules for everything in here:
     - the markup already contains the finished state, so no-JS is fine;
     - prefers-reduced-motion skips to that finished state;
     - nothing observes or animates while it is off screen.
   ------------------------------------------------------------------------- */
(function () {
  'use strict';

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var coarse = window.matchMedia('(hover: none)').matches;

  function onceInView(el, fn, threshold) {
    if (reduced || !('IntersectionObserver' in window)) { fn(); return; }
    var io = new IntersectionObserver(function (entries) {
      if (!entries[0].isIntersecting) return;
      io.disconnect();
      fn();
    }, { threshold: threshold || 0.2, rootMargin: '0px 0px -6% 0px' });
    io.observe(el);
  }

  /* =======================================================================
     reveal-text — blur + stagger, one word at a time
     ===================================================================== */

  // Subtrees that run their own animation must not be chopped into words.
  var NO_SPLIT = /\b(rotw|tw|no-split)\b/;

  function splitWords(root) {
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        for (var p = node.parentNode; p && p !== root; p = p.parentNode) {
          if (p.nodeType === 1 && NO_SPLIT.test(p.className || '')) {
            return NodeFilter.FILTER_REJECT;
          }
        }
        return node.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });

    var nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);

    var i = 0;
    nodes.forEach(function (node) {
      var frag = document.createDocumentFragment();
      // Keep the whitespace tokens: they are the word gaps, and inline-block
      // spans butt together without them.
      node.nodeValue.split(/(\s+)/).forEach(function (tok) {
        if (!tok) return;
        if (/^\s+$/.test(tok)) { frag.appendChild(document.createTextNode(tok)); return; }
        var s = document.createElement('span');
        s.className = 'rt__w';
        s.textContent = tok;
        // Capped, or a long paragraph's last word arrives seconds late.
        s.style.transitionDelay = Math.min(i, 24) * 34 + 'ms';
        i++;
        frag.appendChild(s);
      });
      node.parentNode.replaceChild(frag, node);
    });

    root.classList.add('is-split');
  }

  document.querySelectorAll('.rt').forEach(function (el) {
    if (reduced) { el.classList.add('is-in'); return; }
    splitWords(el);
    onceInView(el, function () { el.classList.add('is-in'); }, 0.15);

    // Splitting sets the words to opacity 0, so anything that stops the
    // observer from ever firing would leave a heading permanently blank. This
    // is the most important text on the page; it gets a backstop.
    setTimeout(function () { el.classList.add('is-in'); }, 6000);
  });


  /* =======================================================================
     animated-hero — the noun in the headline cycles
     ===================================================================== */

  document.querySelectorAll('.rotw').forEach(function (host) {
    var words = (host.dataset.words || '').split('|').map(function (w) { return w.trim(); })
                 .filter(Boolean);
    if (words.length < 2 || reduced) return;

    var live = host.querySelector('.rotw__w');
    if (!live) return;

    var at = words.indexOf(live.textContent.trim());
    if (at < 0) at = 0;

    // The container is width-clipped so the word can slide vertically, which
    // means a width that is even slightly short lops the last letter off.
    // Three things make a single measurement wrong:
    //   - the web font is usually still loading when this script runs,
    //   - the heading size is a clamp() on vw, so it changes with the window,
    //   - offsetWidth rounds down, and the gradient fill needs the sub-pixel.
    // So: measure in floats, keep a pixel of slack, and measure again whenever
    // either of those can have changed.
    var widths = [];
    var measuring = false;

    // `at` is only advanced halfway through a swap, so a re-measure landing in
    // that window would size the box to the previous word. Ask the DOM which
    // word is actually on screen instead.
    function shown() {
      var i = words.indexOf(live.textContent.trim());
      return i < 0 ? at : i;
    }

    function measure() {
      if (measuring) return;
      measuring = true;

      var rule = document.createElement('span');
      rule.className = 'rotw__w';
      rule.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;left:0;top:0;';
      host.appendChild(rule);
      widths = words.map(function (w) {
        rule.textContent = w;
        return Math.ceil(rule.getBoundingClientRect().width) + 1;
      });
      host.removeChild(rule);
      host.style.width = widths[shown()] + 'px';

      measuring = false;
    }

    measure();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure);

    // The heading is sized with clamp() on vw and set in a web font, so its
    // metrics change on load, on resize, and on browser zoom. Watching the
    // heading itself catches all three; a resize listener alone catches one.
    if (window.ResizeObserver) {
      var pending = false;
      new ResizeObserver(function () {
        if (pending) return;
        pending = true;
        requestAnimationFrame(function () { pending = false; measure(); });
      }).observe(host.parentNode || host);
    } else {
      var remeasure = null;
      window.addEventListener('resize', function () {
        clearTimeout(remeasure);
        remeasure = setTimeout(measure, 150);
      });
    }

    var timer = null;

    function step() {
      var next = (at + 1) % words.length;

      live.classList.add('is-out');
      host.style.width = widths[next] + 'px';

      setTimeout(function () {
        live.textContent = words[next];
        live.classList.remove('is-out');
        live.classList.add('is-in');
        // Next frame, or the browser folds both class changes into one paint
        // and the word appears without travelling.
        requestAnimationFrame(function () {
          requestAnimationFrame(function () { live.classList.remove('is-in'); });
        });
        at = next;
      }, 420);
    }

    function start() { if (!timer) timer = setInterval(step, 2600); }
    function stop() { clearInterval(timer); timer = null; }

    // Only while it is on screen and the tab is in front.
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (e) {
        e[0].isIntersecting ? start() : stop();
      }, { threshold: 0.1 }).observe(host);
    } else {
      start();
    }
    document.addEventListener('visibilitychange', function () {
      document.hidden ? stop() : start();
    });
  });


  /* =======================================================================
     text-three — typewriter, cycling phrases
     ===================================================================== */

  document.querySelectorAll('.tw').forEach(function (host) {
    var phrases = (host.dataset.phrases || '').split('|').map(function (p) { return p.trim(); })
                   .filter(Boolean);
    if (!phrases.length) return;

    var out = document.createElement('span');
    var caret = document.createElement('span');
    caret.className = 'tw__caret';
    caret.setAttribute('aria-hidden', 'true');

    // Screen readers get the full first phrase, not a stream of partial words.
    host.setAttribute('aria-label', phrases[0]);
    host.textContent = '';
    host.appendChild(out);
    host.appendChild(caret);

    if (reduced) { out.textContent = phrases[0]; return; }

    var TYPE = 46, ERASE = 24, HOLD = 1900, GAP = 420;
    var pi = 0, ci = 0, erasing = false, timer = null, running = false;

    function tick() {
      var p = phrases[pi];

      if (!erasing) {
        ci++;
        out.textContent = p.slice(0, ci);
        if (ci >= p.length) {
          erasing = true;
          timer = setTimeout(tick, phrases.length > 1 ? HOLD : 1e9);
          return;
        }
        timer = setTimeout(tick, TYPE);
      } else {
        ci--;
        out.textContent = p.slice(0, ci);
        if (ci <= 0) {
          erasing = false;
          pi = (pi + 1) % phrases.length;
          host.setAttribute('aria-label', phrases[pi]);
          timer = setTimeout(tick, GAP);
          return;
        }
        timer = setTimeout(tick, ERASE);
      }
    }

    function start() { if (!running) { running = true; tick(); } }
    function stop() { running = false; clearTimeout(timer); }

    onceInView(host, start, 0.3);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) stop(); else if (!running) start();
    });
  });


  /* =======================================================================
     spotlight-card — and the liquid-glass lens, which needs the same numbers
     ===================================================================== */

  if (!coarse) {
    var tracked = document.querySelectorAll('.spot, .btn--glass');
    var queued = false;
    var pending = [];

    function flush() {
      queued = false;
      pending.forEach(function (job) {
        job.el.style.setProperty('--mx', job.x + '%');
        job.el.style.setProperty('--my', job.y + '%');
      });
      pending = [];
    }

    tracked.forEach(function (el) {
      el.addEventListener('pointermove', function (e) {
        var r = el.getBoundingClientRect();
        pending.push({
          el: el,
          x: (((e.clientX - r.left) / r.width) * 100).toFixed(1),
          y: (((e.clientY - r.top) / r.height) * 100).toFixed(1)
        });
        if (!queued) { queued = true; requestAnimationFrame(flush); }
      }, { passive: true });
    });
  }


  /* =======================================================================
     The hero frame's scripted sequence.

     Reads the timeline off the markup: every .seq element carries data-at
     (ms from the start) and optionally data-type (type the text in over
     data-dur). Runs once, on scroll-in, then stops — the end state is the
     markup's own state, so nothing is lost if this never runs.
     ===================================================================== */

  document.querySelectorAll('.frame[data-seq]').forEach(function (frame) {
    var steps = [].slice.call(frame.querySelectorAll('.seq'));
    if (!steps.length) return;

    if (reduced) { steps.forEach(function (s) { s.classList.add('is-on'); }); return; }

    // Stash and clear the text of anything that will be typed.
    steps.forEach(function (el) {
      if (el.hasAttribute('data-type')) {
        el._full = el.textContent.replace(/\s+/g, ' ').trim();
        el.textContent = '';
      }
    });

    var timers = [];

    function typeInto(el, dur) {
      var full = el._full || '';
      if (!full) return;
      el.classList.add('is-typing');

      // The text was taken out of the DOM to be typed back in. If the frame
      // loop never runs — a background tab, a throttled embed — it would stay
      // out, and the hero would show an empty chat bubble. Put it back on a
      // timer no matter what the animation does.
      var safety = setTimeout(function () {
        el.textContent = full;
        el.classList.remove('is-typing');
      }, dur + 260);

      var started = null;
      requestAnimationFrame(function step(ts) {
        if (started === null) started = ts;
        var k = Math.min(1, (ts - started) / dur);
        el.textContent = full.slice(0, Math.round(full.length * k));
        if (k < 1) {
          requestAnimationFrame(step);
        } else {
          clearTimeout(safety);
          el.textContent = full;
          el.classList.remove('is-typing');
        }
      });
    }

    var ran = false;

    function run() {
      if (ran) return;
      ran = true;

      steps.forEach(function (el) {
        var at = parseInt(el.getAttribute('data-at'), 10) || 0;
        timers.push(setTimeout(function () {
          el.classList.add('is-on');

          if (el.hasAttribute('data-type')) {
            typeInto(el, parseInt(el.getAttribute('data-dur'), 10) || 600);
          }

          // A lead field lights up as the workflow engine writes it, then
          // settles — that highlight is the whole point of the animation.
          if (el.classList.contains('lead__row')) {
            el.classList.add('is-live');
            timers.push(setTimeout(function () {
              if (!el.classList.contains('lead__row--pending')) el.classList.remove('is-live');
            }, 900));
          }
        }, at));
      });
    }

    // A low threshold on purpose: on a phone the frame is taller than the
    // viewport, and asking for a quarter of it means the animation can start
    // well after the reader is already looking at it.
    onceInView(frame, run, 0.08);

    // Backstop. IntersectionObserver does not deliver in a document that is
    // not being rendered, and this frame holds the clearest explanation of
    // the product on the whole site — it must never sit there empty.
    setTimeout(run, 6000);

    // If the tab is hidden mid-run the timers still fire but nothing paints;
    // on return, snap to the finished state rather than replaying half of it.
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) return;
      timers.forEach(clearTimeout);
      steps.forEach(function (el) {
        el.classList.add('is-on');
        el.classList.remove('is-typing');
        if (el._full) el.textContent = el._full;
      });
    });
  });


  /* =======================================================================
     pricing — monthly/annual switch, counted figures, confetti
     ===================================================================== */

  (function pricing() {
    var sw = document.querySelector('.switch');
    if (!sw) return;

    var btns = [].slice.call(sw.querySelectorAll('.switch__btn'));
    var thumb = sw.querySelector('.switch__thumb');
    var nums = [].slice.call(document.querySelectorAll('.num'));
    var periods = [].slice.call(document.querySelectorAll('[data-period]'));

    function moveThumb(btn) {
      thumb.style.width = btn.offsetWidth + 'px';
      thumb.style.transform = 'translateX(' + (btn.offsetLeft - 4) + 'px)';
    }

    function fmt(n) { return Math.round(n).toLocaleString('en-US'); }

    var DUR = 520;

    function count(el, to) {
      // A newer switch must win: without a token, two fast clicks leave two
      // loops fighting over the same element.
      var token = (el._tok = (el._tok || 0) + 1);
      var from = parseFloat((el.textContent || '0').replace(/[^0-9.]/g, '')) || 0;

      clearTimeout(el._safety);
      if (reduced || from === to) { el.textContent = fmt(to); return; }

      // The animation is decoration; the figure is a price. requestAnimationFrame
      // stops in a background tab and is throttled by some embedded viewers, and
      // a count that halts mid-way would leave a WRONG NUMBER on screen. This
      // timer is the guarantee that it lands on the real one either way.
      el._safety = setTimeout(function () {
        if (el._tok === token) el.textContent = fmt(to);
      }, DUR + 160);

      var t0 = null;
      requestAnimationFrame(function step(ts) {
        if (el._tok !== token) return;
        if (t0 === null) t0 = ts;
        var k = Math.min(1, (ts - t0) / DUR);
        var e = 1 - Math.pow(1 - k, 3);           // easeOutCubic
        el.textContent = fmt(from + (to - from) * e);
        if (k < 1) {
          requestAnimationFrame(step);
        } else {
          el.textContent = fmt(to);
          clearTimeout(el._safety);
        }
      });
    }

    function confetti(origin) {
      if (reduced) return;
      var layer = document.createElement('div');
      layer.className = 'confetti';
      var colors = ['#2563EB', '#60A5FA', '#0EA5E9', '#A5B4FC', '#FBBF24', '#34D399'];
      var r = origin.getBoundingClientRect();
      var cx = r.left + r.width / 2, cy = r.top + r.height / 2;

      for (var i = 0; i < 26; i++) {
        var p = document.createElement('i');
        var ang = (Math.PI * 2 * i) / 26 + Math.random() * 0.4;
        var dist = 90 + Math.random() * 150;
        p.style.left = cx + 'px';
        p.style.top = cy + 'px';
        p.style.background = colors[i % colors.length];
        p.style.setProperty('--dx', Math.cos(ang) * dist + 'px');
        p.style.setProperty('--dy', (Math.sin(ang) * dist + 190) + 'px');
        p.style.setProperty('--rot', (Math.random() * 900 - 450) + 'deg');
        p.style.setProperty('--dur', (1100 + Math.random() * 700) + 'ms');
        layer.appendChild(p);
      }
      document.body.appendChild(layer);
      setTimeout(function () { layer.remove(); }, 2100);
    }

    function select(btn, userAction) {
      var key = btn.dataset.plan;                 // "m" | "y"
      btns.forEach(function (b) { b.classList.toggle('is-on', b === btn); });
      moveThumb(btn);

      nums.forEach(function (n) { count(n, parseFloat(n.dataset[key === 'y' ? 'y' : 'm'])); });
      periods.forEach(function (p) { p.textContent = key === 'y' ? 'per year, plus usage' : 'per month, plus usage'; });

      if (userAction && key === 'y') confetti(sw);
    }

    btns.forEach(function (b) {
      b.addEventListener('click', function () { select(b, true); });
    });

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) return;
      var key = (sw.querySelector('.switch__btn.is-on') || btns[0]).dataset.plan;
      nums.forEach(function (n) {
        clearTimeout(n._safety);
        n._tok = (n._tok || 0) + 1;
        n.textContent = fmt(parseFloat(n.dataset[key === 'y' ? 'y' : 'm']));
      });
    });

    var on = sw.querySelector('.switch__btn.is-on') || btns[0];
    // Fonts change button widths; measure after they land or the thumb is
    // the wrong size on first paint.
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () { moveThumb(on); });
    }
    moveThumb(on);
    window.addEventListener('resize', function () {
      moveThumb(sw.querySelector('.switch__btn.is-on') || btns[0]);
    });
  })();


  /* =======================================================================
     faq1 — one panel open at a time, animated both ways
     ===================================================================== */

  document.querySelectorAll('.faq').forEach(function (faq) {
    var all = [].slice.call(faq.querySelectorAll('details'));

    function close(d) {
      if (!d.open) return;
      if (reduced) { d.open = false; return; }
      d.classList.add('is-closing');
      setTimeout(function () {
        d.open = false;
        d.classList.remove('is-closing');
      }, 300);
    }

    all.forEach(function (d) {
      var summary = d.querySelector('summary');
      if (!summary) return;

      summary.addEventListener('click', function (e) {
        e.preventDefault();
        if (d.open) { close(d); return; }
        all.forEach(function (o) { if (o !== d) close(o); });
        d.open = true;
      });
    });
  });


  /* =======================================================================
     glsl-hills — layered ridges, drawn in WebGL

     Six ranges of summed sines, far ones pale and near ones deep, which is
     aerial perspective doing the depth work rather than a parallax hack.
     If WebGL is missing the canvas just never fades in and the CSS gradient
     underneath stands in for it.
     ===================================================================== */

  (function hills() {
    var canvas = document.querySelector('.hills');
    if (!canvas) return;

    var gl = canvas.getContext('webgl', { antialias: false, alpha: false, depth: false })
          || canvas.getContext('experimental-webgl');
    if (!gl) return;

    var VERT =
      'attribute vec2 p;' +
      'void main(){ gl_Position = vec4(p, 0.0, 1.0); }';

    var FRAG = [
      'precision mediump float;',
      'uniform vec2 uRes;',
      'uniform float uT;',

      // Three summed sines per ridge: enough to stop it reading as a wave,
      // cheap enough to run on a phone.
      'float ridge(float x, float s){',
      '  return sin(x * 1.7 + s) * 0.50',
      '       + sin(x * 3.1 + s * 2.3) * 0.26',
      '       + sin(x * 6.3 + s * 4.1) * 0.12;',
      '}',

      'void main(){',
      '  vec2 uv = gl_FragCoord.xy / uRes;',

      // Sky: pale at the horizon, our blue overhead.
      '  vec3 col = mix(vec3(0.925,0.965,0.992), vec3(0.392,0.678,0.898), pow(uv.y, 0.85));',

      // A low sun behind the ridges, just off centre.
      '  float d = distance(vec2(uv.x, uv.y * 1.35), vec2(0.62, 0.42 * 1.35));',
      '  col += vec3(1.0, 0.96, 0.88) * smoothstep(0.62, 0.0, d) * 0.30;',

      '  for (int i = 0; i < 6; i++) {',
      '    float f = float(i);',
      '    float base = 0.42 - f * 0.062;',
      '    float amp  = 0.050 - f * 0.0052;',
      '    float y = base + ridge(uv.x * 2.2 + f * 3.7 + uT * (0.045 + f * 0.016), f * 1.9) * amp;',
      '    float m = smoothstep(y + 0.0030, y - 0.0030, uv.y);',
      '    vec3 hc = mix(vec3(0.760,0.876,0.949), vec3(0.055,0.145,0.318), f / 5.0);',
      '    col = mix(col, hc, m);',
      '  }',

      '  gl_FragColor = vec4(col, 1.0);',
      '}'
    ].join('\n');

    function compile(type, src) {
      var s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        gl.deleteShader(s);
        return null;
      }
      return s;
    }

    var vs = compile(gl.VERTEX_SHADER, VERT);
    var fs = compile(gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return;

    var prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
    gl.useProgram(prog);

    // One triangle that covers the clip box — cheaper than two, and there is
    // no seam down the diagonal.
    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    var uRes = gl.getUniformLocation(prog, 'uRes');
    var uT = gl.getUniformLocation(prog, 'uT');

    function resize() {
      // Capped: this is a decorative band, not a texture anyone inspects, and
      // a 3x buffer on a phone costs more than it shows.
      var dpr = Math.min(window.devicePixelRatio || 1, coarse ? 1 : 1.5);
      var w = Math.max(1, Math.round(canvas.clientWidth * dpr));
      var h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width === w && canvas.height === h) return;
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
    }

    function draw(t) {
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uT, t);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    resize();
    draw(0);
    canvas.classList.add('is-ready');

    if (reduced) {
      window.addEventListener('resize', function () { resize(); draw(0); });
      return;
    }

    var raf = null, t0 = null;

    function loop(ts) {
      if (t0 === null) t0 = ts;
      resize();
      draw((ts - t0) / 1000);
      raf = requestAnimationFrame(loop);
    }

    function start() { if (!raf) raf = requestAnimationFrame(loop); }
    function stop() { cancelAnimationFrame(raf); raf = null; }

    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (e) {
        e[0].isIntersecting ? start() : stop();
      }, { threshold: 0.02 }).observe(canvas);
    } else {
      start();
    }
    document.addEventListener('visibilitychange', function () {
      document.hidden ? stop() : start();
    });
  })();

})();
