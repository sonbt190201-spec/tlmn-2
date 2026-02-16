
import { Card, Player, Move, HandType, GameHistory, PlayerHistoryEntry, PayoutResult, GameEventRecord } from './types.js';
import { detectHandType, compareHands, sortCards, checkInstantWin, getCardWeight, findFourConsecutivePairsInHand } from './ruleValidator.js';
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
  private smallestCardIdInGame: string = ''; 
  private chopChain: { attackerId: string, victimId: string, value: number }[] = [];

  private isHeoChainActive: boolean = false;
  private specialTurnFor: { playerId: string; handType: HandType.FOUR_CONSECUTIVE_PAIRS; } | null = null;


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
    this.isFirstMoveOfGame = this.isFirstGame || this.lastWasInstantWin; 
    this.smallestCardIdInGame = '';
    this.isHeoChainActive = false;
    this.specialTurnFor = null;

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
      let minWeight = Infinity;
      let starterIdx = 0;
      this.players.forEach((p, idx) => {
        p.hand.forEach(c => {
          const w = getCardWeight(c);
          if (w < minWeight) {
            minWeight = w;
            starterIdx = idx;
            this.smallestCardIdInGame = c.id;
          }
        });
      });
      this.currentTurn = starterIdx;
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
    if (cardIds.length === 0) return { error: "Bạn chưa chọn quân bài nào" };
    const cards = player.hand.filter(c => cardIds.includes(c.id));
    if (cards.length !== cardIds.length) return { error: "Bài không hợp lệ (Quân bài không có trong tay)" };

    if (this.specialTurnFor && this.specialTurnFor.playerId === playerId) {
      const handType = detectHandType(cards);
      if (handType !== HandType.FOUR_CONSECUTIVE_PAIRS) return { error: "Trong lượt đặc biệt, bạn chỉ được dùng 4 đôi thông." };
      if (this.lastMove && compareHands(cards, this.lastMove.cards) !== 1) return { error: "4 đôi thông của bạn không đủ mạnh để chặt." };
      
      player.hand = player.hand.filter(c => !cardIds.includes(c.id));
      player.hasPlayedAnyCard = true;
      this.lastMove = { type: handType, cards, playerId, timestamp: Date.now() };
      this.specialTurnFor = null;
      this.passedPlayers.delete(playerId); 
      this.resetRound(playerId);
      if (player.hand.length === 0) this.handlePlayerFinish(player);
      return { error: null };
    }

    if (this.players[this.currentTurn].id !== playerId) return { error: "Chưa tới lượt" };
    if (this.passedPlayers.has(playerId)) return { error: "Bạn đã bỏ lượt của vòng này" };

    if (this.isFirstMoveOfGame && this.smallestCardIdInGame) {
      if (!cards.some(c => c.id === this.smallestCardIdInGame)) return { error: `Ván này áp dụng luật ván đầu: Bắt buộc phải chứa quân bài nhỏ nhất!` };
    }

    const handType = detectHandType(cards);
    if (handType === HandType.INVALID) return { error: "Bộ bài không hợp lệ" };

    let chopInfo: PlayMoveResult['chopInfo'] = undefined;

    if (this.lastMove) {
      if (compareHands(cards, this.lastMove.cards) !== 1) return { error: "Bộ bài không đủ mạnh để chặn" };
      
      const isAttackerHang = [HandType.THREE_CONSECUTIVE_PAIRS, HandType.FOUR_OF_A_KIND, HandType.FOUR_CONSECUTIVE_PAIRS].includes(handType);
      const isVictimHeo = this.lastMove.cards.some(c => c.rank === 15);
      
      const victimIsHang = [HandType.THREE_CONSECUTIVE_PAIRS, HandType.FOUR_OF_A_KIND, HandType.FOUR_CONSECUTIVE_PAIRS].includes(this.lastMove.type);
      const isChop = (isAttackerHang && isVictimHeo) || (isAttackerHang && victimIsHang);

      if (isChop) {
        const isOverChop = this.chopChain.length > 0;
        const penalty = MoneyEngine.calculateChopPenalty(this.lastMove, handType, this.bet, isOverChop);
        
        if (penalty > 0) {
          const victimId = this.lastMove.playerId;
          this.chopChain.push({ attackerId: playerId, victimId, value: penalty });
          chopInfo = {
            attackerId: playerId,
            victimId,
            type: isOverChop ? 'OVER_CHOP' : 'CHOP',
            amount: penalty,
            handType: handType.toString(),
          };
          this.isHeoChainActive = true;
        }
      }
    }

    player.hand = player.hand.filter(c => !cardIds.includes(c.id));
    player.hasPlayedAnyCard = true;
    this.lastMove = { type: handType, cards, playerId, timestamp: Date.now() };
    this.isFirstMoveOfGame = false;
    
    if (!this.isHeoChainActive) {
        this.isHeoChainActive = this.lastMove.cards.some(c => c.rank === 15);
    }

    if (player.hand.length === 0) {
      this.handlePlayerFinish(player);
    } else {
      this.moveToNextPlayer();
    }
    return { error: null, chopInfo };
  }

  private resolveChopChain() {
    this.chopChain.forEach(chop => {
      const attacker = this.players.find(p => p.id === chop.attackerId);
      const victim = this.players.find(p => p.id === chop.victimId);
      if (!attacker || !victim) return;

      this.lastPayouts.push({ playerId: attacker.id, change: chop.value, reason: `Chặt ${victim.name}` });
      this.lastPayouts.push({ playerId: victim.id, change: -chop.value, reason: `Bị ${attacker.name} chặt` });

      this.roundEvents.push({
        type: 'CHOP',
        fromPlayerId: attacker.id,
        toPlayerId: victim.id,
        playerName: attacker.name,
        targetName: victim.name,
        amount: chop.value,
        description: `${attacker.name} chặt ${victim.name} (+${chop.value.toLocaleString()}$)`,
        timestamp: Date.now(),
      });
    });
    this.chopChain = [];
  }

  passTurn(playerId: string) {
    if (this.specialTurnFor && this.specialTurnFor.playerId === playerId) {
        this.specialTurnFor = null;
        this.moveToNextPlayer();
        return;
    }
    if (this.players[this.currentTurn].id !== playerId) return;
    if (!this.lastMove) return; 

    this.passedPlayers.add(playerId);
    this.moveToNextPlayer();
  }

  private moveToNextPlayer() {
    if (this.gamePhase !== "playing") return;

    const playerCount = this.players.length;
    let nextIdx = this.currentTurn;
    let checkedCount = 0;

    while (checkedCount < playerCount) {
        nextIdx = (nextIdx + 1) % playerCount;
        checkedCount++;
        
        const p = this.players[nextIdx];
        const pId = p.id;
        
        if (this.finishedPlayers.includes(pId) || p.isBurned) {
            continue;
        }

        if (this.lastMove && pId === this.lastMove.playerId) {
            this.resetRound(pId);
            return;
        }

        if (!this.passedPlayers.has(pId)) {
            this.currentTurn = nextIdx;
            this.specialTurnFor = null;
            return;
        }

        if (this.passedPlayers.has(pId) && this.isHeoChainActive && this.lastMove) {
            const fourPairsHands = findFourConsecutivePairsInHand(p.hand);
            const strongestFourPairs = fourPairsHands.sort((a, b) => getCardWeight(b[b.length-1]) - getCardWeight(a[a.length-1]))[0];
            
            if (strongestFourPairs && compareHands(strongestFourPairs, this.lastMove.cards) === 1) {
                this.currentTurn = nextIdx;
                this.specialTurnFor = { playerId: pId, handType: HandType.FOUR_CONSECUTIVE_PAIRS };
                return;
            }
        }
    }
  }

  private resetRound(winnerId: string) {
    this.resolveChopChain();
    this.lastMove = null;
    this.passedPlayers.clear();
    this.isHeoChainActive = false;
    this.specialTurnFor = null;
    
    let leadIdx = this.players.findIndex(p => p.id === winnerId);
    
    if (this.finishedPlayers.includes(winnerId) || this.players[leadIdx].isBurned) {
      const originalLeadIdx = leadIdx;
      let nextIdx = (originalLeadIdx + 1) % this.players.length;
      
      while(nextIdx !== originalLeadIdx) {
        const p = this.players[nextIdx];
        if (!this.finishedPlayers.includes(p.id) && !p.isBurned) {
          leadIdx = nextIdx;
          break; 
        }
        nextIdx = (nextIdx + 1) % this.players.length;
      }
    }
    
    this.currentTurn = leadIdx;
  }

  private handlePlayerFinish(player: Player) {
    if (this.finishedPlayers.includes(player.id)) return;
    this.finishedPlayers.push(player.id);
    player.finishedRank = this.finishedPlayers.length;

    if (player.finishedRank === 1) {
      const otherPlayers = this.players.filter(p => p.id !== player.id);
      otherPlayers.forEach(p => { if (!p.hasPlayedAnyCard) p.isBurned = true; });

      if (this.players.length >= 3 && otherPlayers.every(p => p.isBurned)) {
        this.roundEvents.push({ type: 'CONG_CA_BAN', description: `Cóng cả bàn, tất cả các vị đều là phế vật`, timestamp: Date.now() });
      } else {
        otherPlayers.forEach(p => {
          if (p.isBurned) {
            this.roundEvents.push({ type: 'CONG', playerName: p.name, description: `${p.name} bị Cóng!`, timestamp: Date.now() });
          }
        });
      }
    }

    const remainingPlayable = this.players.filter(p => !this.finishedPlayers.includes(p.id) && !p.isBurned);
    if (remainingPlayable.length <= 1) {
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
    this.startingPlayerId = this.finishedPlayers.length > 0 ? this.finishedPlayers[0] : (this.players.find(p => !p.isBurned)?.id || null);
    this.isHeoChainActive = false;
    this.specialTurnFor = null;

    const remaining = this.players.filter(p => !this.finishedPlayers.includes(p.id));
    remaining.sort((a, b) => (a.isBurned ? 1 : 0) - (b.isBurned ? 1 : 0));
    remaining.forEach(p => {
      if(!this.finishedPlayers.includes(p.id)) {
        this.finishedPlayers.push(p.id);
        p.finishedRank = this.finishedPlayers.length;
      }
    });

    const settlements = MoneyEngine.settleGame(this.players, this.bet);
    settlements.forEach(pay => {
      const p = this.players.find(pl => pl.id === pay.playerId);
      if (p) {
        p.balance += pay.change; this.lastPayouts.push(pay);
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
      return { id: p.id, name: p.name, rank: p.finishedRank || this.players.length, balanceBefore: p.balance - total, balanceAfter: p.balance, change: total, isBurned: p.isBurned, transactions: pPayouts.map(pay => ({ reason: pay.reason || "Ván đấu", amount: pay.change, type: pay.change >= 0 ? "WIN" : "LOSE" })) };
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
      isFirstGame: this.isFirstGame,
      specialTurn: this.specialTurnFor && this.specialTurnFor.playerId === viewerId ? this.specialTurnFor : null,
    };
  }
}
