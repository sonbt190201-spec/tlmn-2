
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { RoomManager, Room } from './roomManager.js';
import { GameInstance } from './gameInstance.js';
import { MoneyEngine } from './moneyEngine.js';
import { HandType, GlobalPlayerStats, GameHistory } from './types.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;
const roomManager = new RoomManager();

const DATA_DIR = path.join(__dirname, 'data');
const BALANCES_FILE = path.join(DATA_DIR, 'balances.json');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

interface PersistentPlayer {
  id: string;
  name: string;
  balance: number;
  stats: GlobalPlayerStats;
}

let persistentPlayers: Record<string, PersistentPlayer> = {};
let globalHistory: Record<string, GameHistory[]> = {};

function loadData() {
  try {
    if (fs.existsSync(BALANCES_FILE)) {
      persistentPlayers = JSON.parse(fs.readFileSync(BALANCES_FILE, 'utf-8'));
    }
    if (fs.existsSync(HISTORY_FILE)) {
      globalHistory = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
    }
  } catch (err) {
    console.error("Lỗi load data:", err);
  }
}

function saveData() {
  try {
    fs.writeFileSync(BALANCES_FILE, JSON.stringify(persistentPlayers, null, 2));
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(globalHistory, null, 2));
  } catch (err) {
    console.error("Lỗi save data:", err);
  }
}

loadData();

const distPath = path.resolve(__dirname, 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath) as any);
} else {
  app.use(express.static(__dirname) as any);
}

function updateGlobalStats(room: Room) {
  if (!room.game) return;
  const lastGame = room.game.history[0];
  if (!lastGame) return;

  if (!globalHistory[room.id]) globalHistory[room.id] = [];
  globalHistory[room.id].unshift(lastGame);
  if (globalHistory[room.id].length > 100) globalHistory[room.id] = globalHistory[room.id].slice(0, 100);

  lastGame.players.forEach(p => {
    if (!persistentPlayers[p.id]) {
       persistentPlayers[p.id] = {
         id: p.id,
         name: p.name,
         balance: p.balanceAfter,
         stats: createEmptyStats()
       };
    }
    
    const ps = persistentPlayers[p.id];
    ps.balance = p.balanceAfter;
    ps.stats.totalRounds++;
    
    if (p.change > 0) {
      ps.stats.totalWin++;
      ps.stats.totalMoneyWin += p.change;
    } else if (p.change < 0) {
      ps.stats.totalLose++;
      ps.stats.totalMoneyLose += Math.abs(p.change);
    }

    if (p.isBurned) ps.stats.totalCongCount++;

    lastGame.events.forEach(ev => {
      if (ev.toPlayerId === p.id && (ev.type === 'CHOP' || ev.type === 'OVER_CHOP')) {
        ps.stats.totalHeoCut++;
      }
      if (ev.fromPlayerId === p.id && ev.type === 'THOI') {
        ps.stats.totalHeoBurn++;
      }
    });
  });

  saveData();
}

function createEmptyStats(): GlobalPlayerStats {
  return {
    totalRounds: 0,
    totalWin: 0,
    totalLose: 0,
    totalMoneyWin: 0,
    totalMoneyLose: 0,
    totalHeoCut: 0,
    totalHeoBurn: 0,
    totalCongCount: 0
  };
}

