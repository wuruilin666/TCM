import io


def lines(p):
    return io.open(p, encoding='utf-8').read().split(chr(10))


def save(p, L):
    io.open(p, 'w', encoding='utf-8', newline='').write(chr(10).join(L))


def find(L, key):
    for i, l in enumerate(L):
        if key in l:
            return i
    raise SystemExit('missing: ' + key)


# js/app.js：删除首页四诊展示模块整段 section
p = 'js/app.js'
L = lines(p)
i = find(L, '<div class="four-diagnosis-hero">') - 1
j = find(L, '<p class="hero-footnote">') + 1
assert '<section>' in L[i] and '</section>' in L[j], (L[i], L[j])
del L[i:j + 1]
save(p, L)
print('app.js lines', len(L))

# css/main.css：删除四诊方块专用样式 + 响应式残留 + 重排 hero 垂直空间
p = 'css/main.css'
L = lines(p)
i = find(L, '/* 四诊方块（首页底部的品牌强化） */')
j = find(L, '.hero-footnote {')
del L[i:j + 1]
if L[i].strip() == '':
    del L[i]
for key in ['.four-diagnosis-hero .cell { height: 96px; }',
            '.four-diagnosis-hero .cell b { font-size: 30px; }',
            '.four-diagnosis-hero { gap: 8px; }']:
    del L[find(L, key)]
L[find(L, '.hero { max-width: 672px;')] = '.hero { max-width: 672px; margin: 0 auto; padding-top: 48px; padding-bottom: 8px; text-align: center; }'
L[find(L, '@media (min-width: 640px) { .hero {')] = '@media (min-width: 640px) { .hero { padding-top: 80px; padding-bottom: 16px; } }'
save(p, L)
print('main.css lines', len(L))
