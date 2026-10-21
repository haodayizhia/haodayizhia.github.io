# BRO · 个人主页与博客 (`haodayizhia.github.io`)

采用「文件分离 + Markdown 写作 + GitHub Actions 自动构建部署」的清晰架构：

```text
haodayizhia.github.io/
├── .github/workflows/deploy.yml    # GitHub Actions：推送代码时自动编译 Markdown 并部署到 Pages
├── posts/                          # 【文章目录】每篇文章一个独立的 .md 文件
│   └── 2026-10-21-linux-readline.md
├── resources/                      # 【资源目录】独立存放公开/付费资源配置
│   └── resources.json
├── assets/
│   ├── images/                     # 【图片目录】所有 SVG / PNG / JPG 原图独立存放在此
│   │   └── linux-readline-cheatsheet.svg
│   ├── css/style.css               # 【样式表】独立管理日间/夜间星穹配色与排版
│   └── js/
│       ├── app.js                  # 【前端交互】路由切换、搜索过滤、主题切换与全屏高清灯箱
│       └── data.js                 # 由 scripts/build.py 自动生成的数据文件（支持本地直接双击 index.html 预览）
├── scripts/build.py                # 【构建脚本】将 posts/*.md 转换为网页数据
└── index.html                      # 【页面骨架】纯 HTML 结构，简洁清晰
```

## 日常如何写新文章与放图片？

1. **保存图片**：把图片（例如 `my-diagram.svg` 或 `screenshot.png`）放进 `assets/images/` 文件夹。
2. **新建文章**：在 `posts/` 文件夹下新建一个 `.md` 文件（建议按日期命名，如 `2026-10-25-new-post.md`），格式如下：
   ```markdown
   ---
   id: new-post
   title: 你的文章标题
   date: 10.25
   year: 2026
   tag: 技术笔记
   ---

   这里是正文内容，支持 **加粗**、`行内代码`、列表与代码块。

   ![图片说明文字](./assets/images/my-diagram.svg)

   ## 二级小标题
   正文段落...
   ```
3. **发布上线**：直接 `git add . && git commit -m "Add new post" && git push`，GitHub Actions 会自动运行 `scripts/build.py` 编译你的 Markdown 文章并更新线上网站！
4. **本地预览**：如果在电脑本地改了 `.md` 想先看效果，运行 `python3 scripts/build.py`，然后直接双击 `index.html` 即可在浏览器预览。
