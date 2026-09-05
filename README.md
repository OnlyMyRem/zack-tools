# Zack Tools

日常开发里那些「记不住、要现查」的小工具。纯静态页面，零构建、零依赖，数据不出本机。

当前包含两个工具：

| 工具 | 入口 | 参考 |
| --- | --- | --- |
| 时间戳转换 | [`tools/timestamp/`](tools/timestamp/index.html) | tool.lu/timestamp |
| Cron 表达式 | [`tools/cron/`](tools/cron/index.html) | cron.ciding.cc |

## 快速开始

两种方式都行：

```bash
# 1) 直接双击 index.html（file:// 打开，功能完整）
#    首页卡片此时指向 tools/<slug>/index.html（带文件名），
#    不会停在 file:// 的目录列表上让你再点一次。

# 2) 起一个本地静态服务（推荐，剪贴板走原生 API）
python -m http.server 8848 --bind 127.0.0.1
# 浏览器打开 http://127.0.0.1:8848/
```

> 服务器部署时用短地址（`/<slug>/`），`assets/js/registry.js` 会按协议自动选择：
> `file://` 下用 `tools/<slug>/index.html`，http(s) 下用 `/<slug>/`。

没有 `npm install`，没有打包步骤，改完刷新即可。

## 部署到服务器（nginx）

站点是纯静态目录，nginx 只需要把仓库根当作 web 根来发文件：**没有构建产物，不需要 Node、
反代、PHP 或任何后端**，也不需要 SPA 那条 `try_files ... /index.html` 兜底（所有 URL 都对应真实文件）。

```bash
# 1) 放代码：clone 到 /opt 下，用 git pull 即可更新
sudo git clone git@github.com:OnlyMyRem/zack-tools.git /opt/zack-tools
# 更新版本：cd /opt/zack-tools && sudo git pull
# 让 nginx 进程能读这些文件（RHEL/CentOS 用 nginx:nginx，Debian/Ubuntu 用 www-data:www-data）
sudo chown -R nginx:nginx /opt/zack-tools
```

```nginx
# /etc/nginx/conf.d/zack-tools.conf
server {
    listen      80;
    listen      [::]:80;
    server_name tools.example.com;      # 没有域名就写 _

    root        /opt/zack-tools;
    index       index.html;             # /tools/timestamp/ 这类目录 URL 由它命中 index.html
    charset     utf-8;                  # 界面是中文，缺这行时某些 locale 下会给成 latin-1

    # 短地址：/<slug>/ 直达工具（首页卡片也指向这种短链接）。
    # 每加一个工具就补一行映射；/<slug> 无尾斜杠时先 302 到 /<slug>/。
    location = /timestamp { return 302 /timestamp/; }
    location ^~ /timestamp/ { alias /opt/zack-tools/tools/timestamp/; index index.html; }
    location = /cron { return 302 /cron/; }
    location ^~ /cron/ { alias /opt/zack-tools/tools/cron/; index index.html; }

    # 真实文件优先：目录 → index.html，找不到就是 404，不兜到首页
    location / {
        try_files $uri $uri/ =404;
    }

    # 静态资源没有 hash 文件名，给一档短缓存；改版后 Ctrl+F5 即可看到新样式
    location ~* \.(css|js|svg|ico|woff2?)$ {
        expires 7d;
        add_header Cache-Control "public";
        access_log off;
    }

    gzip on;
    gzip_min_length 1024;
    gzip_types text/css application/javascript image/svg+xml;
}
```

```bash
sudo nginx -t && sudo systemctl reload nginx     # -t 先校验，配置写错不会把已有站点重载坏
# 要 HTTPS（clipboard API 也只在 https 或 localhost 下可用）：
sudo certbot --nginx -d tools.example.com
```

- 首页 `/`、工具短地址 `/timestamp/`、完整 `/tools/timestamp/` 与 `/tools/timestamp/index.html` 都能直达。
- SELinux 机型（RHEL/CentOS）上把站点放在非默认目录要补一句上下文：
  `sudo semanage fcontext -a -t httpd_sys_content_t '/opt/zack-tools(/.*)?' && sudo restorecon -Rv /opt/zack-tools`，
  否则 nginx 会报 `Permission denied`。
- 只想临时分享给同事、不想要 nginx：在仓库根跑 `python -m http.server 8848 --bind 0.0.0.0` 就够，
  但那没有 HTTPS，剪贴板会走 `execCommand` 回退。

## 目录结构

设计目标是**加工具不动老代码**：一个工具一个自包含目录，共享的东西全部沉到 `assets/`。

