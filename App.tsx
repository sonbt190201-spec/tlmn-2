
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardSuit, GameHistory, HandType, ChatMessage, TrollAction, TrollType } from './types';
import ChopEffect, { ChopType } from './ChopEffect';
import OverChopEffect from './OverChopEffect';
import RankEffect from './RankEffect';
import ChatModule from './ChatModule';
import TrollModule from './TrollModule';
import SpecialEventAnnouncer, { SpecialEventType } from './SpecialEventAnnouncer';

// MOBILE AUDIO FIX START
let sharedAudioCtx: AudioContext | null = null;

export const getSharedAudioCtx = () => {
  if (typeof window === 'undefined') return null;
  if (!sharedAudioCtx) {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (AudioContextClass) {
      sharedAudioCtx = new AudioContextClass();
    }
  }
  return sharedAudioCtx;
};

const unlockAudio = async () => {
  const ctx = getSharedAudioCtx();
  if (!ctx) return;
  if (ctx.state === 'suspended') {
    await ctx.resume();
  }
  const buffer = ctx.createBuffer(1, 1, 22050);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  source.start(0);
};
// MOBILE AUDIO FIX END

const SUIT_SYMBOLS: Record<CardSuit, string> = {
  spade: '♠',
  club: '♣',
  diamond: '♦',
  heart: '♥',
};

const SUIT_COLORS: Record<CardSuit, string> = {
  spade: 'text-slate-900',
  club: 'text-slate-900',
  diamond: 'text-red-600',
  heart: 'text-red-600',
};

const getRankLabel = (rank: number) => {
  if (rank <= 10) return rank.toString();
  if (rank === 11) return 'J';
  if (rank === 12) return 'Q';
  if (rank === 13) return 'K';
  if (rank === 14) return 'A';
  if (rank === 15) return '2';
  return '';
};

const playSfx = (type: 'play' | 'pass' | 'deal' | 'click' | 'win') => {
  const ctx = getSharedAudioCtx();
  if (!ctx) return;
  if (ctx.state === 'suspended') ctx.resume();
  const now = ctx.currentTime;
  const master = ctx.createGain();
  master.gain.value = 0.8;
  master.connect(ctx.destination);

  switch (type) {
    case 'deal':
      for (let i = 0; i < 13; i++) {
        const time = now + i * 0.08;
        const oscD = ctx.createOscillator();
        const gD = ctx.createGain();
        oscD.type = 'sine';
        oscD.frequency.setValueAtTime(800 + (i * 20), time);
        oscD.frequency.exponentialRampToValueAtTime(400, time + 0.05);
        gD.gain.setValueAtTime(0.1, time);
        gD.gain.exponentialRampToValueAtTime(0.01, time + 0.05);
        oscD.connect(gD); gD.connect(master);
        oscD.start(time); oscD.stop(time + 0.05);
      }
      break;
    case 'play':
      const oscP = ctx.createOscillator();
      const gP = ctx.createGain();
      oscP.type = 'triangle';
      oscP.frequency.setValueAtTime(150, now);
      oscP.frequency.exponentialRampToValueAtTime(60, now + 0.15);
      gP.gain.setValueAtTime(0.5, now);
      gP.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
      oscP.connect(gP); gP.connect(master);
      oscP.start(); oscP.stop(now + 0.15);
      break;
    case 'pass':
      const oscS = ctx.createOscillator();
      const gS = ctx.createGain();
      oscS.type = 'sine';
      oscS.frequency.setValueAtTime(300, now);
      oscS.frequency.linearRampToValueAtTime(500, now + 0.2);
      gS.gain.setValueAtTime(0.1, now);
      gS.gain.linearRampToValueAtTime(0, now + 0.2);
      oscS.connect(gS); gS.connect(master);
      oscS.start(); oscS.stop(now + 0.2);
      break;
    case 'click':
      const oscC = ctx.createOscillator();
      const gC = ctx.createGain();
      oscC.type = 'sine';
      oscC.frequency.setValueAtTime(1200, now);
      gC.gain.setValueAtTime(0.1, now);
      gC.gain.exponentialRampToValueAtTime(0.01, now + 0.05);
      oscC.connect(gC); gC.connect(master);
      oscC.start(); oscC.stop(now + 0.05);
      break;
  }
};

