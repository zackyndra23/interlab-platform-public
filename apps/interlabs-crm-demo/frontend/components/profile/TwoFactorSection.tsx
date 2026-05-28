'use client';

import { useState } from 'react';
import Image from 'next/image';
import { toast } from 'sonner';
import { twofactorApi } from '@/lib/twofactor-api';
import type { TwoFactorMethod } from '@/lib/twofactor-types';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';

interface TwoFactorSectionProps {
  currentMethod: TwoFactorMethod;
  onMethodChanged?: (method: TwoFactorMethod) => void;
}

type Step =
  | { kind: 'idle' }
  | { kind: 'disable-confirm' }
  | { kind: 'totp-qr'; secret: string; qrDataUrl: string }
  | { kind: 'totp-verify'; secret: string }
  | { kind: 'backup-codes'; codes: string[] };

/**
 * Two-Factor Authentication section for the Edit Profile page.
 *
 * Renders three radio options:
 *   1. Disabled
 *   2. Email OTP
 *   3. Google Authenticator (TOTP)
 *
 * Changing to a different method triggers the appropriate flow.
 */
export function TwoFactorSection({ currentMethod, onMethodChanged }: TwoFactorSectionProps) {
  const [selected, setSelected] = useState<TwoFactorMethod>(currentMethod);
  const [step, setStep] = useState<Step>({ kind: 'idle' });
  const [busy, setBusy] = useState(false);

  // Fields for disable confirmation.
  const [disablePw, setDisablePw] = useState('');
  const [disableCode, setDisableCode] = useState('');

  // Field for TOTP verification step.
  const [totpCode, setTotpCode] = useState('');

  // Backup-code download confirmation.
  const [backupSaved, setBackupSaved] = useState(false);

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function resetState() {
    setStep({ kind: 'idle' });
    setBusy(false);
    setDisablePw('');
    setDisableCode('');
    setTotpCode('');
    setBackupSaved(false);
  }

  function handleRadioChange(method: TwoFactorMethod) {
    if (method === selected) return;
    setSelected(method);
    resetState();
  }

  // ---------------------------------------------------------------------------
  // Save handler
  // ---------------------------------------------------------------------------

  async function handleSave() {
    if (selected === currentMethod) return;

    if (selected === 'disabled') {
      setStep({ kind: 'disable-confirm' });
      return;
    }

    if (selected === 'email') {
      setBusy(true);
      try {
        await twofactorApi.enableEmail();
        toast.success('Email 2FA enabled');
        onMethodChanged?.('email');
        resetState();
      } catch (err: unknown) {
        const e = err as { response?: { data?: { error?: string } }; message?: string };
        toast.error(`Failed: ${e?.response?.data?.error ?? e?.message ?? 'unknown'}`);
      } finally {
        setBusy(false);
      }
      return;
    }

    if (selected === 'totp') {
      setBusy(true);
      try {
        const data = await twofactorApi.setupTotp();
        setStep({ kind: 'totp-qr', secret: data.secret, qrDataUrl: data.qr_data_url });
      } catch (err: unknown) {
        const e = err as { response?: { data?: { error?: string } }; message?: string };
        toast.error(`Failed: ${e?.response?.data?.error ?? e?.message ?? 'unknown'}`);
      } finally {
        setBusy(false);
      }
      return;
    }
  }

  // ---------------------------------------------------------------------------
  // Disable confirmation
  // ---------------------------------------------------------------------------

  async function handleDisableSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!disablePw) { toast.error('Current password is required'); return; }
    setBusy(true);
    try {
      await twofactorApi.disable({
        current_password: disablePw,
        code: disableCode || undefined,
      });
      toast.success('Two-factor authentication disabled');
      onMethodChanged?.('disabled');
      setSelected('disabled');
      resetState();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } }; message?: string };
      toast.error(`Failed: ${e?.response?.data?.error ?? e?.message ?? 'unknown'}`);
    } finally {
      setBusy(false);
    }
  }

  // ---------------------------------------------------------------------------
  // TOTP: advance from QR to verify step
  // ---------------------------------------------------------------------------

  function handleProceedToVerify() {
    if (step.kind !== 'totp-qr') return;
    setStep({ kind: 'totp-verify', secret: step.secret });
    setTotpCode('');
  }

  // ---------------------------------------------------------------------------
  // TOTP: verify code
  // ---------------------------------------------------------------------------

  async function handleTotpVerify(e: React.FormEvent) {
    e.preventDefault();
    if (step.kind !== 'totp-verify') return;
    if (!/^\d{6}$/.test(totpCode)) { toast.error('Code must be exactly 6 digits'); return; }
    setBusy(true);
    try {
      const result = await twofactorApi.verifyTotpSetup({ secret: step.secret, code: totpCode });
      setStep({ kind: 'backup-codes', codes: result.backup_codes });
      setBackupSaved(false);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } }; message?: string };
      toast.error(`Failed: ${e?.response?.data?.error ?? e?.message ?? 'unknown'}`);
    } finally {
      setBusy(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Backup codes: finish
  // ---------------------------------------------------------------------------

  function handleBackupCodesDone() {
    if (!backupSaved) { toast.error('Please confirm you have saved your backup codes'); return; }
    toast.success('Google Authenticator 2FA enabled');
    onMethodChanged?.('totp');
    setSelected('totp');
    resetState();
  }

  function handleCopyBackupCodes() {
    if (step.kind !== 'backup-codes') return;
    navigator.clipboard.writeText(step.codes.join('\n'));
    toast.success('Backup codes copied to clipboard');
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const methodChanged = selected !== currentMethod;

  return (
    <section className="mb-8 border-t border-gray-200 dark:border-gray-700 pt-6">
      <h2 className="text-lg font-semibold mb-1">Two-Factor Authentication</h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
        Add an extra layer of security to your account. When enabled, you will be asked for a
        verification code each time you sign in.
      </p>

      {/* Radio options */}
      <fieldset className="space-y-3 mb-4">
        <legend className="sr-only">Two-factor authentication method</legend>

        <RadioOption
          id="2fa-disabled"
          value="disabled"
          selected={selected}
          label="Disabled"
          description="No two-factor authentication."
          onChange={handleRadioChange}
        />

        <RadioOption
          id="2fa-email"
          value="email"
          selected={selected}
          label="Email OTP"
          description="A 6-digit code is sent to your email address each time you sign in. Codes expire in 10 minutes."
          onChange={handleRadioChange}
        />

        <RadioOption
          id="2fa-totp"
          value="totp"
          selected={selected}
          label="Google Authenticator (TOTP)"
          description="Use an authenticator app (Google Authenticator, Authy, etc.) to generate time-based codes."
          onChange={handleRadioChange}
        />
      </fieldset>

      {/* Save button — only shown when method changed and no multi-step flow active */}
      {methodChanged && step.kind === 'idle' && (
        <Button onClick={handleSave} disabled={busy}>
          {busy ? 'Please wait...' : 'Save'}
        </Button>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Disable confirmation                                                 */}
      {/* ------------------------------------------------------------------ */}
      {step.kind === 'disable-confirm' && (
        <div className="mt-4 max-w-md rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 p-4">
          <p className="text-sm font-medium text-red-700 dark:text-red-400 mb-3">
            Confirm: disable two-factor authentication
          </p>
          <form onSubmit={handleDisableSubmit} className="space-y-3">
            <label className="block">
              <span className="text-sm">Current password <span className="text-red-500">*</span></span>
              <Input
                type="password"
                value={disablePw}
                onChange={e => setDisablePw(e.target.value)}
                autoComplete="current-password"
                required
              />
            </label>
            {currentMethod === 'totp' && (
              <label className="block">
                <span className="text-sm">
                  Authenticator code or backup code{' '}
                  <span className="text-red-500">*</span>
                </span>
                <Input
                  type="text"
                  inputMode="numeric"
                  value={disableCode}
                  onChange={e => setDisableCode(e.target.value.trim())}
                  placeholder="6-digit code or backup code"
                />
              </label>
            )}
            <div className="flex gap-2">
              <Button
                type="submit"
                disabled={busy}
                className="bg-red-600 hover:bg-red-700 text-white"
              >
                {busy ? 'Disabling...' : 'Disable 2FA'}
              </Button>
              <Button type="button" variant="outline" onClick={resetState}>
                Cancel
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* TOTP setup: QR code                                                  */}
      {/* ------------------------------------------------------------------ */}
      {step.kind === 'totp-qr' && (
        <div className="mt-4 max-w-md rounded-lg border border-border bg-card p-4 space-y-4">
          <p className="text-sm font-medium">Scan this QR code with your authenticator app</p>
          <div className="flex justify-center">
            <Image
              src={step.qrDataUrl}
              alt="TOTP QR code"
              width={200}
              height={200}
              className="rounded"
              unoptimized
            />
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">Or enter this key manually:</p>
            <code className="block rounded bg-muted px-2 py-1 text-xs font-mono break-all">
              {step.secret}
            </code>
          </div>
          <div className="flex gap-2">
            <Button onClick={handleProceedToVerify}>
              Next: Enter code
            </Button>
            <Button type="button" variant="outline" onClick={resetState}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* TOTP setup: verify code                                              */}
      {/* ------------------------------------------------------------------ */}
      {step.kind === 'totp-verify' && (
        <div className="mt-4 max-w-md rounded-lg border border-border bg-card p-4">
          <p className="text-sm font-medium mb-3">
            Enter the 6-digit code from your authenticator app to confirm setup
          </p>
          <form onSubmit={handleTotpVerify} className="space-y-3">
            <Input
              type="text"
              inputMode="numeric"
              autoFocus
              value={totpCode}
              onChange={e => setTotpCode(e.target.value.trim())}
              placeholder="6-digit code"
              maxLength={6}
              required
            />
            <div className="flex gap-2">
              <Button type="submit" disabled={busy || !/^\d{6}$/.test(totpCode)}>
                {busy ? 'Verifying...' : 'Verify'}
              </Button>
              <Button type="button" variant="outline" onClick={resetState}>
                Cancel
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Backup codes — shown once                                            */}
      {/* ------------------------------------------------------------------ */}
      {step.kind === 'backup-codes' && (
        <div className="mt-4 max-w-md rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 p-4 space-y-4">
          <div>
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-300 mb-1">
              Save your backup codes
            </p>
            <p className="text-xs text-amber-700 dark:text-amber-400">
              These codes are shown{' '}
              <strong>only once</strong>. Store them in a safe place. Each code can be used once
              to access your account if you lose your authenticator device.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {step.codes.map((c) => (
              <code
                key={c}
                className="rounded bg-white dark:bg-gray-900 border border-amber-200 dark:border-amber-800 px-2 py-1 text-xs font-mono text-center tracking-widest"
              >
                {c}
              </code>
            ))}
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={handleCopyBackupCodes}
            className="w-full text-sm"
          >
            Copy to clipboard
          </Button>
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              className="mt-0.5 shrink-0"
              checked={backupSaved}
              onChange={e => setBackupSaved(e.target.checked)}
              style={{ accentColor: '#C8102E' }}
            />
            <span className="text-xs text-amber-800 dark:text-amber-300">
              I have saved these backup codes in a secure location.
            </span>
          </label>
          <Button onClick={handleBackupCodesDone} disabled={!backupSaved} className="w-full">
            Done
          </Button>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Sub-component: single radio option
// ---------------------------------------------------------------------------

interface RadioOptionProps {
  id: string;
  value: TwoFactorMethod;
  selected: TwoFactorMethod;
  label: string;
  description: string;
  onChange: (v: TwoFactorMethod) => void;
}

function RadioOption({ id, value, selected, label, description, onChange }: RadioOptionProps) {
  const isSelected = value === selected;
  return (
    <label
      htmlFor={id}
      className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
        isSelected
          ? 'border-red-500 dark:border-red-600 bg-red-50 dark:bg-red-950/30'
          : 'border-border hover:bg-accent'
      }`}
    >
      <input
        id={id}
        type="radio"
        name="two_factor_method"
        value={value}
        checked={isSelected}
        onChange={() => onChange(value)}
        className="mt-0.5 shrink-0"
        style={{ accentColor: '#C8102E' }}
      />
      <div>
        <span className="text-sm font-medium">{label}</span>
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
      </div>
    </label>
  );
}
