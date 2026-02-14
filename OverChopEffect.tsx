
import React, { useEffect } from 'react';
import { motion } from 'framer-motion';
import { getSharedAudioCtx } from './App';

interface OverChopEffectProps {
  isOverChop: boolean;
  victimId?: string;
  onComplete?: () => void;
}

const playOverChopSoundSynth = () => {
  const ctx = getSharedAudioCtx();
  if (!ctx) return;
  
  if (ctx.state === 'suspended') ctx.resume();
  
  const master = ctx.createGain();
  master.gain.value = 1.0;
  master.connect(ctx.destination);
  const now = ctx.currentTime;

  const playImpact = (startTime: number, freq: number, duration: number) => {
    const osc = ctx.createOscillator();
    const oscGain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, startTime);
    osc.frequency.exponentialRampToValueAtTime(40, startTime + 0.2);
    oscGain.gain.setValueAtTime(0, startTime);
    oscGain.gain.linearRampToValueAtTime(1, startTime + 0.02);
    oscGain.gain.exponentialRampToValueAtTime(0.01, startTime + duration);
    osc.connect(oscGain);
    oscGain.connect(master);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.1);
  };

  playImpact(now + 0.1, 180, 0.4);
  playImpact(now + 0.25, 220, 0.6);

  const sub = ctx.createOscillator();
  const subGain = ctx.createGain();
  sub.type = 'sine';
  sub.frequency.setValueAtTime(45, now + 0.2);
  subGain.gain.setValueAtTime(0, now + 0.2);
  subGain.gain.linearRampToValueAtTime(0.9, now + 0.3);
  subGain.gain.exponentialRampToValueAtTime(0.01, now + 1.8);
  sub.connect(subGain);
  subGain.connect(master);
  sub.start(now + 0.2);
  sub.stop(now + 2.0);

  const metal = ctx.createOscillator();
  const metalGain = ctx.createGain();
  metal.type = 'sawtooth';
  metal.frequency.setValueAtTime(800, now + 0.25);
  metalGain.gain.setValueAtTime(0, now + 0.25);
  metalGain.gain.linearRampToValueAtTime(0.3, now + 0.27);
  metalGain.gain.exponentialRampToValueAtTime(0.01, now + 0.6);
  metal.connect(metalGain);
  metalGain.connect(master);
  metal.start(now + 0.25);
  metal.stop(now + 0.8);
};

const OverChopEffect: React.FC<OverChopEffectProps> = ({ isOverChop, victimId, onComplete }) => {
  useEffect(() => {
    playOverChopSoundSynth();
    const timer = setTimeout(() => {
      onComplete?.();
    }, 2500);
    return () => clearTimeout(timer);
  }, [onComplete]);

  return (
    <>
      <motion.div
        initial={{ opacity: 0.8 }}
        animate={{ opacity: 0 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.6 }}
        className="fixed inset-0 z-[999] pointer-events-none bg-red-600"
      />
      <motion.div
        initial={{ scale: 0.1, opacity: 0, rotate: -20 }}
        animate={{ 
          scale: [0.1, 1.8, 1.4],
          opacity: [0, 1, 1],
          rotate: [-20, 10, 0],
          x: [-20, 20, -18, 18, -12, 12, -8, 8, 0],
          y: [-12, 12, -8, 8, 0]
        }}
        exit={{ scale: 4, opacity: 0, filter: "blur(20px)", transition: { duration: 0.3 } }}
        transition={{ duration: 0.9, times: [0, 0.4, 1] }}
        className="fixed inset-0 z-[1000] flex items-center justify-center pointer-events-none"
      >
        <div className="text-center">
          <h1 className="text-8xl md:text-[12rem] font-black italic tracking-tighter uppercase select-none text-orange-500 drop-shadow-[0_0_50px_rgba(249,115,22,0.9)]">
            CHẶT CHỒNG!
          </h1>
          <motion.div 
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="mt-8"
          >
            <span className="bg-red-600 text-white px-10 py-3 rounded-full text-3xl font-black uppercase tracking-[0.5em] shadow-[0_0_30px_rgba(220,38,38,0.5)]">
              LẬT KÈO
            </span>
          </motion.div>
        </div>
      </motion.div>
    </>
  );
};

export default OverChopEffect;
