
import React, { useEffect } from 'react';
import { motion } from 'framer-motion';
import { getSharedAudioCtx } from './App';

/**
 * Component to display the final rank of the player at the end of a match.
 * Fixes the error where RankEffect was a duplicate of SpecialEventAnnouncer.
 */
interface RankEffectProps {
  rank: number;
  playerName: string;
}

const playRankSound = (rank: number) => {
  const ctx = getSharedAudioCtx();
  if (!ctx) return;
  
  if (ctx.state === 'suspended') ctx.resume();
  
  const master = ctx.createGain();
  master.gain.value = 1.5;
  master.connect(ctx.destination);
  const now = ctx.currentTime;

  if (rank === 1) {
    // Fanfare sound for the winner
    [440, 554.37, 659.25, 880].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + i * 0.1);
      g.gain.setValueAtTime(0.3, now + i * 0.1);
      g.gain.exponentialRampToValueAtTime(0.01, now + i * 0.1 + 0.4);
      osc.connect(g); g.connect(master);
      osc.start(now + i * 0.1); osc.stop(now + i * 0.1 + 0.4);
    });
  } else {
    // Neutral/Soft sound for other ranks
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(440 - rank * 40, now);
    g.gain.setValueAtTime(0.2, now);
    g.gain.exponentialRampToValueAtTime(0.01, now + 0.5);
    osc.connect(g); g.connect(master);
    osc.start(); osc.stop(now + 0.5);
  }
};

const RankEffect: React.FC<RankEffectProps> = ({ rank, playerName }) => {
  useEffect(() => {
    playRankSound(rank);
  }, [rank]);

  const config = {
    1: { label: 'QUÁN QUÂN', color: 'text-yellow-400', bg: 'bg-yellow-400/10', border: 'border-yellow-400/50', shadow: 'shadow-yellow-400/20' },
    2: { label: 'Á QUÂN', color: 'text-slate-300', bg: 'bg-slate-300/10', border: 'border-slate-300/50', shadow: 'shadow-slate-300/20' },
    3: { label: 'HẠNG BA', color: 'text-orange-400', bg: 'bg-orange-400/10', border: 'border-orange-400/50', shadow: 'shadow-orange-400/20' },
    4: { label: 'BÉT BẢNG', color: 'text-red-500', bg: 'bg-red-500/10', border: 'border-red-500/50', shadow: 'shadow-red-500/20' },
  }[rank as 1 | 2 | 3 | 4] || { label: 'KẾT THÚC', color: 'text-white', bg: 'bg-white/10', border: 'border-white/50', shadow: 'shadow-white/20' };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.5, y: 100 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 1.5, filter: "blur(20px)" }}
      className="fixed inset-0 z-[1500] flex items-center justify-center pointer-events-none p-4"
    >
      <div className={`px-10 py-8 md:px-16 md:py-12 rounded-[50px] border-2 backdrop-blur-2xl flex flex-col items-center gap-3 shadow-2xl ${config.bg} ${config.border} ${config.shadow}`}>
        <motion.p 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="text-white/60 text-[10px] md:text-xs font-black uppercase tracking-[0.4em]"
        >
          {playerName}
        </motion.p>
        <h1 className={`text-6xl md:text-9xl font-black italic tracking-tighter uppercase select-none drop-shadow-2xl ${config.color} landscape-scale-text`}>
          {config.label}
        </h1>
        <motion.div 
          initial={{ width: 0 }}
          animate={{ width: 100 }}
          transition={{ delay: 0.5, duration: 0.8 }}
          className={`h-1.5 rounded-full bg-white/20`}
        />
      </div>
    </motion.div>
  );
};

export default RankEffect;
