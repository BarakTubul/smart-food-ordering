import { useState, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { apiClient } from '@/services/apiClient';
import { Card, Alert, Button, Input } from '@/components/UI';

export function DashboardPage() {
  const { user, isGuest } = useAuth();
  const [accountInfo, setAccountInfo] = useState<{
    masked_email: string;
    full_name?: string | null;
    date_of_birth?: string | null;
    address?: string | null;
    demo_card_last4?: string | null;
    balance_cents?: number | null;
  } | null>(null);
  const [demoCardPassword, setDemoCardPassword] = useState('');
  const [revealedDemoCard, setRevealedDemoCard] = useState('');
  const [walletUnlocked, setWalletUnlocked] = useState(false);
  const [revealingCard, setRevealingCard] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const formatCents = (cents?: number | null): string =>
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format((cents || 0) / 100);

  const handleUnlockWallet = async () => {
    if (!demoCardPassword.trim()) {
      setError('Please enter your password to unlock wallet details.');
      return;
    }

    try {
      setError('');
      setRevealingCard(true);
      const response = await apiClient.revealDemoCard(demoCardPassword);
      setRevealedDemoCard(response.demo_card_number);
      setWalletUnlocked(true);
      setDemoCardPassword('');
    } catch (err) {
      setWalletUnlocked(false);
      setError(err instanceof Error ? err.message : 'Failed to unlock wallet');
    } finally {
      setRevealingCard(false);
    }
  };

  const handleLockWallet = () => {
    setWalletUnlocked(false);
    setRevealedDemoCard('');
    setDemoCardPassword('');
  };

  useEffect(() => {
    const loadData = async () => {
      try {
        setError('');
        if (isGuest) {
          console.debug('[dashboard] guest session detected, skipping account/order fetch');
          setAccountInfo({ masked_email: user?.email || 'Guest user' });
        } else {
          const accData = await apiClient.getAccountMe();
          setAccountInfo({
            masked_email: accData.email_masked || 'Unknown account',
            full_name: accData.full_name,
            date_of_birth: accData.date_of_birth,
            address: accData.address,
            demo_card_last4: accData.demo_card_last4,
            balance_cents: accData.balance_cents,
          });
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load data');
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [isGuest, user?.email]);

  if (loading) {
    return (
      <div className="p-6">
        <div className="text-center text-gray-500">Loading dashboard...</div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      {error && <Alert type="error" message={error} onClose={() => setError('')} />}

      {/* Profile Section */}
      <Card>
        <h2 className="text-2xl font-bold text-gray-900 mb-4">Profile</h2>
        <div className="space-y-2">
          <p className="text-gray-700">
            <span className="font-semibold">Email:</span> {accountInfo?.masked_email}
          </p>
          {!isGuest && (
            <>
              <p className="text-gray-700">
                <span className="font-semibold">Name:</span> {accountInfo?.full_name || 'Not provided'}
              </p>
              <p className="text-gray-700">
                <span className="font-semibold">Date of Birth:</span> {accountInfo?.date_of_birth || 'Not provided'}
              </p>
              <p className="text-gray-700">
                <span className="font-semibold">Address:</span> {accountInfo?.address || 'Not provided'}
              </p>
            </>
          )}
          <p className="text-gray-700">
            <span className="font-semibold">Status:</span>{' '}
            {isGuest ? (
              <span className="text-orange-600">🔓 Guest Access (Limited functionality)</span>
            ) : user?.is_verified ? (
              <span className="text-green-600">✓ Verified Account</span>
            ) : (
              <span className="text-yellow-600">⏳ Pending Verification</span>
            )}
          </p>
          {isGuest && (
            <div className="mt-3 p-3 bg-orange-50 border border-orange-200 rounded">
              <p className="text-sm text-orange-800">
                You're accessing as a guest. Some features like refunds are limited.{' '}
                <button className="text-blue-600 hover:underline font-semibold">
                  Create an account
                </button>
              </p>
            </div>
          )}
        </div>
      </Card>

      {!isGuest && (
        <Card>
          <h2 className="text-2xl font-bold text-gray-900 mb-4">Wallet</h2>
          {!walletUnlocked ? (
            <div className="rounded-md border border-slate-200 bg-slate-50 p-4 space-y-3 max-w-md">
              <p className="text-sm text-slate-900 font-semibold">Wallet is locked</p>
              <p className="text-xs text-slate-600">Enter your account password to view card and balance.</p>
              <Input
                label="Wallet password"
                type="password"
                value={demoCardPassword}
                onChange={(e) => setDemoCardPassword(e.target.value)}
                placeholder="Your account password"
              />
              <Button variant="outline" size="sm" onClick={handleUnlockWallet} disabled={revealingCard}>
                {revealingCard ? 'Unlocking...' : 'Unlock Wallet'}
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex justify-end">
                <Button variant="outline" size="sm" onClick={handleLockWallet}>
                  Lock Wallet
                </Button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="rounded-md border border-cyan-100 bg-cyan-50 p-4">
                <p className="text-sm text-cyan-900 font-semibold mb-1">Available Balance</p>
                <p className="text-3xl font-black text-cyan-950">{formatCents(accountInfo?.balance_cents)}</p>
                <p className="text-xs text-cyan-800 mt-2">Balance updates when an order is paid or refund is approved.</p>
              </div>

              <div className="rounded-md border border-slate-200 bg-slate-50 p-4 space-y-2">
                <p className="text-sm text-slate-900 font-semibold">Demo Card</p>
                <p className="font-mono text-slate-800">{revealedDemoCard}</p>
              </div>
            </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
