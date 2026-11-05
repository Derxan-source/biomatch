# BioMatch — plataforma multidisciplinar

## Escopo
- Quatro disciplinas: Biologia, Química, História e Informática.
- Banco inicial com 5 perguntas por disciplina.
- Modo de revisão com feedback e explicações.
- XP, níveis, medalhas, missão diária e estatísticas por disciplina.
- Ranking, amizades, mensagens e convites de desafios.
- Modo visitante sem login; Google OAuth continua adiado.

## Persistência Turso
A API multidisciplinar usa `platform-db.js` e `@libsql/client` para armazenar perfis, tentativas, progresso, amizades, mensagens e desafios em SQLite/libSQL no Turso.

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

## Limitações atuais
- Visitantes usam um identificador armazenado em `sessionStorage`. O progresso fica salvo no banco, mas limpar os dados da sessão ou trocar de navegador perde o vínculo com o perfil; ainda não há recuperação de conta.
- Amizades e desafios são registrados como convites; aceite/recusa e partidas competitivas completas serão etapas posteriores.
- O quiz ao vivo antigo continua separado e usa seu próprio fluxo de salas em memória.
- O banco de questões inicial contém 20 perguntas e deve ser ampliado/revisado pedagogicamente.
- Google OAuth não está incluído.

## Desenvolvimento local
```bash
npm install
npm start
```
Se as variáveis Turso não estiverem definidas, o desenvolvimento local cria `biomatch.local.db` no diretório do projeto.
