import { MetadataRoute } from 'next';

// Lets people add Studio to their home screen and open it full screen, like an
// app. Nothing is cached for offline use; sw.js only shows /offline.html when
// there is no connection.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Voholabs Studio',
    short_name: 'Studio',
    description: 'Schedule and publish your social media posts.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#091717',
    theme_color: '#091717',
    icons: [
      { src: '/icons/app/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/app/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: '/icons/app/maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
