const express = require("express");
const body_parser = require("body-parser");
const axios = require("axios");
require('dotenv').config();

const app = express().use(body_parser.json());

const token = process.env.TOKEN;
const mytoken = process.env.MYTOKEN; //pratham_token
const phone_number_id = process.env.PHONE_NUMBER_ID; // <-- needed for the new route

app.listen(process.env.PORT, () => {
    console.log("webhook is listening");
});

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
            let phon_no_id = body_param.entry[0].changes[0].value.metadata.phone_number_id;
            let from = body_param.entry[0].changes[0].value.messages[0].from;
            let msg_body = body_param.entry[0].changes[0].value.messages[0].text.body;

            console.log("phone number " + phon_no_id);
            console.log("from " + from);
            console.log("boady param " + msg_body);

            axios({
                method: "POST",
                url: "https://graph.facebook.com/v13.0/" + phon_no_id + "/messages?access_token=" + token,
                data: {
                    messaging_product: "whatsapp",
                    to: from,
                    text: {
                        body: "Hi.. I'm Prasath, your message is " + msg_body
                    }
                },
                headers: {
                    "Content-Type": "application/json"
                }
            });

            res.sendStatus(200);
        } else {
            res.sendStatus(404);
        }
    }
});

// NEW ROUTE: manually trigger a "Hi" message to a specific number
app.get("/send-hi", async (req, res) => {
    const targetNumber = "919038580461";

    try {
        const response = await axios({
            method: "POST",
            url: "https://graph.facebook.com/v13.0/" + phone_number_id + "/messages?access_token=" + token,
            data: {
                messaging_product: "whatsapp",
                to: targetNumber,
                text: {
                    body: "Hi"
                }
            },
            headers: {
                "Content-Type": "application/json"
            }
        });

        console.log("Message sent:", response.data);
        res.status(200).send("Message sent to " + targetNumber);
    } catch (error) {
        console.error("Error sending message:", error.response ? error.response.data : error.message);
        res.status(500).send("Failed to send message");
    }
});

app.get("/", (req, res) => {
    res.status(200).send("hello this is webhook setup");
});