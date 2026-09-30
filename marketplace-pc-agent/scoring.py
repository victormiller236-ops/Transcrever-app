"""Extrai specs de anúncios de PC e pontua custo-benefício para jogos."""
import re
from dataclasses import dataclass, field

# (regex, pontos 0-100, nome). Ordem importa: mais específico primeiro.
GPUS = [
    (r"(rtx|geforce)\s*3080", 88, "RTX 3080"),
    (r"(rtx|geforce)\s*4070", 90, "RTX 4070"),
    (r"(rtx|geforce)\s*3070", 78, "RTX 3070"),
    (r"(rtx|geforce)\s*4060\s*ti", 80, "RTX 4060 Ti"),
    (r"(rtx|geforce)\s*4060", 75, "RTX 4060"),
    (r"(rtx|geforce)\s*3060\s*ti", 72, "RTX 3060 Ti"),
    (r"(rtx|geforce)\s*3060", 65, "RTX 3060"),
    (r"(rtx|geforce)\s*3050", 45, "RTX 3050"),
    (r"(rtx|geforce)\s*2070", 66, "RTX 2070"),
    (r"(rtx|geforce)\s*2060\s*super", 60, "RTX 2060 Super"),
    (r"(rtx|geforce)\s*2060", 55, "RTX 2060"),
    (r"(gtx|geforce)\s*1660\s*(super|ti)", 48, "GTX 1660 Super/Ti"),
    (r"(gtx|geforce)\s*1660", 44, "GTX 1660"),
    (r"(gtx|geforce)\s*1650\s*super", 38, "GTX 1650 Super"),
    (r"(gtx|geforce)\s*1650", 30, "GTX 1650"),
    (r"(gtx|geforce)\s*1080", 50, "GTX 1080"),
    (r"(gtx|geforce)\s*1070", 42, "GTX 1070"),
    (r"(gtx|geforce)\s*1060", 32, "GTX 1060"),
    (r"(gtx|geforce)\s*1050\s*ti", 24, "GTX 1050 Ti"),
    (r"(gtx|geforce)\s*(1050|960|750)", 15, "GPU antiga (GTX 1050/960/750)"),
    (r"(rx|radeon)\s*7600", 70, "RX 7600"),
    (r"(rx|radeon)\s*6650\s*xt", 62, "RX 6650 XT"),
    (r"(rx|radeon)\s*6600\s*xt", 62, "RX 6600 XT"),
    (r"(rx|radeon)\s*6600", 58, "RX 6600"),
    (r"(rx|radeon)\s*5700\s*xt", 60, "RX 5700 XT"),
    (r"(rx|radeon)\s*5600\s*xt", 50, "RX 5600 XT"),
    (r"(rx|radeon)\s*5500\s*xt", 36, "RX 5500 XT"),
    (r"(rx|radeon)\s*(590|580)", 40, "RX 580/590"),
    (r"(rx|radeon)\s*(570|560|550)", 30, "RX 570 ou inferior"),
]

