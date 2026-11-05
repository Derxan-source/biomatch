# BioMatch — plataforma multidisciplinar

## Escopo
- Quatro disciplinas: Biologia, Química, História e Informática.
- Banco inicial com 5 perguntas por disciplina.
- Modo de revisão com feedback e explicações.
- XP, níveis, medalhas, missão diária e estatísticas por disciplina.
- Ranking e partidas ao vivo. Recursos sociais permanecem desativados até haver controles adequados de privacidade, bloqueio e denúncia.
- Modo visitante sem login, cadastro e entrada por e-mail/senha, Google OAuth e recuperação de senha por e-mail.

## Persistência Turso
A plataforma multidisciplinar e o quiz ao vivo usam `platform-db.js`, `live-store.js` e `@libsql/client` para armazenar perfis, tentativas, progresso e estado de salas em SQLite/libSQL no Turso.

Configure no Render (Environment):
- `TURSO_DATABASE_URL`: URL `libsql://...` do banco.
- `TURSO_AUTH_TOKEN`: token de autenticação do banco.
- `APP_BASE_URL`: URL pública do serviço (`https://biomatch-oyxn.onrender.com` no Render confirmado).
- `GOOGLE_CLIENT_ID`: identificador público do cliente OAuth.
- `GOOGLE_CLIENT_SECRET`: segredo OAuth, somente no Render.
- `GOOGLE_REDIRECT_URI`: `https://biomatch-oyxn.onrender.com/auth/google/callback`.
- `RESEND_API_KEY` e `RESEND_FROM_EMAIL`: credenciais do envio de redefinição de senha.

Os valores são lidos somente pelo backend e nunca devem ser enviados ao navegador ou commitados no Git. Em produção, a inicialização falha de forma explícita se as variáveis estiverem ausentes. Em desenvolvimento local, se ambas estiverem ausentes, o módulo usa `file:./biomatch.local.db`.

Na primeira chamada da API, o backend executa as instruções idempotentes de `db/schema.sqlite.sql` para criar as tabelas e índices. Não é necessário colar o token em nenhum arquivo do repositório.

## Tabelas
- `users`: perfil de visitante, XP, níveis, estatísticas e medalhas.
- `question_attempts`: tentativas e pontuação, com proteção contra resposta duplicada por questão.
- `live_rooms`: estado serializado das salas, participantes, sessões, perguntas, placar e respostas para restauração após reinício.

## Limitações atuais
- Visitantes usam um identificador salvo no `localStorage` do navegador. O progresso fica salvo no banco, mas limpar os dados do navegador ou trocar de dispositivo ainda impede a recuperação sem uma conta autenticada.
- Amigos, mensagens e desafios estão desativados até que privacidade, aceite/recusa, bloqueio e denúncia sejam implementados.
- O quiz ao vivo mantém em memória apenas sockets, timers e mapas de execução enquanto o processo está ativo. O estado de salas, jogadores, sessões de reconexão, placares, perguntas e respostas é persistido em `live_rooms` e restaurado na inicialização.
- O banco de questões inicial contém 20 perguntas e deve ser ampliado/revisado pedagogicamente.
- Login Google e redefinição de senha exigem as variáveis do Google OAuth e Resend no ambiente de produção. O Client Secret e a chave Resend não devem ser commitados.

## Desenvolvimento local
```bash
npm install
npm start
```
Se as variáveis Turso não estiverem definidas, o desenvolvimento local cria `biomatch.local.db` no diretório do projeto.


## Login e contas
A tela inicial oferece entrada por e-mail e senha, criação de conta, Google OAuth e modo visitante. As senhas são derivadas com scrypt e salt aleatório; sessões usam tokens aleatórios cujo hash SHA-256 é armazenado em `auth_sessions`, com validade de 30 dias. O OAuth usa `state`, PKCE, validação da identidade do Google e um código de troca de uso único. A redefinição gera token aleatório forte, guarda apenas seu hash, expira em 30 minutos, limita tentativas e invalida todas as sessões após a troca da senha. A resposta de solicitação de recuperação não revela se o e-mail tem cadastro.
