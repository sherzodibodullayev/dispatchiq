/* ---------------------------------------------------------------------------
   DispatchIQ — the copilot client.

   Drives both the floating panel (every page) and the /demo console: the two
   share element ids on purpose, so there is exactly one chat client on the
   site. Talks to /api/chat and /api/audio-question. The conversation id lives
   in localStorage, so a visitor who closes the tab keeps the thread.
   ------------------------------------------------------------------------- */
(function () {
  'use strict';

  var thread = document.getElementById('thread');
  if (!thread) return;

  var form = document.getElementById('composer');
  var input = document.getElementById('input');
  var send = document.getElementById('send');
  var mic = document.getElementById('mic');
  var status = document.getElementById('status-text');
  var reset = document.getElementById('reset');

  var KEY = 'dispatchiq.conversation';
  var LANG_KEY = 'dispatchiq.language';
  var conversationId = localStorage.getItem(KEY) || null;
  // English by default — the market is the United States. The switch exists
  // because a visitor changing language mid-conversation is the shortest
  // demonstration of what the product does.
  var language = localStorage.getItem(LANG_KEY) || 'en';
  var busy = false;

  var IDLE_NOTE = 'You are talking to an AI agent. Ask for a person any time and it will get you one.';
  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* --- helpers ----------------------------------------------------------- */

  function setStatus(text, tone) {
    status.textContent = text;
    // The shimmer rides only on the working state — it is a progress signal,
    // not decoration, so idle and error text stays still.
    status.className = 'mono' + (tone ? ' is-' + tone : '') +
      (tone === 'live' ? ' shimmer' : '');
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* Minimal markdown: the model emits **bold**, `code`, links and dashed
     lists. Anything else stays literal — safer than pulling in a parser. */
  function format(text) {
    var safe = escapeHtml(text);

    safe = safe
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
               '<a href="$2" target="_blank" rel="noopener">$1</a>');

    // The model mixes a lead-in line with bullets inside one block, so group
    // runs of list lines rather than requiring the whole block to be a list.
    return safe.split(/\n{2,}/).map(function (block) {
      var out = '';
      var para = [];
      var items = [];

      function flushPara() {
        if (para.length) { out += '<p>' + para.join('<br>') + '</p>'; para = []; }
      }
      function flushList() {
        if (items.length) { out += '<ul>' + items.join('') + '</ul>'; items = []; }
      }

      block.split('\n').forEach(function (line) {
        if (/^\s*[-*]\s+/.test(line)) {
          flushPara();
          items.push('<li>' + line.replace(/^\s*[-*]\s+/, '') + '</li>');
        } else {
          flushList();
          para.push(line);
        }
      });

      flushPara();
      flushList();
      return out;
    }).join('');
  }

  /* After the frame, not during it: a message can change the layout around it
     as it lands — the panel drops its starter cards on the first answer, and
     lists reflow once formatted — and scrolling before that settles leaves the
     last line cut off. */
  function scrollDown() {
    thread.scrollTop = thread.scrollHeight;
    requestAnimationFrame(function () { thread.scrollTop = thread.scrollHeight; });
  }

  function addMessage(role, html, meta) {
    var el = document.createElement('div');
    el.className = 'msg msg--' + role;
    el.innerHTML =
      '<span class="msg__who">' + (role === 'op' ? 'YOU' : role === 'error' ? '!' : 'S') + '</span>' +
      '<div class="msg__body">' + html +
      (meta ? '<span class="msg__meta">' + escapeHtml(meta) + '</span>' : '') +
      '</div>';
    thread.appendChild(el);
    scrollDown();
    return el;
  }

  function addTyping() {
    var el = document.createElement('div');
    el.className = 'msg msg--ai';
    el.id = 'typing';
    el.innerHTML = '<span class="msg__who">S</span>' +
      '<div class="msg__body"><span class="dots"><span></span><span></span><span></span></span></div>';
    thread.appendChild(el);
    scrollDown();
  }

  function removeTyping() {
    var el = document.getElementById('typing');
    if (el) el.remove();
  }

  function setBusy(state) {
    busy = state;
    send.disabled = state;
    mic.disabled = state;
  }

  /* --- typing out an answer ---------------------------------------------- */
  /* The formatted HTML is put in place first and its text emptied, then filled
     back in. Typing the markup itself character by character would put half a
     tag on screen. */

  var typing = null;

  function finishTyping() {
    if (typing) { typing.finish(); typing = null; }
  }

  function typeInto(body, html) {
    body.innerHTML = html;

    var slots = [];
    (function walk(node) {
      for (var c = node.firstChild; c; c = c.nextSibling) {
        if (c.nodeType === 3) {
          if (c.nodeValue) { slots.push({ node: c, text: c.nodeValue }); c.nodeValue = ''; }
        } else if (c.nodeType === 1) {
          walk(c);
        }
      }
    })(body);

    function restore() {
      slots.forEach(function (s) { s.node.nodeValue = s.text; });
      body.classList.remove('is-typing');
    }

    var total = slots.reduce(function (n, s) { return n + s.text.length; }, 0);
    if (reducedMotion || total < 3) { restore(); scrollDown(); return; }

    // Any answer finishes inside about two and a half seconds — a long one
    // types faster rather than making the reader wait longer for it.
    var TICK = 16;
    var step = Math.max(2, Math.ceil(total / (2400 / TICK)));
    var si = 0, ci = 0;

    body.classList.add('is-typing');

    var id = setInterval(function () {
      var budget = step;
      while (budget > 0 && si < slots.length) {
        var slot = slots[si];
        var take = Math.min(budget, slot.text.length - ci);
        ci += take;
        budget -= take;
        slot.node.nodeValue = slot.text.slice(0, ci);
        if (ci >= slot.text.length) { si++; ci = 0; }
      }
      scrollDown();
      if (si >= slots.length) { clearInterval(id); body.classList.remove('is-typing'); typing = null; }
    }, TICK);

    typing = {
      finish: function () { clearInterval(id); restore(); scrollDown(); }
    };
  }

  function handleAnswer(data) {
    if (data.conversation_id) {
      conversationId = data.conversation_id;
      localStorage.setItem(KEY, conversationId);
    }
    var el = addMessage('ai', '');
    typeInto(el.querySelector('.msg__body'), format(data.answer));
  }

  function failure(err) {
    removeTyping();
    var msg = (err && err.detail) ||
      'Something went wrong on our side. Try again in a moment — or email ' +
      'hello@dispatchiq.com and a person will pick it up.';
    addMessage('error', '<p>' + escapeHtml(msg) + '</p>');
    setStatus('Not sent — try again', 'alert');
  }

  /* --- text ------------------------------------------------------------- */

  function ask(text) {
    if (busy || !text.trim()) return;

    // A new question lands the previous answer in full rather than leaving it
    // half written above it.
    finishTyping();

    addMessage('op', '<p>' + escapeHtml(text) + '</p>');
    input.value = '';
    input.style.height = 'auto';
    setBusy(true);
    setStatus('Thinking…', 'live');
    addTyping();

    fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: text,
        conversation_id: conversationId,
        language: language
      })
    })
      .then(function (r) {
        return r.json().then(function (body) {
          if (!r.ok) throw body;
          return body;
        });
      })
      .then(function (data) {
        removeTyping();
        handleAnswer(data);
        setStatus(IDLE_NOTE);
      })
      .catch(failure)
      .finally(function () { setBusy(false); input.focus(); });
  }

  // Tapping the answer skips the rest of the typing — nobody should have to
  // wait for an animation to read a figure they already asked for.
  thread.addEventListener('click', finishTyping);

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    ask(input.value);
  });

  // Enter sends, Shift+Enter breaks the line — the phone-thumb convention.
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      ask(input.value);
    }
  });

  input.addEventListener('input', function () {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 160) + 'px';
  });

  /* --- starter chips ----------------------------------------------------- */

  document.querySelectorAll('.chip').forEach(function (chip) {
    chip.addEventListener('click', function () {
      input.value = chip.dataset.q;
      input.dispatchEvent(new Event('input'));
      // In the floating panel the cards are the whole opening screen. Filling
      // the box and waiting for a second tap is one tap too many on a phone.
      if (chip.closest('.chips--panel')) { ask(input.value); return; }
      input.focus();
    });
  });

  /* --- language ---------------------------------------------------------- */

  document.querySelectorAll('.lang').forEach(function (btn) {
    if (btn.dataset.lang === language) {
      document.querySelectorAll('.lang').forEach(function (b) { b.classList.remove('is-active'); });
      btn.classList.add('is-active');
    }
    btn.addEventListener('click', function () {
      language = btn.dataset.lang;
      localStorage.setItem(LANG_KEY, language);
      document.querySelectorAll('.lang').forEach(function (b) { b.classList.remove('is-active'); });
      btn.classList.add('is-active');
      setStatus('Answering in ' + btn.textContent + ' from here on', 'live');
    });
  });

  /* --- reset ------------------------------------------------------------- */

  reset.addEventListener('click', function () {
    if (conversationId) {
      fetch('/api/conversations/' + conversationId + '?language=' + language, { method: 'DELETE' })
        .catch(function () { /* the local thread is cleared either way */ });
    }
    conversationId = null;
    localStorage.removeItem(KEY);
    thread.querySelectorAll('.msg:not(.msg--intro)').forEach(function (m) { m.remove(); });
    setStatus('Cleared. Nothing from the last conversation carries over.');
  });

  /* --- voice ------------------------------------------------------------- */
  /* ponytail: MediaRecorder with whatever mime the browser gives us. Safari
     hands back mp4/aac, Chrome webm/opus — Whisper accepts both, so there is
     no client-side transcoding here. */

  var recorder = null;
  var chunks = [];

  if (!navigator.mediaDevices || !window.MediaRecorder) {
    mic.disabled = true;
    mic.title = 'Voice input needs a newer browser';
  }

  mic.addEventListener('click', function () {
    if (recorder && recorder.state === 'recording') {
      recorder.stop();
      return;
    }

    navigator.mediaDevices.getUserMedia({ audio: true })
      .then(function (stream) {
        chunks = [];
        recorder = new MediaRecorder(stream);

        recorder.ondataavailable = function (e) {
          if (e.data.size > 0) chunks.push(e.data);
        };

        recorder.onstop = function () {
          stream.getTracks().forEach(function (t) { t.stop(); });
          mic.classList.remove('is-recording');
          sendAudio(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }));
        };

        recorder.start();
        mic.classList.add('is-recording');
        setStatus('Recording — tap the mic again to send', 'live');
      })
      .catch(function () {
        setStatus('No microphone access. Check the site permission and try again.', 'alert');
      });
  });

  function sendAudio(blob) {
    if (blob.size < 1200) {
      setStatus('That recording was too short to hear. Hold it a beat longer.', 'alert');
      return;
    }

    var ext = (blob.type.indexOf('mp4') > -1) ? 'mp4' : 'webm';
    var data = new FormData();
    data.append('audio_file', blob, 'question.' + ext);
    data.append('language', language);
    if (conversationId) data.append('conversation_id', conversationId);

    setBusy(true);
    setStatus('Transcribing…', 'live');
    addTyping();

    fetch('/api/audio-question', { method: 'POST', body: data })
      .then(function (r) {
        return r.json().then(function (body) {
          if (!r.ok) throw body;
          return body;
        });
      })
      .then(function (result) {
        removeTyping();
        if (result.transcribed_text) {
          addMessage('op', '<p>' + escapeHtml(result.transcribed_text) + '</p>', 'Voice');
        }
        handleAnswer(result);
        setStatus(IDLE_NOTE);
      })
      .catch(failure)
      .finally(function () { setBusy(false); });
  }

  /* --- restore ----------------------------------------------------------- */

  if (conversationId) {
    fetch('/api/conversations/' + conversationId + '?language=' + language)
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data || !data.conversation || !data.conversation.length) return;
        data.conversation.forEach(function (m) {
          addMessage(m.role === 'user' ? 'op' : 'ai', format(m.content));
        });
        setStatus('Picked up where you left off.');
      })
      .catch(function () { /* a fresh thread is a fine fallback */ });
  }

  setStatus(IDLE_NOTE);
})();
