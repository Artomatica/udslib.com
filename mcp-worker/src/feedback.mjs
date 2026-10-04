// Product feedback intake: POST /feedback -> email to the maintainer via Cloudflare Email Service.
// Same contract as the LabWired form: message 10-4000 chars, optional reply email, category, page path.
// Nothing is stored except a per-IP-hash rate-limit counter that expires after an hour.

export const FEEDBACK_TO = "andrii@shylenko.com";
export const FEEDBACK_FROM = { email: "andrii@labwired.com", name: "UDSLib feedback" };
export const CATEGORIES = ["general", "bug", "idea", "trace-format"];
export const MESSAGE_MIN = 10;
export const MESSAGE_MAX = 4000;
export const RATE_LIMIT_MAX = 5;
const WINDOW_SEC = 3600;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function hashId(raw) {
  let h = 2166136261;
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function parseFeedback(body) {
  if (!body || typeof body !== "object") return { error: "invalid_body" };
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (message.length < MESSAGE_MIN) return { error: "message_too_short" };
  if (message.length > MESSAGE_MAX) return { error: "message_too_long" };
  const email = typeof body.email === "string" && body.email.trim() ? body.email.trim() : null;
  if (email && (!EMAIL_RE.test(email) || email.length > 254)) return { error: "invalid_email" };
  const category = CATEGORIES.includes(body.category) ? body.category : "general";
  const page = typeof body.page === "string" ? body.page.slice(0, 300) : "";
  const product = typeof body.product === "string" ? body.product.slice(0, 40) : "udslib.com";
  if (typeof body.website === "string" && body.website) return { error: "spam" }; // honeypot field
  return { message, email, category, page, product };
}

export function feedbackEmail(f, now = new Date()) {
  const subject = `[UDSLib feedback] ${f.category}${f.page ? ` ${f.page}` : ""}`.slice(0, 200);
  const text = [
    f.message,
    "",
    "---",
    `Category: ${f.category}`,
    `From: ${f.email ?? "(no reply address)"}`,
    `Page: ${f.page || "-"}`,
    `Product: ${f.product}`,
    `Received: ${now.toISOString()}`,
  ].join("\n");
  return { subject, text };
}

async function rateLimited(env, ip, nowMs) {
  if (!env.FEEDBACK_KV) return false;
  const key = `feedback:rl:${hashId(ip)}`;
  let bucket = { count: 0, resetAt: nowMs + WINDOW_SEC * 1000 };
  try {
    const raw = await env.FEEDBACK_KV.get(key);
    if (raw) {
      const p = JSON.parse(raw);
      if (p.resetAt > nowMs) bucket = p;
    }
  } catch {
    /* fresh bucket */
  }
  if (bucket.count >= RATE_LIMIT_MAX) return true;
  bucket.count++;
  await env.FEEDBACK_KV.put(key, JSON.stringify(bucket), { expirationTtl: Math.max(60, Math.ceil((bucket.resetAt - nowMs) / 1000)) });
  return false;
}

export async function handleFeedback(request, env, cors) {
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...cors } });
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const f = parseFeedback(body);
  if (f.error === "spam") return json({ ok: true }); // pretend success to bots
  if (f.error) return json({ error: f.error }, 400);
  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  if (await rateLimited(env, ip, Date.now())) return json({ error: "rate_limited" }, 429);
  if (!env.EMAIL) return json({ error: "not_configured" }, 503);
  const { subject, text } = feedbackEmail(f);
  try {
    await env.EMAIL.send({ to: env.FEEDBACK_TO || FEEDBACK_TO, from: FEEDBACK_FROM, replyTo: f.email ? { email: f.email } : undefined, subject, text });
  } catch (e) {
    console.error(`[feedback] send failed: ${e instanceof Error ? e.message : String(e)}`);
    return json({ error: "send_failed" }, 502);
  }
  return json({ ok: true });
}
