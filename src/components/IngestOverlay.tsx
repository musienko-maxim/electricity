'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';

interface IngestOverlayProps {
  onReady: (completedAt: string) => void;
}

interface InitPayload {
  status: string;
  current: number;
  total: number;
  lastLabel: string;
  completedAt: string | null;
}

interface PdfDonePayload {
  current: number;
  total: number;
  label: string;
  items: number;
}

interface DonePayload {
  totalItems: number;
  completedAt: string;
}

type OverlayStatus = 'connecting' | 'running' | 'done' | 'error';

export function IngestOverlay({ onReady }: IngestOverlayProps) {
  const [status, setStatus] = useState<OverlayStatus>('connecting');
  const [current, setCurrent] = useState(0);
  const [total, setTotal] = useState(0);
  const [lastLabel, setLastLabel] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [retrying, setRetrying] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  function connect() {
    esRef.current?.close();
    const es = new EventSource('/api/ingest/stream');
    esRef.current = es;

    es.addEventListener('init', (e: MessageEvent) => {
      const data: InitPayload = JSON.parse(e.data);
      setCurrent(data.current);
      setTotal(data.total);
      setLastLabel(data.lastLabel);
      if (data.status === 'done') {
        es.close();
        onReady(data.completedAt!);
        return;
      }
      if (data.status === 'error') {
        setStatus('error');
        es.close();
        return;
      }
      setStatus('running');
    });

    es.addEventListener('pdf-done', (e: MessageEvent) => {
      const data: PdfDonePayload = JSON.parse(e.data);
      setCurrent(data.current);
      setTotal(data.total);
      setLastLabel(data.label);
    });

    es.addEventListener('done', (e: MessageEvent) => {
      const data: DonePayload = JSON.parse(e.data);
      setStatus('done');
      es.close();
      setTimeout(() => onReady(data.completedAt), 800);
    });

    es.addEventListener('ingest-error', (e: MessageEvent) => {
      const data: { message: string } = JSON.parse(e.data);
      setStatus('error');
      setErrorMsg(data.message);
      es.close();
    });

    es.onerror = () => {
      // Native transport error (server down, dropped connection, 5xx). Without
      // this, EventSource auto-reconnects every ~3s forever and the overlay
      // stays stuck on the spinner. Stop retrying and show an error — unless we
      // already reached a terminal state.
      es.close();
      setStatus((prev) => (prev === 'done' ? prev : 'error'));
      setErrorMsg((prev) => prev || 'Втрачено з’єднання із сервером. Спробуйте ще раз.');
    };
  }

  useEffect(() => {
    connect();
    return () => esRef.current?.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleRetry() {
    setRetrying(true);
    try {
      const res = await fetch('/api/ingest/refresh', { method: 'POST' });
      if (res.ok || res.status === 409) {
        setStatus('running');
        setErrorMsg('');
        connect();
      }
    } finally {
      setRetrying(false);
    }
  }

  const pct = total > 0 ? Math.round((current / total) * 100) : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/95 backdrop-blur-sm">
      <div className="w-full max-w-sm mx-4 p-8 bg-white rounded-2xl shadow-xl border border-slate-100 text-center">
        {status === 'done' ? (
          <p className="text-green-700 font-medium">✓ Дані завантажено</p>
        ) : status === 'error' ? (
          <>
            <p className="text-rose-700 text-sm mb-4">
              {errorMsg || 'Помилка завантаження даних'}
            </p>
            <button
              onClick={handleRetry}
              disabled={retrying}
              className="px-4 py-2 bg-sky-600 text-white text-sm rounded-lg hover:bg-sky-700 disabled:opacity-50"
            >
              {retrying ? 'Зачекайте…' : 'Спробувати ще раз'}
            </button>
          </>
        ) : (
          <>
            <Loader2 className="w-8 h-8 text-sky-500 animate-spin mx-auto mb-4" />
            <h2 className="text-base font-medium text-slate-800 mb-1">
              Підготовка бази даних…
            </h2>
            {total > 0 && (
              <>
                <div className="w-full bg-slate-100 rounded-full h-2 my-4 overflow-hidden">
                  <div
                    className="bg-sky-500 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <p className="text-sm text-slate-600">
                  {current} / {total} PDF
                </p>
                {lastLabel && (
                  <p className="text-xs text-slate-400 mt-1 truncate">{lastLabel}</p>
                )}
              </>
            )}
            <p className="text-xs text-slate-400 mt-4">
              Після завершення пошук стане доступним автоматично.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
