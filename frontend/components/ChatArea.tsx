"use client";

import { useState, useRef, useEffect, useImperativeHandle, forwardRef } from "react";
import MarkdownRenderer from "./MarkdownRenderer";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const WELCOME_MESSAGE = "Ahoj! I'm your personal chef assistant. Tell me about your dietary preferences, how many people you're cooking for, and how many days of meals you need!";

interface Message {
  id: string;
  role: "user" | "agent" | "system";
  content: string;
  timestamp: Date;
  toolCallIds?: string[];
}

interface ChatAreaProps {
  wsUrl?: string;
  apiSessionId?: string;
  onVoiceMessage?: (text: string) => void;
}

export interface ChatAreaRef {
  setInput: (text: string) => void;
  sendMessage: (text: string) => void;
  sendDirectMessage: (text: string) => void;
  resetConversation: () => void;
}

// Extract a short speakable summary from a response (first ~300 chars, sentence boundary)
function firstSentences(text: string, maxChars = 300): string {
  const plain = text.replace(/[#*`\[\]_~]/g, "").replace(/\n+/g, " ").trim();
  if (plain.length <= maxChars) return plain;
  const cut = plain.slice(0, maxChars);
  const dot = cut.lastIndexOf(". ");
  return dot > 40 ? cut.slice(0, dot + 1) : cut;
}

const ChatAreaInner = forwardRef<ChatAreaRef, ChatAreaProps>(({
  wsUrl = `${API_BASE.replace(/^http/, "ws")}/ws`,
  apiSessionId,
  onVoiceMessage,
}, ref) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isConnectedToBackend, setIsConnectedToBackend] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [searchResults, setSearchResults] = useState<Record<string, { loading?: boolean; results?: any[] }>>({});

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingToolCallIdsRef = useRef<string[]>([]);
  const currentAgentMsgIdRef = useRef<string | null>(null);
  const hasRestoredRef = useRef(false);

  // Refs that the WS onmessage closure reads — state updates don't propagate into closures
  const ttsEnabledRef = useRef(true);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const currentAudioUrlRef = useRef<string | null>(null);
  const accumulatedTextRef = useRef("");

  useEffect(() => { ttsEnabledRef.current = ttsEnabled; }, [ttsEnabled]);

  // Restore conversation from localStorage on mount (so navigating to /cart and back keeps chat)
  useEffect(() => {
    const sessionId = localStorage.getItem("chef-session-id");
    const raw = localStorage.getItem("chef-messages");
    if (sessionId && raw) {
      try {
        const { session, msgs } = JSON.parse(raw);
        if (session === sessionId && Array.isArray(msgs) && msgs.length > 0) {
          setMessages(msgs.map((m: any) => ({ ...m, timestamp: new Date(m.timestamp) })));
          hasRestoredRef.current = true;
        }
      } catch { /* ignore parse errors */ }
    }
  }, []);

  // Persist messages whenever they change
  useEffect(() => {
    if (messages.length <= 1) return;
    const sessionId = localStorage.getItem("chef-session-id");
    if (!sessionId) return;
    localStorage.setItem("chef-messages", JSON.stringify({ session: sessionId, msgs: messages }));
  }, [messages]);

  const stopCurrentAudio = () => {
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current.src = "";
      currentAudioRef.current = null;
    }
    if (currentAudioUrlRef.current) {
      URL.revokeObjectURL(currentAudioUrlRef.current);
      currentAudioUrlRef.current = null;
    }
  };

  const playTTS = async (text: string) => {
    stopCurrentAudio();
    const snippet = firstSentences(text);
    if (!snippet) return;
    try {
      const response = await fetch(`${API_BASE}/api/text-to-speech`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: snippet }),
      });
      if (!response.ok) return;
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      currentAudioUrlRef.current = url;
      const audio = new Audio(url);
      currentAudioRef.current = audio;
      audio.onended = () => {
        URL.revokeObjectURL(url);
        if (currentAudioUrlRef.current === url) currentAudioUrlRef.current = null;
        if (currentAudioRef.current === audio) currentAudioRef.current = null;
      };
      audio.play().catch((e) => console.warn("TTS autoplay blocked:", e));
    } catch (e) {
      console.error("TTS failed:", e);
    }
  };

  // Connect WebSocket
  useEffect(() => {
    let reconnectTimeout: NodeJS.Timeout | null = null;
    let isConnecting = false;
    let reconnectAttempts = 0;

    const connect = () => {
      if (isConnecting || wsRef.current?.readyState === WebSocket.CONNECTING) return;
      isConnecting = true;
      const storedSessionId = localStorage.getItem("chef-session-id");
      const url = storedSessionId ? `${wsUrl}?session_id=${storedSessionId}` : wsUrl;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        isConnecting = false;
        reconnectAttempts = 0;
        setIsConnectedToBackend(true);
        // Don't show welcome if we restored a previous conversation
        if (!hasRestoredRef.current) {
          setMessages([{
            id: "welcome",
            role: "agent",
            content: WELCOME_MESSAGE,
            timestamp: new Date(),
          }]);
        }
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "ping") return;

          switch (data.type) {
            case "text": {
              // Snapshot tool call IDs that arrived before this text (streaming: they arrive first)
              const toolCallIds = [...pendingToolCallIdsRef.current];
              pendingToolCallIdsRef.current = [];

              accumulatedTextRef.current += data.content;

              if (!currentAgentMsgIdRef.current) {
                // First delta of this response — create the message and set the ref
                // BEFORE calling setMessages so the ref mutation isn't inside the updater.
                // (Mutating refs inside setState updaters breaks React StrictMode's
                // double-invocation check, causing the message to never appear.)
                const newId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
                currentAgentMsgIdRef.current = newId;
                setMessages((prev) => [...prev, {
                  id: newId,
                  role: "agent" as const,
                  content: data.content,
                  timestamp: new Date(),
                  toolCallIds: toolCallIds.length > 0 ? toolCallIds : undefined,
                }]);
              } else {
                // Subsequent delta — append to the in-progress message
                const msgId = currentAgentMsgIdRef.current;
                setMessages((prev) =>
                  prev.map((m) => m.id === msgId ? { ...m, content: m.content + data.content } : m)
                );
              }
              break;
            }

            case "tool_call": {
              pendingToolCallIdsRef.current.push(data.tool_call_id);
              if (data.name === "search_recipes_tool" || data.name === "search_recipes") {
                setSearchResults((prev) => ({
                  ...prev,
                  [data.tool_call_id]: { loading: true },
                }));
              }
              break;
            }

            case "tool_result": {
              if (data.tool_call_id) {
                try {
                  const result = typeof data.content === "string"
                    ? JSON.parse(data.content)
                    : data.content;
                  if (Array.isArray(result)) {
                    setSearchResults((prev) => ({
                      ...prev,
                      [data.tool_call_id]: { results: result, loading: false },
                    }));
                  }
                } catch {
                  setSearchResults((prev) => {
                    if (prev[data.tool_call_id]?.loading) {
                      const next = { ...prev };
                      delete next[data.tool_call_id];
                      return next;
                    }
                    return prev;
                  });
                }
              }
              break;
            }

            case "done": {
              currentAgentMsgIdRef.current = null;
              setIsTyping(false);
              if (data.session_id) {
                localStorage.setItem("chef-session-id", data.session_id);
              }
              // Play TTS for the full accumulated response (first ~300 chars to keep it brief)
              const accumulated = accumulatedTextRef.current;
              accumulatedTextRef.current = "";
              if (ttsEnabledRef.current && accumulated) {
                playTTS(accumulated);
              }
              break;
            }

            case "typing": {
              setIsTyping(data.content === true);
              break;
            }

            case "error": {
              currentAgentMsgIdRef.current = null;
              pendingToolCallIdsRef.current = [];
              accumulatedTextRef.current = "";
              setMessages((prev) => [...prev, {
                id: `error-${Date.now()}`,
                role: "system" as const,
                content: `Error: ${data.content}`,
                timestamp: new Date(),
              }]);
              setIsTyping(false);
              break;
            }
          }
        } catch (e) {
          console.error("Failed to parse WebSocket message:", e);
        }
      };

      ws.onerror = () => setIsConnectedToBackend(false);

      ws.onclose = () => {
        isConnecting = false;
        setIsConnectedToBackend(false);
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
        reconnectTimeout = setTimeout(() => {
          if (reconnectAttempts < 5) reconnectAttempts++;
          connect();
        }, delay);
      };
    };

    connect();

    return () => {
      wsRef.current?.close();
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
    };
  }, [wsUrl]);

  const sendMessage = async () => {
    if (!input.trim() || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    stopCurrentAudio(); // Stop any in-progress TTS when user sends a new message

    const text = input.trim();
    setMessages((prev) => [...prev, {
      id: `user-${Date.now()}`,
      role: "user",
      content: text,
      timestamp: new Date(),
    }]);
    setInput("");
    setIsTyping(true);
    inputRef.current?.focus();
    wsRef.current.send(JSON.stringify({ type: "message", content: text }));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const resetConversation = () => {
    stopCurrentAudio();
    // Clear all in-flight state
    currentAgentMsgIdRef.current = null;
    pendingToolCallIdsRef.current = [];
    accumulatedTextRef.current = "";
    hasRestoredRef.current = false;
    // Wipe localStorage so the next WS connect gets a fresh session
    localStorage.removeItem("chef-session-id");
    localStorage.removeItem("chef-messages");
    // Reset UI
    setMessages([]);
    setSearchResults({});
    setIsTyping(false);
    setInput("");
    // Force a reconnect — the new connection has no session_id param,
    // so the backend creates a fresh session and sends a welcome message.
    wsRef.current?.close();
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const renderSearchResults = (toolCallId: string) => {
    const result = searchResults[toolCallId];
    if (!result) return null;

    if (result.loading) {
      return (
        <div className="flex items-center gap-2 text-sm text-gray-500 ml-4 my-2">
          <div className="flex gap-1">
            <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
            <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
            <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
          </div>
          <span>Searching recipes...</span>
        </div>
      );
    }

    if (result.results && result.results.length > 0) {
      return (
        <div className="ml-4 my-3 space-y-2">
          <p className="text-sm font-medium text-gray-600 mb-2">Found these recipes:</p>
          {result.results.map((recipe: any) => (
            <div key={recipe.id} className="recipe-card">
              <h4 className="font-semibold text-gray-800">{recipe.name}</h4>
              <p className="text-xs text-gray-500 mt-1">
                Ingredients: {recipe.ingredients
                  ? recipe.ingredients.split(",").slice(0, 5).map((i: string) => i.trim()).join(", ")
                  : "N/A"}
                {recipe.ingredients && recipe.ingredients.split(",").length > 5
                  ? ` (+${recipe.ingredients.split(",").length - 5} more)`
                  : ""}
              </p>
            </div>
          ))}
        </div>
      );
    }

    return null;
  };

  useImperativeHandle(ref, () => ({
    sendMessage: (text: string) => { if (text.trim()) setInput(text); },
    sendDirectMessage: (text: string) => {
      if (!text.trim() || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
      stopCurrentAudio();
      setMessages((prev) => [...prev, { id: `voice-${Date.now()}`, role: "user", content: text.trim(), timestamp: new Date() }]);
      wsRef.current.send(JSON.stringify({ type: "message", content: text.trim() }));
      setIsTyping(true);
    },
    setInput: (text: string) => setInput(text),
    resetConversation,
  }));

  return (
    <div className="flex flex-col h-full">
      {/* Chat header with reset button */}
      <div className="flex items-center justify-end px-4 py-1.5 border-b border-gray-100 bg-white">
        <button
          type="button"
          onClick={resetConversation}
          title="Start a new conversation"
          className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-gray-100 transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          New conversation
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50/50">
        {messages.map((msg) => {
          const isUser = msg.role === "user";
          const isSystem = msg.role === "system";
          return (
            <div key={msg.id} className={isUser ? "flex justify-end" : "flex justify-start"}>
              <div className={
                isUser
                  ? "chat-bubble-user"
                  : isSystem
                  ? "text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-2 max-w-xl"
                  : "chat-bubble-agent"
              }>
                <MarkdownRenderer content={msg.content} />
                {!isUser && !isSystem && msg.toolCallIds?.map((id) => (
                  <div key={id}>{renderSearchResults(id)}</div>
                ))}
              </div>
            </div>
          );
        })}

        {isTyping && (
          <div className="flex justify-start">
            <div className="chat-bubble-agent flex items-center gap-2">
              <div className="flex gap-1">
                <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
              <span className="text-sm text-gray-500">Chef is thinking...</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-4 border-t border-gray-200 bg-white">
        <form onSubmit={(e) => { e.preventDefault(); sendMessage(); }} className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Tell me what you'd like to cook..."
            disabled={!isConnectedToBackend}
            className="flex-1 px-4 py-2.5 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          />
          {/* TTS toggle — stops current playback immediately when muted */}
          <button
            type="button"
            onClick={() => {
              setTtsEnabled((v) => {
                if (v) stopCurrentAudio(); // muting: stop whatever is playing
                return !v;
              });
            }}
            title={ttsEnabled ? "Voice on — click to mute" : "Voice off — click to enable"}
            className={`px-3 py-2 rounded-xl border text-sm transition-colors ${
              ttsEnabled
                ? "bg-indigo-100 border-indigo-300 text-indigo-700"
                : "bg-gray-100 border-gray-300 text-gray-400 hover:bg-gray-200"
            }`}
          >
            {ttsEnabled ? "🔊" : "🔇"}
          </button>
          <button
            type="submit"
            disabled={!input.trim() || !isConnectedToBackend}
            className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed px-4"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
});

export default ChatAreaInner;
