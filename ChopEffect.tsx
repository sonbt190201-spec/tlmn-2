
import React, { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { getSharedAudioCtx } from './App';

export type ChopType = "three_pairs" | "four_of_a_kind" | "four_pairs";

interface ChopEffectProps {
  isChopHeo: boolean;
  chopType: ChopType;
  playerName?: string;
  onComplete?: () => void;
}

const playChopSoundSynth = (type: ChopType) => {
  const ctx = getSharedAudioCtx();
  if (!ctx) return;
  
  if (ctx.state === 'suspended') ctx.resume();
  
  const master = ctx.createGain();
  master.gain.value = 1.0;
  master.connect(ctx.destination);
  const now = ctx.currentTime;

  const noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const output = noiseBuffer.getChannelData(0);
  for (let i = 0; i < noiseBuffer.length; i++) output[i] = Math.random() * 2 - 1;

  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuffer;
  const noiseFilter = ctx.createBiquadFilter();
  noiseFilter.type = 'lowpass';
  noiseFilter.Q.value = 10;
  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0, now);
  noiseGain.gain.linearRampToValueAtTime(0.3, now + 0.1);
  noiseGain.gain.exponentialRampToValueAtTime(0.01, now + 0.5);
  noiseFilter.frequency.setValueAtTime(200, now);
  noiseFilter.frequency.exponentialRampToValueAtTime(2000, now + 0.2);
  noise.connect(noiseFilter);
  noiseFilter.connect(noiseGain);
  noiseGain.connect(master);
  noise.start();

  const osc = ctx.createOscillator();
  const oscGain = ctx.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(150, now + 0.1);
  osc.frequency.exponentialRampToValueAtTime(40, now + 0.3);
  oscGain.gain.setValueAtTime(0, now + 0.1);
  oscGain.gain.linearRampToValueAtTime(1, now + 0.12);
  oscGain.gain.exponentialRampToValueAtTime(0.01, now + 0.6);
  osc.connect(oscGain);
  oscGain.connect(master);
  osc.start(now + 0.1);
  osc.stop(now + 0.7);

  const sub = ctx.createOscillator();
  const subGain = ctx.createGain();
  sub.type = 'sine';
  sub.frequency.setValueAtTime(50, now + 0.12);
  subGain.gain.setValueAtTime(0, now + 0.12);
  subGain.gain.linearRampToValueAtTime(0.8, now + 0.15);
  subGain.gain.exponentialRampToValueAtTime(0.01, now + (type === 'three_pairs' ? 0.8 : 1.5));
  sub.connect(subGain);
  subGain.connect(master);
  sub.start(now + 0.12);
  sub.stop(now + 2.0);

  if (type !== 'three_pairs') {
    const metal = ctx.createOscillator();
    const metalGain = ctx.createGain();
    metal.type = 'square';
    metal.frequency.setValueAtTime(1200, now + 0.11);
    metalGain.gain.setValueAtTime(0, now + 0.11);
    metalGain.gain.linearRampToValueAtTime(0.2, now + 0.12);
    metalGain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
    metal.connect(metalGain);
    metalGain.connect(master);
    metal.start(now + 0.11);
    metal.stop(now + 0.3);
  }
};

const ChopEffect: React.FC<ChopEffectProps> = ({ isChopHeo, chopType, playerName, onComplete }) => {
  useEffect(() => {
    playChopSoundSynth(chopType);
    
    const timer = setTimeout(() => {
      onComplete?.();
    }, 5000);
    
    return () => clearTimeout(timer);
  }, [chopType, onComplete]);

  const getGlowColor = () => {
    switch (chopType) {
      case "four_of_a_kind": return "text-purple-400 drop-shadow-[0_0_25px_rgba(168,85,247,0.9)]";
      case "four_pairs": return "text-red-500 drop-shadow-[0_0_35px_rgba(239,68,68,1.0)]";
      default: return "text-yellow-500 drop-shadow-[0_0_15px_rgba(234,179,8,0.8)]";
    }
  };

  const getFlashColor = () => {
    return chopType === "four_pairs" ? "bg-red-600" : "bg-orange-600";
  };

  return (
    <>
      <motion.div
        initial={{ opacity: 0.6 }}
        animate={{ opacity: 0 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.4 }}
        className={`fixed inset-0 z-[999] pointer-events-none ${getFlashColor()}`}
      />
      <motion.div
        initial={{ scale: 0.3, opacity: 0, rotate: -10 }}
        animate={{ 
          scale: [0.3, 1.3, 1.1],
          opacity: [0, 1, 1],
          rotate: [10, -5, 0],
          x: [-15, 15, -12, 12, -8, 8, -5, 5, 0],
          y: [-8, 8, -5, 5, 0]
        }}
        exit={{ scale: 3, opacity: 0, filter: "blur(10px)", transition: { duration: 0.3 } }}
        transition={{ duration: 0.8, times: [0, 0.4, 1] }}
        className="fixed inset-0 z-[1000] flex items-center justify-center pointer-events-none px-4"
      >
        <div className="text-center">
          <h1 className={`text-4xl md:text-8xl font-black italic tracking-tighter uppercase select-none ${getGlowColor()}`}>
            {playerName ? `${playerName} BỊ CHẶT HEO. HAHAHA` : "CHẶT HEO!"}
          </h1>
          <motion.div 
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="mt-6 flex flex-col items-center gap-2"
          >
            <p className="text-white text-xl font-black uppercase tracking-[0.4em] drop-shadow-lg">
              {chopType === "four_pairs" ? "4 ĐÔI THÔNG SIÊU CẤP" : chopType === "four_of_a_kind" ? "TỨ QUÝ QUYỀN NĂNG" : "3 ĐÔI THÔNG"}
            </p>
            <div className={`h-1 w-48 rounded-full ${chopType === 'four_pairs' ? 'bg-red-500' : 'bg-yellow-500'} shadow-lg`}></div>
          </motion.div>
        </div>
      </motion.div>
    </>
  );
};

export default ChopEffect;
