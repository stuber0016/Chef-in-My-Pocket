"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface RecipeItem {
  recipe_id: number;
  recipe_name: string;
  ingredients: string[];
}

interface CartState {
  recipes: RecipeItem[];
  total_unique_items: number;
  all_items: string[];
  session_id?: string;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const getSessionId = () =>
  typeof window !== "undefined" ? localStorage.getItem("chef-session-id") || "" : "";

export default function CartPage() {
  const router = useRouter();
  const [cart, setCart] = useState<CartState>({
    recipes: [],
    total_unique_items: 0,
    all_items: [],
    session_id: "",
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState("");
  const [expandedRecipes, setExpandedRecipes] = useState<Set<number>>(new Set());

  const loadCart = async () => {
    setIsLoading(true);
    try {
      const sessionId = getSessionId();
      const url = sessionId ? `${API_BASE}/api/cart?session_id=${sessionId}` : `${API_BASE}/api/cart`;
      const response = await fetch(url);
      const data = await response.json();
      setCart((prev) => ({
        ...data,
        session_id: data.session_id || prev.session_id,
      }));
    } catch (error) {
      console.error("Failed to load cart:", error);
      // Try loading from localStorage as fallback
      try {
        const saved = localStorage.getItem("chef-cart");
        if (saved) {
          const parsed = JSON.parse(saved);
          setCart({ ...parsed, session_id: "" });
        }
      } catch (e) {
        console.error("Failed to load cart from localStorage:", e);
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadCart();
  }, []);

  const toggleRecipe = (recipeId: number) => {
    setExpandedRecipes((prev) => {
      const next = new Set(prev);
      if (next.has(recipeId)) {
        next.delete(recipeId);
      } else {
        next.add(recipeId);
      }
      return next;
    });
  };

  const removeRecipe = async (recipeId: number) => {
    try {
      const sessionId = getSessionId();
      const params = new URLSearchParams({ recipe_id: String(recipeId) });
      if (sessionId) params.set("session_id", sessionId);
      await fetch(`${API_BASE}/api/cart?${params}`, {
        method: "DELETE",
      });
      loadCart();
    } catch (error) {
      console.error("Failed to remove item:", error);
    }
  };

  const clearCart = async () => {
    try {
      const sessionId = getSessionId();
      const url = sessionId
        ? `${API_BASE}/api/cart/clear?session_id=${sessionId}`
        : `${API_BASE}/api/cart/clear`;
      await fetch(url, {
        method: "DELETE",
      });
      loadCart();
    } catch (error) {
      console.error("Failed to clear cart:", error);
    }
  };

  const exportToRohlik = async () => {
    setIsExporting(true);
    setExportMessage("");
    try {
      const sessionId = getSessionId();
      const params = sessionId ? `?session_id=${sessionId}` : "";
      const response = await fetch(`${API_BASE}/api/cart/export${params}`, {
        method: "POST",
      });
      const data = await response.json();
      setExportMessage(
        data.message || `Exported ${data.exported_items || 0} items`
      );
    } catch (error) {
      console.error("Failed to export:", error);
      setExportMessage("Export failed. Check backend logs.");
    } finally {
      setIsExporting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="text-center">
          <div className="inline-flex gap-1 mb-4">
            <div className="w-3 h-3 bg-amber-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
            <div className="w-3 h-3 bg-amber-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
            <div className="w-3 h-3 bg-amber-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
          </div>
          <p className="text-gray-500 text-sm">Loading your shopping list...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top bar */}
      <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
        <Link
          href="/"
          className="flex items-center gap-2 text-gray-700 hover:text-gray-900 transition-colors"
        >
          <button className="text-sm font-medium">
            ← Back to Chat
          </button>
        </Link>
        <div className="flex items-center gap-3">
          {cart.session_id && (
            <span className="text-xs text-gray-400 hidden sm:inline">
              Session: {cart.session_id.slice(0, 8)}...
            </span>
          )}
        </div>
      </div>

      {/* Cart content */}
      <div className="max-w-3xl mx-auto px-4 py-8">
        {cart.recipes.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-5xl mb-4">🛒</p>
            <h2 className="text-xl font-semibold text-gray-800 mb-2">
              Your shopping list is empty
            </h2>
            <p className="text-gray-500 text-sm mb-6">
              Ask the chef to add some recipes, or search for something specific.
            </p>
            <Link
              href="/"
              className="inline-flex items-center px-5 py-2.5 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors text-sm font-medium"
            >
              Go to Chef Chat
            </Link>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
              <div>
                <h1 className="text-xl font-semibold text-gray-800">Shopping List</h1>
                <p className="text-sm text-gray-500 mt-0.5">
                  {cart.total_unique_items} unique items from {cart.recipes.length} recipe{cart.recipes.length !== 1 ? "s" : ""}
                </p>
              </div>
              <button
                onClick={clearCart}
                className="text-xs text-red-500 hover:text-red-700 font-medium px-3 py-1.5 rounded-lg border border-red-200 hover:bg-red-50 transition-colors"
              >
                Clear All
              </button>
            </div>

            {/* Recipe groups */}
            <div className="space-y-3">
              {cart.recipes.map((recipe) => {
                const isExpanded = expandedRecipes.has(recipe.recipe_id);
                return (
                  <div
                    key={recipe.recipe_id}
                    className="bg-white rounded-xl border border-gray-200 overflow-hidden"
                  >
                    <div className="flex items-center justify-between p-4">
                      <button
                        onClick={() => toggleRecipe(recipe.recipe_id)}
                        className="flex items-center gap-3 flex-1 text-left"
                      >
                        <span className="text-lg">📋</span>
                        <div className="flex-1 min-w-0">
                          <h3 className="font-medium text-gray-800 text-sm truncate">
                            {recipe.recipe_name}
                          </h3>
                          <p className="text-xs text-gray-400 mt-0.5">
                            {recipe.ingredients.length} ingredients
                          </p>
                        </div>
                      </button>
                      <div className="flex items-center gap-2 ml-3">
                        <span className="text-xs text-gray-400">
                          {isExpanded ? "▾" : "▸"}
                        </span>
                        <button
                          onClick={() => removeRecipe(recipe.recipe_id)}
                          className="text-gray-300 hover:text-red-500 transition-colors p-1"
                          title="Remove recipe"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M9 7h6" />
                          </svg>
                        </button>
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="px-4 pb-4 border-t border-gray-100">
                        <div className="pt-3 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                          {recipe.ingredients.map((ing, idx) => (
                            <div key={idx} className="flex items-center gap-2">
                              <span className="w-1.5 h-1.5 bg-amber-400 rounded-full flex-shrink-0" />
                              <span className="text-xs text-gray-600 truncate">
                                {ing}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* All items summary */}
            <div className="mt-6 p-4 bg-white rounded-xl border border-gray-200">
              <h4 className="text-xs font-medium text-gray-500 mb-3">
                All ingredients:
              </h4>
              <div className="flex flex-wrap gap-1.5">
                {cart.all_items.slice(0, 30).map((item, idx) => (
                  <span
                    key={idx}
                    className="inline-flex items-center px-2 py-1 rounded-full text-xs bg-amber-50 text-amber-700 border border-amber-100"
                  >
                    {item}
                  </span>
                ))}
                {cart.all_items.length > 30 && (
                  <span className="text-xs text-gray-400 self-center px-2">
                    +{cart.all_items.length - 30} more
                  </span>
                )}
              </div>
            </div>

            {/* Export button */}
            <div className="mt-6 space-y-3">
              <button
                onClick={exportToRohlik}
                disabled={isExporting}
                className="w-full bg-emerald-500 text-white py-3 rounded-xl hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-semibold flex items-center justify-center gap-2"
              >
                {isExporting ? (
                  <>
                    <div className="inline-flex gap-0.5">
                      <div className="w-2 h-2 bg-white rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                      <div className="w-2 h-2 bg-white rounded-full animate-bounce" style={{ animationDelay: "100ms" }} />
                      <div className="w-2 h-2 bg-white rounded-full animate-bounce" style={{ animationDelay: "200ms" }} />
                    </div>
                    Exporting...
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    Export to Rohlík
                  </>
                )}
              </button>

              {exportMessage && (
                <div className="text-center text-sm text-emerald-600 bg-emerald-50 py-2 rounded-lg">
                  {exportMessage}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
