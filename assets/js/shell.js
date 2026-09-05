/* 页面外壳：顶栏、面包屑、提示条统一在这里注入。
   每个页面只写自己的 <main> 内容，避免几份 HTML 各抄一遍顶栏、各改一遍主题按钮。
   工具页不再自带页头标题块：面包屑末尾那一项就是本页的 h1。
   用法：<body data-page="timestamp">，脚本按 registry.js 里的记录补全导航。 */

(function () {
  var root = window.ZT_ROOT || "./";
  var page = document.body.dataset.page || "home";
  var tool = window.ztFindTool ? window.ztFindTool(page) : null;

  // 返回首页的链接：部署在站点根时用绝对根路径，这样工具页无论以
  // 长地址（/tools/<slug>/index.html）还是短地址（/<slug>/）访问，
  // 顶栏品牌与面包屑「全部工具」都能稳定回到根目录首页。
  function homeHref() {
    if (window.location.protocol === "file:") {
      // 本地双击打开：保留 index.html，否则 file:// 会落到目录列表
      if (root === "./" || root === "." || root === "" || root === "/") return "index.html";
      return root + "index.html";
    }
    // Web 服务器部署：回到目录根，让地址栏保持 https://tools.fanzehao.fun/ 这种干净形式
    if (root === "./" || root === "." || root === "" || root === "/") return "/";
    return root; // 已以 / 结尾
  }

  function el(html) {
    var t = document.createElement("template");
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  // 顶栏导航：品牌名右侧画一条竖线，逐个列出注册表里的工具，当前页高亮。
  // 想跳去别的工具时不用先回首页再点卡片，两个工具之间直接切。
  var navLinks = [];
  var allTools = window.ZT_TOOLS || [];
  for (var i = 0; i < allTools.length; i++) {
    var t = allTools[i];
    navLinks.push(
      '<a class="tool-nav-link' +
        (page === t.slug ? " is-cur" : "") +
        '" href="' +
        window.ztToolHref(t.slug) +
        '" title="' +
        t.name +
        '">' +
        t.name +
        "</a>"
    );
  }
  var navHtml = navLinks.length
    ? '<i class="hang-div" role="separator" aria-hidden="true"></i><nav class="tool-nav" aria-label="工具跳转">' + navLinks.join("") + "</nav>"
    : "";

  var bar = el(
    '<header class="hang-bar">' +
      '<div class="hang-left">' +
        '<a class="brand" href="' + homeHref() + '"><span class="mark">&#9678;</span> Zack Tools</a>' +
        navHtml +
      "</div>" +
      '<nav class="top-bar-actions">' +
        '<select id="theme-select" class="theme-select" aria-label="选择主题">' +
          '<option value="system">跟随系统</option>' +
          '<option value="dark">深色</option>' +
          '<option value="light">浅色</option>' +
          '<option value="eye">护眼</option>' +
        "</select>" +
        '<button id="theme-btn" class="icon-btn" type="button" title="切换主题">🌙</button>' +
      "</nav>" +
    "</header>"
  );
  document.body.insertBefore(bar, document.body.firstChild);

  if (page !== "home" && tool) {
    var main = document.querySelector("main.wrap");
    if (main) {
      main.insertBefore(
        el('<div class="crumb"><a href="' + homeHref() + '">全部工具</a><span>/</span><h1 class="crumb-cur">' + tool.name + "</h1></div>"),
        main.firstChild
      );
    }
  }

  document.body.appendChild(el('<div id="toast" role="status" aria-live="polite"></div>'));
})();
