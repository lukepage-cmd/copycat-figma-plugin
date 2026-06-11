export const metadata = { title: 'CopyCat Proxy' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui', padding: 24, color: '#222' }}>
        {children}
      </body>
    </html>
  );
}
