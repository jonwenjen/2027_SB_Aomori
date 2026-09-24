#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Bundle src/ + itinerary.json into a single standalone index.html.

    python3 build.py            # validate data, write index.html
    python3 build.py --check    # verify index.html is up to date (CI)

Sources:
    src/index.html   page shell with three placeholders
    src/styles.css   inlined at /*@@STYLES@@*/
    src/app.js       inlined at //@@APP@@
    itinerary.json   inlined at __ITINERARY_JSON__
    src/sw.js        written to sw.js with its cache named after the page hash

The built page carries its own styles, script and data, so it opens from a
file:// URL or from GitHub Pages with no second request for anything it
needs to render; sw.js then keeps a copy for when there is no signal.

The data is validated before anything is written. A broken reference or a
malformed phone number fails the build rather than shipping a page that
misbehaves on a mountain.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent
SRC = ROOT / 'src'
SHELL = SRC / 'index.html'
STYLES = SRC / 'styles.css'
APP = SRC / 'app.js'
DATA = ROOT / 'itinerary.json'
OUTPUT = ROOT / 'index.html'
SW_SRC = SRC / 'sw.js'
SW_OUT = ROOT / 'sw.js'
PH_SW_VERSION = '__BUILD_HASH__'

PH_STYLES = '/*@@STYLES@@*/'
PH_APP = '//@@APP@@'
PH_DATA = '__ITINERARY_JSON__'

REQUIRED_TOP_LEVEL = (
    'trip_title', 'flights', 'days', 'venues', 'predeparture_checklist',
    'packing_list', 'contingency_plans', 'emergency', 'forecast_meta',
)
VENUE_KINDS = {'ski', 'museum', 'attraction', 'event', 'market'}
TEL_RE = re.compile(r'^\+?[0-9]+$')
URL_RE = re.compile(r'^https?://')


# ── validation ────────────────────────────────────────────────────────
def validate(data: dict) -> list[str]:
    """Return a list of human-readable problems; empty means the data is sound."""
    errors: list[str] = []
    err = errors.append

    for key in REQUIRED_TOP_LEVEL:
        if key not in data:
            err('missing top-level key: %s' % key)
    if errors:
        return errors

    # days: numbered 1..N on consecutive dates
    prev = None
    for i, day in enumerate(data['days'], 1):
        where = 'days[%d]' % (i - 1)
        if day.get('day_number') != i:
            err('%s: day_number is %r, expected %d' % (where, day.get('day_number'), i))
        try:
            date = dt.date.fromisoformat(day.get('date', ''))
        except ValueError:
            err('%s: bad date %r' % (where, day.get('date')))
            continue
        if prev and date != prev + dt.timedelta(days=1):
            err('%s: %s does not follow %s' % (where, date, prev))
        prev = date
        if not day.get('day_title'):
            err('%s: empty day_title' % where)
        transit = day.get('transit') or {}
        if not transit.get('summary') or not isinstance(transit.get('details'), list):
            err('%s: transit needs a summary and a details list' % where)

    # venues: unique ids, known kinds, sane links and forecast points
    venue_ids = set()
    for v in data['venues']:
        vid = v.get('id')
        where = 'venue %r' % vid
        if not vid or vid in venue_ids:
            err('%s: missing or duplicate id' % where)
        venue_ids.add(vid)
        if v.get('kind') not in VENUE_KINDS:
            err('%s: unknown kind %r' % (where, v.get('kind')))
        if len(v.get('stats') or []) < 4:
            err('%s: needs at least 4 stats' % where)
        for link in v.get('links') or []:
            if not URL_RE.match(link.get('url', '')):
                err('%s: bad link url %r' % (where, link.get('url')))
        f = v.get('forecast')
        if f is not None:
            lat, lon = f.get('lat'), f.get('lon')
            if not (isinstance(lat, (int, float)) and 24 <= lat <= 46 and
                    isinstance(lon, (int, float)) and 122 <= lon <= 154):
                err('%s: forecast point %r,%r is not in Japan' % (where, lat, lon))
            if f.get('confidence') not in ('verified', 'estimated'):
                err('%s: forecast confidence must be verified or estimated' % where)
        if v.get('kind') == 'ski' and f is None:
            err('%s: ski venue without a forecast point' % where)

    # days may only reference venues that exist
    for day in data['days']:
        for vid in day.get('venue_ids') or []:
            if vid not in venue_ids:
                err('day %s: unknown venue id %r' % (day.get('day_number'), vid))

    # checklist and packing: ids unique across BOTH lists (they share the DOM)
    seen: dict[str, str] = {}
    for list_name in ('predeparture_checklist', 'packing_list'):
        for g in data[list_name]:
            for it in g.get('items') or []:
                iid = it.get('id')
                if not iid:
                    err('%s/%s: item without id' % (list_name, g.get('id')))
                elif iid in seen:
                    err('%s: duplicate item id %r (also in %s)' % (list_name, iid, seen[iid]))
                else:
                    seen[iid] = list_name
                if not it.get('text'):
                    err('%s: item %r has no text' % (list_name, iid))
                link = it.get('link')
                if link and not URL_RE.match(link.get('url', '')):
                    err('%s: item %r has a bad link' % (list_name, iid))

    # emergency numbers: a tel: link must be dialable exactly as written
    for g in data['emergency'].get('groups') or []:
        for e in g.get('entries') or []:
            t = e.get('tel')
            if t is not None and not TEL_RE.match(t):
                err('emergency %r: tel %r is not digits' % (e.get('label'), t))

    return errors


