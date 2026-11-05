# BioMatch — plataforma multidisciplinar (etapa em desenvolvimento)

## Escopo desta etapa
- Tela de entrada e sessão de visitante.
- Quatro disciplinas: Biologia, Química, História e Informática.
- Banco inicial com 5 perguntas por disciplina (20 no total).
- Revisão sem cronômetro, com feedback e explicação.
- XP calculado no servidor: 100 por acerto e 10 por tentativa incorreta.
- Níveis de 500 XP, medalhas por volume de respostas e missão diária de 3 questões.
- Indicadores gerais e por disciplina.
- Ranking temporário, convites de amizade, mensagens e desafios entre visitantes ativos.
- Esquema SQL inicial para futura persistência de perfis, tentativas, amizades, mensagens e desafios.

## Como funciona atualmente
O modo visitante usa sessionStorage no navegador. A API cria um identificador temporário e mantém perfil, XP, tentativas e interações em memória no processo Node.js. Isso permite testar funcionalidades sem autenticação, mas os dados podem ser perdidos quando o servidor reinicia ou quando a sessão termina. O ranking mostra apenas visitantes ativos no processo atual.

O modo de estudo multidisciplinar usa `question-banks.json`. O quiz ao vivo antigo continua usando `questions.json` e seu fluxo próprio de salas.

## Limitações conhecidas / próxima fase
- Google OAuth não está incluído nesta etapa.
- O banco PostgreSQL está descrito em `db/schema.sql`, mas ainda não foi conectado ao servidor. Portanto, o progresso ainda não é permanente.
- O sistema social é um MVP: as interações funcionam entre visitantes ativos no mesmo processo; convites não têm aceite/recusa nem notificações em tempo real.
- Desafios são convites registrados, ainda sem partida competitiva dedicada.
- A sequência diária está reservada no modelo, mas ainda não é calculada com calendário de dias consecutivos.
- A biblioteca inicial tem 20 perguntas; ampliar e revisar o conteúdo pedagógico é uma etapa importante.

## Próximas melhorias recomendadas
1. Conectar PostgreSQL e migrar o estado temporário para tabelas.
2. Adicionar aceite/recusa de amizades, caixa de entrada e notificações.
3. Transformar desafios em partidas com perguntas, placar e resultado.
4. Aumentar o banco de questões com revisão pedagógica e níveis de dificuldade.
5. Implementar autenticação Google e associação segura entre visitante e conta permanente.
6. Adicionar testes automatizados para API, pontuação, progressão e regras sociais.

## Desenvolvimento local
```bash
npm start
```
Abra `http://localhost:3000`. Entre como visitante com um apelido e selecione uma disciplina.
