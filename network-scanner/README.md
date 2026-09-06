# network-scanner

Script de linha de comando para listar quais dispositivos (celulares,
notebooks, TVs, IoT etc.) estão na sua rede local agora.

## Por que não faz parte do app Transcrever (Vercel)

O Transcrever roda numa função serverless na nuvem da Vercel, que não tem
acesso à sua rede Wi-Fi doméstica — e o navegador, por segurança, também não
consegue fazer ping/ARP na rede local. Por isso este é um script separado,
pra rodar na sua própria máquina, conectada à mesma rede que você quer
verificar.

## Como funciona

1. Descobre o IP e a máscara de sub-rede da sua interface de rede local.
2. Dá um ping em cada endereço possível da sub-rede (isso faz o sistema
   operacional preencher a tabela ARP com IP → MAC de quem respondeu).
3. Lê essa tabela ARP (`ip neigh show` no Linux, `arp -a` no macOS/Windows).
4. Tenta descobrir o hostname de cada IP (DNS reverso) e, se houver
   internet, o fabricante do MAC via [api.macvendors.com](https://macvendors.com).
5. Marca como "possível celular" quem tem nome de aparelho (ex.: "iPhone",
   "Galaxy", "Redmi") ou fabricante conhecido de celular — **isso é um
   chute**, não uma identificação confiável (o mesmo fabricante faz outros
   produtos, e o hostname é o que o próprio aparelho decidiu anunciar).

Não precisa de permissão de administrador/root em nenhum sistema.

## Como rodar

```bash
cd network-scanner
node scan.js
```

Se você tiver mais de uma interface de rede (ex.: Wi-Fi e Ethernet ao mesmo
tempo), o script avisa e escolhe uma; para escolher outra:

```bash
node scan.js --interface=NOME_DA_INTERFACE
```

(`ifconfig` no macOS/Linux ou `ipconfig` no Windows mostram os nomes.)

Para pular a consulta de fabricante (mais rápido, funciona offline):

```bash
node scan.js --no-vendor
```

## Limitações conhecidas

- Só encontra dispositivos que responderam ao ping (alguns aparelhos
  bloqueiam ping por padrão) ou que já estavam na tabela ARP do sistema.
- Sub-redes maiores que /22 (mais de 1024 endereços) são escaneadas apenas
  parcialmente, por segurança/tempo.
- A consulta de fabricante depende de internet e de um serviço público
  gratuito (limite de ~1 requisição/segundo); sem internet, aparece como
  "desconhecido".
- "Possível celular?" é heurística, não certeza.
