
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage, Type, FunctionDeclaration } from '@google/genai';
import { SessionStatus, TranscriptionEntry } from './types';
import { decodeBase64, decodeAudioData, createAudioBlob } from './audioUtils';

// Constants
const MODEL_NAME = 'gemini-2.5-flash-native-audio-preview-12-2025';
const RELAY_BASE = 'https://ntfy.sh';

const relayTools: FunctionDeclaration[] = [
  {
    name: 'send_to_friend',
    parameters: {
      type: Type.OBJECT,
      description: 'Sends a text message to the friend in the chat room.',
      properties: {
        message: {
          type: Type.STRING,
          description: 'The message content to send.'
        }
      },
      required: ['message']
    }
  }
];

const App: React.FC = () => {
  const [role, setRole] = useState<'operator' | 'companion' | null>(null);
  const [status, setStatus] = useState<SessionStatus>(SessionStatus.IDLE);
  const [messages, setMessages] = useState<{sender: string, text: string, time: number}[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [textInput, setTextInput] = useState('');
  const [inviteLink, setInviteLink] = useState('');
  
  // Initialize room from URL
  const [roomId, setRoomId] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('room') || '';
  });

  // Initialize join input with room ID if present
  const [joinId, setJoinId] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('room') || '';
  });

  // Auto-join if both room and role are present
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlRole = params.get('role') as 'operator' | 'companion';
    if (urlRole && roomId && !role) {
      setRole(urlRole);
    }
  }, [roomId, role]);

  // Construct the invite link whenever room/role changes
  useEffect(() => {
    if (role === 'operator' && roomId) {
      const isBlob = window.location.protocol === 'blob:' || window.location.protocol === 'file:';
      // If we are in a blob (preview) environment, we can't trust the origin.
      // We give the user a template to fill in their real domain.
      const origin = isBlob ? 'https://<YOUR_WEBSITE_ADDRESS>' : (window.location.origin + window.location.pathname);
      
      // Ensure we don't double slashes if pathname is just '/'
      const cleanOrigin = origin.endsWith('/') ? origin.slice(0, -1) : origin;
      setInviteLink(`${cleanOrigin}?room=${roomId}&role=companion`);
    }
  }, [role, roomId]);

  const audioContextsRef = useRef<{ input: AudioContext; output: AudioContext } | null>(null);
  const sessionRef = useRef<any>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const streamRef = useRef<MediaStream | null>(null);
  const lastMsgTimestamp = useRef<number>(Date.now());

  // Helper to update URL without reloading
  const updateUrl = (newRole: 'operator' | 'companion', id: string) => {
    try {
      // Prevent errors in blob/sandboxed environments
      if (window.location.protocol === 'blob:' || window.location.protocol === 'file:') return;
      
      const url = new URL(window.location.href);
      url.searchParams.set('room', id);
      url.searchParams.set('role', newRole);
      window.history.replaceState({}, '', url.toString());
    } catch (e) {
      // Ignore security errors in sandboxed iframes
    }
  };

  const handleJoin = (selectedRole: 'operator' | 'companion', id: string) => {
    setRoomId(id);
    setRole(selectedRole);
    updateUrl(selectedRole, id);
  };

  const postMessage = async (text: string, sender: 'operator' | 'companion') => {
    if (!text.trim() || !roomId) return;
    try {
      await fetch(`${RELAY_BASE}/vbridge_${roomId}`, {
        method: 'POST',
        body: JSON.stringify({ sender, text, time: Date.now() }),
      });
      if (sender === 'companion') {
        setMessages(prev => [...prev, { sender, text, time: Date.now() }]);
      }
    } catch (e) {
      console.error('Relay error:', e);
    }
  };

  // Poll for messages
  useEffect(() => {
    if (!role || !roomId) return;
    
    // Poll more frequently for snappier feel, standard polling instead of long-polling to prevent hanging
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${RELAY_BASE}/vbridge_${roomId}/json?since=${Math.floor(lastMsgTimestamp.current / 1000)}`);
        const data = await res.text();
        const lines = data.split('\n').filter(l => l.trim());
        
        for (const line of lines) {
          const entry = JSON.parse(line);
          if (!entry.message) continue;
          try {
            const payload = JSON.parse(entry.message);
            // Deduplicate based on exact timestamp and sender
            if (payload.time > lastMsgTimestamp.current && payload.sender !== role) {
              lastMsgTimestamp.current = payload.time;
              
              if (role === 'operator' && sessionRef.current) {
                sessionRef.current.sendRealtimeInput({
                  text: `SYSTEM: Friend sent message: "${payload.text}". Read it now.`
                });
              }
              setMessages(prev => [...prev, payload]);
            }
          } catch (e) {}
        }
      } catch (e) {}
    }, 1000); // Poll every second
    return () => clearInterval(interval);
  }, [role, roomId]);

  const stopAllAudio = useCallback(() => {
    sourcesRef.current.forEach(s => { try { s.stop(); } catch(e){} });
    sourcesRef.current.clear();
    nextStartTimeRef.current = 0;
  }, []);

  const startOperatorSession = async () => {
    try {
      setStatus(SessionStatus.CONNECTING);
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      
      const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      const outputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      audioContextsRef.current = { input: inputCtx, output: outputCtx };

      const sessionPromise = ai.live.connect({
        model: MODEL_NAME,
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } } },
          tools: [{ functionDeclarations: relayTools }],
          systemInstruction: `
            You are the "Voice Bridge Operator". 
            The user is 100% hands-free.
            
            DIRECTIONS:
            1. Listen to the user. When they speak, use 'send_to_friend' to relay their words.
            2. When a message arrives from the friend (SYSTEM NOTIFICATION), speak it out loud immediately.
            3. Upon starting, announce: "Operator active. Room ${roomId.split('').join(' ')}. Tell your friend to join this room code."
            4. Keep responses brief.
          `,
        },
        callbacks: {
          onopen: () => {
            setStatus(SessionStatus.CONNECTED);
            const source = inputCtx.createMediaStreamSource(stream);
            const scriptProcessor = inputCtx.createScriptProcessor(4096, 1, 1);
            scriptProcessor.onaudioprocess = (e) => {
              sessionPromise.then(s => s.sendRealtimeInput({ media: createAudioBlob(e.inputBuffer.getChannelData(0)) }));
            };
            source.connect(scriptProcessor);
            scriptProcessor.connect(inputCtx.destination);
          },
          onmessage: async (msg: LiveServerMessage) => {
            if (msg.toolCall) {
              for (const fc of msg.toolCall.functionCalls) {
                if (fc.name === 'send_to_friend') {
                  const txt = (fc.args as any).message;
                  await postMessage(txt, 'operator');
                  setMessages(p => [...p, {sender: 'operator', text: txt, time: Date.now()}]);
                  sessionPromise.then(s => s.sendToolResponse({
                    functionResponses: { id: fc.id, name: fc.name, response: { result: "Relayed." } }
                  }));
                }
              }
            }
            const audio = msg.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (audio && audioContextsRef.current) {
              const { output: ctx } = audioContextsRef.current;
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
              const buffer = await decodeAudioData(decodeBase64(audio), ctx, 24000, 1);
              const src = ctx.createBufferSource();
              src.buffer = buffer;
              src.connect(ctx.destination);
              src.start(nextStartTimeRef.current);
              nextStartTimeRef.current += buffer.duration;
              sourcesRef.current.add(src);
            }
            if (msg.serverContent?.interrupted) stopAllAudio();
          },
          onerror: () => setStatus(SessionStatus.ERROR),
          onclose: () => setStatus(SessionStatus.DISCONNECTED)
        }
      });
      sessionRef.current = await sessionPromise;
    } catch (err) {
      setError("Microphone access is required.");
      setStatus(SessionStatus.ERROR);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    alert("Copied to clipboard!");
  };

  // --- RENDERING ---

  if (!role) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-slate-950 relative overflow-hidden font-sans">
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-indigo-500 to-transparent opacity-50"></div>
        <div className="max-w-md w-full space-y-12 relative z-10">
          <header className="text-center space-y-2">
            <h1 className="text-6xl font-black tracking-tighter text-white">Voice Bridge</h1>
            <p className="text-slate-500 font-medium">Hands-Free Communication System</p>
          </header>

          <div className="space-y-4">
            {/* PATH 1: OPERATOR */}
            <div className="bg-indigo-600/10 border border-indigo-500/20 p-8 rounded-[2rem] space-y-6">
              <h2 className="text-indigo-400 font-bold uppercase tracking-widest text-xs">I am the Hands-Free User</h2>
              <button 
                onClick={() => {
                  const id = roomId || Math.random().toString(36).substring(2, 8);
                  handleJoin('operator', id);
                }}
                className="w-full py-6 rounded-2xl bg-indigo-600 hover:bg-indigo-500 transition-all font-black text-xl shadow-lg shadow-indigo-900/20 active:scale-95 flex items-center justify-center gap-3"
              >
                <span>🎙️</span> START OPERATOR
              </button>
            </div>

            <div className="relative py-4">
              <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-white/5"></div></div>
              <div className="relative flex justify-center text-xs uppercase font-bold text-slate-700 bg-slate-950 px-4 tracking-[0.3em]">OR</div>
            </div>

            {/* PATH 2: COMPANION */}
            <div className="bg-white/5 border border-white/10 p-8 rounded-[2rem] space-y-6">
              <h2 className="text-slate-500 font-bold uppercase tracking-widest text-xs">I am the Text Companion</h2>
              <div className="space-y-3">
                <input 
                  type="text" 
                  maxLength={6}
                  placeholder="ENTER ROOM CODE"
                  value={joinId}
                  onChange={(e) => setJoinId(e.target.value.toLowerCase())}
                  className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-4 text-center font-mono text-2xl tracking-[0.5em] focus:border-indigo-500 outline-none uppercase transition-all text-white"
                />
                <button 
                  disabled={joinId.length < 4}
                  onClick={() => handleJoin('companion', joinId)}
                  className="w-full py-4 rounded-xl bg-white/10 hover:bg-white/20 transition-all font-bold disabled:opacity-30 disabled:cursor-not-allowed text-white"
                >
                  JOIN ROOM
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (role === 'operator') {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center p-8 relative overflow-hidden font-sans">
        <div className="absolute inset-0 bg-indigo-600/5 blur-[120px] rounded-full pointer-events-none"></div>
        
        <header className="text-center mb-8 w-full max-w-2xl">
          <h1 className="text-2xl font-black mb-6 tracking-tighter text-white">Operator Console</h1>
          
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6 space-y-4">
            <div className="flex flex-col gap-2">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-widest text-left">Room Code</label>
              <div 
                onClick={() => copyToClipboard(roomId)}
                className="text-center py-4 bg-black/30 rounded-xl font-mono text-4xl text-indigo-400 tracking-[0.3em] uppercase cursor-pointer hover:bg-black/50 transition-all select-all"
              >
                {roomId}
              </div>
            </div>

            <div className="flex flex-col gap-2">
               <label className="text-xs font-bold text-slate-400 uppercase tracking-widest text-left">Send this link to friend</label>
               <div className="flex gap-2">
                 <input 
                   type="text" 
                   value={inviteLink}
                   onClick={(e) => (e.target as HTMLInputElement).select()}
                   onChange={(e) => setInviteLink(e.target.value)}
                   className="flex-1 bg-black/30 border border-white/10 rounded-xl px-4 py-3 font-mono text-xs text-slate-300 focus:border-indigo-500 outline-none"
                 />
                 <button 
                   onClick={() => copyToClipboard(inviteLink)}
                   className="px-4 bg-white/10 hover:bg-white/20 rounded-xl font-bold text-xs uppercase tracking-wider transition-all"
                 >
                   Copy
                 </button>
               </div>
               {inviteLink.includes('<YOUR_WEBSITE_ADDRESS>') && (
                 <p className="text-xs text-rose-400 text-left leading-relaxed">
                   ⚠ <strong>Preview Mode Detected:</strong> You are viewing this via a temporary "blob" link which cannot be shared.
                   <br/><br/>
                   To use this with a friend, you must deploy this code to a public host like <strong>GitHub Pages</strong>, <strong>Vercel</strong>, or <strong>Netlify</strong>. 
                   <br/><br/>
                   Once deployed, this link will appear automatically. For now, you can manually replace <span className="font-mono bg-rose-500/20 px-1 rounded">{'<YOUR_WEBSITE_ADDRESS>'}</span> above with your deployed URL.
                 </p>
               )}
            </div>
          </div>
        </header>

        <div className={`w-64 h-64 rounded-full flex items-center justify-center transition-all duration-1000 border-2 shadow-2xl mb-8 ${
          status === SessionStatus.CONNECTED 
            ? 'border-indigo-500 bg-indigo-500/5 shadow-indigo-500/40 animate-pulse-custom' 
            : 'border-white/5 bg-white/5'
        }`}>
          <div className="text-center">
            <span className="text-6xl block mb-3">{status === SessionStatus.CONNECTED ? '🎙️' : '💤'}</span>
            <p className="text-xs font-bold opacity-30 uppercase tracking-[0.4em] text-white">{status}</p>
          </div>
        </div>

        <div className="w-full max-w-xs">
          {status !== SessionStatus.CONNECTED ? (
            <button
              onClick={startOperatorSession}
              disabled={status === SessionStatus.CONNECTING}
              className="w-full py-6 rounded-3xl bg-indigo-600 hover:bg-indigo-500 font-black text-xl transition-all shadow-xl shadow-indigo-900/40 active:scale-95 text-white"
            >
              {status === SessionStatus.CONNECTING ? 'CONNECTING...' : 'START SESSION'}
            </button>
          ) : (
            <button
              onClick={() => { stopAllAudio(); setStatus(SessionStatus.IDLE); }}
              className="w-full py-4 rounded-2xl border border-white/10 text-slate-500 hover:text-white transition-all font-bold"
            >
              STOP SESSION
            </button>
          )}
          {error && <p className="mt-4 text-rose-500 text-center text-sm font-medium">{error}</p>}
        </div>
      </div>
    );
  }

  // COMPANION MODE VIEW (Unchanged functionality, just preserved)
  return (
    <div className="min-h-screen bg-slate-900 flex flex-col font-sans">
      <header className="p-6 bg-slate-950 border-b border-white/5 flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold text-white">Text Companion</h1>
          <p className="text-xs text-slate-500">Connected to: <span className="font-mono text-indigo-400 uppercase tracking-widest">{roomId}</span></p>
        </div>
        <div className="h-3 w-3 rounded-full bg-green-500 animate-pulse shadow-[0_0_10px_rgba(34,197,94,0.4)]"></div>
      </header>

      <div className="flex-1 overflow-y-auto p-6 space-y-6 scroll-smooth bg-black/10">
        {messages.map((m, i) => (
          <div key={i} className={`flex flex-col ${m.sender === 'companion' ? 'items-end' : 'items-start'}`}>
            <span className="text-[9px] uppercase tracking-[0.2em] font-black text-slate-600 mb-1.5 px-2">
              {m.sender === 'companion' ? 'YOU (TEXT)' : 'FRIEND (VOICE)'}
            </span>
            <div className={`max-w-[85%] px-5 py-3.5 rounded-2xl text-[16px] leading-relaxed shadow-lg ${
              m.sender === 'companion' 
                ? 'bg-indigo-600 text-white rounded-tr-none' 
                : 'bg-slate-800 text-slate-200 rounded-tl-none border border-white/5'
            }`}>
              {m.text}
            </div>
          </div>
        ))}
        {messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center opacity-10 text-center py-24 space-y-4 text-white">
            <span className="text-8xl">💬</span>
            <p className="text-xl font-bold uppercase tracking-widest">Chat Secured</p>
            <p className="text-sm">They speak, you type. Go ahead.</p>
          </div>
        )}
      </div>

      <div className="p-6 bg-slate-950 border-t border-white/5">
        <div className="flex gap-4 max-w-4xl mx-auto">
          <input 
            type="text" 
            value={textInput}
            autoFocus
            onChange={(e) => setTextInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && textInput.trim() && (postMessage(textInput, 'companion'), setTextInput(''))}
            placeholder="Type your message here..."
            className="flex-1 bg-white/5 border border-white/10 rounded-2xl px-6 py-4 outline-none focus:border-indigo-500 transition-all text-white text-lg placeholder:text-slate-600"
          />
          <button 
            onClick={() => { if(textInput.trim()) { postMessage(textInput, 'companion'); setTextInput(''); } }}
            disabled={!textInput.trim()}
            className="bg-indigo-600 px-8 rounded-2xl font-black hover:bg-indigo-500 active:scale-95 disabled:opacity-50 transition-all tracking-widest text-white"
          >
            SEND
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;
