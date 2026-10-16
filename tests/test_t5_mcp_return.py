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

WS_TEST_PORT = 8766
WS_URI = f"ws://127.0.0.1:{WS_TEST_PORT}"
connected_event = asyncio.Event()


async def mock_extension_worker():
    """Mock Chrome Extension: Gelen isteğe anında sahte yanıt döner."""
    async with websockets.connect(WS_URI) as ws:
        connected_event.set()
        async for raw_msg in ws:
            data = json.loads(raw_msg)
            if data.get("type") in ("architect_request", "ASK_CHATGPT"):
                req_id = data.get("request_id")
                response_payload = {
                    "type": "architect_response",
                    "request_id": req_id,
                    "status": "completed",
                    "text": "KOPRU_TEST_BASARILI\n[DURUM: ONAY_TAMAM]",
                    "char_count": 39,
                    "timestamp": 1729000000000
                }
                await ws.send(json.dumps(response_payload))
                break


async def run_t5_test():
    print("=== T5: MCP RETURN TESTİ BAŞLATILIYOR ===", flush=True)

    bridge_server.WS_PORT = WS_TEST_PORT

    # WebSocket sunucusunu başlat
    server = await websockets.serve(bridge_server.ws_handler, bridge_server.WS_HOST, WS_TEST_PORT)
    print(f"✓ Test WebSocket sunucusu başlatıldı (Port: {WS_TEST_PORT}).", flush=True)

    try:
        mock_task = asyncio.create_task(mock_extension_worker())
        await connected_event.wait()
        print("✓ Sahte tarayıcı eklentisi bağlandı, köprü hazır.", flush=True)

        # MCP aracını çağır
        print("✓ chatgpt_mimar_ile_konus MCP aracı çağrılıyor...", flush=True)
        result = await bridge_server.chatgpt_mimar_ile_konus(
            mesaj="Kopru test mesaji",
            kod_ozeti="",
            asama="TEST"
        )

        await mock_task

        print(f"✓ MCP aracından dönen yanıt:\n---\n{result}\n---", flush=True)

        if "KOPRU_TEST_BASARILI" not in result:
            raise AssertionError(f"Beklenen 'KOPRU_TEST_BASARILI' metni yanıtta bulunamadı! Dönen: {result}")

        print("\n>>> T5 MCP RETURN TESTİ BAŞARIYLA GEÇTİ <<<\n", flush=True)
    finally:
        server.close()
        await server.wait_closed()


if __name__ == "__main__":
    asyncio.run(run_t5_test())
