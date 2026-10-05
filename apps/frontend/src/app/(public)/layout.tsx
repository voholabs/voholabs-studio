import '../global.scss';
import 'react-tooltip/dist/react-tooltip.css';
import { ReactNode } from 'react';
import { Metadata } from 'next';
import { cookies } from 'next/headers';
import { Inter_Tight } from 'next/font/google';
import clsx from 'clsx';
import {
  cookieName,
  fallbackLng,
} from '@gitroom/react/translation/i18n.config';

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.FRONTEND_URL || 'https://studio.voholabs.com'
  ),
};

const interTight = Inter_Tight({
  weight: ['600', '500', '400'],
  style: ['normal'],
  subsets: ['latin'],
});

const RTL = ['he', 'ar'];

// Root layout for public marketing pages (/pricing). Like the legal pages it
// has no auth, SWR or provider context, so it renders for anonymous visitors
// and search engines. Theme and direction come from the same cookies the app
// uses, so a signed-in user sees it the way they see the app.
export default async function PublicLayout({
  children,
}: {
  children: ReactNode;
}) {
  const cookieStore = await cookies();
  const language = cookieStore.get(cookieName)?.value || fallbackLng;
  const mode = cookieStore.get('mode')?.value === 'light' ? 'light' : 'dark';
  return (
    <html lang={language} dir={RTL.includes(language) ? 'rtl' : 'ltr'}>
      <head>
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="icon" type="image/png" href="/favicon.png" />
      </head>
      <body
        className={clsx(interTight.className, mode, 'text-primary !bg-primary')}
      >
        {children}
      </body>
    </html>
  );
}
