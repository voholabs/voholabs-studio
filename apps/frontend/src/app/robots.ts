import { MetadataRoute } from 'next';

// Crawling stays open as before; this only points crawlers at the sitemap.
export default function robots(): MetadataRoute.Robots {
  const base = process.env.FRONTEND_URL || 'https://studio.voholabs.com';
  return {
    rules: { userAgent: '*', allow: '/' },
    sitemap: `${base}/sitemap.xml`,
  };
}
