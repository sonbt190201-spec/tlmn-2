
import { Card, Player, Move, HandType, GameHistory, PlayerHistoryEntry, PayoutResult, GameEventRecord } from './types.js';
import { detectHandType, compareHands, sortCards, checkInstantWin } from './ruleValidator.js';
import { dealCards } from './deckManager.js';
import { MoneyEngine } from './moneyEngine.js';

export type GamePhase = "waiting" | "playing" | "finished";

export interface PlayMoveResult {
  error: string | null;
  chopInfo?: {
    attackerId: string;
    victimId: string;
    type: 'CHOP' | 'OVER_CHOP';
    amount: number;
    handType: string;
  };
}

export class GameInstance {
  players: Player[];
  bet: number;
  currentTurn: number = 0;
  lastMove: Move | null = null;
  gamePhase: GamePhase = "waiting";
  isFirstGame: boolean = true;
  passedPlayers: Set<string> = new Set();
  finishedPlayers: string[] = []; 
  startingPlayerId: string | null = null;
  history: GameHistory[] = [];
  
  private lastPayouts: PayoutResult[] = [];
  private roundEvents: GameEventRecord[] = [];
  private lastWasInstantWin: boolean = false;
  private isFirstMoveOfGame: boolean = false; 
  
  private chopChain: { attackerId: string, victimId: string, value: number }[] = [];

  constructor(playerData: { id: string, name: string, balance: number }[], initialBet: number) {
    this.players = playerData.map(p => ({
      id: p.id,
      name: p.name,
      balance: p.balance,
      hand: [],
      hasPlayedAnyCard: false,
      isBurned: false,
      penalties: []
    }));
    this.bet = initialBet || 10000;
  }

  setHistory(history: GameHistory[]) {
    this.history = history;
  }

  setPersistentState(state: any) {
    if (!state) return;
    this.isFirstGame = state.isFirstGame;
    this.lastWasInstantWin = state.lastWasInstantWin;
    this.startingPlayerId = state.startingPlayerId;
    this.history = state.history || [];
  }

  getInternalState() {
    return {
      isFirstGame: this.isFirstGame,
      lastWasInstantWin: this.lastWasInstantWin,
      startingPlayerId: this.startingPlayerId,
      history: this.history
    };
  }

  startNewRound() {
    if (this.players.length < 2) throw new Error("Cần ít nhất 2 người chơi");
    const hands = dealCards(this.players.map(p => p.id));
    this.gamePhase = "playing";
    this.lastMove = null;
    this.passedPlayers.clear();
    this.finishedPlayers = [];
    this.lastPayouts = [];
    this.chopChain = [];
    this.roundEvents = [];
    this.isFirstMoveOfGame = this.isFirstGame; 

    this.players.forEach(p => {
      const handData = hands.find(h => h.playerId === p.id);
      p.hand = sortCards(handData?.cards || []);
      p.finishedRank = undefined;
      p.hasPlayedAnyCard = false;
      p.isBurned = false;
    });

    for (const p of this.players) {
      const reason = checkInstantWin(p.hand, this.isFirstGame);
      if (reason) {
        this.handleInstantWin(p.id, reason);
        return;
      }
    }

    if (this.isFirstGame || this.lastWasInstantWin) {
      const starterIdx = this.players.findIndex(p => p.hand.some(c => c.rank === 3 && c.suit === 'spade'));
      this.currentTurn = starterIdx !== -1 ? starterIdx : 0;
    } else if (this.startingPlayerId) {
      const idx = this.players.findIndex(p => p.id === this.startingPlayerId);
      this.currentTurn = idx !== -1 ? idx : 0;
    }
  }

  private handleInstantWin(winnerId: string, reason: string) {
    const payouts = MoneyEngine.calculateTrangMoney(winnerId, this.players.map(p => p.id), this.bet);
    payouts.forEach(pay => {
      const p = this.players.find(pl => pl.id === pay.playerId);
      if (p) { p.balance += pay.change; this.lastPayouts.push(pay); }
    });

    this.finishedPlayers = [winnerId];
    this.players.forEach(p => { 
      if(p.id !== winnerId) {
        this.finishedPlayers.push(p.id);
        p.finishedRank = 4;
      }
    });

    this.roundEvents.push({ type: 'INSTANT_WIN', playerName: winnerId, description: `Ăn trắng: ${reason}`, timestamp: Date.now() });
    this.gamePhase = "finished";
    this.startingPlayerId = winnerId;
    this.isFirstGame = false;
    this.lastWasInstantWin = true; 
    this.recordHistory();
  }

