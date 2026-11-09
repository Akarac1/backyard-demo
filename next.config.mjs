/** @type {import('next').NextConfig} */
const securityHeaders = [
  // HTTPS only, for two years (Vercel serves HTTPS already; this stops downgrade tricks)
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  // no framing of our pages inside other sites (click-jacking). LIFF opens pages directly, not in a frame.
  { key: 'X-Frame-Options', value: 'DENY' },
  // Content-Security-Policy is set per request in middleware.ts (it needs a fresh nonce)
  // the browser must not guess file types
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // camera only for our own pages (staff QR scan); no microphone or location
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(), payment=()' },
];

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: { serverActions: { bodySizeLimit: '6mb' } },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};
export default nextConfig;
