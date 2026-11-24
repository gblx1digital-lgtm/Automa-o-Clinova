# CLINOVA Prospecção

Site particular para encontrar e abordar potenciais clientes do CLINOVA: clínicas, consultórios, dentistas, psicólogos, veterinárias, pet shops e salões.

- **Buscar no Google Maps**: usa a API oficial do Google. Traz nome, telefone, bairro, site e nota no Google, bairro por bairro.
- **Importar da Receita Federal**: lê os dados abertos oficiais de CNPJ e guarda só as empresas **ativas** das cidades e atividades (CNAE) escolhidas. Traz CNPJ, e-mail e telefones cadastrados.
- **Junta os repetidos**: mesmo telefone, mesmo CNPJ ou mesma empresa no Google viram um contato só.
- **Contatos**: fila de trabalho (celulares novos primeiro), status (Novo → Mensagem enviada → Respondeu → Vídeo enviado → Negociando → Virou cliente / Não quer contato), notas e exportação para planilha.
- **WhatsApp manual**: o botão de cada contato abre a conversa com a mensagem do segmento já escrita; você confere e envia.
- **WhatsApp automático** (conectado por QR Code): envia as mensagens de apresentação sozinho, com limites para proteger o número (detalhes abaixo).
- **Acesso só seu**, com senha.

## Publicar no Railway (cerca de 10 minutos)

1. No Railway, abra o seu projeto e clique em **New → GitHub Repo → Automa-o-Clinova**. O Railway detecta o `Dockerfile`.
2. No serviço criado: **Volumes → Add Volume**, com Mount Path `/data`. Os contatos ficam guardados ali.
3. Em **Variables**, adicione:

   | Variável | O que colocar |
   |---|---|
   | `ADMIN_PASSWORD` | Uma senha forte, com pelo menos 8 caracteres. É a senha para entrar no site. |
   | `GOOGLE_PLACES_API_KEY` | Sua chave do Google (veja abaixo). Sem ela, só a importação da Receita funciona. |
   | `NODE_ENV` | `production` |

4. Em **Settings → Networking → Generate Domain**, gere um endereço, por exemplo `clinova-prospeccao.up.railway.app`. Se quiser, use um subdomínio seu, como `prospeccao.useclinova.com`.
5. Abra o endereço, entre com a senha e comece.

## Buscar em um estado inteiro

- **Google**: em "Onde buscar", escolha o estado e o tamanho mínimo das cidades (100 mil, 50 mil, 20 mil, 10 mil habitantes ou todas) e clique em **Preencher com as cidades do estado**. Também dá para escrever só a sigla (`MG`) ou "estado de Minas Gerais" numa linha. A tela mostra quantas buscas isso vai gerar antes de você clicar em Buscar.
  - "São Paulo", "Rio de Janeiro", "Goiás" e "Tocantins" sozinhos são tratados como **cidades**; para o estado, use a sigla (`SP`) ou "estado de São Paulo".
  - Cada busca do Google traz no máximo 60 empresas: em cidades muito grandes, acrescente bairros para pegar mais.
- **Receita Federal**: deixe a lista de cidades **vazia** (ou escreva só a sigla) para importar o estado inteiro da UF escolhida.

População por município: IBGE, Censo 2022 (dados do pacote `municipios-br`, licença MIT; veja `src/data/LICENSE-municipios-br.txt`).

## Criar a chave do Google (Places API)

1. Acesse <https://console.cloud.google.com/>, crie um projeto (ex.: "Clinova Prospecção") e **ative o faturamento**. O Google exige cartão, mas tem uma cota gratuita mensal. Confira os preços atuais da *Places API (New) — Text Search* na página de preços do Google Maps Platform.
2. Em **APIs e serviços → Biblioteca**, ative a **Places API (New)**.
3. Em **APIs e serviços → Credenciais → Criar credenciais → Chave de API**.
4. Clique na chave e, em **Restrições de API**, escolha **Restringir chave → Places API (New)**. Assim, se a chave vazar, ela só serve para isso.
5. Recomendado: em **Faturamento → Orçamentos e alertas**, crie um alerta de gasto (ex.: R$ 50/mês).
6. Cole a chave na variável `GOOGLE_PLACES_API_KEY` no Railway.

