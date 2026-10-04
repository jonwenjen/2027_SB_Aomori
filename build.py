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
    maps/gemini-my-maps-task.md   the import, written as a task for an AI agent

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
SITE_URL = 'https://jonwenjen.github.io/2027_SB_Aomori/'
TASK_MD = 'gemini-my-maps-task.md'
MAP_TITLE = '2027 東北滑雪・在地推薦'
# layer file -> (layer name, colour, hex, icon to search for in My Maps)
LAYER_STYLE = {
    STAYS_CSV: ('00 住宿與停留點', '黑', '#000000', 'Hotel / Lodging（床）'),
    '01-正餐名物.csv': ('01 正餐名物', '紅', '#A52714', 'Restaurant（刀叉）'),
    '02-甜點糕點.csv': ('02 甜點糕點', '粉', '#C2185B', 'Cake / Cafe（蛋糕）'),
    '03-特色飲品地酒.csv': ('03 特色飲品・地酒', '棕', '#795548', 'Bar / Drink（酒杯）'),
    '04-必買伴手禮.csv': ('04 必買伴手禮', '紫', '#9C27B0', 'Gift（禮物）'),
    '05-必逛店家選物.csv': ('05 必逛店家・生活選物', '藍', '#0288D1', 'Shopping（購物袋）'),
    '06-必訪景點.csv': ('06 必訪景點', '綠', '#097138', 'Camera / Landmark（相機）'),
}


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


