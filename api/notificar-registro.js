/* =========================================================
   CUIDADO JUNTOS — API (Vercel)
   NOTIFICAR REGISTRO
   Chamada pelo próprio app (script.js) logo depois que
   alguém registra um horário. Envia notificação push de
   verdade (via Firebase Cloud Messaging) para todos os
   outros aparelhos da família, mesmo com o app fechado.
   Não depende do plano Blaze: usa o Firebase Admin SDK,
   que funciona no plano gratuito (Spark).
========================================================= */

const admin = require("firebase-admin");

if (!admin.apps.length) {

  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n")
    })
  });

}

const db = admin.firestore();

const MEDICAMENTOS = {
  "08:00": ["Sertralina", "Levetiracetam"],
  "09:00": ["Losartana", "Quetiapina"],
  "10:00": ["Clopidogrel"],
  "12:00": ["Rivaroxabana"],
  "16:00": ["Levetiracetam"],
  "20:00": ["Atorvastatina"],
  "21:00": ["Losartana", "Quetiapina"],
  "22:00": ["Clonazepam"],
  "00:00": ["Levetiracetam"]
};

module.exports = async function handler(req, res) {

  if (req.method !== "POST") {
    res.status(405).json({ erro: "Método não permitido" });
    return;
  }

  const chaveRecebida = req.headers["x-api-key"];

  if (!chaveRecebida || chaveRecebida !== process.env.API_SECRET) {
    res.status(401).json({ erro: "Não autorizado" });
    return;
  }

  const { horario, nome, tokenRemetente } = req.body || {};

  if (!horario) {
    res.status(400).json({ erro: "Horário não informado" });
    return;
  }

  try {

    const snapshot = await db.collection("dispositivos").get();

    const tokens = [];

    snapshot.forEach(function (docSnap) {

      if (docSnap.id !== tokenRemetente) {
        tokens.push(docSnap.id);
      }

    });

    if (tokens.length === 0) {
      res.status(200).json({ enviados: 0 });
      return;
    }

    const remedios = MEDICAMENTOS[horario];

    const listaRemedios = Array.isArray(remedios) && remedios.length
      ? remedios.join(", ")
      : "medicamento";

    const mensagem = {
      notification: {
        title: "Cuidado Juntos",
        body: `${nome || "Alguém"} registrou ${listaRemedios} das ${horario}.`
      },
      tokens: tokens
    };

    const resposta = await admin.messaging().sendEachForMulticast(mensagem);

    /*
     * Remove automaticamente tokens inválidos (ex: app
     * desinstalado, notificação revogada pelo usuário).
     */

    resposta.responses.forEach(function (item, indice) {

      if (!item.success) {

        db.collection("dispositivos")
          .doc(tokens[indice])
          .delete()
          .catch(function () {});

      }

    });

    res.status(200).json({ enviados: resposta.successCount });

  } catch (erro) {

    console.error("Erro ao enviar notificação:", erro);

    res.status(500).json({ erro: "Erro ao enviar notificação" });

  }

};
