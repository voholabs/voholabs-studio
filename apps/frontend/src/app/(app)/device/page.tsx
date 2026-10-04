'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { Logo } from '@gitroom/frontend/components/new-layout/logo';

const Halo = () => (
  <div className="absolute inset-0 opacity-30">
    <div className="absolute top-[20%] left-[10%] w-[300px] h-[300px] bg-[#20808D] rounded-full blur-[120px]" />
    <div className="absolute bottom-[20%] right-[10%] w-[250px] h-[250px] bg-[#1FB8CD] rounded-full blur-[120px]" />
  </div>
);

export default function DeviceAuthorizePage() {
  const searchParams = useSearchParams();
  const fetch = useFetch();

  // The CLI opens {FRONTEND_URL}/device?code=XXXX-XXXX
  const initialCode = (searchParams.get('code') || '').toUpperCase();
  const [userCode, setUserCode] = useState(initialCode);
  const [status, setStatus] = useState<
    'loading' | 'ready' | 'invalid' | 'approved' | 'error'
  >(initialCode ? 'loading' : 'ready');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!initialCode) {
      return;
    }
    fetch(`/device/info?user_code=${encodeURIComponent(initialCode)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data?.alreadyApproved) {
          setStatus('approved');
        } else if (data?.valid) {
          setStatus('ready');
        } else {
          setStatus('invalid');
        }
      })
      .catch(() => setStatus('error'));
  }, [initialCode]);

  const handleApprove = useCallback(async () => {
    setSubmitting(true);
    try {
      const result = await (
        await fetch('/device/approve', {
          method: 'POST',
          body: JSON.stringify({ user_code: userCode }),
        })
      ).json();

      if (result?.success) {
        setStatus('approved');
      } else {
        setStatus('invalid');
      }
    } catch {
      setStatus('error');
    } finally {
      setSubmitting(false);
    }
  }, [userCode]);

  if (status === 'loading') {
    return (
      <div className="flex flex-1 items-center justify-center text-white relative overflow-hidden">
        <Halo />
        <div className="relative z-10 text-center">
          <div className="flex justify-center mb-[24px]">
            <Logo />
          </div>
          <div className="text-[16px] text-gray-400">Please wait...</div>
          <div className="mt-[32px] flex justify-center">
            <div className="w-[48px] h-[48px] border-[3px] border-[#20808D] border-t-transparent rounded-full animate-spin" />
          </div>
        </div>
      </div>
    );
  }

  if (status === 'approved') {
    return (
      <div className="flex flex-1 items-center justify-center text-white relative overflow-hidden">
        <Halo />
        <div className="relative z-10 text-center">
          <div className="flex justify-center mb-[24px]">
            <Logo />
          </div>
          <div className="w-[80px] h-[80px] mx-auto mb-[24px] rounded-full bg-green-500/20 flex items-center justify-center">
            <svg
              className="w-[40px] h-[40px] text-green-500"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                clipRule="evenodd"
              />
            </svg>
          </div>
          <div className="text-[28px] font-semibold mb-[12px]">
            Device authorized
          </div>
          <div className="text-[16px] text-gray-400 max-w-[400px]">
            You can return to your terminal — the CLI is now connected to your
            Voholabs account.
          </div>
        </div>
      </div>
    );
  }

  if (status === 'invalid' || status === 'error') {
    return (
      <div className="flex flex-1 items-center justify-center text-white relative overflow-hidden">
        <Halo />
        <div className="relative z-10 text-center">
          <div className="flex justify-center mb-[24px]">
            <Logo />
          </div>
          <div className="w-[80px] h-[80px] mx-auto mb-[24px] rounded-full bg-red-500/20 flex items-center justify-center">
            <svg
              className="w-[40px] h-[40px] text-red-500"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </div>
          <div className="text-[28px] font-semibold mb-[12px]">
            {status === 'invalid'
              ? 'Invalid or expired code'
              : 'Something went wrong'}
          </div>
          <div className="text-[16px] text-gray-400 max-w-[400px]">
            Run <span className="text-white">auth:login</span> again in your
            terminal to get a fresh code.
          </div>
        </div>
      </div>
    );
  }

  // status === 'ready'
  return (
    <div className="flex flex-1 items-center justify-center text-white relative overflow-hidden">
      <Halo />
      <div className="relative z-10 w-full max-w-[500px] mx-auto px-[20px]">
        <div className="flex justify-center mb-[32px]">
          <Logo />
        </div>

        <div className="bg-[#1A1919] rounded-[16px] p-[32px] flex flex-col gap-[24px]">
          <div className="flex flex-col items-center gap-[8px]">
            <h2 className="text-[24px] font-semibold text-center">
              Connect the CLI
            </h2>
            <div className="text-gray-400 text-center text-[14px]">
              Confirm the code shown in your terminal to link the CLI to your
              Voholabs account.
            </div>
          </div>

          <div className="flex flex-col gap-[8px]">
            <label className="text-[12px] text-gray-400 uppercase tracking-[0.08em]">
              Your code
            </label>
            <input
              value={userCode}
              onChange={(e) => setUserCode(e.target.value.toUpperCase())}
              placeholder="XXXX-XXXX"
              className="bg-[#0B0A0A] border border-[#2A2929] rounded-[8px] py-[12px] px-[16px] text-[20px] tracking-[0.2em] text-center font-mono focus:outline-none focus:border-[#20808D]"
            />
          </div>

          <div className="border-t border-[#2A2929] pt-[16px]">
            <div className="text-[14px] text-gray-400 mb-[12px]">
              Once connected, the CLI will be able to:
            </div>
            <ul className="text-[14px] list-disc list-inside space-y-[4px]">
              <li>Access your integrations and channels</li>
              <li>Create and schedule posts on your behalf</li>
              <li>Read your post analytics</li>
            </ul>
          </div>

          <button
            onClick={handleApprove}
            disabled={submitting || !userCode.trim()}
            className="bg-[#20808D] hover:bg-[#7B3FF2] disabled:opacity-50 text-white rounded-[8px] py-[10px] px-[16px] text-[14px] font-semibold transition-colors"
          >
            {submitting ? 'Authorizing...' : 'Authorize device'}
          </button>
        </div>
      </div>
    </div>
  );
}
