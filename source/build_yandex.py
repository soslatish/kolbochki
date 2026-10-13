"""Builds the Yandex Games upload archive from index.html.

- wraps the page in a full HTML document
- connects the Yandex Games SDK via the relative path /sdk.js (required for archives uploaded through the console)
- replaces Google Fonts with font files bundled inside the archive
"""
import re, shutil, zipfile, pathlib, sys

SRC = pathlib.Path(__file__).with_name('index.html')
FONTS = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else pathlib.Path(__file__).with_name('fonts')
OUT = pathlib.Path(__file__).parent.parent / 'build' / 'yandex-build'
ZIP = pathlib.Path(__file__).parent.parent / 'build' / 'kolbochki-yandex.zip'

CYR = 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116'
LAT = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD'
FACES = [('Unbounded', 'unbounded', [600, 800]), ('Nunito', 'nunito', [700, 800, 900])]

shutil.rmtree(OUT, ignore_errors=True)
(OUT / 'fonts').mkdir(parents=True)
ZIP.parent.mkdir(parents=True, exist_ok=True)
css = []
for family, slug, weights in FACES:
    for wgt in weights:
        for subset, rng in (('cyrillic', CYR), ('latin', LAT)):
            name = f'{slug}-{subset}-{wgt}-normal.woff2'
            shutil.copy(FONTS / name, OUT / 'fonts' / name)
            css.append(f"@font-face{{font-family:'{family}';font-style:normal;font-weight:{wgt};font-display:swap;src:url(fonts/{name}) format('woff2');unicode-range:{rng}}}")

page = SRC.read_text(encoding='utf-8')
page = re.sub(r'<!--FONTS-->.*?<!--/FONTS-->', '', page, flags=re.S)
page = page.replace('  window.__kolb = {', '  if (0) window.__kolb = {')
title = re.search(r'<title>.*?</title>', page).group(0)
page = page.replace(title, '', 1)

doc = f"""<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no">
{title}
<script src="/sdk.js"></script>
<style>{''.join(css)}[hidden]{{display:none!important}}img{{max-width:100%}}</style>
</head>
<body>
{page}
</body>
</html>
"""
# LF on every OS, so rebuilding on Windows gives the same bytes
(OUT / 'index.html').write_text(doc, encoding='utf-8', newline='\n')

ZIP.unlink(missing_ok=True)
with zipfile.ZipFile(ZIP, 'w', zipfile.ZIP_DEFLATED) as z:
    for p in sorted(OUT.rglob('*')):
        if p.is_file():
            z.write(p, p.relative_to(OUT).as_posix())
print('built', ZIP, ZIP.stat().st_size, 'bytes')
