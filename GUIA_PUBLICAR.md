# Colocar o BioMatch na internet

O projeto está preparado para o Render. A publicação usa um serviço Node único para servir a página e manter as salas multiplayer por WebSocket.

## Publicar

1. Crie um repositório no GitHub e envie para ele **o conteúdo desta pasta** `BioMatch` (os arquivos devem ficar na raiz do repositório, incluindo `render.yaml` e `package.json`). O arquivo `.gitignore` evita enviar arquivos temporários.
2. Acesse [Render](https://dashboard.render.com/) e conecte sua conta do GitHub.
3. No Render, escolha **New → Blueprint**, selecione o repositório do BioMatch e confirme a criação do serviço descrito em `render.yaml`.
4. Aguarde o primeiro deploy. Quando aparecer o endereço `https://...onrender.com`, abra-o no celular e compartilhe esse mesmo link com a turma. O navegador usa HTTPS/WSS automaticamente; não há aplicativo para instalar.

O serviço inicial está no plano gratuito para você experimentar. No Render, esse tipo de serviço pode dormir após 15 minutos sem mensagens e levar cerca de um minuto para acordar. A página envia um sinal de conexão por minuto enquanto a sala está aberta, o que mantém uma sala ativa; feche a sala ou a aba quando terminar. A franquia gratuita de horas é compartilhada na conta.

## Para usar com uma turma

- Faça a publicação antes da aula; um deploy ou reinício encerra conexões e remove as salas em andamento.
- Comece com uma única instância. O jogo guarda sala, participantes, cronômetro e pontuação na memória daquele processo. Se o serviço reiniciar, as partidas terminam; em várias instâncias, os participantes podem cair em servidores diferentes.
- O teste local com 30 bots mostrou que o fluxo funciona nesse computador, mas não garante o mesmo resultado no plano gratuito nem em redes escolares. Antes de uma aula importante, faça uma rodada real com alguns celulares e a mesma rede que será usada.
- Para uma experiência sem pausa inicial e com mais folga de CPU, escolha uma instância paga sempre ativa no Render. Confira os limites e valores mostrados no painel antes de confirmar qualquer plano.
- O projeto não armazena contas nem resultados permanentes. Os apelidos são temporários; evite incluir dados pessoais.

## Atualizar depois

Envie as alterações para o mesmo repositório do GitHub. O Render publica a nova versão automaticamente. Evite fazer isso enquanto uma partida estiver acontecendo, pois a sala atual existe apenas na memória do processo.
