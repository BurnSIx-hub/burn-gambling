// ============================================================
// Poker Table VTT — scripts/poker-game.mjs
// v4: Blinds · Dealer button · Session history
// ============================================================

import { getStakesConfig, setDisplayStakes, isCurrencyMode,
         getActorFunds, deductFunds, addFunds, startingFunds, fmt } from "./currency.mjs";
export { fmt };

const SUITS = ["♠","♥","♦","♣"];
const RANKS = ["2","3","4","5","6","7","8","9","10","J","Q","K","A"];

function buildDeck(){
  const d=[];
  for(const s of SUITS) for(const r of RANKS) d.push({rank:r,suit:s});
  return d.sort(()=>Math.random()-.5);
}
function deal(deck,n=1){return deck.splice(0,n);}
function rankVal(r){return RANKS.indexOf(r);}

function handRank(cards){
  const rv=cards.map(c=>rankVal(c.rank)).sort((a,b)=>b-a);
  const suits=cards.map(c=>c.suit);
  const flush=suits.every(s=>s===suits[0]);
  const normalStraight=rv.every((v,i)=>i===0||rv[i-1]-v===1);
  const wheelStraight=rv[0]===12&&rv[1]===3&&rv[2]===2&&rv[3]===1&&rv[4]===0;
  const straight=normalStraight||wheelStraight;
  const topStraight=wheelStraight?3:rv[0];
  const cnt={};
  rv.forEach(v=>cnt[v]=(cnt[v]||0)+1);
  const groups=Object.entries(cnt).map(([v,f])=>({v:Number(v),f})).sort((a,b)=>b.f-a.f||b.v-a.v);
  const freq=groups.map(g=>g.f);
  const tb=groups.map(g=>g.v);
  if(flush&&straight)        return{score:8,name:"Straight Flush",tiebreak:[topStraight]};
  if(freq[0]===4)            return{score:7,name:"Four of a Kind",tiebreak:tb};
  if(freq[0]===3&&freq[1]===2)return{score:6,name:"Full House",tiebreak:tb};
  if(flush)                  return{score:5,name:"Flush",tiebreak:rv};
  if(straight)               return{score:4,name:"Straight",tiebreak:[topStraight]};
  if(freq[0]===3)            return{score:3,name:"Three of a Kind",tiebreak:tb};
  if(freq[0]===2&&freq[1]===2)return{score:2,name:"Two Pair",tiebreak:tb};
  if(freq[0]===2)            return{score:1,name:"One Pair",tiebreak:[groups[0].v]};
  return{score:0,name:"High Card",tiebreak:rv};
}
function compareTiebreak(a,b){
  for(let i=0;i<Math.max(a.length,b.length);i++){const d=(a[i]??-1)-(b[i]??-1);if(d!==0)return d;}
  return 0;
}
function bestHand(cards){
  if(cards.length<=5) return handRank(cards);
  let best=null;
  for(const combo of getCombos(cards,5)){
    const h=handRank(combo);
    if(!best||h.score>best.score||(h.score===best.score&&compareTiebreak(h.tiebreak,best.tiebreak)>0))best=h;
  }
  return best;
}
function getCombos(arr,k){
  if(k===0)return[[]];if(arr.length<k)return[];
  const[h,...t]=arr;
  return[...getCombos(t,k-1).map(c=>[h,...c]),...getCombos(t,k)];
}

export const initialState=()=>({
  phase:"setup",bettingFor:null,
  stakes:{mode:"none",key:"gp",stack:1000}, // captured at startGame

  players:[],deck:[],community:[],
  pot:0,currentBetLevel:0,
  bettingOrder:[],bettingIdx:0,
  log:[],resultBanner:"",
  dealerIdx:0,           // index of dealer button
  smallBlindAmt:1,       // configurable
  bigBlindAmt:2,
  roundHistory:[],       // [{round, winner, amount, combo}]
  roundNum:0,
});

export class PokerGame {
  constructor(){this.S=initialState();window._pokerGame=this;}

  push(){
    window._pokerEmit?.("POKER_STATE",{state:this.S});
    window._pokerApp?.onStateUpdate(this.S);
  }
  addLog(msg){this.S.log.unshift(msg);if(this.S.log.length>80)this.S.log.pop();}

