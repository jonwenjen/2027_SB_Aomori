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
    maps/*.csv       one file per Google My Maps layer (stays + 6 categories)

The built page carries its own styles, script and data, so it opens from a
file:// URL or from GitHub Pages with no second request for anything it
needs to render; sw.js then keeps a copy for when there is no signal.

The data is validated before anything is written. A broken reference or a
malformed phone number fails the build rather than shipping a page that
misbehaves on a mountain.
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import hashlib
import io
import json
import pathlib
import re
import sys
import urllib.parse

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
MAPS_DIR = ROOT / 'maps'

PH_STYLES = '/*@@STYLES@@*/'
PH_APP = '//@@APP@@'
PH_DATA = '__ITINERARY_JSON__'

REQUIRED_TOP_LEVEL = (
    'trip_title', 'flights', 'days', 'venues', 'predeparture_checklist',
    'packing_list', 'contingency_plans', 'emergency', 'forecast_meta',
    'stays', 'stay_maps',
)
VENUE_KINDS = {'ski', 'museum', 'attraction', 'event', 'market'}
TEL_RE = re.compile(r'^\+?[0-9]+$')
URL_RE = re.compile(r'^https?://')
SLUG_RE = re.compile(r'^[a-z0-9-]+$')
MID_RE = re.compile(r'^[A-Za-z0-9_-]{10,80}$')

# Recommendation categories, in display order, with the My Maps layer file
# each one becomes. Keep in step with CATEGORIES in src/app.js.
CATEGORIES = (
    ('restaurant', '正餐名物', '01-正餐名物.csv'),
    ('dessert_pastry', '甜點糕點', '02-甜點糕點.csv'),
    ('beverage', '特色飲品・地酒', '03-特色飲品地酒.csv'),
    ('souvenir', '必買伴手禮', '04-必買伴手禮.csv'),
    ('specialty_shops', '必逛店家・生活選物', '05-必逛店家選物.csv'),
    ('attractions', '必訪景點推薦', '06-必訪景點.csv'),
)
STAYS_CSV = '00-住宿與停留點.csv'
STAY_KINDS = {'hotel': '住宿', 'stop': '停留點'}


def map_query(url: str) -> str:
    """The place a Google Maps search link points at, as plain text."""
    qs = urllib.parse.parse_qs(urllib.parse.urlsplit(url or '').query)
    return (qs.get('query') or [''])[0].strip()


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

    # recommendations: known categories, and every place resolvable on a map
    known = {c[0] for c in CATEGORIES}
    for day in data['days']:
        for cat, items in (day.get('recommendations') or {}).items():
            if cat not in known:
                err('day %s: unknown recommendation category %r' % (day.get('day_number'), cat))
                continue
            for it in items:
                if not it.get('name') or not map_query(it.get('map_url', '')):
                    err('day %s/%s: %r needs a name and a Google Maps search link'
                        % (day.get('day_number'), cat, it.get('name')))

    # stays: each day with recommendations sits in exactly one stay
    day_numbers = {d.get('day_number') for d in data['days']}
    owner: dict[int, str] = {}
    stay_ids = set()
    for st in data['stays']:
        sid = st.get('id')
        where = 'stay %r' % sid
        if not isinstance(sid, str) or not SLUG_RE.match(sid) or sid in stay_ids:
            err('%s: id must be a unique lowercase slug' % where)
        stay_ids.add(sid)
        if st.get('kind') not in STAY_KINDS:
            err('%s: kind must be one of %s' % (where, ', '.join(STAY_KINDS)))
        if not st.get('area') or not st.get('map_query'):
            err('%s: needs an area and a map_query' % where)
        days = st.get('days') or []
        if not days:
            err('%s: lists no days' % where)
        for n in days:
            if n not in day_numbers:
                err('%s: day %r does not exist' % (where, n))
            elif n in owner:
                err('%s: day %d is already in stay %r' % (where, n, owner[n]))
            else:
                owner[n] = sid
        if days and sorted(days) != list(range(min(days), max(days) + 1)):
            err('%s: days %r are not consecutive' % (where, days))
        c = st.get('center') or {}
        lat, lon = c.get('lat'), c.get('lon')
        if not (isinstance(lat, (int, float)) and 24 <= lat <= 46 and
                isinstance(lon, (int, float)) and 122 <= lon <= 154):
            err('%s: center %r,%r is not in Japan' % (where, lat, lon))
        if not isinstance(st.get('zoom'), int) or not 5 <= st['zoom'] <= 18:
            err('%s: zoom must be an integer 5-18' % where)
    for d in data['days']:
        if d.get('recommendations') and d.get('day_number') not in owner:
            err('day %s has recommendations but belongs to no stay' % d.get('day_number'))
    mid = (data['stay_maps'] or {}).get('my_maps_mid', '')
    if mid and not MID_RE.match(mid):
        err('stay_maps.my_maps_mid %r does not look like a My Maps id' % mid)

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