CPUS = [
    (r"i5[\s-]*13[46]00", 78, "i5 13400/13600"),
    (r"i5[\s-]*12[46]00", 72, "i5 12400/12600"),
    (r"i5[\s-]*11[46]00", 60, "i5 11400/11600"),
    (r"i5[\s-]*10[46]00", 55, "i5 10400/10600"),
    (r"i5[\s-]*9[46]00", 48, "i5 9400/9600"),
    (r"i5[\s-]*8[46]00", 42, "i5 8400/8600"),
    (r"i3[\s-]*1[23]100", 55, "i3 12100"),
    (r"i3[\s-]*10100", 40, "i3 10100"),
    (r"i7[\s-]*9700", 55, "i7 9700"),
    (r"i7[\s-]*8700", 52, "i7 8700"),
    (r"i7[\s-]*7700", 34, "i7 7700"),
    (r"i5[\s-]*7[46]00", 30, "i5 7400/7600"),
    (r"i[357][\s-]*[2-6]\d{3}", 15, "Intel antigo (2ª-6ª gen)"),
    (r"ryzen\s*7\s*5800x", 85, "Ryzen 7 5800X"),
    (r"ryzen\s*7\s*5700x", 80, "Ryzen 7 5700X"),
    (r"ryzen\s*7\s*3700x", 68, "Ryzen 7 3700X"),
    (r"ryzen\s*5\s*5600(x|g)?\b", 70, "Ryzen 5 5600"),
    (r"ryzen\s*5\s*5500", 60, "Ryzen 5 5500"),
    (r"ryzen\s*5\s*3600", 58, "Ryzen 5 3600"),
    (r"ryzen\s*5\s*2600", 42, "Ryzen 5 2600"),
    (r"ryzen\s*5\s*1600", 35, "Ryzen 5 1600"),
    (r"ryzen\s*3", 30, "Ryzen 3"),
    (r"fx[\s-]*\d{4}", 15, "AMD FX"),
]

RED_FLAGS = [
    (r"s[óo]\s+(o\s+)?gabinete|sem\s+(placa|gpu|v[íi]deo)|v[íi]deo\s+integrado", "sem placa de vídeo dedicada"),
    (r"defeito|n[ãa]o\s+(liga|funciona)|para\s+retirada\s+de\s+pe[çc]as|queimad", "pode estar com defeito"),
    (r"sinal|pix\s+antecipado|deposito\s+antes|pago\s+antes", "pede pagamento antecipado"),
    (r"envio\s+pelos\s+correios|entrego\s+pelos\s+correios|s[óo]\s+envio", "só envio (risco de golpe)"),
    (r"aceito\s+troca|troco\s+por", "aceita troca (preço talvez inflado)"),
    (r"whats(app)?[^\n]{0,20}\d{4}", "empurra pro WhatsApp"),
]


@dataclass
class Analysis:
    gpu: str = "?"
    gpu_pts: int = 0
    cpu: str = "?"
    cpu_pts: int = 0
    ram_gb: int = 0
    ssd: bool = False
    flags: list = field(default_factory=list)
    score: float = 0.0


def parse_price(text: str):
    m = re.search(r"R\$\s*([\d.]+(?:,\d{2})?)", text)
    if not m:
        return None
    return float(m.group(1).replace(".", "").replace(",", "."))


def _first(patterns, text):
    for rx, pts, name in patterns:
        if re.search(rx, text):
            return name, pts
    return "?", 0


def analyze(text: str, price: float | None) -> Analysis:
    t = text.lower()
    a = Analysis()
    a.gpu, a.gpu_pts = _first(GPUS, t)
    a.cpu, a.cpu_pts = _first(CPUS, t)

    rams = [int(x) for x in re.findall(r"(\d{1,3})\s*gb\s*(?:de\s*)?(?:mem[óo]ria\s*)?(?:ram|ddr\d?)", t)]
    rams += [int(x) for x in re.findall(r"(?:ram|mem[óo]ria)[^\d\n]{0,12}(\d{1,3})\s*gb", t)]
    a.ram_gb = max([r for r in rams if r in (4, 8, 12, 16, 24, 32, 64)], default=0)
    a.ssd = bool(re.search(r"\bssd\b|nvme|m\.2", t))

    for rx, label in RED_FLAGS:
        if re.search(rx, t):
            a.flags.append(label)
    if price is not None and price < 700:
        a.flags.append("preço baixo demais para PC gamer")
    if a.gpu == "?":
        a.flags.append("GPU não identificada")

    ram_pts = {0: 0, 4: 0, 8: 3, 12: 6, 16: 10, 24: 11, 32: 12, 64: 12}[a.ram_gb]
    a.score = round(a.gpu_pts * 0.6 + a.cpu_pts * 0.25 + ram_pts + (5 if a.ssd else 0), 1)
    return a
