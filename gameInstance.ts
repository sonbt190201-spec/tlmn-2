
import { Card, Player, Move, HandType, GameHistory, PlayerHistoryEntry, PayoutResult, GameEventRecord } from './types.js';
import { detectHandType, compareHands, sortCards, checkInstantWin } from './ruleValidator.js';
import { dealCards } from './deckManager.js';
import { MoneyEngine } from './moneyEngine.js';

export type GamePhase = "waiting" | "playing" | "finished";

export class GameInstance {
  players: Player[];
  bet: number;
  currentTurn: number;
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
    this.currentTurn = 0;
  }

  setHistory(history: GameHistory[]) {
    this.history = history || [];
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

    this.players.forEach(p => {
      const handData = hands.find(h => h.playerId === p.id);
      p.hand = sortCards(handData?.cards || []);
      p.finishedRank = undefined;
      p.hasPlayedAnyCard = false;
      p.isBurned = false;
    });

    // Kiểm tra Ăn Trắng
    for (const p of this.players) {
      const reason = checkInstantWin(p.hand, this.isFirstGame);
      if (reason) {
        this.handleInstantWin(p.id, reason);
        return;
      }
    }

    // Xác định người đánh trước
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
    this.applyPayouts(payouts);
    
    const winner = this.players.find(p => p.id === winnerId)!;
    winner.finishedRank = 1;
    this.finishedPlayers = [winnerId];
    this.players.forEach(p => { 
      if(p.id !== winnerId) {
        this.finishedPlayers.push(p.id);
        p.finishedRank = 4;
      }
    });

    this.roundEvents.push({ type: 'INSTANT_WIN', playerName: winner.name, description: `Ăn trắng: ${reason}`, timestamp: Date.now() });
    this.gamePhase = "finished";
    this.startingPlayerId = winnerId;
    this.isFirstGame = false;
    this.lastWasInstantWin = true;
    this.recordHistory();
  }

  playMove(playerId: string, cardIds: string[]): string | null {
    if (this.gamePhase !== "playing") return "Ván bài đã kết thúc";
    const player = this.players.find(p => p.id === playerId);
    if (!player) return "Người chơi không tồn tại";
    
    const cards = player.hand.filter(c => cardIds.includes(c.id));
    if (cards.length !== cardIds.length) return "Lá bài không hợp lệ trong tay";

    const handType = detectHandType(cards);
    if (handType === HandType.INVALID) return "Bộ bài không hợp lệ";

    // Luật 4 đôi thông: Chặt tự do (Không cần lượt, không cần chưa pass)
    const isFourPairs = (handType === HandType.FOUR_CONSECUTIVE_PAIRS);
    const canFreeChop = isFourPairs && this.lastMove && compareHands(cards, this.lastMove.cards) === 1;

    if (this.players[this.currentTurn].id !== playerId && !canFreeChop) {
      return "Chưa tới lượt của bạn";
    }

    if (this.passedPlayers.has(playerId) && !canFreeChop) {
      return "Bạn đã bỏ lượt của vòng này";
    }

    // Kiểm tra chặn bộ trước
    if (this.lastMove) {
      if (compareHands(cards, this.lastMove.cards) !== 1) return "Bộ bài không đủ mạnh để chặn";
      
      // Xử lý logic chặt
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
          // Chặt hàng chồng hàng
          const vType = this.lastMove.type;
          if (vType === HandType.THREE_CONSECUTIVE_PAIRS) val = this.bet * 1.5;
          else if (vType === HandType.FOUR_OF_A_KIND) val = this.bet * 2;
          else if (vType === HandType.FOUR_CONSECUTIVE_PAIRS) val = this.bet * 4;
        }
        this.chopChain.push({ attackerId: playerId, victimId: this.lastMove.playerId, value: val });
      }
    }

    // Thực hiện đánh bài
    player.hand = player.hand.filter(c => !cardIds.includes(c.id));
    player.hasPlayedAnyCard = true;
    
    const move: Move = {
      type: handType,
      cards,
      playerId,
      timestamp: Date.now(),
      isChop: this.chopChain.length === 1,
      isOverChop: this.chopChain.length > 1
    };

    this.lastMove = move;
    this.currentTurn = this.players.findIndex(p => p.id === playerId);

    if (player.hand.length === 0) {
      this.handlePlayerFinish(player);
    } else {
      this.moveToNextPlayer();
    }

    return null;
  }

  passTurn(playerId: string) {
    if (this.gamePhase !== "playing" || !this.lastMove) return;
    if (this.players[this.currentTurn].id !== playerId) return;

    this.passedPlayers.add(playerId);
    this.moveToNextPlayer();
  }

  private moveToNextPlayer() {
    const playerCount = this.players.length;
    let nextIdx = (this.currentTurn + 1) % playerCount;
    let attempts = 0;

    while (attempts < playerCount) {
      const p = this.players[nextIdx];
      const isFinished = this.finishedPlayers.includes(p.id);
      const hasPassed = this.passedPlayers.has(p.id);

      // Nếu tất cả người khác đã pass hoặc đã finish -> Reset vòng
      if (p.id === this.lastMove?.playerId) {
        this.resetRound(p.id);
        return;
      }

      if (!isFinished && !hasPassed) {
        this.currentTurn = nextIdx;
        return;
      }

      nextIdx = (nextIdx + 1) % playerCount;
      attempts++;
    }

    // Trường hợp đặc biệt: Trick owner đã về và mọi người khác đã pass
    const ownerId = this.lastMove?.playerId;
    if (ownerId && this.finishedPlayers.includes(ownerId)) {
      // Tìm người còn bài kế tiếp để lead vòng mới
      let finderIdx = (this.players.findIndex(p => p.id === ownerId) + 1) % playerCount;
      for (let i = 0; i < playerCount; i++) {
        if (!this.finishedPlayers.includes(this.players[finderIdx].id)) {
          this.resetRound(this.players[finderIdx].id);
          return;
        }
        finderIdx = (finderIdx + 1) % playerCount;
      }
    }
    
    this.checkGameEnd();
  }

  private resetRound(leadPlayerId: string) {
    this.resolveChopChain();
    this.lastMove = null;
    this.passedPlayers.clear();
    const idx = this.players.findIndex(p => p.id === leadPlayerId);
    this.currentTurn = idx !== -1 ? idx : 0;
  }

  private resolveChopChain() {
    if (this.chopChain.length === 0) return;

    const last = this.chopChain[this.chopChain.length - 1];
    const totalValue = this.chopChain.reduce((sum, item) => sum + item.value, 0);
    const winner = this.players.find(p => p.id === last.attackerId)!;
    const victim = this.players.find(p => p.id === last.victimId)!;

    const payouts = [
      { playerId: winner.id, change: totalValue, reason: "Thắng chặt" },
      { playerId: victim.id, change: -totalValue, reason: "Bị chặt" }
    ];

    this.applyPayouts(payouts);
    this.roundEvents.push({
      type: this.chopChain.length > 1 ? 'OVER_CHOP' : 'CHOP',
      fromPlayerId: victim.id,
      toPlayerId: winner.id,
      playerName: winner.name,
      targetName: victim.name,
      amount: totalValue,
      description: `${winner.name} chặt ${victim.name} thu ${totalValue}$`,
      timestamp: Date.now()
    });

    this.chopChain = [];
  }

  private handlePlayerFinish(player: Player) {
    if (this.finishedPlayers.includes(player.id)) return;
    this.finishedPlayers.push(player.id);
    player.finishedRank = this.finishedPlayers.length;

    // Luật cóng: Người về nhất mà có người chưa đánh được lá nào
    if (player.finishedRank === 1) {
      this.players.forEach(p => {
        if (p.id !== player.id && !p.hasPlayedAnyCard) {
          p.isBurned = true;
          this.roundEvents.push({ type: 'CONG', playerName: p.name, description: `${p.name} bị cóng!`, timestamp: Date.now() });
        }
      });
    }

    const activeCount = this.players.filter(p => !this.finishedPlayers.includes(p.id)).length;
    if (activeCount <= 1) {
      this.endRound();
    } else {
      this.moveToNextPlayer();
    }
  }

  private checkGameEnd() {
    const activeCount = this.players.filter(p => !this.finishedPlayers.includes(p.id)).length;
    if (activeCount <= 1) this.endRound();
  }

  private endRound() {
    if (this.gamePhase === "finished") return;
    this.resolveChopChain();

    this.gamePhase = "finished";
    this.isFirstGame = false;
    this.lastWasInstantWin = false;
    this.startingPlayerId = this.finishedPlayers[0];

    const burnedCount = this.players.filter(p => p.isBurned).length;
    const rankPayouts = (burnedCount > 0) 
      ? MoneyEngine.calculateCongMoney(this.players, this.bet, burnedCount)
      : MoneyEngine.calculateRankMoney(this.players, this.bet);

    this.applyPayouts(rankPayouts);

    // Luật thối bài: Trả cho hạng 3
    const rank3 = this.players.find(p => p.finishedRank === 3);
    const rank4 = this.players.find(p => p.finishedRank === 4);

    if (rank4 && rank3) {
      const thoi = MoneyEngine.calculateThoiValue(rank4, this.bet);
      if (thoi.totalLoss > 0) {
        this.applyPayouts([
          { playerId: rank4.id, change: -thoi.totalLoss, reason: "Thối bài" },
          { playerId: rank3.id, change: thoi.totalLoss, reason: "Nhận tiền thối" }
        ]);
        this.roundEvents.push({
          type: 'THOI',
          fromPlayerId: rank4.id,
          toPlayerId: rank3.id,
          playerName: rank3.name,
          targetName: rank4.name,
          amount: thoi.totalLoss,
          description: `${rank4.name} thối ${thoi.details.join(', ')} trả cho ${rank3.name}`,
          timestamp: Date.now()
        });
      }
    }

    this.recordHistory();
  }

  private applyPayouts(payouts: PayoutResult[]) {
    payouts.forEach(pay => {
      const p = this.players.find(pl => pl.id === pay.playerId);
      if (p) {
        p.balance += pay.change;
        this.lastPayouts.push(pay);
      }
    });
  }

  private recordHistory() {
    const playersHistory: PlayerHistoryEntry[] = this.players.map(p => {
      const playerPayouts = this.lastPayouts.filter(pay => pay.playerId === p.id);
      return {
        id: p.id,
        name: p.name,
        rank: p.finishedRank || 0,
        balanceBefore: p.balance - playerPayouts.reduce((s, pay) => s + pay.change, 0),
        balanceAfter: p.balance,
        change: playerPayouts.reduce((s, pay) => s + pay.change, 0),
        isBurned: p.isBurned,
        transactions: playerPayouts.map(pay => ({
          reason: pay.reason || "Kết quả",
          amount: pay.change,
          type: pay.change >= 0 ? "WIN" : "LOSE"
        }))
      };
    });

    this.history.unshift({
      roundId: Math.random().toString(36).substr(2, 5).toUpperCase(),
      timestamp: Date.now(),
      bet: this.bet,
      players: playersHistory,
      events: [...this.roundEvents]
    });

    if (this.history.length > 50) this.history = this.history.slice(0, 50);
    this.lastPayouts = [];
    this.roundEvents = [];
  }

  getState(viewerId: string) {
    return {
      players: this.players.map(p => ({
        ...p,
        hand: (this.gamePhase === "finished" || p.id === viewerId) ? p.hand : p.hand.map(() => null)
      })),
      currentTurn: this.currentTurn,
      lastMove: this.lastMove,
      gamePhase: this.gamePhase,
      bet: this.bet,
      passedPlayers: Array.from(this.passedPlayers),
      history: this.history
    };
  }
}