  async startGame({players,smallBlind=1,bigBlind=2}){
    const stakes=getStakesConfig();
    this.S.stakes=stakes;
    setDisplayStakes(stakes);
    const built=[],excluded=[];
    for(const p of players){
      const actor=p.actorId?game.actors.get(p.actorId):null;
      const funds=startingFunds(actor,stakes);
      // currency mode: don't seat players who can't cover the big blind
      if(isCurrencyMode(stakes)&&funds<bigBlind){
        excluded.push(actor?.name??game.i18n.localize("POKER.P.Player"));
        continue;
      }
      built.push({
        name:actor?.name??game.i18n.localize("POKER.P.Player"),actorId:p.actorId,userId:p.userId,
        platinum:funds,
        hand:[],folded:false,allIn:false,
        currentBet:0,roundBet:0,
        isWinner:false,handRank:"",checkedThisRound:false,
        sessionWon:0,sessionLost:0,  // history tracking
      });
    }
    if(excluded.length){
      const msg=game.i18n.format("POKER.Stakes.Excluded",{names:excluded.join(", ")});
      ui.notifications?.warn(msg);
      this.addLog(msg);
    }
    if(built.length<2){
      ui.notifications?.warn(game.i18n.localize("POKER.Stakes.TooFewWithFunds"));
      this.S.phase="setup";this.push();return;
    }
    this.S.players=built;
    this.S.smallBlindAmt=smallBlind;
    this.S.bigBlindAmt=bigBlind;
    this.S.dealerIdx=0;
    this.S.roundNum=0;
    this.S.roundHistory=[];
    this.addLog(game.i18n.localize("POKER.P.LogStart")+fmt(smallBlind)+"/"+fmt(bigBlind));
    this.startRound();
  }

  async startRound(){
    this.S.roundNum++;
    this.S.deck=buildDeck();
    this.S.community=[];this.S.pot=0;this.S.resultBanner="";
    this.S.currentBetLevel=0;this.S.bettingOrder=[];this.S.bettingIdx=0;
    const n=this.S.players.length;

    // Move dealer button
    if(this.S.roundNum>1){
      this.S.dealerIdx=(this.S.dealerIdx+1)%n;
    }

    // Deal cards
    const busted=[];
    this.S.players.forEach(p=>{
      // currency mode: the sheet is the source of truth between hands;
      // chips mode: the virtual stack persists for the whole session
      if(isCurrencyMode(this.S.stakes)){
        const actor=p.actorId?game.actors.get(p.actorId):null;
        if(actor)p.platinum=getActorFunds(actor,this.S.stakes);
      }
      p.hand=[deal(this.S.deck)[0],deal(this.S.deck)[0]];
      p.folded=false;p.allIn=false;p.currentBet=0;
      p.roundBet=0;p.isWinner=false;p.handRank="";p.checkedThisRound=false;
      // busted players sit out instead of going all-in with nothing
      if(p.platinum<=0){p.folded=true;busted.push(p.name);}
    });
    busted.forEach(n=>this.addLog(game.i18n.format("POKER.Stakes.Busted",{name:n})));
    window._pokerSound?.("dealing.mp3");
    this.addLog(game.i18n.format("POKER.P.LogDealt",{n:this.S.roundNum,name:this.S.players[this.S.dealerIdx].name}));

    // Post blinds
    const sbIdx=(this.S.dealerIdx+1)%n;
    const bbIdx=(this.S.dealerIdx+2)%n;
    await this._postBlind(sbIdx, this.S.smallBlindAmt, game.i18n.localize("POKER.P.SmallBlind"));
    await this._postBlind(bbIdx, this.S.bigBlindAmt,   game.i18n.localize("POKER.P.BigBlind"));

    // Betting starts after BB
    this.S.bettingFor="preflop";
    this.S.phase="betting";
    this.S.currentBetLevel=this.S.bigBlindAmt;
    const firstAct=(bbIdx+1)%n;
    this.S.bettingOrder=[];
    for(let i=0;i<n;i++){
      const idx=(firstAct+i)%n;
      if(!this.S.players[idx].folded&&!this.S.players[idx].allIn)
        this.S.bettingOrder.push(idx);
    }
    this.S.bettingIdx=0;
    this.addLog(game.i18n.format("POKER.P.LogPreFlop",{sb:fmt(this.S.smallBlindAmt),bb:fmt(this.S.bigBlindAmt)}));
    this.push();
  }

