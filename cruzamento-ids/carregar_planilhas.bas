Attribute VB_Name = "CarregarPlanilhas"
Option Explicit

' Um botao so: escolha as duas planilhas (trilhos e SAP) de uma vez. A macro reconhece qual e qual,
' cola nas abas Trilhos e SAP e leva voce para a aba Busca. O resto e feito pelas formulas.

Private Const ABA_BUSCA As String = "Busca"
Private Const LIM_TRILHOS As Long = 2000   ' capacidade de leituras de trilhos da planilha

' Rode UMA vez (Alt+F8 > CriarBotao) para colocar o botao na aba Busca.
Public Sub CriarBotao()
    Dim ws As Worksheet, b As Object
    Set ws = ThisWorkbook.Worksheets(ABA_BUSCA)
    For Each b In ws.Buttons
        b.Delete
    Next b
    Set b = ws.Buttons.Add(ws.Range("G1").Left, ws.Range("G1").Top, 170, 34)
    b.OnAction = "CarregarPlanilhas"
    b.Caption = "Carregar planilhas"
    b.Font.Bold = True
End Sub

Public Sub CarregarPlanilhas()
    Dim arq As Variant, i As Long, n As Long
    Dim pT As String, pS As String, t As String
    Dim calcAnt As XlCalculation

    arq = Application.GetOpenFilename("Planilhas Excel (*.xlsx;*.xlsm;*.xls),*.xlsx;*.xlsm;*.xls", , _
            "Selecione as DUAS planilhas (segure Ctrl): trilhos e SAP", , True)
    If Not IsArray(arq) Then Exit Sub                       ' cancelou
    n = UBound(arq) - LBound(arq) + 1
    If n > 2 Then
        MsgBox "Selecione no maximo 2 arquivos: a planilha de trilhos e a do SAP.", vbExclamation
        Exit Sub
    End If

    calcAnt = Application.Calculation
    On Error GoTo erro
    Application.ScreenUpdating = False
    Application.EnableEvents = False
    Application.Calculation = xlCalculationManual

    ' 1) reconhece cada arquivo ANTES de mexer em qualquer coisa
    For i = LBound(arq) To UBound(arq)
        Application.StatusBar = "Reconhecendo " & CStr(arq(i)) & " ..."
        t = TipoPlanilha(CStr(arq(i)))
        Select Case t
            Case "T": pT = CStr(arq(i))
            Case "S": pS = CStr(arq(i))
            Case Else
                MsgBox "Nao reconheci este arquivo:" & vbCrLf & CStr(arq(i)) & vbCrLf & vbCrLf & _
                       "Esperava a planilha de trilhos (colunas Trilho e ID) ou a do SAP (coluna ID de Material)." & vbCrLf & _
                       "Nada foi alterado.", vbExclamation
                GoTo fim
        End Select
    Next i

    ' 2) carrega
    Dim msg As String
    If pT <> "" Then
        Application.StatusBar = "Carregando trilhos ..."
        msg = msg & "Trilhos: " & Format(CopiarPara(pT, "Trilhos", 5), "#,##0") & " linhas" & vbCrLf
    End If
    If pS <> "" Then
        Application.StatusBar = "Carregando SAP (pode levar alguns segundos) ..."
        msg = msg & "SAP: " & Format(CopiarPara(pS, "SAP", 0), "#,##0") & " linhas" & vbCrLf
    End If

    Application.StatusBar = "Calculando ..."
    Application.Calculation = xlCalculationAutomatic
    Application.Calculate
    Application.ScreenUpdating = True
    ThisWorkbook.Worksheets(ABA_BUSCA).Activate
    ThisWorkbook.Worksheets(ABA_BUSCA).Range("B3").Select
    MsgBox msg & vbCrLf & "Pronto. Digite na celula amarela para buscar.", vbInformation
    GoTo fim

erro:
    MsgBox "Erro ao carregar: " & Err.Description, vbCritical
fim:
    On Error Resume Next
    Application.CutCopyMode = False
    Application.Calculation = calcAnt
    Application.EnableEvents = True
    Application.ScreenUpdating = True
    Application.StatusBar = False
End Sub

' Devolve "T" (trilhos), "S" (SAP) ou "" (nao reconhecido)
Private Function TipoPlanilha(ByVal caminho As String) As String
    Dim wb As Workbook, ws As Worksheet
    Set wb = Workbooks.Open(caminho, ReadOnly:=True, UpdateLinks:=0)
    Set ws = wb.Worksheets(1)
    If LCase$(Trim$(CStr(ws.Cells(1, 1).Value))) = "id de material" Then
        TipoPlanilha = "S"
    ElseIf LCase$(Trim$(CStr(ws.Cells(1, 1).Value))) = "trilho" And _
           LCase$(Trim$(CStr(ws.Cells(1, 2).Value))) = "id" Then
        TipoPlanilha = "T"
    Else
        TipoPlanilha = ""
    End If
    wb.Close SaveChanges:=False
End Function

' Copia a primeira aba do arquivo para a aba de destino. maxCols = 0 copia todas as colunas.
' Devolve o numero de linhas de dados (sem o cabecalho).
Private Function CopiarPara(ByVal caminho As String, ByVal abaDestino As String, ByVal maxCols As Long) As Long
    Dim wb As Workbook, ws As Worksheet, dest As Worksheet
    Dim ultLin As Long, ultCol As Long

    Set wb = Workbooks.Open(caminho, ReadOnly:=True, UpdateLinks:=0)
    Set ws = wb.Worksheets(1)
    ultLin = ws.UsedRange.Row + ws.UsedRange.Rows.Count - 1
    ultCol = ws.UsedRange.Column + ws.UsedRange.Columns.Count - 1
    If maxCols > 0 And ultCol > maxCols Then ultCol = maxCols

    If abaDestino = "Trilhos" And ultLin - 1 > LIM_TRILHOS Then
        wb.Close SaveChanges:=False
        Err.Raise vbObjectError + 1, , "A planilha de trilhos tem " & (ultLin - 1) & " linhas e a planilha aceita ate " & LIM_TRILHOS & "."
    End If

    Set dest = ThisWorkbook.Worksheets(abaDestino)
    If maxCols > 0 Then
        dest.Range(dest.Columns(1), dest.Columns(maxCols)).ClearContents
    Else
        dest.Cells.ClearContents
    End If

    ws.Range(ws.Cells(1, 1), ws.Cells(ultLin, ultCol)).Copy
    dest.Range("A1").PasteSpecial Paste:=xlPasteValuesAndNumberFormats
    Application.CutCopyMode = False
    wb.Close SaveChanges:=False
    CopiarPara = ultLin - 1
End Function
