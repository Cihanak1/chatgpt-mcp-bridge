import os
import sys
import json
import asyncio
import websockets

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import bridge_server

if sys.platform == "win32":
    sys.stdin.reconfigure(encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

WS_TEST_PORT = 8767
WS_URI = f"ws://127.0.0.1:{WS_TEST_PORT}"
ready_event = asyncio.Event()


async def mock_resilience_worker():
    async with websockets.connect(WS_URI) as ws:
        ready_event.set()
        async for raw_msg in ws:
            data = json.loads(raw_msg)
            req_id = data.get("request_id")
            text = data.get("text", "")

            # Senaryo 1: Hata bildirimi testi
            if "hata_senaryosu" in text:
                err_resp = {
                    "type": "architect_error",
                    "request_id": req_id,
                    "status": "failed",
                    "error": {
                        "code": "TAB_CRASHED",
                        "message": "ChatGPT sekmesi kapandı."
                    }
                }
                await ws.send(json.dumps(err_resp))

            # Senaryo 2: Boş yanıt testi
            elif "bos_senaryo" in text:
                empty_resp = {
                    "type": "architect_response",
                    "request_id": req_id,
                    "status": "completed",
                    "text": ""
                }
                await ws.send(json.dumps(empty_resp))

            # Senaryo 3: Türkçe karakter ve kod bloğu testi
            elif "turkce_senaryo" in text:
                tr_resp = {
                    "type": "architect_response",
                    "request_id": req_id,
                    "status": "completed",
                    "text": "Türkçe: ğüşıöç ĞÜŞİÖÇ. İğne iplik.\n```python\nprint('Şampiyon')\n```\n[DURUM: ONAY_TAMAM]"
                }
                await ws.send(json.dumps(tr_resp))


async def run_t7_test():
    print("=== T7: DAYANIKLILIK VE HATA YÖNETİMİ TESTİ ===", flush=True)

    bridge_server.WS_PORT = WS_TEST_PORT
    server = await websockets.serve(bridge_server.ws_handler, bridge_server.WS_HOST, WS_TEST_PORT)

    try:
        worker_task = asyncio.create_task(mock_resilience_worker())
        await ready_event.wait()

        # 1. Hata bildirimi testi
        res_err = await bridge_server.send_to_chatgpt_and_wait("hata_senaryosu", asama="TEST")
        assert "TAB_CRASHED" in res_err, f"Hata yakalanamadı: {res_err}"
        print("✓ Extension'dan dönen architect_error kontrollü yakalandı.")

        # 2. Boş yanıt koruması
        res_empty = await bridge_server.send_to_chatgpt_and_wait("bos_senaryo", asama="TEST")
        assert "boş yanıt" in res_empty, f"Boş yanıt koruması çalışmadı: {res_empty}"
        print("✓ Boş yanıt koruması başarıyla devreye girdi.")

        # 3. Türkçe karakter ve kod blokları bütünlüğü
        res_tr = await bridge_server.send_to_chatgpt_and_wait("turkce_senaryo", asama="TEST")
        assert "ğüşıöç" in res_tr and "Şampiyon" in res_tr, f"Türkçe karakterler bozuldu: {res_tr}"
        print("✓ Türkçe karakterler ve kod blokları 100% korundu.")

        # 4. Timeout davranışı
        res_timeout = await bridge_server.send_to_chatgpt_and_wait("timeout_senaryo", asama="TEST", timeout=1)
        assert "Zaman aşımı" in res_timeout, f"Timeout hatası beklenirken: {res_timeout}"
        print("✓ Zaman aşımı (Timeout) mekanizması ve temizliği doğrulandı.")

        worker_task.cancel()
        print("\n>>> T7 DAYANIKLILIK TESTLERİ BAŞARIYLA GEÇTİ <<<\n", flush=True)

    finally:
        server.close()
        await server.wait_closed()


if __name__ == "__main__":
    asyncio.run(run_t7_test())
