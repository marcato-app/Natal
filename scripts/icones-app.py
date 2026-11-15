"""Gera ícones e telas de abertura do app (Android e iOS) a partir de resources/.

    python3 scripts/icones-app.py

resources/icon-only.png (1024, ícone inteiro), resources/icon-foreground.png (1024,
árvore com fundo transparente pro ícone adaptativo do Android) e resources/splash.png
(2732x2732) são desenhados a partir de assets/icones/icone.svg.
"""
from pathlib import Path
from PIL import Image

RAIZ = Path(__file__).resolve().parent.parent
RES = RAIZ / 'resources'
AND = RAIZ / 'android/app/src/main/res'
IOS = RAIZ / 'ios/App/App/Assets.xcassets'
FUNDO = '#0b1533'

icone = Image.open(RES / 'icon-only.png').convert('RGBA')
frente = Image.open(RES / 'icon-foreground.png').convert('RGBA')
splash = Image.open(RES / 'splash.png').convert('RGB')


def redondo(img):
    m = Image.new('L', img.size, 0)
    from PIL import ImageDraw
    ImageDraw.Draw(m).ellipse((0, 0, img.size[0] - 1, img.size[1] - 1), fill=255)
    out = Image.new('RGBA', img.size, (0, 0, 0, 0))
    out.paste(img, (0, 0), m)
    return out


def cortar(img, w, h):
    """Preenche w x h cortando as sobras (mantém o centro)."""
    escala = max(w / img.width, h / img.height)
    r = img.resize((round(img.width * escala), round(img.height * escala)), Image.LANCZOS)
    x, y = (r.width - w) // 2, (r.height - h) // 2
    return r.crop((x, y, x + w, y + h))


# Android: ícone legado, redondo e primeiro plano adaptativo
for pasta, lado in {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}.items():
    d = AND / f'mipmap-{pasta}'
    ic = icone.resize((lado, lado), Image.LANCZOS)
    ic.save(d / 'ic_launcher.png')
    redondo(ic).save(d / 'ic_launcher_round.png')
    fg = round(lado * 108 / 48)
    frente.resize((fg, fg), Image.LANCZOS).save(d / 'ic_launcher_foreground.png')
(AND / 'values/ic_launcher_background.xml').write_text(
    f'<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">{FUNDO.upper()}</color>\n</resources>\n')

# Android: telas de abertura (mesmo tamanho dos arquivos do modelo do Capacitor)
for arq in AND.glob('drawable*/splash.png'):
    w, h = Image.open(arq).size
    cortar(splash, w, h).save(arq)

# iOS: ícone único 1024 (sem transparência) e telas de abertura
icone.convert('RGB').save(IOS / 'AppIcon.appiconset/AppIcon-512@2x.png')
for arq in (IOS / 'Splash.imageset').glob('*.png'):
    splash.save(arq)

print('ícones e telas de abertura gerados')
