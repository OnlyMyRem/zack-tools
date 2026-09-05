/* 主题机：四态 system / dark / light / eye，与 ChronosFit 完全一致。
   落地方式见 theme.css：类名挂在 <html> 上，浅色家族统一 .light，护眼再补 .eye 换色板，
   所以组件层只需要为 .light 写一次浅底适配。偏好存 localStorage，刷新保留。 */

(function () {
  var KEY = "zacktools_theme";
  var MODES = ["system", "dark", "light", "eye"];
  var LABEL = { system: "跟随系统", dark: "深色", light: "浅色", eye: "护眼" };
  var ICON = { system: "🌗", dark: "🌙", light: "☀️", eye: "🍂" };

  var systemMQ = window.matchMedia("(prefers-color-scheme: light)");
  var mode = read();
  var manual = null; // 顶栏按钮的临时覆盖，不写入偏好

  function read() {
    try {
      var v = localStorage.getItem(KEY);
      return MODES.indexOf(v) === -1 ? "system" : v;
    } catch (e) {
      return "system";
    }
  }

  function shown() {
    if (manual) return manual;
    if (mode === "system") return systemMQ.matches ? "light" : "dark";
    return mode;
  }

  function apply() {
    var t = shown();
    document.documentElement.classList.toggle("light", t === "light" || t === "eye");
    document.documentElement.classList.toggle("eye", t === "eye");
    document.documentElement.dataset.theme = t;

    var btn = document.getElementById("theme-btn");
    if (btn) {
      btn.textContent = ICON[t];
      btn.title = "当前主题：" + LABEL[t] + "（点击切换下一个）";
      btn.setAttribute("aria-label", btn.title);
    }
    var sel = document.getElementById("theme-select");
    if (sel) sel.value = mode;
  }

  function cycle() {
    var order = ["dark", "light", "eye", "system"];
    manual = order[(order.indexOf(shown()) + 1) % order.length];
    if (manual === "system") mode = "system";
    else {
      mode = manual;
      persist(mode);
    }
    apply();
  }

  function set(next) {
    if (MODES.indexOf(next) === -1) return;
    mode = next;
    manual = null;
    persist(mode);
    apply();
  }

  function persist(v) {
    try {
      localStorage.setItem(KEY, v);
    } catch (e) {
      /* 隐私模式下 localStorage 会抛错，忽略即可：主题只在当次会话生效 */
    }
  }

  // 首屏绘制前先落地主题，避免浅色偏好用户看到一帧深色闪屏。
  apply();

  if (mode === "system" && systemMQ.addEventListener) {
    systemMQ.addEventListener("change", function () {
      if (mode === "system" && !manual) apply();
    });
  }

  window.ZtTheme = {
    init: apply,
    cycle: cycle,
    set: set,
    get mode() {
      return mode;
    },
    get shown() {
      return shown();
    },
    labels: LABEL,
  };

  document.addEventListener("DOMContentLoaded", function () {
    var btn = document.getElementById("theme-btn");
    if (btn) btn.addEventListener("click", cycle);
    var sel = document.getElementById("theme-select");
    if (sel) {
      sel.value = mode;
      sel.addEventListener("change", function () {
        set(sel.value);
      });
    }
    apply();
  });
})();
