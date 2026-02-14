
import React, { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { getSharedAudioCtx } from './App';

export type RankType = 1 | 2 | 3 | 4;

interface RankEffectProps {
  rank: RankType | null;
  playerName: string;
  onComplete?: () => void;
}

const playRankSoundSynth = (rank: RankType) => {
  const ctx = getSharedAudioCtx();
  if (!ctx) return;
  
  if (ctx.state === 'suspended') ctx.resume();
  
  const master = ctx.createGain();
  // Tăng âm lượng hiệu ứng xếp hạng từ 0.5 lên 0.9
  master.gain.value = 0.9;
  master.connect(ctx.destination);
  const now = ctx.currentTime;

  if (rank === 1) {
    [440, 554.37, 659.25, 880].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + i * 0.1);
      g.gain.setValueAtTime(0, now + i * 0.1);
      g.gain.linearRampToValueAtTime(0.3, now + i * 0.1 + 0.05);
      g.gain.exponentialRampToValueAtTime(0.01, now + i * 0.1 + 0.5);
      osc.connect(g);
      g.connect(master);
      osc.start(now + i * 0.1);
      osc.stop(now + i * 0.1 + 0.6);
    });
  } else if (rank === 4) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(110, now);
    osc.frequency.exponentialRampToValueAtTime(55, now + 0.5);
    g.gain.setValueAtTime(0.3, now);
    g.gain.exponentialRampToValueAtTime(0.01, now + 0.8);
    osc.connect(g);
    g.connect(master);
    osc.start();
    osc.stop(now + 0.8);
  } else {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(330, now);
    g.gain.setValueAtTime(0.3, now);
    g.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
    osc.connect(g);
    g.connect(master);
    osc.start();
    osc.stop(now + 0.3);
  }
};

const RankEffect: React.FC<RankEffectProps> = ({ rank, playerName, onComplete }) => {
  const [activeRank, setActiveRank] = useState<RankType | null>(null);
  const [activeName, setActiveName] = useState("");
  const audioPlayed = useRef(false);

  useEffect(() => {
    if (rank && !audioPlayed.current) {
      setActiveRank(rank);
      setActiveName(playerName);
      audioPlayed.current = true;
      playRankSoundSynth(rank);
      const timer = setTimeout(() => {
        setActiveRank(null);
        audioPlayed.current = false;
        if (onComplete) onComplete();
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [rank, playerName, onComplete]);

  const getRankConfig = (r: RankType) => {
    switch (r) {
      case 1: return { text: "🏆 VỀ NHẤT", color: "text-yellow-400", shadow: "drop-shadow-[0_0_30px_rgba(234,179,8,0.8)]", bg: "from-yellow-500/20" };
      case 2: return { text: "🥈 VỀ NHÌ", color: "text-slate-300", shadow: "drop-shadow-[0_0_20px_rgba(203,213,225,0.6)]", bg: "from-slate-500/10" };
      case 3: return { text: "🥉 VỀ BA", color: "text-amber-600", shadow: "drop-shadow-[0_0_15px_rgba(180,83,9,0.5)]", bg: "from-amber-900/10" };
      case 4: return { text: "💀 VỀ BÉT", color: "text-red-500", shadow: "drop-shadow-[0_0_20px_rgba(239,68,68,0.7)]", bg: "from-red-950/20" };
    }
  };

  return (
    <AnimatePresence>
      {activeRank && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center pointer-events-none">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className={`absolute inset-0 bg-gradient-to-b ${getRankConfig(activeRank).bg} to-transparent`}
          />
          <motion.div
            initial={{ scale: 0.5, y: 50, opacity: 0 }}
            animate={{ scale: [0.5, 1.2, 1], y: 0, opacity: 1 }}
            exit={{ scale: 1.5, opacity: 0, filter: "blur(10px)" }}
            transition={{ duration: 0.6, times: [0, 0.7, 1], ease: "easeOut" }}
            className="text-center relative z-10"
          >
            <h2 className={`text-6xl md:text-9xl font-black italic tracking-tighter uppercase ${getRankConfig(activeRank).color} ${getRankConfig(activeRank).shadow}`}>
              {getRankConfig(activeRank).text}
            </h2>
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="mt-4 text-xl md:text-3xl font-black text-white uppercase tracking-widest drop-shadow-md"
            >
              {activeName}
            </motion.p>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

export default RankEffect;