  async _postBlind(idx,amount,label){
    const p=this.S.players[idx];
    if(!p||p.folded)return;
    const actor=p.actorId?game.actors.get(p.actorId):null;
    const actual=Math.min(amount,p.platinum);
    if(actual<=0)return;
    if(actor)await deductFunds(actor,actual,this.S.stakes);
    p.platinum=Math.round((p.platinum-actual)*100)/100;
    p.roundBet=Math.round(((p.roundBet||0)+actual)*100)/100;
    p.currentBet=Math.round(((p.currentBet||0)+actual)*100)/100;
    this.S.pot=Math.round((this.S.pot+actual)*100)/100;
    if(p.platinum<=0)p.allIn=true;
    this.addLog(`${p.name} — ${label} ${fmt(actual)}`);
  }

  startBettingRound(forPhase){
    this.S.phase="betting";this.S.bettingFor=forPhase;
    this.S.currentBetLevel=0;
    this.S.players.forEach(p=>{p.roundBet=0;p.checkedThisRound=false;});
    this.S.bettingOrder=this.S.players.map((_,i)=>i)
      .filter(i=>!this.S.players[i].folded&&!this.S.players[i].allIn);
    this.S.bettingIdx=0;
    this.addLog(game.i18n.localize("POKER.P.LogBetting")+this._pl(forPhase)+" ──");
    this.push();
  }

  _done(){
    const a=this.S.players.filter(p=>!p.folded&&!p.allIn);
    if(!a.length)return true;
    if(this.S.currentBetLevel===0)return a.every(p=>p.checkedThisRound);
    return a.every(p=>p.roundBet===this.S.currentBetLevel);
  }

  async handleBet({playerIdx,amount}){
    const p=this.S.players[playerIdx];
    if(!p||p.folded||p.allIn)return;
    const actor=p.actorId?game.actors.get(p.actorId):null;
    if(actor&&isCurrencyMode(this.S.stakes))p.platinum=getActorFunds(actor,this.S.stakes);
    const toCall=Math.round((this.S.currentBetLevel-(p.roundBet||0))*100)/100;
    if(amount===0){
      if(toCall>0)return;
      p.checkedThisRound=true;
      this.addLog(game.i18n.format("POKER.P.LogCheck",{name:p.name}));
    } else {
      if(amount<toCall&&amount<p.platinum)return;
      const actual=Math.round(Math.min(amount,p.platinum)*100)/100;
      if(actor)await deductFunds(actor,actual,this.S.stakes);
      p.platinum=Math.round((p.platinum-actual)*100)/100;
      p.currentBet=Math.round(((p.currentBet||0)+actual)*100)/100;
      p.roundBet=Math.round(((p.roundBet||0)+actual)*100)/100;
      this.S.pot=Math.round((this.S.pot+actual)*100)/100;
      if(p.platinum<=0)p.allIn=true;
      const isRaise=p.roundBet>this.S.currentBetLevel;
      this.addLog(game.i18n.format("POKER.P.LogCallRaise",{name:p.name,action:game.i18n.localize(isRaise?"POKER.P.Raise":"POKER.P.CallWord"),amount:fmt(actual),pot:fmt(this.S.pot)}));
      if(isRaise){
        this.S.currentBetLevel=p.roundBet;
        this.S.bettingOrder=this.S.players.map((_,i)=>i)
          .filter(i=>!this.S.players[i].folded&&!this.S.players[i].allIn&&i!==playerIdx);
        this.S.bettingOrder.push(playerIdx);
        this.S.bettingIdx=0;
        this.push();return;
      }
    }
    this._next();
  }

  async handleFold({playerIdx}){
    const p=this.S.players[playerIdx];
    if(!p||p.folded)return;
    p.folded=true;
    this.addLog(game.i18n.format("POKER.P.LogFold",{name:p.name}));
    const active=this.S.players.filter(x=>!x.folded);
    if(active.length===1){await this._award([active[0]]);return;}
    this.S.bettingOrder=this.S.bettingOrder.filter(i=>i!==playerIdx);
    if(this.S.bettingIdx>=this.S.bettingOrder.length)this.S.bettingIdx=0;
    this._next();
  }

