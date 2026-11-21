import React, { useState } from 'react';
import { PhoneCall, Lock, Mail, AlertCircle, ArrowRight } from 'lucide-react';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { Card } from './ui/card';

export default function LoginView({ onLoginSuccess }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setErrorMessage('Please enter both email and password.');
      return;
    }

    setIsLoading(true);
    setErrorMessage('');

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          password: password,
        }),
      });

      let data = {};
      try {
        data = await res.json();
      } catch {
        // Response was not JSON
      }

      if (res.status === 404) {
        setErrorMessage('Backend server process needs to be restarted to load the new auth routes. Please restart "npm run dev" or "node dev.js".');
        return;
      }

      if (!res.ok || !data.ok) {
        setErrorMessage(data.error || 'Invalid email or password. Please check your credentials.');
        return;
      }

      // Store auth session in localStorage
      localStorage.setItem('swargaseema_token', data.token);
      localStorage.setItem('swargaseema_user', JSON.stringify(data.user));

      if (onLoginSuccess) {
        onLoginSuccess(data.user, data.token);
      }
    } catch (err) {
      setErrorMessage(`Connection error: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background p-4 relative overflow-hidden">
      {/* Subtle backdrop glow */}
      <div className="absolute -top-40 -left-40 w-96 h-96 bg-[#008792]/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-40 -right-40 w-96 h-96 bg-primary/10 rounded-full blur-3xl pointer-events-none" />

      <Card className="w-full max-w-md p-6 sm:p-8 bg-card border-border shadow-2xl relative z-10">
        {/* Brand Header */}
        <div className="flex flex-col items-center text-center mb-6">
          <div className="size-12 rounded-xl bg-[#008792] flex items-center justify-center text-white shadow-lg shadow-[#008792]/20 mb-3">
            <PhoneCall className="size-6" />
          </div>
          <h1 className="text-xl font-bold tracking-tight text-foreground">
            Swargaseema AI Telephony
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Sign in to access your outbound dialing campaign console
          </p>
        </div>

        {/* Error notification */}
        {errorMessage && (
          <div className="mb-4 p-2.5 rounded-lg bg-destructive/10 border border-destructive/20 flex items-start gap-2 text-destructive text-xs animate-in fade-in duration-200">
            <AlertCircle className="size-4 shrink-0 mt-0.5" />
            <span className="leading-tight">{errorMessage}</span>
          </div>
        )}

        {/* Login Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5 text-left">
            <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
              <Mail className="size-3 text-muted-foreground" />
              Email Address
            </label>
            <Input
              type="email"
              placeholder="agent@swargaseema.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={isLoading}
              className="h-9 text-xs"
              autoFocus
              required
            />
          </div>

          <div className="space-y-1.5 text-left">
            <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
              <Lock className="size-3 text-muted-foreground" />
              Password
            </label>
            <Input
              type="password"
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isLoading}
              className="h-9 text-xs"
              required
            />
          </div>

          <Button
            type="submit"
            disabled={isLoading}
            className="w-full h-9 bg-[#008792] hover:bg-[#00747e] text-white text-xs font-semibold mt-2 shadow-sm"
          >
            {isLoading ? (
              <span className="flex items-center gap-2">
                <span className="size-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Signing in...
              </span>
            ) : (
              <span className="flex items-center justify-center gap-1.5">
                Sign In to Console
                <ArrowRight className="size-3.5" />
              </span>
            )}
          </Button>
        </form>

        <div className="mt-6 pt-4 border-t border-border/50 text-center">
          <span className="text-[11px] text-muted-foreground">
            Isolated sessions configured via secure environment settings
          </span>
        </div>
      </Card>
    </div>
  );
}
