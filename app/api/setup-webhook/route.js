export const runtime = "nodejs";

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const key = searchParams.get("key") || "";

  if (!process.env.SETUP_KEY || key !== process.env.SETUP_KEY) {
    return new Response("forbidden", { status: 403 });
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const baseUrl = (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET || "";

  if (!token || !baseUrl) {
    return new Response("Missing TELEGRAM_BOT_TOKEN or PUBLIC_BASE_URL", { status: 500 });
  }

  const webhookUrl = `${baseUrl}/api/telegram`;

  const tgRes = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      url: webhookUrl,
      secret_token: secret,
      allowed_updates: ["message"]
    })
  });

  const json = await tgRes.json();
  return Response.json({ webhookUrl, telegram: json });
}
