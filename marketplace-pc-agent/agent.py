"""Agente que busca PCs gamer até R$ 3.000 no Marketplace do Facebook.

Uso:
  python agent.py login                 # 1x: abre o navegador, você loga manualmente
  python agent.py search --cidade saopaulo --max-preco 3000
"""
import argparse
import csv
import json
import random
import re
import time
from pathlib import Path

from scoring import analyze, parse_price

HERE = Path(__file__).parent
PROFILE = HERE / ".browser-profile"   # sessão do Facebook fica só na sua máquina
SEEN = HERE / "seen.json"
QUERIES = ["pc gamer", "computador gamer", "pc gamer rtx", "pc gamer ryzen"]


def pause(a=1.5, b=3.5):
    time.sleep(random.uniform(a, b))


def launch(p, headless):
    return p.chromium.launch_persistent_context(
        str(PROFILE), headless=headless, locale="pt-BR", viewport={"width": 1280, "height": 900}
    )


def cmd_login(_):
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        ctx = launch(p, headless=False)
        page = ctx.new_page()
        page.goto("https://www.facebook.com/marketplace")
        input("Faça login no navegador e, depois, pressione Enter aqui... ")
        ctx.close()


def collect(page, cidade, query, max_preco, scrolls):
    url = (f"https://www.facebook.com/marketplace/{cidade}/search?query={query.replace(' ', '%20')}"
           f"&maxPrice={int(max_preco)}&sortBy=creation_time_descend&exact=false")
    page.goto(url)
    page.wait_for_timeout(4000)
    if "login" in page.url:
        raise SystemExit("Sessão expirada: rode `python agent.py login` de novo.")
    for _ in range(scrolls):
        page.mouse.wheel(0, 3000)
        pause(2, 4)
    raw = page.eval_on_selector_all(
        'a[href*="/marketplace/item/"]', "els => els.map(e => ({href: e.href, text: e.innerText}))")
    out = {}
    for r in raw:
        m = re.search(r"/marketplace/item/(\d+)", r["href"])
        if not m:
            continue
        lines = [l.strip() for l in r["text"].splitlines() if l.strip()]
        price = next((parse_price(l) for l in lines if "R$" in l), None)
        title = next((l for l in lines if "R$" not in l), "")
        out[m.group(1)] = {"id": m.group(1), "url": f"https://www.facebook.com/marketplace/item/{m.group(1)}/",
                           "title": title, "price": price, "card": " ".join(lines)}
    return out


def cmd_search(a):
    from playwright.sync_api import sync_playwright
    seen = set(json.loads(SEEN.read_text())) if SEEN.exists() and not a.tudo else set()
    found = {}
    with sync_playwright() as p:
        ctx = launch(p, a.headless)
        page = ctx.new_page()
        for q in QUERIES:
            print(f"Buscando: {q}")
            found.update(collect(page, a.cidade, q, a.max_preco, a.scrolls))
            pause(4, 8)
        cands = [x for x in found.values()
                 if x["id"] not in seen and x["price"] is not None and x["price"] <= a.max_preco]
        # pré-triagem pelo card; só abre o anúncio inteiro dos mais promissores
        cands.sort(key=lambda x: -analyze(x["card"], x["price"]).score)
        for item in cands[:a.max_detalhes]:
            try:
                page.goto(item["url"])
                page.wait_for_timeout(3000)
                item["full"] = page.inner_text("body")[:6000]
            except Exception as e:  # noqa: BLE001
                item["full"] = ""
                print(f"  falha em {item['url']}: {e}")
            pause(3, 6)
        ctx.close()

    rows = []
    for item in cands:
        an = analyze(item.get("full") or item["card"], item["price"])
        rows.append({**item, "an": an, "valor": round(an.score / (item["price"] / 1000), 1)})
    rows = [r for r in rows if r["an"].gpu_pts > 0]
    rows.sort(key=lambda r: (bool(r["an"].flags), -r["valor"]))

    print(f"\n{len(rows)} PCs com GPU identificada (de {len(cands)} anúncios novos)\n")
    for r in rows[:a.top]:
        an = r["an"]
        print(f"R$ {r['price']:.0f} | {an.gpu} + {an.cpu} | {an.ram_gb or '?'}GB RAM"
              f"{' + SSD' if an.ssd else ''} | nota {an.score} | valor {r['valor']}")
        print(f"  {r['title']}\n  {r['url']}")
        if an.flags:
            print(f"  ⚠ {', '.join(an.flags)}")
    with open(HERE / "resultados.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["preco", "gpu", "cpu", "ram_gb", "ssd", "nota", "valor", "alertas", "titulo", "url"])
        for r in rows:
            an = r["an"]
            w.writerow([r["price"], an.gpu, an.cpu, an.ram_gb, an.ssd, an.score, r["valor"],
                        "; ".join(an.flags), r["title"], r["url"]])
    SEEN.write_text(json.dumps(sorted(seen | {c["id"] for c in cands})))
    print("\nSalvo em resultados.csv")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(required=True)
    sub.add_parser("login").set_defaults(fn=cmd_login)
    s = sub.add_parser("search")
    s.add_argument("--cidade", default="saopaulo", help="slug da cidade no Marketplace")
    s.add_argument("--max-preco", type=float, default=3000)
    s.add_argument("--scrolls", type=int, default=4)
    s.add_argument("--max-detalhes", type=int, default=25)
    s.add_argument("--top", type=int, default=15)
    s.add_argument("--tudo", action="store_true", help="ignora anúncios já vistos")
    s.add_argument("--headless", action="store_true")
    s.set_defaults(fn=cmd_search)
    args = ap.parse_args()
    args.fn(args)
