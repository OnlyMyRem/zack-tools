/* 首页只负责把 registry.js 里的记录铺成卡片，工具数量变化不必动 HTML。 */

(function () {
  var grid = document.getElementById("tool-grid");
  var stat = document.getElementById("stat-tools");
  if (!grid || !window.ZT_TOOLS) return;

  var html = window.ZT_TOOLS.map(function (t) {
    return (
      '<a class="tool-card" href="' + window.ztToolHref(t.slug) + '">' +
        '<div class="tool-card-top">' +
          '<span class="tool-icon" aria-hidden="true">' + t.icon + "</span>" +
          "<div><h3>" + t.name + '</h3><div class="slug">tools/' + t.slug + "/index.html</div></div>" +
        "</div>" +
        "<p>" + t.summary + "</p>" +
        '<div class="tags">' + t.tags.map(function (g) { return '<span class="tag">' + g + "</span>"; }).join("") + "</div>" +
        '<span class="go">打开工具 <span aria-hidden="true">&rarr;</span></span>' +
      "</a>"
    );
  });

  grid.innerHTML = html.join("");
  if (stat) stat.textContent = window.ZT_TOOLS.length + " 个工具";
})();
