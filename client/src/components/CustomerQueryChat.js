import React, { useEffect, useMemo, useRef, useState } from 'react';
import './CustomerQueryChat.css';

const DEFAULT_API_URL = process.env.NODE_ENV === 'production'
  ? 'https://ai-fit-room.onrender.com'
  : (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5001');

const API_URL = process.env.REACT_APP_API_URL || DEFAULT_API_URL;

const STARTER_QUESTIONS = [
  'What are the EU sustainability disclosure rules for fashion products?',
  'How should we handle customer data under GDPR in our style app?',
  'What labeling requirements should we show for textile materials?'
];

function formatHealthLabel(health) {
  if (health === 'ok') return 'Online';
  if (health === 'degraded') return 'Limited';
  if (health === 'offline') return 'Offline';
  return 'Checking';
}

function formatSources(context = []) {
  return context
    .filter((doc) => doc && (doc.source || doc.url))
    .slice(0, 3)
    .map((doc) => ({
      source: doc.source || 'Unknown source',
      url: doc.url || ''
    }));
}

const CustomerQueryChat = () => {
  const [messages, setMessages] = useState([
    {
      id: 'welcome',
      role: 'assistant',
      text: 'Ask policy or compliance questions. I will use the RAG knowledge base and cite sources.'
    }
  ]);
  const [query, setQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [health, setHealth] = useState('unknown');
  const [error, setError] = useState('');
  const [showStarterQuestions, setShowStarterQuestions] = useState(true);
  const messagesContainerRef = useRef(null);

  const canSend = useMemo(() => !isLoading && query.trim().length > 0, [isLoading, query]);

  useEffect(() => {
    const checkHealth = async () => {
      try {
        const response = await fetch(`${API_URL}/api/chat/health`);
        if (!response.ok) {
          setHealth('degraded');
          return;
        }
        const data = await response.json();
        setHealth(data.status || 'ok');
      } catch (_err) {
        setHealth('offline');
      }
    };

    checkHealth();
  }, []);

  useEffect(() => {
    if (!messagesContainerRef.current) {
      return;
    }
    messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
  }, [messages, isLoading]);

  const askQuestion = async (inputText) => {
    const text = inputText.trim();
    if (!text || isLoading) {
      return;
    }

    setShowStarterQuestions(false);
    setError('');
    setIsLoading(true);

    setMessages((prev) => [
      ...prev,
      { id: `u-${Date.now()}`, role: 'user', text }
    ]);

    try {
      const response = await fetch(`${API_URL}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ query: text, limit: 5 })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || data.detail || 'Chat request failed');
      }

      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          text: data.answer || 'No answer returned.',
          sources: formatSources(data.context)
        }
      ]);
    } catch (err) {
      setError(err.message || 'Failed to query chatbot');
      setMessages((prev) => [
        ...prev,
        {
          id: `aerr-${Date.now()}`,
          role: 'assistant',
          text: 'RAG chatbot is not available right now. Please try again after syncing regulations or checking services.'
        }
      ]);
    } finally {
      setIsLoading(false);
      setQuery('');
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    await askQuestion(query);
  };

  const handleSync = async () => {
    if (isSyncing) {
      return;
    }

    setIsSyncing(true);
    setError('');

    try {
      const response = await fetch(`${API_URL}/api/chat/ingest-crawled`, {
        method: 'POST'
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || data.detail || 'Failed to sync regulation data');
      }

      setMessages((prev) => [
        ...prev,
        {
          id: `sync-${Date.now()}`,
          role: 'assistant',
          text: `Regulation sync complete. Ingested ${data.ingested || 0} chunks from ${data.documents || 0} documents.`
        }
      ]);
      setHealth('ok');
    } catch (err) {
      setError(err.message || 'Sync failed');
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <section className="customer-chat-panel" aria-label="Customer query assistant">
      <div className="chat-header">
        <div>
          <p className="chat-eyebrow">AI Concierge</p>
          <h2>Personal Stylist</h2>
          <p>RAG-powered product and compliance guidance.</p>
        </div>
        <span className={`chat-health ${health}`}>{formatHealthLabel(health)}</span>
      </div>

      <div className="chat-actions">
        <button
          type="button"
          onClick={handleSync}
          className="sync-btn"
          disabled={isSyncing}
        >
          {isSyncing ? 'Syncing...' : 'Sync Knowledge'}
        </button>
      </div>

      {showStarterQuestions ? (
        <div className="starter-questions">
          {STARTER_QUESTIONS.map((question) => (
            <button
              key={question}
              type="button"
              className="starter-btn"
              onClick={() => askQuestion(question)}
              disabled={isLoading}
            >
              {question}
            </button>
          ))}
        </div>
      ) : (
        <button
          type="button"
          className="starter-toggle"
          onClick={() => setShowStarterQuestions(true)}
          disabled={isLoading}
        >
          Show Quick Questions
        </button>
      )}

      <div className="chat-messages" ref={messagesContainerRef}>
        {messages.map((message) => (
          <article key={message.id} className={`chat-message ${message.role}`}>
            <p className="chat-bubble">{message.text}</p>
            {message.sources && message.sources.length > 0 && (
              <div className="chat-sources">
                {message.sources.map((source) => (
                  <a
                    key={`${message.id}-${source.source}-${source.url}`}
                    href={source.url || '#'}
                    target={source.url ? '_blank' : undefined}
                    rel={source.url ? 'noreferrer' : undefined}
                    onClick={(event) => {
                      if (!source.url) {
                        event.preventDefault();
                      }
                    }}
                  >
                    {source.source}
                  </a>
                ))}
              </div>
            )}
          </article>
        ))}
        {isLoading && <div className="chat-loading">Thinking...</div>}
      </div>

      <form className="chat-form" onSubmit={handleSubmit}>
        <textarea
          placeholder="Ask a customer/compliance question..."
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          rows={3}
        />
        <button type="submit" disabled={!canSend}>
          Send
        </button>
      </form>

      {error && <p className="chat-error">{error}</p>}
    </section>
  );
};

export default CustomerQueryChat;
