import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { RoomManager, Room } from './roomManager.js';
import { GameInstance } from './gameInstance.js';
import { MoneyEngine } from './moneyEngine.js';
import { HandType } from './types.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;
const roomManager = new RoomManager();

const persistentBalances: Record<string, Record<string, number>> = {};

// --- FIX MÀN HÌNH ĐEN PRODUCTION ---
// 1. Xác định đường dẫn thư mục build (dist)
const distPath = path.resolve(__dirname, 'dist');

// 2. Serve các file tĩnh từ thư mục dist (nếu tồn tại)
// Fix: Use 'as any' to resolve TypeScript overload ambiguity for app.use with express.static
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath) as any);
} else {
  // Dự phòng cho môi trường dev nếu chưa build dist
  app.use(express.static(__dirname) as any);
}

// --- LOGIC ĐỒNG BỘ TIỀN TỆ ---
function syncBalances(room: Room) {
  if (!room.game) return;
  if (!persistentBalances[room.id]) persistentBalances[room.id] = {};
  
  room.game.players.forEach(p => {
    persistentBalances[room.id][p.id] = p.balance;
  });
}

// --- WEBSOCKET SERVER ---
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
          if (!persistentBalances[joinedRoom.id]) persistentBalances[joinedRoom.id] = {};
          if (persistentBalances[joinedRoom.id][clientId] === undefined) {
            persistentBalances[joinedRoom.id][clientId] = 1000000;
          }
          broadcast(joinedRoom, {
            type: 'ROOM_UPDATE',
            payload: { players: joinedRoom.playerInfos, roomId: joinedRoom.id }
          });
          if (joinedRoom.game) {
            ws.send(JSON.stringify({
              type: 'GAME_STATE',
              payload: joinedRoom.game.getState(clientId)
            }));
          }
          break;

        case 'START_GAME':
          if (room && (!room.game || room.game.gamePhase === 'finished')) {
            const playersData = room.playerInfos.slice(0, 4).map(p => ({
              id: p.id,
              name: p.name,
              balance: persistentBalances[room.id][p.id] || 1000000
            }));

            if (playersData.length < 2) {
              ws.send(JSON.stringify({ type: 'ERROR', payload: "Cần ít nhất 2 người chơi để bắt đầu!" }));
              return;
            }

            const prevInternalState = room.game ? room.game.getInternalState() : null;
            const currentBet = room.game ? room.game.bet : 10000;
            room.game = new GameInstance(playersData, currentBet);
            if (prevInternalState) room.game.setPersistentState(prevInternalState);
            
            try {
              room.game.startNewRound();
              if (room.game.gamePhase === 'finished') syncBalances(room);
              broadcastGameState(room);
            } catch (err: any) {
              ws.send(JSON.stringify({ type: 'ERROR', payload: err.message }));
            }
          }
          break;

        case 'UPDATE_BET':
          if (room) {
            if (room.game) {
              room.game.bet = message.payload.bet;
              broadcastGameState(room);
            } else {
              room.game = new GameInstance([], message.payload.bet) as any;
              broadcastGameState(room);
            }
          }
          break;

        case 'PLAY_CARDS':
          if (room?.game) {
            const prevPhase = room.game.gamePhase;
            const error = room.game.playMove(clientId, message.payload.cardIds);
            
            if (!error) {
              syncBalances(room);

              if (room.game.lastMove?.isOverChop) {
                broadcast(room, {
                  type: 'SPECIAL_EVENT',
                  payload: { type: 'chat_chong', playerName: room.playerInfos.find(p => p.id === clientId)?.name || 'Người chơi' }
                });
              } else if (room.game.lastMove?.isChop) {
                const handType = room.game.lastMove.type;
                const chopType = handType === HandType.FOUR_CONSECUTIVE_PAIRS ? 'four_pairs' : 
                                 handType === HandType.FOUR_OF_A_KIND ? 'four_of_a_kind' : 'three_pairs';
                broadcast(room, {
                  type: 'SPECIAL_EVENT',
                  payload: { type: 'chat_heo', chopType, playerName: room.playerInfos.find(p => p.id === clientId)?.name || 'Người chơi' }
                });
              }

              if (prevPhase === 'playing' && room.game.gamePhase === 'finished') {
                syncBalances(room);
                const winnerId = room.game.startingPlayerId;
                
                if ((room.game as any).isThreeSpadeWin) {
                   broadcast(room, {
                     type: 'SPECIAL_EVENT',
                     payload: { type: 'three_spade_win', playerName: room.playerInfos.find(p => p.id === winnerId)?.name || 'Người chơi' }
                   });
                }

                const endGameEvents: any[] = [];
                room.game.players.forEach(p => {
                  if (p.isBurned) {
                    endGameEvents.push({ type: 'chay_bai', playerName: p.name });
                  } else if (p.id !== winnerId) {
                    const thui = MoneyEngine.calculateThui(p, room.game!.bet);
                    if (thui.totalLoss > 0) {
                      thui.details.forEach(detail => {
                        let eventType: any = 'thui_heo';
                        if (detail.includes('thông')) eventType = 'thui_3_doi_thong';
                        else if (detail.includes('Tứ quý')) eventType = 'thui_tu_quy';
                        endGameEvents.push({ type: eventType, playerName: p.name });
                      });
                    }
                  }
                });

                endGameEvents.sort((a, b) => {
                  if (a.type === 'chay_bai' && b.type !== 'chay_bai') return -1;
                  if (a.type !== 'chay_bai' && b.type === 'chay_bai') return 1;
                  return 0;
                });

                endGameEvents.forEach(ev => {
                  broadcast(room, { type: 'SPECIAL_EVENT', payload: ev });
                });
              }
              broadcastGameState(room);
            } else {
              ws.send(JSON.stringify({ type: 'ERROR', payload: error }));
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
      console.error("Lỗi xử lý tin nhắn:", e);
    }
  });

  ws.on('close', () => {
    const room = roomManager.leaveRoom(clientId);
    if (room) {
      if (room.game) room.game.removePlayer(clientId);
      broadcast(room, {
        type: 'ROOM_UPDATE',
        payload: { players: room.playerInfos, roomId: room.id }
      });
      if (room.game) broadcastGameState(room);
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
        payload: state
      }));
    }
  });
}

// 3. Xử lý SPA Routing: Fallback về index.html của thư mục dist cho mọi route không tìm thấy
app.get('*', (req, res) => {
  const indexPath = path.join(distPath, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    // Nếu chưa build dist, thử gửi file index.html ở thư mục gốc
    const rootIndexPath = path.join(__dirname, 'index.html');
    if (fs.existsSync(rootIndexPath)) {
      res.sendFile(rootIndexPath);
    } else {
      res.status(404).send('Vui lòng chạy build trước khi khởi động server trên production.');
    }
  }
});