```
zack-tools/
├── index.html                  # 首页：工具卡片由 registry 渲染
├── assets/
│   ├── css/
│   │   ├── theme.css           # 三套主题的 CSS 变量（唯一色板来源）
│   │   ├── base.css            # reset、排版、布局骨架
│   │   ├── components.css      # 顶栏/面板/输入/按钮/chip/toast 等通用组件
│   │   └── home.css            # 首页专属样式
│   └── js/
│       ├── registry.js         # 工具注册表 + 站点根路径推导
│       ├── shell.js            # 注入顶栏、面包屑（末项即本页 h1）、toast 容器
│       ├── theme.js            # 主题机（system/dark/light/eye）
│       ├── time.js             # 时区原语：墙上时间 ⇄ 时刻、坐标 → 时区，无库实现
│       ├── utils.js            # 复制、toast、时区下拉、定位取时区、localStorage 偏好（默认 Asia/Shanghai）
│       └── home.js             # 首页渲染
└── tools/
    ├── timestamp/
    │   ├── index.html          # <body data-page="timestamp">
    │   ├── timestamp.css       # 只写这个工具特有的样式
    │   └── timestamp.js
    └── cron/
        ├── index.html
        ├── cron.css
        ├── cron.js             # 界面逻辑
        └── cron-parser.js      # 解析/推算/中文说明/方言互转（纯逻辑，可单测）
```

### 加一个新工具（两步）

1. 建目录 `tools/<slug>/`，放 `index.html`、`<slug>.css`、`<slug>.js`。
   `index.html` 的 `<body>` 写 `data-page="<slug>"`，头部按现有页面顺序引入
   `theme.css → base.css → components.css → <slug>.css` 与
   `registry.js(data-registry) → theme.js`，底部引入 `utils.js → shell.js → <slug>.js`。
   `<main>` 里不必再写页头标题块：面包屑由外壳注入，其末项就是本页的 `<h1>`，内容从第一块面板开始。
2. 在 `assets/js/registry.js` 的 `TOOLS` 数组追加一条
   `{ slug, name, icon, tags, summary }`。

首页卡片、顶栏返回、面包屑都会自动出现，不需要改第二处；顶栏品牌右侧的工具导航（竖线后的跳转链接）也由这份注册表驱动，新增工具即多一个入口；不再有按钮或文案样板可删。
首页卡片在服务器上用短地址 `/<slug>/`，`file://` 下退回 `tools/<slug>/index.html`，
但 nginx 里的 `location` 短地址映射需要手动补一行（见「部署到服务器」），否则短地址 404。

## 功能一览

### 时间戳转换

- 版式按使用频率排：页面上没有页头标题块也没有页脚，注入的面包屑末项「时间戳转换」就是本页可见的
  `<h1>`，第一块面板紧贴其下；左栏第一块面板把「目标时区」和「当前时间戳」实时卡片合并置顶，其下
  **时间戳 ⇄ 日期两块互转并排**，与右栏常用基准时间一起落在首屏，打开页面不必下滑
  （1440 宽下整页高度因此从约 1253px 降到约 991px，900px 高的视口只剩最后一两行结果需要挪一点）；
  基准栏整块顶头，与左栏第一块面板顶边齐平（不再靠位移对齐）。每条结果都是
  「标签 + 完整值 + 复制」挤在一行内显示，标签列定宽右对齐，各行的值起点、复制按钮右缘
  都在同一条竖线上（≤560px 时标签先占一行，让值拿到整行宽度）。
  装不下时**按整段让位**而不是咬半截字：结果行里日期时间与后面的星期各占一个 `<span>`，
  「回读校验」行里日期时间与时区 ID 也各占一段，值本身永远完整；遇到
  `America/North_Dakota/New_Salem` 这类长 ID，「该时区当前时间」的元信息先由 JS 按实测宽度打上
  `.tight` 整条沉到虚线框第二行，第二行还放不下就打 `.no-zone` 把 ID 整段省掉（ID 本来就写在上方下拉框里），
  省略号只是极端组合下的最后兜底，任何情况下都不会顶出整页横向滚动条，复制走的仍是完整文本。
  行栅格的分栏下限是按最长的一条值算出来的（RFC 2822 定长 31 字符 ≈ 252px，加上标签 / 间距 / 复制按钮
  取 392px；两块互转并排的下限 430px 同时约束了里面每条结果能拿到的最小宽度）——
  宁可退回单栏把值摊开，也不凑成两栏后被省略号咬掉。
- 当前时间戳实时走动：秒级（10 位）、毫秒级（13 位）。选定时区的墙上时间就写在上方
  「该时区当前时间」那一框里，框内自带复制按钮，按住的值是干净的 `YYYY-MM-DD HH:MM:SS`。
- 三个「填入下方…」按钮（秒级 / 毫秒级 / 日期）点下去，值会沿一道抛物线从按钮跳到下方对应的输入框里，
  落点再给那个输入框一圈高亮；窄屏下目标不在视野内就先把它滚进来再起飞，`prefers-reduced-motion` 时
  只留那圈高亮、不让数字飞。
