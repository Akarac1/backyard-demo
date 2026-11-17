import type { MetadataRoute } from 'next';

const SITE = 'https://www.backyardairport.com';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/admin', '/driver', '/ops', '/exec', '/account', '/login', '/liff', '/tv', '/api'] }],
    sitemap: `${SITE}/sitemap.xml`,
    host: SITE,
  };
}
