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
    format: "linux",
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

  // 表达式正下方一排小段签：字段名 + 原文，逐段对应关系一眼可见。
  // 不再写每个字段的中文解释——解释文案长短不一会让卡片高度乱跳；
  // 具体含义与报错收在状态行 / 触发时间栏里。表达式还非法时只摆字段名与原文。
  function renderSegLabels(spec) {
    var host = $("seg-labels");
    var fmt = C.FORMATS[state.format];
    var ok = !!(spec && !spec.fatal && spec.ok);
    var parts = ok ? [] : String(exprInput.value || "").trim().split(/\s+/).filter(Boolean);
    // 5 段无秒简写（含秒的方言也收）没有秒 token，段签跟着 token 走；
    // 被补上的秒只写进状态行的说明，不占一个假段位。
    var isShort = ok ? !!spec.noSecText : (parts.length === 5 && fmt.hasSec);
    var keys = C.ORDER.slice(isShort ? 1 : 0);
    var html;
    if (ok) {
      if (spec.hasYear) keys.push("year");
      html = keys.map(function (k) {
        var def = defOf(k);
        var f = spec[k];
        var raw = f ? f.raw : "";
        return (
          '<div class="seg"><i>' + def.label + "</i>" +
          '<b title="' + escapeHtml(raw) + '">' + escapeHtml(raw) + "</b>" +
          "</div>"
        );
      });
    } else {
      while (keys.length < parts.length) keys.push(null);
      html = keys.map(function (k, i) {
        var v = parts[i];
        return (
          '<div class="seg' + (v ? "" : " empty") + '">' +
          "<i>" + (k ? defOf(k).label : "多余段") + "</i>" +
          "<b>" + escapeHtml(v || "—") + "</b>" +
          "</div>"
        );
      });
    }
    host.innerHTML = html.join("");
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function renderStatus(spec) {
    var el = $("status");
    el.className = "note";
    if (!spec || spec.fatal || !spec.ok) {
      exprInput.classList.add("invalid");
      var msgs = spec ? spec.errors : [];
      el.classList.add("error");
      el.textContent = msgs.length ? msgs[0] : "表达式无法解析。";
      return;
    }
    exprInput.classList.remove("invalid");
    var warn = spec.warnings || [];
    el.classList.add(warn.length ? "error" : "ok");
    if (warn.length) {
      el.textContent = warn[0];
    } else if (spec.noSecText) {
      el.textContent = "语法合法：5 段无秒简写，秒按 0 处理。";
    } else {
      el.textContent = "语法合法，段数与 " + spec.format.name + " 规则一致。";
    }
  }

  function renderTimes(spec) {
    var host = $("times");
    var sched = $("sched-line");
    if (!spec || !spec.ok) {
      // 语法有错时，剩下的问题一并列在触发时间这一栏，报错信息不再散在表达式下方。
      var msgs = spec ? spec.errors : [];
      sched.textContent = msgs.length > 1 ? "还有 " + (msgs.length - 1) + " 处问题：" + msgs.slice(1).join(" ") : "";
      sched.classList.toggle("err", !!sched.textContent);
      host.innerHTML = '<p class="note">表达式合法后这里列出未来的触发时间。</p>';
      host.dataset.payload = "";
      return;
    }
    // 一句话人话总结从表达式下方挪到这里：解释完什么时候触发，紧跟着就是触发时刻。
    sched.textContent = C.summarize(spec);
    sched.classList.remove("err");
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
    renderTimes(spec);
    renderBuilder();
  }

  /* ---------- 事件 ---------- */

  function setExpr(text, fromBuilder) {
    exprInput.value = text;
    // 生成器动过就说明用户开始改这份预设了，预设卡片的选中高亮要让位。
    if (fromBuilder) clearPreset();
    renderAll(fromBuilder);
  }

  // 预设按钮的「当前选中」：同一时刻只亮一个，用户能看出刚才点了哪个。
  function markPreset(btn) {
    Array.prototype.forEach.call(document.querySelectorAll("#presets [data-expr]"), function (b) {
      var on = b === btn;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  // 表达式被用户手动改过、或格式由用户切换后，载入来源不再唯一，撤掉预设的高亮。
  function clearPreset() {
    Array.prototype.forEach.call(document.querySelectorAll("#presets [data-expr].active"), function (b) {
      b.classList.remove("active");
      b.removeAttribute("aria-pressed");
    });
  }

  function bindEvents() {
    exprInput.addEventListener("input", function () {
      clearPreset();
      renderAll(false);
    });

    $("format-chips").addEventListener("click", function (e) {
      var btn = e.target.closest("[data-fmt]");
      if (!btn) return;
      var target = btn.dataset.fmt;
      if (target === state.format) return;
      var prevFmt = C.FORMATS[state.format];
      var prevSpec = state.spec;
      // 先记下当前选中的预设：切换后它若仍能以同一段文本无损表达，就把选中态带过去，
      // 避免「点了预设再切格式，选中就消失」。
      var activeBtn = document.querySelector("#presets .chip.active");
      var activeName = activeBtn ? activeBtn.getAttribute("data-name") : "";
      clearPreset();
      // 切换只换解析方言，绝不动用户输入的文本：
      // Quartz/Spring 会把 5 段无秒简写按「秒=0」直接解析，Linux 收到 6/7 段时报错但不改写。
      state.format = target;
      renderFormatChips();
      renderPresets();
      renderAll(false);
      if (activeName) {
        var cur = exprInput.value.trim();
        var cands = document.querySelectorAll("#presets [data-expr]");
        for (var i = 0; i < cands.length; i++) {
          var pb = cands[i];
          if (pb.getAttribute("data-name") === activeName &&
              !pb.getAttribute("data-reason") &&
              pb.getAttribute("data-expr") === cur) {
            markPreset(pb);
            break;
          }
        }
      }
      var spec = state.spec;
      if (spec && spec.ok && prevSpec && prevSpec.ok) {
        var nextFmt = C.FORMATS[target];
        var msgs = [];
        // 文本没改，但周字段数字的编号起点随方言走（Quartz 1=周日 vs 其余 0=周日），含义可能漂移。
        if (nextFmt.dowFromOne !== prevFmt.dowFromOne) {
          var parts = spec.text.split(" ");
          // 5 段（无秒）时周是第 5 个 token，6/7 段时是第 6 个。
          var dowTok = parts.length === 5 ? parts[4] : parts[5] || "";
          if (/[0-9]/.test(dowTok)) {
            msgs.push("数字周口径不同：该方言是 " + (nextFmt.dowFromOne ? "1=周日" : "0=周日"));
          }
        }
        // Linux 的「日与周同时限定」是并集，Spring/Quartz 是交集，切过去语义会变。
        if (prevSpec.dayUnion && nextFmt.allowQuestion) {
          msgs.push("原先『日/周』并集语义会变成 " + nextFmt.name + " 的交集，需两者同时命中");
        }
        if (msgs.length) {
          U.toast("已按 " + nextFmt.name + " 解析，表达式未改动；" + msgs.join("；") +
            "，如与当前格式的语义不符请手动修正。", "err");
        }
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
      clearPreset();
      setExpr("", false);
    });

    // 「从位置获取」：向浏览器要一次经纬度，按坐标切换推算时区（与时间戳页同一套流程）。
    function applyZone(next) {
      U.saveZone(next);
      tzSel.value = next;
      state.tz = next;
      renderTimes(state.spec);
    }

    var locateBtn = $("tz-locate");
    if (locateBtn) {
      var locateLabel = locateBtn.textContent;
      locateBtn.addEventListener("click", function () {
        if (locateBtn.disabled) return;
        locateBtn.disabled = true;
        locateBtn.textContent = "定位中…";
        U.locateZone(function (zone, reason) {
          locateBtn.disabled = false;
          locateBtn.textContent = locateLabel;
          if (zone) {
            applyZone(zone);
            U.toast("已按定位切换到 " + zone);
            return;
          }
          // 取不到位置时不乱动用户选好的时区，只说清楚原因。
          U.toast(reason + "，未改动时区，当前为 " + state.tz, "err");
        });
      });
    }

    // 侧栏选项卡：常用预设 / 字段生成器 共用一个面板，两个视图互不打扰。
    var tabs = document.querySelectorAll(".rail-tabs [role='tab']");
    function selectTab(tab) {
      Array.prototype.forEach.call(tabs, function (b) {
        var on = b === tab;
        b.classList.toggle("on", on);
        b.setAttribute("aria-selected", on ? "true" : "false");
        var pane = $(b.getAttribute("aria-controls"));
        if (pane) pane.classList.toggle("on", on);
      });
    }
    Array.prototype.forEach.call(tabs, function (tab) {
      tab.addEventListener("click", function () {
        selectTab(tab);
      });
      tab.addEventListener("keydown", function (e) {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        e.preventDefault();
        var i = Array.prototype.indexOf.call(tabs, tab);
        var next = (e.key === "ArrowRight" ? i + 1 : i - 1 + tabs.length) % tabs.length;
        selectTab(tabs[next]);
        tabs[next].focus();
      });
    });

    // 字段速查：顶部「格式」行按钮弹出现有那张对照表。
    var cheat = $("cheat-dialog");
    $("btn-cheat").addEventListener("click", function () {
      cheat.showModal();
    });
    $("btn-cheat-close").addEventListener("click", function () {
      cheat.close();
    });
    cheat.addEventListener("click", function (e) {
      // 点遮罩背景即关，内容区点按不触发。
      if (e.target === cheat) cheat.close();
    });

    $("presets").addEventListener("click", function (e) {
      var btn = e.target.closest("[data-expr]");
      if (!btn) return;
      var reason = btn.getAttribute("data-reason");
      var name = btn.dataset.name;
      // 当前格式表达不了的预设：不载入，把置灰原因说清楚（悬停 title 也有同一段提示）。
      if (reason) {
        U.toast(reason, "err");
        return;
      }
      // data-expr 在渲染时就已按当前格式折算好，点击即载入，不会再折出报错文本。
      setExpr(btn.dataset.expr, false);
      markPreset(btn);
      U.toast("已载入：" + name);
    });
  }

  function renderPresets() {
    $("presets").innerHTML = C.PRESETS.map(function (g) {
      return (
        '<div class="preset-group"><div class="pg-label">' + g.group + "</div><div class=\"chips\">" +
        g.items.map(function (it) {
          var fit = C.presetFit(it, state.format);
          // 置灰的条目 data-expr 留空、click 不载入；悬停 title 与实际载入必须一致——
          // 能点的是折算后的文本，不能点的是置灰原因，不再出现「提示原文、载入报错」的错位。
          return '<button class="chip' + (fit.disabled ? " disabled" : "") + '" type="button"' +
            (fit.disabled ? ' aria-disabled="true"' : "") +
            ' data-expr="' + escapeHtml(fit.text) + '" data-name="' + it.name + '" data-fmt="' + it.fmt + '"' +
            (fit.disabled ? ' data-reason="' + escapeHtml(fit.reason) + '"' : "") +
            ' title="' + escapeHtml(fit.disabled ? fit.reason : fit.text) + '">' + it.name + "</button>";
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
    setExpr("0 3 * * 1-5", false);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