const HistoryModal: React.FC<{ history: GameHistory[], onClose: () => void }> = ({ history, onClose }) => {
  const stats = useMemo(() => {
    const playerStats: Record<string, { 
      name: string, 
      r1: number, r2: number, r3: number, r4: number, 
      totalChange: number 
    }> = {};

    history.forEach(game => {
      game.players.forEach(p => {
        if (!playerStats[p.id]) {
          playerStats[p.id] = { name: p.name, r1: 0, r2: 0, r3: 0, r4: 0, totalChange: 0 };
        }
        playerStats[p.id].totalChange += p.change;
        if (p.rank === 1) playerStats[p.id].r1++;
        else if (p.rank === 2) playerStats[p.id].r2++;
        else if (p.rank === 3) playerStats[p.id].r3++;
        else if (p.rank === 4) playerStats[p.id].r4++;
      });
    });
    return Object.values(playerStats).sort((a, b) => b.totalChange - a.totalChange);
  }, [history]);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[500] bg-black/90 flex items-center justify-center p-4 backdrop-blur-md">
      <motion.div initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} className="bg-slate-900 border border-slate-800 w-full max-w-4xl rounded-3xl overflow-hidden shadow-2xl flex flex-col max-h-[85dvh]">
        <div className="p-6 border-b border-slate-800 flex justify-between items-center bg-slate-950/50">
          <div>
            <h2 className="text-2xl font-black text-white italic tracking-tighter uppercase">Phòng Truyền Thống</h2>
            <p className="text-slate-500 text-[10px] font-black uppercase tracking-[0.2em] mt-1">Thống kê tổng hợp {history.length} ván</p>
          </div>
          <button onClick={() => { playSfx('click'); onClose(); }} className="bg-slate-800 hover:bg-slate-700 w-10 h-10 rounded-full text-white flex items-center justify-center text-2xl transition-all">&times;</button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-6 scrollbar-hide">
          {stats.map((s, i) => (
            <div key={i} className="bg-black/40 border border-white/5 rounded-2xl p-6 flex flex-col md:flex-row justify-between items-center gap-4">
               <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-slate-800 flex items-center justify-center text-xl font-black text-white">
                     {s.name[0].toUpperCase()}
                  </div>
                  <div>
                     <h3 className="text-white font-black uppercase text-lg">{s.name}</h3>
                     <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Cơ thủ chuyên nghiệp</p>
                  </div>
               </div>
               <div className="flex gap-4 md:gap-8 text-center">
                  <div>
                    <p className="text-yellow-500 text-[10px] font-black">NHẤT</p>
                    <p className="text-white text-xl font-black">{s.r1}</p>
                  </div>
                  <div>
                    <p className="text-slate-400 text-[10px] font-black">NHÌ</p>
                    <p className="text-white text-xl font-black">{s.r2}</p>
                  </div>
                  <div>
                    <p className="text-orange-500 text-[10px] font-black">BA</p>
                    <p className="text-white text-xl font-black">{s.r3}</p>
                  </div>
                  <div>
                    <p className="text-red-500 text-[10px] font-black">BÉT</p>
                    <p className="text-white text-xl font-black">{s.r4}</p>
                  </div>
               </div>
               <div className="text-right">
                  <p className="text-slate-500 text-[10px] font-black uppercase">Tổng tài sản</p>
                  <p className={`text-2xl font-black italic ${s.totalChange >= 0 ? 'text-emerald-400' : 'text-red-500'}`}>
                    {s.totalChange > 0 ? '+' : ''}{s.totalChange.toLocaleString()} $
                  </p>
               </div>
            </div>
          ))}
        </div>
      </motion.div>
    </motion.div>
  );
};

