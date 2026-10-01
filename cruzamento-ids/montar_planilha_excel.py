#!/usr/bin/env python3
"""Monta Cruzador-IDs.xlsx: planilha com fórmulas que cruza as abas Trilhos e SAP na aba Cruzamento.

Uso: python montar_planilha_excel.py [TRILHOS.xlsx SAP.xlsx] [-o Cruzador-IDs.xlsx]
Sem arquivos, gera o modelo só com os cabeçalhos.
"""
import argparse
import datetime as dt

from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter as L

LINHAS_TRILHOS = 2000      # capacidade de leituras de trilhos
LINHAS_RESULTADO = 2000    # capacidade de linhas no Cruzamento
CAB_TRILHOS = ["Trilho", "ID", "Data", "Hora", "Duplicado em outro trilho"]
CAB_SAP = ["ID de Material", "Centro", "Material", "Texto breve de material", "Largura (mm)", "Espessura (mm)", "Peso Atual", "Peso Original", "Designação da Chapa", "Tipo de Revestimento", "Material da Chapa", "Forma de Criação", "Fornecedor", "Texto Breve do Fornecedor", "Depósito", "Descrição do depósito", "Chave de acesso NF-e", "Nº documento", "Nº da nota fiscal eletrônica", "Número de Inspeção", "Nº pessoal", "Nome completo", "Status de Impressão da Etiqueta", "Reimpressão de Etiqueta", "Bloqueado", "Status do ID de Material", "ID de Material Original", "Material Original (Reclassificado)", "Descrição Material Original", "Criado por", "Criado em", "Modificado por", "Última modificação", "Nota Fiscal", "Status IATF", "IATF", "Localização", "Perda magnética máxima"]
# (título na aba Cruzamento, cabeçalho a buscar na aba SAP)  -- None = vem da aba Trilhos
SAIDA = [("Trilho", None), ("ID", "ID de Material"), ("Data de criação", "Criado em"), ("Material", "Material"),
         ("Texto breve de material", "Texto breve de material"), ("Largura (mm)", "Largura (mm)"),
         ("Peso Atual", "Peso Atual"), ("Peso Original", "Peso Original"), ("Designação da Chapa", "Designação da Chapa"),
         ("Forma de Criação", "Forma de Criação"), ("Nome completo", "Nome completo"), ("Bloqueado", "Bloqueado"),
         ("Status do ID de Material", "Status do ID de Material")]
VERDE = PatternFill("solid", fgColor="0B6E4F")
CINZA = PatternFill("solid", fgColor="E7EBEF")


