'use client';

import { useEffect, useRef, useState } from 'react';
import { post } from './api';

export type RealtimeMessage =
  | { type: 'ready' | 'ping' }
  | { type: 'order.created'; orderId: string; branchId: string; number: number; status: string; channel: string }
  | { type: 'order.updated'; orderId: string; branchId: string; number: number; status: string; change: string }
  | { type: 'catalog.updated' }
  | { type: 'store.updated' };

export type RealtimeStatus = 'connecting' | 'online' | 'offline';

function socketUrl(ticket: string) {
  const configured = process.env.NEXT_PUBLIC_WS_URL;
  const base = configured
    ? configured.replace(/\/$/, '')
    : `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}`;
  return `${base}/api/realtime?ticket=${encodeURIComponent(ticket)}`;
}

/**
 * Conexão em tempo real com reconexão automática (espera crescente até 30 s).
 * Enquanto estiver offline, as telas continuam atualizando por consulta periódica.
 */
export function useRealtime(tenantId: string | undefined, onMessage: (msg: RealtimeMessage) => void) {
  const [status, setStatus] = useState<RealtimeStatus>('connecting');
  const handler = useRef(onMessage);
  handler.current = onMessage;

  useEffect(() => {
    if (!tenantId) return;
    let socket: WebSocket | null = null;
    let stopped = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const connect = async () => {
      if (stopped) return;
      setStatus('connecting');
      try {
        const { ticket } = await post<{ ticket: string }>('/realtime/ticket');
        if (stopped) return;
        socket = new WebSocket(socketUrl(ticket));
        socket.onmessage = (e) => {
          try {
            const msg = JSON.parse(e.data as string) as RealtimeMessage;
            if (msg.type === 'ready') {
              attempt = 0;
              setStatus('online');
            }
            handler.current(msg);
          } catch {
            /* ignora mensagens inválidas */
          }
        };
        socket.onclose = () => {
          setStatus('offline');
          schedule();
        };
        socket.onerror = () => socket?.close();
      } catch {
        setStatus('offline');
        schedule();
      }
    };
    const schedule = () => {
      if (stopped || timer) return;
      const delay = Math.min(30_000, 1000 * 2 ** attempt++);
      timer = setTimeout(() => {
        timer = null;
        void connect();
      }, delay);
    };

    void connect();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (socket) {
        socket.onclose = null;
        socket.close();
      }
    };
  }, [tenantId]);

  return status;
}

let audio: AudioContext | null = null;

/** Navegadores só liberam áudio depois de um gesto do usuário: chamamos isto no primeiro clique/toque. */
export function unlockAudio() {
  try {
    if (!audio) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audio = new Ctx();
    }
    if (audio.state === 'suspended') void audio.resume();
  } catch {
    audio = null;
  }
}

export function audioReady() {
  return !!audio && audio.state === 'running';
}

/** Bipe curto gerado no navegador (sem arquivo de áudio) para avisar pedido novo. */
export function playNewOrderSound() {
  if (!audio || audio.state !== 'running') return false;
  const now = audio.currentTime;
  [0, 0.18].forEach((offset, i) => {
    const osc = audio!.createOscillator();
    const gain = audio!.createGain();
    osc.type = 'sine';
    osc.frequency.value = i === 0 ? 880 : 1175;
    gain.gain.setValueAtTime(0.0001, now + offset);
    gain.gain.exponentialRampToValueAtTime(0.25, now + offset + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.16);
    osc.connect(gain).connect(audio!.destination);
    osc.start(now + offset);
    osc.stop(now + offset + 0.18);
  });
  return true;
}
