
import React, { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { TrollAction, TrollType } from './types';
import { getSharedAudioCtx } from './App';

interface TrollModuleProps {
  activeTrolls: TrollAction[];
  playerPositions: Record<string, { x: string | number, y: string | number }>;
}

const TROLL_CONFIG: Record<TrollType, { emoji: string; sound: string }> = {
  stone: { emoji: "🪨", sound: "glass" },
  tomato: { emoji: "🍅", sound: "splat" },
  bomb: { emoji: "💣", sound: "explosion" },
  water: { emoji: "🪣", sound: "splash" },
  egg: { emoji: "🥚", sound: "splat" },
};

const playTrollSoundSynth = (type: TrollType) => {
  const ctx = getSharedAudioCtx();
  if (!ctx) return;
  
  if (ctx.state === 'suspended') ctx.resume();
  
  const now = ctx.currentTime;
  const master = ctx.createGain();
  master.gain.value = 0.85;
  master.connect(ctx.destination);

  switch (type) {
    case 'stone':
      for (let i = 0; i < 8; i++) {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(1200 + Math.random() * 2500, now + i * 0.015);
        g.gain.setValueAtTime(0.06, now + i * 0.015);
        g.gain.exponentialRampToValueAtTime(0.001, now + i * 0.015 + 0.12);
        osc.connect(g); g.connect(master);
        osc.start(now + i * 0.015); osc.stop(now + i * 0.015 + 0.12);
      }
      break;
    case 'tomato':
    case 'egg':
      const oscSplat = ctx.createOscillator();
      const gSplat = ctx.createGain();
      oscSplat.type = 'triangle';
      oscSplat.frequency.setValueAtTime(120, now);
      oscSplat.frequency.exponentialRampToValueAtTime(30, now + 0.2);
      gSplat.gain.setValueAtTime(0.2, now);
      gSplat.gain.linearRampToValueAtTime(0, now + 0.25);
      oscSplat.connect(gSplat); gSplat.connect(master);
      oscSplat.start(); oscSplat.stop(now + 0.25);
      break;
    case 'bomb':
      const noise = ctx.createBufferSource();
      const buffer = ctx.createBuffer(1, ctx.sampleRate * 1.0, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < buffer.length; i++) data[i] = Math.random() * 2 - 1;
      noise.buffer = buffer;
      const gExplode = ctx.createGain();
      gExplode.gain.setValueAtTime(0.4, now);
      gExplode.gain.exponentialRampToValueAtTime(0.001, now + 0.8);
      noise.connect(gExplode); gExplode.connect(master);
      noise.start();
      break;
    case 'water':
      const oscSplash = ctx.createOscillator();
      const gSplash = ctx.createGain();
      oscSplash.type = 'sine';
      oscSplash.frequency.setValueAtTime(450, now);
      oscSplash.frequency.exponentialRampToValueAtTime(150, now + 0.4);
      gSplash.gain.setValueAtTime(0.2, now);
      gSplash.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
      oscSplash.connect(gSplash); gSplash.connect(master);
      oscSplash.start(); oscSplash.stop(now + 0.4);
      break;
  }
};

const TrollModule: React.FC<TrollModuleProps> = ({ activeTrolls, playerPositions }) => {
  const lastPlayedId = useRef<string | null>(null);

  useEffect(() => {
    if (activeTrolls.length > 0) {
      const latest = activeTrolls[activeTrolls.length - 1];
      if (latest.id !== lastPlayedId.current) {
        lastPlayedId.current = latest.id;
        playTrollSoundSynth(latest.type);
      }
    }
  }, [activeTrolls]);

  return (
    <div className="fixed inset-0 pointer-events-none z-[999] overflow-hidden">
      <AnimatePresence>
        {activeTrolls.map((troll) => {
          const start = playerPositions[troll.fromId] || { x: '50%', y: '85dvh' };
          const end = playerPositions[troll.toId] || { x: '50%', y: '15dvh' };
          
          return (
            <motion.div
              key={troll.id}
              initial={{ opacity: 1 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0"
            >
              <motion.div
                initial={{ left: start.x, top: start.y, scale: 0.5, rotate: 0, opacity: 0 }}
                animate={{ 
                  left: end.x, 
                  top: end.y,
                  rotate: 1080,
                  scale: [0.5, 2.5, 1.2],
                  opacity: [0, 1, 1, 0]
                }}
                transition={{ duration: 0.65, ease: "circIn", times: [0, 0.2, 0.9, 1] }}
                className="absolute text-5xl -translate-x-1/2 -translate-y-1/2 z-[1010] drop-shadow-2xl"
              >
                {TROLL_CONFIG[troll.type].emoji}
              </motion.div>

              <motion.div
                initial={{ opacity: 0, scale: 0 }}
                animate={{ 
                  opacity: [0, 1, 1, 0],
                  scale: [0.5, 3.5, 3.8, 2.5],
                  left: end.x,
                  top: end.y
                }}
                transition={{ delay: 0.6, duration: 1.2 }}
                className="absolute -translate-x-1/2 -translate-y-1/2 pointer-events-none z-[1005]"
              >
                {troll.type === 'stone' && (
                  <div className="relative w-48 h-48 flex items-center justify-center">
                    {Array.from({ length: 12 }).map((_, i) => (
                      <motion.div
                        key={i}
                        initial={{ x: 0, y: 0, scale: 1, opacity: 1, rotate: 0 }}
                        animate={{ 
                          x: (Math.random() - 0.5) * 200, 
                          y: (Math.random() - 0.5) * 200,
                          scale: 0,
                          opacity: 0,
                          rotate: Math.random() * 360
                        }}
                        transition={{ duration: 0.8, delay: 0.6 }}
                        className="absolute w-6 h-6 bg-blue-100/40 border border-white/30 backdrop-blur-sm"
                        style={{ clipPath: 'polygon(50% 0%, 100% 100%, 0% 100%)' }}
                      />
                    ))}
                  </div>
                )}
                {troll.type === 'bomb' && (
                  <div className="relative">
                    <motion.div 
                      animate={{ scale: [1, 5, 0], opacity: [1, 1, 0] }}
                      transition={{ duration: 0.6, delay: 0.6 }}
                      className="absolute inset-0 bg-gradient-to-r from-orange-600 to-yellow-400 rounded-full blur-xl"
                    />
                    <div className="text-8xl filter drop-shadow-[0_0_40px_rgba(255,100,0,1)]">💥</div>
                  </div>
                )}
                {troll.type === 'tomato' && (
                  <div className="relative">
                    <motion.div 
                      animate={{ scale: [1, 3.5], opacity: [1, 0] }}
                      transition={{ duration: 0.6, delay: 0.6 }}
                      className="absolute inset-0 bg-red-600 rounded-full blur-lg"
                    />
                    <div className="text-7xl">🍅💥</div>
                  </div>
                )}
                {troll.type === 'water' && (
                  <div className="relative">
                     <motion.div 
                        animate={{ scale: [1, 4.5], opacity: [1, 0] }}
                        transition={{ duration: 0.6, delay: 0.6 }}
                        className="absolute inset-0 bg-blue-400 rounded-full blur-xl"
                      />
                    <div className="text-7xl">🌊</div>
                  </div>
                )}
                {troll.type === 'egg' && (
                  <div className="relative">
                    <motion.div 
                      animate={{ scale: [1, 3.5], opacity: [1, 0] }}
                      transition={{ duration: 0.6, delay: 0.6 }}
                      className="absolute inset-0 bg-yellow-200 rounded-full blur-lg"
                    />
                    <div className="text-7xl">🍳✨</div>
                  </div>
                )}
              </motion.div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
};

export default TrollModule;
