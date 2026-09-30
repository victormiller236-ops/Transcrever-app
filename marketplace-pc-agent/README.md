# Agente de PC gamer no Marketplace (até R$ 3.000)

Roda **no seu computador**, com o seu login. Coleta anúncios, extrai CPU/GPU/RAM/SSD,
pontua o custo-benefício e sinaliza anúncios suspeitos.

## Uso
    pip install -r requirements.txt && playwright install chromium
    python agent.py login                                # 1x, loga manualmente
    python agent.py search --cidade saopaulo --max-preco 3000

Rode no máximo 1-2x por dia. Automação viola os termos do Facebook e pode limitar a conta.
Slug da cidade: é o trecho da URL em facebook.com/marketplace/<cidade>.

## Ajustes
- Tabelas de GPU/CPU e alertas: `scoring.py` (pontos são heurísticos, ajuste ao seu gosto).
- Seletores/texto do Facebook mudam com frequência; se a coleta vier vazia, ajuste `collect()`.
- Depois de conferir os resultados, confirme sempre: teste ao vivo, nota fiscal da GPU, pagamento só na retirada.
