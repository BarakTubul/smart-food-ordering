import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/UI';
import { apiClient } from '@/services/apiClient';
import * as t from '@/types';

export function Header() {
  const { user, logout, isGuest } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [notifications, setNotifications] = useState<t.LiveNotification[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const seenNotificationIds = useRef(new Set<string>());
  const accountMenuRef = useRef<HTMLDivElement | null>(null);

  const navItems = user?.is_admin
    ? [
        { label: 'Manager Reviews', path: '/manager/refunds' },
        { label: 'Support Inbox', path: '/manager/support' },
      ]
    : [
        { label: 'My Orders', path: '/orders' },
        { label: 'Refund History', path: '/refunds' },
        { label: 'Order', path: '/order' },
      ];

  useEffect(() => {
    if (!user || isGuest) {
      setNotifications([]);
      setShowNotifications(false);
      setShowAccountMenu(false);
      seenNotificationIds.current.clear();
      return;
    }

    const token = apiClient.getAccessToken();
    const wsUrl = token
      ? `ws://localhost:8000/api/v1/ws/notifications?token=${encodeURIComponent(token)}`
      : 'ws://localhost:8000/api/v1/ws/notifications';
    const socket = new WebSocket(wsUrl);

    socket.onmessage = (event) => {
      try {
        const incoming = JSON.parse(event.data) as t.LiveNotification[];
        if (incoming.length === 0) {
          return;
        }

        const newNotifications = incoming.filter(
          (notification) => !seenNotificationIds.current.has(notification.notification_id)
        );

        if (newNotifications.length === 0) {
          return;
        }

        newNotifications.forEach((notification) => {
          seenNotificationIds.current.add(notification.notification_id);
        });

        setNotifications((current) => [...newNotifications, ...current].slice(0, 6));

        const orderNotifications = newNotifications.filter((notification) => {
          if (notification.kind === 'order') {
            return true;
          }
          if (notification.order_id) {
            return true;
          }
          return (notification.target_path || '').includes('/orders/');
        });

        if (orderNotifications.length > 0) {
          const orderIds = Array.from(
            new Set(
              orderNotifications
                .map((notification) => notification.order_id)
                .filter((orderId): orderId is string => Boolean(orderId))
            )
          );

          apiClient.invalidateOrderSnapshots(orderIds);

          window.dispatchEvent(
            new CustomEvent<t.LiveNotification[]>('order-notifications-received', {
              detail: orderNotifications,
            })
          );
        }

        const alertText = newNotifications
          .map((notification) => `${notification.title}: ${notification.message}`)
          .join('\n');
        window.alert(alertText);
      } catch (error) {
        console.error('[notifications] failed to parse live update', error);
      }
    };

    socket.onerror = (error) => {
      console.error('[notifications] websocket error', error);
    };

    return () => {
      socket.close();
    };
  }, [user, isGuest]);

  useEffect(() => {
    const handleDocumentClick = (event: MouseEvent) => {
      if (accountMenuRef.current && !accountMenuRef.current.contains(event.target as Node)) {
        setShowAccountMenu(false);
      }
    };

    document.addEventListener('mousedown', handleDocumentClick);
    return () => document.removeEventListener('mousedown', handleDocumentClick);
  }, []);

  return (
    <header className="sticky top-0 z-20 border-b border-cyan-100 bg-white/80 shadow-sm backdrop-blur">
      <div className="max-w-7xl mx-auto px-4 py-3 flex justify-between items-center">
        <div className="flex items-center gap-6">
          <h1
            className="text-2xl font-black tracking-tight cursor-pointer bg-gradient-to-r from-cyan-600 via-blue-600 to-indigo-600 bg-clip-text text-transparent"
            onClick={() => navigate('/order')}
          >
            Foodie
          </h1>
          {user && (
            <nav className="hidden md:flex gap-2 rounded-full border border-cyan-100 bg-cyan-50/50 p-1">
              {navItems.map((item) => {
                const isActive = location.pathname === item.path;
                return (
                  <button
                    key={item.path}
                    onClick={() => navigate(item.path)}
                    className={`px-3 py-1.5 rounded-full text-sm font-semibold transition ${
                      isActive
                        ? 'bg-white text-cyan-800 shadow-sm border border-cyan-200'
                        : 'text-gray-600 hover:text-cyan-900 hover:bg-white/70'
                    }`}
                  >
                    {item.label}
                  </button>
                );
              })}
            </nav>
          )}
        </div>
        <div className="flex items-center gap-4">
          {user && (
            <>
              <div className="relative">
                <Button
                  onClick={() => setShowNotifications((current) => !current)}
                  variant="outline"
                  size="sm"
                  className="gap-2"
                >
                  <img
                    src="/images/icons/notification-bell.svg"
                    alt="Notifications"
                    className="h-4 w-4"
                  />
                  <span>Notifications</span>
                  {notifications.length > 0 && (
                    <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 py-0.5 text-xs font-bold text-white">
                      {notifications.length}
                    </span>
                  )}
                </Button>
                {showNotifications && (
                  <div className="absolute right-0 mt-2 w-80 rounded-xl border border-gray-200 bg-white shadow-lg p-3">
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-sm font-semibold text-gray-900">Live updates</p>
                      <button
                        type="button"
                        className="text-xs text-gray-500 hover:text-gray-900"
                        onClick={() => setNotifications([])}
                      >
                        Clear all
                      </button>
                    </div>
                    {notifications.length === 0 ? (
                      <p className="text-sm text-gray-500">No new notifications.</p>
                    ) : (
                      <div className="space-y-2 max-h-72 overflow-y-auto">
                        {notifications.map((notification) => (
                          <button
                            key={notification.notification_id}
                            type="button"
                            className="w-full text-left rounded-lg border border-gray-100 p-3 hover:bg-gray-50 transition"
                            onClick={() => {
                              navigate(notification.target_path || `/orders/${notification.order_id}/timeline`);
                              setShowNotifications(false);
                            }}
                          >
                            <p className="text-sm font-semibold text-gray-900">{notification.title}</p>
                            <p className="text-sm text-gray-600">{notification.message}</p>
                            <p className="mt-1 text-xs text-gray-500">
                              {new Date(notification.created_at).toLocaleString('en-US', {
                                month: 'short',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </p>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="relative" ref={accountMenuRef}>
                <button
                  type="button"
                  onClick={() => setShowAccountMenu((current) => !current)}
                  className="text-right px-3 py-1.5 rounded-xl border border-gray-200 bg-white/70 hover:bg-white transition"
                >
                  <div className="flex items-center gap-2">
                    <div className="text-right">
                      <p className="text-sm font-semibold text-gray-900">{user.email}</p>
                      <p className="text-xs text-gray-500 font-medium">
                        {isGuest ? 'Guest' : user.is_verified ? 'Verified' : 'Pending'}
                      </p>
                    </div>
                    <span className="text-xs text-gray-400 font-bold leading-none">▼</span>
                  </div>
                </button>

                {showAccountMenu && (
                  <div className="absolute right-0 mt-2 w-48 rounded-xl border border-gray-200 bg-white shadow-lg p-2">
                    <button
                      type="button"
                      className="w-full text-left px-3 py-2 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50"
                      onClick={() => {
                        navigate('/dashboard');
                        setShowAccountMenu(false);
                      }}
                    >
                      Profile
                    </button>
                    <button
                      type="button"
                      className="w-full text-left px-3 py-2 rounded-lg text-sm font-medium text-red-600 hover:bg-red-50"
                      onClick={() => {
                        setShowAccountMenu(false);
                        logout();
                        navigate('/');
                      }}
                    >
                      Logout
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
