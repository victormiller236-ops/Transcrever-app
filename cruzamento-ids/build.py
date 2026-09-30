"""Gera cruzamento-ids.html (arquivo único, funciona offline) a partir de template.html + xlsx.full.min.js."""
from pathlib import Path
d = Path(__file__).parent
html = (d/"template.html").read_text(encoding="utf-8").replace("/*XLSX_LIB*/", (d/"xlsx.full.min.js").read_text(encoding="utf-8").replace("</script>","<\\/script>"))
(d/"cruzamento-ids.html").write_text(html, encoding="utf-8")
print("ok", len(html))
