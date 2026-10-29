# Intensivão ENEM

Site de provas de Linguagens com questões reais do ENEM (2020, 2022, 2023, 2024 e 2025, 1º dia, caderno azul),
focado em interpretação: variação linguística, funções da linguagem, estratégias argumentativas, objetivo e função
social do texto, esporte e mídia, arte e identidade, humor e metalinguagem.

- **Frontend:** HTML, CSS e JavaScript puro, hospedado no GitHub Pages.
- **Backend:** Supabase (Auth, Postgres com RLS e Realtime).

## O que tem

- Login com e-mail e senha, perfil com apelido.
- Provas de 10 questões sorteadas por tema, priorizando questões que você ainda não viu.
- Correção **no servidor**: o gabarito fica numa tabela que nenhum usuário consegue ler. O navegador só recebe o
  gabarito depois de entregar a prova.
- XP, níveis com títulos, sequência de dias estudando.
- Conquistas (algumas secretas) e missões diárias.
- Estatísticas: acerto por tema, evolução das últimas provas, tema para revisar.
- Revanche (refazer as mesmas questões).
- **Desafio:** cria uma sala com código, todos fazem a mesma prova e comparam no placar.
- **Coop:** a equipe responde junta em tempo real, com chat. Cada um vê quem marcou cada alternativa, e quem entrega,
  entrega pela equipe. Todos ganham XP.
- Ranking semanal opcional (só aparece quem ativar no perfil).
- Mascote que reage às respostas, modo foco, temas visuais desbloqueáveis e easter eggs.

O texto-base de cada questão (com imagens) abre direto no PDF oficial do Inep, na página certa.

## Como colocar no ar

### 1. Supabase

1. No painel do projeto, abra **SQL Editor** e rode, nesta ordem:
   1. `supabase/schema.sql`
   2. `supabase/seed_questions.sql`
   3. `supabase/seed_keys.sql` (o gabarito; **este arquivo não vai para o GitHub**, ele está no `.gitignore`)
   Tudo fica no schema `enem`, então o projeto pode ser compartilhado com outro app sem conflito.
2. Em **Integrations → Data API → Settings → Exposed schemas**, marque `enem` e salve.
3. Em **Authentication → URL Configuration → Redirect URLs**, adicione
   `https://SEU-USUARIO.github.io/NOME-DO-REPO/**` (e `http://localhost:8000/**` se for testar no seu computador).
   Não precisa mudar a Site URL.
4. Em **Authentication → Providers → Email**, deixe ligado. Se não quiser confirmação por e-mail durante os testes,
   desligue "Confirm email".
5. O Realtime (usado no modo coop) já funciona com canais de broadcast e presence; não precisa ativar nada em tabelas.

### 2. GitHub Pages

1. Crie um repositório e suba **todos os arquivos desta pasta, menos `supabase/seed_keys.sql`**.
2. Em **Settings → Pages**, escolha **Deploy from a branch**, branch `main`, pasta `/ (root)`.
3. Abra `https://SEU-USUARIO.github.io/NOME-DO-REPO/`.

### Testar no computador

```bash
python -m http.server 8000
```

Depois abra `http://localhost:8000/`. Abrir o `index.html` direto (file://) não funciona por causa dos módulos JS.

## Segurança

- `js/config.js` tem só a URL e a **chave publicável** (`sb_publishable_...`). Ela pode ser pública: o que protege
  os dados são as políticas RLS do `schema.sql`.
- **Nunca** coloque a chave secreta (`sb_secret_...`) nem a senha do banco no código.
- Os usuários não escrevem direto em nenhuma tabela. Provas, XP, missões, conquistas e salas passam por funções do
  servidor (`submit_attempt`, `create_room`, `unlock_secret`). No perfil, o usuário só pode mudar o apelido e a opção
  de ranking.
- Limites conhecidos: o tempo de prova e a marcação de "mudou a resposta" vêm do navegador. Uma prova entregue em
  menos de 8 segundos por questão não rende XP, para evitar farm. O gabarito de uma questão fica conhecido por quem
  já a respondeu, como em qualquer simulado.

## Estrutura

```
index.html            página única
css/style.css         visual (temas Noite, Papel e Fliperama)
js/config.js          URL e chave publicável do Supabase
js/app.js             telas, provas, salas, coop, estatísticas
js/mascot.js          mascote em pixel art
supabase/schema.sql   tabelas, RLS e funções
supabase/seed_questions.sql   102 questões (enunciado, alternativas, tema, página do PDF)
supabase/seed_keys.sql        gabarito (não versionar)
```

## Adicionar questões

Insira em `questions` (id no formato `ANO-NUMERO`, ex.: `2023-8`) e o gabarito em `question_keys`
(0 = A, 1 = B, 2 = C, 3 = D, 4 = E) pelo SQL Editor.

As questões são do ENEM, aplicado pelo Inep. Os textos-base são dos respectivos autores e ficam no PDF oficial.
