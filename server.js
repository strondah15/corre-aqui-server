const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const admin = require("firebase-admin");
const { MercadoPagoConfig, Preference, Payment } = require("mercadopago");

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const serviceAccount = require("./serviceAccountKey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DB_URL,
});

const db = admin.database();

const mpClient = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN,
});

const preference = new Preference(mpClient);
const paymentClient = new Payment(mpClient);

const PLANOS = {
  pro: {
    title: "Plano Pro - Corre Aqui",
    price: 19.9,
  },
  ultra: {
    title: "Plano Ultra - Corre Aqui",
    price: 39.9,
  },
};

app.get("/", (req, res) => {
  res.send("Corre Aqui Server rodando 🚀");
});

app.post("/api/planos/checkout", async (req, res) => {
  try {
    const { uid, plano } = req.body;

    if (!uid || !plano || !PLANOS[plano]) {
      return res.status(400).json({ error: "uid ou plano inválido" });
    }

    const planoInfo = PLANOS[plano];

    const result = await preference.create({
      body: {
        items: [
          {
            title: planoInfo.title,
            quantity: 1,
            unit_price: planoInfo.price,
            currency_id: "BRL",
          },
        ],
        external_reference: `${uid}:${plano}`,
        notification_url: `${process.env.SERVER_URL}/api/mercadopago/webhook`,
        back_urls: {
          success: process.env.FRONTEND_URL || "http://localhost:3000",
          failure: process.env.FRONTEND_URL || "http://localhost:3000",
          pending: process.env.FRONTEND_URL || "http://localhost:3000",
        },
        auto_return: "approved",
      },
    });

    return res.json({
      id: result.id,
      init_point: result.init_point,
      sandbox_init_point: result.sandbox_init_point,
    });
  } catch (err) {
    console.error("Erro ao criar checkout:", err);
    return res.status(500).json({ error: "erro ao criar checkout" });
  }
});

app.post("/api/mercadopago/webhook", async (req, res) => {
  try {
    const topic = req.query.topic || req.body.type;
    const paymentId = req.query.id || req.body?.data?.id;

    if (topic !== "payment" || !paymentId) {
      return res.sendStatus(200);
    }

    const pagamento = await paymentClient.get({ id: paymentId });

    if (pagamento.status !== "approved") {
      return res.sendStatus(200);
    }

    const external = pagamento.external_reference || "";
    const [uid, plano] = external.split(":");

    if (!uid || !plano || !PLANOS[plano]) {
      console.log("external_reference inválido:", external);
      return res.sendStatus(200);
    }

    await db.ref(`users/${uid}`).update({
      plano,
      planoAtivo: true,
      planoAtualizadoEm: Date.now(),
      planoOrigem: "mercado_pago",
      ultimoPagamentoId: String(paymentId),
    });

    console.log(`✅ Plano ${plano} ativado para ${uid}`);

    return res.sendStatus(200);
  } catch (err) {
    console.error("Erro no webhook:", err);
    return res.sendStatus(500);
  }
});

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT} 🚀`);
});
