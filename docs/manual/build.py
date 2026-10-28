#!/usr/bin/env python3
"""Build the H&E preprocessing manual HTML files from the bilingual markdown sources.

Usage: python3 docs/manual/build.py
Inputs:  docs/manual/01-HE-preprocessing-guide.{zh,en}.md
Outputs: docs/manual/build/01-H&E-preprocessing-guide.{zh,en}.html
"""

import re
from pathlib import Path

import markdown

ROOT = Path(__file__).resolve().parent
BUILD = ROOT / "build"

FIGURE_CAPTION_RE = re.compile(
    r"<p><img alt=\"(.*?)\" src=\"(.*?)\"(?: /)?></p>\s*<p>((图|Figure)[^<]*)</p>",
)

HTML_TEMPLATE = """<!DOCTYPE html>
<html lang="__LANG__">
<head>
<meta charset="utf-8">
<title>__TITLE__</title>
<style>
  @page {
    size: A4;
    margin: 18mm 17mm 20mm 17mm;
  }
  html, body {
    margin: 0;
    padding: 0;
    background: #ffffff;
  }
  body {
    font-family: "__BODY_FONT__", "Noto Sans CJK SC", "Noto Sans", sans-serif;
    font-size: 10.5pt;
    line-height: 1.7;
    color: #1f2937;
  }
  h1 {
    font-size: 21pt;
    line-height: 1.35;
    color: #0f172a;
    border-bottom: 2.5px solid #2563eb;
    padding-bottom: 10px;
    margin: 0 0 18px 0;
    break-after: avoid;
  }
  h2 {
    font-size: 15pt;
    color: #1e3a8a;
    margin: 26px 0 10px 0;
    break-after: avoid;
  }
  h3 {
    font-size: 12.5pt;
    color: #1f2937;
    margin: 20px 0 8px 0;
    break-after: avoid;
  }
  h4 {
    font-size: 11pt;
    color: #374151;
    margin: 14px 0 6px 0;
    break-after: avoid;
  }
  p { margin: 6px 0; }
  ul, ol { margin: 6px 0 10px 0; padding-left: 22px; }
  li { margin: 3px 0; }
  li > ul { margin: 2px 0; }
  a { color: #2563eb; text-decoration: none; }
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 10px 0 14px 0;
    font-size: 9.5pt;
    line-height: 1.5;
  }
  th, td {
    border: 1px solid #d1d5db;
    padding: 5px 8px;
    text-align: left;
    vertical-align: top;
  }
  th { background: #f3f4f6; font-weight: 600; color: #111827; }
  tr { break-inside: avoid; }
  figure.fig {
    margin: 14px 0 16px 0;
    padding: 8px;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    background: #ffffff;
    break-inside: avoid;
    text-align: center;
  }
  figure.fig img {
    max-width: 100%;
    height: auto;
    display: block;
    margin: 0 auto;
  }
  figure.fig figcaption {
    margin-top: 7px;
    font-size: 9pt;
    color: #4b5563;
    text-align: left;
    line-height: 1.55;
  }
  h2, h3, h4 { break-inside: avoid; }
</style>
</head>
<body>
__BODY__
</body>
</html>
"""

SOURCES = [
    {
        "md": "01-HE-preprocessing-guide.zh.md",
        "html": "01-HE-preprocessing-guide.zh.html",
        "lang": "zh-CN",
        "title": "H&E 图像预处理说明",
        "body_font": "Noto Sans CJK SC",
    },
    {
        "md": "01-HE-preprocessing-guide.en.md",
        "html": "01-HE-preprocessing-guide.en.html",
        "lang": "en",
        "title": "H&E Image Preprocessing Guide",
        "body_font": "Noto Sans",
    },
]


def build_one(spec: dict) -> None:
    md_text = (ROOT / spec["md"]).read_text(encoding="utf-8")
    body = markdown.markdown(md_text, extensions=["tables"])

    def to_figure(match: re.Match) -> str:
        alt, src, caption = match.group(1), match.group(2), match.group(3)
        return (
            f'<figure class="fig">'
            f'<img alt="{alt}" src="../{src}" />'
            f"<figcaption>{caption}</figcaption>"
            f"</figure>"
        )

    body = FIGURE_CAPTION_RE.sub(to_figure, body)

    html = (
        HTML_TEMPLATE
        .replace("__LANG__", spec["lang"])
        .replace("__TITLE__", spec["title"])
        .replace("__BODY_FONT__", spec["body_font"])
        .replace("__BODY__", body)
    )

    BUILD.mkdir(exist_ok=True)
    out = BUILD / spec["html"]
    out.write_text(html, encoding="utf-8")
    print(f"wrote {out.relative_to(ROOT.parent)} ({len(html)} bytes)")


if __name__ == "__main__":
    for source in SOURCES:
        build_one(source)
