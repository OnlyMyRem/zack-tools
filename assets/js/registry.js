/* 工具注册表：新增一个工具 = 在 tools/ 下建目录 + 在这里加一条记录，首页自动出现。
   路径都写相对站点根的 `tools/<slug>/index.html`，前缀由 ZT_ROOT 换算，
   这样根目录的 index.html 和二级目录下的工具页都能共用同一份数据。
   链接必须带上 index.html：只写目录时 file:// 会落到文件列表，还得再点一次才进工具。 */

(function () {
  var TOOLS = [
    {
      slug: "timestamp",
      name: "时间戳转换",
      icon: "⏱",
      tags: ["Unix", "时区", "13位/10位", "基准时间"],
      summary:
        "实时查看当前 Unix 时间戳，秒级与毫秒级互转，时间戳 ⇄ 日期双向换算，支持任意 IANA 时区；右侧基准栏按日、年月（年 → 月 → 该月哪一天）两组可选，默认停在最近一个。",
    },
    {
      slug: "cron",
      name: "Cron 表达式",
      icon: "🗓",
      tags: ["Spring", "Quartz", "Linux"],
      summary:
        "可视化生成 Cron 表达式，自动识别 Spring / Quartz / Linux 三种格式，支持任意时区（含按定位获取）并预览未来若干次触发时间。",
    },
  ];

  // 从自己的 src 反推站点根前缀，避免每页手写相对层级。
  function resolveRoot() {
    var self = document.querySelector("script[data-registry]");
    if (!self) return "./";
    var src = self.getAttribute("src") || "";
    var cut = src.indexOf("assets/js/registry.js");
    return cut === -1 ? "./" : src.slice(0, cut);
  }

  window.ZT_ROOT = resolveRoot();
  window.ZT_TOOLS = TOOLS;

  window.ztToolHref = function (slug) {
    // 服务器部署用短地址（/<slug>/），地址栏更干净；file:// 直接打开时退回
    // 带 index.html 的相对路径，避免落到目录列表还得再点一次。
    if (window.location && window.location.protocol === "file:") {
      return window.ZT_ROOT + "tools/" + slug + "/index.html";
    }
    return window.ZT_ROOT + slug + "/";
  };

  window.ztFindTool = function (slug) {
    for (var i = 0; i < TOOLS.length; i++) if (TOOLS[i].slug === slug) return TOOLS[i];
    return null;
  };
})();
