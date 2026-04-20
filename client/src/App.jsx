import { useEffect, useRef, useState } from 'react';

export default function App() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
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

    const nextMessages = [...messages, { role: 'user', content: text }];
    setMessages(nextMessages);
    setInput('');
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: nextMessages }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Request failed (${res.status})`);
      }
      const data = await res.json();
      setMessages([...nextMessages, { role: 'assistant', content: data.reply }]);
    } catch (err) {
      setError(err.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  const isEmpty = messages.length === 0;

  return (
    <div className={`app ${isEmpty ? 'app--empty' : ''}`}>
      {isEmpty ? (
        <div className="landing">
          <h1>Ask me anything about the Webster SEC filing document.</h1>
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
          </header>
          <div className="transcript" ref={scrollRef}>
            {messages.map((m, i) => (
              <div key={i} className={`bubble bubble--${m.role}`}>
                <div className="bubble__role">{m.role === 'user' ? 'You' : 'Assistant'}</div>
                <div className="bubble__content">{m.content}</div>
              </div>
            ))}
            {loading && (
              <div className="bubble bubble--assistant bubble--pending">
                <div className="bubble__role">Assistant</div>
                <div className="bubble__content">Thinking...</div>
              </div>
            )}
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
