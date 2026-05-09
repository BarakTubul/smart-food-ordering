import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { Button, Card, Input } from '@/components/UI';
import { useAuth } from '@/context/AuthContext';
import { apiClient } from '@/services/apiClient';
import * as t from '@/types';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  citations?: t.FAQCitation[];
}

interface SupportMessage {
  message_id: string;
  sender_role: 'customer' | 'admin' | 'system' | 'bot';
  body: string;
  created_at: string;
}

interface SupportConversationSnapshot {
  conversation_id: string;
  customer_user_id: number;
  status: string;
  priority: string;
  assigned_admin_user_id: number | null;
  source_session_id: string | null;
  created_at: string;
  updated_at: string;
}

const SUPPORT_PAGE_SIZE = 30;

const WELCOME_MESSAGE =
  'Welcome! You can ask any question about the site, including orders, refunds, or account issues. You can also ask for human assistance at any time.';

function MarkdownContent({ content, isUser }: { content: string; isUser: boolean }) {
  const textClass = isUser ? 'text-white' : 'text-gray-800';
  const softTextClass = isUser ? 'text-blue-100' : 'text-gray-500';
  const codeBgClass = isUser ? 'bg-blue-500/60' : 'bg-gray-100';

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => <p className={`leading-relaxed ${textClass}`}>{children}</p>,
        strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
        em: ({ children }) => <em className="italic">{children}</em>,
        ul: ({ children }) => <ul className={`list-disc pl-5 space-y-1 ${textClass}`}>{children}</ul>,
        ol: ({ children }) => <ol className={`list-decimal pl-5 space-y-1 ${textClass}`}>{children}</ol>,
        li: ({ children }) => <li>{children}</li>,
        a: ({ children, href }) => (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className={`underline underline-offset-2 ${isUser ? 'text-white' : 'text-blue-700'}`}
          >
            {children}
          </a>
        ),
        code: ({ className, children }) => {
          const rawText = String(children);
          const isBlock = Boolean(className) || rawText.includes('\n');
          return isBlock ? (
            <pre className={`mt-2 mb-1 p-2 rounded overflow-x-auto ${codeBgClass}`}>
              <code className={`text-[11px] leading-relaxed ${className || ''}`}>{children}</code>
            </pre>
          ) : (
            <code className={`px-1 py-0.5 rounded text-[11px] ${codeBgClass}`}>{children}</code>
          );
        },
        hr: () => <hr className={`my-2 border ${isUser ? 'border-blue-300' : 'border-gray-200'}`} />,
        blockquote: ({ children }) => (
          <blockquote className={`pl-3 border-l-2 ${isUser ? 'border-blue-300' : 'border-gray-300'} ${softTextClass}`}>
            {children}
          </blockquote>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function normalizeMessage(value: string): string {
  return value.trim().toLowerCase();
}

function isGreetingMessage(value: string): boolean {
  const normalized = normalizeMessage(value);
  if (!normalized) {
    return false;
  }

  const cleaned = normalized.replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
  return [
    'hi',
    'hello',
    'hey',
    'good morning',
    'good afternoon',
    'good evening',
    'shalom',
  ].includes(cleaned);
}

function inferIntentLocally(value: string): string | null {
  const normalized = normalizeMessage(value);

  if (
    /request\s+a\s+refund|ask\s+for\s+refund|get\s+a\s+refund|refund\s+request|where\s+can\s+i\s+ask\s+for\s+refund|where\s+can\s+i\s+request\s+a\s+refund/.test(
      normalized
    )
  ) {
    return 'refund_request';
  }
  if (/refund|money\s*back|reimburse/.test(normalized)) {
    return 'refund_policy';
  }
  if (
    /order\s+food|place\s+an\s+order|place\s+order|how\s+do\s+i\s+order|where\s+can\s+i\s+order|where\s+can\s+i\s+order\s+food/.test(
      normalized
    )
  ) {
    return 'order_placement';
  }
  if (/order|delivery|tracking|where\s+is\s+my\s+order/.test(normalized)) {
    return 'order_status';
  }
  if (/verify|verification|verified|account\s+verification/.test(normalized)) {
    return 'account_verification';
  }
  return null;
}

export function FloatingChatWidget() {
  const location = useLocation();
  const { sessionId } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<'assistant' | 'support'>('assistant');
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [loadingDots, setLoadingDots] = useState(1);
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: WELCOME_MESSAGE, citations: [] },
  ]);
  const [error, setError] = useState('');
  const [supportConversation, setSupportConversation] = useState<SupportConversationSnapshot | null>(null);
  const [supportMessages, setSupportMessages] = useState<SupportMessage[]>([]);
  const [supportInput, setSupportInput] = useState('');
  const [supportStatus, setSupportStatus] = useState('Human support is ready when you need it.');
  const [supportLoading, setSupportLoading] = useState(false);
  const [supportSending, setSupportSending] = useState(false);
  const [supportError, setSupportError] = useState('');
  const [supportLoadingOlder, setSupportLoadingOlder] = useState(false);
  const [supportHasMore, setSupportHasMore] = useState(true);
  const [supportChunkLoadedNotice, setSupportChunkLoadedNotice] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const supportSocketRef = useRef<WebSocket | null>(null);
  const supportMessageIds = useRef(new Set<string>());
  const supportChunkLoadedTimerRef = useRef<number | null>(null);

  const supportTitle = useMemo(() => {
    if (!supportConversation) {
      return 'Human Support';
    }
    return supportConversation.assigned_admin_user_id ? 'Human Support' : 'Human Support';
  }, [supportConversation]);

  useEffect(() => {
    if (!loading) {
      setLoadingDots(1);
      return;
    }

    const intervalId = window.setInterval(() => {
      setLoadingDots((prev) => (prev % 3) + 1);
    }, 320);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [loading]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const container = scrollContainerRef.current;
    if (!container) {
      return;
    }

    container.scrollTop = container.scrollHeight;
  }, [messages, loading, isOpen]);

  useEffect(() => {
    if (location.pathname === '/support') {
      setMode('support');
      setIsOpen(true);
      return;
    }
  }, [location.pathname]);

  useEffect(() => {
    const openHumanSupport = () => {
      setMode('support');
      setIsOpen(true);
      setError('');
      setSupportError('');
    };

    window.addEventListener('support-chat-open', openHumanSupport as EventListener);
    return () => {
      window.removeEventListener('support-chat-open', openHumanSupport as EventListener);
    };
  }, []);

  useEffect(() => {
    if (mode !== 'support' || !isOpen) {
      return;
    }

    let cancelled = false;
    supportSocketRef.current?.close();
    supportSocketRef.current = null;
    supportMessageIds.current.clear();
    setSupportLoading(true);
    setSupportError('');

    const bootstrapSupport = async () => {
      try {
        setSupportConversation(null);
        setSupportMessages([]);
        setSupportInput('');
        setSupportHasMore(true);
        setSupportLoadingOlder(false);
        setSupportStatus('Connecting you to human support...');
        setSupportError('');
        const conversation = await apiClient.createSupportConversation({
          source_session_id: sessionId,
          priority: 'normal',
        });

        if (cancelled) {
          return;
        }

        setSupportConversation(conversation);
        setSupportStatus(
          conversation.status === 'closed'
            ? 'This support conversation is closed.'
            : conversation.assigned_admin_user_id
              ? 'An admin is assigned and can respond here.'
              : 'Your request is in the support queue. An admin will join soon.'
        );

        const token = apiClient.getAccessToken();
        const wsBase = 'ws://localhost:8000/api/v1/ws/support';
        const wsUrl = token
          ? `${wsBase}/${conversation.conversation_id}?token=${encodeURIComponent(token)}`
          : `${wsBase}/${conversation.conversation_id}`;
        const socket = new WebSocket(wsUrl);
        supportSocketRef.current = socket;

        socket.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data) as {
              type: string;
              payload?: unknown;
            };

            if (data.type === 'conversation.snapshot') {
              const payload = data.payload as { conversation: SupportConversationSnapshot; messages: SupportMessage[] };
              setSupportConversation(payload.conversation);
              setSupportMessages(payload.messages || []);
              payload.messages?.forEach((message) => supportMessageIds.current.add(message.message_id));
              setSupportHasMore((payload.messages || []).length >= SUPPORT_PAGE_SIZE);
              setSupportLoading(false);
              return;
            }

            if (data.type === 'conversation.updated') {
              const payload = data.payload as SupportConversationSnapshot;
              setSupportConversation(payload);
              setSupportStatus(
                payload.status === 'closed'
                  ? 'This support conversation is closed.'
                  : payload.assigned_admin_user_id
                    ? 'An admin is assigned and can respond here.'
                    : 'Your request is in the support queue. An admin will join soon.'
              );
              return;
            }

            if (data.type === 'message.new') {
              const payload = data.payload as SupportMessage;
              if (!supportMessageIds.current.has(payload.message_id)) {
                supportMessageIds.current.add(payload.message_id);
                setSupportMessages((current) => [...current, payload]);
              }
              return;
            }

            if (data.type === 'error') {
              const payload = data.payload as { message?: string } | undefined;
              setSupportError(payload?.message || 'Support chat error');
            }
          } catch (err) {
            setSupportError(err instanceof Error ? err.message : 'Failed to read support message');
          }
        };

        socket.onerror = () => {
          setSupportError('Support websocket connection failed');
        };

        socket.onclose = () => {
          if (!cancelled) {
            setSupportLoading(false);
          }
        };
      } catch (err) {
        if (!cancelled) {
          setSupportError(err instanceof Error ? err.message : 'Failed to open human support');
          setSupportLoading(false);
        }
      }
    };

    void bootstrapSupport();

    return () => {
      if (supportChunkLoadedTimerRef.current !== null) {
        window.clearTimeout(supportChunkLoadedTimerRef.current);
      }
      cancelled = true;
      supportSocketRef.current?.close();
      supportSocketRef.current = null;
    };
  }, [mode, isOpen, sessionId]);

  useEffect(() => {
    if (mode !== 'support' || !isOpen) {
      return;
    }

    if (!scrollContainerRef.current) {
      return;
    }

    if (supportLoadingOlder) {
      return;
    }

    const container = scrollContainerRef.current;
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    if (distanceFromBottom < 120 || supportMessages.length <= SUPPORT_PAGE_SIZE) {
      container.scrollTop = container.scrollHeight;
    }
  }, [supportMessages, mode, isOpen, supportLoadingOlder]);

  if (location.pathname === '/chat') {
    return null;
  }

  const isBusy = loading || isStreaming;

  const streamAssistantMessage = async (text: string, citations: t.FAQCitation[] = []) => {
    let assistantMessageIndex = -1;
    setMessages((prev) => {
      assistantMessageIndex = prev.length;
      return [...prev, { role: 'assistant', content: '', citations: [] }];
    });

    setIsStreaming(true);
    const chunkSize = text.length > 260 ? 6 : text.length > 120 ? 4 : 2;

    for (let i = chunkSize; i < text.length; i += chunkSize) {
      const partial = text.slice(0, i);
      setMessages((prev) =>
        prev.map((msg, idx) =>
          idx === assistantMessageIndex
            ? {
                ...msg,
                content: partial,
              }
            : msg
        )
      );
      await sleep(18);
    }

    setMessages((prev) =>
      prev.map((msg, idx) =>
        idx === assistantMessageIndex
          ? {
              ...msg,
              content: text,
              citations,
            }
          : msg
      )
    );
    setIsStreaming(false);
  };

  const sendMessage = async (event: FormEvent) => {
    event.preventDefault();
    if (!input.trim()) {
      return;
    }

    const userMessage = input;
    setInput('');
    setMessages((prev) => [...prev, { role: 'user', content: userMessage }]);
    setError('');

    if (isGreetingMessage(userMessage)) {
      await streamAssistantMessage(
        'Hi! I can help with refunds, order status, and account verification. What do you need help with?'
      );
      return;
    }

    setLoading(true);

    try {
      let assistantContent = '';
      let citations: t.FAQCitation[] = [];
      const localIntent = inferIntentLocally(userMessage);

      if (localIntent) {
        const faq = await apiClient.searchFAQ(userMessage, sessionId, localIntent);
        assistantContent = faq.answer.text;
        citations = faq.citations || [];
      } else {
        const intent = await apiClient.resolveIntent(
          userMessage,
          sessionId,
          `msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
        );

        if (intent.route === 'clarify') {
          assistantContent =
            intent.clarification_question ||
            "I'm not sure I understand your question. Could you provide more details?";
        } else {
          const faq = await apiClient.searchFAQ(userMessage, sessionId, intent.intent);
          assistantContent = faq.answer.text;
          citations = faq.citations || [];
        }
      }

      await streamAssistantMessage(assistantContent, citations);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message');
      await streamAssistantMessage('Sorry, something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const sendSupportMessage = (event: FormEvent) => {
    event.preventDefault();
    const body = supportInput.trim();
    if (!body || supportLoading || supportSending) {
      return;
    }

    setSupportError('');
    setSupportInput('');
    setSupportSending(true);

    const socket = supportSocketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      setSupportError('Support chat is not connected yet. Please try again in a moment.');
      setSupportSending(false);
      setSupportInput(body);
      return;
    }

    socket.send(
      JSON.stringify({
        type: 'message.send',
        payload: {
          client_message_id: `client-${Date.now().toString(36)}`,
          body,
        },
      })
    );
    setSupportSending(false);
  };

  const loadOlderSupportMessages = async () => {
    if (!supportConversation || supportLoadingOlder || !supportHasMore) {
      return;
    }

    const oldestMessageId = supportMessages[0]?.message_id;
    if (!oldestMessageId) {
      setSupportHasMore(false);
      return;
    }

    const container = scrollContainerRef.current;
    const previousHeight = container?.scrollHeight || 0;

    setSupportLoadingOlder(true);
    setSupportError('');
    try {
      const response = await apiClient.listSupportMessages(
        supportConversation.conversation_id,
        SUPPORT_PAGE_SIZE,
        oldestMessageId
      );
      const olderMessages = response.items as SupportMessage[];

      if (olderMessages.length === 0) {
        setSupportHasMore(false);
        return;
      }

      setSupportMessages((current) => {
        const deduped = olderMessages.filter((item) => !supportMessageIds.current.has(item.message_id));
        deduped.forEach((item) => supportMessageIds.current.add(item.message_id));
        return [...deduped, ...current];
      });
      setSupportChunkLoadedNotice(true);
      if (supportChunkLoadedTimerRef.current !== null) {
        window.clearTimeout(supportChunkLoadedTimerRef.current);
      }
      supportChunkLoadedTimerRef.current = window.setTimeout(() => {
        setSupportChunkLoadedNotice(false);
      }, 1400);

      if (olderMessages.length < SUPPORT_PAGE_SIZE) {
        setSupportHasMore(false);
      }

      window.requestAnimationFrame(() => {
        const nextContainer = scrollContainerRef.current;
        if (!nextContainer) {
          return;
        }
        const nextHeight = nextContainer.scrollHeight;
        nextContainer.scrollTop = nextHeight - previousHeight;
      });
    } catch (err) {
      setSupportError(err instanceof Error ? err.message : 'Failed to load older support messages');
    } finally {
      setSupportLoadingOlder(false);
    }
  };

  const handleSupportScroll = () => {
    const container = scrollContainerRef.current;
    if (!container || supportLoadingOlder || !supportHasMore) {
      return;
    }
    if (container.scrollTop <= 24) {
      void loadOlderSupportMessages();
    }
  };

  const enterHumanSupport = () => {
    setMode('support');
    setIsOpen(true);
    setError('');
    setSupportError('');
  };

  return (
    <div className="fixed bottom-6 right-6 z-40">
      {isOpen ? (
        <Card className="w-[360px] max-w-[calc(100vw-2rem)] shadow-2xl border border-gray-200 p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-sm font-bold text-gray-900">{mode === 'support' ? supportTitle : 'Support Assistant'}</h3>
              {mode === 'support' && <p className="text-[11px] text-gray-500">Human handoff chat</p>}
            </div>
            <button
              type="button"
              className="text-gray-500 hover:text-gray-800 text-sm"
              onClick={() => setIsOpen(false)}
            >
              Close
            </button>
          </div>

          {mode === 'assistant' ? (
            <>
              <div
                ref={scrollContainerRef}
                className="h-72 overflow-y-auto border border-gray-100 rounded-md p-2 bg-gray-50 space-y-2 mb-3"
              >
                {messages.map((msg, idx) => (
                  <div
                    key={idx}
                    className={`text-xs p-2 rounded-md ${
                      msg.role === 'user'
                        ? 'bg-blue-600 text-white ml-8'
                        : idx === 0
                          ? 'bg-blue-50 text-gray-800 border border-blue-100 mr-8'
                          : 'bg-white text-gray-800 border border-gray-200 mr-8'
                    }`}
                  >
                    <MarkdownContent content={msg.content} isUser={msg.role === 'user'} />
                    {msg.citations && msg.citations.length > 0 && (
                      <p className="mt-1 opacity-75">Source: {msg.citations[0].source_id}</p>
                    )}
                    {msg.role === 'assistant' && msg.content.toLowerCase().includes('/support') && (
                      <button
                        type="button"
                        className="mt-2 inline-flex items-center rounded-md border border-blue-200 bg-white px-3 py-1 text-[11px] font-semibold text-blue-700 hover:bg-blue-50"
                        onClick={enterHumanSupport}
                      >
                        Open human support
                      </button>
                    )}
                  </div>
                ))}

                {loading && (
                  <div className="text-xs p-2 rounded-md bg-white text-gray-700 border border-gray-200 mr-8 inline-flex items-center gap-2">
                    <span>Thinking</span>
                    <span className="inline-flex items-center gap-1">
                      <span
                        className={`h-1.5 w-1.5 rounded-full bg-gray-400 transition-opacity ${
                          loadingDots >= 1 ? 'opacity-100' : 'opacity-30'
                        }`}
                      />
                      <span
                        className={`h-1.5 w-1.5 rounded-full bg-gray-400 transition-opacity ${
                          loadingDots >= 2 ? 'opacity-100' : 'opacity-30'
                        }`}
                      />
                      <span
                        className={`h-1.5 w-1.5 rounded-full bg-gray-400 transition-opacity ${
                          loadingDots >= 3 ? 'opacity-100' : 'opacity-30'
                        }`}
                      />
                    </span>
                  </div>
                )}
              </div>

              {error && <p className="text-xs text-red-600 mb-2">{error}</p>}

              <form onSubmit={sendMessage} className="flex gap-2">
                <Input
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  placeholder="Ask a question..."
                  disabled={isBusy}
                  className="text-sm"
                />
                <Button type="submit" size="sm" disabled={isBusy || !input.trim()}>
                  {isBusy ? '...' : 'Send'}
                </Button>
              </form>
            </>
          ) : (
            <>
              <div
                ref={scrollContainerRef}
                onScroll={handleSupportScroll}
                className="h-64 overflow-y-auto border border-gray-100 rounded-md p-2 bg-gray-50 space-y-2 mb-3"
              >
                {supportLoadingOlder && (
                  <div className="text-[11px] text-center text-gray-500 py-1 inline-flex w-full items-center justify-center gap-2">
                    <span>Loading older messages</span>
                    <span className="inline-flex items-center gap-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-gray-400 animate-pulse" />
                      <span className="h-1.5 w-1.5 rounded-full bg-gray-400 animate-pulse [animation-delay:120ms]" />
                      <span className="h-1.5 w-1.5 rounded-full bg-gray-400 animate-pulse [animation-delay:240ms]" />
                    </span>
                  </div>
                )}
                {supportChunkLoadedNotice && !supportLoadingOlder && (
                  <div className="text-[11px] text-center text-emerald-600 py-1">Older messages loaded</div>
                )}
                {supportMessages.length === 0 && (
                  <div className="text-xs p-2 rounded-md bg-blue-50 text-gray-800 border border-blue-100 mr-8">
                    {supportLoading ? 'Connecting you to human support...' : supportStatus}
                  </div>
                )}

                {supportMessages.map((msg) => {
                  const isCustomer = msg.sender_role === 'customer';
                  const isSystem = msg.sender_role === 'system' || msg.sender_role === 'bot';
                  return (
                    <div
                      key={msg.message_id}
                      className={`text-xs p-2 rounded-md ${
                        isCustomer
                          ? 'bg-blue-600 text-white ml-8'
                          : isSystem
                            ? 'bg-amber-50 text-gray-800 border border-amber-100 mr-8'
                            : 'bg-white text-gray-800 border border-gray-200 mr-8'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1 text-[11px] opacity-75">
                        <span>{isCustomer ? 'You' : isSystem ? 'System' : 'Admin'}</span>
                        <span>{new Date(msg.created_at).toLocaleString()}</span>
                      </div>
                      <p className="whitespace-pre-wrap leading-relaxed">{msg.body}</p>
                    </div>
                  );
                })}

                {supportLoading && supportMessages.length > 0 && (
                  <div className="text-xs p-2 rounded-md bg-white text-gray-700 border border-gray-200 mr-8 inline-flex items-center gap-2">
                    <span>Connecting</span>
                    <span className="inline-flex items-center gap-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-gray-400 opacity-100" />
                      <span className="h-1.5 w-1.5 rounded-full bg-gray-400 opacity-60" />
                      <span className="h-1.5 w-1.5 rounded-full bg-gray-400 opacity-30" />
                    </span>
                  </div>
                )}
              </div>

              <div className="mb-2 text-xs text-gray-600">{supportStatus}</div>
              {supportError && <p className="text-xs text-red-600 mb-2">{supportError}</p>}

              <form onSubmit={sendSupportMessage} className="flex gap-2">
                <Input
                  value={supportInput}
                  onChange={(event) => setSupportInput(event.target.value)}
                  placeholder="Write a message to the admin..."
                  disabled={supportLoading || supportSending}
                  className="text-sm"
                />
                <Button type="submit" size="sm" disabled={supportLoading || supportSending || !supportInput.trim()}>
                  {supportLoading || supportSending ? '...' : 'Send'}
                </Button>
              </form>
            </>
          )}
        </Card>
      ) : (
        <div className="flex items-center gap-2">
          <Button
            onClick={() => {
              setMode('assistant');
              setIsOpen(true);
            }}
            className="rounded-full shadow-lg px-5 py-3"
          >
            FAQ Chat
          </Button>
          <Button
            onClick={enterHumanSupport}
            variant="outline"
            className="rounded-full shadow-lg px-5 py-3 bg-white"
          >
            Human
          </Button>
        </div>
      )}
    </div>
  );
}
