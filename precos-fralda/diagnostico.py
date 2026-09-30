"""Diagnóstico único das lojas que não usam a API VTEX padrão (Araujo, Panvel, Droga Raia).

Identifica-se sempre como o agente (sem fingir ser navegador), lê o robots.txt e
faz poucas requisições GET. Se a loja responder 403, o diagnóstico só registra:
não há tentativa de contornar a proteção.
"""

import re
import time
import urllib.error
import urllib.request

UA = "Mozilla/5.0 (compatible; precos-fralda/1.0; consulta diaria de precos)"

LOJAS = {
    "Araujo": ("www.araujo.com.br", ["/busca?q=fralda%20pampers", "/fralda%20pampers"]),
    "Panvel": ("www.panvel.com", ["/panvel/buscarProduto.do?termoPesquisa=fralda%20pampers"]),
    "Droga Raia": ("www.drogaraia.com.br", ["/search?w=fralda%20pampers"]),
}


def pedir(url):
    time.sleep(2)
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "pt-BR,pt;q=0.9"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.headers.get("Content-Type", ""), r.read(600_000).decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.headers.get("Content-Type", ""), e.read(1_500).decode("utf-8", "replace")
    except Exception as e:  # noqa: BLE001 - diagnóstico
        return 0, "", f"{type(e).__name__}: {e}"


def curto(texto, n=200):
    return re.sub(r"\s+", " ", texto[:n])


def main():
    for nome, (dominio, caminhos) in LOJAS.items():
        print(f"\n===== {nome} ({dominio}) =====")
        st, tipo, corpo = pedir(f"https://{dominio}/robots.txt")
        regras = [l for l in corpo.splitlines() if re.match(r"(?i)\s*(user-agent|disallow)\s*:", l)][:12]
        print(f"robots.txt: HTTP {st}", regras if st == 200 else curto(corpo))
        for caminho in caminhos:
            st, tipo, corpo = pedir(f"https://{dominio}{caminho}")
            marcas = {
                "__NEXT_DATA__": "__NEXT_DATA__" in corpo,
                "ld+json": "application/ld+json" in corpo,
                "preços 'R$'": corpo.count("R$"),
                "fralda": corpo.lower().count("fralda"),
                "access denied": "access denied" in corpo.lower(),
            }
            print(f"{caminho}: HTTP {st} {tipo.split(';')[0]} tamanho={len(corpo)} {marcas}")
            if st != 200:
                print("   ", curto(corpo))


if __name__ == "__main__":
    main()
