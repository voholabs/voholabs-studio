export const dynamic = 'force-dynamic';
import { Metadata } from 'next';
import { LogoTextComponent } from '@gitroom/frontend/components/ui/logo-text.component';
import { getT } from '@gitroom/react/translation/get.translation.service.backend';

export const metadata: Metadata = {
  title: 'Voholabs Studio',
  description: '',
};

// The paywall. Deliberately outside the (site) route group: that layout loads
// /user/self, which is exactly the call the backend blocks once the trial is
// over, so rendering it here would bounce the browser straight back.
export default async function TrialEnded() {
  const t = await getT();
  const salesUrl = process.env.PAYWALL_URL || 'https://voholabs.com';

  return (
    <div className="bg-[#091717] flex flex-1 p-[12px] min-h-screen w-screen text-white">
      <div className="flex flex-col py-[40px] px-[20px] flex-1 rounded-[12px] bg-[#10201F]">
        <div className="w-full max-w-[520px] mx-auto justify-center gap-[24px] h-full flex flex-col text-center">
          <div className="flex justify-center">
            <LogoTextComponent />
          </div>
          <div className="text-[32px] font-[600] leading-[120%]">
            {t(
              'trial_ended_title',
              'Your free trial or subscription has ended'
            )}
          </div>
          <div className="text-[16px] text-white/70 leading-[150%]">
            {t(
              'trial_ended_description',
              'Thanks for using Voholabs Studio. Your scheduled posts are paused and publishing is disabled. Please contact sales to keep your account running.'
            )}
          </div>
          <div className="flex justify-center">
            <a
              href={salesUrl}
              className="bg-[#20808D] hover:bg-[#1FB8CD] transition-colors text-white rounded-[8px] px-[32px] py-[12px] text-[16px] font-[600]"
            >
              {t('trial_ended_contact_sales', 'Go to voholabs.com')}
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