  playMove(playerId: string, cardIds: string[]): PlayMoveResult {
    if (this.gamePhase !== "playing") return { error: "Ván bài đã kết thúc" };
    const player = this.players.find(p => p.id === playerId);
    if (!player) return { error: "Người chơi không tồn tại" };
    
    const cards = player.hand.filter(c => cardIds.includes(c.id));
    if (cards.length !== cardIds.length) return { error: "Bài không hợp lệ" };

    if (this.isFirstMoveOfGame) {
      const hasThreeSpade = cards.some(c => c.rank === 3 && c.suit === 'spade');
      if (!hasThreeSpade) return { error: "Ván đầu tiên bắt buộc phải đánh lá 3 Bích (3♠)!" };
    }

    const handType = detectHandType(cards);
    if (handType === HandType.INVALID) return { error: "Bộ bài không hợp lệ" };

    const isFourPairs = handType === HandType.FOUR_CONSECUTIVE_PAIRS;
    const isFreeChop = isFourPairs && this.lastMove && compareHands(cards, this.lastMove.cards) === 1;

    // Kiểm tra lượt: Người chơi phải đúng lượt HOẶC đang chặt tự do (4 đôi thông)
    if (this.players[this.currentTurn].id !== playerId && !isFreeChop) {
      return { error: "Chưa tới lượt" };
    }

    if (this.passedPlayers.has(playerId) && !isFreeChop) {
      return { error: "Bạn đã bỏ lượt của vòng này" };
    }

    if (this.lastMove) {
      if (compareHands(cards, this.lastMove.cards) !== 1) return { error: "Bộ bài không đủ mạnh để chặn" };
      
      const isAttackerHang = [HandType.THREE_CONSECUTIVE_PAIRS, HandType.FOUR_OF_A_KIND, HandType.FOUR_CONSECUTIVE_PAIRS].includes(handType);
      const isVictimHeo = this.lastMove.cards.some(c => c.rank === 15);
      const isVictimHang = [HandType.THREE_CONSECUTIVE_PAIRS, HandType.FOUR_OF_A_KIND, HandType.FOUR_CONSECUTIVE_PAIRS].includes(this.lastMove.type);

      if (isAttackerHang && (isVictimHeo || isVictimHang)) {
        let val = 0;
        if (isVictimHeo) {
          this.lastMove.cards.filter(c => c.rank === 15).forEach(c => {
            val += (c.suit === 'heart' || c.suit === 'diamond') ? this.bet : this.bet * 0.5;
          });
        } else {
          const vType = this.lastMove.type;
          if (vType === HandType.THREE_CONSECUTIVE_PAIRS) val = this.bet * 1.5;
          else if (vType === HandType.FOUR_OF_A_KIND) val = this.bet * 4; 
          else if (vType === HandType.FOUR_CONSECUTIVE_PAIRS) val = this.bet * 4;
        }
        
        const victimId = this.lastMove.playerId;
        this.chopChain.push({ attackerId: playerId, victimId: victimId, value: val });
        const eventType = this.chopChain.length > 1 ? 'OVER_CHOP' : 'CHOP';
        const totalAmount = this.chopChain.reduce((sum, item) => sum + item.value, 0);
        
        this.resolveChopChain();
        player.hand = player.hand.filter(c => !cardIds.includes(c.id));
        player.hasPlayedAnyCard = true;
        
        // Reset trạng thái bỏ lượt vì có chặt
        this.passedPlayers.clear();
        this.lastMove = { type: handType, cards, playerId, timestamp: Date.now() };
        this.currentTurn = this.players.findIndex(p => p.id === playerId);
        this.isFirstMoveOfGame = false;
        
        if (player.hand.length === 0) this.handlePlayerFinish(player);
        else this.moveToNextPlayer();
        
        let visualChopType: any = "three_pairs";
        if (handType === HandType.FOUR_OF_A_KIND) visualChopType = "four_of_a_kind";
        else if (handType === HandType.FOUR_CONSECUTIVE_PAIRS) visualChopType = "four_pairs";

        return { error: null, chopInfo: { attackerId: playerId, victimId: victimId, type: eventType, amount: totalAmount, handType: visualChopType } };
      }
    }

    player.hand = player.hand.filter(c => !cardIds.includes(c.id));
    player.hasPlayedAnyCard = true;
    this.lastMove = { type: handType, cards, playerId, timestamp: Date.now() };
    this.currentTurn = this.players.findIndex(p => p.id === playerId);
    this.isFirstMoveOfGame = false;

    if (player.hand.length === 0) {
      this.handlePlayerFinish(player);
    } else {
      this.moveToNextPlayer();
    }

    return { error: null };
  }