# ── bundling ──────────────────────────────────────────────────────────
def load_data() -> dict:
    with DATA.open(encoding='utf-8') as fh:
        return json.load(fh)


def embed_json(data: dict) -> str:
    """Serialise data so it is safe inside a <script> element.

    `</script>` anywhere in the JSON would end the element early, and raw
    U+2028/U+2029 are line terminators to older JS parsers, so all are
    escaped. json.dumps already escapes the backslashes it emits.
    """
    payload = json.dumps(data, ensure_ascii=False, separators=(',', ':'))
    return (payload
            .replace('<', '\\u003c')
            .replace('>', '\\u003e')
            .replace(' ', '\\u2028')
            .replace(' ', '\\u2029'))


def read_source(path: pathlib.Path, forbidden: str) -> str:
    text = path.read_text(encoding='utf-8').rstrip('\n')
    if forbidden in text.lower():
        raise SystemExit('%s contains %r, which would end the inline block early'
                         % (path.relative_to(ROOT), forbidden))
    return text


def build(data: dict) -> str:
    shell = SHELL.read_text(encoding='utf-8')
    for ph in (PH_STYLES, PH_APP, PH_DATA):
        if shell.count(ph) != 1:
            raise SystemExit('src/index.html must contain %s exactly once' % ph)

    # Code first, data last: once the JSON is in place nothing else scans the
    # document, so no string inside the itinerary can ever be mistaken for a
    # placeholder. The count is re-checked after inlining in case a source
    # file happened to contain the data marker.
    html = shell.replace(PH_STYLES, read_source(STYLES, '</style'))
    html = html.replace(PH_APP, read_source(APP, '</script'))
    if html.count(PH_DATA) != 1:
        raise SystemExit('%s appears in src/styles.css or src/app.js' % PH_DATA)
    return html.replace(PH_DATA, embed_json(data))


def build_sw(html: str) -> str:
    """The service worker's cache name is a hash of the page it serves, so a
    rebuild with any change retires the old offline copy automatically."""
    template = SW_SRC.read_text(encoding='utf-8')
    if template.count(PH_SW_VERSION) != 1:
        raise SystemExit('src/sw.js must contain %s exactly once' % PH_SW_VERSION)
    digest = hashlib.sha256(html.encode('utf-8')).hexdigest()[:12]
    return template.replace(PH_SW_VERSION, digest)


def summarise(data: dict, size: int) -> None:
    ski = sum(1 for v in data['venues'] if v.get('kind') == 'ski')
    checks = sum(len(g['items']) for g in data['predeparture_checklist'])
    packing = sum(len(g['items']) for g in data['packing_list'])
    recs = sum(len(items) for day in data['days']
               for items in (day.get('recommendations') or {}).values())
    tels = sum(1 for g in data['emergency']['groups'] for e in g['entries'] if e.get('tel'))
    print('built %s (%.1f KB)' % (OUTPUT.name, size / 1024))
    print('  days            : %d' % len(data['days']))
    print('  venue cards     : %d (%d ski / %d other)' % (len(data['venues']), ski, len(data['venues']) - ski))
    print('  checklist items : %d' % checks)
    print('  packing items   : %d' % packing)
    print('  recommendations : %d' % recs)
    print('  emergency tel   : %d' % tels)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--check', action='store_true',
                        help='exit non-zero if index.html is out of date')
    args = parser.parse_args()

    data = load_data()
    problems = validate(data)
    if problems:
        print('itinerary.json failed validation:', file=sys.stderr)
        for p in problems:
            print('  - ' + p, file=sys.stderr)
        return 1

    html = build(data)
    sw = build_sw(html)

    if args.check:
        stale = [p.name for p, want in ((OUTPUT, html), (SW_OUT, sw))
                 if (p.read_text(encoding='utf-8') if p.exists() else '') != want]
        if stale:
            print('%s out of date -- run: python3 build.py' % ' and '.join(stale), file=sys.stderr)
            return 1
        print('index.html and sw.js are up to date; data valid.')
        return 0

    OUTPUT.write_text(html, encoding='utf-8')
    SW_OUT.write_text(sw, encoding='utf-8')
    summarise(data, len(html.encode('utf-8')))
    print('  service worker  : sw.js (cache %s)' % sw.split("VERSION = '", 1)[1][:12])
    return 0


if __name__ == '__main__':
    sys.exit(main())