- 时间戳 → 日期：自动识别 10/13 位，也可手动指定单位；同时给出 ISO 8601、UTC、RFC 2822、
  相对当前的人话差值、年内第几天。偏移按整秒拆，所以 1901 年前的 LMT（`Asia/Shanghai` = `+08:05:43`）
  在 ISO 8601 里写出秒级精度，RFC 2822 只承认 `±HHMM` 就近取整成 `+0806`，都不会再变成 `+08:5.7166…`
  这种小数分钟。
- 日期 → 时间戳：文本框右侧贴一个日历按钮，点它弹出浏览器原生日历选择器（页面上只显示一个日期，不再另开一栏），
  选完回填文本框并按所选时区算出秒/毫秒与 ISO 8601；也可直接键入 `2026-09-04 21:30:00`。
- 目标时区默认**中国上海 (Asia/Shanghai)**，不跟随操作系统；可选任意 IANA 时区（常用置顶 + 引擎提供的全量列表），
  偏好写入 localStorage。标签右侧「按定位获取」向浏览器要一次地理位置，按最近的代表城市推测时区；
  未授权或取不到时直接落回中国上海并说明原因，不会把页面留在空状态。
- **常用基准时间**：与左栏并排的一栏固定面板，整块顶头（与左栏第一块面板顶边齐平），
  `position: fixed` 钉在视口内，滚到页面底部也不挪动，基准时间一直在手边。
  两组对应 `timestamp.xlsx` 的日 / 月 / 年三张表（月与年合成一组）：
  **日** = 时 0-23 × 分 0/5/…/55；**年月** = 年份 1970-2050 → 月份 1-12 → 该月哪一天（第一天 / 第1~4周周一），
  即原「某月 1 号」与「某年第 N 月第一天」都落在这条级联上。选中即给出秒级与毫秒级时间戳、该时区墙上时间与距今。
  年月的三个下拉框并排一行：年份 / 月份按各自最长选项占宽，剩下的整行宽度都给「该月」（它的选项最长）；
  窄屏堆叠、卡片吃满整行时改按 1 : 1 : 1.4 分宽，不让「该月」一个人撑到几百像素。
  窗口矮到装不下整栏时，基准栏自己出滚动条，末尾的说明文字照样够得着。
  下拉框去掉原生下三角，右侧改成 ▲▼ 两个小按钮，点一次上移/下移一项（已到首/末项时对应按钮置灰），
  跳着选仍可直接点下拉框。
  「第 N 周周一」取该月第 N 个周一；没有手动选过的一组会自动停在**最近一个**已发生的时刻，
  手动选过之后保持所选，卡片右上角的「回到最近」一键回到最近一个。夏令时切换导致当天不存在该墙上时间时会显式说明算成了什么。
- 基准时间结果行一键复制；复制走 `navigator.clipboard`，`file://` 下自动回退 `execCommand`。

### Cron 表达式

- 版式：与时间戳页一样不写自己的页头也不留页脚（面包屑末项「Cron 表达式」即本页可见的 `<h1>`）。
  顶部一块面板以**推算时区**起头（标签行自带「从位置获取」，与时间戳页同一套定位流程），下面是表达式
  输入框——**复制表达式 / 清空两个按钮与输入框同一水平线、钉在输入框右侧**；输入框正下方一排小段签
  只标每个字段的字段名与原文，不再写逐字段解释（解释文案长短不一会让卡片忽高忽低，已去掉）。
  其下**左栏选项卡装「常用预设 / 字段生成器」，右栏是未来触发时间**。宽屏桌面把左右两栏都锁进视口、
  各栏内部自行滚动，右栏顶部的表达式面板 sticky 钉住，滚预设列表到底也不会把表达式带出视口；
  缩到窄屏 / 矮窗口时退回普通整页滚动。
  三种格式的解释叠在同一个网格单元里，占位恒为最长那条，切换方言只换可见性，下面的内容不再被顶来顶去。
- 三种方言：**Linux crontab**（5 段，无秒、无 `?`、日与周同时指定取并集，默认选中且格式钮排最左）、
  **Spring**（6 段，周 0-7）、**Quartz**（6/7 段，周从 1 起，`?`/`L`/`W`/`#`/年）。
  含秒的 Spring/Quartz 也直接收 Linux 式 5 段简写（秒按 0 处理），默认示例就是 5 段。
- 点格式钮只切换解析方言、**绝不改写你输入的文本**：5 段简写切到 Spring/Quartz 照常解析；
  6/7 段切到 Linux 时报段数错误但不改动内容。只有跨方言数字周（Quartz 1=周日 vs 其余 0=周日）
  这种语义随文本变化的情况会红字提醒。