const server = app.listen(port, () => {
  console.log(`Server đang chạy tại port ${port}`);
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  let clientId = '';
  
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      const room = roomManager.getRoomByClientId(clientId);

      switch (message.type) {
        case 'JOIN_ROOM':
          clientId = message.payload.id;
          const joinedRoom = roomManager.joinRoom(clientId, message.payload.name, ws, message.payload.roomId);
          
          if (!persistentPlayers[clientId]) {
            persistentPlayers[clientId] = {
              id: clientId,
              name: message.payload.name,
              balance: 1000000,
              stats: createEmptyStats()
            };
          }
          
          const roomPlayersWithBalance = joinedRoom.playerInfos.map(p => ({
            ...p,
            balance: persistentPlayers[p.id]?.balance || 1000000
          }));

          broadcast(joinedRoom, {
            type: 'ROOM_UPDATE',
            payload: { players: roomPlayersWithBalance, roomId: joinedRoom.id }
          });

          // Reset luật 3 bích khi có người chơi mới join (đảm bảo tính công bằng)
          if (!joinedRoom.game || joinedRoom.game.gamePhase !== 'playing') {
             const currentBet = joinedRoom.game ? joinedRoom.game.bet : 10000;
             joinedRoom.game = new GameInstance(roomPlayersWithBalance, currentBet);
             joinedRoom.game.isFirstGame = true; // Thực thi luật 3 bích cho ván tiếp theo
             const history = globalHistory[joinedRoom.id] || [];
             if (typeof joinedRoom.game.setHistory === 'function') {
                joinedRoom.game.setHistory(history);
             }
          }

          broadcastGameState(joinedRoom);
          break;

        case 'START_GAME':
          if (room && (!room.game || room.game.gamePhase !== 'playing')) {
            try {
              const playersData = room.playerInfos.slice(0, 4).map(p => ({
                id: p.id,
                name: p.name,
                balance: persistentPlayers[p.id]?.balance || 1000000
              }));

              if (playersData.length < 2) {
                ws.send(JSON.stringify({ type: 'ERROR', payload: "Cần ít nhất 2 người chơi để bắt đầu!" }));
                return;
              }

              const currentBet = room.game ? room.game.bet : 10000;
              const prevHistory = room.game ? room.game.history : (globalHistory[room.id] || []);
              const prevInternal = room.game ? room.game.getInternalState() : null;
              
              const newGame = new GameInstance(playersData, currentBet);
              if (typeof newGame.setHistory === 'function') {
                newGame.setHistory(prevHistory);
              }
              if (prevInternal && typeof newGame.setPersistentState === 'function') {
                newGame.setPersistentState(prevInternal);
              }

              room.game = newGame;
              room.game.startNewRound();
              if (room.game.gamePhase === 'finished') updateGlobalStats(room);
              broadcastGameState(room);
            } catch (err: any) {
              console.error("Lỗi Start Game:", err);
              ws.send(JSON.stringify({ type: 'ERROR', payload: err.message || "Lỗi khởi tạo game" }));
            }
          }
          break;

        case 'UPDATE_BET':
          if (room?.game) {
            room.game.bet = message.payload.bet;
            broadcastGameState(room);
          }
          break;

        case 'PLAY_CARDS':
          if (room?.game) {
            const prevPhase = room.game.gamePhase;
            const result = room.game.playMove(clientId, message.payload.cardIds);
            
            if (!result.error) {
              if (result.chopInfo) {
                const victim = room.playerInfos.find(p => p.id === result.chopInfo.victimId);
                broadcast(room, {
                  type: 'SPECIAL_EVENT',
                  payload: { 
                    type: result.chopInfo.type === 'CHOP' ? 'chat_heo' : 'chat_chong', 
                    playerName: victim?.name || 'Ẩn danh',
                    chopType: result.chopInfo.handType
                  }
                });
              }

              if (prevPhase === 'playing' && room.game.gamePhase === 'finished') {
                updateGlobalStats(room);
                const lastGame = room.game.history[0];
                if (lastGame) {
                  lastGame.events.forEach(ev => {
                    let specialType: any = 'info';
                    let displayPlayerName = ev.playerName;
                    if (ev.type === 'THOI') {
                      if (ev.description.toLowerCase().includes("tứ quý")) specialType = 'thui_tu_quy';
                      else if (ev.description.toLowerCase().includes("3 đôi thông")) specialType = 'thui_3_doi_thong';
                      else specialType = 'thui_heo';
                    } else if (ev.type === 'CONG') {
                      specialType = 'chay_bai';
                    } else if (ev.type === 'CONG_CA_BAN') {
                      specialType = 'cong_ca_ban';
                    } else if (ev.type === 'INSTANT_WIN') {
                      specialType = 'info';
                      displayPlayerName = `ĂN TRẮNG: ${ev.playerName}`;
                    }
                    if (specialType !== 'info' || ev.type === 'INSTANT_WIN') {
                      broadcast(room, {
                        type: 'SPECIAL_EVENT',
                        payload: { type: specialType, playerName: displayPlayerName, chopType: 'three_pairs' }
                      });
                    }
                  });
                }
              }
              broadcastGameState(room);
            } else {
              ws.send(JSON.stringify({ type: 'ERROR', payload: result.error }));
            }
          }
          break;

        case 'PASS_TURN':
          if (room?.game) {
            room.game.passTurn(clientId);
            broadcastGameState(room);
          }
          break;
        
        case 'SEND_CHAT':
           if (room) {
             broadcast(room, {
               type: 'CHAT_UPDATE',
               payload: {
                 id: Math.random().toString(36).substr(2, 9),
                 playerId: clientId,
                 playerName: room.playerInfos.find(p => p.id === clientId)?.name || 'Ẩn danh',
                 message: message.payload.message,
                 timestamp: Date.now()
               }
             });
           }
           break;

        case 'SEND_TROLL':
          if (room) {
            broadcast(room, {
              type: 'TROLL_EVENT',
              payload: {
                id: Math.random().toString(36).substr(2, 9),
                type: message.payload.type,
                fromId: clientId,
                toId: message.payload.toId,
                timestamp: Date.now()
              }
            });
          }
          break;
          
        case 'VOICE_SIGNAL':
          if (room) {
            const targetWs = room.clients.get(message.payload.toId);
            if (targetWs && targetWs.readyState === WebSocket.OPEN) {
              targetWs.send(JSON.stringify({
                type: 'VOICE_SIGNAL_RECV',
                payload: { fromId: clientId, signal: message.payload.signal, type: message.payload.type }
              }));
            }
          }
          break;
      }
    } catch (e) {
      console.error("Lỗi xử lý tin nhắn tổng quát:", e);
    }
  });

  ws.on('close', () => {
    const room = roomManager.leaveRoom(clientId);
    if (room) {
      const roomPlayersWithBalance = room.playerInfos.map(p => ({
        ...p,
        balance: persistentPlayers[p.id]?.balance || 1000000
      }));
      broadcast(room, {
        type: 'ROOM_UPDATE',
        payload: { players: roomPlayersWithBalance, roomId: room.id }
      });
      if (room.game && room.game.gamePhase !== 'playing') {
        room.game = new GameInstance(roomPlayersWithBalance, room.game.bet);
        room.game.isFirstGame = true; // Reset khi có biến động người chơi
      }
      broadcastGameState(room);
    }
  });
});

function broadcast(room: any, data: any) {
  room.clients.forEach((clientWs: WebSocket) => {
    if (clientWs.readyState === WebSocket.OPEN) clientWs.send(JSON.stringify(data));
  });
}

function broadcastGameState(room: any) {
  if (!room.game) return;
  room.clients.forEach((clientWs: WebSocket, id: string) => {
    if (clientWs.readyState === WebSocket.OPEN) {
      const state = room.game!.getState(id);
      clientWs.send(JSON.stringify({
        type: 'GAME_STATE',
        payload: {
          ...state,
          globalStats: persistentPlayers[id]?.stats || createEmptyStats()
        }
      }));
    }
  });
}

app.get('*', (req, res) => {
  const indexPath = path.join(distPath, 'index.html');
  if (fs.existsSync(indexPath)) res.sendFile(indexPath);
  else {
    const rootIndexPath = path.join(__dirname, 'index.html');
    if (fs.existsSync(rootIndexPath)) res.sendFile(rootIndexPath);
    else res.status(404).send('Vui lòng chạy build.');
  }
});
