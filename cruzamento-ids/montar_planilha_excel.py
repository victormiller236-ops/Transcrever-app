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
    ap.add_argument("--busca", default="", help="texto pré-preenchido na aba Busca")
    a = ap.parse_args()

    wb = Workbook()
    wi = wb.active
    wi.title = "LEIA-ME"
    texto = [
        "COMO USAR",
        "1) Aba Trilhos: apague os dados antigos das colunas A:E (mantenha a linha 1) e cole a nova planilha de trilhos a partir da A1.",
        "2) Aba SAP: apague TUDO (selecione as colunas e delete) e cole a planilha do SAP inteira, com cabeçalho, a partir da A1.",
        "3) Aba Cruzamento: atualiza sozinha com os IDs que existem nas duas planilhas (inclui o ID e a descrição da bobina de origem).",
        "   Aba Busca: digite na célula amarela (ex.: 279 core) e veja quantas tiras, em quais trilhos, status e bobinas de origem.",
        "4) Na aba Trilhos, a coluna I diz OK ou NÃO ENCONTRADO para cada leitura.",
        "",
        "Regras: o SAP precisa manter os cabeçalhos com os mesmos nomes (a ordem das colunas pode mudar).",
        f"Capacidade: {LINHAS_TRILHOS} leituras de trilhos. Não mexa nas colunas G, H e I da aba Trilhos nem nas colunas Q a X da aba Cruzamento (são fórmulas).",
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
    NS = len(SAIDA)                       # colunas A..M
    COL_BOB, COL_BOBTXT = 14, 15          # N, O
    cabecalho(wc, [t for t, _ in SAIDA] + ["ID da bobina de origem", "Bobina de origem (texto breve)"])
    aux = ["Linha em Trilhos (auto)", "Linha no SAP (auto)", "Bobina bruta (auto)", "Na busca (auto)",
           "Nº na busca (auto)", "1º do trilho (auto)", "1ª bobina (auto)", "1º status (auto)"]
    for i, t in enumerate(aux, 17):       # Q..X
        c = wc.cell(1, i, t)
        c.font = Font(bold=True)
        c.fill = CINZA
    # tokens da busca (até 4 palavras) ficam em Busca!E3:E6
    for r in range(2, LINHAS_RESULTADO + 2):
        wc.cell(r, 17, f'=IFERROR(MATCH(ROW()-1,Trilhos!$H:$H,0),"")')
        wc.cell(r, 18, f'=IF($Q{r}="","",INDEX(Trilhos!$G:$G,$Q{r}))')
        wc.cell(r, 19, f'=IF($R{r}="","",INDEX(SAP!$A:$AZ,$R{r},MATCH("ID de Material Original",SAP!$1:$1,0))&"")')
        for i, (t, hdr) in enumerate(SAIDA, 1):
            if hdr is None:
                f = f'=IF($Q{r}="","",INDEX(Trilhos!$A:$A,$Q{r}))'
            else:
                f = f'=IF($R{r}="","",INDEX(SAP!$A:$AZ,$R{r},MATCH("{hdr}",SAP!$1:$1,0)))'
            c = wc.cell(r, i, f)
            if t == "Data de criação":
                c.number_format = "dd/mm/yyyy"
            elif t in ("Largura (mm)", "Peso Atual", "Peso Original"):
                c.number_format = "#,##0.###"
        wc.cell(r, COL_BOB, f'=IF(OR($S{r}="",$S{r}="0"),"",$S{r})')
        wc.cell(r, COL_BOBTXT,
                f'=IF($N{r}="","",IFERROR(INDEX(SAP!$A:$AZ,IFERROR(MATCH($N{r},SAP!$A:$A,0),MATCH($N{r}+0,SAP!$A:$A,0)),'
                f'MATCH("Texto breve de material",SAP!$1:$1,0)),""))')
        # --- busca: cada palavra precisa existir; número casa no início de palavra; ID/bobina por igualdade
        hay = f'" "&$E{r}&" "&$I{r}&" "&$D{r}&" "&$M{r}&" "&$K{r}&" "&$O{r}&" "&$A{r}&" "'
        partes = []
        for k in range(3, 7):
            tok = f"Busca!$E${k}"
            partes.append(f'OR({tok}="",ISNUMBER(SEARCH(IF(ISNUMBER(--{tok})," ","")&{tok},{hay})),$B{r}&""={tok},$N{r}&""={tok})')
        wc.cell(r, 20, f'=IF($Q{r}="","",IF(Busca!$B$3="","",IF(AND({",".join(partes)}),1,0)))')
        wc.cell(r, 21, f'=IF($T{r}=1,COUNTIF($T$2:$T{r},1),"")')
        wc.cell(r, 22, f'=IF($T{r}=1,IF(COUNTIFS($A$2:$A{r},$A{r},$T$2:$T{r},1)=1,COUNT($V$1:$V{r-1})+1,""),"")')
        wc.cell(r, 23, f'=IF(AND($T{r}=1,$N{r}<>""),IF(COUNTIFS($N$2:$N{r},$N{r},$T$2:$T{r},1)=1,COUNT($W$1:$W{r-1})+1,""),"")')
        wc.cell(r, 24, f'=IF($T{r}=1,IF(COUNTIFS($M$2:$M{r},$M{r},$T$2:$T{r},1)=1,COUNT($X$1:$X{r-1})+1,""),"")')
    for i, (t, _) in enumerate(SAIDA, 1):
        wc.column_dimensions[L(i)].width = {"Texto breve de material": 42, "Nome completo": 30}.get(t, max(11, len(t) + 2))
    wc.column_dimensions["N"].width = 22
    wc.column_dimensions["O"].width = 42
    for col in "QRSTUVWX":
        wc.column_dimensions[col].width = 18
    wc.auto_filter.ref = f"A1:O{LINHAS_RESULTADO + 1}"

    # Busca
    wq = wb.create_sheet("Busca")
    wq["A1"] = "BUSCA NO ESTOQUE DOS TRILHOS"
    wq["A1"].font = Font(bold=True, size=14)
    wq["A3"] = "Buscar:"
    wq["A3"].font = Font(bold=True)
    wq["B3"] = a.busca or None
    wq["B3"].fill = PatternFill("solid", fgColor="FFF2CC")
    wq["B3"].font = Font(bold=True, size=14)
    wq.merge_cells("B3:D3")
    wq["A4"] = "Digite palavras separadas por espaço (ex.: 279 core). Todas precisam bater. Aceita também o ID de uma tira ou de uma bobina."
    wq["A4"].font = Font(italic=True, color="63707E")
    wq["D2"] = "palavras (auto):"
    wq["D2"].font = Font(color="999999")
    for k in range(1, 5):
        wq.cell(2 + k, 5, f'=TRIM(MID(SUBSTITUTE(TRIM($B$3)," ",REPT(" ",100)),{(k-1)*100+1},100))')
        wq.cell(2 + k, 5).font = Font(color="999999")
    wq["A6"] = "Tiras encontradas:"
    wq["B6"] = '=IF($B$3="","",COUNTIF(Cruzamento!$T:$T,1))'
    wq["A7"] = "Peso atual somado:"
    wq["B7"] = '=IF($B$3="","",SUMIF(Cruzamento!$T:$T,1,Cruzamento!$G:$G))'
    wq["B7"].number_format = "#,##0.###"
    for c in ("A6", "A7"):
        wq[c].font = Font(bold=True)
    wq["B6"].font = Font(bold=True, size=14)

    def bloco(col, titulo, hdrs, n, fmts):
        wq.cell(9, col, titulo).font = Font(bold=True, size=12)
        for j, h in enumerate(hdrs):
            c = wq.cell(10, col + j, h)
            c.font = Font(bold=True, color="FFFFFF")
            c.fill = VERDE
        return 11

    # Por trilho: A:C
    bloco(1, "Por trilho", ["Trilho", "Tiras", "Peso atual"], 15, None)
    for k in range(1, 16):
        r = 10 + k
        wq.cell(r, 1, f'=IFERROR(INDEX(Cruzamento!$A:$A,MATCH({k},Cruzamento!$V:$V,0)),"")')
        wq.cell(r, 2, f'=IF($A{r}="","",COUNTIFS(Cruzamento!$A:$A,$A{r},Cruzamento!$T:$T,1))')
        wq.cell(r, 3, f'=IF($A{r}="","",SUMIFS(Cruzamento!$G:$G,Cruzamento!$A:$A,$A{r},Cruzamento!$T:$T,1))').number_format = "#,##0.###"
    # Por status: E:F
    bloco(5, "Por status", ["Status", "Tiras"], 6, None)
    for k in range(1, 7):
        r = 10 + k
        wq.cell(r, 5, f'=IFERROR(INDEX(Cruzamento!$M:$M,MATCH({k},Cruzamento!$X:$X,0)),"")')
        wq.cell(r, 6, f'=IF($E{r}="","",COUNTIFS(Cruzamento!$M:$M,$E{r},Cruzamento!$T:$T,1))')
    # Por bobina: H:I
    bloco(8, "Bobinas de origem", ["ID da bobina", "Tiras"], 30, None)
    for k in range(1, 31):
        r = 10 + k
        wq.cell(r, 8, f'=IFERROR(INDEX(Cruzamento!$N:$N,MATCH({k},Cruzamento!$W:$W,0)),"")')
        wq.cell(r, 9, f'=IF($H{r}="","",COUNTIFS(Cruzamento!$N:$N,$H{r},Cruzamento!$T:$T,1))')
    # Lista detalhada
    wq.cell(44, 1, "Tiras encontradas (até 300)").font = Font(bold=True, size=12)
    det = [("Trilho", "A"), ("ID", "B"), ("Texto breve de material", "E"), ("Peso Atual", "G"),
           ("Status", "M"), ("ID da bobina", "N"), ("Criado em", "C")]
    for j, (h, _) in enumerate(det, 1):
        c = wq.cell(45, j, h)
        c.font = Font(bold=True, color="FFFFFF")
        c.fill = VERDE
    for k in range(1, 301):
        r = 45 + k
        for j, (h, col) in enumerate(det, 1):
            c = wq.cell(r, j, f'=IFERROR(INDEX(Cruzamento!${col}:${col},MATCH({k},Cruzamento!$U:$U,0)),"")')
            if h == "Peso Atual":
                c.number_format = "#,##0.###"
            if h == "Criado em":
                c.number_format = "dd/mm/yyyy"
    for col, w in zip("ABCDEFGHI", (22, 14, 14, 40, 26, 14, 14, 16, 8)):
        wq.column_dimensions[col].width = w
    wq.column_dimensions["C"].width = 40
    wq.column_dimensions["D"].width = 14
    wb.move_sheet("Busca", offset=-(wb.sheetnames.index("Busca") - 1))
    wb.move_sheet("Cruzamento", offset=-(wb.sheetnames.index("Cruzamento") - 2))
    wb.active = wb.sheetnames.index("Busca")
    wb.save(a.saida)
    print("ok", a.saida, "trilhos:", n_t, "sap:", n_s)


if __name__ == "__main__":
    main()