const SettingsModal: React.FC<{ currentBet: number, onUpdate: (bet: number) => void, onClose: () => void }> = ({ currentBet, onUpdate, onClose }) => {
  const [bet, setBet] = useState(currentBet);
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[500] bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm">
      <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} className="bg-slate-900 border border-slate-700 w-full max-w-sm rounded-3xl p-8 shadow-2xl">
        <h2 className="text-2xl font-black text-white mb-6 text-center italic uppercase tracking-tighter">Cấu hình bàn chơi</h2>
        <div className="space-y-6">
          <div>
            <label className="text-slate-500 text-[10px] font-black uppercase mb-3 block tracking-widest text-center">Mức cược hiện tại</label>
            <div className="text-3xl text-center font-black text-yellow-500 mb-6 italic">{bet.toLocaleString()} $</div>
            <div className="grid grid-cols-2 gap-2">
              {[1000, 5000, 10000, 50000].map(val => (
                <button key={val} onClick={() => { playSfx('click'); setBet(val); }} className={`py-3 rounded-xl text-xs font-black border transition-all ${bet === val ? 'bg-yellow-500 text-black border-yellow-500 shadow-lg scale-105' : 'border-slate-800 text-slate-500 hover:border-slate-600'}`}>
                  {val.toLocaleString()}
                </button>
              ))}
            </div>
          </div>
          <div className="pt-4 space-y-2">
            <button onClick={() => { playSfx('click'); onUpdate(bet); onClose(); }} className="w-full bg-emerald-600 hover:bg-emerald-500 py-4 rounded-xl font-black text-white shadow-xl transition-all active:scale-95 uppercase text-xs tracking-widest">Lưu Thay Đổi</button>
            <button onClick={() => { playSfx('click'); onClose(); }} className="w-full py-2 text-slate-500 text-[10px] font-black uppercase tracking-widest">Đóng</button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
};

const CardComponent: React.FC<{ card: Card | null; isSelected?: boolean; onClick?: () => void; isDealing?: boolean; index?: number }> = ({ card, isSelected, onClick, isDealing, index = 0 }) => {
  if (!card) {
    return (
      <div className="game-card bg-slate-800 rounded-md border border-slate-700 flex items-center justify-center shadow-md">
        <div className="w-[70%] h-[70%] border border-slate-600 rounded flex items-center justify-center opacity-10">
          <span className="text-[10px] md:text-xl font-black">TL</span>
        </div>
      </div>
    );
  }
  return (
    <motion.div
      layoutId={card.id}
      initial={isDealing ? { x: 0, y: -300, opacity: 0, rotate: 180, scale: 0.5 } : false}
      animate={isDealing ? { x: 0, y: isSelected ? -15 : 0, opacity: 1, rotate: 0, scale: 1 } : { y: isSelected ? -15 : 0, opacity: 1, scale: 1 }}
      transition={{ delay: isDealing ? index * 0.08 : 0, type: "spring", stiffness: 150, damping: 18 }}
      onClick={onClick}
      whileHover={{ y: -5 }}
      className={`relative game-card bg-white rounded-md md:rounded-lg shadow-xl cursor-pointer select-none flex flex-col p-1 md:p-2 border ${isSelected ? 'border-yellow-400 ring-2 ring-yellow-400/50' : 'border-slate-200'}`}
    >
      <div className={`text-[12px] md:text-2xl font-black leading-none ${SUIT_COLORS[card.suit]}`}>{getRankLabel(card.rank)}</div>
      <div className={`text-[10px] md:text-xl ${SUIT_COLORS[card.suit]}`}>{SUIT_SYMBOLS[card.suit]}</div>
      <div className={`absolute bottom-0.5 right-0.5 text-2xl md:text-5xl opacity-10 ${SUIT_COLORS[card.suit]}`}>{SUIT_SYMBOLS[card.suit]}</div>
    </motion.div>
  );
};

