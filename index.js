const express = require("express");
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require("@whiskeysockets/baileys");
const QRCode = require("qrcode");
const P = require("pino");

const app = express();
app.use(express.json());

let sock, lastQR = null, status = "waiting", me = null;
const chats = new Map(); // id -> { id, name, lastMessage, timestamp, unread }
const messages = new Map(); // id -> [ {id, fromMe, body, timestamp} ]

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState("./auth");
  sock = makeWASocket({ auth: state, printQRInTerminal: false, logger: P({ level: "silent" }) });
  sock.ev.on("creds.update", saveCreds);
  sock.ev.on("connection.update", (u) => {
    if (u.qr) lastQR = u.qr;
    if (u.connection === "open") { status = "connected"; me = sock.user; }
    if (u.connection === "close" && u.lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut) start();
  });
  sock.ev.on("messages.upsert", ({ messages: msgs }) => {
    for (const m of msgs) {
      const jid = m.key.remoteJid;
      const name = m.pushName || jid.split("@")[0];
      chats.set(jid, { id: jid, name, lastMessage: m.message?.conversation || "[mensagem]", timestamp: new Date().toLocaleTimeString("pt-BR").slice(0,5), unread: (chats.get(jid)?.unread||0)+1 });
      const arr = messages.get(jid) || [];
      arr.push({ id: m.key.id, fromMe: m.key.fromMe, body: m.message?.conversation || "[mídia]", timestamp: new Date().toLocaleTimeString("pt-BR").slice(0,5) });
      messages.set(jid, arr);
    }
  });
}
start();

app.get("/status", (req, res) => res.json({ status, name: me?.name || me?.pushName || null, phone: me?.id?.split(":")[0] || null }));
app.get("/qr", async (req, res) => res.json({ qr: lastQR ? await QRCode.toDataURL(lastQR) : null, status }));
app.get("/chats", (req, res) => res.json([...chats.values()]));
app.get("/messages/:jid", (req, res) => res.json(messages.get(decodeURIComponent(req.params.jid)) || []));
app.post("/send", async (req, res) => {
  try { await sock.sendMessage(req.body.chatId, { text: req.body.text }); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("WA bridge na porta " + PORT))