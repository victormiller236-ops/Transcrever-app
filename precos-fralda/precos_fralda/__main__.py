"""Busca os menores preços de fralda nas farmácias configuradas.

Uso: python -m precos_fralda [--config config.toml] [--saida saida/]
"""

import argparse
import csv
import datetime as dt
import sys
import tomllib
from dataclasses import dataclass
from pathlib import Path

from . import texto, vtex


@dataclass
class Resultado:
    oferta: vtex.Oferta
    quantidade: int

    @property
    def preco_por_fralda(self) -> float:
        return self.oferta.preco / self.quantidade


def reais(valor: float) -> str:
    return f"R$ {valor:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def coletar(config: dict, log) -> tuple[dict, list[str], dict]:
    geral = config.get("geral", {})
    http = vtex.Http(
        pausa=geral.get("pausa_segundos", 3),
        tentativas=geral.get("tentativas", 4),
        timeout=geral.get("timeout_segundos", 30),
    )
    excluir_global = geral.get("excluir", [])
    resultados = {p["nome"]: [] for p in config["produtos"]}
    descartes = {p["nome"]: 0 for p in config["produtos"]}
    falhas = []

    for loja in config["lojas"]:
        for produto in config["produtos"]:
            termos = produto.get("termos", [])
            excluir = excluir_global + produto.get("excluir", [])
            try:
                ofertas = vtex.buscar(
                    http, loja["nome"], loja["dominio"], produto["busca"], geral.get("paginas", 3)
                )
            except RuntimeError as e:
                falhas.append(f"{loja['nome']} / {produto['nome']}: busca falhou ({e})")
                continue
            log(f"{loja['nome']} / {produto['nome']}: {len(ofertas)} ofertas no catálogo")

            vistos = set()
            for oferta in ofertas:
                chave = (oferta.sku_id, oferta.seller_id)
                if chave in vistos or not texto.corresponde(oferta.nome, termos, excluir):
                    continue
                vistos.add(chave)
                tamanho = texto.extrair_tamanho(oferta.nome)
                quantidade = texto.extrair_quantidade(oferta.nome)
                if tamanho is None or quantidade is None:
                    descartes[produto["nome"]] += 1
                    log(f"  descartado (tamanho/quantidade ambíguos): {oferta.nome}")
                    continue
                if tamanho != produto["tamanho"].upper():
                    continue
                try:
                    oferta.preco_confirmado = vtex.confirmar_preco(http, loja["dominio"], oferta)
                except RuntimeError as e:
                    log(f"  simulação falhou, fica o preço do catálogo: {oferta.nome} ({e})")
                else:
                    if oferta.preco_confirmado is None:
                        log(f"  indisponível no checkout: {oferta.nome}")
                        continue
                resultados[produto["nome"]].append(Resultado(oferta, quantidade))
    return resultados, falhas, descartes


def relatorio_md(resultados, falhas, descartes, config, agora) -> str:
    top = config.get("geral", {}).get("top", 10)
    linhas = [f"# Preços de fralda — {agora:%d/%m/%Y %H:%M} (horário de Brasília)", ""]
    linhas.append(
        "Preço do produto no checkout de cada loja, **sem frete**. "
        "Ordenado por preço por fralda. ✔ = preço confirmado na simulação de carrinho; "
        "⚠ = só preço de catálogo (simulação falhou)."
    )
    linhas.append("")
    for nome, lista in resultados.items():
        linhas.append(f"## {nome}")
        linhas.append("")
        if not lista:
            linhas.append("_Nenhuma oferta encontrada._")
        else:
            linhas.append("| # | Loja | Produto | Fraldas | Preço | R$/fralda | Conf. |")
            linhas.append("|---|---|---|---:|---:|---:|---|")
            for i, r in enumerate(sorted(lista, key=lambda r: r.preco_por_fralda)[:top], 1):
                o = r.oferta
                vendedor = f" (vendido por {o.seller_nome})" if o.seller_id != "1" and o.seller_nome else ""
                marca = "✔" if o.preco_confirmado is not None else "⚠"
                linhas.append(
                    f"| {i} | {o.loja}{vendedor} | [{o.nome}]({o.url}) | {r.quantidade} | "
                    f"{reais(o.preco)} | {reais(r.preco_por_fralda)} | {marca} |"
                )
        if descartes[nome]:
            linhas.append("")
            linhas.append(
                f"_{descartes[nome]} oferta(s) ignoradas porque o nome não deixa claro o tamanho "
                "ou a quantidade (kits, combos, tamanhos combinados)._"
            )
        linhas.append("")
    if falhas:
        linhas.append("## Falhas")
        linhas.append("")
        linhas.extend(f"- {f}" for f in falhas)
        linhas.append("")
    return "\n".join(linhas)


def salvar_csv(caminho: Path, resultados, agora):
    with caminho.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(
            ["data", "produto", "loja", "vendedor", "nome", "fraldas", "preco",
             "preco_confirmado", "preco_por_fralda", "url"]
        )
        for nome, lista in resultados.items():
            for r in sorted(lista, key=lambda r: r.preco_por_fralda):
                o = r.oferta
                w.writerow(
                    [agora.isoformat(timespec="minutes"), nome, o.loja, o.seller_nome, o.nome,
                     r.quantidade, f"{o.preco:.2f}", "sim" if o.preco_confirmado is not None else "nao",
                     f"{r.preco_por_fralda:.4f}", o.url]
                )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", default=Path(__file__).parent.parent / "config.toml", type=Path)
    parser.add_argument("--saida", default=Path("saida"), type=Path)
    args = parser.parse_args()

    config = tomllib.loads(args.config.read_text(encoding="utf-8"))
    agora = dt.datetime.now(dt.timezone(dt.timedelta(hours=-3)))
    log = lambda msg: print(msg, file=sys.stderr, flush=True)

    resultados, falhas, descartes = coletar(config, log)
    args.saida.mkdir(parents=True, exist_ok=True)
    md = relatorio_md(resultados, falhas, descartes, config, agora)
    (args.saida / "relatorio.md").write_text(md, encoding="utf-8")
    salvar_csv(args.saida / "precos.csv", resultados, agora)
    print(md)

    lojas_ok = {r.oferta.loja for lista in resultados.values() for r in lista}
    if not lojas_ok:
        log("Nenhuma loja retornou ofertas válidas.")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
