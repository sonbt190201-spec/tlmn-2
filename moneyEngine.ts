
import { Player, PayoutResult } from './types.js';

export interface ThuiResult {
  totalLoss: number;
  details: string[];
}

export class MoneyEngine {
  /**
   * Tính tiền theo thứ hạng cuối ván
   * Nhất +1, Nhì +0.5, Ba -0.5, Bét -1
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
   */
  static calculateCongMoney(players: Player[], bet: number, burnedCount: number): PayoutResult[] {
    const results: PayoutResult[] = [];
    const winner = players.find(p => p.finishedRank === 1);
    if (!winner) return results;

    if (burnedCount === 1) {
      // 1 người cóng: Cóng -2, Thắng +2, Nhì/Ba bình thường
      players.forEach(p => {
        let change = 0;
        if (p.isBurned) change = -bet * 2;
        else if (p.finishedRank === 1) change = bet * 2;
        else if (p.finishedRank === 2) change = bet * 0.5;
        else if (p.finishedRank === 3) change = -bet * 0.5;
        results.push({ playerId: p.id, change, reason: p.isBurned ? "Cóng (-2x)" : `Hạng ${p.finishedRank}` });
      });
    } else {
      // 2+ người cóng: Những người cóng -2, Nhất ăn tất, người còn lại (Hạng 3) hòa
      players.forEach(p => {
        let change = 0;
        if (p.isBurned) change = -bet * 2;
        else if (p.finishedRank === 1) change = bet * 2 * burnedCount;
        else change = 0;
        results.push({ playerId: p.id, change, reason: p.isBurned ? "Cóng (-2x)" : p.finishedRank === 1 ? "Thắng Cóng" : "Hòa" });
      });
    }
    return results;
  }

  /**
   * Tính tiền thối bài (Heo, Hàng)
   */
  static calculateThoiValue(player: Player, bet: number): ThuiResult {
    let loss = 0;
    const details: string[] = [];
    const cards = player.hand;
    const counts: Record<number, number> = {};
    
    cards.forEach(c => {
      // Heo: Đỏ = 1x, Đen = 0.5x
      if (c.rank === 15) {
        const isRed = (c.suit === 'heart' || c.suit === 'diamond');
        const val = isRed ? bet : bet * 0.5;
        loss += val;
        details.push(isRed ? "Heo đỏ" : "Heo đen");
      }
      counts[c.rank] = (counts[c.rank] || 0) + 1;
    });

    // Tứ quý thối = 2 heo đỏ = 2x
    Object.keys(counts).forEach(rank => {
      if (counts[Number(rank)] === 4 && Number(rank) < 15) {
        loss += bet * 2;
        details.push("Tứ quý");
      }
    });

    // 3 đôi thông thối = 1 heo đỏ + 1 heo đen = 1.5x
    const sortedRanks = Object.keys(counts).map(Number).sort((a,b) => a-b);
    for (let i = 0; i < sortedRanks.length - 2; i++) {
      if (counts[sortedRanks[i]] >= 2 && counts[sortedRanks[i+1]] >= 2 && counts[sortedRanks[i+2]] >= 2 &&
          sortedRanks[i+1] === sortedRanks[i]+1 && sortedRanks[i+2] === sortedRanks[i+1]+1 && sortedRanks[i+2] < 15) {
          loss += bet * 1.5;
          details.push("3 đôi thông");
          break; // Chỉ tính bộ thông cao nhất nếu có nhiều bộ
      }
    }

    return { totalLoss: loss, details };
  }

  /**
   * Tính tiền Ăn Trắng
   * Nhất +6 (nhận từ 3 người bét x 2)
   */
  static calculateTrangMoney(winnerId: string, playerIds: string[], bet: number): PayoutResult[] {
    return playerIds.map(id => ({
      playerId: id,
      change: id === winnerId ? bet * 2 * (playerIds.length - 1) : -bet * 2,
      reason: id === winnerId ? "Ăn trắng" : "Bị ăn trắng"
    }));
  }
}
