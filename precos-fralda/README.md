# Agente de preços de fralda

Todo dia busca, nas farmácias on-line configuradas, o preço das fraldas
Pampers e Mili, tamanhos RN e P (editável em `config.toml`), e publica um ranking por **preço por fralda**, sem
frete.

## Como funciona

1. Para cada loja × produto, consulta o catálogo público da loja (API VTEX).
2. Mantém só ofertas disponíveis cujo nome tem todos os `termos` e tem o
   tamanho e a quantidade de fraldas legíveis no nome. Entram só os
   `tamanhos` configurados (hoje RN e P), cada um com seu próprio ranking.
   "Recém-nascido" por extenso conta como RN; RN+ é um tamanho à parte. Kits,
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

## Lojas cobertas e não cobertas

Testado em execução real em 30/09/2026:

| Loja | Situação |
|---|---|
| Drogaria São Paulo, Pacheco, Pague Menos, Venâncio, Catarinense | Coberta (API VTEX) |
| Araujo, Droga Raia | **Não coberta**: respondem "Access Denied" (proteção contra robôs) a servidores de nuvem, mesmo identificando o agente |
| Panvel | **Não coberta**: além do bloqueio, o `robots.txt` pede que robôs não usem a busca (`Disallow: /panvel/buscarProduto.do`) |

Não tentamos contornar esses bloqueios (por exemplo, fingindo ser um navegador).

## Limitações

- Só entra o preço da própria farmácia. Ofertas de vendedores parceiros
  (marketplace dentro do site) ficam de fora; `vendedores_terceiros = true` no
  `config.toml` inclui.
- Se uma busca chega ao limite de `paginas`, o relatório avisa em "Falhas".

- Algumas lojas têm preço regionalizado; sem CEP, vale o preço padrão do site.
- Promoções "leve 3 pague 2" e cupons não entram (simulação é de 1 unidade,
  sem cupom).
