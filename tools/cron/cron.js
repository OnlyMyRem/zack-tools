/* Cron 表达式工具的界面逻辑，解析与推算全在 cron-parser.js。 */

(function () {
  var C = window.ZtCron;
  var T = window.ZtTime;
  var U = window.ZtUtil;

  var $ = function (id) { return document.getElementById(id); };
  var exprInput = $("expr");
  var tzSel = $("tz");
  var countSel = $("count");
  var builderEl = $("builder");

  var DOW_ABBR = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
  var MON_ABBR = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

  var state = {
    format: "quartz",
    tz: U.readZone(),
    spec: null,
    // 每个字段的生成器状态：mode = all | none | step | pick | locked
    fields: {},
  };

  /* ---------- 数字与别名的方言换算 ---------- */

  function defOf(key) {
    return key === "year" ? C.YEAR_DEF : C.DEFS[key];
  }

  function dialectNum(key, v) {
    // 内部一律存 JS 的 0=周日，Quartz 的写法是 1=周日，展示与生成时要换回去。
    if (key === "dow" && C.FORMATS[state.format].dowFromOne) return v + 1;
    return v;
  }

  function fromDialectNum(key, n) {
    var def = defOf(key);
    if (key !== "dow") return Math.min(Math.max(n, def.min), def.max);
    if (C.FORMATS[state.format].dowFromOne) {
      // Quartz 只认 1-7；越界时夹到端点而不是取模，免得用户输入 9 变成看不懂的数。
      return Math.min(Math.max(n - 1, 0), 6);
    }
    // Linux 与 Spring 里 0 和 7 都是周日。
    return n === 7 ? 0 : Math.min(Math.max(n, 0), 6);
  }

  function displayNum(key, v) {
    var st = state.fields[key] || {};
    if (key === "dow" && st.useNames) return DOW_ABBR[v];
    if (key === "mon" && st.useNames) return MON_ABBR[v - 1];
    return String(dialectNum(key, v));
  }

  function rangeLabel(key) {
    var def = defOf(key);
    if (key === "dow") {
      return C.FORMATS[state.format].dowFromOne ? "1-7（1=周日）" : "0-7（0=周日）";
    }
    return def.min + "-" + def.max;
  }

  /* ---------- 表达式 ⇄ 生成器状态 ---------- */

  function fieldToRaw(key) {
    var st = state.fields[key];
    var def = defOf(key);
    if (!st) return "*";
    switch (st.mode) {
      case "all":
        return "*";
      case "none":
        return "?";
      case "locked":
        return st.raw;
      case "step": {
        var from = st.from;
        var head = from === def.min ? "*" : displayNum(key, from);
        return head + "/" + st.step;
      }
      default: {
        var vals = Array.from(st.values).sort(function (a, b) { return a - b; });
        if (!vals.length) return "*";
        return vals.map(function (v) { return displayNum(key, v); }).join(",");
      }
    }
  }

  function composeExpr() {
    var fmt = C.FORMATS[state.format];
    var keys = fmt.hasSec ? C.ORDER.slice() : C.ORDER.slice(1);
    // 没有秒字段时，sec 的生成器状态不参与输出（Linux 的秒是隐含的 0）。
    var parts = keys.map(fieldToRaw);
    if (fmt.supportsYear && state.fields.year) parts.push(fieldToRaw("year"));
    return parts.join(" ");
  }

  function uniformStep(f) {
    var v = f.sorted;
    if (!f.hasStep || v.length < 2) return null;
    var d = v[1] - v[0];
    if (d < 1) return null;
    for (var i = 2; i < v.length; i++) if (v[i] - v[i - 1] !== d) return null;
    return d;
  }

  function hasSpecial(f) {
    return !!(f.domLast || f.domLastWeekday || f.domNearest !== null || f.dowLast !== null || f.dowNth);
  }

  // 从解析结果回填生成器。只认「表达式驱动的」改动，避免与用户点选互相打架。
  function syncFields(spec) {
    var keys = C.FORMATS[state.format].hasSec ? C.ORDER.slice() : C.ORDER.slice(1);
    if (spec.hasYear) keys.push("year");
    var next = {};
    keys.forEach(function (key) {
      var f = spec[key];
      var def = defOf(key);
      if (!f) return;
      var st = { mode: "pick", values: new Set(f.sorted), from: f.sorted[0], step: uniformStep(f) || 1, raw: f.raw, useNames: /[A-Za-z]/.test(f.raw) };
      if (hasSpecial(f)) {
        st.mode = "locked";
      } else if (f.question) {
        // 要在 full 之前判：解析器把 ? 也标成 full，否则 ? 会被回填成 * ，
        // 用户之后点一下生成器就悄悄把表达式里的 ? 改写了。
        st.mode = "none";
      } else if (f.raw === "*" || f.full) {
        st.mode = "all";
      } else if (st.step && f.raw.indexOf("/") !== -1) {
        st.mode = "step";
      }
      next[key] = st;
    });
    // Linux 没有秒字段，但解析时会补一个常量 0；保留它，切回 Spring/Quartz 才不丢上下文。
    if (!C.FORMATS[state.format].hasSec && !next.sec) {
      next.sec = state.fields.sec || { mode: "all", values: new Set(), from: 0, step: 1, raw: "*" };
    }
    if (!C.FORMATS[state.format].allowQuestion) {
      keys.forEach(function (k) {
        if (next[k] && next[k].mode === "none") next[k].mode = "all";
      });
    }
    state.fields = next;
  }

  /* ---------- 渲染 ---------- */

  // 三条解释叠在同一个网格里，占位恒为最长那条：换方言只切可见性，下面的内容不会被顶来顶去。
  function mountFormatHints() {
    $("fmt-hints").innerHTML = Object.keys(C.FORMATS).map(function (k) {
      return '<p class="note" data-fmt="' + k + '">' + escapeHtml(C.FORMATS[k].hint) + "</p>";
    }).join("");
  }

  function renderFormatChips() {
    var host = $("format-chips");
    host.innerHTML = Object.keys(C.FORMATS).map(function (k) {
      var f = C.FORMATS[k];
      return '<button class="chip' + (k === state.format ? " active" : "") + '" type="button" role="radio" aria-checked="' +
        (k === state.format) + '" data-fmt="' + k + '">' + f.name + " · " + f.count + " 段</button>";
    }).join("");
    var hints = $("fmt-hints").children;
    for (var i = 0; i < hints.length; i++) {
      hints[i].classList.toggle("on", hints[i].dataset.fmt === state.format);
    }
  }

  function renderSegLabels(spec) {
    var host = $("seg-labels");
    var fmt = C.FORMATS[state.format];
    var parts = spec && !spec.fatal ? spec.text.split(" ") : String(exprInput.value || "").trim().split(/\s+/);
    var keys = fmt.hasSec ? C.ORDER.slice() : C.ORDER.slice(1);
    if (spec && spec.hasYear) keys.push("year");
    var html = keys.map(function (k, i) {
      var v = parts[i];
      return '<div class="seg' + (v ? "" : " empty") + '"><i>' + defOf(k).label + "</i><b>" + escapeHtml(v || "—") + "</b></div>";
    });
    if (parts.length > keys.length) {
      for (var j = keys.length; j < parts.length; j++) html.push('<div class="seg"><i>多余段</i><b>' + escapeHtml(parts[j]) + "</b></div>");
    }
    host.innerHTML = html.join("");
  }

  function renderParseTable(spec) {
    var host = $("parse-table");
    if (!spec || !spec.ok) {
      host.innerHTML = '<p class="note">修好表达式后这里会逐字段解释。</p>';
      return;
    }
    var keys = C.ORDER.slice();
    if (spec.hasYear) keys.push("year");
    host.innerHTML = keys.map(function (k) {
      var def = defOf(k);
      var f = spec[k];
      var broken = !f.set || !f.set.size;
      return (
        '<div class="parse-row' + (broken ? " broken" : "") + '">' +
        '<span class="name">' + def.label + "</span>" +
        '<span class="raw">' + escapeHtml(f.raw) + (f.linuxFilled ? "（自动补）" : "") + "</span>" +
        '<span class="mean">' + C.describeField(f, def) + "</span>" +
        "</div>"
      );
    }).join("");
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function renderStatus(spec) {
    var el = $("status");
    var line = $("summary");
    el.className = "note";
    if (!spec || spec.fatal || !spec.ok) {
      exprInput.classList.add("invalid");
      var msgs = spec ? spec.errors : [];
      el.classList.add("error");
      el.textContent = msgs.length ? msgs[0] : "表达式无法解析。";
      line.textContent = msgs.length > 1 ? "还有 " + (msgs.length - 1) + " 处问题：" + msgs.slice(1).join(" ") : "等待一个合法表达式。";
      return;
    }
    exprInput.classList.remove("invalid");
    var warn = spec.warnings || [];
    el.classList.add(warn.length ? "error" : "ok");
    el.textContent = warn.length ? warn[0] : "语法合法，段数与 " + spec.format.name + " 规则一致。";
    line.textContent = C.summarize(spec);
  }

  function renderTimes(spec) {
    var host = $("times");
    if (!spec || !spec.ok) {
      host.innerHTML = '<p class="note">表达式合法后这里列出未来的触发时间。</p>';
      host.dataset.payload = "";
      return;
    }
    var n = parseInt(countSel.value, 10);
    var r = C.nextTimes(spec, state.tz, Date.now(), n);
    if (!r.times.length) {
      host.innerHTML = '<p class="note error">未来一百年内没有命中时刻——检查是否写了 2 月 31 日这类不存在的组合。</p>';
      host.dataset.payload = "";
      return;
    }
    var now = Date.now();
    host.dataset.payload = r.times.map(function (t) { return T.format(t, state.tz); }).join("\n");
    host.innerHTML = r.times.map(function (t, i) {
      return (
        '<div class="time-row' + (i === 0 ? " next" : "") + '">' +
        '<span class="idx">' + (i + 1) + "</span>" +
        '<span class="val">' + T.format(t, state.tz) + "</span>" +
        '<span class="wd">' + T.weekdayName(t, state.tz) + " · " + (i === 0 ? "下次 " : "") + T.humanDiff(now - t) + "</span>" +
        "</div>"
      );
    }).join("") + (r.ended
      ? '<p class="note">年字段上限或 100 年之内之后不再触发，未列出的部分即为没有。</p>'
      : (r.exhausted ? '<p class="note error">到达推算上限，后面的触发时间未列出。</p>' : ""));
  }

  function renderBuilder() {
    var fmt = C.FORMATS[state.format];
    var keys = (fmt.hasSec ? C.ORDER.slice() : C.ORDER.slice(1));
    if (fmt.supportsYear && state.fields.year) keys.push("year");

    builderEl.innerHTML = keys.map(function (key) {
      var def = defOf(key);
      var st = state.fields[key];
      if (!st) return "";
      var modes = [{ m: "all", t: "每" + def.label + "(*)" }];
      if ((key === "dom" || key === "dow") && fmt.allowQuestion) modes.push({ m: "none", t: "不指定(?)" });
      modes.push({ m: "step", t: "间隔" });
      modes.push({ m: "pick", t: "指定值" });

      var grid = "";
      var lo = def.min, hi = def.max;
      var cells = [];
      for (var v = lo; v <= hi; v++) {
        var label = key === "dow" ? (st.useNames ? DOW_ABBR[v] : String(dialectNum(key, v))) : String(dialectNum(key, v));
        cells.push('<button class="n' + (st.values.has(v) ? " on" : "") + '" type="button" data-v="' + v + '">' + label + "</button>");
      }
      grid = '<div class="num-grid">' + cells.join("") + "</div>";

      var body = "";
      if (st.mode === "step") {
        body =
          '<div class="bf-step">从 <input type="number" data-step-from value="' + dialectNum(key, st.from) +
          '" min="' + dialectNum(key, def.min) + '" max="' + dialectNum(key, def.max) + '"> ' + def.unit +
          " 起，每 <input type=\"number\" data-step-size value=\"" + st.step + '" min="1" max="' + (def.max - def.min + 1) + '"> ' + def.unit + "</div>" + grid;
      } else if (st.mode === "pick") {
        body = grid;
      } else if (st.mode === "locked") {
        body = '<p class="lock-note">该字段用了 ' + escapeHtml(st.raw) + " 这类特殊语法，生成器不覆盖它；要改请直接编辑上方表达式。</p>";
      } else {
        body = "";
      }

      return (
        '<div class="bf' + (st.mode === "locked" ? " locked" : "") + '" data-key="' + key + '">' +
          '<div class="bf-head"><h3>' + def.label + "字段</h3><span class=\"range\">" + rangeLabel(key) + "</span></div>" +
          '<div class="bf-modes">' + modes.map(function (o) {
            return '<button class="mode' + (st.mode === o.m ? " on" : "") + '" type="button" data-mode="' + o.m + '">' + o.t + "</button>";
          }).join("") + "</div>" +
          body +
        "</div>"
      );
    }).join("");
  }

  function renderAll(fromBuilder) {
    var spec = C.parse(exprInput.value, state.format);
    state.spec = spec;
    // 回填只在表达式完全合法时做：出错字段的 sorted 是 null，硬回填会抛异常，
    // 让状态与触发时间停在上一轮的旧值上；同时保留生成器上一次的好状态，输入中途不拆台。
    if (!fromBuilder && spec.ok) syncFields(spec);
    renderStatus(spec);
    renderSegLabels(spec);
    renderParseTable(spec);
    renderTimes(spec);
    renderBuilder();
  }

  /* ---------- 事件 ---------- */

  function setExpr(text, fromBuilder) {
    exprInput.value = text;
    renderAll(fromBuilder);
  }

  function bindEvents() {
    exprInput.addEventListener("input", function () {
      renderAll(false);
    });

    $("format-chips").addEventListener("click", function (e) {
      var btn = e.target.closest("[data-fmt]");
      if (!btn) return;
      var target = btn.dataset.fmt;
      if (target === state.format) return;
      var spec = state.spec;
      var converted = C.convert(spec, target);
      state.format = target;
      renderFormatChips();
      if (converted) {
        setExpr(converted, false);
        U.toast("已转为 " + C.FORMATS[target].name + " 格式");
        var notice = C.convertNotice(spec, target);
        if (notice) U.toast(notice, "err");
      } else {
        renderAll(false);
      }
    });

    builderEl.addEventListener("click", function (e) {
      var card = e.target.closest(".bf");
      if (!card) return;
      var key = card.dataset.key;
      var st = state.fields[key];
      if (!st) return;

      var modeBtn = e.target.closest("[data-mode]");
      if (modeBtn) {
        st.mode = modeBtn.dataset.mode;
        if (st.mode === "pick" && !st.values.size) st.values = new Set([st.from]);
        setExpr(composeExpr(), true);
        return;
      }
      var num = e.target.closest("[data-v]");
      if (num && st.mode === "pick") {
        var v = Number(num.dataset.v);
        if (st.values.has(v)) st.values.delete(v);
        else st.values.add(v);
        st.useNames = st.useNames || false;
        setExpr(composeExpr(), true);
      }
    });

    builderEl.addEventListener("input", function (e) {
      var card = e.target.closest(".bf");
      if (!card) return;
      var st = state.fields[card.dataset.key];
      if (!st) return;
      if (e.target.matches("[data-step-from]")) {
        var raw = parseInt(e.target.value, 10);
        if (isNaN(raw)) return;
        st.from = fromDialectNum(card.dataset.key, raw);
        setExpr(composeExpr(), true);
      } else if (e.target.matches("[data-step-size]")) {
        var s = parseInt(e.target.value, 10);
        if (isNaN(s) || s < 1) return;
        st.step = s;
        setExpr(composeExpr(), true);
      }
    });

    countSel.addEventListener("change", function () {
      renderTimes(state.spec);
    });

    $("btn-copy-expr").addEventListener("click", function () {
      U.copyWithFeedback(this, exprInput.value.trim());
    });

    $("btn-copy-times").addEventListener("click", function () {
      var payload = $("times").dataset.payload;
      if (!payload) {
        U.toast("暂无可复制的时间", "err");
        return;
      }
      U.copyWithFeedback(this, payload);
    });

    $("btn-clear").addEventListener("click", function () {
      setExpr("", false);
    });

    $("presets").addEventListener("click", function (e) {
      var btn = e.target.closest("[data-expr]");
      if (!btn) return;
      var fmt = btn.dataset.fmt;
      if (fmt !== state.format) {
        state.format = fmt;
        renderFormatChips();
      }
      setExpr(btn.dataset.expr, false);
      U.toast("已载入：" + btn.dataset.name);
    });
  }

  function renderPresets() {
    $("presets").innerHTML = C.PRESETS.map(function (g) {
      return (
        '<div class="preset-group"><div class="pg-label">' + g.group + "</div><div class=\"chips\">" +
        g.items.map(function (it) {
          return '<button class="chip" type="button" data-expr="' + it.expr + '" data-fmt="' + it.fmt + '" data-name="' + it.name +
            '" title="' + it.expr + '">' + it.name + "</button>";
        }).join("") + "</div></div>"
      );
    }).join("");
  }

  function renderCheatsheet() {
    var rows = [
      ["秒", "0-59", "<code>*</code> <code>*/n</code> <code>a,b</code>", "Quartz 与 Spring 有这一段；Linux crontab 没有秒。"],
      ["分", "0-59", "<code>*/5</code> <code>0,15,30,45</code>", "三种格式都有。"],
      ["时", "0-23", "<code>9-18</code> <code>0/2</code>", "跨零点写 <code>22-2</code>，本工具按环形区间展开。"],
      ["日", "1-31", "<code>?</code> <code>L</code> <code>LW</code> <code>15W</code> <code>L-3</code>", "L / W 系列 Quartz 与 Spring 都认，Linux crontab 不认；<code>?</code> 表示「不指定」。"],
      ["月", "1-12", "<code>JAN</code>…<code>DEC</code>", "英文缩写不区分大小写，<code>jan</code> 与 <code>JAN</code> 等价。"],
      ["周", "见下", "<code>?</code> <code>6L</code> <code>SUN#2</code>", "Linux 与 Spring 是 0-7（0=周日）；Quartz 是 1-7（1=周日）。同一个 <code>1-5</code> 在两种方言里指不同的日子。"],
      ["年", "1970-2299", "<code>2026,2027</code>", "可选的第 7 段，只有 Quartz 认。"],
    ];
    $("cheatsheet").tBodies[0].innerHTML = rows.map(function (r) {
      return "<tr><td>" + r[0] + "</td><td class=\"mono\">" + r[1] + "</td><td>" + r[2] + "</td><td>" + r[3] + "</td></tr>";
    }).join("");
  }

  function init() {
    mountFormatHints();
    renderFormatChips();
    renderPresets();
    renderCheatsheet();

    state.tz = U.mountZoneSelect(tzSel, state.tz, function (next) {
      U.saveZone(next);
      state.tz = next;
      renderTimes(state.spec);
    });

    bindEvents();
    setExpr("0 0 3 ? * MON-FRI", false);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
