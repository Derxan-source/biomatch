# Estado da versão BioMatch

## Implementado nesta versão

- Experiência em português, mobile-first, com telas inicial, criação/entrada, sala de espera, quiz ao vivo, revelação, placar final e estudo individual.
- Perguntas simultâneas para anfitrião e participantes, com sala de até 30 conexões.
- Código de convite, apelidos temporários, limite por sala e equipes não são usados: cada participante responde e pontua individualmente.
- O anfitrião apresenta as questões e controla o avanço; jogadores escolhem uma de quatro opções pelo próprio dispositivo.
- Cronômetro de 20 segundos validado no servidor, uma resposta por participante, pontuação baseada em acerto e velocidade, e feedback com explicação.
- Ranking atualizado entre as perguntas e no encerramento.
- Banco estruturado com 20 questões, quatro alternativas e explicação por item.
- Proteções básicas: validação de dados no servidor, códigos aleatórios, limite de tentativas, limite de sala e controle de host.
- Manual, gabarito, ficha do grupo, roteiro de apresentação e instruções para execução.

## Ainda precisa de validação

- Teste com 30 aparelhos físicos e redes reais; o teste de bots abaixo exercita o servidor local num único computador.
- Chrome Android, Safari iOS, orientação vertical/horizontal e rede móvel instável.
- Duração média em turma para avaliar a meta de 10–20 minutos.
- Revisão do banco com o material do professor e inclusão de fontes por questão.
- Implantação HTTPS/WSS e revisão de segurança para exposição pública.

## Limitações conhecidas

- Salas, pontos e sessões existem apenas na memória de um processo e desaparecem quando ele reinicia.
- A reconexão funciona no mesmo navegador por até um minuto; não transfere sessão entre dispositivos.
- O anfitrião conta no limite de 30 e não pontua. Se sair, outro participante assume a condução.
- Não há autenticação, histórico, persistência, administração de conteúdo ou escala entre processos.
- O limite de sala está implementado e o fluxo foi exercitado com 30 conexões simuladas locais; isso não comprova suporte de produção, conectividade de dispositivos reais ou escala entre processos.
- DM Sans/Manrope/DM Mono são carregadas do Google Fonts quando a rede permite; fontes do sistema são alternativas.

## Ensaio de carga local

`load-test.js` simula clientes WebSocket, faz com que cada bot responda corretamente e avança o quiz até o fim. Contra o servidor local, 13 participantes completaram 10 perguntas em 56,8 segundos (média de 42 ms entre pergunta e revelação); 30 participantes completaram 10 perguntas em 144,2 segundos (média de 115 ms). Ambos os ensaios registraram zero falhas. O modo solo também completou 10 perguntas em 0,6 s, sem falhas. Os bots entram espaçados para respeitar o limite por endereço IP. Para repetir, use `node load-test.js --players 30 --questions 10` com o servidor ativo e Node.js 22 ou mais recente.
