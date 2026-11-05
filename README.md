# BioMatch

BioMatch é uma plataforma educacional gamificada para Biologia, Química, História e Informática, com modo visitante, contas, progresso salvo e partidas ao vivo. A interface usa uma direção escura com verde e destaca a aprendizagem por etapas.

## Executar

Requer Node.js 22.22.0, conforme `.node-version` e `package.json`.

```powershell
cd biomatch
npm ci
npm start
```

Abra `http://localhost:3000`. Para acesso de celulares na mesma rede Wi-Fi, use o endereço local do computador que executa o servidor, por exemplo `http://192.168.x.x:3000`. A rede precisa permitir comunicação entre aparelhos.

`HOST` e `PORT` são opcionais; `.env.example` documenta os nomes, mas o servidor não lê esse arquivo automaticamente. No PowerShell, altere a porta com `$env:PORT=3001; node server.js`. A rota `/health` retorna o estado básico do processo.

## Jogar

- No painel, escolha uma disciplina para estudar no seu ritmo ou crie uma partida ao vivo com o banco de questões.
- O anfitrião cria uma sala e escolhe 10, 15 ou 20 perguntas. Um código de seis caracteres é gerado para a turma.
- A sala de espera mostra um QR e um link direto com o código já preenchido; quem entra ainda informa um apelido.
- O anfitrião pode remover participantes da sala de espera ou da rodada em andamento.
- Se a sala ainda estiver só com o anfitrião, o botão “Testar sozinho” permite responder e conferir as perguntas sem esperar por outra pessoa.
- Até 30 pessoas, contando o anfitrião, entram com apelidos temporários.
- O anfitrião inicia e projeta as perguntas; participantes respondem no próprio dispositivo.
- Cada pergunta tem quatro opções e 20 segundos. A primeira resposta enviada é a definitiva. O anfitrião não responde: ele conduz a rodada.
- Respostas corretas rendem de 500 a 1.000 pontos conforme a rapidez. Erros e tempo esgotado valem zero.
- Quando todos respondem ou o cronômetro termina, o servidor revela a alternativa correta, explica o conceito e atualiza o ranking. O anfitrião avança para a próxima.
- O modo de estudo individual não tem cronômetro e mostra a explicação logo após cada escolha.

O servidor é a autoridade para perguntas, cronômetro, respostas e pontos. O estado durável das salas e placares fica no Turso e é restaurado após reinício. Sockets e timers permanecem em memória enquanto o processo está ativo. A sessão fica salva no navegador e permite reconectar no mesmo aparelho por até 15 minutos após uma queda.

## Conteúdo

`questions.json` é a fonte única do banco inicial com 20 questões distribuídas entre Biologia, Química, História e Informática. Cada item traz quatro alternativas, gabarito e explicação curta. É uma base de revisão; antes do uso escolar, confirme os tópicos efetivamente estudados e compare as respostas com o material do professor.

## Implantação na internet

O projeto já inclui `package.json` e `render.yaml` para publicar como um único serviço Node no Render, com WebSocket e verificação de saúde. Veja o passo a passo em `GUIA_PUBLICAR.md`. Não aumente o número de instâncias sem coordenar salas ativas entre processos.

O fundo WebGL roda somente na tela inicial de computadores; em telas estreitas e celulares, usa gradientes CSS estáticos. O efeito também pausa quando a aba fica oculta, nas telas internas e quando o sistema pede movimento reduzido. Os arquivos do quiz são servidos pelo mesmo domínio, e a conexão usa WSS automaticamente em HTTPS.

## Arquivos

- `index.html`, `styles.css`, `app.js`, `ambient-background.js`: interface, interações e fundo animado em WebGL com alternativa estática.
- `qrcode-generator.js` e `qrcode-generator-LICENSE.txt`: gerador QR carregado localmente quando a sala de espera é exibida.
- `questions.json`: banco de questões, gabarito e explicações.
- `server.js`: HTTP, salas, regras multiplayer e batimento da conexão.
- `load-test.js`: simulador de participantes para ensaios de carga (requer Node.js 22+).
- `package.json`, `render.yaml`, `GUIA_PUBLICAR.md`: inicialização e roteiro de hospedagem no Render.
- `MANUAL.md`, `GABARITO.md`, `FICHA_DO_GRUPO.md`, `APRESENTACAO.md` e `RELATORIO.md`: materiais do projeto.

## Teste com participantes simulados

Com o servidor iniciado em outro terminal, execute um ensaio completo de 10 perguntas:

```powershell
node load-test.js --players 13 --questions 10
node load-test.js --players 30 --questions 10
node load-test.js --players 1 --questions 10
```

`--players` conta também o anfitrião: `1` executa uma partida solo e `2` a `30` simulam uma turma. As entradas são espaçadas para respeitar o limite de segurança de tentativas por endereço. Para testar outro servidor, informe `--url https://endereco-do-jogo`. O relatório mostra conexões, perguntas completadas, latência média até a revelação e falhas.

## Estado da validação

O simulador completou 10 perguntas com 13 participantes em 56,8 s e com 30 participantes em 144,2 s, sem falhas, contra o servidor local. A resposta até a revelação levou em média 42 ms e 115 ms, respectivamente. Isso valida o fluxo de conexões simuladas em um único computador; não equivale a 30 aparelhos ou redes reais. Chrome Android, Safari iOS, reconexão em rede móvel e duração de uma rodada com turma ainda precisam de validação. Isso também não comprova capacidade de produção ou de múltiplas instâncias.

