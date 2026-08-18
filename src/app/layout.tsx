import type { Metadata } from 'next';
import './globals.css';
import { StoreProvider } from '@/lib/store';

export const metadata: Metadata = {
  title: 'Apartment Search',
  description: 'Manhattan apartment search over a verified nightly inventory dataset',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
        {/* The nightly run writes inventory-latest.js next to the built site so the
            page works straight off the filesystem, where fetch() is blocked. */}
        <script src="./inventory-latest.js" async />
      </head>
      <body>
        <StoreProvider>{children}</StoreProvider>
      </body>
    </html>
  );
}
