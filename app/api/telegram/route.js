import { supabase } from "../../lib/supabase";

export const runtime = "nodejs";

/** ---------------- Telegram API helpers ---------------- */
const TG = {
  token: () => process.env.TELEGRAM_BOT_TOKEN,
  api: (method) => `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`,
};

async function tg(method, payload) {
  const res = await fetch(TG.api(method), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.json().catch(() => ({}));
}

async function sendMessage(chatId, text, replyMarkup) {
  return tg("sendMessage", {
    chat_id: chatId,
    text,
    reply_markup: replyMarkup,
  });
}

async function editMessageText(chatId, messageId, text, replyMarkup) {
  return tg("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    reply_markup: replyMarkup,
  });
}

/** ---------------- Keyboards ---------------- */
function contactKeyboard() {
  return {
    keyboard: [[{ text: "📱 Отправить контакт", request_contact: true }]],
    resize_keyboard: true,
    one_time_keyboard: true,
  };
}

function mainMenuKeyboard() {
  return {
    keyboard: [
      [{ text: "📌 Моя подписка" }],
      [{ text: "🛍 Выбрать подписку" }],
    ],
    resize_keyboard: true,
  };
}

function plansInlineKeyboard(plans) {
  return {
    inline_keyboard: plans.map((p) => [
      { text: `${p.title} — ${p.price_rub}₽`, callback_data: `plan:${p.id}` },
    ]),
  };
}

function planDetailKeyboard(planId) {
  return {
    inline_keyboard: [
      [{ text: "✅ Оформить подписку", callback_data: `subscribe:${planId}` }],
      [{ text: "⬅️ Назад к тарифам", callback_data: "plans" }],
      [{ text: "🏠 В меню", callback_data: "menu" }],
    ],
  };
}

function backToMenuKeyboard() {
  return {
    inline_keyboard: [[{ text: "🏠 В меню", callback_data: "menu" }]],
  };
}

/** ---------------- DB helpers ---------------- */
function getFrom(update) {
  return update?.message?.from || update?.callback_query?.from || null;
}

function getChatId(update) {
  return update?.message?.chat?.id || update?.callback_query?.message?.chat?.id || null;
}

function getMessageId(update) {
  return update?.callback_query?.message?.message_id || null;
}

async function upsertUser(from) {
  if (!from?.id) return null;

  // users.id = tg_id
  const { error } = await supabase.from("users").upsert(
    {
      id: from.id,
      username: from.username ?? null,
      first_name: from.first_name ?? null,
      last_name: from.last_name ?? null,
    },
    { onConflict: "id" }
  );

  if (error) throw error;
  return from.id;
}

