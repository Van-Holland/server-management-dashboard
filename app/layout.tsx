import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono, Instrument_Serif } from 'next/font/google'
import './globals.css'
import { AmbientGlow } from '@/components/ambient-glow'
import { Launcher } from '@/components/launcher'

const geistSans = Geist({ subsets: ['latin'], variable: '--font-geist-sans' })
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono' })
// The "mulderserver" wordmark only. Downloaded at build time and served from this server.
const instrumentSerif = Instrument_Serif({ subsets: ['latin'], weight: '400', variable: '--font-display-serif' })

export const metadata: Metadata = {
  title: 'Homelab — Server Dashboard',
  description: 'Monitor storage usage and launch your self-hosted apps',
  generator: 'v0.app',
  // The mulderserver mark. Orange on transparent reads on both light and dark
  // tab bars, so unlike the v0 icons it replaced there's no light/dark split —
  // one file, two sizes, the larger one for retina tabs.
  icons: {
    icon: [
      { url: '/icon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icon-64x64.png', sizes: '64x64', type: 'image/png' },
    ],
    apple: '/apple-icon.png',
  },
}

export const viewport: Viewport = {
  colorScheme: 'dark',
  themeColor: '#0c0b0a',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={`dark ${geistSans.variable} ${geistMono.variable} ${instrumentSerif.variable}`}>
      <body className="bg-background font-sans antialiased">
        <AmbientGlow />
        {children}
        <Launcher />
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
