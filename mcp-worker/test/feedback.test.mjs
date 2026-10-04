import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.mjs";
import { parseFeedback, feedbackEmail } from "../src/feedback.mjs";

const post = (body, env, ip = "1.2.3.4") =>
  worker.fetch(new Request("https://mcp.udslib.com/feedback", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": ip }, body: JSON.stringify(body) }), env);

function fakeEnv() {
  const kv = new Map();
  const sent = [];
  return {
    sent,
    FEEDBACK_KV: { get: async (k) => kv.get(k) ?? null, put: async (k, v) => void kv.set(k, v) },
    EMAIL: { send: async (m) => void sent.push(m) },
  };
}

test("feedback: valid message is emailed with reply-to and category", async () => {
  const env = fakeEnv();
  const r = await post({ message: "Please support Kvaser KME files.", email: "eng@example.com", category: "trace-format", page: "/viewer.html" }, env);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("access-control-allow-origin"), "*");
  assert.equal(env.sent.length, 1);
  const m = env.sent[0];
  assert.equal(m.to, "andrii@shylenko.com");
  assert.deepEqual(m.replyTo, { email: "eng@example.com" });
  assert.equal(m.subject, "[UDSLib feedback] trace-format /viewer.html");
  assert.match(m.text, /Please support Kvaser KME files\./);
});

test("feedback: validation errors", async () => {
  const env = fakeEnv();
  assert.equal((await post({ message: "short" }, env)).status, 400);
  assert.equal((await post({ message: "x".repeat(4001) }, env)).status, 400);
  assert.equal((await post({ message: "long enough message", email: "nope" }, env)).status, 400);
  assert.equal(env.sent.length, 0);
  assert.equal(parseFeedback({ message: "long enough message", category: "weird" }).category, "general");
});

test("feedback: honeypot silently dropped, rate limit after 5 per hour", async () => {
  const env = fakeEnv();
  assert.equal((await post({ message: "long enough message", website: "http://spam" }, env)).status, 200);
  assert.equal(env.sent.length, 0);
  for (let i = 0; i < 5; i++) assert.equal((await post({ message: `message number ${i}` }, env, "9.9.9.9")).status, 200);
  assert.equal((await post({ message: "one too many" }, env, "9.9.9.9")).status, 429);
  assert.equal((await post({ message: "different sender" }, env, "8.8.8.8")).status, 200);
});

test("feedback: missing email binding is 503, GET is 405, bad JSON 400", async () => {
  assert.equal((await post({ message: "long enough message" }, {})).status, 503);
  assert.equal((await worker.fetch(new Request("https://mcp.udslib.com/feedback"), {})).status, 405);
  const bad = await worker.fetch(new Request("https://mcp.udslib.com/feedback", { method: "POST", body: "{" }), fakeEnv());
  assert.equal(bad.status, 400);
});

test("feedbackEmail: subject capped, no reply address noted", () => {
  const { subject, text } = feedbackEmail({ message: "m".repeat(20), email: null, category: "bug", page: "/p".repeat(200), product: "udslib.com" });
  assert.ok(subject.length <= 200);
  assert.match(text, /no reply address/);
});
