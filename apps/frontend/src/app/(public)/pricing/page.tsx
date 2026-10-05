import { Metadata } from 'next';
import { cookies } from 'next/headers';
import {
  PublicPricing,
  PublicPrices,
} from '@gitroom/frontend/components/pricing/public.pricing';

export const dynamic = 'force-dynamic';

const TITLE = 'Pricing · Voholabs Studio';
const DESCRIPTION =
  "Voholabs Studio pricing: pay only for what you use. Most channels are free to schedule to; paid actions use prepaid credits at the provider's price.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: '/pricing' },
  openGraph: {
    type: 'website',
    siteName: 'Voholabs Studio',
    title: TITLE,
    description: DESCRIPTION,
    url: '/pricing',
    images: ['/favicon.png'],
  },
  twitter: { card: 'summary', title: TITLE, description: DESCRIPTION },
};

// The price list from the backend, read again at most once a minute.
const loadPrices = async (): Promise<PublicPrices | null> => {
  try {
    const res = await fetch(
      `${process.env.BACKEND_INTERNAL_URL}/public/prices`,
      { next: { revalidate: 60 } }
    );
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
};

// schema.org Product with one Offer per priced action, priced in the wallet
// currency (a credit price divided by the credits one currency unit buys).
const jsonLd = (prices: PublicPrices | null) => {
  const base = process.env.FRONTEND_URL || 'https://studio.voholabs.com';
  const offers: Record<string, unknown>[] = [
    {
      '@type': 'Offer',
      name: 'Start free',
      price: 0,
      priceCurrency: prices?.currency || 'USD',
      url: `${base}/auth`,
    },
  ];
  if (prices?.currency && prices.creditsPerUnit) {
    for (const section of prices.sections) {
      for (const a of section.actions) {
        if (a.billing === 'UNLOCK') continue;
        const price = Number(
          (a.price / 100 / prices.creditsPerUnit).toFixed(6)
        );
        offers.push({
          '@type': 'Offer',
          name: a.name,
          ...(a.description ? { description: a.description } : {}),
          price,
          priceCurrency: prices.currency,
          priceSpecification: {
            '@type': 'UnitPriceSpecification',
            price,
            priceCurrency: prices.currency,
            unitText: a.billing === 'MONTHLY' ? `${a.unit} per month` : a.unit,
            ...(a.billing === 'MONTHLY' ? { billingDuration: 'P1M' } : {}),
          },
        });
      }
    }
  }
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: 'Voholabs Studio',
    description: DESCRIPTION,
    url: `${base}/pricing`,
    brand: { '@type': 'Brand', name: 'Voholabs' },
    offers,
  };
};

export default async function PricingPage() {
  const [prices, cookieStore] = await Promise.all([loadPrices(), cookies()]);
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(jsonLd(prices)).replace(/</g, '\\u003c'),
        }}
      />
      <PublicPricing prices={prices} signedIn={!!cookieStore.get('auth')} />
    </>
  );
}
