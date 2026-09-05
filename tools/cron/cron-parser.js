/* 零依赖 Cron 解析与触发时间推算。
   支持三种方言：Linux crontab / Spring 的 5 字段、Quartz 的 6 与 7 字段。

   两个容易踩错的点在这里显式处理了：
   1) 周的数字编号方言不一致——Linux 与 Spring 是 0=周日…6=周六（7 也当周日），
      Quartz 是 1=周日…7=周六。内部统一存成 JS 的 0=周日…6=周六，
      所以 `1-5` 在 Quartz 里是「日至四」，在 Linux 里才是「一至五」。
   2) 触发时间按「目标时区的墙上时间」推算。cron 本来就是运维按自己时区写的，
      按 UTC 推算会让 Asia/Shanghai 的选择整体差 8 小时。 */

(function () {
  var ZT = window.ZtTime;

  var MONTH_NAMES = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  var DOW_NAMES = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
  var DOW_CN = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  var ORDER = ["sec", "min", "hour", "dom", "mon", "dow"];

  var DEFS = {
    sec:  { key: "sec",  label: "秒", unit: "秒",   min: 0, max: 59 },
    min:  { key: "min",  label: "分", unit: "分钟", min: 0, max: 59 },
    hour: { key: "hour", label: "时", unit: "小时", min: 0, max: 23 },
    dom:  { key: "dom",  label: "日", unit: "天",   min: 1, max: 31 },
    mon:  { key: "mon",  label: "月", unit: "个月", min: 1, max: 12, names: MONTH_NAMES },
    dow:  { key: "dow",  label: "周", unit: "周",   min: 0, max: 6, names: DOW_NAMES, isDow: true },
  };

  // 年字段只在 7 段表达式里出现，量纲与其它字段不同，单独一份定义。
  var YEAR_DEF = { key: "year", label: "年", unit: "年", min: 1970, max: 2299 };

  // 键序即界面格式钮的顺序：Linux 放最左并作默认，依次是 Spring、Quartz。
  var FORMATS = {
    linux: { key: "linux", name: "Linux", count: 5, hasSec: false, dowFromOne: false, allowQuestion: false, strictQuestion: false, supportsLW: false, supportsYear: false,
      orderLabel: "分 时 日 月 周",
      hint: "5 段，无秒，也没有 ? 和 L、W、# 。数字周 0=周日；日与周都写具体值时取并集（Vixie cron 语义）。用于 crontab、K8s CronJob、GitHub Actions。" },
    spring: { key: "spring", name: "Spring", count: 6, hasSec: true, dowFromOne: false, allowQuestion: true, strictQuestion: false, supportsLW: true, supportsYear: false,
      orderLabel: "秒 分 时 日 月 周",
      hint: "6 段，含秒。数字周 0=周日（7 也是周日）；同样接受 ? 与 L、W、# ，但不强制日/周二选一；另可直写 5 段（无秒），秒按 0 处理。用于 Spring @Scheduled、Quartz 兼容写法、xxl-job 默认。" },
    quartz: { key: "quartz", name: "Quartz", count: 6, hasSec: true, dowFromOne: true, allowQuestion: true, strictQuestion: true, supportsLW: true, supportsYear: true,
      orderLabel: "秒 分 时 日 月 周 [年]",
      hint: "6 或 7 段。「日」与「周」必须恰好有一个写 ? ，两者都给具体值会抛 ParseException；数字周从 1=周日 起；第 7 段「年」是 Quartz 独有，L、W、# 与 Spring 通用；另可直写 5 段（无秒），秒按 0 处理。用于 Quartz Scheduler、阿里 SchedulerX、多数国产任务平台。" },
  };

  /* ---------- token 解析 ---------- */

  function resolve(token, def, fmt) {
    var t = String(token).trim();
    if (/^\d{1,4}$/.test(t)) {
      var n = parseInt(t, 10);
      if (def.isDow) {
        if (fmt.dowFromOne) {
          if (n < 1 || n > 7) return null;
          return n - 1; // Quartz: 1=周日
        }
        if (n < 0 || n > 7) return null;
        return n % 7;   // Linux/Spring: 0 与 7 都是周日
      }
      if (n < def.min || n > def.max) return null;
      return n;
    }
    if (def.names) {
      var key = t.slice(0, 3).toLowerCase();
      if (Object.prototype.hasOwnProperty.call(def.names, key)) return def.names[key];
    }
    return null;
  }

  function blank(def) {
    return {
      raw: "",
      label: def.label,
      all: false,
      hasStep: false,
      values: [],
      set: null,
      sorted: null,
      domLast: false,
      domOffsetLast: 0,
      domLastWeekday: false,
      domNearest: null,
      dowLast: null,
      dowNth: null,
    };
  }

  function addRange(f, def, from, to, step) {
    var span = def.max - def.min + 1;
    if (from <= to) {
      for (var v = from; v <= to; v += step) f.values.push(v);
      return;
    }
    // 22-2 这类跨零点区间：按环上距离推进，而不是整圈取模（那样 step=1 会把所有值收进来）。
    var dist = (((to - from) % span) + span) % span;
    for (var i = 0; i <= dist; i += step) {
      f.values.push(((from - def.min + i) % span) + def.min);
    }
  }

  function parseToken(tok, def, fmt, f, errors) {
    tok = tok.trim();
    if (!tok) {
      errors.push(def.label + "字段有空的逗号段（多写了一个 , ）。");
      return;
    }

    if (tok === "*" || tok === "?") {
      if (tok === "?" && !fmt.allowQuestion) {
        errors.push("只有 Spring 与 Quartz 支持 ? ，" + def.label + "字段请改写 * 。");
        return;
      }
      if (tok === "?" && def.key !== "dom" && def.key !== "dow") {
        errors.push("? 只能用在「日」与「周」上，" + def.label + "字段请改写 * 。");
        return;
      }
      f.all = tok === "*";
      f.question = tok === "?";
      return;
    }

    // 日字段的 L / L-3 / LW / 15W —— Quartz 与 Spring 才有，Linux crontab 不认
    if (def.key === "dom" && /^L|\dW$|^LW$/i.test(tok)) {
      if (!fmt.supportsLW) {
        errors.push("Linux crontab 的日字段不支持 " + tok.toUpperCase() + " ，L / W 是 Spring 与 Quartz 的语法。");
        return;
      }
      var ld = tok.match(/^L(?:-(\d{1,2}))?$/i);
      if (ld) {
        var back = ld[1] ? parseInt(ld[1], 10) : 0;
        if (back > 30) { errors.push("日字段的 L-" + back + " 回溯超出范围。"); return; }
        f.domLast = true;
        f.domOffsetLast = back;
        return;
      }
      if (/^LW$/i.test(tok)) { f.domLastWeekday = true; return; }
      var nw = tok.match(/^(\d{1,2})W$/i);
      if (nw) {
        var target = parseInt(nw[1], 10);
        if (target < 1 || target > 31) { errors.push("日字段的 " + target + "W 超出 1-31。"); return; }
        f.domNearest = target;
        return;
      }
      errors.push("日字段的 " + tok + " 无法识别，W 的写法是 15W 或 LW 。");
      return;
    }

    // 周字段的 L / 6L / FRIL / 5#3
    if (def.key === "dow" && (/L$/i.test(tok) || /#/i.test(tok))) {
      if (!fmt.supportsLW) {
        errors.push("Linux crontab 的周字段不支持 " + tok.toUpperCase() + " ，L / # 是 Spring 与 Quartz 的语法。");
        return;
      }
      if (/^L$/i.test(tok)) {
        // 裸 L 在两种方言里都指向量纲末端那天，即 JS 的周六。
        f.dowLast = 6;
        return;
      }
      var dl = tok.match(/^(.+?)L$/i);
      if (dl) {
        var day = resolve(dl[1], def, fmt);
        if (day === null) { errors.push("周字段的 " + tok + " 无法识别。"); return; }
        f.dowLast = day;
        return;
      }
      var hash = tok.match(/^(.+?)#(\d)$/);
      if (hash) {
        var hd = resolve(hash[1], def, fmt);
        var nth = parseInt(hash[2], 10);
        if (hd === null) { errors.push("周字段的 " + tok + " 无法识别。"); return; }
        if (nth < 1 || nth > 5) { errors.push("周字段 # 的序号只能是 1-5，当前 " + nth + "。"); return; }
        f.dowNth = { dow: hd, nth: nth };
        return;
      }
      errors.push("周字段的 " + tok + " 无法识别，L 的写法是 6L 或 FRIL 。");
      return;
    }

    // 通用：* / a-b/n / a/n / a-b / a
    var starStep = tok.match(/^\*\/(\d{1,3})$/);
    if (starStep) {
      var ss = parseInt(starStep[1], 10);
      if (ss < 1) { errors.push(def.label + "字段的步长必须大于 0。"); return; }
      f.hasStep = true;
      addRange(f, def, def.min, def.max, ss);
      return;
    }

    var m = tok.match(/^([^/-]+)(?:-([^/-]+))?(?:\/(\d{1,3}))?$/);
    if (!m) {
      errors.push(def.label + "字段无法解析：" + tok);
      return;
    }
    var from = resolve(m[1], def, fmt);
    if (from === null) { errors.push(def.label + "字段的 " + m[1] + " 不是合法取值（" + label_range(def, fmt) + "）。"); return; }
    var to = from;
    if (m[2] !== undefined && m[2] !== "") {
      to = resolve(m[2], def, fmt);
      if (to === null) { errors.push(def.label + "字段的 " + m[2] + " 不是合法取值（" + label_range(def, fmt) + "）。"); return; }
    }
    var step = 1;
    if (m[3] !== undefined) {
      step = parseInt(m[3], 10);
      if (step < 1) { errors.push(def.label + "字段的步长必须大于 0。"); return; }
      f.hasStep = true;
      // a/n 形式（无第二段）语义是「从 a 起每 n」，上界取到量纲末端。
      if (m[2] === undefined || m[2] === "") to = def.max;
    }
    addRange(f, def, from, to, step);
  }

  function label_range(def, fmt) {
    if (def.isDow) return fmt.dowFromOne ? "1-7，1=周日" : "0-7，0=周日";
    return def.min + "-" + def.max;
  }

  function parseField(raw, def, fmt, errors) {
    var f = blank(def);
    f.raw = String(raw).trim();
    var before = errors.length;
    var toks = f.raw.split(",");
    for (var i = 0; i < toks.length; i++) parseToken(toks[i], def, fmt, f, errors);
    if (errors.length !== before) return f;

    var special = f.domLast || f.domLastWeekday || f.domNearest !== null || f.dowLast !== null || !!f.dowNth;
    if (f.all || f.question) {
      for (var v = def.min; v <= def.max; v++) f.values.push(v);
    }
    if (!f.values.length && !special) {
      errors.push(def.label + "字段没有任何有效取值。");
      return f;
    }
    f.set = new Set(f.values);
    f.sorted = Array.from(f.set).sort(function (a, b) { return a - b; });
    // 「全部」的判定要区分写法：`*` 与 `0-59` 语义相同，但 UI 要显示成用户写的那种。
    f.full = f.question || (f.all && f.raw === "*");
    return f;
  }

  /* ---------- 表达式解析 ---------- */

  function parse(raw, formatKey) {
    var errors = [];
    var warnings = [];
    var fmt = FORMATS[formatKey] || FORMATS.quartz;
    var text = String(raw == null ? "" : raw).trim().replace(/\s+/g, " ");
    var stub = { ok: false, fatal: true, format: fmt, text: text, errors: [], warnings: [] };

    if (!text) {
      stub.errors = ["请输入 Cron 表达式。"];
      return stub;
    }
    var parts = text.split(" ");
    var hasYear = false;
    // 含秒方言只写 5 段时按无秒简写处理：缺少的秒字段补 0，不报错也不改写文本。
    var noSecText = false;

    if (parts.length !== fmt.count) {
      if (fmt.supportsYear && parts.length === 7) {
        hasYear = true;
      } else if (parts.length === 5 && fmt.hasSec) {
        // Quartz / Spring 默认要 6 段，但 Linux 式 5 段简写（分 时 日 月 周）也直接收，
        // 语义与 Linux 完全一致，只是秒固定为 0——方便从 Linux 切过来不重写表达式。
        noSecText = true;
      } else if (parts.length === 6 && !fmt.hasSec) {
        errors.push("Linux crontab 只接受 5 段（分 时 日 月 周），当前 6 段：含秒的写法请改用 Spring 或 Quartz。");
      } else if (parts.length === 7) {
        errors.push("7 段（含年字段）只有 Quartz 支持。");
      } else {
        errors.push("表达式应为 " + fmt.count + " 段（" + fmt.orderLabel + "），当前 " + parts.length + " 段。");
      }
      if (errors.length) {
        stub.errors = errors;
        return stub;
      }
    }

    var i = 0;
    var spec = { ok: true, format: fmt, text: text, hasYear: hasYear, noSecText: noSecText, errors: errors, warnings: warnings };
    if (!fmt.hasSec || noSecText) {
      // Linux 没有秒位；含秒方言的 5 段简写同理，补常量 0，使后续推算与展示仍按「秒分时日月周」统一处理。
      spec.sec = parseField("0", DEFS.sec, fmt, errors);
      spec.sec.linuxFilled = true;
    } else {
      spec.sec = parseField(parts[i++], DEFS.sec, fmt, errors);
    }
    spec.min = parseField(parts[i++], DEFS.min, fmt, errors);
    spec.hour = parseField(parts[i++], DEFS.hour, fmt, errors);
    spec.dom = parseField(parts[i++], DEFS.dom, fmt, errors);
    spec.mon = parseField(parts[i++], DEFS.mon, fmt, errors);
    spec.dow = parseField(parts[i++], DEFS.dow, fmt, errors);
    if (hasYear) spec.year = parseField(parts[i], YEAR_DEF, fmt, errors);

    var domFree = spec.dom.question || spec.dom.full;
    var dowFree = spec.dow.question || spec.dow.full;
    if (fmt.strictQuestion && !spec.dom.question && !spec.dow.question && !domFree && !dowFree) {
      warnings.push("Quartz 要求「日」与「周」恰好有一个为 ? ，当前两者都是具体值，多数 Quartz 版本会直接抛 ParseException。");
    }

    spec.domRestricted = !domFree;
    spec.dowRestricted = !dowFree;
    // 只有 Linux crontab 在日与周同时受限时取并集（Vixie 语义）；Spring 与 Quartz 取交集，
    // 这也是它们需要 ? 这个「不指定」占位符的原因。
    spec.dayUnion = !fmt.allowQuestion && spec.domRestricted && spec.dowRestricted;
    if (spec.dayUnion) warnings.push("日与周都被限定，按 crontab 语义取并集：命中「日」或命中「周」都会触发。");

    spec.ok = errors.length === 0;
    return spec;
  }

  /* ---------- 日历 ---------- */

  function daysInMonth(y, mo) {
    return new Date(Date.UTC(y, mo, 0)).getUTCDate();
  }

  function dowOf(y, mo, d) {
    return new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
  }

  function lastWeekdayOfMonth(y, mo) {
    var d = daysInMonth(y, mo);
    while (d > 1) {
      var w = dowOf(y, mo, d);
      if (w !== 0 && w !== 6) return d;
      d--;
    }
    return d;
  }

  function nearestWeekday(y, mo, target) {
    var dim = daysInMonth(y, mo);
    var t = Math.min(target, dim);
    var w = dowOf(y, mo, t);
    if (w !== 0 && w !== 6) return t;
    if (w === 6) return t === 1 ? t + 2 : t - 1;
    return t === dim ? t - 2 : t + 1;
  }

  function nthWeekdayOfMonth(y, mo, wanted, nth) {
    var day = 1 + ((wanted - dowOf(y, mo, 1) + 7) % 7) + (nth - 1) * 7;
    return day <= daysInMonth(y, mo) ? day : -1;
  }

  function lastDowOfMonth(y, mo, wanted) {
    var d = daysInMonth(y, mo);
    while (d > 1 && dowOf(y, mo, d) !== wanted) d--;
    return dowOf(y, mo, d) === wanted ? d : -1;
  }

  function dayMatches(spec, p) {
    var dim = daysInMonth(p.year, p.month);
    var domOk = spec.dom.set.has(p.day);
    if (spec.dom.domLast) domOk = p.day === dim - spec.dom.domOffsetLast;
    if (spec.dom.domLastWeekday && p.day === lastWeekdayOfMonth(p.year, p.month)) domOk = true;
    if (spec.dom.domNearest !== null && p.day === nearestWeekday(p.year, p.month, spec.dom.domNearest)) domOk = true;

    var dow = dowOf(p.year, p.month, p.day);
    var dowOk = spec.dow.set.has(dow);
    if (spec.dow.dowNth && p.day === nthWeekdayOfMonth(p.year, p.month, spec.dow.dowNth.dow, spec.dow.dowNth.nth)) dowOk = true;
    if (spec.dow.dowLast !== null && p.day === lastDowOfMonth(p.year, p.month, spec.dow.dowLast)) dowOk = true;

    return spec.dayUnion ? domOk || dowOk : domOk && dowOk;
  }

  /* ---------- 推算 ---------- */

  function nextGE(sorted, v) {
    for (var i = 0; i < sorted.length; i++) if (sorted[i] >= v) return sorted[i];
    return null;
  }

  // 同一天内推进到比 h 更晚的下一个合法小时；当天没有合法小时了才进下一天。
  // 少了这一步，`0 30 22-2 * * ?` 会在 22:30 之后直接跳到次日，漏掉同一天的 23:30。
  function makeAdvance(spec, INST, hMin, mMin, sMin) {
    return function (y, mo, d, h) {
      var nh = nextGE(spec.hour.sorted, h + 1);
      if (nh !== null) return INST(y, mo, d, nh, mMin, sMin);
      return INST(y, mo, d + 1, hMin, mMin, sMin);
    };
  }

  // 逐字段推进：当前字段命不中就跳到该字段下一个允许值，并把更小的字段复位到各自最小值。
  // 相对「一秒一秒试」，`0 0 0 29 2 ?` 这种四年一发的表达式也能立刻给出结果。
  function nextTimes(spec, tz, fromMs, count) {
    if (!spec || !spec.ok) return { times: [], exhausted: false };
    var out = [];
    var sMin = spec.sec.sorted[0], mMin = spec.min.sorted[0], hMin = spec.hour.sorted[0];
    var p;
    var t = Math.floor(fromMs / 1000) * 1000 + 1000;
    var guard = 0;
    var INST = function (y, mo, d, h, mi, s) { return ZT.zonedToInstant(y, mo, d, h, mi, s, tz); };
    var advanceHour = makeAdvance(spec, INST, hMin, mMin, sMin);

    // 每一轮推进都必须让时刻严格前进。夏令时「不存在的墙上时间」会被 zonedToInstant
    // 挪回空隙之前，直接赋值就会原地打转（`0 30 2 ? * *` 在美国 3/8 恰好命中）。
    function moveTo(next) { t = next > t ? next : t + 1000; }

    // 4 月 31 日这类永不触发的表达式若一路找到公元 9998 年，会白烧两秒；
    // 界面本来就按「未来一百年」口径提示，推算也在此收口。
    var yLimit = ZT.zonedParts(fromMs, tz).year + 100;

    while (out.length < count) {
      if (guard++ > 200000) return { times: out, exhausted: true };
      p = ZT.zonedParts(t, tz);
      var y = p.year, mo = p.month, d = p.day, h = p.hour, mi = p.minute, s = p.second;

      if (y > yLimit) return { times: out, ended: true };
      if (spec.year) {
        var ny = nextGE(spec.year.sorted, y);
        if (ny === null) return { times: out, ended: true };
        if (ny !== y) { moveTo(INST(ny, 1, 1, hMin, mMin, sMin)); continue; }
      }

      var nmo = nextGE(spec.mon.sorted, mo);
      if (nmo === null) { moveTo(INST(y + 1, 1, 1, hMin, mMin, sMin)); continue; }
      if (nmo !== mo) { moveTo(INST(y, nmo, 1, hMin, mMin, sMin)); continue; }

      if (!dayMatches(spec, p)) { moveTo(INST(y, mo, d + 1, hMin, mMin, sMin)); continue; }

      var nh = nextGE(spec.hour.sorted, h);
      if (nh === null) { moveTo(INST(y, mo, d + 1, hMin, mMin, sMin)); continue; }
      if (nh !== h) { moveTo(INST(y, mo, d, nh, mMin, sMin)); continue; }

      var nmi = nextGE(spec.min.sorted, mi);
      if (nmi === null) { moveTo(advanceHour(y, mo, d, h)); continue; }
      if (nmi !== mi) { moveTo(INST(y, mo, d, h, nmi, sMin)); continue; }

      var ns = nextGE(spec.sec.sorted, s);
      if (ns === null) {
        var nmi2 = nextGE(spec.min.sorted, mi + 1);
        moveTo(nmi2 === null ? advanceHour(y, mo, d, h) : INST(y, mo, d, h, nmi2, sMin));
        continue;
      }
      if (ns !== s) { moveTo(INST(y, mo, d, h, mi, ns)); continue; }

      // 夏令时「不存在的时刻」会被 zonedToInstant 挪到别的墙上时间，读回来对不上就重新走一遍。
      p = ZT.zonedParts(t, tz);
      if (p.hour !== h || p.minute !== mi || p.second !== s || p.day !== d) {
        moveTo(Math.floor(t / 1000) * 1000 + 1000);
        continue;
      }

      out.push(t);
      t = t + 1000;
    }
    return { times: out, exhausted: false };
  }

  /* ---------- 中文描述 ---------- */

  function pad2(n) { return (n < 10 ? "0" : "") + n; }

  function joinValues(def, vals) {
    if (def.key === "dow") return vals.map(function (v) { return DOW_CN[v]; }).join("、");
    if (def.key === "mon") return vals.join("、");
    return vals.join("、");
  }

  function stepOf(f) {
    var v = f.sorted;
    if (!f.hasStep || v.length < 2) return null;
    var d = v[1] - v[0];
    if (d < 1) return null;
    for (var i = 2; i < v.length; i++) if (v[i] - v[i - 1] !== d) return null;
    return d;
  }

  function isFull(f, def) {
    if (f.question || f.full) return true;
    return f.sorted.length === def.max - def.min + 1;
  }

  function describeField(f, def) {
    // ? 的意思是「这一位不参与约束」，不能说成「每天」或「星期不限」。
    if (f.question) return "不指定";
    if (def.key === "dom") {
      var dparts = [];
      if (f.domLast) dparts.push(f.domOffsetLast ? "月末往前 " + f.domOffsetLast + " 天" : "每月最后一天");
      if (f.domLastWeekday) dparts.push("每月最后一个工作日");
      if (f.domNearest !== null) dparts.push("离 " + f.domNearest + " 号最近的工作日");
      if (dparts.length) return dparts.join("；");
      if (isFull(f, def)) return "每天";
      return "每月 " + f.sorted.join("、") + " 号";
    }
    if (def.key === "dow") {
      if (f.dowNth) return "每月第 " + f.dowNth.nth + " 个 " + DOW_CN[f.dowNth.dow];
      if (f.dowLast !== null) return "每月最后一个 " + DOW_CN[f.dowLast];
      if (isFull(f, def)) return "星期不限";
      return "每" + joinValues(def, f.sorted);
    }
    if (def.key === "mon") {
      if (isFull(f, def)) return "月份不限";
      return "每年 " + f.sorted.join("、") + " 月";
    }
    if (isFull(f, def)) return "每" + def.label;
    var st = stepOf(f);
    if (st && f.raw.indexOf("*") === 0) return "每 " + st + " " + def.unit;
    if (f.sorted.length === 1) return f.sorted[0] + " " + def.label;
    if (st) return def.label + " " + f.sorted.join("、") + "（间隔 " + st + "）";
    return def.label + " " + f.sorted.join("、");
  }

  function single(f) {
    return f.sorted.length === 1 ? f.sorted[0] : null;
  }

  // 一句话摘要：把「什么时候触发」讲成人话，细节仍由逐字段表兜底。
  function summarize(spec) {
    if (!spec || !spec.ok) return "";
    var date = [];
    if (!isFull(spec.mon, DEFS.mon)) date.push(describeField(spec.mon, DEFS.mon));

    var domFull = isFull(spec.dom, DEFS.dom);
    var dowFull = isFull(spec.dow, DEFS.dow);
    var domSpecial = spec.dom.domLast || spec.dom.domLastWeekday || spec.dom.domNearest !== null;
    var dowSpecial = spec.dow.dowNth || spec.dow.dowLast !== null;

    if (domSpecial || dowSpecial) {
      if (!domFull || domSpecial) date.push(describeField(spec.dom, DEFS.dom));
      if (!dowFull || dowSpecial) date.push(describeField(spec.dow, DEFS.dow));
    } else if (!domFull && !dowFull) {
      date.push("每月 " + spec.dom.sorted.join("、") + " 号" + (spec.dayUnion ? " 或 " : " 且 ") + joinValues(DEFS.dow, spec.dow.sorted));
    } else if (!domFull) {
      date.push("每月 " + spec.dom.sorted.join("、") + " 号");
    } else if (!dowFull) {
      date.push("每" + joinValues(DEFS.dow, spec.dow.sorted));
    } else {
      date.push("每天");
    }

    var h = single(spec.hour), m = single(spec.min), s = single(spec.sec);
    var time;
    if (h !== null && m !== null && s !== null) {
      time = pad2(h) + ":" + pad2(m) + ":" + pad2(s);
    } else {
      var tp = [];
      var hs = stepOf(spec.hour);
      if (!isFull(spec.hour, DEFS.hour)) tp.push(hs && spec.hour.raw.indexOf("*") === 0 ? "每 " + hs + " 小时" : spec.hour.sorted.join("、") + " 时");
      var ms = stepOf(spec.min);
      if (!isFull(spec.min, DEFS.min)) tp.push(ms && spec.min.raw.indexOf("*") === 0 ? "每 " + ms + " 分钟" : spec.min.sorted.join("、") + " 分");
      var ss = stepOf(spec.sec);
      if (!isFull(spec.sec, DEFS.sec) && !spec.sec.linuxFilled) tp.push(ss && spec.sec.raw.indexOf("*") === 0 ? "每 " + ss + " 秒" : spec.sec.sorted.join("、") + " 秒");
      time = tp.length ? tp.join(" ") : "每一刻";
    }
    var yearBit = spec.year && !isFull(spec.year, YEAR_DEF) ? describeField(spec.year, YEAR_DEF) + "，" : "";
    var day = date.join("，");
    if (day === "每天" && time.indexOf("每 ") === 0) return yearBit + time + "触发";
    return yearBit + day + "的 " + time + " 触发";
  }

  /* ---------- 方言互转 ---------- */

  // 周的数字在各方言里起点不同（Quartz 1=周日，Linux/Spring 0=周日），
  // 原样搬运会把「周一至周五」悄悄搬成另一批日子，所以换算时要把 dow 片段里的
  // 数字周序改写成等价写法；名称（MON…）、?、*、# / L 的序数部分不参与换算。
  function remapDowNum(nStr, srcOne, dstOne) {
    var n = parseInt(nStr, 10);
    if (isNaN(n)) return nStr;
    var js = srcOne ? n - 1 : (n === 7 ? 0 : n); // 先回到内部统一的 0=周日
    return String(dstOne ? js + 1 : js);
  }

  function remapDowToken(tok, srcOne, dstOne) {
    if (tok === "*" || tok === "?" || tok === "") return tok;
    if (!/[0-9]/.test(tok)) return tok; // 纯名称（MON-FRI、FRIL…）三种方言写法一致
    var hash = tok.indexOf("#");
    if (hash !== -1) {
      // # 右边是「第几个」，是序数不是星期几，不能跟着换算。
      return remapDowToken(tok.slice(0, hash), srcOne, dstOne) + tok.slice(hash);
    }
    if (/^[0-9]+L$/i.test(tok)) {
      // 6L / 7L 这类：只有前导数字是星期序。
      return remapDowToken(tok.slice(0, -1), srcOne, dstOne) + "L";
    }
    var parts = tok.split("/");
    var head = parts[0];
    var step = parts.length > 1 ? "/" + parts.slice(1).join("/") : "";
    if (head === "*") return tok;
    if (!/[A-Za-z]/.test(head)) {
      // 纯数字段：N 或 N-M，两端都是星期取值，按源方言→内部→目标方言换算。
      head = head.split("-").map(function (s) { return remapDowNum(s, srcOne, dstOne); }).join("-");
    }
    return head + step;
  }

  function remapDowRaw(raw, srcOne, dstOne) {
    if (srcOne === dstOne) return raw;
    return String(raw).split(",").map(function (t) { return remapDowToken(t.trim(), srcOne, dstOne); }).join(",");
  }

  // 只搬运用户写的原始片段，段数与 ? 按目标方言的必要规则调整，不重排值。
  function convert(spec, targetKey) {
    if (!spec || !spec.ok) return null;
    var target = FORMATS[targetKey];
    if (!target) return null;

    var dom = spec.dom.raw.trim();
    var dow = remapDowRaw(spec.dow.raw.trim(), spec.format.dowFromOne, target.dowFromOne);
    if (target.allowQuestion) {
      var domConcrete = dom !== "*" && dom !== "?";
      var dowConcrete = dow !== "*" && dow !== "?";
      if (target.strictQuestion && !(domConcrete && dowConcrete)) {
        // Quartz 要求恰好一个 ? ：只让「本来就没约束」的那一段变成 ? ，绝不动有值的那一段。
        if (domConcrete) dow = "?";
        else if (dowConcrete) dom = "?";
        else { dom = "*"; dow = "?"; }
      }
    } else {
      if (dom === "?") dom = "*";
      if (dow === "?") dow = "*";
    }

    var fields = [];
    if (target.hasSec) fields.push(spec.sec.linuxFilled ? "0" : spec.sec.raw);
    fields.push(spec.min.raw, spec.hour.raw, dom, spec.mon.raw, dow);
    if (spec.hasYear && target.supportsYear && spec.year) fields.push(spec.year.raw);
    return fields.join(" ").replace(/\s+/g, " ").trim();
  }

  // 转换是否丢了信息：年字段、L/W/# 这类目标方言不认的写法，界面要提示用户手工复核。
  function convertNotice(spec, targetKey) {
    if (!spec || !spec.ok) return "";
    var target = FORMATS[targetKey];
    if (!target) return "";
    var msgs = [];
    if (spec.hasYear && !target.supportsYear) msgs.push("目标格式没有年字段，已丢弃末段。");
    var special = spec.dom.domLast || spec.dom.domLastWeekday || spec.dom.domNearest !== null ||
      spec.dow.dowLast !== null || !!spec.dow.dowNth;
    if (special && !target.supportsLW) msgs.push("表达式里的 L / W / # 是 Spring 与 Quartz 的语法，Linux crontab 不认，转换结果需手工改写。");
    if (spec.dayUnion && target.allowQuestion) msgs.push("Linux 的「日」与「周」同时指定时取并集，Spring 与 Quartz 取交集，转换后触发日期会变。");
    return msgs.join("");
  }

  // 预设要落到某个当前格式：能无损表达就给出实际可载入的文本，否则说明置灰原因。
  // 「无损」的判定：秒位不是纯 0 而目标没有秒字段、年段、L/W/#、日/周并集语义任一出现
  // 都表达不了；通过之后再折算，并确认折算结果在目标格式下真的能解析——
  // 否则就会出现「提示的是原文、点下去却报段数错误」这类错位。
  function presetFit(item, targetKey) {
    var target = FORMATS[targetKey];
    var same = item.fmt === targetKey;
    if (same) return { text: item.expr, disabled: false, reason: "" };
    var spec = parse(item.expr, item.fmt);
    if (!spec || !spec.ok) {
      return { text: "", disabled: true, reason: "预设本身写法有误，无法解析。" };
    }
    var reasons = [];
    // 含秒的预设里只有「秒 = 0」才等于 Linux 每分只跑一次的语义，其它秒级节奏都表达不了。
    if (spec.sec && spec.sec.raw !== "0" && !target.hasSec) {
      reasons.push("按秒粒度触发，而 " + target.name + " 没有秒字段，无法原样表达；请切到 Spring 或 Quartz。");
    }
    if (spec.hasYear && !target.supportsYear) {
      reasons.push("带第 7 段年字段，只有 Quartz 能表达，当前 " + target.name + " 无法原样表达。");
    }
    var special = spec.dom.domLast || spec.dom.domLastWeekday || spec.dom.domNearest !== null ||
      spec.dow.dowLast !== null || !!spec.dow.dowNth;
    if (special && !target.supportsLW) {
      reasons.push("用了 L / W / #（月末、最后一个周几、最近工作日、第几个周几），" +
        target.name + " 不支持这类语法；请切到 Spring 或 Quartz。");
    }
    if (spec.dayUnion && target.allowQuestion) {
      reasons.push("日与周同时指定在 " + target.name + " 里只能取交集（需 ? 占位），并集语义无法原样转写。");
    }
    if (reasons.length) {
      return { text: "", disabled: true, reason: reasons.join(" ") };
    }
    var c = convert(spec, targetKey);
    var re = c == null ? null : parse(c, targetKey);
    if (c == null || !re || !re.ok) {
      return { text: "", disabled: true, reason: "无法无损折算成 " + target.name + " 写法，请在原格式下使用。" };
    }
    return { text: c, disabled: false, reason: "" };
  }

  /* ---------- 预设 ---------- */

  var PRESETS = [
    { group: "按秒", items: [
      { expr: "* * * * * ?", fmt: "quartz", name: "每秒" },
      { expr: "*/10 * * * * ?", fmt: "quartz", name: "每 10 秒" },
      { expr: "0/30 * * * * ?", fmt: "quartz", name: "每 30 秒" },
    ] },
    { group: "按分", items: [
      { expr: "0 * * * * ?", fmt: "quartz", name: "每分钟" },
      { expr: "0 */5 * * * ?", fmt: "quartz", name: "每 5 分钟" },
      { expr: "*/15 * * * *", fmt: "linux", name: "每刻钟" },
      { expr: "*/15 9-18 * * 1-5", fmt: "linux", name: "工作时段每 15 分钟" },
    ] },
    { group: "按天", items: [
      { expr: "0 0 * * * ?", fmt: "quartz", name: "每小时整点" },
      { expr: "0 0 0 * * ?", fmt: "quartz", name: "每天零点" },
      { expr: "0 30 8 * * ?", fmt: "quartz", name: "每天 08:30" },
      { expr: "0 0 2 * * ?", fmt: "quartz", name: "每天 02:00" },
      { expr: "0 * * * *", fmt: "linux", name: "每小时（Linux）" },
    ] },
    { group: "按周月", items: [
      { expr: "0 30 9 ? * MON-FRI", fmt: "quartz", name: "工作日 09:30" },
      { expr: "0 0 9 * * 1-5", fmt: "spring", name: "工作日 09:00" },
      { expr: "0 0 0 ? * SAT,SUN", fmt: "quartz", name: "周末零点" },
      { expr: "0 0 0 1 * ?", fmt: "quartz", name: "每月 1 日零点" },
      { expr: "0 0 0 ? * 6L", fmt: "quartz", name: "每月最后一个周五" },
      { expr: "0 0 2 ? * SUN#2", fmt: "quartz", name: "每月第 2 个周日 02:00" },
    ] },
    { group: "按季年", items: [
      { expr: "0 0 0 1 1,4,7,10 ?", fmt: "quartz", name: "每季度首日" },
      { expr: "0 0 0 1 1 ?", fmt: "quartz", name: "每年元旦" },
      { expr: "0 0 1 1 *", fmt: "linux", name: "每年 1 月 1 日 01:00" },
      { expr: "30 4 * * 0", fmt: "linux", name: "每周日 04:30" },
    ] },
  ];

  window.ZtCron = {
    FORMATS: FORMATS,
    DEFS: DEFS,
    YEAR_DEF: YEAR_DEF,
    ORDER: ORDER,
    DOW_CN: DOW_CN,
    PRESETS: PRESETS,
    parse: parse,
    nextTimes: nextTimes,
    describeField: describeField,
    summarize: summarize,
    convert: convert,
    convertNotice: convertNotice,
    presetFit: presetFit,
    isFull: isFull,
    daysInMonth: daysInMonth,
    dowOf: dowOf,
  };
})();
