import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

function toPlainText(md) {
  if (!md) return '';
  let out = md;
  out = out.replace(/```[\s\S]*?```/g, ' ');
  out = out.replace(/`([^`]+)`/g, '$1');
  out = out.replace(/!\[[^\]]*\]\([^)]*\)/g, '');
  out = out.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  out = out.replace(/^\s{0,3}#{1,6}\s+/gm, '');
  out = out.replace(/^\s{0,3}>\s?/gm, '');
  out = out.replace(/^\s*[-*+]\s+/gm, '');
  out = out.replace(/^\s*\d+\.\s+/gm, '');
  out = out.replace(/(\*\*|__)(.*?)\1/g, '$2');
  out = out.replace(/(\*|_)(.*?)\1/g, '$2');
  out = out.replace(/~~(.*?)~~/g, '$1');
  out = out.replace(/^\s*([-*_])\s*\1\s*\1[\s\S]*?$/gm, '');
  out = out.replace(/\|/g, ' ');
  out = out.replace(/\r/g, '');
  out = out.replace(/[ \t]+/g, ' ');
  out = out.replace(/\n{2,}/g, '\n\n');
  return out.trim();
}

const currentAudioController = {
  audio: null,
  url: null,
  stopper: null,
};

function stopCurrentAudio() {
  if (currentAudioController.audio) {
    try {
      currentAudioController.audio.pause();
    } catch {
      // ignore
    }
  }
  if (currentAudioController.url) {
    URL.revokeObjectURL(currentAudioController.url);
  }
  if (typeof currentAudioController.stopper === 'function') {
    const fn = currentAudioController.stopper;
    currentAudioController.stopper = null;
    fn();
  }
  currentAudioController.audio = null;
  currentAudioController.url = null;
}

function SpeakerIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path
        d="M4 9h4l5-4v14l-5-4H4z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M16 8.5a4 4 0 0 1 0 7M18.5 6a7 7 0 0 1 0 12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" className="read-aloud__spin">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.25" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ReadAloudButton({ text }) {
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const abortRef = useRef(null);

  useEffect(() => {
    return () => {
      if (abortRef.current) {
        try {
          abortRef.current.abort();
        } catch {
          // ignore
        }
      }
    };
  }, []);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(''), 4000);
    return () => clearTimeout(t);
  }, [error]);

  async function handleClick() {
    if (status === 'playing') {
      stopCurrentAudio();
      setStatus('idle');
      return;
    }
    if (status === 'loading') return;

    stopCurrentAudio();
    setError('');
    setStatus('loading');

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const plain = toPlainText(text);
      if (!plain) {
        setStatus('idle');
        return;
      }
      const res = await fetch('/api/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: plain }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Request failed (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);

      const cleanup = () => {
        if (currentAudioController.audio === audio) {
          currentAudioController.audio = null;
          currentAudioController.url = null;
          currentAudioController.stopper = null;
        }
        URL.revokeObjectURL(url);
        setStatus('idle');
      };

      audio.onended = cleanup;
      audio.onerror = () => {
        cleanup();
        setError('Playback failed');
      };

      currentAudioController.audio = audio;
      currentAudioController.url = url;
      currentAudioController.stopper = () => setStatus('idle');

      await audio.play();
      setStatus('playing');
    } catch (err) {
      if (err?.name === 'AbortError') {
        setStatus('idle');
        return;
      }
      setError(err?.message || 'Read-aloud failed');
      setStatus('idle');
    } finally {
      abortRef.current = null;
    }
  }

  const label =
    status === 'playing'
      ? 'Stop'
      : status === 'loading'
        ? 'Loading audio...'
        : 'Read aloud';

  return (
    <div className="read-aloud-row">
      <button
        type="button"
        className={`read-aloud read-aloud--${status}`}
        onClick={handleClick}
        aria-label={label}
        title={label}
      >
        {status === 'loading' ? (
          <SpinnerIcon />
        ) : status === 'playing' ? (
          <StopIcon />
        ) : (
          <SpeakerIcon />
        )}
        <span className="read-aloud__text">{label}</span>
      </button>
      {error && <span className="read-aloud__error">{error}</span>}
    </div>
  );
}

function MessageContent({ role, content, citations, pending, status }) {
  if (role === 'user') {
    return <div className="bubble__content">{content}</div>;
  }
  const showPendingPlaceholder = pending && !content;
  return (
    <div className="bubble__content markdown">
      {showPendingPlaceholder ? (
        <span className="pending-text">{status || 'Thinking...'}</span>
      ) : (
        <>
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              a: (props) => <a {...props} target="_blank" rel="noreferrer" />,
            }}
          >
            {content}
          </ReactMarkdown>
          {pending && <span className="caret" aria-hidden="true" />}
        </>
      )}
      {!pending && content && <ReadAloudButton text={content} />}
      {citations && citations.length > 0 && (
        <div className="citations">
          <div className="citations__label">Sources</div>
          <ol className="citations__list">
            {citations.map((c, i) => (
              <li key={i}>
                <a href={c.url} target="_blank" rel="noreferrer">
                  {c.title || c.url}
                </a>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

async function* readSseEvents(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const raw = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const dataLines = raw
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart());
      if (dataLines.length === 0) continue;
      const payload = dataLines.join('\n');
      try {
        yield JSON.parse(payload);
      } catch {
        // ignore malformed chunk
      }
    }
  }
}

export default function App() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  async function sendMessage(e) {
    e?.preventDefault();
    const text = input.trim();
    if (!text || loading) return;

    const userMessage = { role: 'user', content: text };
    const assistantDraft = { role: 'assistant', content: '', citations: [], pending: true };
    const baseMessages = [...messages, userMessage];
    setMessages([...baseMessages, assistantDraft]);
    setInput('');
    setLoading(true);
    setStatus('');
    setError('');

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: baseMessages }),
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Request failed (${res.status})`);
      }

      let text = '';
      let citations = [];
      let errored = null;

      for await (const evt of readSseEvents(res)) {
        if (evt.type === 'delta') {
          text += evt.text ?? '';
          setMessages((prev) => {
            const next = prev.slice();
            const last = next[next.length - 1];
            if (last && last.role === 'assistant' && last.pending) {
              next[next.length - 1] = { ...last, content: text };
            }
            return next;
          });
        } else if (evt.type === 'status') {
          setStatus(evt.text ?? '');
        } else if (evt.type === 'done') {
          citations = evt.citations ?? [];
        } else if (evt.type === 'error') {
          errored = evt.error || 'stream error';
        }
      }

      if (errored) throw new Error(errored);

      setMessages((prev) => {
        const next = prev.slice();
        const last = next[next.length - 1];
        if (last && last.role === 'assistant' && last.pending) {
          next[next.length - 1] = { role: 'assistant', content: text, citations };
        }
        return next;
      });
    } catch (err) {
      setError(err.message || 'Something went wrong');
      setMessages((prev) => {
        const next = prev.slice();
        const last = next[next.length - 1];
        if (last && last.role === 'assistant' && last.pending) {
          next.pop();
        }
        return next;
      });
    } finally {
      setLoading(false);
      setStatus('');
    }
  }

  const isEmpty = messages.length === 0;

  return (
    <div className={`app ${isEmpty ? 'app--empty' : ''}`}>
      {isEmpty ? (
        <div className="landing">
          <h1>Ask me anything about the Webster SEC filing document.</h1>
          <p className="landing__sub">
            <a
              href="/api/filing.pdf"
              target="_blank"
              rel="noreferrer"
              download="webster-sec-filing.pdf"
            >
              Download the filing (PDF)
            </a>
          </p>
          <form onSubmit={sendMessage} className="composer composer--landing">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type your question..."
              autoFocus
            />
            <button type="submit" disabled={!input.trim() || loading}>
              {loading ? 'Thinking...' : 'Send'}
            </button>
          </form>
          {error && <p className="error">{error}</p>}
        </div>
      ) : (
        <>
          <header className="header">
            <h2>Webster SEC Filing Chat</h2>
            <a
              className="header__link"
              href="/api/filing.pdf"
              target="_blank"
              rel="noreferrer"
              download="webster-sec-filing.pdf"
            >
              Download PDF
            </a>
          </header>
          <div className="transcript" ref={scrollRef}>
            {messages.map((m, i) => (
              <div
                key={i}
                className={`bubble bubble--${m.role}${m.pending ? ' bubble--pending' : ''}`}
              >
                <div className="bubble__role">{m.role === 'user' ? 'You' : 'Assistant'}</div>
                <MessageContent
                  role={m.role}
                  content={m.content}
                  citations={m.citations}
                  pending={m.pending}
                  status={status}
                />
              </div>
            ))}
            {error && <p className="error">{error}</p>}
          </div>
          <form onSubmit={sendMessage} className="composer">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask a follow-up..."
              autoFocus
            />
            <button type="submit" disabled={!input.trim() || loading}>
              {loading ? 'Thinking...' : 'Send'}
            </button>
          </form>
        </>
      )}
    </div>
  );
}
