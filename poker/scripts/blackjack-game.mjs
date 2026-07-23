// ============================================================
// Card Games VTT — scripts/blackjack-game.mjs
// v2: Dealer bank · Round history · Sounds
// ============================================================

import { getStakesConfig, setDisplayStakes, isCurrencyMode,
         getActorFunds, deductFunds, addFunds, startingFunds, fmt } from "./currency.mjs";
export { fmt };

const SUITS=["♠","♥","♦","♣"];
const RANKS=["2","3","4","5","6","7","8","9","10","J","Q","K","A"];
const DEALER_BANK_DEFAULT=200;

function buildDeck(){
  const d=[];
  for(const s of SUITS)for(const r of RANKS)d.push({rank:r,suit:s});
  return d.sort(()=>Math.random()-.5);
}
function cardValue(card){
  if(["J","Q","K"].includes(card.rank))return 10;
  if(card.rank==="A")return 11;
  return parseInt(card.rank);
}
function handTotal(hand){
  let total=0,aces=0;
  for(const c of hand){total+=cardValue(c);if(c.rank==="A")aces++;}
  while(total>21&&aces>0){total-=10;aces--;}
  return total;
}
export function bjTotal(hand){return handTotal(hand);}

export const bjInitialState=()=>({
  phase:"setup",
  stakes:{mode:"none",key:"gp",stack:1000}, // captured at startGame
  players:[],
  dealer:{hand:[],hidden:true},
  dealerBank:DEALER_BANK_DEFAULT,
  deck:[],
  log:[],
  currentPlayerIdx:0,
  roundHistory:[],
  roundNum:0,
});

export class BlackjackGame {
  constructor(){this.S=bjInitialState();window._bjGame=this;}

  push(){
    window._pokerEmit?.("BJ_STATE",{state:this.S});
    window._bjApp?.onStateUpdate(this.S);
  }
  log(msg){this.S.log.unshift(msg);if(this.S.log.length>40)this.S.log.pop();}

  startGame({players,dealerBank=DEALER_BANK_DEFAULT}){
    const stakes=getStakesConfig();
    this.S.stakes=stakes;
    setDisplayStakes(stakes);
    const built=[],excluded=[];
    for(const p of players){
      const actor=p.actorId?game.actors.get(p.actorId):null;
      const funds=startingFunds(actor,stakes);
      // currency mode: minimum bet is 0.5 — no funds, no seat
      if(isCurrencyMode(stakes)&&funds<0.5){
        excluded.push(actor?.name??game.i18n.localize("POKER.P.Player"));
        continue;
      }
      built.push({name:actor?.name??game.i18n.localize("POKER.P.Player"),actorId:p.actorId,userId:p.userId,
        platinum:funds,
        hand:[],bet:0,stood:false,busted:false,done:false,sittingOut:false,
        result:"",isWinner:false,sessionWon:0,sessionLost:0});
    }
    if(excluded.length){
      const msg=game.i18n.format("POKER.Stakes.Excluded",{names:excluded.join(", ")});
      ui.notifications?.warn(msg);
      this.log(msg);
    }
    if(built.length<1){
      ui.notifications?.warn(game.i18n.localize("POKER.Stakes.TooFewWithFunds"));
      this.S.phase="setup";this.push();return;
    }
    this.S.players=built;
    this.S.dealerBank=dealerBank;
    this.S.roundNum=0;
    this.S.roundHistory=[];
    this.log(game.i18n.format("POKER.BJ.LogStart",{n:fmt(dealerBank)}));
    this.newRound();
  }

  newRound(){
    this.S.roundNum++;
    this.S.deck=buildDeck();
    this.S.dealer={hand:[],hidden:true};
    this.S.currentPlayerIdx=0;
    this.S.players.forEach(p=>{
      if(isCurrencyMode(this.S.stakes)){
        const actor=p.actorId?game.actors.get(p.actorId):null;
        if(actor)p.platinum=getActorFunds(actor,this.S.stakes);
      }
      p.hand=[];p.bet=0;p.stood=false;p.busted=false;p.done=false;p.result="";p.isWinner=false;p.isPush=false;
      // broke players sit the round out instead of blocking the deal
      p.sittingOut=p.platinum<0.5;
      if(p.sittingOut){
        p.done=true;p.result="—";
        this.log(game.i18n.format("POKER.Stakes.SitOut",{name:p.name}));
      }
    });
    this.S.phase="betting";
    window._pokerSound?.("new_round.mp3");
    this.log(game.i18n.format("POKER.BJ.LogRound",{n:this.S.roundNum,bank:fmt(this.S.dealerBank)}));
    this.push();
  }

