Attribute VB_Name = "CarregarPlanilhas"
Option Explicit

' Botoes: ligue "CarregarTrilhos" e "CarregarSAP" a dois botoes na aba Cruzamento.
' A aba Cruzamento se atualiza sozinha com as formulas.

Public Sub CarregarTrilhos()
    CarregarArquivo "Trilhos", 5, "ID", 2
End Sub

Public Sub CarregarSAP()
    CarregarArquivo "SAP", 0, "ID de Material", 1
End Sub

' abaDestino : nome da aba que recebe os dados
' maxCols    : quantas colunas copiar (0 = todas)
' cabEsperado/colCab : cabecalho que deve existir na linha 1 do arquivo escolhido, na coluna colCab
Private Sub CarregarArquivo(ByVal abaDestino As String, ByVal maxCols As Long, _
                            ByVal cabEsperado As String, ByVal colCab As Long)
    Dim f As Variant
    Dim wbO As Workbook, wsO As Worksheet, dest As Worksheet
    Dim ultLin As Long, ultCol As Long, nCols As Long
    Dim calcAnt As XlCalculation

    f = Application.GetOpenFilename("Planilhas Excel (*.xlsx;*.xlsm;*.xls),*.xlsx;*.xlsm;*.xls", , _
                                    "Escolha a planilha de " & abaDestino)
    If VarType(f) = vbBoolean Then Exit Sub   ' cancelou

    calcAnt = Application.Calculation
    On Error GoTo erro
    Application.ScreenUpdating = False
    Application.EnableEvents = False
    Application.Calculation = xlCalculationManual
    Application.StatusBar = "Lendo " & CStr(f) & " ..."

    Set wbO = Workbooks.Open(CStr(f), ReadOnly:=True, UpdateLinks:=0)
    Set wsO = wbO.Worksheets(1)

    ' confere se e a planilha certa ANTES de apagar qualquer coisa
    If Trim$(CStr(wsO.Cells(1, colCab).Value)) <> cabEsperado Then
        wbO.Close SaveChanges:=False
        MsgBox "Esse arquivo nao parece ser a planilha de " & abaDestino & "." & vbCrLf & _
               "Esperava o cabecalho """ & cabEsperado & """ na coluna " & colCab & " da linha 1." & vbCrLf & _
               "Nada foi alterado.", vbExclamation
        GoTo fim
    End If

    ultLin = wsO.UsedRange.Row + wsO.UsedRange.Rows.Count - 1
    ultCol = wsO.UsedRange.Column + wsO.UsedRange.Columns.Count - 1
    nCols = ultCol
    If maxCols > 0 And nCols > maxCols Then nCols = maxCols

    Set dest = ThisWorkbook.Worksheets(abaDestino)
    If maxCols > 0 Then
        dest.Range(dest.Columns(1), dest.Columns(maxCols)).ClearContents
    Else
        dest.Cells.ClearContents
    End If

    wsO.Range(wsO.Cells(1, 1), wsO.Cells(ultLin, nCols)).Copy
    dest.Range("A1").PasteSpecial Paste:=xlPasteValuesAndNumberFormats
    Application.CutCopyMode = False
    wbO.Close SaveChanges:=False

    Application.StatusBar = "Calculando..."
    Application.Calculation = xlCalculationAutomatic
    Application.Calculate
    MsgBox abaDestino & ": " & Format(ultLin - 1, "#,##0") & " linhas carregadas.", vbInformation
    GoTo fim

erro:
    MsgBox "Erro ao carregar: " & Err.Description, vbCritical
    On Error Resume Next
    If Not wbO Is Nothing Then wbO.Close SaveChanges:=False
fim:
    On Error Resume Next
    Application.CutCopyMode = False
    Application.Calculation = calcAnt
    Application.EnableEvents = True
    Application.ScreenUpdating = True
    Application.StatusBar = False
End Sub
