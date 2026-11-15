// Anúncio recompensado (o jogador escolhe assistir pra ganhar um prêmio).
//
// No app (Capacitor) usa o AdMob (@capacitor-community/admob). Na web não tem anúncio
// por enquanto (precisa de aprovação do Google pra jogos HTML5). No servidor local
// (localhost) um "vídeo de teste" simulado deixa testar o fluxo sem celular.
//
// IMPORTANTE: os IDs abaixo são os IDs DE TESTE do Google (mostram anúncio de mentira).
// Antes de publicar, troque pelos IDs do seu app no AdMob, aqui e em
// android/app/src/main/AndroidManifest.xml e ios/App/App/Info.plist.
const ID_TESTE = { android: 'ca-app-pub-3940256099942544/5224354917', ios: 'ca-app-pub-3940256099942544/1712485313' };
const ID_RECOMPENSADO = ID_TESTE;
const EM_TESTE = true;

const C = window.Capacitor;
const nativo = !!C?.isNativePlatform?.();
const plataforma = C?.getPlatform?.() || 'web';
const AdMob = nativo ? (C.Plugins?.AdMob || C.registerPlugin?.('AdMob')) : null;
const simulado = !nativo && location.hostname === 'localhost';
let pronto = false;

export async function iniciar() {
  if (!AdMob) return;
  try {
    if (plataforma === 'ios') {
      const { status } = await AdMob.trackingAuthorizationStatus();
      if (status === 'notDetermined') await AdMob.requestTrackingAuthorization();
    }
    await AdMob.initialize({ initializeForTesting: EM_TESTE });
    pronto = true;
  } catch { pronto = false; }
}

export function disponivel() { return (AdMob && pronto) || simulado; }

// Mostra o vídeo; resolve true se o jogador assistiu até o fim (ganha o prêmio).
export async function assistir() {
  if (simulado) return simular();
  if (!AdMob || !pronto) return false;
  try {
    await AdMob.prepareRewardVideoAd({ adId: ID_RECOMPENSADO[plataforma] || ID_RECOMPENSADO.android, isTesting: EM_TESTE });
    const premio = await AdMob.showRewardVideoAd();
    return !!premio;
  } catch { return false; }
}

function simular() {
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = 'video-teste';
    el.innerHTML = '<div><b>Vídeo de teste</b><span>O anúncio de verdade aparece no app. Termina em <i>3</i>s…</span></div>';
    document.body.appendChild(el);
    let n = 3;
    const t = setInterval(() => { n--; el.querySelector('i').textContent = n; if (n <= 0) { clearInterval(t); el.remove(); resolve(true); } }, 1000);
  });
}