  private resolveChopChain() {
    if (this.chopChain.length === 0) return;
    const last = this.chopChain[this.chopChain.length - 1];
    const total = this.chopChain.reduce((sum, item) => sum + item.value, 0);
    const winner = this.players.find(p => p.id === last.attackerId);
    const victim = this.players.find(p => p.id === last.victimId);

    if (winner && victim) {
      victim.balance -= total;
      winner.balance += total;
      const eventType = this.chopChain.length > 1 ? 'OVER_CHOP' : 'CHOP';
      this.roundEvents.push({ type: eventType, fromPlayerId: victim.id, toPlayerId: winner.id, playerName: winner.name, targetName: victim.name, amount: total, description: `${winner.name} chặt ${victim.name} thu ${total.toLocaleString()}$`, timestamp: Date.now() });
      this.lastPayouts.push({ playerId: winner.id, change: total, reason: eventType === 'CHOP' ? "Thắng chặt" : "Thắng chặt chồng" });
      this.lastPayouts.push({ playerId: victim.id, change: -total, reason: eventType === 'CHOP' ? "Bị chặt" : "Bị chặt chồng" });
    }
    this.chopChain = [];
  }

  passTurn(playerId: string) {
    if (this.players[this.currentTurn].id !== playerId || !this.lastMove) return;
    this.passedPlayers.add(playerId);
    this.moveToNextPlayer();
  }

  private moveToNextPlayer() {
    if (this.gamePhase !== "playing") return;

    // LUẬT CỐT LÕI: Kiểm tra xem vòng chơi đã kết thúc chưa.
    // Vòng kết thúc khi TẤT CẢ người chơi ACTIVE (ngoại trừ người đang giữ bài cao nhất) đã bỏ lượt.
    const activePlayers = this.players.filter(p => !this.finishedPlayers.includes(p.id));
    const ownerId = this.lastMove?.playerId;
    
    // Đối thủ ACTIVE là những người chưa về bài và không phải người đánh lá bài hiện tại
    const activeOpponents = activePlayers.filter(p => p.id !== ownerId);
    const allOpponentsPassed = activeOpponents.every(p => this.passedPlayers.has(p.id));

    if (allOpponentsPassed && ownerId) {
      this.resetRound(ownerId);
      return;
    }

    // Nếu vòng chưa kết thúc, tìm người chơi ACTIVE tiếp theo chưa bỏ lượt
    const playerCount = this.players.length;
    let nextIdx = (this.currentTurn + 1) % playerCount;

    for (let i = 0; i < playerCount; i++) {
      const p = this.players[nextIdx];
      const isFinished = this.finishedPlayers.includes(p.id);
      const hasPassed = this.passedPlayers.has(p.id);

      // Nếu đã quay lại chính chủ bài mà vòng chưa reset (do lỗi logic nào đó) -> Reset
      if (ownerId && p.id === ownerId) {
        this.resetRound(ownerId);
        return;
      }

      if (!isFinished && !hasPassed) {
        this.currentTurn = nextIdx;
        return;
      }
      nextIdx = (nextIdx + 1) % playerCount;
    }

    // Trường hợp xấu nhất nếu không tìm thấy ai, reset về chủ bài
    if (ownerId) this.resetRound(ownerId);
  }