async function getUser(userId) {
  const { data, error } = await supabase
    .from("users")
    .select("id, phone, profile_completed, username, first_name")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function setUserPhone(userId, phone) {
  const { error } = await supabase
    .from("users")
    .update({ phone, profile_completed: true })
    .eq("id", userId);
  if (error) throw error;
}

async function getSubscription(userId) {
  const { data, error } = await supabase
    .from("subscriptions")
    .select("user_id, status, plan, next_billing_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data; // может быть null
}

async function createOrUpdateSubscription(userId, planId) {
  const { data, error } = await supabase
    .from("subscriptions")
    .upsert(
      {
        user_id: userId,
        status: "ACTIVE",
        plan: planId, // используем твою текущую колонку plan как ключ тарифа
        next_billing_at: null,
      },
      { onConflict: "user_id" }
    )
    .select("user_id, status, plan, next_billing_at")
    .single();

  if (error) throw error;
  return data;
}

async function getPlans() {
  const { data, error } = await supabase
    .from("plans")
    .select("id, title, description, price_rub, is_active, sort")
    .eq("is_active", true)
    .order("sort", { ascending: true });

  if (error) throw error;
  return data ?? [];
}

async function getPlanById(id) {
  const { data, error } = await supabase
    .from("plans")
    .select("id, title, description, price_rub")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** ---------------- Flow screens ---------------- */
async function showPlans(chatId) {
  const plans = await getPlans();
  if (!plans.length) {
    await sendMessage(chatId, "Сейчас нет доступных тарифов.", backToMenuKeyboard());
    return;
  }
  await sendMessage(
    chatId,
    "Выбери подписку CLOUD PASS. Нажми на тариф, чтобы увидеть описание 👇",
    plansInlineKeyboard(plans)
  );
}

async function showMenu(chatId, userId) {
  const sub = await getSubscription(userId);

  if (!sub) {
    await sendMessage(
      chatId,
      "У тебя пока нет подписки. Нажми «🛍 Выбрать подписку» или выбери тариф прямо сейчас:",
      mainMenuKeyboard()
    );
    await showPlans(chatId);
    return;
  }

  const next = sub.next_billing_at
    ? new Date(sub.next_billing_at).toLocaleString("ru-RU")
    : "—";

  await sendMessage(
    chatId,
    `Твоя подписка:\nСтатус: ${sub.status}\nТариф: ${sub.plan}\nСлед. списание: ${next}`,
    mainMenuKeyboard()
  );
}

/** ---------------- Handlers ---------------- */
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
    const from = getFrom(update);
    const chatId = getChatId(update);
    if (!from?.id || !chatId) return new Response("ok");

    const userId = await upsertUser(from);
    const user = await getUser(userId);

    /** 1) Приём контакта */
    const contact = update?.message?.contact;
    if (contact) {
      // защита: принимаем контакт только если пользователь прислал СВОЙ
      if (contact.user_id && contact.user_id !== from.id) {
        await sendMessage(chatId, "⚠️ Пришли свой контакт кнопкой ниже.", contactKeyboard());
        return new Response("ok");
      }

      const phone = contact.phone_number;
      if (!phone) {
        await sendMessage(chatId, "Не вижу номер. Нажми кнопку «Отправить контакт».", contactKeyboard());
        return new Response("ok");
      }

      await setUserPhone(userId, phone);
      await sendMessage(chatId, "✅ Профиль создан! Теперь выбери подписку:", mainMenuKeyboard());
      await showPlans(chatId);
      return new Response("ok");
    }

    /** 2) Callback queries (нажатия на inline кнопки) */
    const cq = update?.callback_query;
    if (cq?.data) {
      const data = cq.data;
      const messageId = getMessageId(update);

      // если профиль не заполнен — просим контакт
      if (!user?.profile_completed || !user?.phone) {
        await sendMessage(chatId, "Сначала создай профиль — отправь контакт кнопкой ниже 👇", contactKeyboard());
        return new Response("ok");
      }

      if (data === "plans") {
        const plans = await getPlans();
        if (messageId) {
          await editMessageText(
            chatId,
            messageId,
            "Выбери тариф CLOUD PASS 👇",
            plansInlineKeyboard(plans)
          );
        } else {
          await showPlans(chatId);
        }
        return new Response("ok");
      }

      if (data === "menu") {
        await showMenu(chatId, userId);
        return new Response("ok");
      }

      if (data.startsWith("plan:")) {
        const planId = data.split(":")[1];
        const plan = await getPlanById(planId);
        if (!plan) {
          await sendMessage(chatId, "Тариф не найден.", backToMenuKeyboard());
          return new Response("ok");
        }

        const text =
          `⭐ ${plan.title}\n\n` +
          `${plan.description}\n\n` +
          `💰 Цена: *${plan.price_rub}₽*\n\n` +
          `Нажми «Оформить подписку», чтобы активировать.`;

        // Telegram MarkdownV2 — не будем усложнять, просто plain text без форматирования
        if (messageId) {
          await editMessageText(chatId, messageId, text.replace(/\*/g, ""), planDetailKeyboard(planId));
        } else {
          await sendMessage(chatId, text.replace(/\*/g, ""), planDetailKeyboard(planId));
        }
        return new Response("ok");
      }

      if (data.startsWith("subscribe:")) {
        const planId = data.split(":")[1];
        const plan = await getPlanById(planId);
        if (!plan) {
          await sendMessage(chatId, "Тариф не найден.", backToMenuKeyboard());
          return new Response("ok");
        }

        const sub = await createOrUpdateSubscription(userId, planId);

        await sendMessage(
          chatId,
          `✅ Подписка оформлена!\nТариф: ${sub.plan}\nСтатус: ${sub.status}\n\nНапиши «📌 Моя подписка» или /status.`,
          mainMenuKeyboard()
        );
        return new Response("ok");
      }

      return new Response("ok");
    }

    /** 3) Текстовые команды/меню */
    const text = (update?.message?.text || "").trim();

    // если профиля нет — просим контакт
    if (!user?.profile_completed || !user?.phone) {
      if (text === "/start") {
        await sendMessage(
          chatId,
          "Чтобы продолжить, нужно создать профиль. Нажми кнопку и отправь контакт 👇",
          contactKeyboard()
        );
        return new Response("ok");
      }

      await sendMessage(chatId, "Сначала отправь контакт кнопкой ниже 👇", contactKeyboard());
      return new Response("ok");
    }

    if (text === "/start") {
      await sendMessage(chatId, "✅ Ты авторизован. Открываю меню.", mainMenuKeyboard());
      await showMenu(chatId, userId);
      return new Response("ok");
    }

    if (text === "/status" || text === "📌 Моя подписка") {
      const sub = await getSubscription(userId);

      if (!sub) {
        await sendMessage(chatId, "У тебя пока нет подписки. Давай выберем тариф:", mainMenuKeyboard());
        await showPlans(chatId);
        return new Response("ok");
      }

      const next = sub.next_billing_at
        ? new Date(sub.next_billing_at).toLocaleString("ru-RU")
        : "—";

      await sendMessage(
        chatId,
        `Твоя подписка:\nСтатус: ${sub.status}\nТариф: ${sub.plan}\nСлед. списание: ${next}`,
        mainMenuKeyboard()
      );
      return new Response("ok");
    }

    if (text === "🛍 Выбрать подписку") {
      await showPlans(chatId);
      return new Response("ok");
    }

    await sendMessage(chatId, "Команды:\n/status — статус\n🛍 Выбрать подписку — тарифы", mainMenuKeyboard());
    return new Response("ok");
  } catch (e) {
    console.error(e);
    return new Response("ok");
  }
}
