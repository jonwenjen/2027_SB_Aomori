#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Bundle template.html + itinerary.json into a single standalone index.html.

    python3 build.py            # write index.html
    python3 build.py --check    # verify index.html is up to date (CI)

The built page carries its own data, so it works from a file:// URL, from
GitHub Pages, or from anywhere else without a second request. If the
placeholder is ever left unreplaced the page falls back to fetching
itinerary.json, so the template is still usable on its own.
"""
from __future__ import annotations

import argparse
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent
TEMPLATE = ROOT / 'template.html'
DATA = ROOT / 'itinerary.json'
OUTPUT = ROOT / 'index.html'
PLACEHOLDER = '__ITINERARY_JSON__'

REQUIRED_TOP_LEVEL = (
    'trip_title', 'flights', 'days', 'venues',
    'predeparture_checklist', 'contingency_plans',
)


def load_data() -> dict:
    with DATA.open(encoding='utf-8') as fh:
        data = json.load(fh)

    missing = [key for key in REQUIRED_TOP_LEVEL if key not in data]
    if missing:
        raise SystemExit('itinerary.json is missing: %s' % ', '.join(missing))
    return data


def embed(data: dict) -> str:
    """Serialise the data so it is safe inside a <script> element.

    `</script>` anywhere in the JSON would end the element early, and a raw
    U+2028/U+2029 is a line terminator in older JS parsers, so both are
    escaped. json.dumps already escapes the backslashes it emits.
    """
    payload = json.dumps(data, ensure_ascii=False, separators=(',', ':'))
    return (payload
            .replace('<', '\\u003c')
            .replace('>', '\\u003e')
            .replace(' ', '\\u2028')
            .replace(' ', '\\u2029'))


def build() -> str:
    template = TEMPLATE.read_text(encoding='utf-8')
    if PLACEHOLDER not in template:
        raise SystemExit('template.html no longer contains %s' % PLACEHOLDER)
    return template.replace(PLACEHOLDER, embed(load_data()))


def summarise(data: dict) -> None:
    ski = sum(1 for v in data['venues'] if v.get('kind') == 'ski')
    checks = sum(len(g['items']) for g in data['predeparture_checklist'])
    recs = sum(len(items)
               for day in data['days']
               for items in (day.get('recommendations') or {}).values())
    print('  days            : %d' % len(data['days']))
    print('  venue cards     : %d (%d ski / %d other)'
          % (len(data['venues']), ski, len(data['venues']) - ski))
    print('  checklist items : %d in %d groups'
          % (checks, len(data['predeparture_checklist'])))
    print('  recommendations : %d' % recs)
    print('  contingencies   : %d' % len(data['contingency_plans']))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true',
                        help='exit non-zero if index.html is out of date')
    args = parser.parse_args()

    html = build()

    if args.check:
        current = OUTPUT.read_text(encoding='utf-8') if OUTPUT.exists() else ''
        if current != html:
            print('index.html is out of date -- run: python3 build.py', file=sys.stderr)
            return 1
        print('index.html is up to date.')
        return 0

    OUTPUT.write_text(html, encoding='utf-8')
    print('built %s (%.1f KB)' % (OUTPUT.name, len(html.encode('utf-8')) / 1024))
    summarise(load_data())
    return 0


if __name__ == '__main__':
    sys.exit(main())
