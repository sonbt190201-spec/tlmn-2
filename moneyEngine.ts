
import { Player, PayoutResult } from './types.js';

export interface ThuiResult {
  totalLoss: number;
  details: string[];
}

export class MoneyEngine {
  /**
   * Tính tiền cuối ván dựa trên thứ hạng
   * Nhất: +1, Nhì: +0.5, Ba: -0.5, Bét: -1
   */
  static calculateRankMoney(players: Player[], bet: number): PayoutResult[] {
    const results: PayoutResult[] = [];
    players.forEach(p => {
      let change = 0;
      if (p.finishedRank === 1) change = bet;
      else if (p.finishedRank === 2) change = bet * 0.5;
      else if (p.finishedRank === 3) change = -bet * 0.5;
      else if (p.finishedRank === 4) change = -bet;
      results.push({ playerId: p.id, change, reason: `Hạng ${p.finishedRank}` });
    });
    return results;
  }

  /**
   * Tính tiền Cóng (Cháy bài)
   * 1 người cóng: Bị trừ 2 cược.
   * 2 người cóng: Mỗi người trừ 2 cược.
   */
  static calculateCongMoney(players: Player[], bet: number, burnedCount: number): PayoutResult[] {
    const results: PayoutResult[] = [];
    const winner = players.find(p => p.finishedRank === 1);
    if (!winner) return results;

    if (burnedCount === 1) {
      players.forEach(p => {
        let change = 0;
        let reason = "";
        if (p.isBurned) { change = -bet * 2; reason = "Cóng (-2x)"; }
        else if (p.finishedRank === 1) { change = bet * 2; reason = "Thắng Cóng (+2x)"; }
        else if (p.finishedRank === 2) { change = bet * 0.5; reason = "Hạng 2 (+0.5x)"; }
        else if (p.finishedRank === 3) { change = -bet * 0.5; reason = "Hạng 3 (-0.5x)"; }
        results.push({ playerId: p.id, change, reason });
      });
    } else {
      // 2 hoặc 3 người cóng
      players.forEach(p => {
        let change = 0;
        let reason = "";
        if (p.isBurned) { change = -bet * 2; reason = "Cóng (-2x)"; }
        else if (p.finishedRank === 1) { change = bet * 2 * burnedCount; reason = `Thắng ${burnedCount} Cóng`; }
        else { change = 0; reason = "Hạng 3 (Hòa)"; }
        results.push({ playerId: p.id, change, reason });
      });
    }
    return results;
  }

  /**
   * Tính tiền Ăn trắng
   * Người ăn trắng: +6 cược (nhận từ 3 người bét mỗi người 2 cược)
   */
  static calculateTrangMoney(winnerId: string, playerIds: string[], bet: number): PayoutResult[] {
    const results: PayoutResult[] = [];
    playerIds.forEach(id => {
      if (id === winnerId) {
        results.push({ playerId: id, change: bet * 2 * (playerIds.length - 1), reason: "Ăn trắng" });
      } else {
        results.push({ playerId: id, change: -bet * 2, reason: "Bị Ăn trắng" });
      }
    });
    return results;
  }

  static calculateInstantWin(winnerId: string, playerIds: string[], bet: number): PayoutResult[] {
    return this.calculateTrangMoney(winnerId, playerIds, bet);
  }

  /**
   * Tính giá trị thối bài
   */
  static calculateThoiValue(player: Player, bet: number): ThuiResult {
    let loss = 0;
    const details: string[] = [];
    const cards = player.hand;
    const counts: Record<number, number> = {};
    
    cards.forEach(c => {
      if (c.rank === 15) {
        if (c.suit === 'heart' || c.suit === 'diamond') {
          loss += bet;
          details.push("Heo đỏ");
        } else {
          loss += bet * 0.5;
          details.push("Heo đen");
        }
      }
      counts[c.rank] = (counts[c.rank] || 0) + 1;
    });

    Object.keys(counts).forEach(rank => {
      const r = Number(rank);
      if (counts[r] === 4 && r < 15) {
        loss += bet * 2;
        details.push("Tứ quý");
      }
    });

    // 3/4 đôi thông
    const sortedRanks = Object.keys(counts).map(Number).sort((a, b) => a - b);
    for (let i = 0; i < sortedRanks.length - 2; i++) {
      if (counts[sortedRanks[i]] >= 2 && counts[sortedRanks[i+1]] >= 2 && counts[sortedRanks[i+2]] >= 2 &&
          sortedRanks[i+1] === sortedRanks[i] + 1 && sortedRanks[i+2] === sortedRanks[i+1] + 1) {
         if (i < sortedRanks.length - 3 && counts[sortedRanks[i+3]] >= 2 && sortedRanks[i+3] === sortedRanks[i+2] + 1) {
            loss += bet * 4;
            details.push("4 đôi thông");
            i += 3;
         } else {
            loss += bet * 1.5;
            details.push("3 đôi thông");
            i += 2;
         }
      }
    }
    return { totalLoss: loss, details };
  }

  static calculateThui(player: Player, bet: number): ThuiResult {
    return this.calculateThoiValue(player, bet);
  }

  static calculateGameEnd(players: Player[], bet: number, isBurnedMap: Record<string, boolean>): PayoutResult[] {
    const burnedCount = Object.values(isBurnedMap).filter(v => v).length;
    if (burnedCount > 0) return this.calculateCongMoney(players, bet, burnedCount);
    return this.calculateRankMoney(players, bet);
  }
}