  async placeBet({playerIdx,amount}){
    const p=this.S.players[playerIdx];
    if(!p||p.sittingOut||this.S.phase!=="betting")return;
    const actor=p.actorId?game.actors.get(p.actorId):null;
    if(actor&&isCurrencyMode(this.S.stakes))p.platinum=getActorFunds(actor,this.S.stakes);
    const bet=Math.min(Math.max(0.5,amount),p.platinum,this.S.dealerBank);
    p.bet=Math.round(bet*100)/100;
    this.log(game.i18n.format("POKER.BJ.LogBet",{name:p.name,n:fmt(p.bet)}));
    if(this.S.players.every(p2=>p2.bet>0||p2.sittingOut))this._dealInitial();
    else this.push();
  }

  async _dealInitial(){
    this.S.phase="playing";
    window._pokerSound?.("dealing.mp3");
    for(const p of this.S.players)if(!p.sittingOut)p.hand=[this.S.deck.pop(),this.S.deck.pop()];
    this.S.dealer.hand=[this.S.deck.pop(),this.S.deck.pop()];
    this.S.dealer.hidden=true;
    this.S.players.forEach(p=>{
      if(p.sittingOut)return;
      if(handTotal(p.hand)===21){p.done=true;p.result="Blackjack!";this.log(game.i18n.format("POKER.BJ.LogBJ",{name:p.name}));}
    });
    this.S.currentPlayerIdx=this._nextActive(0);
    if(this.S.currentPlayerIdx===-1){await this._dealerTurn();return;}
    this.log(game.i18n.format("POKER.BJ.LogTurn",{name:this.S.players[this.S.currentPlayerIdx].name}));
    this.push();
  }

  _nextActive(from){
    for(let i=from;i<this.S.players.length;i++){
      if(!this.S.players[i].done&&!this.S.players[i].stood&&!this.S.players[i].busted)return i;
    }
    return -1;
  }

  async playerHit({playerIdx}){
    const p=this.S.players[playerIdx];
    if(!p||p.done||p.stood||p.busted||this.S.phase!=="playing")return;
    if(this.S.currentPlayerIdx!==playerIdx)return;
    p.hand.push(this.S.deck.pop());
    window._pokerSound?.("put_card.mp3");
    const total=handTotal(p.hand);
    this.log(game.i18n.format("POKER.BJ.LogHit",{name:p.name,total}));
    if(total>21){p.busted=true;p.done=true;p.result=game.i18n.localize("POKER.BJ.ResBust");this.log(game.i18n.format("POKER.BJ.LogBust",{name:p.name}));await this._advance();}
    else if(total===21){p.done=true;p.result="21!";this.log(`🎯 ${p.name} — 21!`);await this._advance();}
    else this.push();
  }

  async playerStand({playerIdx}){
    const p=this.S.players[playerIdx];
    if(!p||p.done||p.stood||p.busted||this.S.currentPlayerIdx!==playerIdx)return;
    p.stood=true;p.done=true;
    this.log(game.i18n.format("POKER.BJ.LogStand",{name:p.name,total:handTotal(p.hand)}));
    await this._advance();
  }

  async playerDouble({playerIdx}){
    const p=this.S.players[playerIdx];
    if(!p||p.done||p.stood||p.busted||p.hand.length!==2||this.S.currentPlayerIdx!==playerIdx)return;
    const actor=p.actorId?game.actors.get(p.actorId):null;
    if(actor&&isCurrencyMode(this.S.stakes))p.platinum=getActorFunds(actor,this.S.stakes);
    const extra=Math.min(p.bet,p.platinum,this.S.dealerBank-p.bet);
    p.bet=Math.round((p.bet+extra)*100)/100;
    p.hand.push(this.S.deck.pop());
    window._pokerSound?.("put_card.mp3");
    const total=handTotal(p.hand);
    p.stood=true;p.done=true;
    this.log(game.i18n.format("POKER.BJ.LogDouble",{name:p.name,bet:fmt(p.bet),total}));
    if(total>21){p.busted=true;p.result=game.i18n.localize("POKER.BJ.ResBust");this.log(game.i18n.format("POKER.BJ.LogBust",{name:p.name}));}
    await this._advance();
  }

