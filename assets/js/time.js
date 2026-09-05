/* 时区原语：时间戳工具和 Cron 工具都要在任意 IANA 时区里读写墙上时间，
   而 Date 只能表达「时刻」和「本地时区」两件事，所以这里手写这两个方向的换算。
   思路：读方向用 Intl.DateTimeFormat 的 formatToParts 取字段；
   写方向先假设偏移为 0 得到一个候选时刻，再用该时刻的真实偏移修正一次，
   多一次校正的迭代是为了跨过夏令时切换点（一次修正可能落到切换的另一侧）。 */

(function () {
  var FALLBACK_TZ = "UTC";
  var partFmt = null;
  var partFmtTz = null;
  var offsetCache = {};

  function localZone() {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || FALLBACK_TZ;
    } catch (e) {
      return FALLBACK_TZ;
    }
  }

  function partsFormatter(tz) {
    if (partFmt && partFmtTz === tz) return partFmt;
    var opts = {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    };
    // 不是所有引擎都接受任意 tz 字符串，失败时退回 UTC 而不是整页报错。
    try {
      partFmt = new Intl.DateTimeFormat("en-GB", opts);
      partFmtTz = tz;
    } catch (e) {
      opts.timeZone = FALLBACK_TZ;
      partFmt = new Intl.DateTimeFormat("en-GB", opts);
      partFmtTz = FALLBACK_TZ;
    }
    return partFmt;
  }

  // 把时刻拆成目标时区的墙上时间字段。
  function zonedParts(instant, tz) {
    var p = partsFormatter(tz).formatToParts(new Date(instant));
    var out = { year: 1970, month: 1, day: 1, hour: 0, minute: 0, second: 0 };
    for (var i = 0; i < p.length; i++) {
      var v = parseInt(p[i].value, 10);
      if (isNaN(v)) continue;
      switch (p[i].type) {
        case "year": out.year = v; break;
        case "month": out.month = v; break;
        case "day": out.day = v; break;
        case "hour": out.hour = v % 24; break;
        case "minute": out.minute = v; break;
        case "second": out.second = v; break;
      }
    }
    return out;
  }

  // 目标时区在某个时刻上的 UTC 偏移（毫秒）。
  function zoneOffset(instant, tz) {
    var p = zonedParts(instant, tz);
    var asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    return asUtc - Math.floor(instant / 1000) * 1000;
  }

  function zoneOffsetCached(instant, tz) {
    // 偏移按分钟粒度缓存：一分钟内重复查询不必再跑一遍 Intl。
    var key = tz + "@" + Math.floor(instant / 60000);
    if (!(key in offsetCache)) offsetCache[key] = zoneOffset(instant, tz);
    return offsetCache[key];
  }

  // 把目标时区的墙上时间换算成 UTC 时刻；返回毫秒时间戳。
  function zonedToInstant(y, mo, d, h, mi, s, tz) {
    var guess = Date.UTC(y, mo - 1, d, h || 0, mi || 0, s || 0);
    var ts = guess - zoneOffset(guess, tz);
    var corrected = guess - zoneOffset(ts, tz);
    return corrected === ts ? ts : corrected;
  }

  function tzLabel(instant, tz) {
    // 按整秒拆：LMT（1901 年前的 Asia/Shanghai 是 +08:05:43）拿小数分钟会写成 "08:5.7166…"。
    var off = zoneOffsetCached(instant, tz);
    var abs = Math.abs(Math.round(off / 1000));
    var h = Math.floor(abs / 3600);
    var m = Math.floor(abs / 60) % 60;
    var s = abs % 60;
    return "UTC" + (off < 0 ? "-" : "+") + pad2(h) +
      (m || s ? ":" + pad2(m) : "") + (s ? ":" + pad2(s) : "");
  }

  function pad2(n) {
    return (n < 10 ? "0" : "") + n;
  }

  var WEEKDAY = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

  function weekdayName(instant, tz) {
    var p = zonedParts(instant, tz);
    return WEEKDAY[new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()];
  }

  var WEEKDAY_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  function weekdayEn(instant, tz) {
    var p = zonedParts(instant, tz);
    return WEEKDAY_EN[new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()];
  }

  // 目标时区「今天 00:00:00」的时刻。
  function startOfDay(instant, tz) {
    var p = zonedParts(instant, tz);
    return zonedToInstant(p.year, p.month, p.day, 0, 0, 0, tz);
  }

  function format(instant, tz, withMs) {
    var p = zonedParts(instant, tz);
    var s =
      p.year + "-" + pad2(p.month) + "-" + pad2(p.day) +
      " " + pad2(p.hour) + ":" + pad2(p.minute) + ":" + pad2(p.second);
    if (withMs) {
      var ms = ((instant % 1000) + 1000) % 1000;
      s += "." + (ms < 100 ? (ms < 10 ? "00" : "0") : "") + ms;
    }
    return s;
  }

  function formatDate(instant, tz) {
    var p = zonedParts(instant, tz);
    return p.year + "-" + pad2(p.month) + "-" + pad2(p.day);
  }

  // 输入解析：接受 "2026-09-04 12:30:00" / "2026/9/4 12:30" / ISO 等常见写法。
  function parseWall(text) {
    if (!text) return null;
    var t = String(text).trim().replace(/[T]/g, " ").replace(/\u5e74|\u6708/g, "-").replace(/\u65e5/g, " ");
    var m = t.match(
      /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ ]+(\d{1,2})(?::(\d{1,2}))?(?::(\d{1,2}))?(?:\.(\d{1,3}))?)?/
    );
    if (!m) {
      var only = t.match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/);
      if (!only) return null;
      var now = zonedParts(Date.now(), "UTC");
      return { y: now.year, mo: now.month, d: now.day, h: +only[1], mi: +only[2], s: +(only[3] || 0), ms: 0 };
    }
    return {
      y: +m[1], mo: +m[2], d: +m[3],
      h: +(m[4] || 0), mi: +(m[5] || 0), s: +(m[6] || 0),
      ms: m[7] ? +String(m[7] + "00").slice(0, 3) : 0,
    };
  }

  // 相对描述：把毫秒差说成“x 年 y 个月前”这类人话。
  function humanDiff(ms) {
    var abs = Math.abs(ms);
    var suffix = ms >= 0 ? "前" : "后";
    var UNITS = [
      [31536000000, "年"],
      [2592000000, "个月"],
      [604800000, "周"],
      [86400000, "天"],
      [3600000, "小时"],
      [60000, "分钟"],
      [1000, "秒"],
    ];
    if (abs < 1000) return "刚刚";
    for (var i = 0; i < UNITS.length; i++) {
      if (abs >= UNITS[i][0]) {
        var n = Math.floor(abs / UNITS[i][0]);
        var rest = abs % UNITS[i][0];
        var out = n + UNITS[i][1];
        if (i + 1 < UNITS.length && rest >= UNITS[i + 1][0]) {
          out += " " + Math.floor(rest / UNITS[i + 1][0]) + UNITS[i + 1][1];
        }
        return out + suffix;
      }
    }
    return abs + " 毫秒" + suffix;
  }

  var COMMON_ZONES = [
    ["Asia/Shanghai", "中国 · 上海 (CST)"],
    ["Asia/Hong_Kong", "中国 · 香港"],
    ["Asia/Taipei", "中国 · 台北"],
    ["Asia/Urumqi", "中国 · 乌鲁木齐"],
    ["Asia/Tokyo", "日本 · 东京"],
    ["Asia/Singapore", "新加坡"],
    ["Asia/Seoul", "韩国 · 首尔"],
    ["Asia/Kolkata", "印度 · 加尔各答"],
    ["Asia/Dubai", "迪拜"],
    ["Europe/Moscow", "俄罗斯 · 莫斯科"],
    ["Europe/London", "英国 · 伦敦"],
    ["Europe/Paris", "法国 · 巴黎"],
    ["Europe/Berlin", "德国 · 柏林"],
    ["Europe/Madrid", "西班牙 · 马德里"],
    ["America/Sao_Paulo", "巴西 · 圣保罗"],
    ["America/New_York", "美国 · 纽约"],
    ["America/Chicago", "美国 · 芝加哥"],
    ["America/Denver", "美国 · 丹佛"],
    ["America/Los_Angeles", "美国 · 洛杉矶"],
    ["America/Anchorage", "美国 · 安克雷奇"],
    ["Pacific/Honolulu", "美国 · 檀香山"],
    ["Australia/Sydney", "澳大利亚 · 悉尼"],
    ["Pacific/Auckland", "新西兰 · 奥克兰"],
    ["UTC", "协调世界时 (UTC)"],
  ];

  /* 经纬度 → IANA 时区。定位只给坐标，而偏移量推不出时区（中国跨六个时区却统一 +8），
     所以按代表城市取最近点。这张表只覆盖常用时区，够用来「猜一个合理的默认值」，
     不替代真正的时区边界数据；猜错了用户在下拉里改一次即可（偏好会被记住）。 */
  var GEO_CITIES = [
    /* 中国大陆只用一个法定时区，所以各方向都放同属 Asia/Shanghai 的锚点，
       免得中西部的坐标被就近判给偏移量相同、名字却不对的区。 */
    ["Asia/Shanghai", 31.23, 121.47],
    ["Asia/Shanghai", 39.9, 116.4],
    ["Asia/Shanghai", 23.13, 113.26],
    ["Asia/Shanghai", 30.59, 114.3],
    ["Asia/Shanghai", 34.34, 108.94],
    ["Asia/Shanghai", 45.75, 126.65],
    ["Asia/Shanghai", 22.82, 108.32],
    ["Asia/Shanghai", 29.65, 91.14],
    ["Asia/Shanghai", 43.83, 87.62],
    ["Asia/Shanghai", 39.47, 75.99],
    ["Asia/Hong_Kong", 22.31, 114.17],
    ["Asia/Taipei", 25.03, 121.56],
    ["Asia/Seoul", 37.57, 126.98],
    ["Asia/Tokyo", 35.68, 139.69],
    ["Asia/Manila", 14.6, 120.98],
    ["Asia/Singapore", 1.35, 103.82],
    ["Asia/Jakarta", -6.2, 106.85],
    ["Asia/Bangkok", 13.76, 100.5],
    ["Asia/Kolkata", 22.57, 88.36],
    ["Asia/Kolkata", 28.61, 77.21],
    ["Asia/Kolkata", 19.08, 72.88],
    ["Asia/Karachi", 24.86, 67.0],
    ["Asia/Tehran", 35.69, 51.39],
    ["Asia/Almaty", 43.24, 76.95],
    ["Asia/Tashkent", 41.3, 69.24],
    ["Asia/Dubai", 25.2, 55.27],
    ["Asia/Riyadh", 24.71, 46.67],
    ["Europe/Istanbul", 41.01, 28.98],
    ["Europe/Moscow", 55.76, 37.62],
    ["Europe/Kyiv", 50.45, 30.52],
    ["Europe/London", 51.51, -0.13],
    ["Europe/Amsterdam", 52.37, 4.9],
    ["Europe/Berlin", 52.52, 13.41],
    ["Europe/Paris", 48.86, 2.35],
    ["Europe/Rome", 41.9, 12.5],
    ["Europe/Madrid", 40.42, -3.7],
    ["Africa/Cairo", 30.04, 31.24],
    ["Africa/Lagos", 6.52, 3.38],
    ["Africa/Johannesburg", -26.2, 28.05],
    ["America/New_York", 40.71, -74.01],
    ["America/Toronto", 43.65, -79.38],
    ["America/Chicago", 41.88, -87.63],
    ["America/Denver", 39.74, -104.99],
    ["America/Los_Angeles", 34.05, -118.24],
    ["America/Anchorage", 61.22, -149.9],
    ["America/Mexico_City", 19.43, -99.13],
    ["America/Sao_Paulo", -23.55, -46.63],
    ["America/Argentina/Buenos_Aires", -34.6, -58.67],
    ["America/Santiago", -33.45, -70.67],
    ["Pacific/Honolulu", 21.31, -157.86],
    ["Australia/Perth", -31.95, 115.86],
    ["Australia/Sydney", -33.87, 151.21],
    ["Pacific/Auckland", -36.85, 174.76],
  ];

  function zoneFromCoords(lat, lon) {
    var best = GEO_CITIES[0][0];
    var bestD = Infinity;
    for (var i = 0; i < GEO_CITIES.length; i++) {
      var c = GEO_CITIES[i];
      // 经度差按中点纬度收缩，否则高纬度地区的东西向距离被放大，选城会跑偏。
      var dLat = c[1] - lat;
      var dLon = (c[2] - lon) * Math.cos((((c[1] + lat) / 2) * Math.PI) / 180);
      var d = dLat * dLat + dLon * dLon;
      if (d < bestD) {
        bestD = d;
        best = c[0];
      }
    }
    return best;
  }

  function allZones() {
    // 优先用引擎自带的完整 tz 列表，让页面能选到冷门时区；老引擎退回常用列表。
    try {
      var g = (Intl.supportedValuesOf && Intl.supportedValuesOf("timeZone")) || null;
      if (g && g.length) return g;
    } catch (e) {
      /* 忽略 */
    }
    return COMMON_ZONES.map(function (z) {
      return z[0];
    });
  }

  /* 列表不能当权威：这份引擎的 supportedValuesOf 里查不到 UTC、Asia/Kolkata、
     Europe/Kyiv、America/Argentina/Buenos_Aires，可格式化器全都认。
     「能不能用」以真正构造出格式化器为准。 */
  function zoneIsUsable(zone) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: zone });
      return true;
    } catch (e) {
      return false;
    }
  }

  window.ZtTime = {
    localZone: localZone,
    zonedParts: zonedParts,
    zoneOffset: function (i, tz) { return zoneOffsetCached(i, tz); },
    zonedToInstant: zonedToInstant,
    tzLabel: tzLabel,
    weekdayName: weekdayName,
    weekdayEn: weekdayEn,
    startOfDay: startOfDay,
    format: format,
    formatDate: formatDate,
    parseWall: parseWall,
    humanDiff: humanDiff,
    COMMON_ZONES: COMMON_ZONES,
    allZones: allZones,
    zoneIsUsable: zoneIsUsable,
    zoneFromCoords: zoneFromCoords,
  };
})();
