/* ---------------------------------------------------------------------------
   Site chrome: sticky masthead, mobile nav, the hero photo rotator, tabbed
   panels, the capability finder, the newsletter form, and the floating
   copilot shell.

   The chat client itself lives in chat.js and drives both the panel here and
   the /demo page — the panel deliberately carries the same element ids.
   ------------------------------------------------------------------------- */
(function () {
  'use strict';

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* --- masthead ---------------------------------------------------------- */

  var masthead = document.getElementById('masthead');
  if (masthead) {
    var stick = function () {
      masthead.classList.toggle('is-stuck', window.scrollY > 16);
    };
    stick();
    window.addEventListener('scroll', stick, { passive: true });
  }

  /* --- mobile nav -------------------------------------------------------- */

  var toggle = document.getElementById('navtoggle');
  var nav = document.getElementById('nav');
  if (toggle && nav) {
    var setNav = function (open) {
      nav.classList.toggle('is-open', open);
      toggle.setAttribute('aria-expanded', String(open));
    };

    toggle.addEventListener('click', function () {
      setNav(toggle.getAttribute('aria-expanded') !== 'true');
    });

    nav.addEventListener('click', function (e) {
      if (e.target.tagName === 'A') setNav(false);
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') setNav(false);
    });

    // Tapping anywhere else closes it. Without this the menu covers the page
    // and the only way out is the toggle, which is now behind the panel.
    document.addEventListener('click', function (e) {
      if (!nav.contains(e.target) && !toggle.contains(e.target)) setNav(false);
    });
  }

  /* --- hero photo rotator ------------------------------------------------ */
  /* Three frames crossfading on a fixed interval. The markup already has the
     first frame visible, so with no JS the hero is simply a photograph; this
     only ever adds motion on top of a finished state.

     It pauses when the hero scrolls out of view and when the tab is hidden —
     a timer firing against an off-screen element is pure battery. */

  var stage = document.getElementById('heroStage');
  if (stage) {
    var slides = [].slice.call(stage.querySelectorAll('.hero__slide'));
    var dotsBox = document.getElementById('heroDots');
    var gap = parseInt(stage.getAttribute('data-interval'), 10) || 3000;

    if (slides.length > 1 && !reduced) {
      stage.classList.add('is-live');
      var at = 0;
      var timer = null;
      var dots = [];

      if (dotsBox) {
        slides.forEach(function (slide, i) {
          var dot = document.createElement('button');
          dot.type = 'button';
          dot.className = 'hero__dot' + (i === 0 ? ' is-on' : '');
          dot.setAttribute('aria-label', 'Show image ' + (i + 1) + ' of ' + slides.length);
          dot.addEventListener('click', function () { show(i); restart(); });
          dotsBox.appendChild(dot);
          dots.push(dot);
        });
      }

      function show(i) {
        at = (i + slides.length) % slides.length;
        slides.forEach(function (s, n) { s.classList.toggle('is-on', n === at); });
        dots.forEach(function (d, n) { d.classList.toggle('is-on', n === at); });
      }

      function tick() { show(at + 1); }
      function start() { if (!timer) timer = setInterval(tick, gap); }
      function stop() { clearInterval(timer); timer = null; }
      function restart() { stop(); start(); }

      if ('IntersectionObserver' in window) {
        new IntersectionObserver(function (entries) {
          entries[0].isIntersecting ? start() : stop();
        }, { threshold: 0.15 }).observe(stage);
      } else {
        start();
      }

      document.addEventListener('visibilitychange', function () {
        document.hidden ? stop() : start();
      });

      // Hovering the photo holds the frame — someone reading the caption of a
      // slide should not have it swapped out from under them.
      stage.addEventListener('pointerenter', stop);
      stage.addEventListener('pointerleave', start);
    }
  }

  /* --- tabbed panels ----------------------------------------------------- */
  /* Any .tabs whose buttons carry aria-controls. Keyboard arrows move between
     tabs, which is what a tablist is expected to do. */

  document.querySelectorAll('.tabs[role="tablist"]').forEach(function (list) {
    var tabs = [].slice.call(list.querySelectorAll('.tab[aria-controls]'));
    if (!tabs.length) return;

    function select(tab) {
      tabs.forEach(function (t) {
        var on = t === tab;
        t.classList.toggle('is-on', on);
        t.setAttribute('aria-selected', String(on));
        var pane = document.getElementById(t.getAttribute('aria-controls'));
        if (pane) pane.hidden = !on;
      });
    }

    tabs.forEach(function (tab, i) {
      tab.addEventListener('click', function () { select(tab); });
      tab.addEventListener('keydown', function (e) {
        var step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (!step) return;
        e.preventDefault();
        var next = tabs[(i + step + tabs.length) % tabs.length];
        next.focus();
        select(next);
      });
    });
  });

  /* --- capability finder ------------------------------------------------- */
  /* The list is here rather than in the template because the tag filter and
     the search box both render from it, and keeping one copy means the two
     can never disagree about what exists.

     Everything below is drawn from the business plan; `planned` marks the
     items the plan flags as roadmap rather than initial product, and the card
     says so on its face so nobody reads the list as a feature inventory. */

  var CAPS = [
    { t: 'Load organization',        g: ['loads'],               s: 'Section 4',    d: 'Collect available loads into one list, pull out the detail, and drop the ones that cannot physically work.' },
    { t: 'Rate and equipment detail',g: ['loads', 'docs'],       s: 'Section 4',    d: 'Rate, commodity, weight and equipment requirements read off the load and the rate con, not retyped.' },
    { t: 'Pickup & delivery windows',g: ['loads', 'monitor'],    s: 'Section 4',    d: 'Appointment times captured against each load and watched against the truck that is covering it.' },
    { t: 'Load-to-truck matching',   g: ['matching'],            s: 'Section 8',    d: 'A ranked shortlist weighing truck location, destination, timing, equipment, cargo and driver availability.' },
    { t: 'Driver availability',      g: ['matching'],            s: 'Section 8',    d: 'Who is legally and practically available, read from the systems that already hold that answer.' },
    { t: 'Operational preferences',  g: ['matching'],            s: 'Section 8',    d: 'Lanes you want, lanes you do not, brokers you will not run for — applied to the ranking rather than argued with.' },
    { t: 'Rate confirmations',       g: ['docs'],                s: 'Section 11',   d: 'Locations, appointment times, commodity, weight, equipment, reference numbers and broker detail extracted.' },
    { t: 'Bills of lading & PODs',   g: ['docs'],                s: 'Section 11',   d: 'Delivery paperwork read into the dispatch record instead of typed into it twice.' },
    { t: 'Lumper & detention paperwork', g: ['docs'],            s: 'Section 11',   d: 'The receipts that decide whether an accessorial gets billed, captured at the point they arrive.' },
    { t: 'Broker communications',    g: ['comms'],               s: 'Section 9',    d: 'Load inquiries, rate requests, appointment confirmations, delay notices and status updates, drafted for approval.' },
    { t: 'Driver dispatch messages', g: ['comms'],               s: 'Section 9',    d: 'Dispatch instructions, pickup detail, reminders and appointment changes, in the format the driver already reads.' },
    { t: 'Customer status & ETA',    g: ['comms'],               s: 'Section 9',    d: 'Shipment status, estimated arrival and exception notices, so the phone rings less.' },
    { t: 'Appointment alerts',       g: ['monitor'],             s: 'Section 4',    d: 'Approaching appointments, delayed pickups and delivery deadlines surfaced before they become the problem.' },
    { t: 'Missing-document alerts',  g: ['monitor', 'docs'],     s: 'Section 4',    d: 'The POD that never came back, flagged while the load is still fresh enough to chase.' },
    { t: 'Schedule conflicts',       g: ['monitor', 'matching'], s: 'Section 1',    d: 'Two commitments the same truck cannot both keep, caught at assignment rather than at the gate.' },
    { t: 'Dispatcher dashboard',     g: ['monitor'],             s: 'Section 7.1',  d: 'Trucks, drivers, assignments, loads, appointments, alerts and document status in one consolidated view.' },
    { t: 'Natural-language copilot', g: ['monitor', 'matching'], s: 'Section 7.2',  d: '"Which trucks are free tomorrow?" "Which deliveries are at risk?" — asked in words, answered against live data.' },
    { t: 'ELD integration',          g: ['integrations'],        s: 'Section 15',   d: 'Reads authorized operational data from your FMCSA-compliant device. It is not itself an ELD.' },
    { t: 'TMS integration',          g: ['integrations'],        s: 'Section 15',   d: 'Sits alongside the transportation-management system you already run rather than asking you to replace it.' },
    { t: 'Load-board integration',   g: ['integrations', 'loads'], s: 'Section 15', d: 'The boards you already source from, fed into one ranked list instead of five open tabs.' },
    { t: 'Email, SMS & mapping',     g: ['integrations', 'comms'], s: 'Section 15', d: 'The channels dispatch already runs on, plus the mapping service that makes travel time real.' },
    { t: 'Accounting integration',   g: ['integrations'],        s: 'Section 15',   d: 'Invoices and settlement detail handed to the system that does the books.' },
    { t: 'Voice AI',                 g: ['planned', 'comms'],    s: 'Section 10',   d: 'ROADMAP. "Find available reefer loads for the Dallas truck," hands-free. Not built; consent, recording and audit controls come with it.' },
    { t: 'Autonomous workflows',     g: ['planned'],             s: 'Section 21',   d: 'ROADMAP, Year 5. Predefined low-risk sequences executing without a click — after the human-approved version has earned it.' },
    { t: 'Predictive alerts',        g: ['planned', 'monitor'],  s: 'Section 21',   d: 'ROADMAP, Year 5. Flagging the delivery that is going to slip before anything has slipped.' },
    { t: 'Transportation analytics', g: ['planned'],             s: 'Section 21',   d: 'ROADMAP, Year 5. Revenue per truck, dispatcher load, exception rates — the operating picture over time.' }
  ];

  var capOut = document.getElementById('capOut');
  if (capOut) {
    var capTags = document.getElementById('capTags');
    var capForm = document.getElementById('capForm');
    var capQ = document.getElementById('capQ');
    var tag = 'all';

    // Six cards, then a toggle. The full list open is a wall of text where the
    // reference design shows a tidy filter row; a search or a tag pick is an
    // explicit request for detail, so those open the whole matching set.
    var PREVIEW = 6;
    var expanded = false;
    var more = document.getElementById('capMore');
    var moreBtn = document.getElementById('capMoreBtn');
    var count = document.getElementById('capCount');

    function render() {
      var q = (capQ && capQ.value || '').trim().toLowerCase();
      var hits = CAPS.filter(function (c) {
        if (tag !== 'all' && c.g.indexOf(tag) === -1) return false;
        if (!q) return true;
        return (c.t + ' ' + c.d + ' ' + c.g.join(' ')).toLowerCase().indexOf(q) !== -1;
      });

      capOut.textContent = '';

      if (!hits.length) {
        var none = document.createElement('p');
        none.className = 'finder__empty';
        none.textContent = 'Nothing matches “' + (capQ ? capQ.value : '') +
          '”. The copilot in the corner can tell you whether it is planned at all.';
        capOut.appendChild(none);
        if (more) more.hidden = true;
        return;
      }

      // A filter or a query is already a request for the detail; only the
      // untouched default view is collapsed.
      var browsing = !q && tag === 'all';
      var shown = (browsing && !expanded) ? hits.slice(0, PREVIEW) : hits;

      if (more) {
        more.hidden = !(browsing && hits.length > PREVIEW);
        if (moreBtn) moreBtn.textContent = expanded
          ? 'Show fewer'
          : 'View all ' + hits.length + ' capabilities';
        if (count) count.textContent = 'Showing ' + shown.length + ' of ' + hits.length;
      }

      shown.forEach(function (c) {
        var card = document.createElement('article');
        card.className = 'cap spot';

        var h = document.createElement('h4');
        h.textContent = c.t;

        var p = document.createElement('p');
        p.textContent = c.d;

        var m = document.createElement('span');
        m.className = 'cap__meta';
        m.textContent = c.s + (c.g.indexOf('planned') !== -1 ? ' · roadmap' : '');

        card.appendChild(h);
        card.appendChild(p);
        card.appendChild(m);
        capOut.appendChild(card);
      });
    }

    if (capTags) {
      capTags.addEventListener('click', function (e) {
        var btn = e.target.closest('.tag');
        if (!btn) return;
        capTags.querySelectorAll('.tag').forEach(function (t) { t.classList.remove('is-on'); });
        btn.classList.add('is-on');
        tag = btn.getAttribute('data-tag');
        expanded = false;
        render();
      });
    }

    if (capForm) capForm.addEventListener('submit', function (e) { e.preventDefault(); render(); });
    if (capQ) capQ.addEventListener('input', render);

    if (moreBtn) {
      moreBtn.addEventListener('click', function () {
        expanded = !expanded;
        render();
        if (!expanded) capOut.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
      });
    }

    render();
  }

  // The masthead's magnifier just puts the cursor in that search box.
  var searchJump = document.getElementById('searchjump');
  if (searchJump) {
    searchJump.addEventListener('click', function () {
      var box = document.getElementById('capQ');
      if (!box) { window.location.href = '/#capabilities'; return; }
      box.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
      box.focus({ preventScroll: true });
    });
  }

  /* --- resource filter --------------------------------------------------- */

  var resCards = document.getElementById('resCards');
  if (resCards) {
    document.querySelectorAll('.tab[data-res]').forEach(function (tab) {
      tab.addEventListener('click', function () {
        var pick = tab.getAttribute('data-res');
        document.querySelectorAll('.tab[data-res]').forEach(function (t) {
          t.classList.toggle('is-on', t === tab);
          t.setAttribute('aria-selected', String(t === tab));
        });
        resCards.querySelectorAll('.card').forEach(function (card) {
          card.hidden = pick !== 'all' && card.getAttribute('data-res') !== pick;
        });
      });
    });
  }

  /* --- newsletter -------------------------------------------------------- */
  /* There is no list to post to yet, and a form that silently POSTs nowhere is
     worse than one that says so. This validates, then tells the truth and
     points at the mailbox that is actually monitored. */

  var signup = document.getElementById('signup');
  if (signup) {
    signup.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!signup.reportValidity()) return;
      var ok = document.getElementById('signup-ok');
      if (!ok) return;
      ok.hidden = false;
      ok.textContent = 'Thanks — the list is not live yet, so email hello@dispatchiq.com ' +
                       'and you will be on it the day it opens.';
    });
  }

  /* --- scroll reveal ----------------------------------------------------- */

  var revealables = [].slice.call(document.querySelectorAll('.reveal'));

  function revealAll() {
    revealables.forEach(function (el) { el.classList.add('is-in'); });
  }

  if (reduced || !('IntersectionObserver' in window)) {
    revealAll();
  } else {
    // Failsafe: if the observer never fires, show everything anyway. A page
    // that stays blank is a far worse failure than one that skips an animation.
    setTimeout(revealAll, 4000);

    var seen = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-in');
        seen.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.06 });

    // Stagger siblings so a row of cards arrives as one gesture, not three.
    var groups = {};
    revealables.forEach(function (el) {
      var key = el.parentNode.className || 'root';
      groups[key] = (groups[key] || 0) + 1;
      el.style.transitionDelay = Math.min(groups[key] - 1, 4) * 90 + 'ms';
      seen.observe(el);
    });
  }

  /* --- floating copilot -------------------------------------------------- */
  /* The panel holds the same element ids as the /demo page, so chat.js is the
     only chat client on the site. This just opens and closes the shell. */

  var fab = document.getElementById('chatfab');
  var panel = document.getElementById('chatpanel');
  if (fab && panel) {
    var setPanel = function (open) {
      panel.hidden = !open;
      fab.setAttribute('aria-expanded', String(open));
      fab.classList.toggle('is-open', open);
      document.body.classList.toggle('chat-open', open);
      if (open) {
        // A restored thread was measured while the panel was hidden, so it has
        // no scroll position yet — land on the newest message, not the top of
        // last week's conversation.
        var thread = document.getElementById('thread');
        if (thread) thread.scrollTop = thread.scrollHeight;

        // Let the panel paint before focusing, or iOS scrolls the page instead.
        requestAnimationFrame(function () {
          var input = document.getElementById('input');
          if (input && window.innerWidth > 720) input.focus();
        });
      }
    };

    fab.addEventListener('click', function () { setPanel(panel.hidden); });

    var closeBtn = document.getElementById('chatclose');
    if (closeBtn) closeBtn.addEventListener('click', function () { setPanel(false); fab.focus(); });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !panel.hidden) { setPanel(false); fab.focus(); }
    });

    // Opt-in only: /demo is a real contact page on this site, so a link to it
    // navigates unless it explicitly asks for the panel instead.
    document.querySelectorAll('a[data-agent]').forEach(function (link) {
      link.addEventListener('click', function (e) {
        e.preventDefault();
        setPanel(true);
      });
    });
  }

  /* --- in-page anchors, offset for the sticky masthead ------------------- */

  document.querySelectorAll('a[data-scroll]').forEach(function (link) {
    link.addEventListener('click', function (e) {
      var target = document.querySelector(link.getAttribute('href').replace(/^\//, ''));
      if (!target) return;
      e.preventDefault();
      var top = target.getBoundingClientRect().top + window.scrollY - 92;
      window.scrollTo({ top: top, behavior: reduced ? 'auto' : 'smooth' });
    });
  });
})();