  async _advance(){
    const next=this._nextActive(this.S.currentPlayerIdx+1);
    if(next===-1){await this._dealerTurn();}
    else{this.S.currentPlayerIdx=next;this.log(game.i18n.format("POKER.BJ.LogTurn",{name:this.S.players[next].name}));this.push();}
  }

  async _dealerTurn(){
    this.S.phase="dealer";
    this.S.dealer.hidden=false;
    window._pokerSound?.("put_card.mp3");
    const anyAlive=this.S.players.some(p=>!p.busted);
    if(anyAlive){
      while(handTotal(this.S.dealer.hand)<17){
        this.S.dealer.hand.push(this.S.deck.pop());
        window._pokerSound?.("put_card.mp3");
      }
    }
    this.log(game.i18n.format("POKER.BJ.LogDealerTotal",{n:handTotal(this.S.dealer.hand)}));
    await this._resolve();
  }

  async _resolve(){
    this.S.phase="result";
    const dt=handTotal(this.S.dealer.hand);
    const dealerBust=dt>21;
    const roundWinners=[];

    for(const p of this.S.players){
      if(p.sittingOut)continue;
      const actor=p.actorId?game.actors.get(p.actorId):null;
      const pt=handTotal(p.hand);
      if(p.busted){
        p.result=game.i18n.format("POKER.BJ.BustN",{n:pt});p.isWinner=false;
        p.sessionLost=(p.sessionLost||0)+p.bet;
        // Dealer gains
        this.S.dealerBank=Math.round((this.S.dealerBank+p.bet)*100)/100;
        if(actor)await deductFunds(actor,p.bet,this.S.stakes);
        p.platinum=Math.round((p.platinum-p.bet)*100)/100;
        this.log(game.i18n.format("POKER.BJ.LogLose",{name:p.name,n:fmt(p.bet)}));
      } else if(p.result==="Blackjack!"&&dt!==21){
        const win=Math.round(p.bet*1.5*100)/100;
        const actual=Math.min(win,this.S.dealerBank);
        p.isWinner=true;p.result=game.i18n.format("POKER.BJ.BJPlus",{n:fmt(actual)});
        p.sessionWon=(p.sessionWon||0)+actual;
        this.S.dealerBank=Math.round((this.S.dealerBank-actual)*100)/100;
        if(actor)await addFunds(actor,actual,this.S.stakes);
        p.platinum=Math.round((p.platinum+actual)*100)/100;
        roundWinners.push(p.name);
        this.log(game.i18n.format("POKER.BJ.LogBJWin",{name:p.name,n:fmt(actual)}));
      } else if(dealerBust||pt>dt){
        const actual=Math.min(p.bet,this.S.dealerBank);
        p.isWinner=true;p.result=game.i18n.format("POKER.BJ.WinPlus",{n:fmt(actual)});
        p.sessionWon=(p.sessionWon||0)+actual;
        this.S.dealerBank=Math.round((this.S.dealerBank-actual)*100)/100;
        if(actor)await addFunds(actor,actual,this.S.stakes);
        p.platinum=Math.round((p.platinum+actual)*100)/100;
        roundWinners.push(p.name);
        this.log(game.i18n.format("POKER.BJ.LogWin",{name:p.name,n:fmt(actual)}));
      } else if(pt===dt){
        p.isPush=true;p.result=game.i18n.format("POKER.BJ.PushN",{n:pt});
        this.log(game.i18n.format("POKER.BJ.LogPush",{name:p.name}));
      } else {
        p.result=game.i18n.format("POKER.BJ.LoseN",{pt,dt});
        p.sessionLost=(p.sessionLost||0)+p.bet;
        this.S.dealerBank=Math.round((this.S.dealerBank+p.bet)*100)/100;
        if(actor)await deductFunds(actor,p.bet,this.S.stakes);
        p.platinum=Math.round((p.platinum-p.bet)*100)/100;
        this.log(game.i18n.format("POKER.BJ.LogLose",{name:p.name,n:fmt(p.bet)}));
      }
    }

    // Round history
    this.S.roundHistory.unshift({
      round:this.S.roundNum,
      dealerTotal:dt,dealerBust,
      winners:roundWinners.join(", ")||game.i18n.localize("POKER.BJ.DealerWord"),
      dealerBank:this.S.dealerBank,
    });
    if(this.S.roundHistory.length>20)this.S.roundHistory.pop();

    // Check dealer bankruptcy
    if(this.S.dealerBank<=0){
      this.log(game.i18n.localize("POKER.BJ.BankEmpty"));
    }
    this.push();
  }

  resetToSetup(){this.S.phase="setup";this.push();}
}
