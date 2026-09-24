(function () {
  'use strict';

  var DOW = ['一', '二', '三', '四', '五', '六', '日'];
  var CL_KEY = 'sb2027.checklist.v1';
  var PACK_KEY = 'sb2027.packing.v1';
  var THEME_KEY = 'sb2027.theme.v1';
  var PERSONAL_KEY = 'sb2027.personal.v1';

  var CATEGORIES = [
    ['restaurant', '正餐名物', '🍱'],
    ['dessert_pastry', '甜點糕點', '🍰'],
    ['beverage', '特色飲品・地酒', '🍶'],
    ['souvenir', '必買伴手禮', '🎁'],
    ['specialty_shops', '必逛店家・生活選物', '🛍️'],
    ['attractions', '必訪景點推薦', '📍']
  ];

  function esc(v) {
    if (v === null || v === undefined) return '';
    return String(v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function el(id) { return document.getElementById(id); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function weekday(iso) {
    var p = String(iso).split('-');
    if (p.length !== 3) return '';
    var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
    if (isNaN(d.getTime())) return '';
    return '週' + DOW[(d.getUTCDay() + 6) % 7];
  }

  // localStorage can throw (private mode, blocked site data) and can return
  // empty. Every access is guarded; the page renders fine without it.
  function safeGet(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }
  function safeSet(key, value) {
    try { window.localStorage.setItem(key, value); return true; } catch (e) { return false; }
  }
  function safeRemove(key) {
    try { window.localStorage.removeItem(key); } catch (e) { /* ignore */ }
  }

  function makeStore(key) {
    return {
      read: function () {
        var raw = safeGet(key);
        if (!raw) return {};
        try {
          var parsed = JSON.parse(raw);
          return (parsed && typeof parsed === 'object') ? parsed : {};
        } catch (e) { return {}; }
      },
      write: function (obj) { return safeSet(key, JSON.stringify(obj)); },
      clear: function () { safeRemove(key); }
    };
  }

  // ── theme ───────────────────────────────────────────────────────
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    var dark = theme !== 'light';
    if (el('theme-ico')) el('theme-ico').textContent = dark ? '☾' : '☀';
    if (el('theme-label')) el('theme-label').textContent = dark ? 'Midnight' : 'Bone';
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#0B0B0D' : '#F4F1EA');
  }

  function initTheme() {
    // Midnight is the identity, so it is the default for a first-time visitor
    // regardless of the OS setting. Bone is opt-in and, once chosen, sticks.
    var stored = safeGet(THEME_KEY);
    applyTheme(stored === 'light' ? 'light' : 'dark');

    el('theme-toggle').addEventListener('click', function () {
      var next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
      applyTheme(next);
      safeSet(THEME_KEY, next);
    });
  }

  // ── hero ────────────────────────────────────────────────────────
  function renderHero(data) {
    var days = data.days || [];
    var venues = data.venues || [];

    if (data.trip_title) {
      document.title = data.trip_title;
      // split on the first "・" so the second half can carry the gold italic
      var parts = String(data.trip_title).split('・');
      el('trip-title').innerHTML = parts.length > 1
        ? esc(parts[0]) + '<br><span class="accent">' + esc(parts.slice(1).join('・')) + '</span>'
        : esc(data.trip_title);
    }

    // a ski day is any day that touches a ski venue -- derived, not stored,
    // so it cannot drift from the venue cards
    var skiIds = {};
    venues.forEach(function (v) { if (v.kind === 'ski') skiIds[v.id] = true; });
    var skiDays = days.filter(function (d) {
      return (d.venue_ids || []).some(function (id) { return skiIds[id]; });
    }).length;
    var recs = days.reduce(function (n, d) {
      var r = d.recommendations || {};
      return n + Object.keys(r).reduce(function (m, k) { return m + (r[k] || []).length; }, 0);
    }, 0);

    if (days.length) {
      el('hero-lede').textContent =
        days[0].date + ' — ' + days[days.length - 1].date +
        '，' + days.length + ' 天穿越青森與岩手的粉雪帶：' + skiDays +
        ' 個滑雪日、奧入瀨冰瀑與十和田湖冬物語，收在東京的最後兩夜。';
    }

    var figures = [
      [pad2(days.length), 'Days'],
      [pad2(venues.filter(function (v) { return v.kind === 'ski'; }).length), 'Ski Resorts'],
      [pad2(venues.length), 'Venue Cards'],
      [String(recs), 'Local Picks']
    ];
    el('hero-figures').innerHTML = figures.map(function (f) {
      return '<div class="figure"><span class="figure-n num">' + esc(f[0]) + '</span>' +
        '<span class="figure-l">' + esc(f[1]) + '</span></div>';
    }).join('');

    el('flight-container').innerHTML = (data.flights || []).map(function (f) {
      var dep = f.departure || {}, arr = f.arrival || {};
      var outbound = f.type === 'arrival';
      return '<div class="flight-card">' +
        '<span class="flight-ico">' + (outbound ? '↗' : '↘') + '</span>' +
        '<div><span class="flight-dir">' + (outbound ? 'Outbound' : 'Return') + ' · ' + esc(f.date) + '</span>' +
        '<h4>' + esc(f.airline) + '<span class="flight-no">' + esc(f.flight_number) + '</span></h4>' +
        '<p>' + esc(dep.airport) + ' ' + esc(dep.time) + ' → ' + esc(arr.airport) + ' ' + esc(arr.time) + '</p>' +
        '</div></div>';
    }).join('');

    var n = data.data_notes || {};
    el('footer-src').textContent = [n.stats_source, n.season_caveat,
      n.last_reviewed ? '資料覆核日：' + n.last_reviewed : ''].filter(Boolean).join(' ');
  }

  // ── checklist / packing list (one component, two instances) ─────
  // Both keep their own storage key and their own element ids, so ticking a
  // packing item never touches the pre-departure state and vice versa.
  function renderCheckGroups(cfg) {
    var shell = el(cfg.shellId);
    var groups = cfg.groups;
    if (!groups || !groups.length) { el(cfg.sectionId).style.display = 'none'; return; }

    var store = makeStore(cfg.storageKey);
    var p = cfg.prefix;
    var state = store.read();
    var total = groups.reduce(function (n, g) { return n + g.items.length; }, 0);

    function update(storageOk) {
      var s = store.read();
      var tot = 0, done = 0;

      groups.forEach(function (g) {
        var d = g.items.filter(function (it) { return s[it.id]; }).length;
        tot += g.items.length; done += d;
        var c = document.querySelector('[data-count-for="' + g.id + '"]');
        if (c) {
          c.textContent = d + '/' + g.items.length;
          c.style.color = (d === g.items.length) ? 'var(--ok)' : '';
        }
      });

      var pct = tot ? Math.round(done / tot * 100) : 0;
      var circ = 2 * Math.PI * 35;
      var bar = el(p + '-bar');
      if (bar) {
        bar.setAttribute('stroke-dasharray', circ.toFixed(1));
        bar.setAttribute('stroke-dashoffset', (circ * (1 - pct / 100)).toFixed(1));
        bar.style.stroke = (pct === 100) ? 'var(--ok)' : 'var(--gold)';
      }
      if (el(p + '-pct')) el(p + '-pct').textContent = pct + '%';
      if (el(p + '-headline')) {
        el(p + '-headline').textContent = (tot - done === 0)
          ? cfg.doneText : cfg.remainingText(tot - done);
      }
      if (el(p + '-subline')) el(p + '-subline').textContent = '已完成 ' + done + ' / ' + tot + ' 項';
      if (el(p + '-note')) {
        el(p + '-note').textContent = storageOk
          ? cfg.savedNote : '這個瀏覽器停用了本機儲存，勾選狀態只在本頁停留期間有效，重新整理後會消失。';
      }
    }

    var html =
      '<div class="cl-top">' +
        '<div class="ring">' +
          '<svg width="78" height="78" viewBox="0 0 78 78" aria-hidden="true">' +
            '<circle class="track" cx="39" cy="39" r="35" fill="none" stroke-width="1"></circle>' +
            '<circle class="bar" id="' + p + '-bar" cx="39" cy="39" r="35" fill="none" stroke-width="2" ' +
              'stroke-dasharray="219.9" stroke-dashoffset="219.9"></circle>' +
          '</svg>' +
          '<span class="pct num" id="' + p + '-pct">0%</span>' +
        '</div>' +
        '<div class="cl-top-text">' +
          '<strong id="' + p + '-headline">' + esc(cfg.remainingText(total)) + '</strong>' +
          '<span id="' + p + '-subline">已完成 0 / ' + total + ' 項</span>' +
        '</div>' +
        '<button class="btn-ghost" id="' + p + '-reset" type="button">Reset</button>' +
      '</div>';

    html += groups.map(function (g) {
      var items = g.items.map(function (it) {
        var meta = '';
        if (it.when) meta += '<span class="cl-when">' + esc(it.when) + '</span>';
        if (it.link && it.link.url) {
          meta += '<a class="cl-link" href="' + esc(it.link.url) +
            '" target="_blank" rel="noopener noreferrer">' + esc(it.link.label || '前往預約') + '</a>';
        }
        return '<div class="cl-item">' +
          '<input type="checkbox" id="' + esc(it.id) + '" data-cl-item="1"' + (state[it.id] ? ' checked' : '') + '>' +
          '<div class="cl-item-body">' +
            '<label for="' + esc(it.id) + '">' + esc(it.text) + '</label>' +
            (meta ? '<div class="cl-meta">' + meta + '</div>' : '') +
          '</div></div>';
      }).join('');

      var bodyId = nextId(p + '-body');
      return '<div class="cl-group" data-group="' + esc(g.id) + '" data-open="0">' +
        '<button class="cl-group-head" type="button" data-cl-toggle="1" aria-expanded="false" ' +
            'aria-controls="' + bodyId + '">' +
          '<span class="cl-g-ico">' + esc(g.icon || '') + '</span>' +
          '<span class="cl-g-name">' + esc(g.title) + '</span>' +
          '<span class="cl-count num" data-count-for="' + esc(g.id) + '">0/' + g.items.length + '</span>' +
          '<span class="chev">▼</span>' +
        '</button>' +
        (g.hint ? '<div class="cl-group-hint">' + esc(g.hint) + '</div>' : '') +
        '<div class="cl-body" id="' + bodyId + '">' + items + '</div>' +
      '</div>';
    }).join('');

    html += '<div class="cl-saved-note" id="' + p + '-note"></div>';
    shell.innerHTML = html;

    shell.addEventListener('click', function (ev) {
      var t = ev.target.closest('[data-cl-toggle]');
      if (t) toggleGroup(t);
    });

    shell.addEventListener('change', function (ev) {
      if (!ev.target.matches('[data-cl-item]')) return;
      var next = store.read();
      if (ev.target.checked) next[ev.target.id] = true;
      else delete next[ev.target.id];
      update(store.write(next));
    });

    el(p + '-reset').addEventListener('click', function () {
      if (!window.confirm(cfg.resetPrompt)) return;
      store.clear();
      Array.prototype.forEach.call(shell.querySelectorAll('[data-cl-item]'), function (b) { b.checked = false; });
      update(true);
    });

    update(store.write(state));
  }

  // ── venues ──────────────────────────────────────────────────────
  function statHtml(s) {
    var value = String(s.value == null ? '' : s.value);
    return '<div class="stat">' +
      '<span class="stat-label">' + esc(s.icon || '') + ' ' + esc(s.label) + '</span>' +
      '<span class="stat-value num' + (value.length > 9 ? ' is-long' : '') + '">' + esc(value) + '</span>' +
      (s.sub ? '<span class="stat-sub">' + esc(s.sub) + '</span>' : '') +
      '</div>';
  }

  function linkHtml(l) {
    return '<a class="lnk lnk-' + esc(l.kind || 'official') + '" href="' + esc(l.url) +
      '" target="_blank" rel="noopener noreferrer">' + esc(l.label) + '</a>';
  }

  function venueCardHtml(v) {
    var dayLabel = (v.days && v.days.length)
      ? v.days.map(function (d) { return 'Day ' + d; }).join(' · ') : '';

    var notes = (v.notes || []).map(function (n) {
      return '<p class="note' + (n.indexOf('✅') === 0 ? ' is-ok' : '') + '">' + esc(n) + '</p>';
    }).join('');

    var fcBlock = '';
    if (v.forecast && v.forecast.lat != null && v.forecast.lon != null) {
      fcBlock = '<div class="fc-block" data-fc-id="' + esc(v.id) + '" data-fc="' +
          esc(JSON.stringify(v.forecast)) + '">' +
        '<div class="fc-head">' +
          '<span class="fc-title">未來 ' + (FC_META.days || 3) + ' 天雪況</span>' +
          '<span class="fc-src">資料：<a href="' + esc(FC_META.provider_url || 'https://open-meteo.com/') +
            '" target="_blank" rel="noopener noreferrer">' + esc(FC_META.provider || 'Open-Meteo') + '</a></span>' +
        '</div>' +
        '<div class="fc-frame" data-fc-frame="1"><span class="fc-state">展開後讀取雪況</span></div>' +
        '<div class="fc-foot" data-fc-foot="1"></div>' +
      '</div>';
    }

    var mapBlock = '';
    if (v.map_image && v.map_image.url) {
      mapBlock = '<div class="map-block" data-map-url="' + esc(v.map_image.url) + '"' +
        (v.map_image.fallback ? ' data-map-fallback="' + esc(v.map_image.fallback) + '"' : '') + '>' +
        '<div class="map-frame" data-map-frame="1">' +
          '<span class="map-state">展開後載入地圖</span>' +
        '</div>' +
        (v.map_image.caption ? '<p class="map-caption">' + esc(v.map_image.caption) + '</p>' : '') +
      '</div>';
    }

    return '<article class="venue-card" id="venue-' + esc(v.id) + '" data-venue="' + esc(v.id) +
        '" data-kind="' + esc(v.kind) + '" data-open="0">' +
      '<button class="venue-head" type="button" data-venue-toggle="1" aria-expanded="false">' +
        '<span class="venue-head-main">' +
          '<span class="venue-kind">' + esc(v.kind_label || v.kind) + '</span>' +
          '<span class="venue-name">' + esc(v.name) + '</span>' +
          (v.name_sub ? '<span class="venue-name-sub">' + esc(v.name_sub) + '</span>' : '') +
          (dayLabel ? '<span class="venue-days">' + esc(dayLabel) + '</span>' : '') +
        '</span>' +
        '<span class="venue-chev">▼</span>' +
      '</button>' +
      '<div class="venue-body">' +
        (v.summary ? '<p class="venue-summary">' + esc(v.summary) + '</p>' : '') +
        '<div class="stat-row">' + (v.stats || []).map(statHtml).join('') + '</div>' +
        '<div class="link-row">' + (v.links || []).map(linkHtml).join('') + '</div>' +
        fcBlock +
        mapBlock +
        (notes ? '<div class="venue-notes">' + notes + '</div>' : '') +
      '</div>' +
    '</article>';
  }

  // ── forecast (Open-Meteo, fetched on first expand) ──────────────
  var FC_CACHE = {};
  var FC_META = {};

  function fcUrl(f) {
    return 'https://api.open-meteo.com/v1/forecast' +
      '?latitude=' + encodeURIComponent(f.lat) +
      '&longitude=' + encodeURIComponent(f.lon) +
      '&daily=snowfall_sum,temperature_2m_max,temperature_2m_min,wind_gusts_10m_max' +
      '&timezone=' + encodeURIComponent('Asia/Tokyo') +
      '&forecast_days=' + (FC_META.days || 3) +
      (f.elevation ? '&elevation=' + encodeURIComponent(f.elevation) : '') +
      '&temperature_unit=celsius&wind_speed_unit=kmh&precipitation_unit=mm';
  }

  function num(v, digits) {
    if (v === null || v === undefined || isNaN(v)) return null;
    return digits === 0 ? Math.round(v) : Math.round(v * 10) / 10;
  }

  function fcDayHtml(d, units, warnAt) {
    var gust = num(d.gust, 0);
    var windy = gust !== null && gust >= warnAt;
    var snow = num(d.snow, 0);
    var tmax = num(d.tmax, 0);
    var tmin = num(d.tmin, 0);

    return '<div class="fc-day' + (windy ? ' is-windy' : '') + '">' +
      '<span class="fc-date">' + esc(String(d.date).slice(5)) + ' ' + esc(weekday(d.date)) + '</span>' +
      '<div class="fc-snow' + (snow ? ' has-snow' : '') + '">' +
        (snow === null
          ? '—<small>新雪不明</small>'
          : esc(snow) + '<small>' + esc(units.snow || 'cm') + ' 新雪</small>') +
      '</div>' +
      '<div class="fc-row"><span class="k">氣溫</span> ' +
        (tmax === null ? '—' : esc(tmax) + '°') + ' / ' +
        (tmin === null ? '—' : esc(tmin) + '°') + '</div>' +
      '<div class="fc-row"><span class="k">陣風</span> ' +
        '<span class="fc-gust' + (windy ? ' is-windy' : '') + '">' +
          (gust === null ? '—' : esc(gust) + ' ' + esc(units.gust || 'km/h')) + '</span></div>' +
      (windy ? '<span class="fc-flag">⚠ 高空吊椅易停駛</span>' : '') +
      '</div>';
  }

  function renderForecast(block, payload, f) {
    var frame = block.querySelector('[data-fc-frame]');
    var warnAt = FC_META.gust_warn_kmh || 40;

    frame.innerHTML = '<div class="fc-grid">' +
      payload.days.map(function (d) { return fcDayHtml(d, payload.units, warnAt); }).join('') +
      '</div>';

    var foot = block.querySelector('[data-fc-foot]');
    if (foot) {
      foot.innerHTML =
        '<span>預報高度 ' + esc(f.elevation) + ' m</span>' +
        '<span><a href="' + esc(f.map_url) + '" target="_blank" rel="noopener noreferrer">座標 ' +
          esc(f.lat) + ', ' + esc(f.lon) + ' ↗</a></span>' +
        (f.confidence === 'estimated'
          ? '<span class="est">座標為估算值 —— 請點開確認圖釘位置</span>'
          : '<span>座標已查證</span>') +
        '<span>陣風 ≥ ' + warnAt + ' km/h 標為易停駛</span>';
    }
  }

  // Parses defensively: this is the one panel fed by a live third party, so
  // a changed field, a null value or a short array degrades to "—" rather
  // than throwing and taking the whole card down.
  function parseForecast(json) {
    var d = json && json.daily;
    if (!d || !Array.isArray(d.time) || !d.time.length) return null;
    var u = json.daily_units || {};
    var days = d.time.map(function (t, i) {
      return {
        date: t,
        snow: (d.snowfall_sum || [])[i],
        tmax: (d.temperature_2m_max || [])[i],
        tmin: (d.temperature_2m_min || [])[i],
        gust: (d.wind_gusts_10m_max || [])[i]
      };
    });
    return {
      days: days,
      units: { snow: u.snowfall_sum, gust: u.wind_gusts_10m_max }
    };
  }

  function loadForecast(block, force) {
    var id = block.getAttribute('data-fc-id');
    if (!force && block.getAttribute('data-loaded') === '1') return;
    block.setAttribute('data-loaded', '1');

    var f;
    try { f = JSON.parse(block.getAttribute('data-fc')); } catch (e) { f = null; }
    if (!f) return;

    var frame = block.querySelector('[data-fc-frame]');

    if (!force && FC_CACHE[id]) { renderForecast(block, FC_CACHE[id], f); return; }

    frame.innerHTML = '<span class="spinner"></span><span class="fc-state">讀取未來 ' +
      (FC_META.days || 3) + ' 天雪況…</span>';

    function fail(why) {
      frame.innerHTML = '<p class="fc-state is-error">雪況讀取失敗（' + esc(why) + '）。<br>' +
        '可能是目前沒有網路，或預報服務暫時無回應。<br>' +
        '請改用上方「Snow-Forecast 雪況」連結。</p>' +
        '<button class="map-retry" type="button" data-fc-retry="1">重新載入</button>';
    }

    var done = false;
    var timer = window.setTimeout(function () {
      if (!done) { done = true; fail('逾時'); }
    }, 9000);

    fetch(fcUrl(f), { mode: 'cors' })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (json) {
        if (done) return;
        done = true; window.clearTimeout(timer);
        var payload = parseForecast(json);
        if (!payload) { fail('資料格式非預期'); return; }
        FC_CACHE[id] = payload;
        renderForecast(block, payload, f);
      })
      .catch(function (err) {
        if (done) return;
        done = true; window.clearTimeout(timer);
        fail(err && err.message ? err.message : '連線錯誤');
      });
  }

  // The map image is fetched only when the card is first opened, and a failed
  // load says so in place instead of leaving a broken image icon.
  function loadVenueMap(block) {
    if (block.getAttribute('data-loaded') === '1') return;
    block.setAttribute('data-loaded', '1');

    var frame = block.querySelector('[data-map-frame]');
    var primary = block.getAttribute('data-map-url');
    var fallback = block.getAttribute('data-map-fallback');

    function attempt(src, isFallback) {
      frame.innerHTML = '<span class="spinner"></span><span class="map-state">' +
        (isFallback ? '主圖失敗，改載備用雪道圖…' : '載入地圖中…') + '</span>';

      var img = new Image();
      img.alt = '雪道／場地地圖';
      img.referrerPolicy = 'no-referrer';
      img.decoding = 'async';

      img.onload = function () {
        frame.innerHTML = '';
        frame.appendChild(img);
        if (isFallback) {
          var hint = document.createElement('p');
          hint.className = 'map-state';
          hint.textContent = '官方原圖無法載入，目前顯示的是備用雪道圖。';
          frame.appendChild(hint);
        }
      };

      img.onerror = function () {
        if (!isFallback && fallback && fallback !== primary) { attempt(fallback, true); return; }
        frame.innerHTML =
          '<p class="map-state is-error">地圖圖片載入失敗。<br>' +
          '可能是官方網站更換了圖片路徑、擋外部連結，或目前沒有網路。<br>' +
          '請改用上方「官方雪道導覽」連結查看。</p>' +
          '<button class="map-retry" type="button" data-map-retry="1">重新載入</button>';
      };

      img.src = src;
    }

    attempt(primary, false);
  }

  function setVenueOpen(card, open) {
    card.setAttribute('data-open', open ? '1' : '0');
    var head = card.querySelector('[data-venue-toggle]');
    if (head) head.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (!open) return;
    Array.prototype.forEach.call(card.querySelectorAll('.fc-block'), function (b) { loadForecast(b, false); });
    Array.prototype.forEach.call(card.querySelectorAll('.map-block'), loadVenueMap);
  }

  function focusVenue(id) {
    var card = document.getElementById('venue-' + id);
    if (!card) return;
    if (card.style.display === 'none') {
      var all = document.querySelector('[data-filter="all"]');
      if (all) all.click();
    }
    setVenueOpen(card, true);
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    card.classList.remove('is-target');
    void card.offsetWidth;
    card.classList.add('is-target');
  }

  function renderVenues(venues, forecastMeta) {
    FC_META = forecastMeta || {};
    if (!venues || !venues.length) { el('venues').style.display = 'none'; return; }

    var grid = el('venue-grid');
    grid.innerHTML = venues.map(venueCardHtml).join('');

    var kinds = [];
    venues.forEach(function (v) {
      if (!kinds.some(function (k) { return k.kind === v.kind; })) {
        kinds.push({ kind: v.kind, label: v.kind_label || v.kind });
      }
    });

    var filters = el('venue-filters');
    filters.innerHTML =
      '<button class="filter-btn" type="button" data-filter="all" aria-pressed="true">全部' +
        '<span class="fc">' + venues.length + '</span></button>' +
      kinds.map(function (k) {
        var n = venues.filter(function (v) { return v.kind === k.kind; }).length;
        return '<button class="filter-btn" type="button" data-filter="' + esc(k.kind) +
          '" aria-pressed="false">' + esc(k.label) + '<span class="fc">' + n + '</span></button>';
      }).join('');

    filters.addEventListener('click', function (ev) {
      var btn = ev.target.closest('[data-filter]');
      if (!btn) return;
      var want = btn.getAttribute('data-filter');
      Array.prototype.forEach.call(filters.querySelectorAll('[data-filter]'), function (b) {
        b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
      });
      Array.prototype.forEach.call(grid.querySelectorAll('.venue-card'), function (c) {
        c.style.display = (want === 'all' || c.getAttribute('data-kind') === want) ? '' : 'none';
      });
    });

    grid.addEventListener('click', function (ev) {
      var fcRetry = ev.target.closest('[data-fc-retry]');
      if (fcRetry) {
        loadForecast(fcRetry.closest('.fc-block'), true);
        return;
      }
      var retry = ev.target.closest('[data-map-retry]');
      if (retry) {
        var block = retry.closest('.map-block');
        block.setAttribute('data-loaded', '0');
        loadVenueMap(block);
        return;
      }
      var head = ev.target.closest('[data-venue-toggle]');
      if (!head) return;
      var card = head.closest('.venue-card');
      setVenueOpen(card, card.getAttribute('data-open') !== '1');
    });
  }

  // ── accordions ──────────────────────────────────────────────────
  // One toggle for every collapsible group (checklist, packing, recs), so
  // state and screen-reader state can never disagree.
  var UID = 0;
  function nextId(prefix) { UID += 1; return prefix + '-' + UID; }

  function toggleGroup(btn) {
    var group = btn.parentNode;
    var open = group.getAttribute('data-open') !== '1';
    group.setAttribute('data-open', open ? '1' : '0');
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    return open;
  }

  // ── days ────────────────────────────────────────────────────────
  // Recommendations are 87% of the itinerary data (960 items). Building them
  // all at load put ~12k nodes in the DOM for lists that start collapsed, so
  // each group is filled the first time it is opened instead.
  var RECS = {};

  function recItemsHtml(items) {
    return items.map(function (it) {
        var links = '';
        if (it.tabelog_url) {
          links += '<a class="lnk lnk-tabelog" href="' + esc(it.tabelog_url) +
            '" target="_blank" rel="noopener noreferrer">食べログ</a>';
        }
        if (it.map_url) {
          links += '<a class="lnk lnk-map" href="' + esc(it.map_url) +
            '" target="_blank" rel="noopener noreferrer">地圖</a>';
        }
        return '<div class="rec-item">' +
          '<div class="rec-item-top"><span class="rec-title">' +
            '<span class="rec-name">' + esc(it.name) + '</span>' +
            (it.tabelog_badge ? '<span class="tabelog-badge">' + esc(it.tabelog_badge) + '</span>' : '') +
            (it.rating ? '<span class="stars">' + esc(it.rating) + '</span>' : '') +
            (it.distance ? '<span class="dist">' + esc(it.distance) + '</span>' : '') +
          '</span><span class="link-row">' + links + '</span></div>' +
          (it.highlights ? '<p class="rec-desc">' + esc(it.highlights) + '</p>' : '') +
        '</div>';
    }).join('');
  }

  function recsHtml(day) {
    var recommendations = day.recommendations;
    if (!recommendations) return '';
    RECS[day.day_number] = recommendations;

    var groups = CATEGORIES.map(function (cat) {
      var key = cat[0], label = cat[1], icon = cat[2];
      var items = recommendations[key] || [];
      if (!items.length) return '';
      var bodyId = nextId('rec');

      return '<div class="rec-group" data-open="0">' +
        '<button class="rec-group-head" type="button" data-rec-toggle="1" aria-expanded="false" ' +
            'aria-controls="' + bodyId + '">' +
          '<span class="rec-cat-ico">' + icon + '</span>' +
          '<span class="rec-cat-name">' + label + '</span>' +
          '<span class="rec-count num">' + items.length + '</span>' +
          '<span class="chev">▼</span>' +
        '</button>' +
        '<div class="rec-group-body" id="' + bodyId + '" data-day="' + day.day_number +
          '" data-cat="' + key + '" data-rendered="0"></div>' +
      '</div>';
    }).join('');

    if (!groups) return '';
    return '<div class="recs">' +
      '<div class="recs-head"><strong>在地推薦名單</strong>' +
      '<small>以 食べログ 高分榜・百名店為主，6 大類別各 10 選</small></div>' +
      groups + '</div>';
  }

  function dayCardHtml(day, venuesById) {
    var chips = (day.venue_ids || []).map(function (id) {
      var v = venuesById[id];
      if (!v) return '';
      return '<button class="venue-chip" type="button" data-goto-venue="' + esc(id) + '">' +
        esc(v.name) + '</button>';
    }).join('');

    var transit = '';
    if (day.transit) {
      var steps = (day.transit.details || []).map(transitStepHtml).join('');
      transit = '<div class="transit-box">' +
        '<div class="transit-label">Transit</div>' +
        '<div class="transit-summary">' + esc(day.transit.summary) + '</div>' +
        (steps ? '<ul class="transit-timeline">' + steps + '</ul>' : '') +
      '</div>';
    }

    return '<article class="day-card rise" id="day-' + esc(day.day_number) + '">' +
      '<div class="day-top">' +
        '<span class="day-n num">' + pad2(day.day_number) + '</span>' +
        '<div class="day-meta">' +
          '<div class="day-date-row">' +
            '<span class="day-date">' + esc(day.date) + '</span>' +
            '<span class="day-dow">' + esc(weekday(day.date)) + '</span>' +
          '</div>' +
          '<h3 class="day-title">' + esc(day.day_title) + '</h3>' +
        '</div>' +
      '</div>' +
      (day.stay ? '<div class="stay-box"><span class="stay-name"><em>Stay</em>' + esc(day.stay) + '</span>' +
        (day.stay_map ? '<a class="lnk lnk-map" href="' + esc(day.stay_map) +
          '" target="_blank" rel="noopener noreferrer">飯店地圖</a>' : '') + '</div>' : '') +
      (chips ? '<div class="venue-chips">' + chips + '</div>' : '') +
      transit +
      recsHtml(day) +
    '</article>';
  }

  // Transit steps are written as "【label】body". Splitting the label out
  // turns a wall of text into a scannable list: the main line, the fallbacks,
  // the suggestions and the warnings each read differently at a glance.
  // Everything is escaped after splitting, so the markup stays inert.
  var STEP_RE = /^【([^】]{1,40})】[：:]?\s*/;

  function transitStepHtml(raw) {
    var s = String(raw);
    var label = '';
    var m = STEP_RE.exec(s);
    if (m) { label = m[1]; s = s.slice(m[0].length); }

    var kind = '';
    if (/^★/.test(label)) kind = 'is-main';
    else if (/^💡/.test(label)) kind = 'is-tip';
    else if (/^⚠️?/.test(label) || (!label && /^⚠️?/.test(s))) kind = 'is-warn';
    else if (/備案|保險|延誤|僅限/.test(label)) kind = 'is-alt';

    // 〔待確認…〕 notes are about the data, not the plan -- set them apart
    var body = esc(s).replace(/〔([^〕]*)〕/g, '<span class="tbc">〔$1〕</span>');
    var tag = label ? '<span class="step-tag">' + esc(label.replace(/^[★💡]\s*/, '')) + '</span>' : '';
    return '<li class="transit-step' + (kind ? ' ' + kind : '') + '">' + tag + body + '</li>';
  }

  function renderDays(data) {
    var days = data.days || [];
    var venuesById = {};
    (data.venues || []).forEach(function (v) { venuesById[v.id] = v; });

    el('day-nav').innerHTML = days.map(function (d) {
      return '<a class="nav-btn" href="#day-' + esc(d.day_number) + '">' +
        '<span class="nav-d num">' + pad2(d.day_number) + '</span>' +
        '<span class="nav-date">' + esc(String(d.date).slice(5)) + '</span></a>';
    }).join('');

    el('days-sub').textContent = days.length + ' 天完整動線・交通與在地推薦';

    var container = el('days-container');
    container.innerHTML = days.map(function (d) { return dayCardHtml(d, venuesById); }).join('');

    container.addEventListener('click', function (ev) {
      var rt = ev.target.closest('[data-rec-toggle]');
      if (rt) {
        if (toggleGroup(rt)) {
          var body = rt.parentNode.querySelector('.rec-group-body');
          if (body && body.getAttribute('data-rendered') === '0') {
            var recs = RECS[body.getAttribute('data-day')] || {};
            body.innerHTML = recItemsHtml(recs[body.getAttribute('data-cat')] || []);
            body.setAttribute('data-rendered', '1');
          }
        }
        return;
      }
      var chip = ev.target.closest('[data-goto-venue]');
      if (chip) focusVenue(chip.getAttribute('data-goto-venue'));
    });
  }

  function renderContingency(plans) {
    if (!plans || !plans.length) { el('contingency').style.display = 'none'; return; }
    el('contingency-grid').innerHTML = plans.map(function (c) {
      return '<div class="contingency-card">' +
        '<h4><span class="ico">' + esc(c.icon || '⚠️') + '</span> ' + esc(c.title) + '</h4>' +
        '<p class="contingency-scenario">觸發情境：' + esc(c.scenario) + '</p>' +
        '<ul>' + (c.actions || []).map(function (a) { return '<li>' + esc(a) + '</li>'; }).join('') + '</ul>' +
      '</div>';
    }).join('');
  }

  // ── today panel ─────────────────────────────────────────────────
  // Uses the device's local date. During the trip the device will be on JST;
  // before it, Taipei is one hour behind, which never changes the date here
  // because the comparison is day-level. `?today=YYYY-MM-DD` overrides it,
  // which is how the view is tested and how you can preview any day.
  function localISO(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function todayISO() {
    var m = /[?&]today=(\d{4}-\d{2}-\d{2})/.exec(location.search);
    return m ? m[1] : localISO(new Date());
  }

  function daysBetween(aISO, bISO) {
    var a = aISO.split('-'), b = bISO.split('-');
    var ms = Date.UTC(+b[0], +b[1] - 1, +b[2]) - Date.UTC(+a[0], +a[1] - 1, +a[2]);
    return Math.round(ms / 86400000);
  }

  function countChecked(key, groups) {
    if (!groups || !groups.length) return { done: 0, total: 0 };
    var s = makeStore(key).read();
    var total = 0, done = 0;
    groups.forEach(function (g) {
      total += g.items.length;
      done += g.items.filter(function (it) { return s[it.id]; }).length;
    });
    return { done: done, total: total };
  }

  function renderToday(data) {
    var days = data.days || [];
    if (!days.length) return;

    var iso = todayISO();
    var first = days[0].date;
    var last = days[days.length - 1].date;
    var current = null;
    days.forEach(function (d) { if (d.date === iso) current = d; });

    var wrap = el('today-wrap');
    var box = el('today');
    var html = '';

    if (current) {
      var venuesById = {};
      (data.venues || []).forEach(function (v) { venuesById[v.id] = v; });
      var chips = (current.venue_ids || []).map(function (id) {
        var v = venuesById[id];
        return v ? '<button class="venue-chip" type="button" data-goto-venue="' + esc(id) + '">' +
          esc(v.name) + '</button>' : '';
      }).join('');

      html =
        '<div class="today-head">' +
          '<span class="today-tag">Today</span>' +
          '<span class="today-date">' + esc(current.date) + ' ・ ' + esc(weekday(current.date)) +
            ' ・ 第 ' + current.day_number + ' / ' + days.length + ' 天</span>' +
        '</div>' +
        '<div class="today-body">' +
          '<span class="today-n num">' + pad2(current.day_number) + '</span>' +
          '<h2 class="today-title">' + esc(current.day_title) + '</h2>' +
          (current.stay ? '<p class="today-line">🏨 <b>' + esc(current.stay) + '</b></p>' : '') +
          (current.transit ? '<p class="today-line">🚆 ' + esc(current.transit.summary) + '</p>' : '') +
          (chips ? '<div class="venue-chips" style="margin-top:14px;margin-bottom:0">' + chips + '</div>' : '') +
          '<div class="today-actions">' +
            '<a class="today-cta" href="#day-' + current.day_number + '">看今日完整行程 ↓</a>' +
            '<a class="today-cta" href="#emergency">緊急聯絡</a>' +
          '</div>' +
        '</div>';

    } else if (daysBetween(iso, first) > 0) {
      var away = daysBetween(iso, first);
      var cl = countChecked(CL_KEY, data.predeparture_checklist);
      var pk = countChecked(PACK_KEY, data.packing_list);
      html =
        '<div class="today-head">' +
          '<span class="today-tag">Countdown</span>' +
          '<span class="today-date">出發日 ' + esc(first) + '</span>' +
        '</div>' +
        '<div class="today-body">' +
          '<span class="today-n num">' + away + '</span>' +
          '<h2 class="today-title">天後出發</h2>' +
          '<div class="today-meter">' +
            '<span class="today-stat"><span class="n num">' + (cl.total - cl.done) + '</span>' +
              '<span class="l">覆核未完成</span></span>' +
            '<span class="today-stat"><span class="n num">' + (pk.total - pk.done) + '</span>' +
              '<span class="l">尚未打包</span></span>' +
          '</div>' +
          '<div class="today-actions">' +
            '<a class="today-cta" href="#checklist">出發前覆核</a>' +
            '<a class="today-cta" href="#packing">裝備打包</a>' +
          '</div>' +
        '</div>';

    } else {
      html =
        '<div class="today-head"><span class="today-tag">Done</span>' +
          '<span class="today-date">' + esc(first) + ' — ' + esc(last) + '</span></div>' +
        '<div class="today-body">' +
          '<h2 class="today-title">旅程已結束 —— 這頁留著當紀錄</h2>' +
          '<div class="today-actions"><a class="today-cta" href="#days">回顧 16 天行程</a></div>' +
        '</div>';
    }

    box.innerHTML = html;
    wrap.hidden = false;

    box.addEventListener('click', function (ev) {
      var chip = ev.target.closest('[data-goto-venue]');
      if (chip) focusVenue(chip.getAttribute('data-goto-venue'));
    });

    // mark today in the day strip
    if (current) {
      var btn = document.querySelector('#day-nav a[href="#day-' + current.day_number + '"]');
      if (btn) btn.classList.add('is-today');
    }
  }

  // ── emergency ───────────────────────────────────────────────────
  function telRowHtml(e) {
    var urgent = e.urgent ? ' is-urgent' : '';
    var inner =
      '<span class="tel-main">' +
        '<span class="tel-label">' + esc(e.label) + '</span>' +
        (e.note ? '<span class="tel-note">' + esc(e.note) + '</span>' : '') +
      '</span>' +
      '<span class="tel-number num">' + esc(e.value) + '</span>';

    // A number that cannot be dialled as-is from Japan is rendered as plain
    // text, so nobody taps it in an emergency and gets a dead line.
    if (!e.tel) return '<div class="tel-row no-dial' + urgent + '">' + inner + '</div>';
    return '<a class="tel-row' + urgent + '" href="tel:' + esc(e.tel) + '">' + inner + '</a>';
  }

  function renderEmergency(em) {
    if (!em) { el('emergency').style.display = 'none'; return; }
    if (em.intro) el('emergency-intro').textContent = em.intro;

    var html = '<div class="sos-grid">';

    // No `rise` class anywhere in this section: emergency content must be
    // readable the instant the page paints, never gated on a scroll animation
    // firing. Everything else on the page can fade in; this cannot.
    (em.groups || []).forEach(function (g) {
      var urgent = (g.entries || []).some(function (e) { return e.urgent; });
      html += '<div class="sos-block' + (urgent ? ' is-urgent' : '') + '">' +
        '<div class="sos-head"><h3>' + esc(g.icon || '') + ' ' + esc(g.title) + '</h3>' +
        (g.hint ? '<span class="sos-hint">' + esc(g.hint) + '</span>' : '') + '</div>' +
        (g.entries || []).map(telRowHtml).join('') +
      '</div>';
    });

    (em.procedures || []).forEach(function (pr) {
      html += '<div class="sos-block">' +
        '<div class="sos-head"><h3>' + esc(pr.icon || '') + ' ' + esc(pr.title) + '</h3></div>' +
        '<div class="proc">' +
          (pr.lede ? '<p class="proc-lede">' + esc(pr.lede) + '</p>' : '') +
          '<ol class="proc-steps">' +
            (pr.steps || []).map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') +
          '</ol>' +
        '</div></div>';
    });

    if (em.phrases && em.phrases.length) {
      html += '<div class="sos-block">' +
        '<div class="sos-head"><h3>🗣️ 日文急救短句</h3>' +
        '<span class="sos-hint">日文欄點一下會整句選取，直接把手機拿給對方看</span></div>' +
        '<div class="phrase-list">' +
        em.phrases.map(function (ph) {
          return '<div class="phrase">' +
            '<span class="phrase-zh">' + esc(ph.zh) + '</span>' +
            '<span class="phrase-ja">' + esc(ph.ja) + '</span>' +
            '<span class="phrase-romaji">' + esc(ph.romaji) + '</span>' +
          '</div>';
        }).join('') + '</div></div>';
    }

    if (em.personal_fields && em.personal_fields.length) {
      html += '<div class="sos-block">' +
        '<div class="sos-head"><h3>🔒 個人緊急資料</h3>' +
        '<span class="sos-hint">自己填，只存在這台裝置</span></div>' +
        '<div class="personal"><div class="personal-grid">' +
        em.personal_fields.map(function (f) {
          return '<div class="field">' +
            '<label for="pf-' + esc(f.id) + '">' + esc(f.label) + '</label>' +
            '<input type="' + (f.tel ? 'tel' : 'text') + '" id="pf-' + esc(f.id) +
              '" data-personal="' + esc(f.id) + '" placeholder="' + esc(f.placeholder || '') + '"' +
              (f.tel ? ' data-callable="1"' : '') + ' autocomplete="off">' +
            (f.tel ? '<a class="field-call" data-call-for="' + esc(f.id) + '" href="#" hidden>撥打 ↗</a>' : '') +
          '</div>';
        }).join('') +
        '</div>' +
        '<p class="personal-note" id="personal-note"></p>' +
        '</div></div>';
    }

    html += '</div>';
    el('emergency-body').innerHTML = html;

    // personal fields: device-local only, never sent anywhere
    var pstore = makeStore(PERSONAL_KEY);
    var saved = pstore.read();
    var inputs = el('emergency-body').querySelectorAll('[data-personal]');

    function syncCall(input) {
      var link = document.querySelector('[data-call-for="' + input.getAttribute('data-personal') + '"]');
      if (!link) return;
      var digits = String(input.value || '').replace(/[^0-9+]/g, '');
      if (digits.length >= 5) {
        link.href = 'tel:' + digits;
        link.hidden = false;
      } else {
        link.removeAttribute('href');
        link.hidden = true;
      }
    }

    Array.prototype.forEach.call(inputs, function (input) {
      var key = input.getAttribute('data-personal');
      if (saved[key]) input.value = saved[key];
      syncCall(input);
      input.addEventListener('input', function () {
        var next = pstore.read();
        if (input.value) next[key] = input.value;
        else delete next[key];
        var ok = pstore.write(next);
        syncCall(input);
        var note = el('personal-note');
        if (note) {
          note.textContent = ok
            ? '這幾欄只寫進這台裝置的瀏覽器，不會上傳、不會進入 GitHub，換裝置要重填。'
            : '⚠️ 這個瀏覽器停用了本機儲存，關掉頁面就會消失。';
        }
      });
    });

    var note = el('personal-note');
    if (note) {
      note.textContent = '這幾欄只寫進這台裝置的瀏覽器，不會上傳、不會進入 GitHub，換裝置要重填。';
    }
  }

  // ── scroll behaviour ────────────────────────────────────────────
  function initScrollEffects() {
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function revealAll() {
      Array.prototype.forEach.call(document.querySelectorAll('.rise'), function (n) {
        n.classList.add('in');
      });
    }

    if (!reduce && 'IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
        });
      }, { rootMargin: '0px 0px -8% 0px', threshold: 0.04 });
      Array.prototype.forEach.call(document.querySelectorAll('.rise'), function (n) { io.observe(n); });

      // Failsafe: a reveal animation must never be the reason content is
      // missing. If anything is still hidden after a few seconds -- observer
      // wedged, odd browser, fast programmatic scroll past an element --
      // show everything and stop pretending this is decoration.
      window.setTimeout(revealAll, 4000);
    } else {
      revealAll();
    }

    var bar = el('progress-bar');
    var toTop = el('to-top');
    var ticking = false;

    function onScroll() {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(function () {
        var doc = document.documentElement;
        var max = doc.scrollHeight - doc.clientHeight;
        bar.style.width = (max > 0 ? (window.scrollY / max) * 100 : 0) + '%';
        toTop.classList.toggle('show', window.scrollY > 800);
        ticking = false;
      });
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    toTop.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
    });
  }

  // ── boot ────────────────────────────────────────────────────────
  function render(data) {
    renderHero(data);

    renderCheckGroups({
      sectionId: 'checklist', shellId: 'checklist-shell', prefix: 'cl',
      storageKey: CL_KEY, groups: data.predeparture_checklist,
      remainingText: function (n) { return '出發前還有 ' + n + ' 項要確認'; },
      doneText: '全部確認完畢，可以出發了',
      resetPrompt: '確定要清除全部覆核勾選紀錄嗎？',
      savedNote: '勾選狀態已存在這台裝置的瀏覽器（localStorage）。換裝置或清除瀏覽資料後需重新勾選。'
    });

    renderCheckGroups({
      sectionId: 'packing', shellId: 'packing-shell', prefix: 'pk',
      storageKey: PACK_KEY, groups: data.packing_list,
      remainingText: function (n) { return '還有 ' + n + ' 樣沒裝進行李'; },
      doneText: '行李打包完成',
      resetPrompt: '確定要清除全部打包勾選紀錄嗎？',
      savedNote: '打包進度與覆核清單分開存放，互不影響。'
    });

    renderVenues(data.venues, data.forecast_meta);
    renderDays(data);
    renderToday(data);   // after renderDays: it marks today in the day strip
    renderContingency(data.contingency_plans);
    renderEmergency(data.emergency);
    initScrollEffects();

    if (location.hash.indexOf('#venue-') === 0) {
      focusVenue(location.hash.slice('#venue-'.length));
    }
  }

  function showError(message) {
    el('days-container').innerHTML =
      '<div class="error-box"><h3>資料載入失敗</h3><p style="margin-top:10px;font-size:0.85rem">' +
      esc(message) + '</p></div>';
  }

  // ── offline ─────────────────────────────────────────────────────
  // Service workers need https or localhost; a file:// copy still works, it
  // just is not cached for offline use.
  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    var secure = location.protocol === 'https:' ||
      location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    if (!secure) return;
    navigator.serviceWorker.register('./sw.js').catch(function () { /* page works without it */ });
  }

  function initConnectivity() {
    var bar = el('offline-bar');
    if (!bar) return;
    function update() { bar.hidden = navigator.onLine !== false; }
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    update();
  }

  function boot() {
    initTheme();
    initConnectivity();
    registerServiceWorker();

    var node = el('itinerary-data');
    var raw = node ? node.textContent.trim() : '';

    // The build step inlines itinerary.json here. If the placeholder is still
    // in place, fall back to fetching the data file next to the page.
    if (raw && raw.charAt(0) === '{') {
      try { render(JSON.parse(raw)); }
      catch (e) { showError('內嵌行程資料解析失敗：' + e.message); }
      return;
    }

    fetch('./itinerary.json?v=' + Date.now())
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(render)
      .catch(function (err) {
        showError('無法取得 itinerary.json（' + err.message + '）。請確認檔案與本頁位於同一目錄。');
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
