import { supabase } from "../../lib/supabase";

export const runtime = "nodejs";

async function sendMessage(chatId, text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}

async function upsertUserFromUpdate(update) {
  const u = update?.message?.from;
  if (!u?.id) return null;

  // users.id = tg_id (bigint)
  const { error } = await supabase.from("users").upsert(
    {
      id: u.id,
      username: u.username ?? null,
      first_name: u.first_name ?? null,
      last_name: u.last_name ?? null,
    },
    { onConflict: "id" }
  );

  if (error) throw error;
  return u.id;
}

async function ensureSubscription(userId) {
  // Создаём подписку один раз (MVP: ACTIVE по умолчанию)
  const { data, error } = await supabase
    .from("subscriptions")
    .select("user_id,status,plan,next_billing_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;

  if (data) return data;

  const { data: created, error: createErr } = await supabase
    .from("subscriptions")
    .insert({
      user_id: userId,
      status: "ACTIVE",
      plan: "CLOUD_PASS",
      next_billing_at: null,
    })
    .select("user_id,status,plan,next_billing_at")
    .single();

  if (createErr) throw createErr;
  return created;
}

export async function GET() {
  return new Response("ok");
}

export async function POST(req) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET || "";
  const header = req.headers.get("x-telegram-bot-api-secret-token") || "";

  if (secret && header !== secret) {
    return new Response("unauthorized", { status: 401 });
  }

  const update = await req.json().catch(() => null);
  if (!update) return new Response("bad request", { status: 400 });

  try {
    const msg = update.message;
    if (!msg?.text) return new Response("ok");

    const chatId = msg.chat.id;
    const text = (msg.text || "").trim();

    // 1) сохраняем/обновляем пользователя в Supabase
    const userId = await upsertUserFromUpdate(update);

    // 2) команды
    if (text === "/start") {
      if (userId) await ensureSubscription(userId);

      await sendMessage(
        chatId,
        "✅ CLOUD PASS online.\n\nКоманды:\n/start — старт\n/status — статус подписки"
      );
      return new Response("ok");
    }

    if (text === "/status") {
      if (!userId) {
        await sendMessage(chatId, "Не смог определить пользователя 😕");
        return new Response("ok");
      }

      const sub = await ensureSubscription(userId);

      const next = sub.next_billing_at
        ? new Date(sub.next_billing_at).toLocaleString("ru-RU")
        : "—";

      await sendMessage(
        chatId,
        `Статус подписки: ${sub.status}\nТариф: ${sub.plan}\nСлед. списание: ${next}`
      );
      return new Response("ok");
    }

    // default
    await sendMessage(chatId, "Напиши /status чтобы увидеть статус подписки.");
    return new Response("ok");
  } catch (e) {
    console.error(e);
    return new Response("ok");
  }
}
