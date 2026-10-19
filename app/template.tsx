/**
 * A template, unlike a layout, is created fresh on every navigation, which is
 * what lets each page play its small arrival animation (.page-enter in globals.css).
 */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="page-enter">{children}</div>
}
