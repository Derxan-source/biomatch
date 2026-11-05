# BioMatch — plataforma multidisciplinar

## Escopo
- Quatro disciplinas: Biologia, Química, História e Informática.
- Banco inicial com 5 perguntas por disciplina.
- Modo de revisão com feedback e explicações.
- XP, níveis, medalhas, missão diária e estatísticas por disciplina.
- Ranking, amizades, mensagens e convites de desafios. O estado das salas ao vivo também é salvo no Turso e restaurado quando o servidor reinicia.
- Modo visitante sem login; Google OAuth continua adiado.

## Persistência Turso
A API multidisciplinar e o quiz ao vivo usam `platform-db.js`, `live-store.js` e `@libsql/client` para armazenar perfis, tentativas, progresso, amizades, mensagens, desafios e estado de salas em SQLite/libSQL no Turso.

Configure no Render (Environment):
- `TURSO_DATABASE_URL`: URL `libsql://...` do banco.
- `TURSO_AUTH_TOKEN`: token de autenticação do banco.

Os valores são lidos somente pelo backend e nunca devem ser enviados ao navegador ou commitados no Git. Em produção, a inicialização falha de forma explícita se as variáveis estiverem ausentes. Em desenvolvimento local, se ambas estiverem ausentes, o módulo usa `file:./biomatch.local.db`.

Na primeira chamada da API, o backend executa as instruções idempotentes de `db/schema.sqlite.sql` para criar as tabelas e índices. Não é necessário colar o token em nenhum arquivo do repositório.

## Tabelas
- `users`: perfil de visitante, XP, níveis, estatísticas e medalhas.
- `question_attempts`: tentativas e pontuação, com proteção contra resposta duplicada por questão.
- `friendships`: convites de amizade.
- `direct_messages`: mensagens diretas.
- `challenges`: convites de desafios.
- `live_rooms`: estado serializado das salas, participantes, sessões, perguntas, placar e respostas para restauração após reinício.
- `live_question_sets`: conjuntos de perguntas geradas, com expiração, para que o token de criação não dependa da memória do processo.

## Limitações atuais
- Visitantes usam um identificador salvo no `localStorage` do navegador. O progresso fica salvo no banco, mas limpar os dados do navegador ou trocar de dispositivo ainda impede a recuperação sem uma conta autenticada.
- Amizades e desafios são registrados como convites; aceite/recusa e partidas competitivas completas serão etapas posteriores.
- O quiz ao vivo mantém em memória apenas sockets, timers e mapas de execução enquanto o processo está ativo. O estado de salas, jogadores, sessões de reconexão, placares, perguntas e respostas é persistido em `live_rooms` e restaurado na inicialização. Tokens temporários de perguntas geradas são persistidos em `live_question_sets`.
- O banco de questões inicial contém 20 perguntas e deve ser ampliado/revisado pedagogicamente.
- Google OAuth não está incluído.

## Desenvolvimento local
```bash
npm install
npm start
```
Se as variáveis Turso não estiverem definidas, o desenvolvimento local cria `biomatch.local.db` no diretório do projeto.
