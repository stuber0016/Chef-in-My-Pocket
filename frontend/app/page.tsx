"use client";

import { useRef, useState } from "react";
import ChatArea, { ChatAreaRef } from "@/components/ChatArea";
import VoiceOrb from "@/components/VoiceOrb";
import TopNavbar from "@/components/TopNavbar";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const WS_URL = `${API_BASE.replace(/^http/, "ws")}/ws`;

export default function Home() {
  const chatRef = useRef<ChatAreaRef>(null);
  const [sessionId, setSessionId] = useState<string>("");

  return (
    <div className="flex flex-col h-screen">
      <TopNavbar onSessionId={setSessionId} />

      <div className="flex-1 flex overflow-hidden">
        {/* Main chat area */}
        <div className="flex-1 flex flex-col min-w-0">
          <ChatArea
            ref={chatRef}
            wsUrl={WS_URL}
            apiSessionId={sessionId}
            onVoiceMessage={(text) => {
              console.log("Voice input:", text);
            }}
          />
        </div>

        {/* Right sidebar - Voice orb + quick actions */}
        <div className="w-48 bg-white border-l border-gray-200 flex flex-col hidden lg:flex">
          <div className="flex-1 flex flex-col">
            <div className="px-4 py-3 border-b border-gray-100">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                Voice Assistant
              </h3>
            </div>

            {/* Voice orb */}
            <div className="flex-1 flex items-center justify-center">
              <VoiceOrb onVoiceMessage={(text) => {
                chatRef.current?.sendDirectMessage(text);
              }} />
            </div>

            {/* Quick suggestions */}
            <div className="p-4 border-t border-gray-100 space-y-2">
              <p className="text-xs font-medium text-gray-500 mb-2">Quick prompts:</p>
              <button 
                onClick={() => chatRef.current?.sendMessage("Show me vegetarian recipes for today")}
                className="w-full text-left text-xs text-indigo-600 hover:text-indigo-800 py-1.5 px-2 rounded hover:bg-indigo-50 transition-colors"
              >
                🥗 Vegetarian recipes
              </button>
              <button 
                onClick={() => chatRef.current?.sendMessage("I need quick dinner recipes for 2 people")}
                className="w-full text-left text-xs text-indigo-600 hover:text-indigo-800 py-1.5 px-2 rounded hover:bg-indigo-50 transition-colors"
              >
                🥩 Quick dinners
              </button>
              <button 
                onClick={() => chatRef.current?.sendMessage("Show me dessert recipes")}
                className="w-full text-left text-xs text-indigo-600 hover:text-indigo-800 py-1.5 px-2 rounded hover:bg-indigo-50 transition-colors"
              >
                🎂 Desserts
              </button>
              <button 
                onClick={() => chatRef.current?.sendMessage("Show me traditional Czech recipes")}
                className="w-full text-left text-xs text-indigo-600 hover:text-indigo-800 py-1.5 px-2 rounded hover:bg-indigo-50 transition-colors"
              >
                🇨🇿 Czech classics
              </button>
            </div>
          </div>

          {/* Footer */}
          <div className="p-3 border-t border-gray-200 text-center">
            <p className="text-[10px] text-gray-400">
              Powered by Gemini &middot; Rohlík recipes
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
