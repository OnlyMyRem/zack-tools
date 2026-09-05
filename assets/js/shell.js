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
    if (root === "./" || root === "." || root === "" || root === "/") return "/index.html";
    return root + "index.html";
  }

  function el(html) {
    var t = document.createElement("template");
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  var bar = el(
    '<header class="hang-bar">' +
      '<a class="brand" href="' + homeHref() + '"><span class="mark">&#9678;</span> Zack Tools</a>' +
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
