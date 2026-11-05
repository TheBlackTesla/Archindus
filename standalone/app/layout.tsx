import type { Metadata } from "next";
import "./globals.css";
const siteUrl = new URL("https://archindus.stevenscadet.chatgpt.site");
export const metadata: Metadata = {
  metadataBase: siteUrl,
  title: { default: "Archindus | Architect Industries", template: "%s | Archindus" },
  description: "The Archindus Oracle workspace by Architect Industries. Describe what you want to accomplish, continue the conversation, and review your results.",
  alternates: { canonical: "/" },
  openGraph: { type: "website", url: "/", siteName: "Archindus", title: "Archindus | Architect Industries", description: "One conversational workspace, built around your objective." },
  twitter: { card: "summary", title: "Archindus | Architect Industries", description: "One conversational workspace, built around your objective." },
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const application = { "@context": "https://schema.org", "@type": "WebApplication", name: "Archindus", url: siteUrl.toString(), applicationCategory: "ProductivityApplication", operatingSystem: "Web", creator: { "@type": "Organization", name: "Architect Industries Inc.", url: "https://architectindustries.com" } };
  return <html lang="en"><body>{children}<script type="application/ld+json">{JSON.stringify(application)}</script></body></html>;
}
