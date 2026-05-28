const axios = require("axios");

async function sendPush(tokens, title, body) {
  if (!tokens || !tokens.length) return;

  const messages = tokens.map(token => ({
    to: token,
    sound: "default",
    title,
    body,
  }));

  try {
    await axios.post("https://exp.host/--/api/v2/push/send", messages);
  } catch (err) {
    console.log("Push error:", err.response?.data || err.message);
  }
}

module.exports = { sendPush };