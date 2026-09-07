import io

P = 'css/main.css'
s = io.open(P, encoding='utf-8').read()


def rep(old, new):
    global s
    assert old in s, 'NOT FOUND: ' + old[:60]
    s = s.replace(old, new, 1)


UR = ("U+0020, U+0025, U+0030-0039, U+00b7, U+4e00, U+4e09, U+4e2a, U+4e2d, U+4e34, U+4e3b, U+4e48, U+4e60, U+4e8c, U+4e8e, U+4ea4, U+4eba, U+4ece, U+4ef6, U+4efd, U+4f7f, U+4f8b, U+4fdd, U+504f, U+5165, U+5173, U+518c, U+51b5, U+5206-5207, U+5224, U+533b, U+5361, U+5408, U+56db, U+56de, U+5907, U+590d, U+5927, U+59cb, U+5b58, U+5b66, U+5b8c, U+5dee, U+5df2, U+5e8a, U+5e93, U+5ea6, U+5f00, U+600e, U+601d, U+6062, U+6210-6211, U+6253, U+6295, U+62e9, U+636e, U+63a2, U+63a5, U+63a8, U+63d0, U+63ed, U+6570, U+6574, U+6587, U+65ad, U+65e0, U+6653, U+6682, U+671b, U+672c, U+6790, U+67e5, U+6848, U+6982, U+6b63, U+6cd5, U+6f14, U+73a9, U+7528, U+75c5, U+7684, U+7801, U+786e, U+7a3f, U+7d22, U+7ebf, U+7ec3, U+7ef4, U+7efc, U+7f6e, U+8109, U+820c, U+89e3, U+8bad, U+8bc1, U+8bc9-8bca, U+8c1c, U+8c61, U+8f83, U+8fa8, U+8fd4, U+8fdb, U+9009, U+90e8, U+91cd, U+9519, U+95e8, U+95ee, U+95fb, U+9762, U+9875, U+9898, U+9986, U+9996")

# 1) 自托管中文衬线 Web Font（思源宋体可变字体子集）
rep("   ===================================================================== */\n\n:root {",
    "   ===================================================================== */\n\n"
    "/* 中文衬线：思源宋体 Noto Serif SC 可变字体子集（wght 400-700），自托管于 assets/fonts/。\n"
    "   只收录本站中文标题用字（主标题 / 页面标题 / 品牌名 / 四诊 / 章节标题），\n"
    "   未收录的字符自动回退系统衬线；正文与界面文字仍走无衬线的 --font-body。 */\n"
    "@font-face {\n"
    '    font-family: "Noto Serif SC Web";\n'
    '    src: url("../assets/fonts/NotoSerifSC-VF.woff2") format("woff2");\n'
    "    font-weight: 400 700;\n"
    "    font-style: normal;\n"
    "    font-display: swap;\n"
    "    unicode-range: " + UR + ";\n"
    "}\n\n:root {")

# 2) 标题字体栈：Web Font 优先；另给动态长文本留一套纯系统衬线
rep('    --font-heading: "Noto Serif SC", "Songti SC", "STSong", "Noto Serif CJK SC", "SimSun", serif;',
    '    --font-heading: "Noto Serif SC Web", "Noto Serif SC", "Songti SC", "STSong", "Noto Serif CJK SC", "SimSun", serif;\n'
    '    /* 主诉、输入框等动态长文本用：不走 Web Font 子集，避免衬线 / 无衬线在同一段里混排 */\n'
    '    --font-serif-sys: "Songti SC", "STSong", "Noto Serif CJK SC", "Source Han Serif SC", "SimSun", serif;')

