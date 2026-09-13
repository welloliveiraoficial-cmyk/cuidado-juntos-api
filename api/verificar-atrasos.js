/* =========================================================
   CUIDADO JUNTOS — API (Vercel)
   VERIFICAR ATRASOS
   Chamada periodicamente pelo GitHub Actions (a cada 10
   minutos). Verifica se algum dos 9 horários do dia passou
   30 minutos sem registro e, se sim, avisa todos os
   aparelhos da família — sem repetir o aviso do mesmo
   horário (controle pela coleção avisosAtraso).
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

const HORARIOS = [
  "08:00", "09:00", "10:00", "12:00", "16:00",
  "20:00", "21:00", "22:00", "00:00"
];

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

const MINUTOS_TOLERANCIA = 30;

/*
 * Pega a hora/minuto/data de agora já no fuso de Brasília,
 * sem depender do fuso do servidor da Vercel (que roda em
 * UTC por padrão).
 */

function agoraEmBrasilia() {

  const formatador = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });

  const partes = {};

  formatador.formatToParts(new Date()).forEach(function (parte) {
    partes[parte.type] = parte.value;
  });

  return {
    ano: parseInt(partes.year, 10),
    mes: parseInt(partes.month, 10),
    dia: parseInt(partes.day, 10),
    hora: parseInt(partes.hour, 10) === 24 ? 0 : parseInt(partes.hour, 10),
    minuto: parseInt(partes.minute, 10)
  };

}

/*
 * Mesma regra do app: horários antes das 06:00 pertencem
 * ao ciclo do dia anterior.
 */

function obterDataISOCiclo(agora) {

  const data = new Date(agora.ano, agora.mes - 1, agora.dia);

  if (agora.hora < 6) {
    data.setDate(data.getDate() - 1);
  }

  const ano = data.getFullYear();
  const mes = String(data.getMonth() + 1).padStart(2, "0");
  const dia = String(data.getDate()).padStart(2, "0");

  return `${ano}-${mes}-${dia}`;

}

/*
 * Minutos decorridos desde um horário fixo (ex: "08:00")
 * até agora, considerando o ciclo que começa às 06:00
 * (então 00:00 é tratado como 24:00 dentro do ciclo).
 */

function minutosDeAtraso(horario, agora) {

  const [hora, minuto] = horario.split(":").map(Number);

  let minutoHorario = hora * 60 + minuto;

  let minutoAgora = agora.hora * 60 + agora.minuto;

  if (minutoHorario < 360) {
    minutoHorario += 1440;
  }

  if (minutoAgora < 360) {
    minutoAgora += 1440;
  }

  return minutoAgora - minutoHorario;

}

module.exports = async function handler(req, res) {

  const chaveRecebida = req.headers["x-api-key"];

  if (!chaveRecebida || chaveRecebida !== process.env.API_SECRET) {
    res.status(401).json({ erro: "Não autorizado" });
    return;
  }

  try {

    const agora = agoraEmBrasilia();

    const dataISO = obterDataISOCiclo(agora);

    const snapshotRegistros = await db.collection("registros")
      .where("dataISO", "==", dataISO)
      .get();

    const registrados = new Set();

    snapshotRegistros.forEach(function (docSnap) {

      const dado = docSnap.data();

      if (dado && dado.horario) {
        registrados.add(dado.horario);
      }

    });

    const atrasados = HORARIOS.filter(function (horario) {

      if (registrados.has(horario)) {
        return false;
      }

      return minutosDeAtraso(horario, agora) >= MINUTOS_TOLERANCIA;

    });

    if (atrasados.length === 0) {
      res.status(200).json({ avisados: [] });
      return;
    }

    let tokensCache = null;

    const avisadosAgora = [];

    for (const horario of atrasados) {

      const idAviso = `${dataISO}_${horario.replace(":", "-")}`;

      const refAviso = db.collection("avisosAtraso").doc(idAviso);

      const jaAvisado = await refAviso.get();

      if (jaAvisado.exists) {
        continue;
      }

      if (!tokensCache) {

        const snapshotDispositivos = await db.collection("dispositivos").get();

        tokensCache = [];

        snapshotDispositivos.forEach(function (docSnap) {
          tokensCache.push(docSnap.id);
        });

      }

      if (tokensCache.length > 0) {

        const remedios = MEDICAMENTOS[horario];

        const listaRemedios = Array.isArray(remedios) && remedios.length
          ? remedios.join(", ")
          : "medicamento";

        const mensagem = {
          notification: {
            title: "Cuidado Juntos ⏰",
            body: `O horário das ${horario} (${listaRemedios}) ainda não foi registrado.`
          },
          tokens: tokensCache
        };

        await admin.messaging().sendEachForMulticast(mensagem);

      }

      await refAviso.set({
        criadoEm: admin.firestore.FieldValue.serverTimestamp()
      });

      avisadosAgora.push(horario);

    }

    res.status(200).json({ avisados: avisadosAgora });

  } catch (erro) {

    console.error("Erro ao verificar atrasos:", erro);

    res.status(500).json({ erro: "Erro ao verificar atrasos" });

  }

};
    
