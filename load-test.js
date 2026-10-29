'use strict';
// Simula participantes reais usando apenas o WebSocket nativo do Node.js.
const questions=require('./questions.json');
const options=new Map();
for(let i=2;i<process.argv.length;i++)if(process.argv[i].startsWith('--'))options.set(process.argv[i].slice(2),process.argv[i+1]&&!process.argv[i+1].startsWith('--')?process.argv[++i]:true);
const total=Number(options.get('players')||13); // total inclui o anfitrião
const questionCount=Number(options.get('questions')||10);
const joinDelay=Number(options.get('join-delay-ms')||5100);
const answerDelay=Number(options.get('answer-delay-ms')||25);
const timeoutMs=Number(options.get('timeout-ms')||240000);
const base=String(options.get('url')||'http://localhost:3000').replace(/\/$/,'');
const wsUrl=base.replace(/^http/,'ws')+'/ws';
if(typeof WebSocket==='undefined'){console.error('Este teste requer Node.js 22 ou mais recente (WebSocket nativo).');process.exit(1)}
if(!Number.isInteger(total)||total<1||total>30){console.error('--players deve ficar entre 1 e 30, contando o anfitrião; 1 executa um teste solo.');process.exit(1)}
if(![10,15,20].includes(questionCount)){console.error('--questions deve ser 10, 15 ou 20.');process.exit(1)}
if(!Number.isInteger(joinDelay)||joinDelay<0||!Number.isInteger(answerDelay)||answerDelay<0){console.error('Os intervalos precisam ser números inteiros não negativos.');process.exit(1)}

const clients=[], errors=[], roundStarts=new Map(), roundDurations=[], handledQuestions=new Set();
const startedAt=Date.now();
let roomCode='', joined=0, lastProgress=0, finished=false, questionMessages=0, revealMessages=0, peakOpen=0, host;
const timer=setTimeout(()=>finish(false,`tempo limite excedido após ${Math.round(timeoutMs/1000)} s`),timeoutMs);
function progress(){const pct=Math.floor(joined*100/total);if(pct>=lastProgress+10||joined===total){lastProgress=pct;console.log(`Conexões: ${joined}/${total}`)}}
function fail(message){errors.push(message);console.error(`Falha: ${message}`)}
function finish(ok,reason=''){
 if(finished)return;finished=true;clearTimeout(timer);
 for(const ws of clients)try{ws.close()}catch{}
 const seconds=(Date.now()-startedAt)/1000;
 console.log('\nResultado do teste');
 console.log(`- Sala: ${roomCode||'não criada'}`);
 console.log(`- Participantes, incluindo anfitrião: ${joined}/${total}`);
 console.log(`- Perguntas concluídas: ${roundDurations.length}/${questionCount}`);
 console.log(`- Atualizações de pergunta/revelação: ${questionMessages}/${revealMessages}`);
 if(roundDurations.length)console.log(`- Resposta até revelação, média: ${(roundDurations.reduce((a,b)=>a+b,0)/roundDurations.length).toFixed(0)} ms`);
 console.log(`- Duração: ${seconds.toFixed(1)} s; pico de conexões abertas: ${peakOpen}`);
 console.log(`- Falhas: ${errors.length}${reason?`; ${reason}`:''}`);
 process.exitCode=ok&&errors.length===0?0:1;
}
function countJoined(){joined++;peakOpen=Math.max(peakOpen,clients.filter(ws=>ws.readyState===WebSocket.OPEN).length);progress();if(joined===total)setTimeout(()=>{if(!finished&&host?.readyState===WebSocket.OPEN)host.send(JSON.stringify({type:'start_quiz',soloTest:total===1}))},50)}
function handleParticipantMessage(nickname,ws,event){
 let message;try{message=JSON.parse(event.data)}catch{return fail(`${nickname}: mensagem inválida`)}
 if(message.type==='error')return fail(`${nickname}: ${message.message}`);
 if(message.type==='room_joined'){if(nickname!=='Anfitrião')countJoined();return}
 if(message.type!=='state_update')return;
 if(message.phase==='question'){
  questionMessages++;
  if(nickname==='Anfitrião'){if(!roundStarts.has(message.questionNumber))roundStarts.set(message.questionNumber,Date.now());if(total>1)return}
  const key=`${nickname}:${message.questionNumber}`;
  if(handledQuestions.has(key))return;
  handledQuestions.add(key);
  const q=message.question, source=questions.find(item=>item.id===q?.id);
  if(!source)return fail(`${nickname}: questão não encontrada`);
  const choice=q.options.indexOf(source.options[source.answer]);
  if(choice<0)return fail(`${nickname}: alternativa correta ausente`);
  setTimeout(()=>{if(!finished&&ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify({type:'submit_answer',choice}))},answerDelay);
 }else if(message.phase==='reveal'&&nickname==='Anfitrião'){
  revealMessages++;
  const n=message.questionNumber;
  if(roundStarts.has(n)&&!handledQuestions.has(`round:${n}`)){
   handledQuestions.add(`round:${n}`);roundDurations.push(Date.now()-roundStarts.get(n));
   setTimeout(()=>{if(!finished&&ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify({type:'next_question'}))},10);
  }
 }else if(message.phase==='finished'&&nickname==='Anfitrião')finish(errors.length===0);
}
function connect(nickname,isHost=false){
 const ws=new WebSocket(wsUrl);clients.push(ws);
 ws.addEventListener('open',()=>{
  if(isHost)ws.send(JSON.stringify({type:'create_room',nickname:'Anfitrião',questions:questionCount}));
  else ws.send(JSON.stringify({type:'join_room',code:roomCode,nickname}));
 });
 ws.addEventListener('error',()=>{if(!finished)fail(`${nickname}: erro na conexão`)});
 ws.addEventListener('close',()=>{if(!finished)fail(`${nickname}: conexão fechada antes do fim do teste`)});
 ws.addEventListener('message',event=>{
  let message;try{message=JSON.parse(event.data)}catch{return fail(`${nickname}: mensagem inválida`)}
  if(message.type==='error')return fail(`${nickname}: ${message.message}`);
  if(message.type==='room_joined'){
   if(isHost){roomCode=message.room;joined=1;peakOpen=1;progress();for(let i=1;i<total;i++)setTimeout(()=>connect(`Bot${String(i).padStart(2,'0')}`), (i-1)*joinDelay);if(total===1)setTimeout(()=>host.send(JSON.stringify({type:'start_quiz',soloTest:true})),50)}
   else countJoined();
   return;
  }
  handleParticipantMessage(nickname,ws,event);
 });
 if(isHost)host=ws;
}

console.log(`Iniciando teste: ${total} participantes, ${questionCount} perguntas, intervalo de entrada ${joinDelay} ms.`);
connect('Anfitrião',true);
