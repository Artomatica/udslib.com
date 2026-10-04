#!/usr/bin/env python3
"""Static checks for the site: links, titles, h1, meta, GA tag, shared nav."""
import sys
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent.parent
GA = 'G-JXF0DBSEDH'
NAV_LINKS = ['examples.html', 'faq.html', 'pricing.html', 'mcp.html', 'whitepaper.html']


class P(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links, self.ids = [], set()
        self.h1 = 0
        self.title = ''
        self.in_title = False
        self.desc = False
        self.nav_hrefs = set()
        self.in_nav = False

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if 'id' in a:
            self.ids.add(a['id'])
        if tag == 'h1':
            self.h1 += 1
        if tag == 'title':
            self.in_title = True
        if tag == 'meta' and a.get('name') == 'description' and a.get('content'):
            self.desc = True
        if tag == 'nav' and a.get('id') == 'site-nav':
            self.in_nav = True
        if tag == 'a' and self.in_nav and 'href' in a:
            self.nav_hrefs.add(a['href'])
        for k in ('href', 'src'):
            if k in a and tag in ('a', 'link', 'script', 'img'):
                self.links.append(a[k])

    def handle_endtag(self, tag):
        if tag == 'title':
            self.in_title = False
        if tag == 'nav':
            self.in_nav = False

    def handle_data(self, data):
        if self.in_title:
            self.title += data


def main():
    errors = []
    pages = sorted(ROOT.glob('*.html'))
    parsed = {}
    for f in pages:
        text = f.read_text(encoding='utf-8')
        p = P()
        p.feed(text)
        parsed[f.name] = p
        if not p.title.strip():
            errors.append(f'{f.name}: missing <title>')
        if p.h1 != 1:
            errors.append(f'{f.name}: expected 1 h1, found {p.h1}')
        if not p.desc:
            errors.append(f'{f.name}: missing meta description')
        if GA not in text:
            errors.append(f'{f.name}: missing GA tag')
        if 'rel="canonical"' not in text:
            errors.append(f'{f.name}: missing canonical')
        for n in NAV_LINKS:
            if n not in p.nav_hrefs:
                errors.append(f'{f.name}: nav missing {n}')
        if 'src="site.js"' not in text:
            errors.append(f'{f.name}: site.js not loaded')
        if 'REPLACE' in text:
            print(f'note: {f.name} still has the REPLACE placeholder')
    for f in pages:
        for link in parsed[f.name].links:
            u = urlparse(link)
            if u.scheme in ('http', 'https', 'mailto') or link.startswith('//'):
                continue
            target = u.path.lstrip('/') or 'index.html'
            path = ROOT / target
            if not path.exists():
                errors.append(f'{f.name}: broken link {link}')
                continue
            if u.fragment and path.suffix == '.html':
                tp = parsed.get(path.name)
                if tp and u.fragment not in tp.ids:
                    errors.append(f'{f.name}: missing anchor {link}')
    for name in ('style.css', 'site.js', 'llms.txt', 'sitemap.xml', 'robots.txt', 'favicon.svg'):
        if not (ROOT / name).exists():
            errors.append(f'missing file {name}')
    sm = (ROOT / 'sitemap.xml').read_text()
    for f in pages:
        loc = 'https://udslib.com/' + ('' if f.name == 'index.html' else f.name)
        if f'<loc>{loc}</loc>' not in sm:
            errors.append(f'sitemap missing {loc}')
    if errors:
        print('\n'.join(errors))
        sys.exit(1)
    print(f'ok: {len(pages)} pages checked')


if __name__ == '__main__':
    main()
