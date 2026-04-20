import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

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
