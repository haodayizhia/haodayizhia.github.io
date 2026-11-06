# BRO · 星空主页

## 覆盖与预览

1. 将压缩包中的所有文件和文件夹复制到原项目根目录，即原来 `index.html` 所在的位置，选择替换同名文件。不要额外套一层目录。
2. 本包不含 `.git`，不会替换你的 Git 仓库记录；其他未同名文件会保留。
3. 双击 `index.html` 可以本地预览，不需要安装前端依赖。
4. 如果你在上传压缩包之后又修改过文章或资源配置，保留你的最新 `posts/` 和 `resources/resources.json`，覆盖页面文件后运行 `python scripts/build.py`，重新生成文章数据。
5. 部署到 GitHub Pages 时，沿用仓库原有的提交、推送流程；包内 `.github/workflows/deploy.yml` 已更新为同时发布所有栏目和详情页面。GitHub 仓库的 Pages 来源应为 GitHub Actions。

## 页面与交互

- `index.html`：星空首页、最近文章，存在资源时显示精选资源。
- `articles.html` / `resources.html` / `about.html`：独立栏目页。
- `article.html?id=...` / `resource.html?id=...`：完整详情页。
- `search.html?q=...`：搜索文章标题、分类、正文及资源标题、说明。
- 旧的 `#articles`、`#articles/文章ID`、`#a:文章ID` 等链接仍可跳转到新页面。
- 内容在普通页面中打开。文章图片支持弹层放大、原始尺寸、Esc 关闭。

## 昼夜模式

首次访问默认夜间模式，不再跟随设备。点击右上角地球即可自转并切换主题。昼夜使用同一张星空背景，通过透明度和底色渐变过渡，星点不会重新排列。日间银河仅保留极淡痕迹。

手动选择在本标签页的页面跳转间保留。刷新页面恢复夜间模式。若浏览器禁止会话存储，当前页面仍可切换；跨页时会恢复夜间模式。系统开启“减少动态效果”时跳过动画。

## 新增文章

每篇文章放在 `posts/`，格式保持原样：

```markdown
---
id: example-post
title: 文章标题
date: 11.06
year: 2026
tag: 技术笔记
---

正文，支持 **加粗**、`行内代码`、列表、引用与代码块。

![图片说明](./assets/images/example.svg)
```

图片放在 `assets/images/`。本地新增或修改文章后运行：

```bash
python scripts/build.py
```

GitHub Actions 部署前也会自动执行构建。无需手改 `assets/js/data.js`。

## 新增资源

编辑 `resources/resources.json`。当前保留你上传版本的空列表，不添加演示资源。每项可使用：

```json
{
  "id": "example-resource",
  "title": "资源名称",
  "mark": "资料",
  "desc": "资源说明",
  "type": "free",
  "url": "./resources/example.pdf"
}
```

资源链接支持本地相对路径或 HTTP/HTTPS 地址。`type` 为 `free` 时显示“获取资源”，其他值显示“前往购买”。修改后同样运行构建。

## 文件结构

- `assets/css/style.css`：电脑与手机布局、昼夜配色、阅读页面。
- `assets/js/theme-init.js`：首屏主题初始化。
- `assets/js/theme.js`：手动昼夜切换。
- `assets/js/globe.js`：保留原项目地球的三维投影、自转和明暗绘制。
- `assets/js/app.js`：页面内容、搜索、移动导航、图片放大。
- `assets/images/starfield.webp`：本地星空背景，无需外链。
- `scripts/build.py`：原 Markdown 数据构建流程。

已在浏览器检查昼夜切换、独立文章页、搜索、图片放大，以及 390px / 320px 窄屏首页和菜单。

## 首页与手机布局更新

首页按可视高度为最近文章预留空间。手机端采用左对齐双行标题，统一导航、标题与正文边距，日期和分类合并成一行；保留原有星空与昼夜连续切换。

## 稳定的页面切换

构建需安装 Python 3 和 Node.js 22 或更新版本，无需 npm 依赖。仍运行 `python scripts/build.py`，会同时更新内容数据、栏目 HTML 和每篇文章/资源的静态详情 HTML。页面正文在首屏已存在，不等待 JavaScript 填充；搜索和旧的查询参数链接继续由浏览器处理。

首页与栏目列表使用相同最大宽度，文章保留较窄的阅读区。页面始终预留滚动条位置，短页面的页脚固定在内容下方的视口底部；本地 SVG 插图在构建时写入宽高，避免图片加载后挤动正文。
