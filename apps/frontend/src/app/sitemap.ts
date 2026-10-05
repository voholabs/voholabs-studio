import { MetadataRoute } from 'next';

// Built per request so FRONTEND_URL is the running environment's domain.
export const dynamic = 'force-dynamic';

// The pages anyone can open without signing in.
export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.FRONTEND_URL || 'https://studio.voholabs.com';
  return [
    { url: `${base}/pricing`, changeFrequency: 'weekly', priority: 1 },
    { url: `${base}/terms`, changeFrequency: 'monthly', priority: 0.3 },
    { url: `${base}/privacy`, changeFrequency: 'monthly', priority: 0.3 },
  ];
}
