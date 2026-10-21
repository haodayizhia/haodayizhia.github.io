#!/usr/bin/env python3
"""
BRO 静态博客构建脚本：
自动扫描 posts/*.md 与 resources/resources.json，将 Markdown 转换为 HTML 并输出到 assets/js/data.js。
既支持 GitHub Actions 自动构建部署，也支持本地运行后直接双击 index.html 预览（无跨域限制）。
"""
import glob
import html
import json
import os
import re

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
POSTS_DIR = os.path.join(ROOT_DIR, "posts")
RESOURCES_FILE = os.path.join(ROOT_DIR, "resources", "resources.json")
OUT_DATA_JS = os.path.join(ROOT_DIR, "assets", "js", "data.js")


def parse_frontmatter(text):
    meta = {}
    body = text
    if text.startswith("---"):
        parts = text.split("---", 2)
        if len(parts) >= 3:
            for line in parts[1].strip().splitlines():
                if ":" in line:
                    k, v = line.split(":", 1)
                    meta[k.strip()] = v.strip().strip("'\"")
            body = parts[2].strip()
    return meta, body


def format_inline(text):
    # Escape HTML first
    s = html.escape(text)
    # Inline code `...`
    s = re.sub(r"`([^`]+)`", lambda m: f"<code>{m.group(1)}</code>", s)
    # Bold **...**
    s = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", s)
    # Links [text](url)
    s = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r'<a href="\2" target="_blank" rel="noopener">\1</a>', s)
    return s


def md_to_html(md_text):
    lines = md_text.splitlines()
    out = []
    in_code = False
    code_lines = []
    in_ul = False
    in_quote = False
    quote_lines = []

    def flush_ul():
        nonlocal in_ul
        if in_ul:
            out.append("</ul>")
            in_ul = False

    def flush_quote():
        nonlocal in_quote, quote_lines
        if in_quote:
            content = "<br>".join(quote_lines)
            out.append(f'<div class="callout">{content}</div>')
            in_quote = False
            quote_lines = []

    for raw_line in lines:
        line = raw_line.rstrip()
        if line.startswith("```"):
            flush_ul()
            flush_quote()
            if not in_code:
                in_code = True
                code_lines = []
            else:
                in_code = False
                escaped_code = html.escape("\n".join(code_lines))
                out.append(f"<pre><code>{escaped_code}</code></pre>")
            continue

        if in_code:
            code_lines.append(raw_line)
            continue

        if not line.strip():
            flush_ul()
            flush_quote()
            continue

        # Image ![alt](src)
        img_match = re.match(r"^!\[([^\]]*)\]\(([^)]+)\)$", line.strip())
        if img_match:
            flush_ul()
            flush_quote()
            alt, src = html.escape(img_match.group(1)), html.escape(img_match.group(2))
            out.append(
                f'<div class="figure-card">'
                f'<img src="{src}" alt="{alt}" data-zoom="true">'
                f'<div class="figure-bar">'
                f'<span>▲ {alt}（点击图片可全屏放大）</span>'
                f'<button type="button" class="zoom-btn" data-zoom="true">🔍 放大查看高清全图</button>'
                f'</div></div>'
            )
            continue

        # Headings
        if line.startswith("## "):
            flush_ul()
            flush_quote()
            out.append(f"<h2>{format_inline(line[3:].strip())}</h2>")
            continue
        if line.startswith("### "):
            flush_ul()
            flush_quote()
            out.append(f"<h3>{format_inline(line[4:].strip())}</h3>")
            continue

        # Blockquote / Callout
        if line.startswith(">"):
            flush_ul()
            in_quote = True
            q_content = line[1:].strip()
            if q_content:
                quote_lines.append(format_inline(q_content))
            continue
        else:
            flush_quote()

        # Unordered list
        if line.startswith("- ") or line.startswith("* "):
            if not in_ul:
                out.append("<ul>")
                in_ul = True
            out.append(f"<li>{format_inline(line[2:].strip())}</li>")
            continue
        else:
            flush_ul()

        # Paragraph
        out.append(f"<p>{format_inline(line.strip())}</p>")

    flush_ul()
    flush_quote()
    return "\n".join(out)


def main():
    articles = []
    md_files = sorted(glob.glob(os.path.join(POSTS_DIR, "*.md")), reverse=True)
    for path in md_files:
        with open(path, "r", encoding="utf-8") as f:
            meta, body = parse_frontmatter(f.read())
        slug = meta.get("id") or os.path.splitext(os.path.basename(path))[0]
        articles.append({
            "id": slug,
            "title": meta.get("title", slug),
            "date": meta.get("date", "01.01"),
            "year": meta.get("year", "2026"),
            "tag": meta.get("tag", "随笔"),
            "body": md_to_html(body),
        })

    resources = []
    if os.path.exists(RESOURCES_FILE):
        with open(RESOURCES_FILE, "r", encoding="utf-8") as f:
            resources = json.load(f)

    payload = {"articles": articles, "resources": resources}
    os.makedirs(os.path.dirname(OUT_DATA_JS), exist_ok=True)
    with open(OUT_DATA_JS, "w", encoding="utf-8") as f:
        f.write("// 该文件由 scripts/build.py 自动生成，请勿直接手改，直接编辑 posts/*.md 即可\n")
        f.write("window.BRO_DATA = " + json.dumps(payload, ensure_ascii=False, indent=2) + ";\n")
    print(f"Built {len(articles)} article(s) and {len(resources)} resource(s) -> {OUT_DATA_JS}")


if __name__ == "__main__":
    main()
