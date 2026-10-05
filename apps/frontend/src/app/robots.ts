import { MetadataRoute } from 'next';

// Built per request so FRONTEND_URL is the running environment's domain.
export const dynamic = 'force-dynamic';

// Crawling stays open as before; this only points crawlers at the sitemap.
export default function robots(): MetadataRoute.Robots {
  const base = process.env.FRONTEND_URL || 'https://studio.voholabs.com';
  return {
    rules: { userAgent: '*', allow: '/' },
    sitemap: `${base}/sitemap.xml`,
  };
}