  _next(){
    this.S.bettingIdx++;
    const rem=this.S.bettingOrder.slice(this.S.bettingIdx)
      .filter(i=>!this.S.players[i].folded&&!this.S.players[i].allIn);
    if(this._done()||rem.length===0)this.finishBettingRound();
    else this.push();
  }

  finishBettingRound(){
    const n=this.S.bettingFor;
    this.addLog(game.i18n.localize("POKER.P.LogBetsDone")+fmt(this.S.pot)+" ──");
    if(n==="preflop"){
      this.S.phase="preflop";
    } else if(n==="flop"){
      window._pokerSound?.("put_card.mp3");
      this.S.community=deal(this.S.deck,3);
      this.S.phase="flop";
      this.addLog(game.i18n.localize("POKER.P.LogFlop")+this.S.community.map(c=>c.rank+c.suit).join(" "));
    } else if(n==="turn"){
      window._pokerSound?.("put_card.mp3");
      this.S.community.push(...deal(this.S.deck,1));
      this.S.phase="turn";
      this.addLog(game.i18n.localize("POKER.P.LogTurn")+this.S.community[3].rank+this.S.community[3].suit);
    } else if(n==="river"){
      window._pokerSound?.("put_card.mp3");
      this.S.community.push(...deal(this.S.deck,1));
      this.S.phase="river";
      this.addLog(game.i18n.localize("POKER.P.LogRiver")+this.S.community[4].rank+this.S.community[4].suit);
    }
    this.push();
  }

  doShowdown(){
    this.S.phase="showdown";
    const active=this.S.players.filter(p=>!p.folded);
    let bestResult=null,winners=[];
    active.forEach(p=>{
      const h=bestHand([...p.hand,...this.S.community]);
      p.handScore=h.score;p.handRank=h.name;p._tiebreak=h.tiebreak;
      if(!bestResult){bestResult=h;winners=[p];}
      else if(h.score>bestResult.score){bestResult=h;winners=[p];}
      else if(h.score===bestResult.score){
        const cmp=compareTiebreak(h.tiebreak,bestResult.tiebreak);
        if(cmp>0){bestResult=h;winners=[p];}
        else if(cmp===0)winners.push(p);
      }
    });
    this._award(winners);
  }

  async _award(ws){
    const share=Math.round((this.S.pot/ws.length)*100)/100;
    for(const w of ws){
      w.isWinner=true;
      w.platinum=Math.round(((w.platinum||0)+share)*100)/100;
      w.sessionWon=(w.sessionWon||0)+share;
      const actor=w.actorId?game.actors.get(w.actorId):null;
      if(actor)await addFunds(actor,share,this.S.stakes);
    }
    // Track losers session stats
    this.S.players.filter(p=>!p.isWinner).forEach(p=>{
      p.sessionLost=(p.sessionLost||0)+(p.currentBet||0);
    });
    const names=ws.map(w=>w.name).join(" & ");
    const combo=ws[0].handRank?` · ${ws[0].handRank}`:"";
    this.S.resultBanner=game.i18n.format("POKER.P.LogWinSplit",{names,share:fmt(share),combo});
    this.S.pot=0;this.S.phase="showdown";
    this.addLog(game.i18n.format("POKER.P.LogWinTake",{names,share:fmt(share),combo}));
    // Add to round history
    this.S.roundHistory.unshift({
      round:this.S.roundNum,
      winner:names,
      amount:share,
      combo:ws[0].handRank||"",
    });
    if(this.S.roundHistory.length>20)this.S.roundHistory.pop();
    this.push();
  }

  resetToSetup(){this.S.phase="setup";this.S.resultBanner="";this.push();}

  _pl(ph){
    return({preflop:"Pre-Flop",flop:"Flop",turn:"Turn",river:"River",
            showdown:"Showdown",betting:game.i18n.localize("POKER.P.PhaseBetting"),setup:game.i18n.localize("POKER.P.PhasePrep")})[ph]||ph;
  }
}
