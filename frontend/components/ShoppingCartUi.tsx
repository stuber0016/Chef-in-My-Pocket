"use client";

import { useState } from "react";

interface RecipeItem {
  recipe_id: number;
  recipe_name: string;
  ingredients: string[];
}

interface CartState {
  recipes: RecipeItem[];
  total_unique_items: number;
  all_items: string[];
}

interface ShoppingCartUiProps {
  cart: CartState;
  onClose?: () => void;
}

export default function ShoppingCartUi({ cart, onClose }: ShoppingCartUiProps) {
  const [expandedRecipes, setExpandedRecipes] = useState<Set<number>>(new Set());

  if (cart.recipes.length === 0) {
    return (
      <div className="bg-white rounded-2xl shadow-xl border border-gray-200 p-6 w-80 max-h-96 overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-800">Shopping List</h3>
          {onClose && (
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg">
              ×
            </button>
          )}
        </div>
        <div className="text-center py-8">
          <p className="text-4xl mb-3">🛒</p>
          <p className="text-sm text-gray-500">Your cart is empty</p>
          <p className="text-xs text-gray-400 mt-1">Ask the chef to add some recipes!</p>
        </div>
      </div>
    );
  }

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

  return (
    <div className="bg-white rounded-2xl shadow-xl border border-gray-200 p-5 w-80 max-h-[32rem] overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="text-lg">🧾</span>
          <h3 className="font-semibold text-gray-800 text-sm">Shopping List</h3>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full font-medium">
            {cart.recipes.length} recipe{cart.recipes.length !== 1 ? "s" : ""}
          </span>
          {onClose && (
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg ml-1">
              ×
            </button>
          )}
        </div>
      </div>

      {/* Total */}
      <div className="mb-4 p-3 bg-emerald-50 rounded-lg border border-emerald-100">
        <p className="text-xs text-emerald-600 font-medium">
          {cart.total_unique_items} unique items
        </p>
      </div>

      {/* Recipes */}
      <div className="space-y-2">
        {cart.recipes.map((recipe) => {
          const isExpanded = expandedRecipes.has(recipe.recipe_id);
          return (
            <div
              key={recipe.recipe_id}
              className="border border-gray-100 rounded-lg overflow-hidden"
            >
              {/* Recipe header */}
              <button
                onClick={() => toggleRecipe(recipe.recipe_id)}
                className="w-full flex items-center justify-between p-3 text-left hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-sm">📋</span>
                  <span className="text-sm font-medium text-gray-700 truncate">
                    {recipe.recipe_name}
                  </span>
                </div>
                <span className="text-xs text-gray-400 ml-2 flex-shrink-0">
                  {isExpanded ? "▾" : "▸"}
                </span>
              </button>

              {/* Ingredients list */}
              {isExpanded && (
                <div className="px-3 pb-3 border-t border-gray-50">
                  <div className="mt-2">
                    {recipe.ingredients.map((ing, idx) => (
                      <div key={idx} className="flex items-center gap-2 py-1">
                        <span className="w-1 h-1 bg-gray-300 rounded-full flex-shrink-0" />
                        <span className="text-xs text-gray-600 truncate">{ing}</span>
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
      <div className="mt-4 pt-3 border-t border-gray-100">
        <p className="text-xs font-medium text-gray-500 mb-2">All items:</p>
        <div className="flex flex-wrap gap-1">
          {cart.all_items.slice(0, 20).map((item, idx) => (
            <span
              key={idx}
              className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-gray-100 text-gray-600"
            >
              {item}
            </span>
          ))}
          {cart.all_items.length > 20 && (
            <span className="text-[10px] text-gray-400 self-center">
              +{cart.all_items.length - 20} more
            </span>
          )}
        </div>
      </div>

      {/* Footer */}
      <button
        className="w-full mt-4 btn-success py-2.5 text-sm font-semibold"
        onClick={() => {
          alert(
            `Cart exported! ${cart.total_unique_items} unique items from ${cart.recipes.length} recipes.`
          );
        }}
      >
        Export Shopping List
      </button>
    </div>
  );
}
