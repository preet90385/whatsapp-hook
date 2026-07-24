const express = require("express");
const crypto = require("crypto");
const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");
require('dotenv').config();

const app = express();
// Keep the raw body around (req.rawBody) so we can verify Meta's X-Hub-Signature-256
// header. body-parser is dropped in favor of express's built-in json parser.
app.use(express.json({
    verify: (req, res, buf) => { req.rawBody = buf; }
}));

const token = process.env.TOKEN; // WhatsApp Cloud API access token (used to send messages)
const verifyToken = process.env.MYTOKEN; // webhook "hub.verify_token" set in the Meta dashboard
const appSecret = process.env.APP_SECRET; // Meta App Secret, used to verify webhook signatures
const phone_number_id = process.env.PHONE_NUMBER_ID;

// Fail fast with a clear message instead of mysterious runtime errors later.
const requiredEnvVars = { TOKEN: token, MYTOKEN: verifyToken, SUPABASE_URL: process.env.SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY };
for (const [name, value] of Object.entries(requiredEnvVars)) {
    if (!value) console.warn(`[startup] WARNING: env var ${name} is not set — related features will fail.`);
}
if (!appSecret) {
    console.warn("[startup] WARNING: APP_SECRET is not set — incoming webhook signatures will NOT be verified. Anyone who finds your URL can post fake messages. Set APP_SECRET to enable verification.");
}

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

app.listen(process.env.PORT, () => {
    console.log("webhook is listening");
});

/**
 * Verifies that a POST to /webhook really came from Meta, using the
 * X-Hub-Signature-256 header (HMAC-SHA256 of the raw body, keyed with
 * the App Secret). Skips verification (with a warning already logged
 * above) if APP_SECRET isn't configured, so local testing still works.
 */
function isValidSignature(req) {
    if (!appSecret) return true;

    const signatureHeader = req.get("x-hub-signature-256");
    if (!signatureHeader) return false;

    const expected = "sha256=" + crypto
        .createHmac("sha256", appSecret)
        .update(req.rawBody)
        .digest("hex");

    const a = Buffer.from(signatureHeader);
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Core sender - posts any message payload to the WhatsApp Cloud API. */
async function sendWhatsAppMessage(data, senderPhoneId = phone_number_id) {
    try {
        const response = await axios({
            method: "POST",
            url: "https://graph.facebook.com/v13.0/" + senderPhoneId + "/messages?access_token=" + token,
            data,
            headers: { "Content-Type": "application/json" }
        });
        console.log("[sendWhatsAppMessage] SUCCESS:", JSON.stringify(response.data));
        return response;
    } catch (error) {
        console.error("[sendWhatsAppMessage] FAILED. Full error from Meta:",
            JSON.stringify(error.response ? error.response.data : error.message, null, 2)
        );
        throw error;
    }
}

/** Send a plain text message. */
function sendText(to, text, senderPhoneId) {
    return sendWhatsAppMessage({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: text },
    }, senderPhoneId);
}

/** Send the interactive list with the 3 demo options. */
function sendOptionsList(to, senderPhoneId) {
    return sendWhatsAppMessage({
        messaging_product: "whatsapp",
        to,
        type: "interactive",
        interactive: {
            type: "list",
            header: { type: "text", text: "Event Info" },
            body: { text: "What would you like to know more about?" },
            action: {
                button: "View Options",
                sections: [
                    {
                        title: "Event Details",
                        rows: [
                            { id: "expo_location", title: "Expo Location" },
                            { id: "marathon_datetime", title: "Marathon Date & Time" },
                            { id: "bib_collection", title: "Bib Collection Info" },
                        ],
                    },
                ],
            },
        },
    }, senderPhoneId);
}

/** Reply text for each list option id. */
function getOptionReply(optionId) {
    const replies = {
        expo_location: "The Expo will be held at City Convention Center, Hall 3.",
        marathon_datetime: "The Marathon starts at 6:00 AM on Sunday at the main stadium.",
        bib_collection: "Bib collection is open Friday & Saturday, 10 AM - 7 PM at the Expo venue.",
    };
    return replies[optionId] || "Sorry, I didn't recognize that option.";
}

/** Human-readable title lookup. */
function getOptionTitle(optionId) {
    const titles = {
        expo_location: "Expo Location",
        marathon_datetime: "Marathon Date & Time",
        bib_collection: "Bib Collection Info",
    };
    return titles[optionId] || optionId;
}

/**
 * Persists a user's selection to Supabase and returns the structured record.
 */
async function recordSelection(from, optionId) {
    const record = {
        from_number: from,
        selected_option_id: optionId,
        selected_option_title: getOptionTitle(optionId),
        reply_text: getOptionReply(optionId),
    };

    const { data, error } = await supabase
        .from("user_selections")
        .insert(record)
        .select()
        .single();

    if (error) {
        console.error("[recordSelection] Supabase insert failed:", JSON.stringify(error, null, 2));
        // Don't block the WhatsApp reply just because the DB write failed
        return { ...record, saved: false, error: error.message };
    }

    console.log("[recordSelection] Stored in Supabase:", JSON.stringify(data));
    return { ...data, saved: true };
}

