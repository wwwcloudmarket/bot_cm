export const metadata = {
  title: "CLOUD PASS",
  description: "Telegram bot on Vercel",
};

export default function RootLayout({ children }) {
  return (
    <html lang="ru">
      <body style={{ margin: 0, fontFamily: "system-ui" }}>{children}</body>
    </html>
  );
}
