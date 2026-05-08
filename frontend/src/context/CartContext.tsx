import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import * as t from '@/types';
import { apiClient } from '@/services/apiClient';

interface CartContextType {
  cart: t.CartResponse | null;
  loading: boolean;
  error: string;
  fetchCart: (signal?: AbortSignal) => Promise<void>;
  addItem: (itemId: string, quantity: number) => Promise<void>;
  updateItem: (itemId: string, quantity: number) => Promise<void>;
  removeItem: (itemId: string) => Promise<void>;
  clearError: () => void;
}

const CartContext = createContext<CartContextType | undefined>(undefined);

export function CartProvider({ children }: { children: ReactNode }) {
  const [cart, setCart] = useState<t.CartResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const fetchCart = useCallback(async (signal?: AbortSignal) => {
    try {
      setError('');
      setLoading(true);
      const data = await apiClient.getCart(signal);
      setCart(data);
    } catch (err) {
      // Silently ignore abort errors
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
      setError(err instanceof Error ? err.message : 'Failed to load cart');
    } finally {
      setLoading(false);
    }
  }, []);

  const addItem = useCallback(async (itemId: string, quantity: number) => {
    try {
      setError('');
      const updated = await apiClient.addCartItem(itemId, quantity);
      setCart(updated);
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') {
        setError(err instanceof Error ? err.message : 'Failed to add item');
      }
    }
  }, []);

  const updateItem = useCallback(async (itemId: string, quantity: number) => {
    try {
      setError('');
      const updated = await apiClient.updateCartItem(itemId, quantity);
      setCart(updated);
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') {
        setError(err instanceof Error ? err.message : 'Failed to update cart');
      }
    }
  }, []);

  const removeItem = useCallback(async (itemId: string) => {
    try {
      setError('');
      const updated = await apiClient.removeCartItem(itemId);
      setCart(updated);
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') {
        setError(err instanceof Error ? err.message : 'Failed to remove item');
      }
    }
  }, []);

  const clearError = useCallback(() => {
    setError('');
  }, []);

  return (
    <CartContext.Provider
      value={{
        cart,
        loading,
        error,
        fetchCart,
        addItem,
        updateItem,
        removeItem,
        clearError,
      }}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCart(): CartContextType {
  const context = useContext(CartContext);
  if (context === undefined) {
    throw new Error('useCart must be used within a CartProvider');
  }
  return context;
}
