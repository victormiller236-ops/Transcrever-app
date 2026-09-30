"""Diagnóstico único: descobre como cada farmácia responde, para escolher o leitor certo.

Só faz GET/POST de leitura, com pausa entre chamadas. Não altera nada.
"""

import json
import re
import time
import urllib.error
import urllib.request

UA_NAVEGADOR = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/128.0 Safari/537.36"
)
UA_AGENTE = "Mozilla/5.0 (compatible; precos-fralda/1.0; consulta diaria de precos)"

LOJAS = {
    "Drogaria São Paulo": "www.drogariasaopaulo.com.br",
    "Pacheco": "www.drogariaspacheco.com.br",
    "Pague Menos": "www.paguemenos.com.br",
    "Venâncio": "www.drogariavenancio.com.br",
    "Araujo": "www.araujo.com.br",
    "Panvel": "www.panvel.com",
    "Droga Raia": "www.drogaraia.com.br",
    "Catarinense": "www.drogariacatarinense.com.br",
}

PISTAS = ["vtex", "x-vtex", "__RUNTIME__", "__NEXT_DATA__", "magento", "hybris", "shopify",
          "cloudflare", "akamai", "perimeterx", "datadome", "captcha", "just a moment"]


def pedir(url, ua=UA_NAVEGADOR, corpo=None):
    dados = json.dumps(corpo).encode() if corpo is not None else None
    cab = {"User-Agent": ua, "Accept": "application/json,text/html;q=0.9,*/*;q=0.8",
           "Accept-Language": "pt-BR,pt;q=0.9"}
    if dados:
        cab["Content-Type"] = "application/json"
    time.sleep(2)
    try:
        with urllib.request.urlopen(urllib.request.Request(url, data=dados, headers=cab), timeout=30) as r:
            return r.status, dict(r.headers), r.read(400_000).decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read(2_000).decode("utf-8", "replace")
    except Exception as e:  # noqa: BLE001 - diagnóstico: queremos ver qualquer erro
        return 0, {}, f"{type(e).__name__}: {e}"


def resumo(corpo):
    return re.sub(r"\s+", " ", corpo[:220])


def main():
    for nome, dominio in LOJAS.items():
        print(f"\n===== {nome} ({dominio}) =====")
        st, cab, corpo = pedir(f"https://{dominio}/")
        pistas = [p for p in PISTAS if p in corpo.lower() or p in json.dumps(cab).lower()]
        print(f"home: HTTP {st} server={cab.get('Server') or cab.get('server')} pistas={pistas}")
        if st != 200:
            print("  corpo:", resumo(corpo))

        testes = {
            "vtex legado (UA agente)": (f"https://{dominio}/api/catalog_system/pub/products/search?ft=fralda%20pampers&_from=0&_to=9", UA_AGENTE),
            "vtex legado (UA navegador)": (f"https://{dominio}/api/catalog_system/pub/products/search?ft=fralda%20pampers&_from=0&_to=9", UA_NAVEGADOR),
            "vtex legado (sem paginação)": (f"https://{dominio}/api/catalog_system/pub/products/search?ft=fralda%20pampers", UA_NAVEGADOR),
            "vtex legado (/busca/)": (f"https://{dominio}/api/catalog_system/pub/products/search/fralda%20pampers", UA_NAVEGADOR),
            "vtex intelligent-search": (f"https://{dominio}/api/io/_v/api/intelligent-search/product_search/?query=fralda%20pampers&count=5", UA_NAVEGADOR),
        }
        for rotulo, (url, ua) in testes.items():
            st, cab, corpo = pedir(url, ua)
            tipo = cab.get("Content-Type") or cab.get("content-type") or ""
            extra = ""
            if st == 200 and "json" in tipo:
                try:
                    d = json.loads(corpo)
                    lista = d if isinstance(d, list) else d.get("products", [])
                    extra = f" produtos={len(lista)}"
                    if lista:
                        extra += f" 1º={lista[0].get('productName') or lista[0].get('name')!r}"
                except json.JSONDecodeError:
                    extra = " (JSON inválido)"
            print(f"  {rotulo}: HTTP {st} {tipo.split(';')[0]}{extra}" + ("" if st == 200 else f" | {resumo(corpo)}"))


if __name__ == "__main__":
    main()
