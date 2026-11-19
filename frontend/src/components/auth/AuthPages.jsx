import React, { useState, useEffect } from 'react';
import {
  PhoneCall,
  Lock,
  Mail,
  User,
  ArrowRight,
  CheckCircle2,
  AlertCircle,
  Copy,
  Check,
  Eye,
  EyeOff,
  Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { setAuthToken, setStoredUser } from '@/utils/auth';

export default function AuthPages({
  mode = 'login',
  initialMode = 'login',
  token = '',
  onAuthSuccess,
  onLoginSuccess,
  onNavigate,
}) {
  const [currentMode, setCurrentMode] = useState(mode || initialMode || 'login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [fallbackUrl, setFallbackUrl] = useState('');
  const [copiedLink, setCopiedLink] = useState(false);

  // Token Verification for Activation / Reset
  const [verifiedUser, setVerifiedUser] = useState(null);
  const [isVerifyingToken, setIsVerifyingToken] = useState(false);

  useEffect(() => {
    setCurrentMode(mode);
  }, [mode]);

  // When activating or resetting, verify token on mount
  useEffect(() => {
    if ((currentMode === 'activate' || currentMode === 'reset') && token) {
      setIsVerifyingToken(true);
      setErrorMessage('');
      const type = currentMode === 'activate' ? 'activation' : 'reset';
      fetch(`/api/auth/verify-token?token=${encodeURIComponent(token)}&type=${type}`)
        .then((r) => r.json())
        .then((data) => {
          if (data.ok) {
            setVerifiedUser({ email: data.email, name: data.name });
            setEmail(data.email || '');
          } else {
            setErrorMessage(data.error || 'Invalid or expired link. Please contact administrator.');
          }
        })
        .catch((err) => {
          setErrorMessage(`Verification error: ${err.message}`);
        })
        .finally(() => {
          setIsVerifyingToken(false);
        });
    }
  }, [currentMode, token]);

  const handleCopyFallback = () => {
    if (!fallbackUrl) return;
    navigator.clipboard.writeText(fallbackUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  // 1. Submit Login
  const handleLogin = async (e) => {
    e.preventDefault();
    if (!email || !password) {
      setErrorMessage('Please enter both email and password.');
      return;
    }
    setIsLoading(true);
    setErrorMessage('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setErrorMessage(data.error || 'Login failed. Please check your credentials.');
        return;
      }
      setAuthToken(data.token);
      setStoredUser(data.user);
      setSuccessMessage('Signed in successfully! Loading console...');
      const notifySuccess = onAuthSuccess || onLoginSuccess;
      if (notifySuccess) {
        notifySuccess(data.user, data.token);
      }
    } catch (err) {
      setErrorMessage(`Network error during login: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  // 2. Submit Forgot Password
  const handleForgotPassword = async (e) => {
    e.preventDefault();
    if (!email) {
      setErrorMessage('Please enter your registered email address.');
      return;
    }
    setIsLoading(true);
    setErrorMessage('');
    setSuccessMessage('');
    setFallbackUrl('');
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setErrorMessage(data.error || 'Failed to submit password reset request.');
        return;
      }
      setSuccessMessage(data.message || 'If an account exists, a password reset link has been dispatched.');
      if (data.reset_url) {
        setFallbackUrl(data.reset_url);
      }
    } catch (err) {
      setErrorMessage(`Request error: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  // 3. Submit Account Activation (First-time password setup)
  const handleActivate = async (e) => {
    e.preventDefault();
    if (!password) {
      setErrorMessage('Please choose a password.');
      return;
    }
    if (password.length < 6) {
      setErrorMessage('Password must be at least 6 characters long.');
      return;
    }
    if (password !== confirmPassword) {
      setErrorMessage('Passwords do not match.');
      return;
    }
    setIsLoading(true);
    setErrorMessage('');
    try {
      const res = await fetch('/api/auth/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setErrorMessage(data.error || 'Account activation failed.');
        return;
      }
      setAuthToken(data.token);
      setStoredUser(data.user);
      setSuccessMessage(data.message || 'Account activated successfully!');
      setTimeout(() => {
        const notifySuccess = onAuthSuccess || onLoginSuccess;
        if (notifySuccess) {
          notifySuccess(data.user, data.token);
        }
      }, 1000);
    } catch (err) {
      setErrorMessage(`Activation error: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  // 4. Submit Reset Password
  const handleResetPassword = async (e) => {
    e.preventDefault();
    if (!password) {
      setErrorMessage('Please enter a new password.');
      return;
    }
    if (password.length < 6) {
      setErrorMessage('Password must be at least 6 characters long.');
      return;
    }
    if (password !== confirmPassword) {
      setErrorMessage('Passwords do not match.');
      return;
    }
    setIsLoading(true);
    setErrorMessage('');
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setErrorMessage(data.error || 'Password reset failed.');
        return;
      }
      setSuccessMessage('Password updated successfully! Redirecting to login...');
      setTimeout(() => {
        if (onNavigate) onNavigate('login');
        else setCurrentMode('login');
      }, 1800);
    } catch (err) {
      setErrorMessage(`Reset error: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 p-4 relative overflow-hidden">
      {/* Decorative gradient glow */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[350px] bg-[#008792]/20 blur-[130px] rounded-full pointer-events-none" />

      <Card className="w-full max-w-md p-6 sm:p-8 bg-slate-900/90 border-slate-800 backdrop-blur-xl shadow-2xl relative z-10 text-slate-100">
        {/* Brand Header */}
        <div className="flex flex-col items-center text-center mb-6">
          <div className="size-12 rounded-xl bg-gradient-to-br from-[#008792] to-teal-700 flex items-center justify-center shadow-lg shadow-teal-900/40 mb-3">
            <PhoneCall className="size-6 text-white" />
          </div>
          <h1 className="text-xl font-bold tracking-tight text-white">
            Swargaseema AI Telephony
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            {currentMode === 'login' && 'Autonomous Voice AI Lead Qualification & OBD Console'}
            {currentMode === 'forgot' && 'Reset your voice console account password'}
            {currentMode === 'activate' && 'First-Time Employee Account Activation'}
            {currentMode === 'reset' && 'Create your new account password'}
          </p>
        </div>

        {/* Global Notifications */}
        {errorMessage && (
          <div className="mb-4 p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs flex items-start gap-2 animate-in fade-in">
            <AlertCircle className="size-4 shrink-0 mt-0.5" />
            <span className="flex-1 leading-relaxed">{errorMessage}</span>
          </div>
        )}

        {successMessage && (
          <div className="mb-4 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs flex items-start gap-2 animate-in fade-in">
            <CheckCircle2 className="size-4 shrink-0 mt-0.5" />
            <span className="flex-1 leading-relaxed">{successMessage}</span>
          </div>
        )}

        {/* Fallback direct link box (when SMTP is not configured in dev) */}
        {fallbackUrl && (
          <div className="mb-4 p-3 rounded-lg bg-teal-500/10 border border-teal-500/30 text-xs text-teal-300">
            <div className="font-semibold mb-1 flex items-center justify-between">
              <span>Direct Link Generated:</span>
              <Button
                variant="ghost"
                size="xs"
                onClick={handleCopyFallback}
                className="h-6 px-1.5 text-teal-300 hover:text-white gap-1"
              >
                {copiedLink ? <Check className="size-3 text-emerald-400" /> : <Copy className="size-3" />}
                {copiedLink ? 'Copied' : 'Copy Link'}
              </Button>
            </div>
            <div className="font-mono text-[11px] bg-slate-950/60 p-1.5 rounded break-all select-all text-slate-300">
              {fallbackUrl}
            </div>
          </div>
        )}

        {/* ============================================================== */}
        {/* MODE: LOGIN */}
        {/* ============================================================== */}
        {currentMode === 'login' && (
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Work Email Address
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-2.5 size-4 text-slate-500" />
                <Input
                  type="email"
                  placeholder="employee@swargaseema.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-9 bg-slate-950/50 border-slate-700 text-white placeholder:text-slate-500 h-9"
                  required
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-medium text-slate-300">
                  Password
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setErrorMessage('');
                    setSuccessMessage('');
                    if (onNavigate) onNavigate('forgot');
                    else setCurrentMode('forgot');
                  }}
                  className="text-xs text-[#008792] hover:text-teal-400 font-medium transition-colors"
                >
                  Forgot password?
                </button>
              </div>
              <div className="relative">
                <Lock className="absolute left-3 top-2.5 size-4 text-slate-500" />
                <Input
                  type={showPassword ? 'text' : 'password'}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-9 pr-9 bg-slate-950/50 border-slate-700 text-white placeholder:text-slate-500 h-9"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-2.5 text-slate-500 hover:text-slate-300"
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>

            <Button
              type="submit"
              disabled={isLoading}
              className="w-full h-9 bg-gradient-to-r from-[#008792] to-teal-600 hover:from-teal-600 hover:to-teal-700 text-white font-medium text-xs mt-2"
            >
              {isLoading ? 'Signing In...' : 'Sign In to Telephony Console'}
              {!isLoading && <ArrowRight className="size-3.5 ml-1.5" />}
            </Button>

            <div className="pt-3 border-t border-slate-800 text-center">
              <p className="text-[11px] text-slate-400">
                Master Admin credentials configured in <code className="text-teal-400 font-mono">.env</code>.
                Employees activate accounts via email invitation.
              </p>
            </div>
          </form>
        )}

        {/* ============================================================== */}
        {/* MODE: FORGOT PASSWORD */}
        {/* ============================================================== */}
        {currentMode === 'forgot' && (
          <form onSubmit={handleForgotPassword} className="space-y-4">
            <p className="text-xs text-slate-300 leading-relaxed mb-2">
              Enter your registered work email. We will dispatch a password reset link to your inbox.
            </p>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Work Email Address
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-2.5 size-4 text-slate-500" />
                <Input
                  type="email"
                  placeholder="your-name@swargaseema.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-9 bg-slate-950/50 border-slate-700 text-white placeholder:text-slate-500 h-9"
                  required
                />
              </div>
            </div>

            <Button
              type="submit"
              disabled={isLoading}
              className="w-full h-9 bg-[#008792] hover:bg-teal-700 text-white font-medium text-xs"
            >
              {isLoading ? 'Sending Reset Link...' : 'Send Password Reset Link'}
            </Button>

            <div className="text-center pt-2">
              <button
                type="button"
                onClick={() => {
                  setErrorMessage('');
                  setSuccessMessage('');
                  if (onNavigate) onNavigate('login');
                  else setCurrentMode('login');
                }}
                className="text-xs text-slate-400 hover:text-white transition-colors"
              >
                ← Back to Login
              </button>
            </div>
          </form>
        )}

        {/* ============================================================== */}
        {/* MODE: ACTIVATE ACCOUNT */}
        {/* ============================================================== */}
        {currentMode === 'activate' && (
          <div>
            {isVerifyingToken ? (
              <div className="text-center py-6 text-slate-400 text-xs flex items-center justify-center gap-2">
                <span className="size-3 rounded-full border-2 border-teal-500 border-t-transparent animate-spin" />
                Verifying activation link...
              </div>
            ) : verifiedUser ? (
              <form onSubmit={handleActivate} className="space-y-4">
                <div className="p-3 bg-teal-500/10 border border-teal-500/20 rounded-lg text-xs mb-2">
                  <div className="text-teal-300 font-semibold mb-0.5">
                    Welcome, {verifiedUser.name || 'Team Member'}!
                  </div>
                  <div className="text-slate-400">
                    Account: <span className="font-mono text-slate-200">{verifiedUser.email}</span>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Choose Your New Password (min. 6 characters)
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-2.5 size-4 text-slate-500" />
                    <Input
                      type={showPassword ? 'text' : 'password'}
                      placeholder="Enter new password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="pl-9 pr-9 bg-slate-950/50 border-slate-700 text-white placeholder:text-slate-500 h-9"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-2.5 text-slate-500 hover:text-slate-300"
                    >
                      {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Confirm Password
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-2.5 size-4 text-slate-500" />
                    <Input
                      type={showPassword ? 'text' : 'password'}
                      placeholder="Confirm password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="pl-9 bg-slate-950/50 border-slate-700 text-white placeholder:text-slate-500 h-9"
                      required
                    />
                  </div>
                </div>

                <Button
                  type="submit"
                  disabled={isLoading}
                  className="w-full h-9 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-medium text-xs mt-2"
                >
                  {isLoading ? 'Activating Account...' : 'Activate & Enter Console'}
                </Button>
              </form>
            ) : (
              <div className="text-center pt-2">
                <button
                  type="button"
                  onClick={() => {
                    if (onNavigate) onNavigate('login');
                    else setCurrentMode('login');
                  }}
                  className="text-xs text-slate-400 hover:text-white"
                >
                  ← Return to Login
                </button>
              </div>
            )}
          </div>
        )}

        {/* ============================================================== */}
        {/* MODE: RESET PASSWORD */}
        {/* ============================================================== */}
        {currentMode === 'reset' && (
          <div>
            {isVerifyingToken ? (
              <div className="text-center py-6 text-slate-400 text-xs flex items-center justify-center gap-2">
                <span className="size-3 rounded-full border-2 border-teal-500 border-t-transparent animate-spin" />
                Verifying password reset link...
              </div>
            ) : verifiedUser ? (
              <form onSubmit={handleResetPassword} className="space-y-4">
                <p className="text-xs text-slate-300 mb-2">
                  Set a new password for <span className="font-semibold text-white">{verifiedUser.email}</span>.
                </p>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    New Password (min. 6 characters)
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-2.5 size-4 text-slate-500" />
                    <Input
                      type={showPassword ? 'text' : 'password'}
                      placeholder="Enter new password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="pl-9 pr-9 bg-slate-950/50 border-slate-700 text-white placeholder:text-slate-500 h-9"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-2.5 text-slate-500 hover:text-slate-300"
                    >
                      {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Confirm New Password
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-2.5 size-4 text-slate-500" />
                    <Input
                      type={showPassword ? 'text' : 'password'}
                      placeholder="Confirm new password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="pl-9 bg-slate-950/50 border-slate-700 text-white placeholder:text-slate-500 h-9"
                      required
                    />
                  </div>
                </div>

                <Button
                  type="submit"
                  disabled={isLoading}
                  className="w-full h-9 bg-[#008792] hover:bg-teal-700 text-white font-medium text-xs mt-2"
                >
                  {isLoading ? 'Updating Password...' : 'Save New Password & Log In'}
                </Button>
              </form>
            ) : (
              <div className="text-center pt-2">
                <button
                  type="button"
                  onClick={() => {
                    if (onNavigate) onNavigate('login');
                    else setCurrentMode('login');
                  }}
                  className="text-xs text-slate-400 hover:text-white"
                >
                  ← Return to Login
                </button>
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
