# 股市图谱维护

网站入口：资源 → 股市图谱。网页复用 BRO 导航、搜索与持久化昼夜模式。

## 使用本地行情

- **只自己查看**：网页“数据”→“本地查看”，选择合并 CSV 或逐股 CSV。文件在 Web Worker 中解析，不向网站发送；关闭页面后需重新导入。可点“返回公开数据”恢复站点数据。
- **网页直接公开发布**：网页“数据”→“上传并发布”，填写对此仓库有 Contents 读写权限的 GitHub 令牌，选择合并 CSV 或逐股目录。校验通过后直接提交图表数据并触发 Pages 部署。令牌只在本次向 GitHub 的 HTTPS 请求中使用，不存入本地存储或网站文件；发布后自动清空。遇到其他并发提交时停止覆盖。网页未登录访客无法改写公开数据。
- **本地发布备选**：也可双击项目根目录的 `上传行情CSV.cmd`，复用本机 GitHub 登录，不需在网页填令牌。构建和测试通过后仅提交行情数据。
- **合并原行情并发布**：双击 `更新股市图谱.cmd`。默认运行用户目录下 `Documents/BaiduSyncdisk/Code/Python/Money/TushareTools/find_factor/merge_stocks.py` 的合并函数，并严格检查其布尔返回值。脚本本身不会爬取行情，需要先让原采集流程更新 `stock_data`。

命令行（需 Python 3.10+、numpy、pandas、Node.js 22+、Git 和现有 GitHub 登录）：

```powershell
powershell -NoProfile -File scripts/market_atlas/run.ps1 -Mode Merge
powershell -NoProfile -File scripts/market_atlas/run.ps1 -Source "D:\data\merged_stock_data.csv"
# 仅本地构建，不公开发布
powershell -NoProfile -File scripts/market_atlas/run.ps1 -Source "D:\data\stock_data" -NoPublish
```

可通过 `MARKET_ATLAS_PYTHON` 指定 Python。发布复用本机 Git Credential Manager 的登录，只在进程内读取；网页没有 GitHub 令牌。若有未提交网站改动或远端分支变化，发布会停止，不覆盖它们。比当前快照更旧的数据默认拒绝，只有明确使用 `update.py --source ... --allow-older` 才允许回退。

## 数据与构建

`model.py` 保留原 MarketAtlas 的读取及计算口径。仅将图表需要的九个数值字段和股票元数据导出到 `data-source/market-atlas/`，不复制原 CSV 的其他列、缓存、日志或本机路径。数据按月保存为小端 float32，缺失值为 NaN；Git 可压缩历史差异。`scripts/build.py` 仅需 Python 标准库和 Node，校验分片 SHA-256 后打包为 gzip。网页后台线程解压校验，再按原口径计算；公开数据截至日期直接取交易日，不把打包时间当成行情时间。

原版的个股、行业、市场、轮动、热力图和回放保留。`engine.test.cjs` 的 16 组数值结果来自原 Python 模型，另外验证 CSV 流式读取、引号、日期、字段和文件名校验。`make_fixture.py` 用于显式更新对照数据，需要 numpy/pandas；CI 运行已提交的对照测试，不需要这些依赖。

## 网页交互与手机布局

界面按“市场、行业、个股”分开。初始只显示股票池等权走势，不预选行业或个股；通过“行业对比”面板搜索并多选。图表占据主体宽度，颜色沿用网站的昼夜主题，资源入口使用透明底色与分隔线。

点击确定日期，长按可自由移动横纵参考线；提示框同时列出全部对比项，松手后可滚动较长的读数列表。双指或滚轮缩放时间范围，缩放后可横向平移；双击或“复原”恢复范围。每张图支持全屏，退出后保留范围；桌面还支持 Shift 拖动框选和键盘方向键。日期也可通过顶部日期入口指定，不再提供底部日期滑块和锁定按钮。

热力图始终保留当前研究区间的全部交易日和行业，缩放只改变格子宽度；行业名称与日期固定，图内可滚动。市场轮动支持直接点选多个行业并显示历史轨迹。市场状态的参与面、波动和成交额组成紧凑的同日联动区域，缩放范围同步，操作任意一图时提示框同时显示五项指标；手机可全屏同时查看三图。全部原生弹窗支持窗口外点击、关闭按钮与 Esc 关闭。

全站构建会将主题初始化和画布底色内联在首屏 HTML，先于外部 CSS 执行；图谱的 CSP 哈希以 HTML 解析器归一化后的换行为准。`ui.test.cjs` 检查绘图区、缺失值断线、缩放边界、所有页面首屏主题与 CSP 哈希。`browser.test.cjs` 使用真实 Chromium 触摸事件验收默认选择、全部对比读数、长按、双指缩放、全屏范围保留、弹窗外关闭、完整日期热力、轮动点选、状态联动及 320/390/1440px 昼夜布局；Pages 部署前执行这组浏览器检查。浏览器需安装 Playwright 与 Chromium，可用 `ATLAS_QA_CHROME` 指定本机 Chrome、`ATLAS_QA_OUTPUT` 指定截图目录、`QA_URL` 复查线上站点。

## 云端每日更新

`.github/workflows/market-atlas.yml` 每天北京时间 18:30 在 GitHub Actions 运行，也支持 Run workflow 手动触发。无需本机或 Codex 开机；GitHub 定时任务可能排队延迟。它运行从原 `fetch_stocks.py` 适配的云端副本，保留原有股票池（00、60 开头）、前复权、预热、横截面增量、除权时全量重拉和指标计算逻辑。原本地项目不修改。

Tushare 凭据通过仓库加密 Secret `TUSHARE_TOKEN` 注入，只通过 HTTPS 访问 Tushare。全量原始历史保存在 Actions Cache，缺失缓存时从 `market-atlas-seed` Release 恢复初始 CSV。缓存种子含公开行情字段，不含令牌、配置或本机路径。原始历史从 2024 年开始预热；公开页面仍按原合并脚本的 `START_DATE=20260101` 发布。股票池和行业映射分别为 `cloud-pool.csv`、`cloud-industries.csv`，可显式更新这两份配置。

抓取任一股票失败、合并失败、校验失败或测试失败都不推送；没有数据变化时不创建提交。数据提交使用自动工作流令牌，因此工作流显式触发 `deploy.yml`，确保网站随之更新。页面显示实际行情交易日，不将任务运行时间当成最新行情。手工上传的数据直接发布；之后的每日任务仍按已配置的股票池更新，比当前公开数据更旧的抓取结果会被拒绝。