def build_task_md(csvs: dict[str, str]) -> str:
    """The My Maps import as a self-contained brief another AI agent (Gemini
    with browser control) can carry out, or walk a person through. Generated,
    so the file list, URLs and expected counts always match the CSVs."""
    def rows(text: str) -> int:
        return sum(1 for _ in csv.reader(io.StringIO(text))) - 1

    names = sorted(csvs)
    total = sum(rows(csvs[n]) for n in names)
    table = ['| # | 圖層名稱 | 檔案 | 地點數 | 顏色 | 圖示（在「更多圖示」搜尋） |',
             '| --- | --- | --- | ---: | --- | --- |']
    urls = []
    for i, n in enumerate(names):
        layer, colour, hexv, icon = LAYER_STYLE[n]
        url = SITE_URL + 'maps/' + urllib.parse.quote(n)
        table.append('| %d | %s | [%s](%s) | %d | %s `%s` | %s |'
                     % (i + 1, layer, n, url, rows(csvs[n]), colour, hexv, icon))
        urls.append(url)
    report = '\n'.join('%s | %d | ? | ?' % (LAYER_STYLE[n][0], rows(csvs[n])) for n in names)

    return '''<!-- 由 build.py 依 itinerary.json 產生，請勿手改；名單一改，這份會跟著重產。 -->

# 任務：建立 Google My Maps「%(title)s」

> 這是給 **Gemini** 的執行說明。使用者會把整份文件交給你，請照著做，最後依「回報格式」輸出結果。

## 0. 先確認你能不能直接操作

這個任務必須在 <https://www.google.com/maps/d/> 上點選操作，沒有 API 可以代勞。

- **你能控制瀏覽器**（例如在 Chrome 裡以代理模式執行）→ 直接執行第 2–6 節，遇到「選擇檔案」視窗若無法操作，請使用者代為選檔，再接手。
- **你只能聊天** → 改成「帶使用者一步一步做」：每次只給一個步驟，等使用者回覆完成或貼截圖再給下一步。

## 1. 目標

一張 Google My Maps，名為「%(title)s」，內含 7 個圖層（住宿 1 層＋在地推薦 6 大類各 1 層），共 %(total)d 個地點。每層一種顏色和圖示，分享設定為「知道連結的任何人可檢視」。完成後回報地圖 ID（`mid`）和定位失敗的地點。

這張地圖會被嵌入行程網站 <%(site)s> 的「住宿周邊地圖」區塊，並出現在使用者手機 Google 地圖 App 的「已儲存 › 地圖」。

## 2. 檔案

| 欄位 | 用途 |
| --- | --- |
| 名稱 | 地標標題 |
| 地點 | **用來定位**（Google 搜尋字串，已含城市名） |
| 類別、住宿區域、推薦日、亮點／說明、評分、距離 | 顯示在地標資訊卡 |
| Google地圖、食べログ | 連結 |

%(table)s

取得檔案的兩種方式，擇一：

- **A. 雲端硬碟**：若使用者的 Google 雲端硬碟已有這 7 個 CSV（例如資料夾「2027_SB_Aomori_maps」），匯入時選「Google 雲端硬碟」分頁直接挑檔。
- **B. 下載**：從上表連結下載到電腦，匯入時選「上傳」。

## 3. 建立地圖

1. 開 <https://www.google.com/maps/d/> →「建立新地圖」（Create a new map）。
2. 點左上「無標題的地圖」，標題填 `%(title)s`，說明填 `2027-02-09 – 02-24 青森・岩手・東京。行程網站：%(site)s`。

## 4. 匯入 7 個圖層（依表格順序）

第 1 個檔案用預設的「無標題的圖層」；之後每個檔案先按「新增圖層」（Add layer）。每個圖層都做：

1. 按該圖層下的「匯入」（Import）→ 選檔案。
2. 「選擇用於放置地標的欄位」（Choose columns to position your placemarks）：**只勾「地點」**，其他都不要勾 → 繼續。
3. 「選擇作為地標標題的欄位」（Choose a column to title your markers）：選 **「名稱」** → 完成。
4. 若出現「有 N 列無法顯示在地圖上」（rows couldn't be shown），**照實記下 N**，並點「開啟資料表」把那幾列的「名稱」和「地點」抄下來。**不要手動拖動或修改地標**，只要記錄。
5. 圖層名稱改成表格中的「圖層名稱」（點圖層名稱即可改）。
6. 點「統一樣式」（Uniform style）旁的油漆桶 → 選表格指定的顏色（選最接近的色塊即可）→「更多圖示」（More icons）搜尋表格中的圖示關鍵字。標籤（Set labels）保持「無」，避免地圖上字太多。

My Maps 上限 10 個圖層、每層 2,000 個地點，7 個圖層沒問題。

## 5. 分享

1. 右上「分享」（Share）。
2. 開啟「知道連結的任何人都能檢視」（Enable link sharing），權限為**檢視者**（Viewer）。
3. 「允許他人在網際網路上搜尋及找到這張地圖」先**保持關閉**。
4. 不要新增任何協作者，不要給任何人編輯權限。

## 6. 取得地圖 ID

網址列會像 `https://www.google.com/maps/d/edit?mid=XXXXXXXXXXXX&usp=sharing`，`mid=` 之後到 `&` 之前那一串就是地圖 ID。

## 7. 不要做的事

- 不要改 CSV 的內容、欄位名稱或刪列。
- 不要手動移動地標或「修正」定位錯誤，只要回報。
- 不要動使用者雲端硬碟或 My Maps 裡的其他檔案。
- 不要給任何人編輯權限。

## 8. 回報格式

完成後請**只**輸出下面這段（使用者會原樣貼回給 Claude，用來更新網站）：

```
my_maps_mid: <地圖 ID>
share_url: <分享連結>

圖層 | 預期 | 實際顯示 | 無法定位
%(report)s

無法定位的列：
- [圖層名稱] 名稱｜地點
（沒有就寫「無」）
```
''' % {'title': MAP_TITLE, 'total': total, 'site': SITE_URL, 'table': '\n'.join(table), 'report': report}


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
    csvs = build_map_csvs(data)
    outputs += [(MAPS_DIR / name, text) for name, text in csvs.items()]
    outputs.append((MAPS_DIR / TASK_MD, build_task_md(csvs)))

    if args.check:
        stale = [str(p.relative_to(ROOT)) for p, want in outputs
                 if (p.read_text(encoding='utf-8') if p.exists() else '') != want]
        if stale:
            print('%s out of date -- run: python3 build.py' % ', '.join(stale), file=sys.stderr)
            return 1
        print('index.html, sw.js and maps/ are up to date; data valid.')
        return 0

    MAPS_DIR.mkdir(exist_ok=True)
    for path, text in outputs:
        path.write_text(text, encoding='utf-8')
    summarise(data, len(html.encode('utf-8')))
    print('  service worker  : sw.js (cache %s)' % sw.split("VERSION = '", 1)[1][:12])
    print('  My Maps layers  : %d CSV + %s in maps/' % (len(csvs), TASK_MD))
    return 0


if __name__ == '__main__':
    sys.exit(main())
