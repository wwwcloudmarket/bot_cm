export const runtime = "nodejs";

async function sendMessage(chatId, text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text })
  });
}

export async function GET() {
  return new Response("ok"); // просто чтобы проверить что endpoint существует
}

export async function POST(req) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET || "";
  const header = req.headers.get("x-telegram-bot-api-secret-token") || "";

  // Telegram будет присылать этот header, если мы зададим secret_token при setWebhook
  if (secret && header !== secret) {
    return new Response("unauthorized", { status: 401 });
  }

  const update = await req.json().catch(() => null);
  if (!update) return new Response("bad request", { status: 400 });

  const msg = update.message;
  if (msg && msg.text) {
    const chatId = msg.chat.id;
    const text = (msg.text || "").trim();

    if (text === "/start") {
      await sendMessage(chatId, "✅ CLOUD PASS bot online. Напиши: /status");
    } else if (text === "/status") {
      await sendMessage(chatId, "Статус: OK. Следующий шаг — подключаем Supabase.");
    }
  }

  return new Response("ok");
}
