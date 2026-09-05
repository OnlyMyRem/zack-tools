/* 时间戳转换工具。全部逻辑在客户端，时区换算依赖 assets/js/time.js。 */

(function () {
  var T = window.ZtTime;
  var U = window.ZtUtil;

  var $ = function (id) { return document.getElementById(id); };
  var tzSel = $("tz");
  var tsInput = $("ts-input");
  var tsUnit = $("ts-unit");
  var wallInput = $("wall-input");
  var wallPicker = $("wall-picker");

  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  var tz = U.readZone();

  function set(id, text, empty) {
    var el = $(id);
    if (!el) return;
    el.textContent = text == null || text === "" ? (empty || "—") : text;
    el.classList.toggle("empty-val", text == null || text === "");
  }

  // 让某一行的复制按钮复制指定文本而不是行内展示文本；清空时删掉属性，免得留下上一次的旧值。
  function copyTextOf(rowId, text) {
    var row = $(rowId);
    var btn = row && row.querySelector(".copy");
    if (!btn) return;
    if (text) btn.dataset.copyText = text;
    else delete btn.dataset.copyText;
  }

  // 主结果行拆成「核心 + 星期」两段渲染：日期时间那串定宽不缩，
  // 挤不下时 CSS 只让末尾的星期收掉，被复制的那串永远完整。
  function setMainDateTime(instant) {
    var el = $("ts-datetime");
    var dt = document.createElement("b");
    dt.className = "dt";
    dt.textContent = T.format(instant, tz);
    var wk = document.createElement("span");
    wk.className = "wk";
    wk.textContent = T.weekdayName(instant, tz);
    el.textContent = "";
    el.appendChild(dt);
    el.appendChild(wk);
    el.classList.remove("empty-val");
  }

  /* ---------- 当前时间戳 ---------- */

  // 基准栏的「距今」和自动跟随的「最近一个」最细也只到秒，250ms 一跳不必重画；
  // 闸门带上时区，换时区时即使落在同一秒内也会立刻重算。
  var lastRailStamp = "";

  function tick() {
    var now = Date.now();
    set("now-sec", String(Math.floor(now / 1000)));
    set("now-ms", String(now));
    var nowInfo = $("tz-now");
    if (nowInfo) nowInfo.textContent = T.format(now, tz);
    // 星期、偏移写成一段，时区 ID 单拆成 .zn：窄屏先让整条元信息沉到第二行，
    // 第二行还塞不下就整段省掉 ID（ID 本来就写在上方下拉框里）。
    var meta = $("tz-now-meta");
    if (meta) {
      var head = T.weekdayName(now, tz) + " · " + T.tzLabel(now, tz);
      var idText = " · " + tz;
      if (meta.textContent !== head + idText) {
        meta.textContent = "";
        var headEl = document.createElement("span");
        headEl.textContent = head;
        var idEl = document.createElement("span");
        idEl.className = "zn";
        idEl.textContent = idText;
        meta.appendChild(headEl);
        meta.appendChild(idEl);
        fitTzMeta();
      }
    }
    var stamp = tz + "|" + Math.floor(now / 1000);
    if (stamp !== lastRailStamp) {
      lastRailStamp = stamp;
      renderBases(now);
    }
  }

  // 250ms 而不是 1000ms：整秒跳动的可见延迟被压到 1/4 秒内，毫秒卡片也不再明显滞后。
  function startClock() {
    tick();
    setInterval(tick, 250);
  }

  // 值被省略号咬掉的判据：内容宽度大于自身可见宽度。flex item 的 clientWidth 一定有值，
  // 所以先摘掉标记按「不换行」量一次，再决定要不要加回去——加了标记它就占满整行，永远量不出「塞不下」。
  function clipped(el) {
    return el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1;
  }

  // 「该时区当前时间」虚线框里的元信息分两步让位：第一行放不下就整条沉到第二行，
  // 第二行还是放不下（超长 ID 配窄屏）就把时区 ID 那一段省掉，两头都不留半截字。
  function fitTzMeta() {
    var box = $("tz-now-row");
    var meta = $("tz-now-meta");
    if (!box || !meta) return;
    box.classList.remove("tight");
    meta.classList.remove("no-zone");
    if (clipped(meta)) box.classList.add("tight");
    if (clipped(meta)) meta.classList.add("no-zone");
  }

  /* ---------- 「填入下方」落点动画 ---------- */

  var reduceMotion = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)").matches : false;

  // 连点时先收掉上一枚还在飞的数字，免得两枚叠在一起看不清落点。
  function clearFlights() {
    Array.prototype.forEach.call(document.querySelectorAll(".fly"), function (n) {
      if (n._timer) clearTimeout(n._timer);
      n._dead = true;
      if (n.parentNode) n.parentNode.removeChild(n);
    });
  }

  function land(target) {
    target.classList.remove("landed");
    void target.offsetWidth; // 同一个框连点两次也要重播这一圈高亮
    target.classList.add("landed");
  }

  function waitScrollEnd(cb) {
    var last = -1, same = 0, tries = 0;
    var timer = setInterval(function () {
      var y = window.pageYOffset;
      same = y === last ? same + 1 : 0;
      last = y;
      if (++tries > 12 || same >= 2) {
        clearInterval(timer);
        cb();
      }
    }, 55);
  }

  function fly(chip, target, text) {
    var token = document.createElement("span");
    token.className = "fly mono";
    token.textContent = text;
    document.body.appendChild(token);
    var a = chip.getBoundingClientRect();
    var b = target.getBoundingClientRect();
    token.style.left = a.left + "px";
    token.style.top = a.top + "px";
    var dx = b.left + 12 - a.left;
    var dy = b.top + b.height / 2 - a.top - token.offsetHeight / 2;
    // 抛物线：纵向取 y = dy*p - hop*4p(1-p)，形状就是那道弧；速度曲线放在 offset 上
    // （整圈保持线性计时），前 72% 走完并带一点加速，最后一段只在落点缩小淡出，
    // 免得末尾那截平移看着像卡在框边上。
    var hop = Math.min(Math.max(14, Math.abs(dy) * 0.24), 44);
    var stops = [0, 0.14, 0.31, 0.51, 0.72];
    var frames = [];
    for (var i = 0; i < stops.length; i++) {
      var p = stops[i] / 0.72;
      frames.push({
        offset: stops[i],
        transform: "translate(" + dx * p + "px, " + (dy * p - hop * 4 * p * (1 - p)) + "px) scale(" + (1 + 0.08 * Math.sin(Math.PI * p)) + ")",
        opacity: 1
      });
    }
    frames.push({ offset: 1, transform: "translate(" + dx + "px, " + dy + "px) scale(0.9)", opacity: 0.1 });
    var anim = token.animate(frames, 560);
    var settled = false;
    function settle() {
      if (settled || token._dead) return;
      settled = true;
      if (token.parentNode) token.parentNode.removeChild(token);
      land(target);
    }
    anim.onfinish = settle;
    // 切到后台时 finish 事件可能不派发，兜一圈定时器，别让数字留在页面上不落。
    token._timer = setTimeout(settle, 640);
  }

  // 两栏并排的桌面宽度下目标本来就在屏内，一步都不滚；窄屏才先把它带进视野。
  function jumpTo(chip, target, text) {
    clearFlights();
    var hang = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--hang-h")) || 48;
    var r = target.getBoundingClientRect();
    var viewH = window.innerHeight || document.documentElement.clientHeight;
    var needsScroll = r.top < hang || r.bottom > viewH - 8;
    var go = function () {
      if (reduceMotion || !target.animate) land(target);
      else fly(chip, target, text);
    };
    if (needsScroll) {
      target.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
      waitScrollEnd(go);
    } else {
      go();
    }
  }

  /* ---------- 时间戳 → 日期时间 ---------- */

  function readDigits(raw) {
    var s = String(raw || "").trim().replace(/[,\s_]/g, "");
    if (!/^-?\d{1,20}$/.test(s)) return null;
    return s;
  }

  function toInstant(digits, unit) {
    var n = Number(digits);
    var isMs = unit === "ms" || (unit === "auto" && Math.abs(n) >= 1e11);
    return { instant: isMs ? n : n * 1000, unit: isMs ? "ms" : "s" };
  }

  function isoWithOffset(instant) {
    var p = T.zonedParts(instant, tz);
    // 整秒拆，LMT（1901 年前的 Asia/Shanghai = +08:05:43）才不会写成 "08:5.7166…"。
    var off = T.zoneOffset(instant, tz);
    var abs = Math.abs(Math.round(off / 1000));
    var h = U.pad(Math.floor(abs / 3600));
    var m = U.pad(Math.floor(abs / 60) % 60);
    var s = U.pad(abs % 60);
    return (
      p.year + "-" + U.pad(p.month) + "-" + U.pad(p.day) + "T" +
      U.pad(p.hour) + ":" + U.pad(p.minute) + ":" + U.pad(p.second) +
      (off < 0 ? "-" : "+") + h + ":" + m + (s === "00" ? "" : ":" + s)
    );
  }

  function rfc2822(instant) {
    var p = T.zonedParts(instant, tz);
    // RFC 2822 只承认 ±HHMM，带秒的 LMT 偏移就近取整到分钟。
    var off = T.zoneOffset(instant, tz);
    var a = Math.abs(Math.round(off / 60000));
    return (
      T.weekdayEn(instant, tz) + ", " + U.pad(p.day) + " " + MONTHS[p.month - 1] + " " +
      p.year + " " + U.pad(p.hour) + ":" + U.pad(p.minute) + ":" + U.pad(p.second) + " " +
      (off < 0 ? "-" : "+") + U.pad(Math.floor(a / 60)) + U.pad(a % 60)
    );
  }

  function dayOfYear(instant) {
    var p = T.zonedParts(instant, tz);
    var first = Date.UTC(p.year, 0, 1);
    var cur = Date.UTC(p.year, p.month - 1, p.day);
    var total = (Date.UTC(p.year + 1, 0, 1) - first) / 86400000;
    return { n: Math.floor((cur - first) / 86400000) + 1, total: total };
  }

  function clearResult() {
    copyTextOf("ts-main-row", "");
    ["ts-datetime", "ts-weekday", "ts-iso", "ts-utc", "ts-rfc", "ts-doy"].forEach(function (id) {
      set(id, "");
    });
    $("ts-src-note").textContent = "";
    tsInput.classList.remove("invalid");
  }

  function convertFromTs() {
    var digits = readDigits(tsInput.value);
    if (!digits) {
      clearResult();
      if (tsInput.value.trim()) {
        tsInput.classList.add("invalid");
        $("ts-src-note").textContent = "时间戳只能是纯数字（可带负号），当前输入无法解析。";
        $("ts-src-note").className = "note error";
      } else {
        $("ts-src-note").textContent = "";
      }
      return;
    }
    tsInput.classList.remove("invalid");
    var picked = tsUnit.value;
    var r = toInstant(digits, picked);
    var instant = r.instant;

    if (!isFinite(instant) || Math.abs(instant) > 8.64e15) {
      clearResult();
      $("ts-src-note").textContent = "数值超出 Date 可表示范围（约 ±2.75 亿年），请检查位数。";
      $("ts-src-note").className = "note error";
      return;
    }

    var note = $("ts-src-note");
    note.className = "note";
    note.textContent =
      picked === "auto" && digits.replace("-", "").length > 14 ? " 位数偏多，可在上方手动指定单位。" : "";

    setMainDateTime(instant);
    // 星期另起一段、间距由 CSS 给，复制给代码用的仍是干净的 YYYY-MM-DD HH:MM:SS。
    copyTextOf("ts-main-row", T.format(instant, tz));
    set("ts-weekday", T.weekdayName(instant, tz) + "（" + T.weekdayEn(instant, tz) + "）");
    set("ts-iso", isoWithOffset(instant));
    set("ts-utc", new Date(instant).toISOString());
    set("ts-rfc", rfc2822(instant));
    var doy = dayOfYear(instant);
    set("ts-doy", "第 " + doy.n + " 天 / 全年 " + doy.total + " 天");
  }

  /* ---------- 日期时间 → 时间戳 ---------- */

  var lastWallInstant = null;
  // 主结果行当前显示哪一档：秒级 (s) 还是毫秒级 (ms)。切换只影响显示，不重算。
  var wallUnit = "s";

  // 值区同一时刻只放一份时间戳，档位由右上角两段开关决定；复制按钮复制的就是这份。
  function renderWallMain() {
    set("wall-ts", lastWallInstant === null ? "" : String(wallUnit === "ms" ? lastWallInstant : Math.floor(lastWallInstant / 1000)));
  }

  // 把两段开关的高亮移到当前档位。
  function paintWallUnit() {
    Array.prototype.forEach.call(document.querySelectorAll("#wall-unit .unit-btn"), function (b) {
      b.setAttribute("aria-pressed", b.dataset.unit === wallUnit ? "true" : "false");
    });
  }

  function clearWall() {
    lastWallInstant = null;
    ["wall-ts", "wall-weekday", "wall-iso", "wall-utc", "wall-rfc", "wall-doy"].forEach(function (id) { set(id, ""); });
    wallInput.classList.remove("invalid");
  }

  function convertFromWall() {
    var raw = wallInput.value.trim();
    if (!raw) {
      clearWall();
      $("wall-note").textContent = "";
      $("wall-note").className = "note";
      return;
    }
    var w = T.parseWall(raw);
    if (!w || w.mo > 12 || w.d > 31) {
      clearWall();
      wallInput.classList.add("invalid");
      var n = $("wall-note");
      n.className = "note error";
      n.textContent = "无法解析，请用 2026-09-04 21:30:00 或 2026-09-04T21:30:00 这类写法。";
      return;
    }
    wallInput.classList.remove("invalid");
    var instant = T.zonedToInstant(w.y, w.mo, w.d, w.h, w.mi, w.s, tz) + w.ms;

    // 夏令时地区存在「不存在的时刻」（春季拨快跳过的一小时），回读会漂走，必须显式提示。
    var back = T.zonedParts(instant, tz);
    var drift = back.hour !== w.h || back.minute !== w.mi;
    lastWallInstant = instant;

    renderWallMain();
    set("wall-weekday", T.weekdayName(instant, tz) + "（" + T.weekdayEn(instant, tz) + "）");
    set("wall-iso", isoWithOffset(instant));
    set("wall-utc", new Date(instant).toISOString());
    set("wall-rfc", rfc2822(instant));
    var doy = dayOfYear(instant);
    set("wall-doy", "第 " + doy.n + " 天 / 全年 " + doy.total + " 天");
    wallToPicker(instant);

    var note = $("wall-note");
    if (drift) {
      note.className = "note error";
      note.textContent =
        tz + " 当天不存在 " + U.pad(w.h) + ":" + U.pad(w.mi) + "（夏令时切换跳过），已按 " +
        U.pad(back.hour) + ":" + U.pad(back.minute) + " 计算。";
    } else {
      note.className = "note";
      note.textContent = "";
    }
  }

  // 原生选择器的值是「裸墙上时间」，不带时区，正好直接当作所选时区的墙上时间。
  function pickerToWall() {
    var v = wallPicker.value;
    if (!v) return;
    var m = v.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
    if (!m) return;
    wallInput.value = m[1] + "-" + m[2] + "-" + m[3] + " " + m[4] + ":" + m[5] + ":" + (m[6] || "00");
    convertFromWall();
  }

  function wallToPicker(instant) {
    var p = T.zonedParts(instant, tz);
    wallPicker.value =
      p.year + "-" + U.pad(p.month) + "-" + U.pad(p.day) + "T" + U.pad(p.hour) + ":" + U.pad(p.minute) + ":" + U.pad(p.second);
  }

  function setWallFromInstant(instant) {
    wallInput.value = T.format(instant, tz);
    wallToPicker(instant);
    convertFromWall();
  }

  // 整块按钮盖着透明输入框，可 Chromium 只在自己的图标被点到时才弹日历，所以显式 showPicker()。
  function bindCalPicker() {
    $("wall-cal").addEventListener("click", function () {
      try {
        wallPicker.showPicker();
      } catch (e) {
        // 没有该 API 或浏览器拒绝时退回聚焦，用户点原生图标仍可弹日历。
        wallPicker.focus();
      }
    });
  }

  /* ---------- 常用基准时间（右侧栏） ---------- */

  /* 三组对应 timestamp.xlsx 的三张表：每张表前两列各自是一个可选项列表，
     第三列「时间戳」由选中的一对值算出。年份 1970-2050 取表里给的起止。 */

  function range(from, to, step) {
    var out = [];
    for (var v = from; v <= to; v += step || 1) out.push(v);
    return out;
  }

  // 该月第 n 个周一是几号。第 4 个周一最晚落在 28 日，任何月份都存在。
  function nthMondayDay(year, month, n) {
    var dow1 = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
    return 1 + ((8 - dow1) % 7) + (n - 1) * 7;
  }

  function wantParts(y, mo, d, h, mi) {
    return { year: y, month: mo, day: d, hour: h, minute: mi, second: 0 };
  }

  // 「分」列按所选粒度重建选项，纯数字显示（rail 窄放不下单位）；save 值会随粒度取整，保证始终命中某个合法分钟。
  function minuteOptions(step) {
    return range(0, 59, step).map(function (m) { return { v: m, t: U.pad(m) }; });
  }

  var BASE_GROUPS = [
    {
      key: "day",
      title: "典型分钟级",
      desc: "选 年、月、日、时、分；分按 1 / 5 / 15 分钟切换粒度。未手动改动会自动停在最近时刻。",
      // 粒度按钮：切换「分」列的步进。
      granular: [
        { step: 1, t: "1 分钟", def: false },
        { step: 5, t: "5 分钟", def: true },
        { step: 15, t: "15 分钟", def: false },
      ],
      cols: [
        { label: "年", options: range(1970, 2050).map(function (y) { return { v: y, t: String(y) }; }) },
        { label: "月", options: range(1, 12).map(function (mo) { return { v: mo, t: String(mo) }; }) },
        { label: "日", options: range(1, 31).map(function (d) { return { v: d, t: String(d) }; }) },
        { label: "时", options: range(0, 23).map(function (h) { return { v: h, t: U.pad(h) }; }) },
        { label: "分", step: 5, options: minuteOptions(5) },
      ],
      resolve: function (now, v) {
        var want = wantParts(v[0], v[1], v[2], v[3], v[4]);
        return { instant: T.zonedToInstant(v[0], v[1], v[2], v[3], v[4], 0, tz), want: want };
      },
    },
    {
      key: "ym",
      title: "典型日",
      desc: "选 年、月、该月哪一天（第一天或第 N 周周一）。未手动改动会自动停在最近时刻。",
      cols: [
        { label: "年份", options: range(1970, 2050).map(function (y) { return { v: y, t: String(y) }; }) },
        { label: "月份", options: range(1, 12).map(function (mo) { return { v: mo, t: mo + " 月" }; }) },
        {
          label: "该月",
          options: [
            { v: 0, t: "第一天" },
            { v: 1, t: "第1周周一" },
            { v: 2, t: "第2周周一" },
            { v: 3, t: "第3周周一" },
            { v: 4, t: "第4周周一" },
          ],
        },
      ],
      resolve: function (now, v) {
        var y = v[0], mo = v[1], rule = v[2];
        var d = rule === 0 ? 1 : nthMondayDay(y, mo, rule);
        var want = wantParts(y, mo, d, 0, 0);
        return { instant: T.zonedToInstant(y, mo, d, 0, 0, 0, tz), want: want };
      },
    },
  ];

  // 默认停在「最近一个」：每列的取值都随选项序号单调不减（年→月→日、时→分都如此），
  // 于是外层列倒着找，第一个「子树里有不晚于当前时刻的组合」的档位就是最大档位；
  // 最内层列顺序扫完取最后一个命中，同刻并列时保留更靠前的一档（如某月 1 号正好是周一）。
  function pickRecent(group, now) {
    var cols = group.cols;
    var last = cols.length - 1;

    function walk(depth, vals) {
      var opts = cols[depth].options;
      var i, k;
      if (depth === last) {
        var best = null;
        for (i = 0; i < opts.length; i++) {
          vals[depth] = opts[i].v;
          var instant = group.resolve(now, vals).instant;
          if (instant <= now && (!best || instant > best.instant)) best = { vals: vals.slice(), instant: instant };
        }
        return best;
      }
      for (i = opts.length - 1; i >= 0; i--) {
        vals[depth] = opts[i].v;
        // 后面各列都取最小档就是这一档的下界，整棵子树都在未来时一次跳过，不必逐条试。
        var probe = vals.slice(0, depth + 1);
        for (k = depth + 1; k <= last; k++) probe[k] = cols[k].options[0].v;
        if (group.resolve(now, probe).instant > now) continue;
        var hit = walk(depth + 1, vals);
        if (hit) return hit;
      }
      return null;
    }

    var found = walk(0, []);
    if (found) return found;
    var first = cols.map(function (c) { return c.options[0].v; });
    return { vals: first, instant: group.resolve(now, first).instant };
  }

  var rail = {};

  function groupHtml(g) {
    function selectHtml(col, i) {
      var id = "bg-" + g.key + "-" + i;
      return (
        '<div class="field"><label class="field-label" for="' + id + '">' + col.label + "</label>" +
        '<div class="sel">' +
        '<select id="' + id + '" data-role="' + i + '">' +
        col.options.map(function (o) { return '<option value="' + o.v + '">' + o.t + "</option>"; }).join("") +
        "</select>" +
        '<span class="sel-step">' +
        '<button class="step" type="button" data-col="' + i + '" data-step="-1" title="上一项" aria-label="' + col.label + '上一项"></button>' +
        '<button class="step" type="button" data-col="' + i + '" data-step="1" title="下一项" aria-label="' + col.label + '下一项"></button>' +
        "</span></div></div>"
      );
    }
    return (
      '<section class="bg" data-g="' + g.key + '">' +
        '<div class="bg-head"><h3>' + g.title + "</h3>" +
          '<span class="bg-head-r">' +
            '<span class="bg-tag auto" data-role="tag">自动 · 最近</span>' +
            '<button class="bg-recent" type="button" data-role="recent" disabled>回到最近</button>' +
          "</span></div>" +
        (g.desc ? '<p class="bg-desc">' + g.desc + "</p>" : "") +
        (g.granular && g.granular.length
          ? '<div class="bg-gran" data-role="gran">' +
            g.granular.map(function (gr) {
              return '<button type="button" class="gran" data-step="' + gr.step + '"' + (gr.def ? " aria-pressed=\"true\"" : ' aria-pressed="false"') + ">" + gr.t + "</button>";
            }).join("") +
            "</div>"
          : "") +
        '<div class="bg-pick cols-' + g.cols.length + '">' + g.cols.map(selectHtml).join("") + "</div>" +
        '<div class="bg-out">' +
          '<div class="bg-secrow"><b class="bg-sec" data-role="sec">—</b>' +
            '<button class="copy" type="button" data-role="copy">复制</button></div>' +
          '<div class="bg-line"><span>毫秒级</span><b class="mono" data-role="ms">—</b></div>' +
          '<div class="bg-line"><span>该时区</span><b class="mono" data-role="wall">—</b></div>' +
          '<div class="bg-line"><span>距今</span><b data-role="rel">—</b></div>' +
          '<p class="bg-warn note error" data-role="warn" hidden></p>' +
        "</div>" +
      "</section>"
    );
  }

  function buildRail() {
    $("base-groups").innerHTML = BASE_GROUPS.map(groupHtml).join("");
    BASE_GROUPS.forEach(function (g) {
      var card = document.querySelector('.bg[data-g="' + g.key + '"]');
      var st = { group: g, card: card, touched: false, stamp: "" };
      ["sec", "ms", "wall", "rel", "warn", "tag", "copy"].forEach(function (role) {
        st[role] = card.querySelector('[data-role="' + role + '"]');
      });
      st.selects = Array.prototype.slice.call(card.querySelectorAll(".bg-pick select"));
      st.steps = Array.prototype.slice.call(card.querySelectorAll(".step"));
      st.recentBtn = card.querySelector('[data-role="recent"]');
      st.gran = Array.prototype.slice.call(card.querySelectorAll(".gran"));
      rail[g.key] = st;
    });

    // 粒度按钮的按下态跟随当前选中：初次进页面时为默认档。
    BASE_GROUPS.forEach(function (g) {
      if (!g.granular || !g.granular.length) return;
      paintGranular(rail[g.key]);
    });
  }

  // 根据当前「分」列的实际步进，把对应粒度按钮标成已选。
  function paintGranular(st) {
    if (!st.gran.length) return;
    var col = st.group.cols[st.group.cols.length - 1];
    var step = col.step || 5;
    st.gran.forEach(function (b) {
      var on = Number(b.dataset.step) === step;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  // 切换粒度：重建「分」列的选项，并把当前选中分钟对齐到新粒度，保持语义不失真。
  function setGranular(st, step) {
    var col = st.group.cols[st.group.cols.length - 1];
    if (col.step === step) return;
    var sel = st.selects[st.selects.length - 1];
    var cur = Number(sel.value) || 0;
    col.step = step;
    col.options = minuteOptions(step);
    // 重绘该 select 的选项，保留当前分钟（按新粒度向下取整，避免落到非法分钟）。
    sel.innerHTML = col.options.map(function (o) {
      return '<option value="' + o.v + '">' + o.t + "</option>";
    }).join("");
    sel.value = String(Math.floor(cur / step) * step);
    st.touched = true;
    paintGranular(st);
    renderBases(Date.now());
  }

  function readPick(st) {
    return st.selects.map(function (s) { return Number(s.value); });
  }

  function writePick(st, pick) {
    pick.vals.forEach(function (v, i) { st.selects[i].value = String(v); });
  }

  // 三角的可点状态跟着选中位置走：已在首 / 尾项时按住对应方向，点了不该有反应的就不给点。
  function paintSteps(st) {
    st.steps.forEach(function (b) {
      var sel = st.selects[Number(b.dataset.col)];
      var up = Number(b.dataset.step) < 0;
      b.disabled = up ? sel.selectedIndex <= 0 : sel.selectedIndex >= sel.options.length - 1;
    });
  }

  function paintRailGroup(st, now) {
    var g = st.group;
    var pick = readPick(st);
    var r = g.resolve(now, pick);
    var s = Math.floor(r.instant / 1000);
    var actual = T.zonedParts(r.instant, tz);
    var w = r.want;

    st.sec.textContent = String(s);
    st.sec.title = tz;
    st.ms.textContent = String(r.instant);
    st.wall.textContent = T.format(r.instant, tz) + " " + T.weekdayName(r.instant, tz);
    st.rel.textContent = T.humanDiff(now - r.instant);
    st.copy.dataset.copyText = String(s);

    // 夏令时切换会让「当天 02:30」这类墙上时间不存在，回读必然漂走，要说清楚算成了什么。
    var drift =
      actual.year !== w.year || actual.month !== w.month || actual.day !== w.day ||
      actual.hour !== w.hour || actual.minute !== w.minute;
    st.warn.hidden = !drift;
    if (drift) {
      st.warn.textContent =
        tz + " 不存在 " + w.year + "-" + U.pad(w.month) + "-" + U.pad(w.day) + " " +
        U.pad(w.hour) + ":" + U.pad(w.minute) + ":00（夏令时切换跳过），已按 " +
        T.format(r.instant, tz) + " 计算。";
    }

    st.tag.textContent = st.touched ? "手动选择" : "自动 · 最近";
    st.tag.classList.toggle("auto", !st.touched);
    st.recentBtn.disabled = !st.touched;
    paintSteps(st);
  }

  function renderBases(now) {
    // 「最近一个」按分钟粒度重算：未选过的组跟着时钟走，选过的组保持用户的选择。
    var stamp = tz + "|" + Math.floor(now / 60000);
    BASE_GROUPS.forEach(function (g) {
      var st = rail[g.key];
      if (!st.touched && st.stamp !== stamp) {
        writePick(st, pickRecent(g, now));
        st.stamp = stamp;
      }
      paintRailGroup(st, now);
    });
  }

  function bindRail() {
    $("base-groups").addEventListener("change", function (e) {
      var sel = e.target.closest("select[data-role]");
      if (!sel) return;
      var st = rail[sel.closest(".bg").dataset.g];
      st.touched = true;
      paintRailGroup(st, Date.now());
    });

    $("base-groups").addEventListener("click", function (e) {
      var card = e.target.closest(".bg");
      if (!card) return;
      var st = rail[card.dataset.g];

      var gran = e.target.closest(".gran");
      if (gran) {
        setGranular(st, Number(gran.dataset.step));
        return;
      }

      var step = e.target.closest(".step");
      if (step) {
        var sel = st.selects[Number(step.dataset.col)];
        var next = sel.selectedIndex + Number(step.dataset.step);
        if (next < 0 || next >= sel.options.length) return;
        sel.selectedIndex = next;
        st.touched = true;
        paintRailGroup(st, Date.now());
        return;
      }

      if (e.target.closest('[data-role="recent"]')) {
        st.touched = false;
        st.stamp = "";
        renderBases(Date.now());
        U.toast("已回到最近一个基准时间");
        return;
      }
    });
  }

  /* ---------- 事件 ---------- */

  function bindCopyButtons() {
    document.addEventListener("click", function (e) {
      var btn = e.target.closest && e.target.closest("button.copy");
      if (!btn) return;
      var text;
      if (btn.dataset.copyText !== undefined) {
        text = btn.dataset.copyText;
      } else {
        var src = btn.dataset.copy ? $(btn.dataset.copy) : null;
        text = src ? src.textContent : "";
      }
      text = (text || "").trim();
      if (!text || text === "—") return;
      U.copyWithFeedback(btn, text);
    });
  }

  function refreshAll() {
    tick();
    convertFromTs();
    convertFromWall();
    if (lastWallInstant !== null) wallToPicker(lastWallInstant);
  }

  function applyZone(next) {
    U.saveZone(next);
    tzSel.value = next;
    tz = next;
    refreshAll();
  }

  function bindLocate() {
    var btn = $("tz-locate");
    var label = btn.textContent;
    btn.addEventListener("click", function () {
      btn.disabled = true;
      btn.textContent = "定位中…";
      U.locateZone(function (zone, reason) {
        btn.disabled = false;
        btn.textContent = label;
        if (zone) {
          applyZone(zone);
          U.toast("已按定位切换到 " + zone);
          return;
        }
        // 取不到位置也给出一个确定值，不把用户留在空白状态里自己找。
        applyZone(U.DEFAULT_ZONE);
        U.toast(reason + "，已改用中国上海 (Asia/Shanghai)", "err");
      });
    });
  }

  function init() {
    // tick() 会重画基准栏，所以先建好再开时钟；时区也要在首帧之前定下来。
    buildRail();
    bindRail();

    tz = U.mountZoneSelect(tzSel, tz, function (next) {
      U.saveZone(next);
      tz = next;
      refreshAll();
    });
    bindLocate();

    startClock();
    window.addEventListener("resize", function () {
      fitTzMeta();
    });

    tsInput.addEventListener("input", convertFromTs);
    tsUnit.addEventListener("change", convertFromTs);
    wallInput.addEventListener("input", convertFromWall);
    wallPicker.addEventListener("change", pickerToWall);
    // 点完日历焦点会留在这个透明输入框上，键盘改值时也得立刻同步，不许两头悄悄分叉。
    wallPicker.addEventListener("input", pickerToWall);
    bindCalPicker();

    // 秒级 / 毫秒级两段开关：只切显示档位，时间本身在墙钟输入不变时也不变。
    $("wall-unit").addEventListener("click", function (e) {
      var btn = e.target.closest(".unit-btn");
      if (!btn) return;
      wallUnit = btn.dataset.unit;
      paintWallUnit();
      renderWallMain();
    });
    paintWallUnit();

    $("now-quick").addEventListener("click", function (e) {
      var chip = e.target.closest(".chip");
      if (!chip) return;
      var now = Date.now();
      var kind = chip.dataset.fill;
      var target = kind === "wall" ? wallInput : tsInput;
      var text;
      if (kind === "sec") {
        tsUnit.value = "s";
        text = String(Math.floor(now / 1000));
        tsInput.value = text;
        convertFromTs();
      } else if (kind === "ms") {
        tsUnit.value = "ms";
        text = String(now);
        tsInput.value = text;
        convertFromTs();
      } else {
        text = T.format(now, tz);
        setWallFromInstant(now);
      }
      U.toast("已填入");
      jumpTo(chip, target, text);
    });

    bindCopyButtons();

    tsInput.value = String(Math.floor(Date.now() / 1000));
    convertFromTs();
    setWallFromInstant(Date.now());
  }

  document.addEventListener("DOMContentLoaded", init);
})();
