(function () {
  'use strict';
  document.documentElement.classList.add('js');

  function track(name, params) {
    try {
      if (typeof window.gtag === 'function') { window.gtag('event', name, params || {}); }
    } catch (e) { /* analytics must never break the page */ }
  }

  var toggle = document.querySelector('.nav-toggle');
  var nav = document.getElementById('site-nav');
  if (toggle && nav) {
    toggle.addEventListener('click', function () {
      var open = nav.classList.toggle('open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }

  document.addEventListener('click', function (ev) {
    var t = ev.target;
    if (!(t instanceof Element)) { return; }

    var copy = t.closest('[data-copy]');
    if (copy) {
      var pre = document.getElementById(copy.getAttribute('data-copy'));
      if (pre) {
        var text = pre.textContent;
        var done = function () {
          var old = copy.textContent;
          copy.textContent = 'Copied';
          setTimeout(function () { copy.textContent = old; }, 1500);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(done, function () {});
        }
        track('mcp_copy', { client: copy.getAttribute('data-client') || 'unknown' });
      }
      return;
    }

    var ex = t.closest('[data-example]');
    if (ex) { track('example_click', { example: ex.getAttribute('data-example') }); }

    var a = t.closest('a[href]');
    if (!a) { return; }
    var href = a.getAttribute('href') || '';
    if (href.indexOf('mailto:') === 0) { track('contact_click', { link_url: href }); }
    if (href.indexOf('github.com/w1ne/udslib') !== -1) { track('github_click', { link_url: href }); }
  });

  if (/pricing\.html$/.test(location.pathname)) { track('pricing_view', {}); }
})();

// Feedback form: any element with [data-feedback] opens it. Posts to the UDSLib MCP Worker, which emails the maintainer.
(function () {
  var ENDPOINT = 'https://mcp.udslib.com/feedback';
  var dlg = null;
  function track(name, params) { try { if (window.gtag) { window.gtag('event', name, params || {}); } } catch (e) { /* optional */ } }
  function build() {
    dlg = document.createElement('dialog');
    dlg.className = 'feedback-dialog';
    dlg.innerHTML =
      '<form method="dialog" class="feedback-form" novalidate>' +
      '<h2>Send feedback</h2>' +
      '<p class="muted small">A bug, a trace format we do not read, an idea, or a question. It goes straight to the maintainer.</p>' +
      '<label>Topic<select name="category"><option value="general">General</option><option value="bug">Something is wrong</option>' +
      '<option value="trace-format">Trace format or tool request</option><option value="idea">Idea</option></select></label>' +
      '<label>Message<textarea name="message" rows="5" minlength="10" maxlength="4000" required placeholder="What happened, or what would help?"></textarea></label>' +
      '<label>Your email <span class="muted">(optional, only to reply)</span><input name="email" type="email" maxlength="254" autocomplete="email"></label>' +
      '<label class="hp" aria-hidden="true">Website<input name="website" tabindex="-1" autocomplete="off"></label>' +
      '<p class="muted small">Do not paste confidential traces or keys. See the <a href="privacy.html#categories">privacy policy</a>.</p>' +
      '<p class="feedback-status" role="status"></p>' +
      '<div class="feedback-actions"><button type="button" class="btn secondary" data-close>Cancel</button><button type="submit" class="btn">Send</button></div>' +
      '</form>';
    document.body.appendChild(dlg);
    var form = dlg.querySelector('form');
    var status = dlg.querySelector('.feedback-status');
    dlg.querySelector('[data-close]').addEventListener('click', function () { dlg.close(); });
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var msg = form.message.value.trim();
      if (msg.length < 10) { status.textContent = 'Please write at least 10 characters.'; return; }
      var btn = form.querySelector('button[type=submit]');
      btn.disabled = true;
      status.textContent = 'Sending…';
      fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: msg, email: form.email.value.trim(), category: form.category.value, page: location.pathname, website: form.website.value, product: 'udslib.com' })
      }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); }).then(function (res) {
        btn.disabled = false;
        if (res.ok) {
          status.textContent = 'Thanks, sent.' + (form.email.value ? ' We will reply by email.' : '');
          track('feedback_sent', { category: form.category.value });
          form.message.value = '';
          setTimeout(function () { if (dlg.open) { dlg.close(); } status.textContent = ''; }, 1800);
        } else {
          var e = res.body && res.body.error;
          status.textContent = e === 'rate_limited' ? 'Too many messages from this connection; try again in an hour or email andrii@shylenko.com.'
            : e === 'invalid_email' ? 'That email address does not look right.'
            : 'Could not send. Please email andrii@shylenko.com instead.';
        }
      }).catch(function () {
        btn.disabled = false;
        status.textContent = 'Could not send. Please email andrii@shylenko.com instead.';
      });
    });
  }
  document.addEventListener('click', function (ev) {
    var t = ev.target.closest && ev.target.closest('[data-feedback]');
    if (!t) { return; }
    ev.preventDefault();
    if (!dlg) { build(); }
    var cat = t.getAttribute('data-feedback');
    if (cat) { dlg.querySelector('select[name=category]').value = cat; }
    if (typeof dlg.showModal === 'function') { dlg.showModal(); } else { dlg.setAttribute('open', ''); }
    dlg.querySelector('textarea').focus();
    track('feedback_open', { category: cat || 'general' });
  });
})();
