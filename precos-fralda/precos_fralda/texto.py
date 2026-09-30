"""Leitura do nome do produto: tamanho, quantidade de fraldas e filtros.

Regra geral: na dúvida, devolve None. Um produto com tamanho ou quantidade
ambíguos fica fora do ranking (e é contado no relatório como descartado), em
vez de entrar com um preço por fralda possivelmente errado.
"""

import re
import unicodedata

TAMANHOS = {
    "rn": "RN",
    "p": "P",
    "m": "M",
    "g": "G",
    "xg": "XG",
    "eg": "XG",
    "xxg": "XXG",
    "exg": "XXG",
    "xxxg": "XXXG",
}

_RE_TAMANHO = re.compile(r"(?<![\w/])(" + "|".join(sorted(TAMANHOS, key=len, reverse=True)) + r")(?![\w/])")
_RE_TAMANHO_COMBINADO = re.compile(r"\b(rn|p|m|g|xg|xxg|xxxg)\s*/\s*(rn|p|m|g|xg|xxg|xxxg)\b")

_RE_LEVE_PAGUE = re.compile(r"\bleve\s+(\d{1,3})\b")
_RE_QUANTIDADE = [
    re.compile(r"\b(\d{1,3})\s*(?:unidades|unidade|unids?|unds?|un|u|tiras|fraldas)\b"),
    re.compile(r"(?:\bc/|\bcom\b)\s*(\d{1,3})\b"),
]
# Kits e combos: "kit 2 pacotes", "2x 60", "combo". Quantidade total não é
# confiável a partir do nome, então esses ficam de fora.
_RE_KIT = re.compile(r"\bkit\b|\bcombo\b|\b\d+\s*x\s*\d+\b|\b\d+\s*pacotes\b")


def normalizar(texto: str) -> str:
    sem_acento = unicodedata.normalize("NFKD", texto)
    sem_acento = "".join(c for c in sem_acento if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", sem_acento.lower()).strip()


def extrair_tamanho(nome: str) -> str | None:
    n = normalizar(nome)
    if _RE_TAMANHO_COMBINADO.search(n):
        return None
    encontrados = {TAMANHOS[m] for m in _RE_TAMANHO.findall(n)}
    if len(encontrados) == 1:
        return encontrados.pop()
    return None


def extrair_quantidade(nome: str) -> int | None:
    n = normalizar(nome)
    if _RE_KIT.search(n):
        return None
    leve = _RE_LEVE_PAGUE.search(n)
    if leve:
        return int(leve.group(1))
    valores = set()
    for regex in _RE_QUANTIDADE:
        valores.update(int(v) for v in regex.findall(n))
    valores.discard(0)
    if len(valores) == 1:
        return valores.pop()
    return None


def corresponde(nome: str, termos: list[str], excluir: list[str]) -> bool:
    """`termos` casam como palavras inteiras ("mili" não casa com "familia");
    `excluir` casa como início de palavra ("geriatric" pega "geriatrica")."""
    n = normalizar(nome)

    def tem(termo: str, palavra_inteira: bool) -> bool:
        fim = r"\b" if palavra_inteira else ""
        return re.search(r"\b" + re.escape(normalizar(termo)) + fim, n) is not None

    if any(tem(t, False) for t in excluir):
        return False
    return all(tem(t, True) for t in termos)