- 常用预设按当前格式渲染：能无损表达的条目一点即载入（跨格式自动折算，悬停 title 就是将要载入的
  写法）；当前格式表达不了的（秒级粒度、`L/W/#`、年字段、并集↔交集语义）会**置灰**不可选，
  悬停或点击给出原因，不再出现「tooltip 是原文、点完却报段数错」的错位。切换格式时若选中的预设
  仍能以同一段文本等价载入，选中态会保留。
- 每个字段一段「字段名 + 原文」小段签（嵌在表达式正下方，不写解释、高度恒定）；
  一句人话总结列在触发时间面板顶部。段数不符、`?` 违规、值越界都给可操作的报错。
- 未来触发时间预览（5/10/20/50 次），按选定时区推算；推算时区支持「从位置获取」一键按经纬度
  切换（与时间戳页同一套定位流程）。含夏令时空隙处理与 100 年收敛上限。
- 可视化生成器：每个字段可切「每\* / 不指定\? / 间隔 / 指定值」，数字网格点选，
  与表达式框双向同步；用了 `L`/`W`/`#` 的字段锁定并提示直接改表达式。
- 预设表达式分组点选载入（跨格式自动折算、当前格式表达不了的条目置灰并给原因）+
  格式行右侧「字段速查」弹窗列出各字段取值与三种方言的差异，需要时按一下就到，页面不再常驻一整张长表格。

## 主题

三套主题的 token 与本地项目 `E:\chronos-fit`（ChronosFit）完全对齐，另加一档「跟随系统」：

| 模式 | 落地方式 |
| --- | --- |
| 深色（默认） | `:root` |
| 浅色 | `html.light` |
| 护眼 | `html.light.eye`（浅色家族，只换色板） |
| 跟随系统 | 按 `prefers-color-scheme` 解析成深/浅 |

- 类名挂在 `<html>` 上，`theme.js` 在 `<head>` 内就完成落地，首屏不会闪一帧深色。
- 顶栏右侧下拉可直达四档（≤640px 窄屏隐藏下拉，只留圆钮），圆钮按 `深 → 浅 → 护眼 → 跟随系统` 循环（循环只当次生效，
  选到具体档才写入偏好）。
- 偏好存 `localStorage` 的 `zacktools_theme`，时区偏好存 `zacktools_tz`（没有这一项时按 `Asia/Shanghai` 起算）。
- 写新组件时只针对 `.light` 适配一次浅底即可，护眼会自动继承。

## 技术约定

- 原生 HTML/CSS/JS，**不引入任何运行时依赖或构建工具**：脚本用 IIFE + `var` 的 ES5 写法，
  挂到 `window.Zt*` 命名空间（`ZtTheme` / `ZtTime` / `ZtUtil` / `ZtCron`）。
- 逻辑与视图分离：`cron-parser.js`、`time.js` 不碰 DOM，可在 Node 里直接跑断言验证。
- 时区计算不用 `Intl` 之外的库：读取用 `Intl.DateTimeFormat().formatToParts`，
  反向换算用两轮偏移修正，历史偏移（如 1900 年 Asia/Shanghai 的 LMT）保持真实而非取现代值。
- 样式一律消费 `theme.css` 的变量，组件里不写魔法色值，换主题不需要改组件。

## 已知边界

- 全量 IANA 时区列表、历史 UTC 偏移与夏令时规则都来自浏览器引擎的 `Intl`，不同浏览器可选条目略有差异；
  「某个区名能不能用」以能否真正构造出格式化器为准（`Intl.supportedValuesOf` 的列表并不完整，
  `UTC`、`Asia/Kolkata`、`Europe/Kyiv` 等都会被漏列）。偏好里的时区在当前引擎不可用时，页面会显式标注并回落到
  站点默认 `Asia/Shanghai`，而不是静默替换。
- 「按定位获取」只拿到经纬度，时区按**最近的代表城市**推测（城市表覆盖常见时区，中国大陆各方向都放了
  同属 `Asia/Shanghai` 的锚点）。边境与大城市之间可能猜错一档，例如深圳近处会给出 `Asia/Hong_Kong`——
  两者偏移相同；它不替代真正的时区边界数据，猜错时在下拉里改一次即可（偏好会被记住）。
- `file://` 打开时 `navigator.clipboard` 常不可用，已回退 `execCommand`；自动化/失焦标签页里
  仍可能被浏览器策略拦截，此时提示手动选中。
- 日历按钮依赖 `HTMLInputElement.showPicker()`，浏览器只在**真实用户点击**的上下文里放行。该 API 不存在或被拒绝时
  退回聚焦那个透明输入框，日历面板得改由浏览器自绘的日历小图标打开，文本框输入与页面上其他交互不受影响。
- Cron 推算上限：单次最多推进 20 万轮，超出会明确标注「到达推算上限，后面的触发时间未列出」，
  不会假装列全。
