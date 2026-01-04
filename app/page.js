export default function Page() {
  return (
    <main style={{ padding: 24, fontFamily: "system-ui" }}>
      <h1>CLOUD PASS</h1>
      <p>Bot is running.</p>
      <p>Telegram webhook endpoint: <code>/api/telegram</code></p>
      <p>Webhook setup endpoint: <code>/api/setup-webhook?key=...</code></p>
    </main>
  );
}
