
import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChatMessage } from './types';

interface ChatModuleProps {
  messages: ChatMessage[];
  onSendMessage: (msg: string) => void;
  myId: string;
}

const ChatModule: React.FC<ChatModuleProps> = ({ messages, onSendMessage, myId }) => {
  const [input, setInput] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;

  useEffect(() => {
    if (scrollRef.current && isOpen) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isOpen]);

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!input.trim()) return;
    onSendMessage(input.trim());
    setInput('');
  };

  return (
    <>
      {/* Nút mở chat nổi */}
      <div className="fixed bottom-4 left-4 z-[100] md:bottom-auto md:top-24 pointer-events-none">
        <button 
          onClick={() => setIsOpen(true)}
          className="pointer-events-auto bg-slate-900/90 border border-white/10 w-12 h-12 rounded-full flex items-center justify-center shadow-2xl hover:bg-slate-800 transition-all active:scale-90"
        >
          <div className="relative">
            <span className="text-xl">💬</span>
            {messages.length > 0 && (
              <span className="absolute -top-1 -right-1 bg-red-500 w-3 h-3 rounded-full border border-white/20 animate-pulse"></span>
            )}
          </div>
        </button>
      </div>

      <AnimatePresence>
        {isOpen && (
          <>
            {/* Overlay nền mờ */}
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsOpen(false)}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200]"
            />

            {/* Khung chat: Bottom Sheet trên mobile, Floating trên desktop */}
            <motion.div 
              initial={isMobile ? { y: '100%' } : { opacity: 0, scale: 0.9, x: -20 }}
              animate={isMobile ? { y: 0 } : { opacity: 1, scale: 1, x: 0 }}
              exit={isMobile ? { y: '100%' } : { opacity: 0, scale: 0.9, x: -20 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className={`fixed z-[201] flex flex-col bg-slate-900 shadow-2xl overflow-hidden border-white/10 ${
                isMobile 
                ? 'bottom-0 left-0 right-0 h-[60dvh] rounded-t-3xl border-t' 
                : 'bottom-20 left-4 w-80 h-96 rounded-2xl border'
              }`}
            >
              {/* Header */}
              <div className="p-4 border-b border-white/5 flex justify-between items-center bg-slate-800/50">
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"></div>
                  <span className="text-[11px] font-black uppercase tracking-widest text-slate-400">Trò chuyện trực tuyến</span>
                </div>
                <button 
                  onClick={() => setIsOpen(false)}
                  className="w-8 h-8 flex items-center justify-center rounded-full bg-white/5 text-white/50 hover:text-white"
                >
                  ✕
                </button>
              </div>

              {/* Danh sách tin nhắn */}
              <div 
                ref={scrollRef}
                className="flex-1 overflow-y-auto p-4 space-y-3 bg-black/20 scroll-smooth"
              >
                {messages.map((msg) => (
                  <motion.div
                    key={msg.id}
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`flex flex-col ${msg.playerId === myId ? 'items-end' : 'items-start'}`}
                  >
                    <span className="text-[9px] font-black text-slate-500 mb-1 ml-1 mr-1">{msg.playerName}</span>
                    <div className={`px-4 py-2 rounded-2xl text-[12px] max-w-[85%] break-words shadow-sm ${
                      msg.playerId === myId ? 'bg-emerald-600 text-white rounded-tr-none' : 'bg-slate-800 text-slate-100 rounded-tl-none border border-white/5'
                    }`}>
                      {msg.message}
                    </div>
                  </motion.div>
                ))}
                {messages.length === 0 && (
                  <div className="h-full flex flex-col items-center justify-center opacity-20 select-none">
                    <span className="text-4xl mb-2">💬</span>
                    <span className="text-[10px] font-black uppercase">Chưa có hội thoại nào</span>
                  </div>
                )}
              </div>

              {/* Input Form */}
              <form onSubmit={handleSubmit} className="p-4 bg-slate-900 border-t border-white/5 flex gap-2 pb-[max(1rem,env(safe-area-inset-bottom))]">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Gửi lời chúc may mắn..."
                  className="flex-1 bg-white/5 border border-white/10 p-3 text-sm text-white outline-none rounded-xl focus:bg-white/10 focus:border-emerald-500/50 transition-all"
                />
                <button 
                  type="submit"
                  disabled={!input.trim()}
                  className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-30 disabled:grayscale text-white px-5 rounded-xl text-xs font-black uppercase transition-all active:scale-95 shadow-lg"
                >
                  Gửi
                </button>
              </form>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
};

export default ChatModule;