const App: React.FC = () => {
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [gameState, setGameState] = useState<any>(null);
  const [roomInfo, setRoomInfo] = useState<any>(null);
  const [myId] = useState(() => 'user-' + Math.random().toString(36).substr(2, 9));
  const [name, setName] = useState('');
  const [isJoined, setIsJoined] = useState(false);
  const [selectedCards, setSelectedCards] = useState<string[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [activeTrolls, setActiveTrolls] = useState<TrollAction[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [specialEventQueue, setSpecialEventQueue] = useState<any[]>([]);
  const [dealingCards, setDealingCards] = useState(false);
  const [isLandscape, setIsLandscape] = useState(false);
  const prevPhase = useRef<string | null>(null);

  const [isMicOn, setIsMicOn] = useState(false);
  const peersRef = useRef<Record<string, RTCPeerConnection>>({});
  const iceQueuesRef = useRef<Record<string, RTCIceCandidateInit[]>>({});
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioContainerRef = useRef<HTMLDivElement>(null);

  const onEffectComplete = useCallback(() => {
    setSpecialEventQueue(prev => prev.slice(1));
  }, []);

  const handleVoiceSignal = useCallback(async ({ fromId, signal, type }: any, socket: WebSocket) => {
    const pc = getOrCreatePeer(fromId, socket);
    if (type === 'offer') {
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(signal));
        const queue = iceQueuesRef.current[fromId] || [];
        while(queue.length > 0) {
           const cand = queue.shift();
           if(cand) await pc.addIceCandidate(new RTCIceCandidate(cand));
        }
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.send(JSON.stringify({ type: 'VOICE_SIGNAL', payload: { toId: fromId, signal: answer, type: 'answer' } }));
      } catch (e) { console.error("Offer error", e); }
    } else if (type === 'answer') {
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(signal));
        const queue = iceQueuesRef.current[fromId] || [];
        while(queue.length > 0) {
           const cand = queue.shift();
           if(cand) await pc.addIceCandidate(new RTCIceCandidate(cand));
        }
      } catch (e) { console.error("Answer error", e); }
    } else if (type === 'candidate') {
      try {
        if (pc.remoteDescription) {
          await pc.addIceCandidate(new RTCIceCandidate(signal));
        } else {
          if (!iceQueuesRef.current[fromId]) iceQueuesRef.current[fromId] = [];
          iceQueuesRef.current[fromId].push(signal);
        }
      } catch (e) { console.error("Candidate error", e); }
    }
  }, []);

  const getOrCreatePeer = (targetId: string, socket: WebSocket) => {
    if (peersRef.current[targetId]) return peersRef.current[targetId];
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        socket.send(JSON.stringify({ type: 'VOICE_SIGNAL', payload: { toId: targetId, signal: e.candidate, type: 'candidate' } }));
      }
    };
    pc.ontrack = (e) => {
      let audio = document.getElementById(`audio-${targetId}`) as HTMLAudioElement;
      if (!audio) {
        audio = document.createElement('audio');
        audio.id = `audio-${targetId}`;
        audio.autoplay = true;
        audio.setAttribute('playsinline', 'true');
        audio.muted = false;
        remoteAudioContainerRef.current?.appendChild(audio);
      }
      audio.srcObject = e.streams[0];
      audio.play().catch(err => console.debug("Autoplay deferred", err));
    };
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        pc.addTrack(track, localStreamRef.current!);
      });
    }
    peersRef.current[targetId] = pc;
    return pc;
  };

  const toggleMic = async () => {
    await unlockAudio();
    playSfx('click');
    if (!isMicOn) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        localStreamRef.current = stream;
        setIsMicOn(true);
        if (ws && roomInfo?.players) {
           roomInfo.players.forEach((p: any) => {
              if (p.id !== myId) {
                const pc = getOrCreatePeer(p.id, ws);
                pc.createOffer().then(offer => {
                  pc.setLocalDescription(offer);
                  ws.send(JSON.stringify({ type: 'VOICE_SIGNAL', payload: { toId: p.id, signal: offer, type: 'offer' } }));
                });
              }
           });
        }
      } catch (err) {
        alert("Cần quyền micro để voice chat.");
      }
    } else {
      localStreamRef.current?.getTracks().forEach(t => t.stop());
      localStreamRef.current = null;
      setIsMicOn(false);
      Object.keys(peersRef.current).forEach(id => {
        peersRef.current[id].close();
        document.getElementById(`audio-${id}`)?.remove();
        delete peersRef.current[id];
        delete iceQueuesRef.current[id];
      });
    }
  };

  useEffect(() => {
    const updateOrientation = () => {
      setIsLandscape(window.innerWidth > window.innerHeight);
    };
    window.addEventListener('resize', updateOrientation);
    updateOrientation();
    return () => window.removeEventListener('resize', updateOrientation);
  }, []);

  useEffect(() => {
    const host = window.location.host;
    if (!host) return;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${host}`;
    let socket: WebSocket;
    try { socket = new WebSocket(wsUrl); } catch (e) { return; }
    
    socket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'ROOM_UPDATE') setRoomInfo(data.payload);
      else if (data.type === 'GAME_STATE') {
        const newState = data.payload;
        if (newState.gamePhase === 'playing' && prevPhase.current !== 'playing') {
          setDealingCards(true);
          setTimeout(() => setDealingCards(false), 2500); 
          playSfx('deal');
        }
        setGameState(newState);
        prevPhase.current = newState.gamePhase;
      }
      else if (data.type === 'CHAT_UPDATE') setMessages(prev => [...prev, data.payload].slice(-30));
      else if (data.type === 'TROLL_EVENT') setActiveTrolls(prev => [...prev, data.payload].slice(-10));
      else if (data.type === 'VOICE_SIGNAL_RECV') handleVoiceSignal(data.payload, socket);
      else if (data.type === 'SPECIAL_EVENT') {
        setSpecialEventQueue(prev => [...prev, { ...data.payload, id: Math.random().toString(36).substr(2, 9) }]);
      }
      else if (data.type === 'ERROR') {
        setSpecialEventQueue(prev => [...prev, { id: 'err-'+Date.now(), type: 'info', playerName: data.payload }]);
      }
    };
    setWs(socket);
    return () => socket.close();
  }, [myId, handleVoiceSignal]);

  const joinGame = useCallback(async () => {
    await unlockAudio();
    if (ws && ws.readyState === WebSocket.OPEN && name) {
      ws.send(JSON.stringify({ type: 'JOIN_ROOM', payload: { id: myId, name, roomId: new URLSearchParams(window.location.search).get('room') || '' } }));
      setIsJoined(true);
    }
  }, [ws, name, myId]);

  const copyInviteLink = async () => {
    await unlockAudio();
    const url = new URL(window.location.href);
    url.searchParams.set('room', roomInfo?.roomId || '');
    navigator.clipboard.writeText(url.toString());
    playSfx('click');
    setSpecialEventQueue(prev => [...prev, { id: 'invite-copy-'+Date.now(), type: 'info', playerName: 'LINK MỜI ĐÃ COPY' }]);
  };

  const handlePlayCards = async () => {
    if (selectedCards.length === 0) return;
    await unlockAudio();
    playSfx('play');
    ws?.send(JSON.stringify({ type: 'PLAY_CARDS', payload: { cardIds: selectedCards } }));
    setSelectedCards([]);
  };

  const orderedPlayers = useMemo(() => {
    if (!gameState?.players) return roomInfo?.players || [];
    const myIndex = gameState.players.findIndex((p: any) => p.id === myId);
    if (myIndex === -1) return gameState.players;
    return [...gameState.players.slice(myIndex), ...gameState.players.slice(0, myIndex)];
  }, [gameState, roomInfo, myId]);

  const playerPositions = useMemo(() => {
    const pos: Record<string, { x: string, y: string }> = {};
    if (!orderedPlayers.length) return pos;
    if (isLandscape) {
      pos[orderedPlayers[0].id] = { x: '50%', y: '82%' };
      if (orderedPlayers.length > 1) pos[orderedPlayers[1].id] = { x: '50%', y: '18%' }; 
      if (orderedPlayers.length > 2) pos[orderedPlayers[2].id] = { x: '15%', y: '50%' }; 
      if (orderedPlayers.length > 3) pos[orderedPlayers[3].id] = { x: '85%', y: '50%' }; 
    } else {
      pos[orderedPlayers[0].id] = { x: '50%', y: '85%' };
      if (orderedPlayers.length > 1) pos[orderedPlayers[1].id] = { x: '50%', y: '15%' }; 
      if (orderedPlayers.length > 2) pos[orderedPlayers[2].id] = { x: '12%', y: '50%' }; 
      if (orderedPlayers.length > 3) pos[orderedPlayers[3].id] = { x: '88%', y: '50%' }; 
    }
    return pos;
  }, [orderedPlayers, isLandscape]);

  const handleStartGame = async () => {
    await unlockAudio();
    playSfx('click');
    if ((roomInfo?.players?.length || 0) < 2) {
      setSpecialEventQueue(prev => [...prev, { id: 'error-'+Date.now(), type: 'info', playerName: 'CẦN ÍT NHẤT 2 NGƯỜI' }]);
      return;
    }
    ws?.send(JSON.stringify({ type: 'START_GAME' }));
  };

  if (!isJoined) {
    return (
      <div className="h-screen flex items-center justify-center bg-slate-950 p-4">
        <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-slate-900 p-8 rounded-3xl border border-slate-800 shadow-2xl w-full max-w-md">
          <h1 className="text-4xl font-black text-white mb-6 text-center italic">TIẾN LÊN</h1>
          <input className="w-full bg-slate-950 border border-slate-800 p-4 rounded-xl text-white mb-4 outline-none focus:ring-2 ring-emerald-500" placeholder="Biệt danh..." value={name} maxLength={12} onChange={e => setName(e.target.value)} />
          <button onClick={joinGame} className="w-full bg-emerald-600 py-4 rounded-xl font-black text-white shadow-lg">THAM GIA</button>
        </motion.div>
      </div>
    );
  }

  const me = gameState?.players?.find((p: any) => p.id === myId);
  const isMyTurn = gameState?.players && gameState.players[gameState.currentTurn]?.id === myId;
  const lastMove = gameState?.lastMove;
  const currentEffect = specialEventQueue[0] || null;

  return (
    <div className="h-screen h-[100dvh] bg-slate-950 relative overflow-hidden flex flex-col font-sans select-none">
      <div ref={remoteAudioContainerRef} className="hidden pointer-events-none" />
      
      {/* Troll Module placed at the very top level for correct stacking and interaction */}
      <TrollModule activeTrolls={activeTrolls} playerPositions={playerPositions} />

      <div className="absolute top-4 right-4 flex gap-2 z-[200]">
        <button onClick={copyInviteLink} className="bg-slate-900/80 border border-white/10 p-3 rounded-2xl flex items-center gap-2 hover:bg-slate-800 transition-all active:scale-95 shadow-xl backdrop-blur-md">
          <span className="text-sm">🔗</span><span className="text-[10px] font-black text-white uppercase hidden md:inline">Mời bạn</span>
        </button>
        <button onClick={async () => { await unlockAudio(); playSfx('click'); setShowHistory(true); }} className="bg-slate-900/80 border border-white/10 p-3 rounded-2xl flex items-center gap-2 hover:bg-slate-800 transition-all active:scale-95 shadow-xl backdrop-blur-md">
          <span className="text-sm">📊</span><span className="text-[10px] font-black text-white uppercase hidden md:inline">Lịch sử</span>
        </button>
        <button onClick={async () => { await unlockAudio(); playSfx('click'); setShowSettings(true); }} className="bg-slate-900/80 border border-white/10 p-3 rounded-2xl flex items-center gap-2 hover:bg-slate-800 transition-all active:scale-95 shadow-xl backdrop-blur-md">
          <span className="text-sm">⚙️</span><span className="text-[10px] font-black text-white uppercase hidden md:inline">Cài đặt</span>
        </button>
      </div>

      <ChatModule messages={messages} onSendMessage={(m) => ws?.send(JSON.stringify({ type: 'SEND_CHAT', payload: { message: m } }))} myId={myId} />
      
      <div className={`flex-1 relative ${isLandscape ? 'landscape-scale' : ''}`}>
         <div className="absolute inset-0 z-[50] pointer-events-none">
           {orderedPlayers.slice(1).map((p: any) => (
             <div key={p.id} className="absolute text-center group pointer-events-auto avatar-landscape" style={{ left: playerPositions[p.id].x, top: playerPositions[p.id].y, transform: 'translate(-50%, -50%)' }}>
                <PlayerAvatar player={p} isTurn={gameState?.players[gameState.currentTurn]?.id === p.id} onTroll={(type) => ws?.send(JSON.stringify({ type: 'SEND_TROLL', payload: { type, toId: p.id } }))} />
             </div>
           ))}
         </div>

         <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-[10]">
            <div className={`w-[85vw] md:w-[60vw] h-[30vh] md:h-[40vh] bg-emerald-900/40 rounded-[100px] border-[2px] border-emerald-500/30 flex items-center justify-center shadow-[inset_0_0_50px_rgba(0,0,0,0.5)] relative ${isLandscape ? 'scale-90' : ''}`}>
               <div className="flex gap-1 scale-75 md:scale-100">
                  <AnimatePresence mode='popLayout'>
                    {lastMove?.cards.map((c: any) => (
                      <motion.div key={c.id} initial={{ scale: 2, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}><CardComponent card={c} /></motion.div>
                    ))}
                  </AnimatePresence>
               </div>
               {gameState?.gamePhase !== 'playing' && (
                 <button onClick={handleStartGame} className="pointer-events-auto bg-yellow-500 px-12 py-4 rounded-2xl font-black shadow-2xl text-xl uppercase italic">CHIA BÀI</button>
               )}
            </div>
         </div>
      </div>

      <AnimatePresence>
        {currentEffect?.type === 'chat_heo' && (
          <ChopEffect 
            key={currentEffect.id} 
            isChopHeo={true} 
            chopType={currentEffect.chopType || 'three_pairs'} 
            onComplete={onEffectComplete} 
          />
        )}
        {currentEffect?.type === 'chat_chong' && (
          <OverChopEffect 
            key={currentEffect.id} 
            isOverChop={true} 
            onComplete={onEffectComplete} 
          />
        )}
        {['thui_heo', 'thui_3_doi_thong', 'thui_tu_quy', 'chay_bai', 'info', 'three_spade_win'].includes(currentEffect?.type) && (
          <SpecialEventAnnouncer 
            key={currentEffect.id}
            event={currentEffect} 
            onComplete={onEffectComplete} 
          />
        )}
        
        {gameState?.gamePhase === 'finished' && me?.finishedRank && (
          <RankEffect 
            key={'rank-'+me.id} 
            rank={me.finishedRank as any} 
            playerName={me.name} 
          />
        )}
      </AnimatePresence>

      <div className="bg-slate-900/80 backdrop-blur-xl border-t border-white/10 pt-2 pb-safe px-2 md:px-4 z-[100]">
          <div className="max-w-full mx-auto flex -space-x-5 md:-space-x-8 justify-center overflow-x-auto scrollbar-hide py-3 px-10">
             <AnimatePresence>
               {me?.hand?.map((c: any, idx: number) => (
                 <CardComponent key={c.id || idx} card={c} isDealing={dealingCards} index={idx} isSelected={selectedCards.includes(c?.id)} onClick={() => setSelectedCards(prev => prev.includes(c.id) ? prev.filter(id => id !== c.id) : [...prev, c.id])} />
               ))}
             </AnimatePresence>
          </div>
          <div className="flex justify-between items-center py-2 max-w-lg mx-auto gap-4">
             <button onClick={toggleMic} className={`w-12 h-12 rounded-full flex items-center justify-center shadow-lg transition-all active:scale-90 ${isMicOn ? 'bg-red-500' : 'bg-slate-700'} pointer-events-auto z-[200]`}>
                {isMicOn ? '🎤' : '🔇'}
             </button>
             {gameState?.gamePhase === 'playing' && (
               <div className="flex-1 flex gap-2 pointer-events-auto">
                 <button onClick={async () => { await unlockAudio(); playSfx('pass'); ws?.send(JSON.stringify({ type: 'PASS_TURN' })); }} disabled={!isMyTurn || !lastMove} className="flex-1 py-3 bg-slate-800 rounded-xl font-black text-[10px] uppercase tracking-widest disabled:opacity-20 border border-white/5">Bỏ lượt</button>
                 <button onClick={handlePlayCards} disabled={!isMyTurn || selectedCards.length === 0} className="flex-1 py-3 bg-emerald-600 rounded-xl font-black text-[10px] uppercase tracking-widest shadow-lg disabled:opacity-20 border border-emerald-400">Đánh bài</button>
               </div>
             )}
          </div>
      </div>
      
      <AnimatePresence>
        {showHistory && <HistoryModal history={gameState?.history || []} onClose={() => setShowHistory(false)} />}
        {showSettings && <SettingsModal currentBet={gameState?.bet || 10000} onUpdate={(bet) => ws?.send(JSON.stringify({ type: 'UPDATE_BET', payload: { bet } }))} onClose={() => setShowSettings(false)} />}
      </AnimatePresence>
    </div>
  );
};

const PlayerAvatar: React.FC<{ player: any, isTurn: boolean, onTroll: (type: TrollType) => void }> = ({ player, isTurn, onTroll }) => {
  const [showTrollPanel, setShowTrollPanel] = useState(false);
  
  return (
    <div className={`relative p-1.5 rounded-2xl border-2 transition-all shadow-xl ${isTurn ? 'border-yellow-400 bg-yellow-500/20 scale-110' : 'border-white/5 bg-slate-900/80'}`}>
      <div className="w-10 h-10 md:w-14 md:h-14 bg-slate-800 rounded-xl flex items-center justify-center text-xl font-black relative overflow-visible">
         {player.name ? player.name[0].toUpperCase() : '?'}
         {player.hand?.length > 0 && <div className="absolute top-0 right-0 bg-red-600 text-[8px] px-1.5 py-0.5 rounded-bl-md font-black">{player.hand.length}</div>}
         
         <motion.button 
           whileHover={{ scale: 1.15 }}
           whileTap={{ scale: 0.9 }}
           onClick={async (e) => { e.stopPropagation(); await unlockAudio(); setShowTrollPanel(!showTrollPanel); }}
           className="absolute -top-3 -left-3 w-8 h-8 bg-slate-700/90 rounded-full flex items-center justify-center text-sm border border-white/20 shadow-2xl active:scale-90 z-[50]"
         >
           🖕
         </motion.button>

         <AnimatePresence>
           {showTrollPanel && (
             <motion.div 
               initial={{ opacity: 0, scale: 0.5, y: 10 }}
               animate={{ opacity: 1, scale: 1, y: 0 }}
               exit={{ opacity: 0, scale: 0.5, y: 10 }}
               className="absolute -top-14 left-0 bg-slate-800/95 backdrop-blur-md border border-white/20 rounded-2xl p-2 flex gap-3 z-[300] shadow-2xl pointer-events-auto"
             >
                {(['stone', 'tomato', 'bomb', 'water', 'egg'] as TrollType[]).map(t => (
                  <motion.button 
                    key={t} 
                    whileHover={{ scale: 1.2 }}
                    whileTap={{ scale: 0.8 }}
                    onClick={async (e) => { 
                      e.stopPropagation(); 
                      await unlockAudio(); 
                      onTroll(t); 
                      setShowTrollPanel(false); 
                    }} 
                    className="text-xl"
                  >
                    {t === 'stone' ? '🪨' : t === 'tomato' ? '🍅' : t === 'bomb' ? '💣' : t === 'water' ? '🪣' : '🥚'}
                  </motion.button>
                ))}
             </motion.div>
           )}
         </AnimatePresence>
      </div>
      <div className="mt-1">
        <p className="text-white text-[9px] font-black truncate max-w-[60px] uppercase">{player.name}</p>
        <p className="text-yellow-500 text-[8px] font-bold italic">${player.balance?.toLocaleString()}</p>
      </div>
    </div>
  );
};

export default App;