# 3) 移除右上 / 左下装饰圆环
rep("/* 右上 / 左下 装饰圆环（对应解压文件的 fixed 圆环） */\n"
    "body::before {\n"
    "    content: ''; position: fixed; top: -96px; right: -96px;\n"
    "    width: 320px; height: 320px; border-radius: 50%;\n"
    "    border: 1px solid rgba(58, 42, 34, 0.06); pointer-events: none; z-index: 0;\n"
    "}\n"
    "body::after {\n"
    "    content: ''; position: fixed; bottom: -80px; left: -112px;\n"
    "    width: 288px; height: 288px; border-radius: 50%;\n"
    "    border: 1px solid rgba(156, 43, 27, 0.08); pointer-events: none; z-index: 0;\n"
    "}",
    "/* 右上 / 左下 装饰圆环已移除：移动端会被误认为屏幕异常 */")

# 4) 首页信息层级：主标题 > subtitle > desc > 主 CTA > 次级导航
rep(".hero-title {\n"
    "    font-family: var(--font-heading); font-weight: 700;\n"
    "    font-size: 1.85rem; letter-spacing: 0.08em; line-height: 1.3; color: var(--ink);\n"
    "}\n"
    ".hero-subtitle { margin-top: 20px; font-size: 16px; line-height: 1.7; color: var(--ink-muted); }\n"
    ".hero-desc { margin-top: 12px; font-size: 14px; letter-spacing: 0.2em; color: var(--ink-faint); }\n"
    ".home-buttons { margin-top: 48px; display: flex; flex-direction: column; align-items: center; gap: 16px; }\n"
    ".home-secondary { display: flex; gap: 16px; align-items: center; font-size: 14px; color: var(--ink-muted); }\n"
    ".home-secondary a { color: var(--ink-muted); text-decoration: none; }\n"
    ".home-secondary a:hover { color: var(--ink); }\n"
    ".home-secondary .dot { color: var(--ink-faint); }",
    "/* mobile-first：主标题是全页第一视觉焦点，次级导航弱但明确可点 */\n"
    ".hero-title {\n"
    "    font-family: var(--font-heading); font-weight: 700;\n"
    "    font-size: clamp(2.15rem, 9vw, 2.8rem); line-height: 1.25;\n"
    "    letter-spacing: 0.08em; color: var(--ink);\n"
    "}\n"
    ".hero-subtitle { margin-top: 18px; font-size: 15px; line-height: 1.7; color: var(--ink-muted); }\n"
    ".hero-desc { margin-top: 10px; font-size: 13px; letter-spacing: 0.18em; color: var(--ink-faint); }\n"
    ".home-buttons { margin-top: 40px; display: flex; flex-direction: column; align-items: center; gap: 12px; }\n"
    ".home-secondary { display: flex; gap: 12px; align-items: center; font-size: 14px; color: var(--ink-muted); }\n"
    ".home-secondary a {\n"
    "    display: inline-flex; align-items: center; justify-content: center;\n"
    "    min-height: 40px; padding: 0 10px;\n"
    "    color: var(--ink-muted); text-decoration: none;\n"
    "    letter-spacing: 0.14em; border-radius: var(--radius-sm);\n"
    "    border-bottom: 1px solid var(--hairline-strong);\n"
    "    transition: color 0.15s, border-color 0.15s, background-color 0.15s;\n"
    "}\n"
    ".home-secondary a:hover { color: var(--ink); border-bottom-color: var(--cinnabar); }\n"
    ".home-secondary a:active { color: var(--cinnabar); background: var(--cinnabar-soft); }\n"
    ".home-secondary .dot { color: var(--ink-faint); }")

# 5) 桌面端保持原有节奏
rep("    .hero-subtitle { font-size: 18px; }",
    "    .hero-subtitle { margin-top: 20px; font-size: 18px; }\n"
    "    .hero-desc { font-size: 14px; letter-spacing: 0.2em; }\n"
    "    .home-buttons { margin-top: 48px; }")

# 6) 主诉（动态长文本）用系统衬线，避免与 Web Font 子集混排
rep("    margin-top: 16px; font-family: var(--font-heading); font-size: 20px; line-height: 1.7;",
    "    margin-top: 16px; font-family: var(--font-serif-sys); font-size: 20px; line-height: 1.7;")

io.open(P, 'w', encoding='utf-8', newline='').write(s)
print('patched', P, len(s))
