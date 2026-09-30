"""Cliente para lojas na plataforma VTEX (a maioria das grandes farmácias on-line).

Dois passos por produto:
1. Busca no catálogo público (`/api/catalog_system/pub/products/search`).
2. Confirmação do preço na simulação de carrinho
   (`/api/checkout/pub/orderForms/simulation`), sem CEP. Sem CEP não há cálculo
   de entrega, então o valor devolvido é só o preço do item, sem frete. É o
   preço que o checkout cobraria, incluindo promoções que o catálogo às vezes
   não mostra.
"""

import json
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass

USER_AGENT = "Mozilla/5.0 (compatible; precos-fralda/1.0; consulta diaria de precos)"
TAMANHO_PAGINA = 10  # 50 (o máximo documentado) deu HTTP 400 nas lojas reais; 10 foi verificado em todas


@dataclass
class Oferta:
    loja: str
    produto_id: str
    sku_id: str
    seller_id: str
    seller_nome: str
    nome: str
    preco_catalogo: float
    preco_lista: float
    url: str
    preco_confirmado: float | None = None

    @property
    def preco(self) -> float:
        return self.preco_confirmado if self.preco_confirmado is not None else self.preco_catalogo


class Http:
    def __init__(self, pausa: float, tentativas: int, timeout: float):
        self.pausa = pausa
        self.tentativas = tentativas
        self.timeout = timeout

    def json(self, url: str, corpo: dict | None = None):
        dados = json.dumps(corpo).encode() if corpo is not None else None
        cabecalhos = {"User-Agent": USER_AGENT, "Accept": "application/json"}
        if dados is not None:
            cabecalhos["Content-Type"] = "application/json"
        ultimo_erro = None
        for tentativa in range(self.tentativas):
            time.sleep(self.pausa * (2**tentativa))
            req = urllib.request.Request(url, data=dados, headers=cabecalhos)
            try:
                with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                    return json.loads(resp.read().decode("utf-8"))
            except urllib.error.HTTPError as e:
                corpo_erro = e.read(300).decode("utf-8", "replace").replace("\n", " ").strip()
                ultimo_erro = f"{e} — {corpo_erro}" if corpo_erro else e
                # 4xx (exceto 429) não melhora tentando de novo
                if 400 <= e.code < 500 and e.code != 429:
                    break
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
                ultimo_erro = e
        raise RuntimeError(f"{url}: {ultimo_erro}")


def url_busca(dominio: str, termo: str, inicio: int) -> str:
    # %20 (e não "+") para o espaço: é o formato verificado nas lojas reais
    ft = urllib.parse.quote(termo, safe="")
    return (
        f"https://{dominio}/api/catalog_system/pub/products/search"
        f"?ft={ft}&_from={inicio}&_to={inicio + TAMANHO_PAGINA - 1}"
    )


def buscar(http: Http, loja: str, dominio: str, termo: str, paginas: int) -> tuple[list[Oferta], bool]:
    """Devolve (ofertas, truncado). truncado=True quando o limite de páginas
    foi atingido e pode haver mais produtos que não foram lidos."""
    ofertas = []
    for pagina in range(paginas):
        produtos = http.json(url_busca(dominio, termo, pagina * TAMANHO_PAGINA))
        ofertas.extend(ofertas_do_catalogo(loja, produtos))
        if len(produtos) < TAMANHO_PAGINA:
            return ofertas, False
    return ofertas, True


def ofertas_do_catalogo(loja: str, produtos: list[dict]) -> list[Oferta]:
    ofertas = []
    for produto in produtos:
        for item in produto.get("items", []):
            nome = item.get("nameComplete") or produto.get("productName") or item.get("name", "")
            for seller in item.get("sellers", []):
                oferta = seller.get("commertialOffer") or {}
                preco = oferta.get("Price") or 0
                if preco <= 0 or not oferta.get("AvailableQuantity"):
                    continue
                ofertas.append(
                    Oferta(
                        loja=loja,
                        produto_id=str(produto.get("productId", "")),
                        sku_id=str(item.get("itemId", "")),
                        seller_id=str(seller.get("sellerId", "1")),
                        seller_nome=seller.get("sellerName", ""),
                        nome=nome,
                        preco_catalogo=float(preco),
                        preco_lista=float(oferta.get("ListPrice") or preco),
                        url=produto.get("link", ""),
                    )
                )
    return ofertas


def confirmar_preco(http: Http, dominio: str, oferta: Oferta) -> float | None:
    """Preço unitário do item no checkout (sem CEP, logo sem frete). None se indisponível."""
    corpo = {
        "items": [{"id": oferta.sku_id, "quantity": 1, "seller": oferta.seller_id}],
        "country": "BRA",
    }
    resposta = http.json(f"https://{dominio}/api/checkout/pub/orderForms/simulation", corpo)
    return preco_da_simulacao(resposta)


def preco_da_simulacao(resposta: dict) -> float | None:
    itens = resposta.get("items") or []
    if len(itens) != 1:
        return None
    item = itens[0]
    if item.get("availability") not in (None, "available"):
        return None
    centavos = item.get("sellingPrice")
    if centavos is None:
        centavos = item.get("price")
    if not centavos:
        return None
    return centavos / 100