# ── My Maps layers ────────────────────────────────────────────────────
def _csv(rows: list[list[str]]) -> str:
    buf = io.StringIO()
    csv.writer(buf, lineterminator='\n').writerows(rows)
    return buf.getvalue()


def _days_label(nums) -> str:
    return 'Day ' + '・'.join(str(n) for n in sorted(nums))


def build_map_csvs(data: dict) -> dict[str, str]:
    """One CSV per Google My Maps layer: the stays, then one per category.

    My Maps geocodes the 地點 column with Google's own search, the same text
    the site's "地圖" links already search for, so pins land where those links
    do. A place recommended on several days, or at two stays, is one row.
    """
    stay_of = {n: st for st in data['stays'] for n in st['days']}
    files: dict[str, str] = {}

    head = ['名稱', '地點', '類別', '住宿區域', '推薦日', '說明', 'Google地圖']
    rows = [head]
    for st in data['stays']:
        url = 'https://www.google.com/maps/search/?api=1&query=' + urllib.parse.quote(st['map_query'])
        rows.append([st.get('name') or st['area'], st['map_query'], STAY_KINDS[st['kind']],
                     st['area'], _days_label(st['days']), st.get('name_sub', ''), url])
    files[STAYS_CSV] = _csv(rows)

    head = ['名稱', '地點', '類別', '住宿區域', '推薦日', '亮點', '評分', '距離', 'Google地圖', '食べログ']
    for key, label, fname in CATEGORIES:
        merged: dict[str, dict] = {}
        for day in data['days']:
            st = stay_of.get(day['day_number'])
            for it in (day.get('recommendations') or {}).get(key) or []:
                q = map_query(it['map_url'])
                row = merged.setdefault(q, {'it': it, 'areas': [], 'days': set()})
                if st and st['area'] not in row['areas']:
                    row['areas'].append(st['area'])
                row['days'].add(day['day_number'])
        rows = [head]
        for q, row in merged.items():
            it = row['it']
            rows.append([it['name'], q, label, '・'.join(row['areas']), _days_label(row['days']),
                         it.get('highlights', ''), it.get('rating', ''),
                         re.sub(r'^📍\s*', '', it.get('distance') or ''),
                         it['map_url'], it.get('tabelog_url', '')])
        files[fname] = _csv(rows)
    return files


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
    outputs = [(OUTPUT, html), (SW_OUT, sw)]
    outputs += [(MAPS_DIR / name, text) for name, text in build_map_csvs(data).items()]

    if args.check:
        stale = [str(p.relative_to(ROOT)) for p, want in outputs
                 if (p.read_text(encoding='utf-8') if p.exists() else '') != want]
        if stale:
            print('%s out of date -- run: python3 build.py' % ', '.join(stale), file=sys.stderr)
            return 1
        print('index.html, sw.js and maps/*.csv are up to date; data valid.')
        return 0

    MAPS_DIR.mkdir(exist_ok=True)
    for path, text in outputs:
        path.write_text(text, encoding='utf-8')
    summarise(data, len(html.encode('utf-8')))
    print('  service worker  : sw.js (cache %s)' % sw.split("VERSION = '", 1)[1][:12])
    print('  My Maps layers  : %d CSV in maps/' % (len(outputs) - 2))
    return 0


if __name__ == '__main__':
    sys.exit(main())
