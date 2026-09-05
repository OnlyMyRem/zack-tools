/* 极小的共享工具：复制到剪贴板 + 顶部提示。
   这两个动作在两个工具里都高频出现，放一份避免各页各写一套。 */

(function () {
  var toastEl = null;
  var toastTimer = null;

  function toast(msg, kind) {
    if (!toastEl) toastEl = document.getElementById("toast");
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.id = "toast";
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.toggle("err", kind === "err");
    // 先回退到未显示态再强制重排，连续点复制时动画才会重新播放而不是停在末态。
    toastEl.classList.remove("show");
    void toastEl.offsetWidth;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastEl.classList.remove("show");
    }, 1800);
  }

  function legacyCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;top:0;left:-9999px;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try {
      ok = document.execCommand("copy");
    } catch (e) {
      ok = false;
    }
    document.body.removeChild(ta);
    return ok;
  }

  // file:// 打开时 navigator.clipboard 常常不可用，所以保留 execCommand 兜底。
  function copyText(text) {
    var value = text == null ? "" : String(text);
    if (!value) return Promise.resolve(false);
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard
        .writeText(value)
        .then(function () {
          return true;
        })
        .catch(function () {
          return legacyCopy(value);
        });
    }
    return Promise.resolve(legacyCopy(value));
  }

  // 复制并给出按钮反馈。由调用方的事件委托触发，避免每次点击都新加一层监听。
  function copyWithFeedback(btn, text) {
    var original = btn.dataset.original || btn.textContent;
    btn.dataset.original = original;
    return copyText(text).then(function (ok) {
      if (!ok) {
        toast("复制失败，请手动选中", "err");
        return false;
      }
      toast("已复制");
      btn.classList.add("ok");
      btn.textContent = "已复制";
      setTimeout(function () {
        btn.classList.remove("ok");
        btn.textContent = btn.dataset.original || original;
      }, 1200);
      return true;
    });
  }

  function pad(n, w) {
    var s = String(Math.abs(n));
    w = w || 2;
    while (s.length < w) s = "0" + s;
    return s;
  }

  var ZONE_KEY = "zacktools_tz";
  /* 站点默认时区是中国上海，不跟随操作系统：同一个链接在不同机器上给出同一份结果，
     也符合中文用户查时间戳时的第一预期。用户手动选过一次后以他的偏好为准。 */
  var DEFAULT_ZONE = "Asia/Shanghai";

  // 引擎不认识的区名（老浏览器缺数据、外部传进来的脏值）退回一个一定能用的，
  // 判断以能否真正构造格式化器为准，supportedValuesOf 的列表会漏掉 UTC 这类名字。
  function supportedZone(v) {
    var T = window.ZtTime;
    return T.zoneIsUsable(v) ? v : T.localZone();
  }

  function readZone() {
    try {
      var v = localStorage.getItem(ZONE_KEY);
      if (v) return v;
    } catch (e) { /* 隐私模式忽略 */ }
    return DEFAULT_ZONE;
  }

  function saveZone(v) {
    try { localStorage.setItem(ZONE_KEY, v); } catch (e) { /* 隐私模式忽略 */ }
  }

  // 定位只给坐标；失败时把原因交给调用方，由它决定是否落回默认时区并提示。
  function locateZone(cb) {
    var geo = navigator.geolocation;
    if (!geo) return cb(null, "浏览器不支持定位");
    if (!window.isSecureContext) return cb(null, "非 HTTPS/本地环境，浏览器已禁用定位");
    geo.getCurrentPosition(
      function (pos) {
        var c = pos.coords;
        cb(supportedZone(window.ZtTime.zoneFromCoords(c.latitude, c.longitude)), null);
      },
      function (err) {
        cb(null, err && err.code === err.PERMISSION_DENIED ? "未授权定位" : "定位超时或不可用");
      },
      { timeout: 8000, maximumAge: 600000 }
    );
  }

  // 时间戳与 Cron 两个工具都要一个能选任意时区的下拉，逻辑一致，放这里共用一份。
  function mountZoneSelect(sel, current, onChange) {
    var T = window.ZtTime;
    var all = T.allZones();
    var common = {};
    var g1 = document.createElement("optgroup");
    g1.label = "常用时区";
    T.COMMON_ZONES.forEach(function (pair) {
      common[pair[0]] = 1;
      var o = document.createElement("option");
      o.value = pair[0];
      o.textContent = pair[1];
      g1.appendChild(o);
    });
    var g2 = document.createElement("optgroup");
    g2.label = "全部时区（引擎提供）";
    all.filter(function (z) { return !common[z]; }).sort(function (a, b) {
      // 按城市名（Region/City 的后半段）排，找 Shanghai 不必先想它在 Asia 下。
      var ka = a.split("/").pop();
      var kb = b.split("/").pop();
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    }).forEach(function (z) {
      var o = document.createElement("option");
      o.value = z;
      o.textContent = z;
      g2.appendChild(o);
    });
    sel.innerHTML = "";
    sel.appendChild(g1);
    sel.appendChild(g2);

    var value = current;
    if (all.indexOf(value) === -1 && !common[value]) {
      if (window.ZtTime.zoneIsUsable(value)) {
        // 能用却没被列举（supportedValuesOf 会漏名字）：补一个选项，否则下拉会显示空白。
        var extra = document.createElement("option");
        extra.value = value;
        extra.textContent = value;
        g2.appendChild(extra);
      } else {
        // 偏好是从另一台机器/引擎带过来的，当前不支持：说明清楚再回落，别静默改用户设置。
        var o = document.createElement("option");
        o.value = value;
        o.textContent = value + "（当前引擎不支持）";
        o.disabled = true;
        g1.insertBefore(o, g1.firstChild);
        value = supportedZone(DEFAULT_ZONE);
      }
    }
    sel.value = value;
    sel.addEventListener("change", function () {
      if (onChange) onChange(sel.value);
    });
    return value;
  }

  window.ZtUtil = {
    toast: toast,
    copyText: copyText,
    copyWithFeedback: copyWithFeedback,
    mountZoneSelect: mountZoneSelect,
    readZone: readZone,
    saveZone: saveZone,
    locateZone: locateZone,
    DEFAULT_ZONE: DEFAULT_ZONE,
    pad: pad,
  };
})();
