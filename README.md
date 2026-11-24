# CLINOVA Prospecção

Site particular para encontrar e abordar potenciais clientes do CLINOVA: clínicas, consultórios, dentistas, psicólogos, veterinárias, pet shops e salões.

- **Buscar no Google Maps**: usa a API oficial do Google. Traz nome, telefone, bairro, site e nota no Google, bairro por bairro.
- **Importar da Receita Federal**: lê os dados abertos oficiais de CNPJ e guarda só as empresas **ativas** das cidades e atividades (CNAE) escolhidas. Traz CNPJ, e-mail e telefones cadastrados.
- **Junta os repetidos**: mesmo telefone, mesmo CNPJ ou mesma empresa no Google viram um contato só.
- **Contatos**: fila de trabalho (celulares novos primeiro), status (Novo → Mensagem enviada → Respondeu → Vídeo enviado → Negociando → Virou cliente / Não quer contato), notas e exportação para planilha.
- **WhatsApp**: o botão abre a conversa com a mensagem do segmento já escrita. **Você confere e envia**; nada é disparado automaticamente. Há um limite diário (padrão 25) para proteger seu número.
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

## Criar a chave do Google (Places API)

1. Acesse <https://console.cloud.google.com/>, crie um projeto (ex.: "Clinova Prospecção") e **ative o faturamento**. O Google exige cartão, mas tem uma cota gratuita mensal. Confira os preços atuais da *Places API (New) — Text Search* na página de preços do Google Maps Platform.
2. Em **APIs e serviços → Biblioteca**, ative a **Places API (New)**.
3. Em **APIs e serviços → Credenciais → Criar credenciais → Chave de API**.
4. Clique na chave e, em **Restrições de API**, escolha **Restringir chave → Places API (New)**. Assim, se a chave vazar, ela só serve para isso.
5. Recomendado: em **Faturamento → Orçamentos e alertas**, crie um alerta de gasto (ex.: R$ 50/mês).
6. Cole a chave na variável `GOOGLE_PLACES_API_KEY` no Railway.

Cada "consulta" ao Google traz até 20 empresas. O site não repete buscas feitas nos últimos 30 dias e para no limite que você escolher em cada rodada.

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

Os testes usam versões **simuladas** do Google e da Receita: não precisam de internet e não gastam cota.

## Variáveis opcionais

| Variável | Para quê |
|---|---|
| `DATA_DIR` | Pasta dos dados (no Docker já é `/data`). |
| `SESSION_SECRET` | Segredo das sessões. Sem ele, o segredo é derivado da senha, e trocar a senha desconecta todo mundo. |
| `RECEITA_BASE_URL` | Endereço dos dados abertos de CNPJ, caso a Receita mude o local dos arquivos. |
| `RECEITA_MES` | Força um mês específico dos dados da Receita (`AAAA-MM`). |