  private resetRound(winnerId: string) {
    this.resolveChopChain();
    this.lastMove = null;
    this.passedPlayers.clear();
    
    let leadIdx = this.players.findIndex(p => p.id === winnerId);
    
    // Nếu người thắng vòng chơi đã về (FINISHED), quyền đánh vòng mới (LEAD)
    // sẽ thuộc về người chơi ACTIVE kế tiếp theo vòng tròn.
    if (this.finishedPlayers.includes(winnerId)) {
      const playerCount = this.players.length;
      let nextIdx = (leadIdx + 1) % playerCount;
      for (let i = 0; i < playerCount; i++) {
        if (!this.finishedPlayers.includes(this.players[nextIdx].id)) {
          leadIdx = nextIdx;
          break;
        }
        nextIdx = (nextIdx + 1) % playerCount;
      }
    }
    
    this.currentTurn = leadIdx;
  }

  private handlePlayerFinish(player: Player) {
    if (this.finishedPlayers.includes(player.id)) return;
    this.finishedPlayers.push(player.id);
    player.finishedRank = this.finishedPlayers.length;

    // KHÔNG reset lastMove ở đây. Lá bài cuối vẫn có thể bị chặn bởi những người ACTIVE khác.

    if (player.finishedRank === 1) {
      this.players.forEach(p => {
        if (p.id !== player.id && !p.hasPlayedAnyCard) {
          p.isBurned = true;
          this.roundEvents.push({ type: 'CONG', playerName: p.name, description: `${p.name} bị Cóng!`, timestamp: Date.now() });
        }
      });
    }

    const remainingCount = this.players.filter(p => !this.finishedPlayers.includes(p.id)).length;
    if (remainingCount <= 1) {
      // Kết thúc ván nếu chỉ còn 1 hoặc 0 người chơi
      this.players.forEach(p => { 
        if(!this.finishedPlayers.includes(p.id)) { 
          this.finishedPlayers.push(p.id); 
          p.finishedRank = this.finishedPlayers.length; 
        } 
      });
      this.endRound();
    } else {
      this.moveToNextPlayer();
    }
  }

  private endRound() {
    if (this.gamePhase === "finished") return;
    this.resolveChopChain();
    this.gamePhase = "finished";
    this.isFirstGame = false;
    this.lastWasInstantWin = false;
    this.startingPlayerId = this.finishedPlayers[0];

    const settlements = MoneyEngine.settleGame(this.players, this.bet);
    settlements.forEach(pay => {
      const p = this.players.find(pl => pl.id === pay.playerId);
      if (p) {
        p.balance += pay.change;
        this.lastPayouts.push(pay);
        if (pay.change < 0 && pay.reason?.toLowerCase().includes("thối")) {
          this.roundEvents.push({ type: 'THOI', playerName: p.name, description: `${p.name}: ${pay.reason}`, timestamp: Date.now(), fromPlayerId: p.id });
        }
      }
    });
    this.recordHistory();
  }

  private recordHistory() {
    const playersHistory: PlayerHistoryEntry[] = this.players.map(p => {
      const pPayouts = this.lastPayouts.filter(pay => pay.playerId === p.id);
      const total = pPayouts.reduce((s, pay) => s + pay.change, 0);
      return { id: p.id, name: p.name, rank: p.finishedRank || 0, balanceBefore: p.balance - total, balanceAfter: p.balance, change: total, isBurned: p.isBurned, transactions: pPayouts.map(pay => ({ reason: pay.reason || "Ván đấu", amount: pay.change, type: pay.change >= 0 ? "WIN" : "LOSE" })) };
    });

    this.history.unshift({ roundId: Math.random().toString(36).substr(2, 5).toUpperCase(), timestamp: Date.now(), bet: this.bet, players: playersHistory, events: [...this.roundEvents] });
    if (this.history.length > 50) this.history = this.history.slice(0, 50);
    this.lastPayouts = [];
    this.roundEvents = [];
  }

  getState(viewerId: string) {
    return {
      players: this.players.map(p => ({ ...p, hand: (this.gamePhase === "finished" || p.id === viewerId) ? p.hand : p.hand.map(() => null) })),
      currentTurn: this.currentTurn,
      lastMove: this.lastMove,
      gamePhase: this.gamePhase,
      bet: this.bet,
      passedPlayers: Array.from(this.passedPlayers),
      history: this.history,
      isFirstGame: this.isFirstGame
    };
  }
}
