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
function sendWhatsAppMessage(data, senderPhoneId = phone_number_id) {
    return axios({
        method: "POST",
        url: "https://graph.facebook.com/v13.0/" + senderPhoneId + "/messages?access_token=" + token,
        data,
        headers: {
            "Content-Type": "application/json"
        }
    });
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

app.post("/webhook", (req, res) => {
    let body_param = req.body;

    console.log(JSON.stringify(body_param, null, 2));

    if (body_param.object) {
        console.log("inside body param");
        if (body_param.entry &&
            body_param.entry[0].changes &&
            body_param.entry[0].changes[0].value.messages &&
            body_param.entry[0].changes[0].value.messages[0]
        ) {
            let value = body_param.entry[0].changes[0].value;
            let phon_no_id = value.metadata.phone_number_id; // always use the ID from the incoming payload
            let message = value.messages[0];
            let from = message.from;

            console.log("phone number " + phon_no_id);
            console.log("from " + from);

            // Case 1: user tapped an option from the interactive list
            if (message.type === "interactive" &&
                message.interactive &&
                message.interactive.type === "list_reply") {

                let selectedId = message.interactive.list_reply.id;
                console.log("User selected option: " + selectedId);

                sendText(from, getOptionReply(selectedId), phon_no_id)
                    .then(r => console.log("Reply sent:", r.data))
                    .catch(err => console.error("Error sending option reply:", err.response ? err.response.data : err.message));

                return res.sendStatus(200);
            }

            // Case 2: normal text message
            if (message.text) {
                let msg_body = message.text.body;
                console.log("body param " + msg_body);

                sendText(from, "Hi.. I'm Prasath, your message is " + msg_body, phon_no_id)
                    .then(r => console.log("Reply sent:", r.data))
                    .catch(err => console.error("Error sending text reply:", err.response ? err.response.data : err.message));

                return res.sendStatus(200);
            }

            res.sendStatus(200);
        } else {
            res.sendStatus(404);
        }
    }
});

// Manually trigger a "Hi" + interactive options list to a specific number
app.get("/send-hi", async (req, res) => {
    const targetNumber = "919038580461";

    try {
        await sendText(targetNumber, "Hi");
        const listResponse = await sendOptionsList(targetNumber);

        console.log("Options list sent:", listResponse.data);
        res.status(200).send("Hi + options list sent to " + targetNumber);
    } catch (error) {
        console.error("Error sending message:", error.response ? error.response.data : error.message);
        res.status(500).send("Failed to send message");
    }
});

app.get("/", (req, res) => {
    res.status(200).send("hello this is webhook setup");
});