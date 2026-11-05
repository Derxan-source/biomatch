# BioMatch — plataforma multidisciplinar

## Escopo
- Quatro disciplinas: Biologia, Química, História e Informática.
- Banco inicial com 5 perguntas por disciplina.
- Modo de revisão com feedback e explicações.
- XP, níveis, medalhas, missão diária e estatísticas por disciplina.
- Ranking e partidas ao vivo. Recursos sociais permanecem desativados até haver controles adequados de privacidade, bloqueio e denúncia.
- Modo visitante, cadastro e entrada por e-mail/senha e recuperação de senha pelo Firebase Authentication. A entrada com Google foi cancelada.

## Persistência Turso
A plataforma multidisciplinar e o quiz ao vivo usam `platform-db.js`, `live-store.js` e `@libsql/client` para armazenar perfis, tentativas, progresso e estado de salas em SQLite/libSQL no Turso.

Configure no Render (Environment):
- `TURSO_DATABASE_URL`: URL `libsql://...` do banco.
- `TURSO_AUTH_TOKEN`: token de autenticação do banco.
- `FIREBASE_PROJECT_ID`: identificador do projeto Firebase.
- `FIREBASE_WEB_API_KEY`: chave web pública do Firebase (restrinja-a às APIs Identity Toolkit e Secure Token).
- `FIREBASE_AUTH_DOMAIN`: domínio Auth do projeto, normalmente `<project-id>.firebaseapp.com`.
- `FIREBASE_SERVICE_ACCOUNT_JSON`: JSON da conta de serviço para o Admin SDK. Mantenha somente como segredo do Render.

O endpoint público `/api/firebase-config` expõe somente project ID, Auth domain e a chave web, que o Firebase espera no cliente. A chave privada da conta de serviço permanece no backend. Em produção, use uma conta de serviço com permissões mínimas do Firebase Authentication e nunca comite o JSON.

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
- O Firebase Authentication envia os emails de redefinição e hospeda a tela segura de troca da senha. Adicione o domínio `onrender.com` em Authentication > Settings > Authorized domains e ative o provedor Email/Password.

## Desenvolvimento local
```bash
npm install
npm start
```
Se as variáveis Turso não estiverem definidas, o desenvolvimento local cria `biomatch.local.db` no diretório do projeto.


## Login e contas
Cadastro, login, redefinição e manutenção de sessões são realizados pelo Firebase Authentication. O navegador envia o ID token à API; o backend verifica assinatura, validade e revogação pelo Firebase Admin SDK e usa o UID como chave do perfil no Turso. Tokens de renovação ficam no navegador e são usados para renovar o ID token. Perfis de visitantes continuam sem Firebase.

## Migração das contas existentes
O script `npm run migrate:firebase-auth` lê diretamente perfis com email e hash scrypt do Turso e importa-os em lotes para Firebase Auth, preservando UID, email, nome e senha. Não gera arquivo com os hashes. Ele só limpa `password_hash` e sessões legadas depois de verificar que todas as contas estão no Firebase. Configure temporariamente as quatro variáveis Firebase, `TURSO_DATABASE_URL` e `TURSO_AUTH_TOKEN` no ambiente seguro que executar o script. Faça backup do Turso antes da migração e mantenha o script em execução até a confirmação final. Em caso de erro, os hashes antigos são preservados e a mensagem indica o lote que precisa de atenção. Após a migração, as contas antigas precisarão entrar novamente porque as sessões locais anteriores serão invalidadas.

O importador usa `STANDARD_SCRYPT` com os parâmetros usados por `crypto.scrypt` sem opções explícitas (N=16384, r=8, p=1 e chave derivada de 64 bytes). A importação real precisa ser validada contra o projeto Firebase de destino antes de remover as credenciais antigas.
