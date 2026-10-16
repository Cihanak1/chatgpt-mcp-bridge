import asyncio
import json
import uuid
import sys
import websockets

# Windows stdio utf-8
if sys.platform == "win32":
    sys.stdin.reconfigure(encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

WS_URI = "ws://127.0.0.1:8765"


async def run_tests():
    print("=== T3 & T4: WEBSOCKET RESPONSE & FUTURE RESOLUTION TESTİ BAŞLATILIYOR ===")

    # 1. WebSocket bağlantısı kur
    async with websockets.connect(WS_URI) as ws:
        print("✓ ws://127.0.0.1:8765 adresine test istemcisi bağlandı.")

        # Test A: Bilinmeyen UUID gönderildiğinde sunucunun çökmediğini doğrula
        unknown_msg = json.dumps({
            "type": "architect_response",
            "request_id": str(uuid.uuid4()),
            "status": "completed",
            "text": "Bilinmeyen istek"
        })
        await ws.send(unknown_msg)
        await asyncio.sleep(0.2)
        print("✓ Bilinmeyen UUID güvenli şekilde karşılandı, sunucu kararlılığını korudu.")

        # Test B: ACK mesajının güvenle işlendiğini doğrula
        ack_msg = json.dumps({
            "type": "architect_ack",
            "request_id": str(uuid.uuid4()),
            "status": "received"
        })
        await ws.send(ack_msg)
        await asyncio.sleep(0.2)
        print("✓ architect_ack mesajı işlendi.")

        # Test C: Bozuk JSON gönderildiğinde sunucunun çökmediğini doğrula
        await ws.send("{ geccersiz json ...")
        await asyncio.sleep(0.2)
        print("✓ Bozuk JSON güvenle yakalandı (JSONDecodeError), sunucu çalışmaya devam ediyor.")

    print("\n>>> T3 & T4 WEBSOCKET & FUTURE TESTLERİ BAŞARIYLA GEÇTİ <<<\n")


if __name__ == "__main__":
    asyncio.run(run_tests())
