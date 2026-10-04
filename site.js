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
