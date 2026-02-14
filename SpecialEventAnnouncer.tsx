
import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { getSharedAudioCtx } from './App';

export type SpecialEventType = 'thui_heo' | 'thui_3_doi_thong' | 'thui_tu_quy' | 'chat_heo' | 'chat_chong' | 'chay_bai' | 'info' | 'rank' | 'three_spade_win';

interface SpecialEvent {
  id: string;
  type: SpecialEventType;
  playerName: string;
}

interface SpecialEventAnnouncerProps {
  event: SpecialEvent | null;
  onComplete: () => void;
}

const playApplauseSound = () => {
  const ctx = getSharedAudioCtx();
  if (!ctx) return;
  
  if (ctx.state === 'suspended') ctx.resume();
  
  const master = ctx.createGain();
  master.gain.value = 0.85;
  master.connect(ctx.destination);
  const now = ctx.currentTime;

  for (let i = 0; i < 15; i++) {
    const time = now + i * 0.05 + Math.random() * 0.02;
    const noise = ctx.createBufferSource();
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 0.1, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let j = 0; j < data.length; j++) data[j] = Math.random() * 2 - 1;
    noise.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1000 + Math.random() * 500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.3, time);
    g.gain.exponentialRampToValueAtTime(0.01, time + 0.08);
    noise.connect(filter);
    filter.connect(g);
    g.connect(master);
    noise.start(time);
    noise.stop(time + 0.1);
  }
};

const SpecialEventAnnouncer: React.FC<SpecialEventAnnouncerProps> = ({ event, onComplete }) => {
  useEffect(() => {
    if (event) {
      if (event.type !== 'info') playApplauseSound();
      const holdTime = event.type === 'info' ? 1200 : 2200;
      const timer = setTimeout(onComplete, holdTime);
      return () => clearTimeout(timer);
    }
  }, [event, onComplete]);

  const getConfig = () => {
    if (!event) return null;
    switch (event.type) {
      case 'thui_heo': return { text: `🔥 ${event.playerName} THÚI HEO 🔥`, sub: 'Lêu lêu đồ thối heo!', color: 'text-orange-500', shadow: 'shadow-orange-500/50' };
      case 'thui_3_doi_thong': return { text: `🎉 ${event.playerName} THÚI 3 ĐÔI THÔNG 🎉`, sub: 'Ba đôi thông mà cũng thối!', color: 'text-pink-500', shadow: 'shadow-pink-500/50' };
      case 'thui_tu_quy': return { text: `👑 ${event.playerName} THÚI TỨ QUÝ 👑`, sub: 'Tứ quý để làm cảnh à?', color: 'text-purple-500', shadow: 'shadow-purple-500/50' };
      case 'chat_heo': return { text: `💥 ${event.playerName} BỊ CHẶT HEO 💥`, sub: 'Ăn chặt cho chừa!', color: 'text-red-500', shadow: 'shadow-red-500/50' };
      case 'chat_chong': return { text: `⚡ ${event.playerName} BỊ CHẶT CHỒNG ⚡`, sub: 'Chặt chồng nè con!', color: 'text-yellow-400', shadow: 'shadow-yellow-400/50' };
      case 'chay_bai': return { text: `❄️ ${event.playerName} BỊ CÓNG! ❄️`, sub: 'Chưa đánh lá nào đã cháy!', color: 'text-cyan-400', shadow: 'shadow-cyan-400/50' };
      case 'three_spade_win': return { text: `♠️ ${event.playerName} 3 BÍCH VỀ CHÓT (x2) ♠️`, sub: 'Pha lật kèo đỉnh cao!', color: 'text-emerald-400', shadow: 'shadow-emerald-400/50' };
      case 'info': return { text: `✨ ${event.playerName} ✨`, sub: '', color: 'text-emerald-400', shadow: 'shadow-emerald-400/50' };
      default: return null;
    }
  };

  const config = getConfig();

  return (
    <AnimatePresence>
      {event && config && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="fixed inset-0 z-[9998] bg-black/70 backdrop-blur-[4px] pointer-events-none"
          />
          <div className="fixed inset-0 z-[9999] flex items-center justify-center pointer-events-none p-4">
            <motion.div
              initial={{ scale: 0.5, opacity: 0, y: 20 }}
              animate={{ 
                scale: [0.5, 1.1, 1], 
                opacity: 1,
                y: 0,
                rotate: event.type === 'info' ? 0 : [0, -1, 1, -1, 1, 0]
              }}
              exit={{ scale: 0.8, opacity: 0, y: -20, filter: "blur(10px)" }}
              transition={{ duration: 0.4, ease: 'backOut' }}
              className="text-center"
            >
              <div className="bg-slate-900/95 border border-white/20 px-6 py-6 md:px-8 md:py-8 rounded-[30px] md:rounded-[40px] shadow-[0_0_50px_rgba(0,0,0,0.5)] flex flex-col items-center gap-2 md:gap-4 landscape:scale-90">
                <h2 className={`${event.type === 'info' ? 'text-xl md:text-4xl' : 'text-2xl md:text-6xl'} font-black italic uppercase tracking-tighter ${config.color} drop-shadow-[0_0_30px_rgba(255,255,255,0.3)] landscape-scale-text`}>
                  {config.text}
                </h2>
                {config.sub && (
                   <p className="text-white/60 text-[10px] md:text-sm font-bold uppercase tracking-widest">{config.sub}</p>
                )}
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
};

export default SpecialEventAnnouncer;
