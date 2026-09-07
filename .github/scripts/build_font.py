import io, os, urllib.request, urllib.parse

CHARS = open('.github/scripts/font_chars.txt', encoding='utf-8').read().strip()
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"}

url = ("https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@400;700&text="
       + urllib.parse.quote(CHARS))
css = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60).read().decode("utf-8")
font_url = css.split("url(")[1].split(")")[0]
data = urllib.request.urlopen(urllib.request.Request(font_url, headers=UA), timeout=120).read()
print("google subset bytes", len(data))

try:
    from fontTools.ttLib import TTFont
    from fontTools import subset
    from fontTools.varLib import instancer

    f = TTFont(io.BytesIO(data))
    keep = sorted({ord(c) for c in CHARS})
    opt = subset.Options()
    opt.layout_features = []
    opt.notdef_outline = True
    opt.drop_tables += ["GSUB", "GPOS", "BASE", "JSTF", "DSIG", "gasp", "prep", "vhea", "vmtx", "HVAR", "STAT", "avar"]
    opt.recalc_bounds = False
    sub = subset.Subsetter(options=opt)
    sub.populate(unicodes=keep)
    sub.subset(f)
    f = instancer.instantiateVariableFont(f, {"wght": (400, 700)}, inplace=True, updateFontNames=False)
    buf = io.BytesIO()
    f.flavor = "woff2"
    f.save(buf)
    data = buf.getvalue()
    print("subset + instanced bytes", len(data))
except Exception as e:
    print("fonttools skipped, use google subset directly:", e)

out = "assets/fonts/NotoSerifSC-VF.woff2"
os.makedirs(os.path.dirname(out), exist_ok=True)
open(out, "wb").write(data)
assert open(out, "rb").read(4) == b"wOF2", "not a woff2 file"
print("written", out, len(data))