def cabecalho(ws, titulos, fill=VERDE, cor="FFFFFF"):
    for i, t in enumerate(titulos, 1):
        c = ws.cell(1, i, t)
        c.font = Font(bold=True, color=cor)
        c.fill = fill
    ws.freeze_panes = "A2"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("trilhos", nargs="?")
    ap.add_argument("sap", nargs="?")
    ap.add_argument("-o", "--saida", default="Cruzador-IDs.xlsx")
    a = ap.parse_args()

    wb = Workbook()
    wi = wb.active
    wi.title = "LEIA-ME"
    texto = [
        "COMO USAR",
        "1) Aba Trilhos: apague os dados antigos das colunas A:E (mantenha a linha 1) e cole a nova planilha de trilhos a partir da A1.",
        "2) Aba SAP: apague TUDO (selecione as colunas e delete) e cole a planilha do SAP inteira, com cabeçalho, a partir da A1.",
        "3) Aba Cruzamento: atualiza sozinha com os IDs que existem nas duas planilhas.",
        "4) Na aba Trilhos, a coluna I diz OK ou NÃO ENCONTRADO para cada leitura.",
        "",
        "Regras: o SAP precisa manter os cabeçalhos com os mesmos nomes (a ordem das colunas pode mudar).",
        f"Capacidade: {LINHAS_TRILHOS} leituras de trilhos. Não mexa nas colunas G, H e I da aba Trilhos nem na coluna N da aba Cruzamento (são fórmulas).",
        "Se o Excel estiver lento ao colar o SAP, mude Fórmulas > Opções de Cálculo > Manual, cole, e aperte F9.",
    ]
    for i, t in enumerate(texto, 1):
        wi.cell(i, 1, t).font = Font(bold=(i == 1), size=14 if i == 1 else 11)
    wi.column_dimensions["A"].width = 130

    wt = wb.create_sheet("Trilhos")
    ws = wb.create_sheet("SAP")
    wc = wb.create_sheet("Cruzamento")

    cabecalho(wt, CAB_TRILHOS)
    cabecalho(ws, CAB_SAP)
    n_t = n_s = 0
    if a.trilhos:
        wbt = load_workbook(a.trilhos, read_only=True, data_only=True)
        for r, row in enumerate(wbt.worksheets[0].iter_rows(values_only=True), 1):
            for c, v in enumerate(row[:5], 1):
                wt.cell(r, c, v)
            n_t = r
    if a.sap:
        wbs = load_workbook(a.sap, read_only=True, data_only=True)
        for r, row in enumerate(wbs.worksheets[0].iter_rows(values_only=True), 1):
            for c, v in enumerate(row, 1):
                if v is not None and v != "":
                    ws.cell(r, c, v)
            n_s = r
    for r in range(2, n_t + 1):
        if isinstance(wt.cell(r, 3).value, (dt.datetime, dt.date)):
            wt.cell(r, 3).number_format = "dd/mm/yyyy"
        if isinstance(wt.cell(r, 4).value, dt.time):
            wt.cell(r, 4).number_format = "hh:mm:ss"
    for r in range(2, n_s + 1):
        for col in (31, 33):
            ws.cell(r, col).number_format = "dd/mm/yyyy"

    # Trilhos: colunas auxiliares G (linha no SAP), H (nº sequencial do encontrado), I (status)
    for i, t in enumerate(["Linha no SAP (auto)", "Nº encontrado (auto)", "Status (auto)"], 7):
        c = wt.cell(1, i, t)
        c.font = Font(bold=True)
        c.fill = CINZA
    for r in range(2, LINHAS_TRILHOS + 2):
        wt.cell(r, 7, f'=IF(B{r}="","",IFERROR(MATCH(B{r},SAP!$A:$A,0),IFERROR(MATCH(B{r}&"",SAP!$A:$A,0),"")))')
        wt.cell(r, 8, f'=IF(G{r}="","",COUNT(G$2:G{r}))')
        wt.cell(r, 9, f'=IF(B{r}="","",IF(G{r}="","NÃO ENCONTRADO","OK"))')
    for col, w in zip("ABCDEFGHI", (9, 12, 12, 10, 26, 3, 20, 20, 18)):
        wt.column_dimensions[col].width = w

    # Cruzamento
    cabecalho(wc, [t for t, _ in SAIDA] + [""] * 0)
    wc.cell(1, 14, "Linha em Trilhos (auto)").font = Font(bold=True)
    wc.cell(1, 14).fill = CINZA
    for r in range(2, LINHAS_RESULTADO + 2):
        wc.cell(r, 14, f'=IFERROR(MATCH(ROW()-1,Trilhos!$H:$H,0),"")')
        for i, (t, hdr) in enumerate(SAIDA, 1):
            if hdr is None:
                f = f'=IF($N{r}="","",INDEX(Trilhos!$A:$A,$N{r}))'
            else:
                f = (f'=IF($N{r}="","",INDEX(SAP!$A:$AZ,INDEX(Trilhos!$G:$G,$N{r}),'
                     f'MATCH("{hdr}",SAP!$1:$1,0)))')
            c = wc.cell(r, i, f)
            if t == "Data de criação":
                c.number_format = "dd/mm/yyyy"
            elif t in ("Largura (mm)", "Peso Atual", "Peso Original"):
                c.number_format = "#,##0.###"
    for i, (t, _) in enumerate(SAIDA, 1):
        wc.column_dimensions[L(i)].width = {"Texto breve de material": 42, "Nome completo": 30}.get(t, max(11, len(t) + 2))
    wc.column_dimensions["N"].width = 22
    wc.auto_filter.ref = f"A1:M{LINHAS_RESULTADO + 1}"
    wb.move_sheet("Cruzamento", offset=-2)
    wb.active = wb.sheetnames.index("Cruzamento")
    wb.save(a.saida)
    print("ok", a.saida, "trilhos:", n_t, "sap:", n_s)


if __name__ == "__main__":
    main()
