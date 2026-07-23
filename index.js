const express = require("express");
const body_parser = require("body-parser");
const axios = require("axios");
require('dotenv').config();

const app = express().use(body_parser.json());

const token = process.env.TOKEN;
const mytoken = process.env.MYTOKEN; //pratham_token
const phone_number_id = process.env.PHONE_NUMBER_ID; // fallback, used for routes not triggered by webhook

app.listen(process.env.PORT, () => {
    console.log("webhook is listening");
});

/** Core sender - posts any message payload to the WhatsApp Cloud API. */
async function sendWhatsAppMessage(data, senderPhoneId = phone_number_id) {
    try {
        const response = await axios({
            method: "POST",
            url: "https://graph.facebook.com/v13.0/" + senderPhoneId + "/messages?access_token=" + token,
            data,
            headers: {
                "Content-Type": "application/json"
            }
        });
        console.log("[sendWhatsAppMessage] SUCCESS:", JSON.stringify(response.data));
        return response;
    } catch (error) {
        // This is the most important log in the whole file right now.
        // error.response.data contains WhatsApp's exact reason for rejecting the request.
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

//to verify the callback url from dashboard side - cloud api side
app.get("/webhook", (req, res) => {
    let mode = req.query["hub.mode"];
    let challange = req.query["hub.challenge"];
    let token = req.query["hub.verify_token"];

    if (mode && token) {
        if (mode === "subscribe" && token === mytoken) {
            res.status(200).send(challange);
        } else {
            res.status(403);
        }
    }
});

app.post("/webhook", async (req, res) => {
    // Respond to WhatsApp immediately so it never times out / retries mid-processing.
    res.sendStatus(200);

    try {
        let body_param = req.body;
        console.log("[webhook] RAW PAYLOAD:", JSON.stringify(body_param, null, 2));

        if (!body_param.object) {
            console.log("[webhook] No 'object' field — ignoring payload.");
            return;
        }

        // Use optional chaining so a shape mismatch logs instead of crashing.
        const value = body_param.entry?.[0]?.changes?.[0]?.value;
        const message = value?.messages?.[0];

        if (!value || !message) {
            console.log("[webhook] No message found in payload (likely a status update, e.g. 'delivered'/'read'). Ignoring.");
            return;
        }

        const phon_no_id = value.metadata?.phone_number_id;
        const from = message.from;

        console.log("[webhook] phone_number_id:", phon_no_id);
        console.log("[webhook] from:", from);
        console.log("[webhook] message.type:", message.type);
        console.log("[webhook] full message object:", JSON.stringify(message, null, 2));

        // Case 1: user tapped an option from the interactive list
        if (message.type === "interactive") {
            const interactiveType = message.interactive?.type;
            console.log("[webhook] interactive.type:", interactiveType);

            if (interactiveType === "list_reply") {
                const selectedId = message.interactive.list_reply?.id;
                console.log("[webhook] User selected option id:", selectedId);

                await sendText(from, getOptionReply(selectedId), phon_no_id);
                console.log("[webhook] Option reply sent successfully.");
                return;
            }

            console.log("[webhook] Interactive message received but type wasn't 'list_reply':", interactiveType);
            return;
        }

        // Case 2: normal text message
        if (message.type === "text" && message.text) {
            const msg_body = message.text.body;
            console.log("[webhook] Incoming text body:", msg_body);

            await sendText(from, "Hi.. I'm Prasath, your message is " + msg_body, phon_no_id);
            console.log("[webhook] Text reply sent successfully.");
            return;
        }

        console.log("[webhook] Unhandled message type — nothing sent:", message.type);

    } catch (err) {
        // Catch-all so nothing dies silently.
        console.error("[webhook] UNEXPECTED ERROR:", err.response ? JSON.stringify(err.response.data, null, 2) : err.message);
    }
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