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

/*
 * CORS
 * O site (GitHub Pages) e esta API (Vercel) ficam em
 * domínios diferentes, então o navegador manda uma
 * requisição "OPTIONS" de verificação antes do POST de
 * verdade (preflight). Sem responder a ela com os
 * cabeçalhos corretos, o navegador cancela o POST real
 * e a notificação nunca chega a ser enviada.
 */

function aplicarCORS(req, res) {

  res.setHeader("Access-Control-Allow-Origin", "*");

  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");

  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-api-key");

}

module.exports = async function handler(req, res) {

  aplicarCORS(req, res);

  /*
   * Requisição de verificação do navegador: responder
   * "ok" sem exigir autenticação nem rodar nenhuma lógica.
   */

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

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

    /*
     * IMPORTANTE: mandamos só "data" (não "notification").
     * Se mandássemos "notification", o Chrome/Android exibe
     * um aviso automático genérico por conta própria, ALÉM
     * do aviso que o nosso sw.js mostra manualmente — daí a
     * notificação aparecia duplicada. Com "data", só o nosso
     * código (com o ícone certo) exibe o aviso.
     */

    const mensagem = {
      android: {
        priority: "high"
      },
      data: {
        title: "Cuidado Juntos",
        body: `${nome || "Alguém"} deu o remédio das ${horario}.`
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
