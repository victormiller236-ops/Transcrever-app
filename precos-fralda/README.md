# Agente de preços de fralda

Todo dia busca, nas farmácias on-line configuradas, o preço das fraldas
listadas em `config.toml` e publica um ranking por **preço por fralda**, sem
frete.

## Como funciona

1. Para cada loja × produto, consulta o catálogo público da loja (API VTEX).
2. Mantém só ofertas disponíveis cujo nome tem todos os `termos`, é do
   `tamanho` pedido e tem a quantidade de fraldas legível no nome. Kits,
   combos e tamanhos combinados ("M/G") são descartados e contados no
   relatório — preferimos deixar de fora a calcular preço por fralda errado.
3. Confirma cada preço numa simulação de carrinho da própria loja, sem CEP.
   Sem CEP não há cálculo de entrega, então o valor é o preço do produto, sem
   frete. Ofertas marcadas ⚠ ficaram só com o preço de catálogo porque a
   simulação falhou.
4. Gera `saida/relatorio.md` e `saida/precos.csv`.

## Onde ver o resultado

O workflow `.github/workflows/precos-fralda.yml` roda todo dia às 06:07
(Brasília) e:

- comenta o relatório na issue **"Preços de fralda"** (criada na primeira
  execução — assine a issue para receber por e-mail);
- guarda o CSV como artefato da execução por 90 dias.

Também dá para rodar manualmente em Actions → "Preços de fralda" → Run workflow.

## Rodar localmente

Python 3.11+, sem dependências.

```bash
cd precos-fralda
python -m unittest discover -s tests
python -m precos_fralda
```

## Limitações

- Só lojas VTEX. Drogasil, Droga Raia e Panvel usam plataformas próprias e não
  estão cobertas.
- Algumas lojas têm preço regionalizado; sem CEP, vale o preço padrão do site.
- Promoções "leve 3 pague 2" e cupons não entram (simulação é de 1 unidade,
  sem cupom).
