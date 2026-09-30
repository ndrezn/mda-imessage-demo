# Reflex

Text a photo of a receipt to iMessage. Reflex reads it, applies an expense
policy, asks for anything the photo cannot tell it, and appends a row to a
ledger.

A [Managed Deep Agent](https://docs.langchain.com/langsmith/managed-deep-agents-overview)
reached over iMessage through [Photon](https://photon.codes), wired up as a
custom MDA HTTP channel.

## Demo

[![HTTP Channels for Managed Deep Agents](https://img.youtube.com/vi/6v0Fmsi4Ldk/maxresdefault.jpg)](https://www.youtube.com/watch?v=6v0Fmsi4Ldk)

## How it works

```text
iMessage → Photon webhook → channels/photon.ts → agent run → reply
```

- `lib/photon.ts` — the whole adapter. `verify` checks the HMAC, `parse` turns a
  webhook into a message (fetching and converting the photo), `post` sends the
  reply.
- `instructions.md` — the expense policy. This is the system prompt, and it syncs
  to Context Hub, so it can be edited in the LangSmith UI without redeploying.
- `memory.ts` — durable memory. The ledger lives at
  `/memories/agent/expenses.md`; the agent reads and writes it with its built-in
  file tools, so there are no custom tools in this project.

## Setup

```bash
npm install
cp .env.example .env   # then fill it in
npx mda dev            # local
npx mda deploy         # hosted
```

Register the deployment URL as the Photon webhook target:

```text
POST https://<deployment-url>/channels/photon/events
```

Then register yourself as a Photon project user. On a shared-line project this
is what allocates the number you text — it is not shown in the dashboard:

```bash
curl -s -u "$SPECTRUM_PROJECT_ID:$SPECTRUM_PROJECT_SECRET" \
  -X POST "https://spectrum.photon.codes/projects/$SPECTRUM_PROJECT_ID/users/" \
  -H 'content-type: application/json' \
  -d '{"type":"shared","phoneNumber":"+15551234567"}'
```

Text the `assignedPhoneNumber` from the response.

## Things worth knowing

- **Two webhook secrets.** Registration returns a `whsec_` Standard Webhooks
  secret and a legacy `signingSecret`. `verify` uses the legacy one.
- **Attachments carry metadata only.** The webhook has no image bytes, so
  `parse` redeems the id through the SDK. iMessage photos arrive as HEIC and are
  converted before the model sees them.
- **Gateway model ids are path-dependent.** `/openai/v1` expects a bare id
  (`gpt-5.5`); `/v1` expects a namespaced one (`openai/gpt-5.5`). `mda dev`
  forces `/openai/v1`, so keep `.env` and `agent.ts` in agreement.
- **Photon allows 5 requests/second per project.** `post` retries on 429.

## Demo-only by design

- Memory is agent-layer, so it is shared by every caller. One ledger for
  everyone. Real use needs the user layer.
- Thread ids are derived from the sender and never reset, so conversation
  context grows without bound (roughly 3.5k tokens per receipt image).