Cada "consulta" ao Google traz até 20 empresas. O site não repete buscas feitas nos últimos 30 dias e para no limite que você escolher em cada rodada.

## WhatsApp automático

1. Aba **WhatsApp automático → Conectar WhatsApp**.
2. No celular do número de prospecção: **⋮ Mais opções** (Android) ou **Configurações** (iPhone) → **Aparelhos conectados → Conectar um aparelho**, e leia o QR Code.
3. Confira as **Regras do envio** (horário, dias, limite por dia, segmentos, cidades) e clique em **Ligar envio automático**.

A sessão fica salva no volume `/data`: depois de ler o QR uma vez, o site reconecta sozinho quando reinicia.

**Limites fixos (não dá para aumentar pela tela):**
- no mínimo **1 minuto entre mensagens**, mais um intervalo aleatório de até 1 minuto (média de cerca de 1,5 min);
- no máximo **30 mensagens por hora**;
- limite por dia configurável, até 300 (padrão 150), e só no horário e nos dias escolhidos (padrão: seg. a sex., 9h às 18h, horário de Brasília).

**Proteções automáticas:**
- antes de enviar, confere se o número tem WhatsApp; se não tiver, o contato vira "Número inválido";
- mostra "digitando..." por alguns segundos antes de cada mensagem;
- `{saudacao}` vira Bom dia, Boa tarde ou Boa noite conforme a hora, e várias versões da mensagem (separadas por `---`) são sorteadas;
- **quem responde sai da fila** e aparece em "Respostas recebidas" para você assumir a conversa;
- **quem pede para parar** ("não tenho interesse", "pare", "me tire da lista"...) vira "Não quer contato" e nunca mais recebe;
- 3 erros seguidos pausam o envio sozinho; desconectar o WhatsApp também pausa;
- se o QR Code não for lido depois de algumas tentativas, ele para de gerar códigos novos até você clicar em Conectar.

> ⚠️ **Use um número só para prospecção.** Envio automático de mensagens de prospecção por WhatsApp conectado via QR Code vai contra os termos de uso do WhatsApp. Os limites reduzem, mas não eliminam, o risco de bloqueio do número. Com um chip novo, comece com um limite diário baixo (ex.: 30–50) nas primeiras semanas.

## Boas práticas na abordagem (importante)

- **Até 20–30 mensagens novas por dia.** Muitas mensagens iguais para quem não tem seu número salvo podem fazer o WhatsApp **bloquear seu número**.
- Prefira contatos com **celular** e varie um pouco o texto.
- **Respeite quem pedir para sair**: marque como "Não quer contato". Esse contato nunca mais aparece na fila.
- Os telefones da Receita às vezes são do contador ou estão desatualizados; os do Google costumam ser os que a empresa divulga.

## Rodar no computador (opcional)

```bash
npm install
```

```bash
ADMIN_PASSWORD=sua-senha-aqui GOOGLE_PLACES_API_KEY=sua-chave npm start
```

Abra <http://localhost:3000>.

## Testes

```bash
npm test
```

Os testes usam versões **simuladas** do Google, da Receita e do WhatsApp (com o tempo acelerado 600×): não precisam de internet, não gastam cota e não enviam mensagens de verdade.

## Variáveis opcionais

| Variável | Para quê |
|---|---|
| `DATA_DIR` | Pasta dos dados (no Docker já é `/data`). |
| `SESSION_SECRET` | Segredo das sessões. Sem ele, o segredo é derivado da senha, e trocar a senha desconecta todo mundo. |
| `RECEITA_SHARE_URL` | Endereço do compartilhamento de dados abertos de CNPJ da Receita, caso ela mude o local dos arquivos. Padrão: `https://arquivos.receitafederal.gov.br/public.php/dav/files/YggdBLfdninEJX9/`. O site procura sozinho a pasta do mês mais recente (AAAA-MM). |
| `RECEITA_MES` | Força um mês específico dos dados da Receita (`AAAA-MM`). |
