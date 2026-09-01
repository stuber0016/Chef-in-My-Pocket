"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface TopNavbarProps {
  onSessionId?: (sessionId: string) => void;
}

export default function TopNavbar({ onSessionId }: TopNavbarProps) {
  const [cartCount, setCartCount] = useState(0);
  const [backendStatus, setBackendStatus] = useState<"online" | "offline">("offline");

  const loadCartCount = async () => {
    try {
      const sessionId = localStorage.getItem("chef-session-id");
      const url = sessionId ? `${API_BASE}/api/cart?session_id=${sessionId}` : `${API_BASE}/api/cart`;
      const response = await fetch(url);
      const data = await response.json();
      setCartCount(data.total_unique_items || 0);
      if (onSessionId && data.session_id) {
        onSessionId(data.session_id);
      }
    } catch {
      // Try localStorage fallback
      try {
        const saved = localStorage.getItem("chef-cart");
        if (saved) {
          const parsed = JSON.parse(saved);
          setCartCount(parsed.total_unique_items || 0);
        }
      } catch {
        // ignore
      }
    }
  };

  useEffect(() => {
    loadCartCount();
    const interval = setInterval(loadCartCount, 10000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const checkBackend = () => {
      fetch(`${API_BASE}/health`)
        .then(() => setBackendStatus("online"))
        .catch(() => setBackendStatus("offline"));
    };
    checkBackend();
    const interval = setInterval(checkBackend, 15000);
    return () => clearInterval(interval);
  }, []);

  return (
    <nav className="bg-white border-b border-gray-200 px-4 py-2.5 flex items-center justify-between sticky top-0 z-50">
      <Link
        href="/"
        className="flex items-center gap-2.5 hover:opacity-80 transition-opacity"
      >
        <div className="w-8 h-8 bg-gradient-to-br from-amber-400 to-orange-500 rounded-lg flex items-center justify-center text-white font-bold text-sm shadow-sm">
          🍳
        </div>
        <div>
          <h1 className="font-semibold text-gray-800 text-sm leading-tight">
            Chef in My Pocket
          </h1>
          <div className="flex items-center gap-1.5">
            <div
              className={`w-1.5 h-1.5 rounded-full ${
                backendStatus === "online" ? "bg-emerald-400" : "bg-red-400"
              }`}
            />
            <span className="text-[10px] text-gray-400">
              {backendStatus === "online" ? "Online" : "Offline"}
            </span>
          </div>
        </div>
      </Link>

      <Link
        href="/cart"
        className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 text-amber-700 rounded-lg text-sm font-medium hover:bg-amber-100 transition-colors border border-amber-100"
      >
        <span>🛒</span>
        <span className="hidden sm:inline">Shopping List</span>
        {cartCount > 0 && (
          <span className="bg-amber-500 text-white text-[10px] font-semibold rounded-full w-5 h-5 flex items-center justify-center">
            {cartCount}
          </span>
        )}
      </Link>
    </nav>
  );
}