/**
 * THE ACTION STEP of the workflow.
 */
async function processIncomingMessage(message, from, phon_no_id) {
    console.log("[processIncomingMessage] type:", message.type, "| from:", from, "| phone_number_id:", phon_no_id);

    if (message.type === "interactive" && message.interactive?.type === "list_reply") {
        const selectedId = message.interactive.list_reply?.id;
        console.log("[processIncomingMessage] User selected:", selectedId);

        const record = await recordSelection(from, selectedId);
        const apiResponse = await sendText(from, getOptionReply(selectedId), phon_no_id);

        return {
            handled: true,
            eventType: "list_reply",
            selection: record,
            whatsappApiResponse: apiResponse.data
        };
    }

    if (message.type === "text" && message.text) {
        const msg_body = message.text.body;
        console.log("[processIncomingMessage] Incoming text:", msg_body);

        const apiResponse = await sendText(from, "Hi.. I'm Prasath, your message is " + msg_body, phon_no_id);

        return {
            handled: true,
            eventType: "text",
            from,
            messageBody: msg_body,
            whatsappApiResponse: apiResponse.data
        };
    }

    console.log("[processIncomingMessage] Unhandled message type, nothing sent:", message.type);
    return { handled: false, eventType: message.type || "unknown" };
}

//to verify the callback url from dashboard side - cloud api side
app.get("/webhook", (req, res) => {
    const mode = req.query["hub.mode"];
    const challenge = req.query["hub.challenge"];
    const incomingVerifyToken = req.query["hub.verify_token"];

    if (mode === "subscribe" && incomingVerifyToken === verifyToken) {
        console.log("[webhook][GET] Verification succeeded.");
        return res.status(200).send(challenge);
    }

    // IMPORTANT: always send a response. The original code left this branch
    // with no res.send()/res.end(), so a failed or malformed verification
    // request would hang until timeout instead of failing fast with 403.
    console.warn("[webhook][GET] Verification failed. mode:", mode);
    return res.sendStatus(403);
});

app.post("/webhook", async (req, res) => {
    if (!isValidSignature(req)) {
        console.warn("[webhook][POST] Invalid or missing signature — rejecting payload.");
        return res.sendStatus(401);
    }

    res.sendStatus(200); // ack immediately — Meta expects a fast 200 or it will retry/backoff

    try {
        const body_param = req.body;
        console.log("[webhook] RAW PAYLOAD:", JSON.stringify(body_param, null, 2));

        if (!body_param.object) {
            console.log("[webhook] No 'object' field — ignoring.");
            return;
        }

        const value = body_param.entry?.[0]?.changes?.[0]?.value;
        const message = value?.messages?.[0];

        if (!value || !message) {
            console.log("[webhook] No message in payload (likely a status update). Ignoring.");
            return;
        }

        const phon_no_id = value.metadata?.phone_number_id;
        const from = message.from;

        const result = await processIncomingMessage(message, from, phon_no_id);
        console.log("[webhook] Processing result:", JSON.stringify(result));

    } catch (err) {
        console.error("[webhook] UNEXPECTED ERROR:", err.response ? JSON.stringify(err.response.data, null, 2) : err.message);
    }
});

/** Manual simulate-reply route for testing without WhatsApp. */
app.get("/simulate-reply", async (req, res) => {
    const { type, optionId, text, from, phone_number_id: overridePhoneId } = req.query;
    const senderPhoneId = overridePhoneId || phone_number_id;

    if (!from) {
        return res.status(400).send("Missing 'from' query param (the number to reply to).");
    }

    let fakeMessage;
    if (type === "list_reply") {
        if (!optionId) return res.status(400).send("Missing 'optionId' query param.");
        fakeMessage = {
            type: "interactive",
            interactive: { type: "list_reply", list_reply: { id: optionId } }
        };
    } else if (type === "text") {
        fakeMessage = { type: "text", text: { body: text || "Hello" } };
    } else {
        return res.status(400).send("Invalid or missing 'type'. Use 'list_reply' or 'text'.");
    }

    try {
        const result = await processIncomingMessage(fakeMessage, from, senderPhoneId);
        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({
            status: "failed",
            error: error.response ? error.response.data : error.message
        });
    }
});

/** View all stored selections, most recent first. */
app.get("/selections", async (req, res) => {
    const { data, error } = await supabase
        .from("user_selections")
        .select("*")
        .order("created_at", { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    res.status(200).json(data);
});

/** View stored selections for one specific user. */
app.get("/selections/:from", async (req, res) => {
    const { data, error } = await supabase
        .from("user_selections")
        .select("*")
        .eq("from_number", req.params.from)
        .order("created_at", { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    res.status(200).json(data);
});

// Manually trigger a "Hi" + interactive options list to a specific number
app.get("/send-hi", async (req, res) => {
    const targetNumber = "919038580461";

    try {
        await sendText(targetNumber, "Hi");
        await sendOptionsList(targetNumber);
        res.status(200).send("Hi + options list sent to " + targetNumber);
    } catch (error) {
        res.status(500).send("Failed to send message — check server logs for details.");
    }
});

app.get("/", (req, res) => {
    res.status(200).send("hello this is webhook setup");
});