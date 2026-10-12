export const metadata = { title: "crawl402 example" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", maxWidth: 680, margin: "40px auto", padding: "0 16px", lineHeight: 1.6 }}>
        {children}
      </body>
    </html>
  );
}
