import os
import sys
import json
import time
import asyncio
import websockets

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import bridge_server

if sys.platform == "win32":
    sys.stdin.reconfigure(encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

WS_URI = f"ws://{bridge_server.WS_HOST}:{bridge_server.WS_PORT}"


async def run_t6_via_existing_server():
    """Mevcut çalışan bridge_server üzerinden uçtan uca testi yürütür."""
    print(f"[T6] Aktif çalışan köprü sunucusuna bağlanılıyor: {WS_URI}...", flush=True)
    async with websockets.connect(WS_URI) as ws:
        # Test kontrol istemcisi olarak kaydol
        await ws.send(json.dumps({"type": "REGISTER_TEST_CLIENT"}))
        ack_raw = await ws.recv()
        ack = json.loads(ack_raw)
        if ack.get("type") != "TEST_CLIENT_ACK":
            raise RuntimeError(f"Beklenmeyen ACK yanıtı: {ack_raw}")
        print("✓ Köprü sunucusuna test kontrolcüsü olarak bağlanıldı.", flush=True)

        test_prompt = "Köprü bağlantı testi. Yalnızca KOPRU_E2E_BASARILI yaz."
        print(f"\n[T6] ChatGPT'ye gönderilecek test mesajı: '{test_prompt}'", flush=True)
        print("[T6] ChatGPT yanıtı bekleniyor (Tarayıcı logları köprü sunucusundan izleniyor)...\n", flush=True)

        start_time = time.time()
        await ws.send(json.dumps({
            "type": "TRIGGER_E2E_PROMPT",
            "prompt": test_prompt,
            "asama": "E2E_TEST"
        }))

        result_raw = await ws.recv()
        duration = round(time.time() - start_time, 2)
        result_data = json.loads(result_raw)
        response_text = result_data.get("response", "")

        return response_text, duration


async def run_t6_standalone():
    """Kendi bağımsız WebSocket sunucusunu başlatarak testi yürütür."""
    print(f"[T6] Bağımsız WebSocket sunucusu başlatılıyor: {WS_URI}...", flush=True)
    server = await websockets.serve(bridge_server.ws_handler, bridge_server.WS_HOST, bridge_server.WS_PORT)
    print("[T6] WebSocket dinleniyor. Açık olan tarayıcının bağlanması bekleniyor...", flush=True)

    start_wait = time.time()
    while not bridge_server.connected_extensions:
        if time.time() - start_wait > 15:
            print("[T6][HATA] 15 saniye içinde tarayıcı eklentisi bağlanmadı!", flush=True)
            server.close()
            await server.wait_closed()
            return "HATA: Tarayıcı bağlanmadı", 0
        await asyncio.sleep(0.5)

    print(f"✓ Tarayıcı eklentisi bağlandı! (Aktif bağlantı: {len(bridge_server.connected_extensions)})", flush=True)

    test_prompt = "Köprü bağlantı testi. Yalnızca KOPRU_E2E_BASARILI yaz."
    zarf = bridge_server.build_agent_envelope(test_prompt, "", "E2E_TEST")
    start_time = time.time()
    response_text = await bridge_server.send_to_chatgpt_and_wait(zarf, asama="E2E_TEST", timeout=140)
    duration = round(time.time() - start_time, 2)

    server.close()
    await server.wait_closed()
    return response_text, duration


async def main():
    print("=== T6: GERÇEK TARAYICI (BRAVE/CHROME) UÇTAN UCA TESTİ ===", flush=True)

    # Önce port 8765'te sunucu var mı dene
    try:
        response, duration = await run_t6_via_existing_server()
    except (ConnectionRefusedError, OSError):
        response, duration = await run_t6_standalone()

    print("====================================================", flush=True)
    print(f" [T6 SONUCU] Süre: {duration} saniye", flush=True)
    print("--- CHATGPT'DEN DÖNEN YANIT METNİ ---", flush=True)
    print(response, flush=True)
    print("====================================================\n", flush=True)

    if "KOPRU_E2E_BASARILI" in response:
        print(">>> T6 GERÇEK TARAYICI UÇTAN UCA TESTİ BAŞARIYLA TAMAMLANDI! <<<", flush=True)
        return True
    else:
        print("[T6][UYARI] Yanıt geldi ancak 'KOPRU_E2E_BASARILI' anahtar ifadesini içermiyor.", flush=True)
        return False


if __name__ == "__main__":
    success = asyncio.run(main())
    sys.exit(0 if success else 1)
