import React, { useState } from 'react';
import { PhoneCall, Lock, User, AlertCircle, ArrowRight } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';

export default function LoginModal({ onLoginSuccess }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) {
      setError('Please enter both username and password.');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Authentication failed');
      }

      localStorage.setItem('swargaseema_token', data.token);
      localStorage.setItem('swargaseema_user', JSON.stringify(data.user));
      onLoginSuccess(data.user);
    } catch (err) {
      setError(err.message || 'Login failed. Please check credentials.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-2xl space-y-6">
        <div className="flex flex-col items-center text-center space-y-2">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#008792] text-white shadow-md">
            <PhoneCall className="h-6 w-6" />
          </div>
          <h1 className="text-xl font-bold tracking-tight text-foreground">Swargaseema AI</h1>
          <p className="text-xs text-muted-foreground">
            Outbound Telephony & Campaign Console
          </p>
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded-md bg-destructive/10 p-2.5 text-xs text-destructive border border-destructive/20">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5 text-left">
            <label className="text-xs font-medium text-foreground">Operator ID / Username</label>
            <div className="relative">
              <User className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                type="text"
                placeholder="e.g. prakash, operator1"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={isLoading}
                className="pl-9 text-xs h-9"
                autoFocus
              />
            </div>
          </div>

          <div className="space-y-1.5 text-left">
            <label className="text-xs font-medium text-foreground">Password</label>
            <div className="relative">
              <Lock className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                type="password"
                placeholder="Enter password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isLoading}
                className="pl-9 text-xs h-9"
              />
            </div>
          </div>

          <Button
            type="submit"
            disabled={isLoading}
            className="w-full h-9 bg-[#008792] hover:bg-[#007680] text-white text-xs font-semibold gap-1.5"
          >
            <span>{isLoading ? 'Signing in...' : 'Sign In'}</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </form>

        <div className="pt-2 border-t text-center text-[11px] text-muted-foreground">
          Protected Operator Session · Swargaseema Telephony
        </div>
      </div>
    </div>
  );
}
