const { makeWASocket, useMultiFileAuthState, downloadMediaMessage, delay, getContentType } = require("@whiskeysockets/baileys");
const { waMessageID } = require("@whiskeysockets/baileys/lib/Store/make-in-memory-store");
const pino = require("pino");
const { error } = require("qrcode-terminal");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const dotenv = require("dotenv").config();
const genAI = new GoogleGenerativeAI(process.env.API_KEY);
const { Sticker, StickerTypes } = require("wa-sticker-formatter");
const { ppid } = require("process");

async function connectWhatsapp() {
  const auth = await useMultiFileAuthState("session");
  const sock = makeWASocket({
    printQRInTerminal: true,
    browser: ["SAM ASSISTANT", "Safari", "1.0.0"],
    auth: auth.state,
    logger: pino({ level: "silent" }),
    generateHighQualityLinkPreview: true,
  });

  sock.ev.on("creds.update", auth.saveCreds);
  sock.ev.on("connection.update", async ({ connection }) => {
    if (connection === "close") {
      await connectWhatsapp();
    } else if (connection === "open") {
      console.log("Connected to", sock.user.id.split(":")[0]);
    }
  });

  async function reply(Id, text, quoted = false, reactions = false, editMsg = false, mention = false) {
    await delay(2500);
    let messageObj = { text: text };

    if (editMsg) {
      messageObj.edit = editMsg.key;
    }

    if (mention) {
      messageObj.mentions = mention;
    }
    const sentMessage = await sock.sendMessage(Id, messageObj, quoted ? { quoted: quoted } : {});

    if (reactions) return;
    await delay(2500);
    sock.sendMessage(Id, { react: { text: "🤖", key: sentMessage.key } });
  }

  async function getBuffer(msg) {
    const buffer = await downloadMediaMessage(msg, "buffer", {}, { pino, reuploadRequest: sock.updateMediaMessage });

    return buffer;
  }

  async function generateAi(msg) {
    const model = genAI.getGenerativeModel({ model: "gemini-pro" });
    const prompt = msg;
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    return text;
  }

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    const message = messages[0];
    const Id = message.key.remoteJid;
    const isMe = message.key.fromMe;
    const isGroup = Id.includes("@g.us");
    let cmd = message.message?.conversation || message.message?.extendedTextMessage?.text || message.message?.imageMessage?.caption || "";
    cmd = cmd.toLowerCase();

    if (!cmd.startsWith(".")) return;
    try {
      match = cmd.match(/\.(\w+)\s*(.*)/);
      cmd = match[1];
      var msgCmd = match[2];
    } catch (error) {
      console.log("[ERROR]", { cmdErr: error.message });
    }

    if (message?.message?.extendedTextMessage?.contextInfo?.quotedMessage) {
      try {
        var quoted = message.message?.extendedTextMessage?.contextInfo?.quotedMessage || {};
        var quotedMime = getContentType(quoted);
        var quotedViewOnce = quoted[quotedMime]?.message || {};
        var quotedViewOnceMime = getContentType(quoted[quotedMime].message);
        var quotedViewOnceMimeType = quotedViewOnce[quotedViewOnceMime]?.mimetype;
      } catch (error) {
        console.log("[ERROR]", { quotedErr: error.message });
      }
    }

    if (!isMe) return;
    switch (cmd) {
      case "see":
        try {
          reply(Id, "Getting media message...", false, true, message);
          const mediaBuffer = { message: quoted };
          const buffer = await getBuffer(mediaBuffer);
          const mediaData = Buffer.from(buffer.toString("base64"), "base64");
          const sentMessage = { [quotedViewOnceMime.split("Message")[0]]: mediaData, mimetype: quotedViewOnceMimeType };
          if (quotedViewOnceMime === "audioMessage") {
            message.ptt = true;
          }
          await sock.sendMessage(Id, sentMessage);
          reply(Id, "Successfully get the media message", false, true, message);
          console.log("[BOT] cmd:.steal from", Id.split("@")[0]);
        } catch (error) {
          console.log("[ERROR]", { stealErr: error.message });
        }
        break;

      case "ai":
        try {
          reply(Id, "waitt..", false, true, message);
          const prompt = await generateAi(msgCmd).catch((error) => {
            reply(Id, `[ERROR] ${error.message}`, false, true, message);
            return console.log("[ERROR]", { aiErr: error.message });
          });
          reply(Id, `Powered by *Gemini AI*\n\n*AI Prompt :* \`\`\`${msgCmd}\`\`\`\n\n${prompt}`, false, false, message);
          console.log("[BOT] cmd:.ai from", Id.split("@")[0]);
        } catch (error) {
          console.log("[ERROR]", { aiErr: error.message });
        }
        break;

      case "sticker":
        try {
          reply(Id, "Converting to sticker...", false, true, message);
          let mediaBuffer = quoted ? { message: quoted } : message;
          let buffer = await getBuffer(mediaBuffer);
          const sticker = await new Sticker(buffer, {
            author: "Sticker",
            pack: "BOT",
            type: StickerTypes.FULL,
            categories: ["🤩", "🎉"],
            id: "22222",
            quality: 70,
            background: "transparent",
          }).build();
          sock.sendMessage(Id, { sticker });
          reply(Id, "Successfully convert media to sticker", false, true, message);
          console.log("[BOT] cmd:.sticker from", Id.split("@")[0]);
        } catch (error) {
          reply(Id, `[ERROR] ${error.message}`, message, true, message);
          console.log("[ERROR]", { stickerErr: error.message });
        }
        break;

      case "pp":
        let pp, ppId;
        try {
          reply(Id, "Getting profile picture...", false, true, message);
          pp = msgCmd.replace(/\D/g, "");
          ppId = pp + "@s.whatsapp.net";
          const ppUrl = await sock.profilePictureUrl(ppId, "image");
          await sock.sendMessage(Id, { image: { url: ppUrl } });
          reply(Id, `Successfully get profile picture @${pp}`, false, true, message, [ppId]);
          console.log("[BOT] cmd:.pp from", Id.split("@")[0]);
        } catch (error) {
          console.log("[ERROR]", { ppErr: error.message });
          reply(Id, `No profile picture @${pp}`, false, true, message, [ppId]);
        }
        break;

      case "gpp":
        try {
          reply(Id, "Getting profile picture...", false, true, message);
          const ppUrl = await sock.profilePictureUrl(Id, "image");
          await sock.sendMessage(Id, { image: { url: ppUrl } });
          reply(Id, "Successfully get profile picture", false, true, message);
          console.log("[BOT] cmd:.gpp from", Id.split("@")[0]);
        } catch (error) {
          console.log("[ERROR]", { ppErr: error.message });
        }
        break;
    }

    if (!isMe && isGroup) return;
    switch (cmd) {
      case "tagall":
        try {
          const metadata = await sock.groupMetadata(Id);
          const participants = metadata.participants.map((v) => v.id);
          reply(Id, "PING!!!", false, false, message, participants);
          console.log("[BOT] cmd:.tagall from", Id.split("@")[0]);
        } catch (error) {
          console.log("[ERROR]", { tagallErr: error.message });
        }
        break;

      case "tag":
        try {
          const metadata = await sock.groupMetadata(Id);
          const participants = metadata.participants.map((v) => v.id);
          reply(Id, msgCmd, false, false, message, participants)
          console.log("[BOT] cmd:.tag from", Id.split("@")[0]);
        } catch (error) {
          console.log("[ERROR]", { tagErr: error.message });
        }
        break;

      case "rm":
        try {
          let no = msgCmd.split(" ");
          let noMsg = no.join(", ");
          no = no.map((no) => no.replace("@", "") + "@s.whatsapp.net");
          reply(Id, `Successfully remove ${noMsg}`, false, true, message, no);
          const response = await sock.groupParticipantsUpdate(Id, no, "remove");
          if (response[0].status === "200") return console.log(`[BOT] cmd:.rm ${no} from`, Id.split("@"));
        } catch (error) {
          console.log("[ERROR]", { rmErr: error.message });
        }
        break;

      case "add":
        try {
          let no = msgCmd.replace(/\D/g, "");
          let noId = no + "@s.whatsapp.net";
          reply(Id, `Successfully add @${no}`, false, true, message, [noId]);
          const response = await sock.groupParticipantsUpdate(Id, [noId], "add");
          if (response[0].status === "200") return console.log(`[BOT] cmd:.add ${no} from`, Id.split("@")[0]);
        } catch (error) {
          console.log("[ERROR]", { addErr: error.message });
        }
        break;

      case "promote":
        try {
          let no = msgCmd.split(" ");
          let noMsg = no.join(", ");
          no = no.map((no) => no.replace("@", "") + "@s.whatsapp.net");
          reply(Id, `Successfully promote ${noMsg}`, false, true, message, no);
          const response = await sock.groupParticipantsUpdate(Id, no, "promote");
          if (response[0].status === "200") return console.log(`[BOT] cmd:.promote ${no} from`, Id.split("@")[0]);
        } catch (error) {
          console.log("[ERROR]", { promoteErr: error.message });
        }
        break;

      case "demote":
        try {
          let no = msgCmd.split(" ");
          let noMsg = no.join(", ");
          no = no.map((no) => no.replace("@", "") + "@s.whatsapp.net");
          reply(Id, `Successfully demote ${noMsg}`, false, true, message, no);
          const response = await sock.groupParticipantsUpdate(Id, no, "demote");
          if (response[0].status === "200") return console.log(`[BOT] cmd:.demote ${no} from`, Id.split("@")[0]);
        } catch (error) {
          console.log("[ERROR]", { demoteErr: error.message });
        }
        break;
    }

    // switch (type) {
    //   case "append":
    //     console.log("INI APPEND\n", message);
    //     break;
    //   case "notify":

    //     const a = await getBuffer(msg);
    //     console.log(message);
    //     console.log(a);

    //     break;
    // }
  });

  // sock.ev.on("call", async (calls) => {
  //   let call = calls[0];
  //   let number = call.from.split("@")[0];

  //   if (!("status" in call && "isGroup" in call && "isVideo" in call)) return;

  //   const WACallEvent = {
  //     status: call.status,
  //     from: call.from,
  //   };

  //   switch (WACallEvent.status) {
  //     case "ringing":
  //       console.log("[BOT] Ringing Call from", number);
  //       call.status = false;
  //       break;
  //     case "timeout":
  //       console.log("[BOT] Missed Call from", number);
  //       reply(WACallEvent.from, "Maaf, saat ini Samuel tidak dapat dihubungi. Silakan tinggalkan pesan Anda.\nTerimakasih.");
  //       break;
  //     case "reject":
  //       console.log("[BOT] Rijected Call from", number);
  //       reply(WACallEvent.from, "Maaf, saat ini Samuel tidak dapat dihubungi. Silakan tinggalkan pesan Anda.\nTerimakasih.");
  //       break;
  //     case "accept":
  //       console.log("[BOT] Accepted Cal from", number);
  //       await delay(1000);
  //       call.status = false;
  //       break;
  //   }
  // });
}

connectWhatsapp();
