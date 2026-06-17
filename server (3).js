// server.js — Agente WhatsApp bilingue (IT / RU) con Claude
// Risponde in automatico alle domande frequenti dei clienti.
// Deploy su Railway: genera un dominio pubblico e usalo come webhook (nessun dominio da comprare).

import express from "express";

const app = express();
app.use(express.json());

// ====== CONFIG — variabili d'ambiente su Railway (scheda Variables) ======
const WHATSAPP_TOKEN  = process.env.WHATSAPP_TOKEN;     // token generato su Meta
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;    // ID del numero, da Meta (es. 1185066678018992)
const VERIFY_TOKEN    = process.env.VERIFY_TOKEN;       // parola a tua scelta (la stessa che metti su Meta)
const ANTHROPIC_KEY   = process.env.ANTHROPIC_API_KEY;  // chiave API di Claude
const GRAPH = "https://graph.facebook.com/v21.0";

// ====== MEMORIA CONVERSAZIONI (in RAM: si azzera ad ogni riavvio) ======
const conversations = new Map();   // numero cliente -> [{role, content}, ...]
const MAX_TURNS = 12;              // quanti messaggi tenere a mente per cliente

// ====== IL PROMPT: QUI METTI TUTTO ======
// Personalizza SOLO questa parte: nome attività, servizi, orari e le risposte alle domande frequenti.
const SYSTEM_PROMPT = `
Sei l'assistente virtuale di [NOME ATTIVITÀ]. Rispondi ai clienti su WhatsApp al posto della titolare.

LINGUA
- Rileva la lingua del cliente e rispondi SEMPRE nella stessa lingua: italiano o russo.
- Se il cliente scrive in russo → rispondi in russo. Se scrive in italiano → rispondi in italiano.
- Tono: cordiale, professionale, conciso. Frasi brevi (è una chat).

COSA FAI
- Rispondi alle domande più frequenti dei clienti su servizi, orari, modalità e informazioni.
- Usa solo le informazioni qui sotto. Non inventare nulla che non sia scritto.
- Se non sai rispondere o la richiesta è particolare/fuori ambito, NON improvvisare:
  scrivi gentilmente che la titolare ricontatterà a breve.

INFORMAZIONI SULL'ATTIVITÀ
- Servizi: [descrivi i servizi]
- Orari: [inserisci gli orari]
- Indirizzo / zona: [inserisci]
- Altre info utili: [aggiungi qui]

DOMANDE FREQUENTI (FAQ)
- D: [domanda tipica 1]
  R: [risposta 1]
- D: [domanda tipica 2]
  R: [risposta 2]
- D: [domanda tipica 3]
  R: [risposta 3]
  (aggiungi qui tutte le FAQ che vuoi)

REGOLE
- Non prendere impegni vincolanti (date certe, prezzi non indicati, sconti).
- Non chiedere dati sensibili (documenti, pagamenti) in chat.
- Per richieste fuori ambito: "Passo la tua richiesta alla titolare, ti ricontatterà al più presto."
`.trim();

// ====== VERIFICA WEBHOOK (Meta lo chiama in GET una volta, in fase di setup) ======
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// ====== RICEZIONE MESSAGGI ======
app.post("/webhook", async (req, res) => {
  res.sendStatus(200); // rispondi SUBITO a Meta, poi elabora
  try {
    const value = req.body.entry?.[0]?.changes?.[0]?.value;
    const msg = value?.messages?.[0];
    if (!msg || msg.type !== "text") return; // gestiamo solo testo

    const from = msg.from;          // numero del cliente
    const text = msg.text.body;

    const history = conversations.get(from) || [];
    history.push({ role: "user", content: text });

    const reply = await askClaude(history);

    history.push({ role: "assistant", content: reply });
    conversations.set(from, history.slice(-MAX_TURNS));

    await sendWhatsApp(from, reply);
  } catch (e) {
    console.error("Errore gestione messaggio:", e);
  }
});

// ====== CHIAMATA A CLAUDE ======
async function askClaude(messages) {
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001", // economico e veloce; per più qualità: "claude-sonnet-4-6"
        max_tokens: 600,
        system: SYSTEM_PROMPT,
        messages,
      }),
    });
    const data = await r.json();
    return data.content?.[0]?.text?.trim()
        || "Mi scuso, c'è stato un problema. Riprova tra poco.";
  } catch (e) {
    console.error("Errore Claude:", e);
    return "Mi scuso, c'è stato un problema. Riprova tra poco.";
  }
}

// ====== INVIO MESSAGGIO WHATSAPP ======
async function sendWhatsApp(to, body) {
  await fetch(`${GRAPH}/${PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${WHATSAPP_TOKEN}`,
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body },
    }),
  });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Agente WhatsApp attivo sulla porta ${PORT}`));
