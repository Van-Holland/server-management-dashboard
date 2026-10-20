import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono, Rethink_Sans } from 'next/font/google'
import './globals.css'
import { AmbientGlow } from '@/components/ambient-glow'
import { Constellation } from '@/components/constellation'
import { Launcher } from '@/components/launcher'

const geistSans = Geist({ subsets: ['latin'], variable: '--font-geist-sans' })
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono' })
// The machine name in the header only; everything else stays Geist.
const rethinkSans = Rethink_Sans({ subsets: ['latin'], weight: ['400'], variable: '--font-name' })

export const metadata: Metadata = {
  title: 'Mulderserver',
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
    <html lang="en" className={`dark ${geistSans.variable} ${geistMono.variable} ${rethinkSans.variable}`}>
      <body className="bg-background font-sans antialiased">
        <Constellation />
        <AmbientGlow />
        {children}
        <Launcher />
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
